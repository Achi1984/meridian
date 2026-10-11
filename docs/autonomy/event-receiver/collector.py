"""Read-only native GitHub event reconciliation. No worker dispatch or authority."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

REPO = "Achi1984/meridian"
REPO_ID = 1342084551
WORKFLOWS = {
    347821227: ("MERIDIAN Release Safety", ".github/workflows/backend-safety.yml"),
    375606132: ("MERIDIAN Claude Mailbox Review", ".github/workflows/claude-mailbox-review.yml"),
}
MAX_BYTES = 524288
MAX_RECEIPT = 4096
SHA = re.compile(r"[0-9a-f]{40}\Z")


class Rejected(ValueError):
    pass


def need(value, code):
    if not value:
        raise Rejected(code)


def integer(value):
    return type(value) is int and value > 0


def sha(value):
    return type(value) is str and SHA.fullmatch(value) is not None


def obj(value):
    need(type(value) is dict, "OBJECT_REQUIRED")
    return value


def repository(value):
    value = obj(value)
    need(value.get("full_name") == REPO and value.get("id") == REPO_ID
         and value.get("fork") is False, "REPOSITORY_SCOPE")


def decode(data):
    need(type(data) is bytes and len(data) <= MAX_BYTES, "RESPONSE_SIZE")
    def pairs(rows):
        out = {}
        for key, value in rows:
            need(key not in out, "DUPLICATE_KEY")
            out[key] = value
        return out
    try:
        return json.loads(data, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(Rejected("NONFINITE")))
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise Rejected("INVALID_JSON") from error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class GitHub:
    """GET only, fixed API host/repository, bounded reads, redirects rejected."""
    def __init__(self, token):
        need(type(token) is str and bool(token), "TOKEN_REQUIRED")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def __call__(self, path):
        need(re.fullmatch(r"(?:commits/main|pulls/[1-9][0-9]*|actions/runs/[1-9][0-9]*|issues/571|issues/comments/[1-9][0-9]*)", path) is not None,
             "API_PATH")
        request = urllib.request.Request("https://api.github.com/repos/" + REPO + "/" + path,
            headers={"Authorization": "Bearer " + self.token,
                     "Accept": "application/vnd.github+json", "User-Agent": "meridian-readonly-reconcile",
                     "X-GitHub-Api-Version": "2022-11-28"}, method="GET")
        try:
            with self.opener.open(request, timeout=15) as response:
                need(response.status == 200, "API_STATUS")
                return obj(decode(response.read(MAX_BYTES + 1)))
        except (OSError, urllib.error.URLError) as error:
            raise Rejected("API_READ_FAILED") from error


def reconcile(event_name, payload, control_sha, api):
    """Event payloads are hints; fresh API reads supply the bounded receipt."""
    payload = obj(payload)
    repository(payload.get("repository"))
    need(sha(control_sha), "CONTROL_SHA")
    main = obj(api("commits/main")).get("sha")
    need(main == control_sha, "CONTROL_NOT_CURRENT_MAIN")
    receipt = {"schema": 1, "kind": "MERIDIAN_READ_ONLY_EVENT_RECEIPT", "repository": REPO,
        "controlSha": control_sha, "mainSha": main, "event": event_name,
        "authority": "NONE", "dispatchAllowed": False, "mergeAllowed": False,
        "durableDeduplication": False, "leaseAcquired": False,
        "nextBoundary": "AUTHENTICATED_EVIDENCE_ADAPTER_AND_DURABLE_FENCED_WORKER_REQUIRED"}
    if event_name == "workflow_run":
        need(payload.get("action") == "completed", "EVENT_ACTION")
        hint = obj(payload.get("workflow_run"))
        run_id = hint.get("id")
        need(integer(run_id), "RUN_ID")
        run = obj(api("actions/runs/" + str(run_id)))
        need(run.get("id") == run_id, "RUN_IDENTITY")
        repository(run.get("repository"))
        repository(run.get("head_repository"))
        workflow_id = run.get("workflow_id")
        need(type(workflow_id) is int and workflow_id in WORKFLOWS, "WORKFLOW_SCOPE")
        name, path = WORKFLOWS[workflow_id]
        need(run.get("name") == name and run.get("path") == path, "WORKFLOW_IDENTITY")
        need(run.get("status") == "completed" and run.get("conclusion") in
             ("success", "failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale"), "RUN_TERMINAL")
        attempt, head = run.get("run_attempt"), run.get("head_sha")
        need(integer(attempt) and sha(head), "RUN_FIELDS")
        need(hint.get("run_attempt") == attempt and hint.get("head_sha") == head
             and hint.get("workflow_id") == workflow_id, "STALE_EVENT")
        source_event = run.get("event")
        source = {"runId": run_id, "attempt": attempt, "workflowId": workflow_id,
                  "headSha": head, "conclusion": run["conclusion"], "sourceEvent": source_event}
        if workflow_id == 375606132:
            need(source_event == "issue_comment" and head == main, "CLAUDE_SOURCE_SCOPE")
            # A run does not identify which comment was finally edited. Do not guess
            # from a latest-comment list or treat workflow success as a GREEN review.
            source["mailboxIssue"] = 571
            source["reviewEvidence"] = "NOT_COLLECTED_REQUEST_COMMENT_BINDING_REQUIRED"
        elif source_event == "pull_request":
            prs = run.get("pull_requests")
            need(type(prs) is list and len(prs) == 1, "PR_ASSOCIATION")
            number = obj(prs[0]).get("number")
            need(integer(number), "PR_NUMBER")
            pr = obj(api("pulls/" + str(number)))
            need(pr.get("number") == number and pr.get("state") == "open", "PR_NOT_OPEN")
            ph, pb = obj(pr.get("head")), obj(pr.get("base"))
            repository(ph.get("repo")); repository(pb.get("repo"))
            need(ph.get("sha") == head and pb.get("sha") == main and pb.get("ref") == "main", "STALE_PR")
            source.update({"prNumber": number, "baseSha": main})
        else:
            need(source_event == "push" and head == main and run.get("head_branch") == "main", "PUSH_SCOPE")
        receipt["source"] = source
    elif event_name == "issue_comment":
        need(payload.get("action") in ("created", "edited"), "EVENT_ACTION")
        issue = obj(payload.get("issue"))
        need(issue.get("number") == 571 and "pull_request" not in issue, "MAILBOX_SCOPE")
        comment_id = obj(payload.get("comment")).get("id")
        need(integer(comment_id), "COMMENT_ID")
        current_issue = obj(api("issues/571"))
        need(current_issue.get("number") == 571 and "pull_request" not in current_issue, "MAILBOX_IDENTITY")
        comment = obj(api("issues/comments/" + str(comment_id)))
        need(comment.get("id") == comment_id and comment.get("issue_url") ==
             "https://api.github.com/repos/" + REPO + "/issues/571", "COMMENT_SCOPE")
        user = obj(comment.get("user"))
        need(user.get("login") in ("Achi1984", "claude[bot]"), "COMMENT_ACTOR")
        updated = comment.get("updated_at")
        need(type(updated) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", updated), "COMMENT_REVISION")
        need(obj(payload["comment"]).get("updated_at") == updated, "STALE_COMMENT_EVENT")
        receipt["source"] = {"mailboxIssue": 571, "commentId": comment_id,
            "updatedAt": updated, "author": user["login"], "bodyCollected": False,
            "reviewEvidence": "NOT_COLLECTED_REQUEST_COMMENT_BINDING_REQUIRED"}
    else:
        raise Rejected("EVENT_UNSUPPORTED")
    need(obj(api("commits/main")).get("sha") == main, "MAIN_MOVED")
    need(len(json.dumps(receipt).encode()) <= MAX_RECEIPT, "RECEIPT_SIZE")
    return receipt


def main():
    # This CLI writes only its local receipt file. No GitHub mutations or raw output.
    output = Path(os.environ["RECEIPT_PATH"])
    need(not output.exists(), "OUTPUT_EXISTS")
    with open(os.environ["GITHUB_EVENT_PATH"], "rb") as stream:
        payload = decode(stream.read(MAX_BYTES + 1))
    receipt = reconcile(os.environ["GITHUB_EVENT_NAME"], payload, os.environ["GITHUB_SHA"], GitHub(os.environ["GH_TOKEN"]))
    with output.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, sort_keys=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never echo API bodies, credentials, event comments or exception contents.
        raise SystemExit("Read-only reconciliation rejected; no receipt produced")
