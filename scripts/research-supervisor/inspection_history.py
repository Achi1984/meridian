"""Pure consistency checks for supplied synthetic inspection observations, not a store."""
import hashlib
import json
import re
from datetime import datetime

MAX_OBSERVATIONS = 256
MAX_OBSERVATION_BYTES = 16384
MAX_INPUT_BYTES = 4 * 1024 * 1024
MAX_SUMMARY_BYTES = 16384
PROFILE = "MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1"
SCHEMA = "MERIDIAN_B1_INSPECTION_REPORT_V1"
HASH = re.compile(r"[a-f0-9]{64}")
STATES = {"queued", "unknown", "completed", "rejected", "failed", "timed_out", "partial"}
TERMINAL = {"completed", "rejected", "failed", "timed_out", "partial"}
IDENTITIES = {"protocolSha256", "sourceSha256", "dataSha256", "manifestSha256", "resultSha256", "summarySha256"}
REPORT_KEYS = {"schema", "profile", "evidenceClass", "trialId", "state", "unresolved",
               "requiresExplicitReconciliation", "attempts", "fence", "fenceInterpretation",
               "integrity", "timestamps", "identities", "pathsStarted", "pathsCompleted",
               "reasonCode", "executionAuthorized", "promotionAuthorized",
               "profitabilityInferred", "recoveryPerformed"}


class HistoryError(ValueError):
    pass


def need(ok, code):
    if not ok:
        raise HistoryError(code)


def wire(value):
    # Count exact ensure_ascii JSON bytes, including escaping and punctuation,
    # before asking json.dumps to allocate the complete encoded representation.
    stack = [(value, 0)]
    seen = set()
    nodes = 0
    encoded_size = 0

    def charge(count):
        nonlocal encoded_size
        encoded_size += count
        need(encoded_size <= MAX_OBSERVATION_BYTES, "OBSERVATION_BYTES_BOUND")

    def string_size(text):
        charge(2)  # surrounding quotes
        for char in text:
            code = ord(char)
            if char in ('"', '\\', '\b', '\f', '\n', '\r', '\t'):
                charge(2)
            elif code < 32 or 127 <= code <= 65535:
                charge(6)
            elif code > 65535:
                charge(12)
            else:
                charge(1)

    while stack:
        item, depth = stack.pop()
        nodes += 1
        need(nodes <= 20000 and depth <= 16, "INPUT_STRUCTURE_BOUND")
        if type(item) in (dict, list):
            need(id(item) not in seen, "SHARED_OR_CYCLIC_INPUT")
            seen.add(id(item))
            need(len(item) <= 256, "INPUT_STRUCTURE_BOUND")
            charge(2 + max(0, len(item) - 1))
            if type(item) is dict:
                need(all(type(key) is str and len(key) <= 128 for key in item), "INPUT_KEY")
                for key in item:
                    string_size(key)
                    charge(1)  # colon
                children = item.values()
            else:
                children = item
            stack.extend((child, depth + 1) for child in children)
        else:
            need(item is None or type(item) in (str, bool, int), "INPUT_TYPE")
            if type(item) is str:
                need(len(item) <= MAX_OBSERVATION_BYTES, "INPUT_TEXT_BOUND")
                string_size(item)
            elif type(item) is int:
                need(abs(item) <= 9007199254740991, "INPUT_INTEGER_BOUND")
                charge(len(str(item)))
            else:
                charge(4 if item is None or item is True else 5)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def digest(observation):
    """Hash one supplied envelope, including sequence and predecessor; no authentication."""
    raw = wire(observation)
    need(len(raw) <= MAX_OBSERVATION_BYTES, "OBSERVATION_BYTES_BOUND")
    return hashlib.sha256(raw).hexdigest()


def _hash(value):
    return type(value) is str and HASH.fullmatch(value) is not None


def _report(value):
    need(type(value) is dict and set(value) == REPORT_KEYS, "REPORT_SCHEMA")
    need(value["schema"] == SCHEMA and value["profile"] == PROFILE and
         value["evidenceClass"] == "SYNTHETIC_ONLY", "REPORT_PROFILE")
    need(_hash(value["trialId"]), "TRIAL_ID")
    for key in ("executionAuthorized", "promotionAuthorized", "profitabilityInferred", "recoveryPerformed"):
        need(value[key] is False, "AUTHORITY_OR_RECOVERY_CLAIM")
    state, unresolved = value["state"], value["unresolved"]
    need(type(state) is str and state in STATES and type(unresolved) is bool, "STATE")
    need(value["requiresExplicitReconciliation"] is unresolved, "RECONCILIATION")
    need(not unresolved or state == "unknown", "UNRESOLVED_STATE")
    expected_fence = "UNRESOLVED_FENCE_RETAINED" if unresolved else "NO_UNRESOLVED_FENCE_FOR_THIS_TRIAL"
    need(value["fenceInterpretation"] == expected_fence, "FENCE_LABEL")
    need(value["integrity"] == "STORED_JOURNAL_VALIDATED_NOT_SOURCE_AUTHENTICITY", "INTEGRITY_LABEL")
    attempts, fence = value["attempts"], value["fence"]
    need(type(attempts) is int and attempts in (0, 1) and type(fence) is int and
         0 <= fence <= 9007199254740991, "ATTEMPT_FENCE")
    need((state in {"queued", "rejected"} and attempts == 0 and fence == 0) or
         (state not in {"queued", "rejected"} and attempts == 1 and fence > 0), "ATTEMPT_STATE")
    started, completed = value["pathsStarted"], value["pathsCompleted"]
    need(type(started) is int and type(completed) is int and 0 <= completed <= started <= 44
         and started - completed <= 1, "PATH_COUNTS")
    need(state not in {"queued", "rejected"} or started == 0, "PATH_STATE")
    ids = value["identities"]
    need(type(ids) is dict and set(ids) == IDENTITIES, "IDENTITIES")
    for key, item in ids.items():
        need(_hash(item) or (item is None and key in {"resultSha256", "summarySha256"}), "IDENTITY_HASH")
    need(state != "completed" or (completed == 44 and _hash(ids["resultSha256"]) and
                                  _hash(ids["summarySha256"])), "COMPLETION_EVIDENCE")
    need(state not in {"queued", "rejected"} and not unresolved or
         (ids["resultSha256"] is None and ids["summarySha256"] is None), "EARLY_RESULT")
    stamps = value["timestamps"]
    need(type(stamps) is dict and set(stamps) == {"createdAt", "startedAt", "finishedAt"}, "TIMESTAMPS")
    parsed = {}
    for key, item in stamps.items():
        if item is None:
            parsed[key] = None
            continue
        need(type(item) is str and re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)", item), "TIMESTAMP")
        try:
            parsed[key] = datetime.fromisoformat(item.replace("Z", "+00:00"))
        except ValueError:
            raise HistoryError("TIMESTAMP") from None
    created, began, finished = (parsed[key] for key in ("createdAt", "startedAt", "finishedAt"))
    need(created is not None, "CREATED_TIMESTAMP")
    need(began is None or created <= began, "TIMESTAMP_ORDER")
    need(finished is None or (created <= finished and (began is None or began <= finished)), "TIMESTAMP_ORDER")
    if state == "queued":
        need(began is None and finished is None, "TIMESTAMP_STATE")
    elif state == "rejected":
        need(began is None and finished is not None, "TIMESTAMP_STATE")
    elif state == "unknown":
        need((unresolved and finished is None) or (not unresolved and finished is not None), "TIMESTAMP_STATE")
        need(started == 0 or began is not None, "TIMESTAMP_STATE")
    elif state == "completed":
        need(began is not None and finished is not None, "TIMESTAMP_STATE")
    else:
        # A consumed CLAIMED job may settle before RUNNING; it has no paths.
        need(finished is not None and (began is not None or started == 0), "TIMESTAMP_STATE")
    need((ids["resultSha256"] is None) == (ids["summarySha256"] is None), "RESULT_HASH_PAIR")
    reason = value["reasonCode"]
    need(reason is None or (type(reason) is str and re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", reason)), "REASON")


def _history(observations):
    need(type(observations) is list and len(observations) <= MAX_OBSERVATIONS, "OBSERVATION_COUNT")
    unique, by_id, total = [], {}, 0
    prior = None
    for entry in observations:
        raw = wire(entry)
        total += len(raw)
        need(len(raw) <= MAX_OBSERVATION_BYTES and total <= MAX_INPUT_BYTES, "INPUT_BYTES_BOUND")
        need(type(entry) is dict and set(entry) == {"observationId", "sequence", "previousSha256", "report"}, "ENVELOPE")
        identifier = entry["observationId"]
        need(type(identifier) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", identifier), "OBSERVATION_ID")
        if identifier in by_id:
            need(by_id[identifier] == raw, "CONFLICTING_OBSERVATION_ID")
            continue
        need(type(entry["sequence"]) is int and entry["sequence"] == len(unique) + 1, "SEQUENCE")
        expected = hashlib.sha256(unique[-1]).hexdigest() if unique else None
        need(entry["previousSha256"] == expected, "PREDECESSOR")
        value = entry["report"]
        _report(value)
        if prior is not None:
            need(value["trialId"] == prior["trialId"] and all(
                value["identities"][key] == prior["identities"][key] for key in
                ("protocolSha256", "sourceSha256", "dataSha256", "manifestSha256")), "IDENTITY_CONFLICT")
            need(value["attempts"] >= prior["attempts"], "ATTEMPT_REGRESSION")
            if prior["attempts"] == 1:
                need(value["fence"] == prior["fence"], "FENCE_CONFLICT")
            need(value["pathsStarted"] >= prior["pathsStarted"] and
                 value["pathsCompleted"] >= prior["pathsCompleted"], "PROGRESS_REGRESSION")
            if prior["state"] in TERMINAL or (prior["state"] == "unknown" and not prior["unresolved"]):
                need(wire(value) == wire(prior), "TERMINAL_REWRITE")
            need(value["timestamps"]["createdAt"] == prior["timestamps"]["createdAt"], "CREATION_CONFLICT")
        unique.append(raw)
        by_id[identifier] = raw
        prior = value
    return unique, prior, len(observations) - len(unique), total


def summarize(observations, previous=None):
    """Validate a supplied append-only extension; no persistence or recovery action."""
    # Enforce combined supplied-input budget before chain/state analysis.
    input_size = 0
    for supplied in ([observations] if previous is None else [observations, previous]):
        need(type(supplied) is list and len(supplied) <= MAX_OBSERVATIONS, "OBSERVATION_COUNT")
        for entry in supplied:
            entry_size = len(wire(entry))
            input_size += entry_size
            need(entry_size <= MAX_OBSERVATION_BYTES and input_size <= MAX_INPUT_BYTES, "INPUT_BYTES_BOUND")
    unique, latest, duplicates, size = _history(observations)
    if previous is not None:
        old, _, _, old_size = _history(previous)
        need(size + old_size <= MAX_INPUT_BYTES, "INPUT_BYTES_BOUND")
        need(len(unique) >= len(old) and unique[:len(old)] == old, "PREFIX_CHANGED")
    action = "INSPECT_ONLY"
    if latest:
        if latest["unresolved"]:
            action = "EXPLICIT_RECONCILIATION_REQUIRED"
        elif latest["state"] != "queued":
            action = "TERMINAL_NO_RETRY"
    result = {
        "schema": "MERIDIAN_B1_INSPECTION_HISTORY_V1", "status": "CONSISTENT_SUPPLIED_OBSERVATIONS",
        "observationCount": len(unique), "duplicateObservationCount": duplicates,
        "lastObservationSha256": hashlib.sha256(unique[-1]).hexdigest() if unique else None,
        "trialId": latest["trialId"] if latest else None,
        "state": latest["state"] if latest else "NO_OBSERVATIONS",
        "unresolved": latest["unresolved"] if latest else None,
        "attempts": latest["attempts"] if latest else None, "fence": latest["fence"] if latest else None,
        "guidance": action, "evidenceClass": "SYNTHETIC_ONLY",
        "durableStorageEstablished": False, "authenticityEstablished": False,
        "completenessCertified": False, "remainingExecutionBudget": "UNKNOWN",
        "executionAuthorized": False, "promotionAuthorized": False, "recoveryPerformed": False,
    }
    need(len(wire(result)) <= MAX_SUMMARY_BYTES, "SUMMARY_BOUND")
    return result
