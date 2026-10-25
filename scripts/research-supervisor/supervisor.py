"""POSIX process supervision for the fixed synthetic path adapter."""

import errno
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

import journal


ADAPTER = Path(__file__).resolve().with_name("synthetic_adapter.mjs")
B1_ADAPTER = Path(__file__).resolve().with_name("b1_adapter.mjs")
HISTORICAL_ADAPTER = Path(__file__).resolve().with_name("historical_adapter.mjs")
MAX_INPUT_BYTES = 8192
MAX_STDOUT_BYTES = 8192
MAX_STDERR_BYTES = 4096
MAX_PATH_SECONDS = journal.MAX_PATH_SECONDS
MAX_BATCH_SECONDS = journal.MAX_BATCH_SECONDS
MAX_JOURNAL_LOCK_WAIT_SECONDS = 0.01
WORKER_GUARD_READY = b"PDEATHSIG_ARMED\n"
WORKER_GUARD_TIMEOUT_SECONDS = 5
PDEATHSIG_BOOTSTRAP = """
import ctypes
import os
import signal
import sys

def fail():
    try:
        os.write(2, b"PARENT_DEATH_GUARD_FAILED\\n")
    except OSError:
        pass
    os._exit(120)

try:
    expected_parent = int(sys.argv[1])
    ready_fd = int(sys.argv[2])
    node = sys.argv[3]
    adapter = sys.argv[4]
    libc = ctypes.CDLL(None, use_errno=True)
    prctl = libc.prctl
    prctl.restype = ctypes.c_int
    if prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        fail()
    observed = ctypes.c_int(-1)
    if prctl(2, ctypes.byref(observed), 0, 0, 0) != 0 or observed.value != signal.SIGKILL:
        fail()
    if os.getppid() != expected_parent:
        fail()
    if os.write(ready_fd, b"PDEATHSIG_ARMED\\n") != len(b"PDEATHSIG_ARMED\\n"):
        fail()
    os.close(ready_fd)
    os.execve(node, [node, adapter], os.environ)
except BaseException:
    fail()
"""


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


def _unprivileged_executable(path):
    try:
        mode = path.stat().st_mode
        if mode & (stat.S_ISUID | stat.S_ISGID):
            return False
        os.getxattr(path, "security.capability")
        return False
    except OSError as error:
        return error.errno in (errno.ENODATA, errno.ENOTSUP, errno.EOPNOTSUPP)


def preflight_b1_runtime():
    """Read-only availability and privilege check shared by preflight and launch."""
    if not sys.platform.startswith("linux"):
        raise ChildFailure("LINUX_REQUIRED")
    python = Path(sys.executable).resolve()
    node = shutil.which("node")
    if (not python.is_file() or not os.access(python, os.X_OK)
            or node is None):
        raise ChildFailure("ADAPTER_UNAVAILABLE")
    node_path = Path(node).resolve()
    if not node_path.is_file() or not os.access(node_path, os.X_OK):
        raise ChildFailure("ADAPTER_UNAVAILABLE")
    if not _unprivileged_executable(python) or not _unprivileged_executable(node_path):
        raise ChildFailure("PRIVILEGED_EXECUTABLE")
    return str(node_path)


def _wait_worker_guard(process, ready_fd, batch_deadline):
    expected = WORKER_GUARD_READY
    observed = bytearray()
    os.set_blocking(ready_fd, False)
    deadline = min(batch_deadline, time.monotonic() + WORKER_GUARD_TIMEOUT_SECONDS)
    with selectors.DefaultSelector() as readiness:
        readiness.register(ready_fd, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            if not readiness.select(min(0.05, deadline - time.monotonic())):
                if process.poll() is not None:
                    break
                continue
            chunk = os.read(ready_fd, len(expected) + 1 - len(observed))
            if not chunk:
                break
            observed.extend(chunk)
            if len(observed) > len(expected) or not expected.startswith(observed):
                raise ChildFailure("PARENT_DEATH_GUARD_FAILED")
            if observed == expected:
                continue
    if observed != expected:
        timed_out = time.monotonic() >= batch_deadline
        raise ChildFailure("DEADLINE_EXCEEDED" if timed_out else "PARENT_DEATH_GUARD_FAILED",
                           timed_out=timed_out)


def _worker_bootstrap_command(expected_parent, ready_fd, node, adapter):
    return [
        str(Path(sys.executable).resolve()), "-I", "-c", PDEATHSIG_BOOTSTRAP,
        str(expected_parent), str(ready_fd), str(Path(node).resolve()),
        str(Path(adapter).resolve()),
    ]


def _spawn_guarded_worker(node, adapter, *, env, pass_fds, batch_deadline):
    python = Path(sys.executable).resolve()
    node_path = Path(node).resolve()
    if not _unprivileged_executable(python) or not _unprivileged_executable(node_path):
        raise ChildFailure("PRIVILEGED_EXECUTABLE")
    guard_read, guard_write = os.pipe()
    process = None
    succeeded = False
    try:
        os.set_inheritable(guard_write, True)
        process = subprocess.Popen(
            _worker_bootstrap_command(os.getpid(), guard_write, node_path, adapter),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            start_new_session=True,
            close_fds=True,
            pass_fds=(*pass_fds, guard_write),
        )
        os.close(guard_write)
        guard_write = None
        try:
            _wait_worker_guard(process, guard_read, batch_deadline)
        finally:
            os.close(guard_read)
            guard_read = None
        succeeded = True
        return process
    except OSError:
        raise ChildFailure("CHILD_START_FAILED")
    finally:
        if guard_read is not None:
            os.close(guard_read)
        if guard_write is not None:
            os.close(guard_write)
        if process is not None and not succeeded:
            if process.poll() is None:
                _terminate_group(process, immediate=True)
            else:
                process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                if not stream.closed:
                    stream.close()


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
                    callback_deadline = batch_deadline if not events else started_deadline
                    on_event(event, len(events), callback_deadline)
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

    def validate(event, event_index, deadline):
        if event_index == 0:
            if event != expected_start:
                raise ChildFailure("PATH_START_EVENT_INVALID")
            journal.record_path_started(database, receipt, index, path["id"], predecessor,
                                        busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=deadline)
        else:
            if (set(event) != expected_complete_keys
                    or any(event.get(key) != value for key, value in expected_complete.items())
                    or not journal._digest(event.get("outputSha256"))):
                raise ChildFailure("PATH_COMPLETE_EVENT_INVALID")
            journal.record_path_completed(database, receipt, index, path["id"], predecessor,
                                          event["outputSha256"],
                                          busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=deadline)
        seen.append(event)
    return validate, seen


def run_batch(database, claim, *, limits=None):
    """Start one claimed trial; execute the fixed 44-path fixture sequentially exactly once."""
    if os.name != "posix":
        raise ChildFailure("POSIX_REQUIRED")
    caps = _limits(limits)
    batch_deadline = time.monotonic() + caps["batch_seconds"]
    try:
        started = journal.start(database, claim, busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS,
                                deadline=batch_deadline)
    except journal.JournalError as error:
        return _unsettled(claim["trialId"], error.code)
    receipt = {key: started[key] for key in (
        "trialId", "trialKey", "owner", "fence", "protocolSha256", "sourceSha256",
        "dataSha256", "manifestSha256", "pathIds", "variantIds", "budget")}
    predecessor = hashlib.sha256((started["trialId"] + "\n" + started["protocolSha256"]).encode()).hexdigest()
    completed_paths = 0
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
            completed_paths += 1
        if time.monotonic() >= batch_deadline:
            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
        return journal.settle(database, receipt, "COMPLETED", "ALL_PATHS_COMPLETED",
                              busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=batch_deadline)
    except ChildFailure as error:
        outcome = "TIMED_OUT" if error.timed_out else ("PARTIAL" if completed_paths else "FAILED")
        try:
            return journal.settle(database, receipt, outcome, error.reason,
                                  busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS)
        except journal.JournalError as persistence_error:
            return _unsettled(started["trialId"], persistence_error.code)
    except journal.JournalError as error:
        return _unsettled(started["trialId"], error.code)


def _unsettled(trial_id, reason):
    return {
        "state": "UNSETTLED",
        "trialId": trial_id,
        "reason": reason,
        "persistConfirmed": False,
        "executionAuthorized": False,
        "promotionAuthorized": False,
    }


def _b1_event(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ChildFailure("DUPLICATE_EVENT_KEY")
            result[key] = value
        return result
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                           parse_constant=lambda _: (_ for _ in ()).throw(ChildFailure("INVALID_EVENT")))
    except (UnicodeError, ValueError, RecursionError):
        raise ChildFailure("INVALID_EVENT")
    if type(value) is not dict:
        raise ChildFailure("INVALID_EVENT")
    return value


def _run_b1_child(database, receipt, profile, started, batch_deadline, limits):
    node = preflight_b1_runtime()
    adapter = Path(
        HISTORICAL_ADAPTER if profile["profile"] == journal.HISTORICAL_PROFILE_NAME
        else B1_ADAPTER
    ).absolute()
    if not adapter.is_file():
        raise ChildFailure("ADAPTER_UNAVAILABLE")
    result_read, result_write = os.pipe()
    os.set_inheritable(result_write, True)
    try:
        process = _spawn_guarded_worker(
            node, adapter, env={"PATH": os.path.dirname(node), "LANG": "C.UTF-8",
                                "B1_RESULT_FD": str(result_write)},
            pass_fds=(result_write,), batch_deadline=batch_deadline)
    except ChildFailure:
        os.close(result_read)
        os.close(result_write)
        raise
    os.close(result_write)
    selector = selectors.DefaultSelector()
    streams = ((process.stdin, "input"), (process.stdout, "control"),
               (process.stderr, "error"), (result_read, "result"))
    for stream, _ in streams:
        fd = stream if type(stream) is int else stream.fileno()
        os.set_blocking(fd, False)
    control = bytearray()
    result_wire = bytearray()
    stderr = bytearray()
    frame = None
    frame_length = None
    frame_data = bytearray()
    frame_limit = None
    current_path = None
    path_deadline = batch_deadline
    completed_paths = 0
    controls_status = None
    ready = False
    final_committed = False
    input_bytes = 0
    control_bytes = 0
    result_eof = False
    error_event = None
    response = started
    post_settlement_failure = None
    post_settlement_result_bytes = 0

    def send(value):
        nonlocal input_bytes
        payload = json.dumps(value, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=True).encode() + b"\n"
        if input_bytes + len(payload) > MAX_INPUT_BYTES:
            raise ChildFailure("INPUT_BOUND")
        input_bytes += len(payload)
        offset = 0
        while offset < len(payload):
            if time.monotonic() >= min(batch_deadline, path_deadline):
                raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
            try:
                offset += os.write(process.stdin.fileno(), payload[offset:])
            except BlockingIOError:
                selector.select(min(0.01, max(0, min(batch_deadline, path_deadline) - time.monotonic())))
            except BrokenPipeError:
                raise ChildFailure("PARENT_ACK_FAILED")

    def frame_start(kind, index=None):
        nonlocal frame, frame_length, frame_data, frame_limit
        if frame is not None:
            raise ChildFailure("FRAME_OVERLAP")
        frame = (kind, index)
        frame_length = None
        frame_data = bytearray()
        frame_limit = None

    def handle_frame(raw):
        nonlocal frame, frame_length, frame_data, frame_limit, current_path
        nonlocal completed_paths, controls_status, final_committed, response, path_deadline
        kind, index = frame
        if kind == "path":
            response = journal.record_b1_path_completed(
                database, receipt, index, raw, busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS,
                deadline=path_deadline)
            completed_paths += 1
            send({"event": "path_committed", "index": index})
            current_path = None
            path_deadline = batch_deadline
        elif kind == "controls":
            response = journal.record_b1_controls(
                database, receipt, raw, busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS,
                deadline=batch_deadline)
            controls = json.loads(response["controls"])
            controls_status = controls["status"]
            send({"event": "controls_committed"})
        elif kind == "summary":
            summary = _b1_event(raw)
            outcome = "COMPLETED" if summary.get("status") == "COMPLETED" else "FAILED"
            reason = "ALL_PATHS_COMPLETED" if outcome == "COMPLETED" else (
                error_event.get("reason", "EXECUTION_INCOMPLETE") if error_event else "EXECUTION_INCOMPLETE")
            summary_to_store = raw if (
                outcome == "COMPLETED" or
                (summary.get("status") == "INSUFFICIENT_EVIDENCE"
                 and response is not None and response.get("controls") is not None)
            ) else None
            response = journal.settle_b1(
                database, receipt, outcome, reason, summary_to_store,
                busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=batch_deadline)
            final_committed = True
            send({"event": "final_ack"})
        frame = None
        frame_length = None
        frame_data = bytearray()
        frame_limit = None

    def consume_result_bytes(chunk):
        nonlocal frame_length, frame_data, frame_limit, result_wire
        nonlocal post_settlement_failure, post_settlement_result_bytes
        if frame is None:
            if final_committed:
                post_settlement_failure = post_settlement_failure or "EXTRA_RESULT_FRAME"
                post_settlement_result_bytes += len(chunk)
                if post_settlement_result_bytes > journal.MAX_RESULT_BYTES:
                    raise ChildFailure("RESULT_CHANNEL_BOUND")
                return
            raise ChildFailure("EXTRA_RESULT_FRAME")
        result_wire.extend(chunk)
        while True:
            if frame_length is None:
                separator = result_wire.find(b"\n")
                if separator < 0:
                    if len(result_wire) > 32:
                        raise ChildFailure("FRAME_HEADER_BOUND")
                    return
                header = bytes(result_wire[:separator])
                del result_wire[:separator + 1]
                if not header.startswith(b"FRAME "):
                    raise ChildFailure("FRAME_HEADER_INVALID")
                digits = header[6:]
                if not digits or not digits.isdigit() or len(digits) > 10:
                    raise ChildFailure("FRAME_HEADER_INVALID")
                frame_length = int(digits)
                if frame_length <= 0 or str(frame_length).encode() != digits:
                    raise ChildFailure("FRAME_HEADER_INVALID")
                frame_limit = journal.b1_remaining_capacity(
                    database, receipt, deadline=min(batch_deadline, path_deadline))
                if frame_length > frame_limit or frame_length > journal.MAX_RESULT_BYTES:
                    raise ChildFailure("RESULT_CAPACITY")
            need = frame_length - len(frame_data)
            if need:
                count = min(need, len(result_wire))
                frame_data.extend(result_wire[:count])
                del result_wire[:count]
                if len(frame_data) < frame_length:
                    return
            if result_wire:
                raise ChildFailure("EXTRA_RESULT_FRAME")
            handle_frame(bytes(frame_data))
            return

    def handle_event(event):
        nonlocal ready, frame, current_path, path_deadline, controls_status, error_event
        nonlocal post_settlement_failure
        if final_committed:
            post_settlement_failure = post_settlement_failure or "TRAILING_CONTROL_EVENT"
            return
        event_type = event.get("type")
        if event_type == "ready":
            required = {"type", "protocolSha256", "sourceSha256", "inputSha256",
                        "implementationSha256", "manifestSha256", "computationOrderSha256"}
            if ready or set(event) != required or current_path is not None:
                raise ChildFailure("READY_EVENT_INVALID")
            if any(event[key] != profile[profile_key] for key, profile_key in (
                    ("protocolSha256", "protocolSha256"), ("inputSha256", "inputSha256"),
                    ("implementationSha256", "implementationSha256"),
                    ("manifestSha256", "manifestSha256"),
                    ("computationOrderSha256", "computationOrderSha256"))) \
                    or event["sourceSha256"] != profile["sourceIdentitySha256"]:
                raise ChildFailure("B1_IDENTITY_MISMATCH")
            ready = True
            send({"event": "prepared"})
        elif event_type == "path_started":
            if not ready or set(event) != {"type", "index", "pathId"} or current_path is not None:
                raise ChildFailure("PATH_START_PROTOCOL")
            index = event["index"]
            if type(index) is not int or index != completed_paths or index >= 44:
                raise ChildFailure("PATH_ORDER")
            expected = profile["computation"][index]["pathId"]
            if event["pathId"] != expected or (index >= 19 and controls_status != "FROZEN_DEVELOPMENT_ONLY"):
                raise ChildFailure("PATH_IDENTITY_MISMATCH")
            path_deadline = min(batch_deadline, time.monotonic() + limits["path_seconds"])
            journal.record_b1_path_started(
                database, receipt, index, expected, busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS,
                deadline=path_deadline)
            current_path = index
            frame_start("path", index)
            send({"event": "path_started_ack", "index": index})
        elif event_type == "controls":
            insufficient_boundary = completed_paths == 18 and current_path == 18
            if (not ready or set(event) != {"type"}
                    or (completed_paths != 19 and not insufficient_boundary)
                    or controls_status is not None):
                raise ChildFailure("CONTROLS_ORDER")
            frame_start("controls")
            send({"event": "controls_ready"})
        elif event_type == "execution_failed":
            if not ready or set(event) != {"type", "status", "reason"}:
                raise ChildFailure("EXECUTION_FAILURE_INVALID")
            if type(event["status"]) is not str or type(event["reason"]) is not str \
                    or re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", event["reason"]) is None:
                raise ChildFailure("EXECUTION_FAILURE_INVALID")
            if frame is not None and frame[0] == "path":
                frame = None
                current_path = None
            error_event = event
        elif event_type == "final_summary":
            if not ready or set(event) != {"type"} or current_path is not None:
                raise ChildFailure("FINAL_SUMMARY_ORDER")
            frame_start("summary")
            send({"event": "final_summary_ready"})
        else:
            raise ChildFailure("UNKNOWN_EVENT")

    try:
        for stream, label in streams:
            if label != "input":
                selector.register(stream if type(stream) is int else stream.fileno(),
                                  selectors.EVENT_READ, label)
            else:
                # stdin is registered only for writes performed synchronously by send().
                pass
        while selector.get_map():
            deadline = min(batch_deadline, path_deadline)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
            for key, _ in selector.select(min(remaining, 0.05)):
                fd, label = key.fileobj, key.data
                chunk = os.read(fd, 4096)
                if not chunk:
                    selector.unregister(fd)
                    if label == "result":
                        result_eof = True
                    elif label == "control":
                        pass
                    elif label == "error":
                        pass
                    continue
                if label == "control":
                    control_bytes += len(chunk)
                    if control_bytes > MAX_STDOUT_BYTES:
                        raise ChildFailure("STDOUT_BOUND")
                    control.extend(chunk)
                    while b"\n" in control:
                        raw, _, remainder = control.partition(b"\n")
                        control[:] = remainder
                        if len(raw) > MAX_STDOUT_BYTES:
                            raise ChildFailure("CONTROL_BOUND")
                        try:
                            event = _b1_event(raw)
                        except ChildFailure as error:
                            if not final_committed:
                                raise
                            post_settlement_failure = post_settlement_failure or error.reason
                            continue
                        handle_event(event)
                    if len(control) > MAX_STDOUT_BYTES:
                        raise ChildFailure("CONTROL_BOUND")
                elif label == "error":
                    if len(stderr) + len(chunk) > MAX_STDERR_BYTES:
                        raise ChildFailure("STDERR_BOUND")
                    stderr.extend(chunk)
                    if final_committed:
                        post_settlement_failure = post_settlement_failure or "CHILD_STDERR"
                else:
                    consume_result_bytes(chunk)
            if result_eof and frame is not None:
                raise ChildFailure("FRAME_TRUNCATED")
        if control or result_wire or frame is not None:
            raise ChildFailure("FRAME_TRUNCATED")
        if not ready or not final_committed:
            if stderr:
                reason = stderr.decode("utf-8", errors="replace").strip().splitlines()[0]
                if re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason):
                    raise ChildFailure(reason)
            raise ChildFailure("EVENT_MISSING")
        remaining = batch_deadline - time.monotonic()
        if remaining <= 0:
            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
        try:
            exit_code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise ChildFailure("DEADLINE_EXCEEDED", timed_out=True)
        if exit_code != 0:
            if final_committed:
                post_settlement_failure = post_settlement_failure or "CHILD_EXIT"
            else:
                raise ChildFailure("CHILD_EXIT")
        if stderr and not final_committed:
            raise ChildFailure("CHILD_STDERR")
        if post_settlement_failure:
            response["postSettlementFailure"] = post_settlement_failure
        return response
    finally:
        selector.close()
        _terminate_group(process, immediate=process.poll() is None)
        for stream in (process.stdin, process.stdout, process.stderr):
            if not stream.closed:
                stream.close()
        os.close(result_read)


def _b1_after_settlement(database, trial_id, reason):
    try:
        current = journal.inspect_b1(database, trial_id)
    except journal.JournalError:
        return None
    if current["state"] != "completed":
        return None
    current["postSettlementFailure"] = reason
    return current


def run_b1_batch(database, claim, *, limits=None):
    """Run one immutable B1 session in one persistent Node child."""
    if os.name != "posix":
        raise ChildFailure("POSIX_REQUIRED")
    caps = _limits(limits)
    batch_deadline = time.monotonic() + caps["batch_seconds"]
    try:
        if type(claim) is not dict:
            raise ChildFailure("B1_CLAIM_INVALID")
        profile = journal._b1_profile(claim.get("profile"))
        if profile["profile"] not in (
                journal.B1_PROFILE_NAME, journal.HISTORICAL_PROFILE_NAME):
            raise ChildFailure("B1_CLAIM_INVALID")
        if profile["profile"] == journal.HISTORICAL_PROFILE_NAME and (
                profile["status"] != "FROZEN_FOR_D2" or profile["inputSha256"] is None):
            raise ChildFailure("HISTORICAL_ADMISSION_REQUIRED")
        started = journal.start_b1(
            database, claim, busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=batch_deadline)
    except journal.JournalError as error:
        return _unsettled(claim.get("trialId") if type(claim) is dict else None, error.code)
    except ChildFailure as error:
        return _unsettled(claim.get("trialId") if type(claim) is dict else None, error.reason)
    receipt = {key: started[key] for key in (
        "trialId", "trialKey", "owner", "fence", "profile", "sourceSha256",
        "dataSha256", "manifestSha256", "pathIds", "computationPathIds")}
    try:
        return _run_b1_child(database, receipt, profile, started, batch_deadline, caps)
    except ChildFailure as error:
        committed = _b1_after_settlement(database, receipt["trialId"], error.reason)
        if committed is not None:
            return committed
        if error.reason == "PARENT_ACK_FAILED":
            return _unsettled(receipt["trialId"], error.reason)
        try:
            current = journal.inspect_b1(database, receipt["trialId"])
            outcome = "TIMED_OUT" if error.timed_out else (
                "PARTIAL" if current["paths"] else "FAILED")
            return journal.settle_b1(
                database, receipt, outcome, error.reason,
                busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=batch_deadline)
        except journal.JournalError as persistence_error:
            return _unsettled(receipt["trialId"], persistence_error.code)
    except journal.JournalError as error:
        committed = _b1_after_settlement(database, receipt["trialId"], error.code)
        if committed is not None:
            return committed
        try:
            current = journal.inspect_b1(database, receipt["trialId"])
            outcome = "PARTIAL" if current["paths"] else "FAILED"
            return journal.settle_b1(
                database, receipt, outcome, error.code,
                busy_timeout=MAX_JOURNAL_LOCK_WAIT_SECONDS, deadline=batch_deadline)
        except journal.JournalError as persistence_error:
            return _unsettled(receipt["trialId"], persistence_error.code)
