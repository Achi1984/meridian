"""Source-only exact-comment handoff to the existing structured review binder.

Not invoked by receiver.yml. Inputs/callables alone never authenticate evidence.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
from collector import REPO, WORKFLOWS, Rejected, decode, integer, need, obj, repository, run_pr_binding, sha

ACTOR = {"id": 209825114, "login": "claude[bot]", "type": "Bot"}


def load_binder(path=None):
    # Optional path exists solely for isolated local staging; never from event data.
    path = path or Path(__file__).resolve().parent.parent / "event-adapter/review-binding/scripts/review-evidence-binding.py"
    spec = importlib.util.spec_from_file_location("meridian_review_binder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.bind_review


def project_comment(raw, expected):
    raw = obj(raw)
    need(raw.get("id") == expected["version"]["commentId"] and integer(raw.get("id")), "COMMENT_IDENTITY")
    need(raw.get("issue_url") == "https://api.github.com/repos/" + REPO + "/issues/571", "COMMENT_MAILBOX")
    user = obj(raw.get("user"))
    actor = {key: user.get(key) for key in ("id", "login", "type")}
    need(actor == ACTOR and integer(actor["id"]), "COMMENT_ACTOR")
    body = raw.get("body")
    need(type(body) is str and len(body.encode("utf-8")) <= 16384, "COMMENT_BODY_BOUND")
    return {"id": raw["id"], "user": actor, "created_at": raw.get("created_at"),
            "updated_at": raw.get("updated_at"), "body": body}


def check_pr(api, scope, main_sha):
    pr = obj(api("pulls/" + str(scope["prNumber"])))
    need(integer(pr.get("number")) and pr.get("number") == scope["prNumber"]
         and pr.get("state") == "open", "PR_NOT_OPEN")
    head, base = obj(pr.get("head")), obj(pr.get("base"))
    repository(head.get("repo")); repository(base.get("repo"))
    need(head.get("sha") == scope["headSha"] and base.get("sha") == scope["baseSha"] == main_sha
         and base.get("ref") == "main", "PR_SCOPE_CHANGED")


def check_ci(api, scope):
    ci = scope["ci"]
    run = obj(api("actions/runs/" + str(ci["runId"])))
    repository(run.get("repository")); repository(run.get("head_repository"))
    need(integer(run.get("id")) and integer(run.get("run_attempt")) and integer(run.get("workflow_id")) and
         run.get("id") == ci["runId"] and run.get("run_attempt") == ci["runAttempt"]
         and run.get("workflow_id") == ci["workflowId"] and run.get("head_sha") == ci["headSha"], "CI_SCOPE_CHANGED")
    name, path = WORKFLOWS[347821227]
    need(run.get("name") == name and run.get("path") == path and run.get("event") == "pull_request"
         and run.get("status") == "completed" and run.get("conclusion") == "success", "CI_NOT_CURRENT_SUCCESS")
    need(run_pr_binding(run, "CI_PR_ASSOCIATION") ==
         (scope["prNumber"], scope["headSha"], scope["baseSha"], "main"), "CI_PR_ASSOCIATION")


def collect_review(expected_raw, main_sha, event_action, api, bind_review):
    """GET-only collection; bind exact independently supplied pins; never emit body."""
    blocked = {"kind": "UNVERIFIED_REVIEW_HANDOFF", "decision": "BLOCKED", "reason": "HANDOFF_INVALID",
        "plannerResponse": None, "version": None, "reviewBinding": None, "authenticated": False, "provenanceVerified": False,
        "authorized": False, "dispatchAllowed": False, "mergeAllowed": False, "durable": False}
    try:
        need(type(expected_raw) is str and len(expected_raw.encode()) <= 16384, "EXPECTED_BOUND")
        expected = obj(decode(expected_raw.encode()))
        need(set(expected) == {"scope", "actor", "version", "issueNumber", "reviewerFamily"}, "EXPECTED_SCHEMA")
        need(expected["actor"] == ACTOR and type(expected["actor"].get("id")) is int
             and expected["issueNumber"] == 571 and type(expected["issueNumber"]) is int
             and expected["reviewerFamily"] == "claude", "EXPECTED_ACTOR_MAILBOX")
        scope = obj(expected["scope"]); ci = obj(scope.get("ci")); version = obj(expected["version"])
        need(scope.get("repository") == REPO and integer(scope.get("prNumber")) and sha(main_sha)
             and sha(scope.get("headSha")) and scope.get("baseSha") == main_sha
             and scope["headSha"] != main_sha, "EXPECTED_SCOPE")
        need(integer(ci.get("runId")) and integer(ci.get("runAttempt")) and ci.get("workflowId") == 347821227
             and ci.get("headSha") == scope["headSha"] and integer(version.get("commentId")), "EXPECTED_CI")
        need(event_action in ("created", "edited"), "COMMENT_EVENT_DELETED_OR_UNSUPPORTED")
        need(obj(api("commits/main")).get("sha") == main_sha, "MAIN_CHANGED")
        issue = obj(api("issues/571"))
        need(issue.get("number") == 571 and "pull_request" not in issue, "MAILBOX_IDENTITY")
        check_pr(api, scope, main_sha); check_ci(api, scope)
        path = "issues/comments/" + str(version["commentId"])
        first = project_comment(api(path), expected)
        observation = {"repository": REPO, "issueNumber": 571, "eventAction": event_action, "comment": first}
        result = bind_review(json.dumps(observation, separators=(",", ":")), expected_raw)
        need(type(result) is dict and all(result.get(key) is False for key in
             ("authenticated", "provenanceVerified", "authorized", "dispatchAllowed", "mergeAllowed", "durable")), "BINDER_AUTHORITY")
        # Do not retain a candidate if the comment changed/deleted while binding.
        second = project_comment(api(path), expected)
        need(second == first, "COMMENT_CHANGED_DURING_BINDING")
        check_pr(api, scope, main_sha); check_ci(api, scope)
        need(obj(api("commits/main")).get("sha") == main_sha, "MAIN_CHANGED")
        # Explicit allowlisted projection only; neither raw inputs nor helper diagnostics.
        receipt = {**blocked, "decision": result["decision"], "reason": result["reason"],
                   "plannerResponse": result.get("plannerResponse"), "version": result.get("version"),
                   "reviewBinding": result.get("reviewBinding")}
        need(len(json.dumps(receipt).encode()) <= 4096, "HANDOFF_RECEIPT_BOUND")
        return receipt
    except Exception:
        # Deletion/404/transport and malformed data share a bounded safe stop;
        # exception text can contain network bodies or credentials, so never emit it.
        return blocked

