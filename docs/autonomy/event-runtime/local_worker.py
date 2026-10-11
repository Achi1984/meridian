"""One-shot local decision worker. No model, network, scheduler or remote writes."""
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import time
import durable_inbox as inbox

ADAPTER = Path(__file__).resolve().parent.parent / "event-adapter/scripts/event-continuation-adapter.mjs"
MAX_INPUT = 131072
MAX_OUTPUT = 32768
MAX_ERROR = 4096

BRIDGE = r'''
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const location=process.argv[1];
const {reconcileContinuation}=await import(location);
const {normalizeEvent}=await import(new URL('../fixtures/scripts/event-continuation-intake.mjs',location));
const raw=readFileSync(0,'utf8');
const {binding,payload}=JSON.parse(raw);
const x=JSON.parse(payload);
if(createHash('sha256').update(payload).digest('hex')!==binding.payloadSha256)throw Error('PAYLOAD_BINDING');
const event=normalizeEvent(x.trigger.name,x.trigger.payloadJson,JSON.stringify(x.config));
if(event.eventIdentity!==binding.eventIdentity||event.revisionDigest!==binding.revisionDigest||event.repository!==binding.repository||x.expected.headSha!==binding.headSha||x.expected.baseSha!==binding.baseSha)throw Error('EVENT_BINDING');
const result=process.argv[2]==='preflight'?{kind:'EVENT_BINDING_CHECK',authenticated:false,provenanceVerified:false,authorized:false,dispatchAllowed:false,mergeAllowed:false,durable:false}:reconcileContinuation(x);
for(const key of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'])if(result[key]!==false)throw Error('AUTHORITY');
process.stdout.write(JSON.stringify(result));
'''


class WorkerError(ValueError): pass


def require(value, code):
    if not value: raise WorkerError(code)


def strict_json(raw):
    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(WorkerError("NONFINITE_JSON")))


def execute_adapter(payload, binding, timeout_seconds, preflight=False):
    """Fixed trusted Node module; bounds enforced while pipes are consumed."""
    require(type(timeout_seconds) in (int, float) and 0 < timeout_seconds <= 10, "TIMEOUT_BOUND")
    node = shutil.which("node")
    require(node is not None and ADAPTER.is_file(), "ADAPTER_UNAVAILABLE")
    node = str(Path(node).resolve())
    raw = json.dumps({"binding": binding, "payload": payload}, separators=(",", ":")).encode()
    require(len(raw) <= 2 * MAX_INPUT, "BRIDGE_INPUT_BOUND")
    process = subprocess.Popen([node, "--input-type=module", "-e", BRIDGE, ADAPTER.as_uri(), "preflight" if preflight else "decision"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={"PATH": os.path.dirname(node), "LANG": "C.UTF-8"},
        start_new_session=True, close_fds=True)
    selector = selectors.DefaultSelector()
    output, error, offset = bytearray(), bytearray(), 0
    deadline = time.monotonic() + timeout_seconds
    try:
        for stream, mode, label in ((process.stdin, selectors.EVENT_WRITE, "in"),
            (process.stdout, selectors.EVENT_READ, "out"), (process.stderr, selectors.EVENT_READ, "err")):
            os.set_blocking(stream.fileno(), False); selector.register(stream, mode, label)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            require(remaining > 0, "ADAPTER_TIMEOUT")
            for key, _ in selector.select(min(remaining, .1)):
                stream, label = key.fileobj, key.data
                if label == "in":
                    try: offset += os.write(stream.fileno(), raw[offset:offset + 8192])
                    except BrokenPipeError: offset = len(raw)
                    if offset == len(raw): selector.unregister(stream); stream.close()
                else:
                    chunk = os.read(stream.fileno(), 4096)
                    if not chunk: selector.unregister(stream); stream.close(); continue
                    buffer, limit = (output, MAX_OUTPUT) if label == "out" else (error, MAX_ERROR)
                    require(len(buffer) + len(chunk) <= limit, "ADAPTER_OUTPUT_BOUND")
                    buffer.extend(chunk)
        remaining = deadline - time.monotonic()
        require(remaining > 0, "ADAPTER_TIMEOUT")
        require(process.wait(timeout=remaining) == 0, "ADAPTER_EXIT")
        require(not error, "ADAPTER_STDERR")
        result = strict_json(output.decode("utf-8"))
        require(type(result) is dict and result.get("kind") == ("EVENT_BINDING_CHECK" if preflight else "OFFLINE_CONTINUATION_DECISION"), "ADAPTER_RESULT")
        require(all(result.get(k) is False for k in ("authenticated", "provenanceVerified", "authorized", "dispatchAllowed", "mergeAllowed", "durable")), "ADAPTER_AUTHORITY")
        return result
    finally:
        selector.close()
        # A departed direct child may have descendants retaining its pipe/group.
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.wait(timeout=2)
        for stream in (process.stdin, process.stdout, process.stderr):
            if not stream.closed: stream.close()


def run_once(database, event_id, owner, payload_raw, timeout_seconds=5):
    """Consume exactly the named event once. Only the local SQLite inbox mutates."""
    require(type(payload_raw) is bytes and len(payload_raw) <= MAX_INPUT, "PAYLOAD_BOUND")
    payload = payload_raw.decode("utf-8")
    value = strict_json(payload)
    observed = inbox.inspect_event(database, event_id)
    binding = observed["binding"]
    require(hashlib.sha256(payload_raw).hexdigest() == binding["payloadSha256"], "PAYLOAD_DIGEST")
    require(value["expected"]["repository"] == binding["repository"]
        and value["expected"]["headSha"] == binding["headSha"]
        and value["expected"]["baseSha"] == binding["baseSha"], "EXPECTED_PINS")
    execute_adapter(payload, binding, timeout_seconds, preflight=True)
    claim = inbox.claim(database, event_id, owner)
    active = claim
    try:
        active = inbox.start(database, claim)
        decision = execute_adapter(payload, binding, timeout_seconds)
        result_json = json.dumps(decision, sort_keys=True, separators=(",", ":"))
        require(len(result_json.encode()) <= MAX_OUTPUT, "RESULT_BOUND")
        digest = hashlib.sha256(result_json.encode()).hexdigest()
        summary = json.dumps({"decision": decision["decision"], "reason": decision["reason"]}, separators=(",", ":"))
        settled = inbox.complete(database, active, digest, result_json=summary)
        return {"state": settled["state"], "eventId": event_id, "decision": decision,
            "persistConfirmed": True,
            "authenticated": False, "authorized": False, "provenanceVerified": False,
            "dispatchAllowed": False, "mergeAllowed": False}
    except Exception:
        failure = '{"decision":"UNKNOWN","reason":"LOCAL_WORKER_UNCERTAIN"}'
        digest = hashlib.sha256(failure.encode()).hexdigest()
        persisted = False
        try:
            inbox.unknown(database, active, digest, result_json=failure)
            persisted = True
        except Exception: pass  # STARTED/CLAIMED remains non-replayable after persistence failure.
        return {"state": "UNKNOWN" if persisted else "UNSETTLED", "eventId": event_id, "decision": None,
            "persistConfirmed": persisted,
            "authenticated": False, "authorized": False, "provenanceVerified": False,
            "dispatchAllowed": False, "mergeAllowed": False}
