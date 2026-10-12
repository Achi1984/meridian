"""Source-only observation of one pinned native review; never review authority."""
import hashlib
import re
from collector import REPO, decode, need, obj, sha
from review_handoff import check_pr, check_ci

ACTOR = {"id": 175728472, "login": "copilot-pull-request-reviewer[bot]", "type": "Bot"}


def positive_id(value):
    return type(value) is int and 0 < value < 2**63


def observe_native_review(expected_raw, api):
    """api is an injected GET-only reader, not an authenticated transport claim.

    Independent pins are mandatory. No CLI, network client or runtime wiring.
    Even a matching approval lacks complete review/thread/executed-check evidence.
    """
    result = dict(status="BLOCKED", reason="INVALID_OR_CHANGED_EVIDENCE",
                  authenticated=False, provenanceVerified=False, authorized=False,
                  dispatchAllowed=False, mergeAllowed=False, durable=False,
                  fullReviewEvidence=False, plannerResponse=None, observation=None)
    try:
        need(type(expected_raw) is bytes and len(expected_raw) <= 16384, "INPUT")
        expected = obj(decode(expected_raw))
        need(set(expected) == {"scope", "review"}, "INPUT")
        scope, review = obj(expected["scope"]), obj(expected["review"])
        need(set(scope) == {"prNumber", "headSha", "baseSha", "ci"}, "INPUT")
        need(positive_id(scope["prNumber"]) and sha(scope["headSha"]) and sha(scope["baseSha"]), "INPUT")
        ci = obj(scope["ci"])
        need(set(ci) == {"runId", "runAttempt", "workflowId", "headSha"}, "INPUT")
        need(all(positive_id(ci[k]) for k in ("runId", "runAttempt", "workflowId")), "INPUT")
        need(ci["workflowId"] == 347821227 and ci["headSha"] == scope["headSha"], "INPUT")
        need(set(review) == {"id", "submittedAt", "bodySha256"}, "INPUT")
        need(positive_id(review["id"]), "INPUT")
        need(type(review["submittedAt"]) is str and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", review["submittedAt"]), "INPUT")
        need(type(review["bodySha256"]) is str and re.fullmatch("[0-9a-f]{64}", review["bodySha256"]), "INPUT")
        path = "pulls/" + str(scope["prNumber"]) + "/reviews/" + str(review["id"])

        def check_run(path):
            raw = obj(api(path))
            association = obj(raw.get("pull_requests", [])[0])
            need(obj(association.get("head")).get("sha") == scope["headSha"], "CI_HEAD")
            base = obj(association.get("base"))
            need(base.get("sha") == scope["baseSha"] and base.get("ref") == "main", "CI_BASE")
            return raw

        def read_review():
            raw = obj(api(path))
            need(type(raw.get("id")) is int and raw["id"] == review["id"], "REVIEW_ID")
            user = obj(raw.get("user"))
            need(type(user.get("id")) is int and {k: user.get(k) for k in ACTOR} == ACTOR, "ACTOR")
            need(raw.get("pull_request_url") == "https://api.github.com/repos/" + REPO + "/pulls/" + str(scope["prNumber"]), "REVIEW_PR")
            need(raw.get("commit_id") == scope["headSha"] and raw.get("state") == "APPROVED", "REVIEW_STATE")
            need(raw.get("submitted_at") == review["submittedAt"], "REVIEW_VERSION")
            body = raw.get("body")
            need(type(body) is str and len(body.encode("utf-8")) <= 16384, "BODY")
            need(hashlib.sha256(body.encode("utf-8")).hexdigest() == review["bodySha256"], "BODY")

        for _ in range(2):
            need(obj(api("commits/main")).get("sha") == scope["baseSha"], "MAIN")
            check_pr(api, scope, scope["baseSha"])
            check_ci(check_run, scope)
            read_review()
        need(obj(api("commits/main")).get("sha") == scope["baseSha"], "MAIN")
        result.update(status="OBSERVED_APPROVAL_INCOMPLETE", reason="FULL_REVIEW_EVIDENCE_MISSING",
                      observation={"scope": scope, "review": review, "actor": dict(ACTOR)})
    except Exception:
        # No bodies, exception strings, caller keys or transport details escape.
        pass
    return result
