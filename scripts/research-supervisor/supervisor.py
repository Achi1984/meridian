"""POSIX process supervision for the fixed synthetic path adapter."""

import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import time

import journal


ADAPTER = Path(__file__).resolve().with_name("synthetic_adapter.mjs")
MAX_INPUT_BYTES = 8192
MAX_STDOUT_BYTES = 8192
MAX_STDERR_BYTES = 4096
MAX_PATH_SECONDS = journal.MAX_PATH_SECONDS
MAX_BATCH_SECONDS = journal.MAX_BATCH_SECONDS


class ChildFailure(ValueError):
    def __init__(self, reason, timed_out=False):
        super().__init__(reason)
        self.reason = reason
        self.timed_out = timed_out


def _strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ChildFailure("DUPLICATE_EVENT_KEY")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=pairs,
                           parse_constant=lambda _: (_ for _ in ()).throw(ChildFailure("INVALID_EVENT")))
    except (ValueError, RecursionError):
        raise ChildFailure("INVALID_EVENT")
    if type(value) is not dict:
        raise ChildFailure("INVALID_EVENT")
    return value


def _limits(value):
    value = value or {"path_seconds": MAX_PATH_SECONDS, "batch_seconds": MAX_BATCH_SECONDS}
    if type(value) is not dict or set(value) != {"path_seconds", "batch_seconds"}:
        raise ChildFailure("LIMITS_INVALID")
    for name, maximum in (("path_seconds", MAX_PATH_SECONDS), ("batch_seconds", MAX_BATCH_SECONDS)):
        if type(value[name]) not in (int, float) or not 0 < value[name] <= maximum:
            raise ChildFailure("LIMITS_INVALID")
    return value


def _terminate_group(process, immediate=False):
    try:
        os.killpg(process.pid, signal.SIGKILL if immediate else signal.SIGTERM)
    except ProcessLookupError:
        pass
    if not immediate:
        try:
            process.wait(timeout=0.05)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)


def _run_child(request, path_deadline, batch_deadline, path_seconds, on_event):
    if os.name != "posix":
        raise ChildFailure("POSIX_REQUIRED")
    node = shutil.which("node")
    if node is None or not ADAPTER.is_file():
        raise ChildFailure("ADAPTER_UNAVAILABLE")
    node = str(Path(node).resolve())
    request_bytes = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode() + b"\n"
    if len(request_bytes) > MAX_INPUT_BYTES:
        raise ChildFailure("INPUT_BOUND")
    try:
        process = subprocess.Popen(
            [node, str(ADAPTER.resolve())],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.path.dirname(node), "LANG": "C.UTF-8"},
            start_new_session=True,
            close_fds=True,
        )
    except OSError:
        raise ChildFailure("CHILD_START_FAILED")
    selector = selectors.DefaultSelector()
    output = bytearray()
    error = bytearray()
    events = []
    offset = 0
    started_deadline = path_deadline
    input_bytes = request_bytes
    input_state = "request"
    try:
        for stream, mode, label in (
            (process.stdin, selectors.EVENT_WRITE, "request"),
            (process.stdout, selectors.EVENT_READ, "output"),
            (process.stderr, selectors.EVENT_READ, "error"),
        ):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, mode, label)
        while selector.get_map():
            deadline = min(batch_deadline, started_deadline)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
            for key, _ in selector.select(min(remaining, 0.05)):
                stream, label = key.fileobj, key.data
                if label in ("request", "ack"):
                    try:
                        offset += os.write(stream.fileno(), input_bytes[offset:offset + 4096])
                    except BrokenPipeError:
                        if label == "ack":
                            raise ChildFailure("PATH_ACK_FAILED")
                        offset = len(input_bytes)
                    if offset == len(input_bytes):
                        selector.unregister(stream)
                        if label == "request":
                            input_state = "await_start"
                        else:
                            stream.close()
                            input_state = "ack_sent"
                            started_deadline = min(batch_deadline, time.monotonic() + path_seconds)
                    continue
                chunk = os.read(stream.fileno(), 4096)
                if not chunk:
                    selector.unregister(stream)
                    stream.close()
                    continue
                if label == "error":
                    if len(error) + len(chunk) > MAX_STDERR_BYTES:
                        raise ChildFailure("STDERR_BOUND")
                    error.extend(chunk)
                    continue
                if len(output) + len(chunk) > MAX_STDOUT_BYTES:
                    raise ChildFailure("STDOUT_BOUND")
                output.extend(chunk)
                while b"\n" in output:
                    raw, _, remainder = output.partition(b"\n")
                    output[:] = remainder
                    event = _strict_json(raw.decode("utf-8"))
                    if len(events) >= 2:
                        raise ChildFailure("EVENT_COUNT")
                    if not events:
                        if input_state != "await_start":
                            raise ChildFailure("PATH_START_PROTOCOL")
                    elif input_state != "ack_sent":
                        raise ChildFailure("PATH_COMPLETE_BEFORE_ACK")
                    on_event(event, len(events))
                    events.append(event)
                    if len(events) == 1:
                        if time.monotonic() >= batch_deadline:
                            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
                        input_bytes = json.dumps(
                            {"event": "parent_started", "index": request["index"],
                             "pathId": request["pathId"]},
                            sort_keys=True, separators=(",", ":")
                        ).encode() + b"\n"
                        offset = 0
                        input_state = "ack"
                        selector.register(process.stdin, selectors.EVENT_WRITE, "ack")
        remaining = min(batch_deadline, started_deadline) - time.monotonic()
        if remaining <= 0:
            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
        try:
            exit_code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
        if output or len(events) != 2:
            raise ChildFailure("EVENT_MISSING")
        if error:
            raise ChildFailure("CHILD_STDERR")
        if exit_code != 0:
            raise ChildFailure("CHILD_EXIT")
        return events
    except UnicodeError:
        raise ChildFailure("EVENT_ENCODING")
    finally:
        selector.close()
        _terminate_group(process, immediate=process.poll() is None)
        for stream in (process.stdin, process.stdout, process.stderr):
            if not stream.closed:
                stream.close()


def _event_validator(index, path, predecessor, receipt, database):
    seen = []
    expected_start = {
        "event": "path_started", "index": index, "pathId": path["id"],
        "variantId": path["variant"], "predecessorSha256": predecessor,
    }
    expected_complete = {**expected_start, "event": "path_completed"}
    expected_complete_keys = set(expected_complete) | {"outputSha256"}

    def validate(event, event_index):
        if event_index == 0:
            if event != expected_start:
                raise ChildFailure("PATH_START_EVENT_INVALID")
            journal.record_path_started(database, receipt, index, path["id"], predecessor)
        else:
            if (set(event) != expected_complete_keys
                    or any(event.get(key) != value for key, value in expected_complete.items())
                    or not journal._digest(event.get("outputSha256"))):
                raise ChildFailure("PATH_COMPLETE_EVENT_INVALID")
            journal.record_path_completed(database, receipt, index, path["id"], predecessor,
                                          event["outputSha256"])
        seen.append(event)
    return validate, seen


def run_batch(database, claim, *, limits=None):
    """Start one claimed trial; execute the fixed 44-path fixture sequentially exactly once."""
    if os.name != "posix":
        raise ChildFailure("POSIX_REQUIRED")
    caps = _limits(limits)
    batch_deadline = time.monotonic() + caps["batch_seconds"]
    started = journal.start(database, claim)
    receipt = {key: started[key] for key in (
        "trialId", "trialKey", "owner", "fence", "protocolSha256", "sourceSha256",
        "dataSha256", "manifestSha256", "pathIds", "variantIds", "budget")}
    predecessor = hashlib.sha256((started["trialId"] + "\n" + started["protocolSha256"]).encode()).hexdigest()
    try:
        for index, path in enumerate(journal.PATHS):
            if time.monotonic() >= batch_deadline:
                raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
            validator, observed = _event_validator(index, path, predecessor, receipt, database)
            request = {
                "protocolSha256": started["protocolSha256"],
                "sourceSha256": started["sourceSha256"],
                "dataSha256": started["dataSha256"],
                "index": index,
                "pathId": path["id"],
                "variantId": path["variant"],
                "predecessorSha256": predecessor,
            }
            path_deadline = min(batch_deadline, time.monotonic() + caps["path_seconds"])
            _run_child(request, path_deadline, batch_deadline, caps["path_seconds"], validator)
            if len(observed) != 2 or observed[1].get("event") != "path_completed":
                raise ChildFailure("PATH_EVENT_MISSING")
            predecessor = observed[1]["outputSha256"]
        if time.monotonic() >= batch_deadline:
            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
        return journal.settle(database, receipt, "COMPLETED", "ALL_PATHS_COMPLETED")
    except ChildFailure as error:
        current = journal.inspect(database, started["trialId"])
        completed = sum(path["state"] == "completed" for path in current["paths"])
        outcome = "TIMED_OUT" if error.timed_out else ("PARTIAL" if completed else "FAILED")
        return journal.settle(database, receipt, outcome, error.reason)
