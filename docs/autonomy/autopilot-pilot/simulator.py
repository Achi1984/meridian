"""Pure offline gate simulation; this module has no GitHub or dispatch client."""


def _result(status, reason):
    return {"status": status, "reason": reason}


def simulate_transition(proposal, state, event, now_epoch):
    if type(proposal) is not dict or proposal.get("enabled") is not True:
        return _result("NOOP", "PILOT_DISABLED")
    if type(now_epoch) is not int or now_epoch < 0:
        return _result("BLOCKED", "INVALID_TIME")

    start = proposal.get("window_start_epoch")
    end = proposal.get("window_end_epoch")
    max_window = proposal.get("max_window_seconds")
    if (type(start) is not int or type(end) is not int
            or type(max_window) is not int or max_window != 86400
            or end <= start or end - start > max_window):
        return _result("BLOCKED", "WINDOW_UNSET_OR_INVALID")
    if now_epoch < start:
        return _result("NOOP", "WINDOW_NOT_STARTED")
    if now_epoch >= end:
        return _result("BLOCKED", "WINDOW_EXPIRED")
    if type(state) is not dict or type(event) is not dict:
        return _result("BLOCKED", "INVALID_EVENT_OR_STATE")
    if (proposal.get("repository") != "Achi1984/meridian"
            or type(proposal.get("allowed_targets")) is not list
            or event.get("repository") != proposal["repository"]
            or type(event.get("target")) is not int
            or event["target"] not in proposal["allowed_targets"]):
        return _result("BLOCKED", "SCOPE_MISMATCH")

    head = event.get("head_sha")
    base = event.get("base_sha")
    phase = event.get("phase")
    event_id = event.get("event_id")
    sequence = event.get("sequence")
    agent_id = event.get("agent_id")
    if (type(head) is not str or len(head) != 40
            or any(c not in "0123456789abcdef" for c in head)
            or type(base) is not str or len(base) != 40
            or any(c not in "0123456789abcdef" for c in base)
            or type(phase) is not str or not phase
            or type(event_id) is not str or not event_id
            or type(sequence) is not int or sequence < 1
            or type(agent_id) is not str or not agent_id):
        return _result("BLOCKED", "INVALID_EVENT")

    event_key = (proposal["repository"], event["target"], head, phase)
    processed = state.get("processed_keys", [])
    if type(processed) is not list:
        return _result("BLOCKED", "INVALID_LEDGER")
    if list(event_key) in processed:
        return _result("NOOP", "DUPLICATE_EVENT")
    last_sequence = state.get("last_sequence")
    if type(last_sequence) is not int or last_sequence < 0:
        return _result("BLOCKED", "INVALID_LEDGER")
    if sequence <= last_sequence:
        return _result("NOOP", "OUT_OF_ORDER_EVENT")

    if (type(state.get("active_packet_count")) is not int
            or state["active_packet_count"] < 0
            or state["active_packet_count"] > proposal.get("max_active_packets", 0)):
        return _result("BLOCKED", "ACTIVE_PACKET_LIMIT")
    if (event["target"] != state.get("target")
            or head != state.get("head_sha") or base != state.get("base_sha")):
        return _result("BLOCKED", "HEAD_OR_BASE_DRIFT")
    if (state.get("activation_approved") is not True
            or proposal.get("activation_owner_approval") is not True):
        return _result("BLOCKED", "ACTIVATION_APPROVAL_MISSING")

    writer = state.get("active_writer")
    if writer is not None and writer != agent_id:
        return _result("BLOCKED", "CONFLICTING_WRITER")
    operation = state.get("operation")
    if type(operation) is not dict:
        return _result("BLOCKED", "INVALID_OPERATION")
    if operation.get("intent") is not None:
        result = operation.get("result")
        if result in (None, "UNKNOWN", "PARTIAL"):
            return _result("BLOCKED", "UNKNOWN_OPERATION_OUTCOME")
        if result == "APPLIED":
            return _result("NOOP", "OPERATION_ALREADY_APPLIED")

    ci = state.get("ci")
    if (type(ci) is not dict or ci.get("conclusion") != "success"
            or ci.get("head_sha") != head or ci.get("base_sha") != base):
        return _result("BLOCKED", "EXACT_HEAD_CI_NOT_SUCCESS")
    review = state.get("review")
    if (type(review) is not dict or review.get("verdict") != "GREEN_LIGHT"
            or review.get("head_sha") != head or review.get("base_sha") != base
            or review.get("complete") is not True
            or review.get("gaps") != []
            or review.get("self_reported_gap") is not False):
        return _result("BLOCKED", "REVIEW_INCOMPLETE_OR_STALE")

    if proposal.get("agent_dispatch_supported") is not True:
        return _result("BLOCKED", "DISPATCH_UNSUPPORTED")
    return _result("BLOCKED", "NO_MUTATION_IMPLEMENTED")
