"""Read-only native GitHub event reconciliation. No worker dispatch or authority."""
import json
import os
import re
import urllib.error
import urllib.request
import urllib.parse
import hashlib
from pathlib import Path

REPO = "Achi1984/meridian"
REPO_ID = 1342084551
WORKFLOWS = {
    347821227: ("MERIDIAN Release Safety", ".github/workflows/backend-safety.yml"),
    375606132: ("MERIDIAN Claude Mailbox Review", ".github/workflows/claude-mailbox-review.yml"),
}
MAX_BYTES = 524288
MAX_RECEIPT = 4096
MAX_LOG = 8 * 1024 * 1024
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
        need(re.fullmatch(r"(?:commits/main|pulls/[1-9][0-9]*|actions/runs/[1-9][0-9]*|actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*/jobs\?per_page=50&page=[1-3]|issues/571|issues/comments/[1-9][0-9]*)", path) is not None,
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

    def job_log(self, job_id):
        need(integer(job_id), "JOB_ID")
        request = urllib.request.Request("https://api.github.com/repos/" + REPO + "/actions/jobs/" + str(job_id) + "/logs",
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
                     "User-Agent": "meridian-readonly-reconcile"}, method="GET")
        try:
            try:
                response = self.opener.open(request, timeout=15)
            except urllib.error.HTTPError as error:
                need(error.code == 302, "LOG_API_STATUS")
                location = error.headers.get("Location", "")
                error.close()
                destination = urllib.parse.urlsplit(location)
                host = destination.hostname or ""
                need(destination.scheme == "https" and destination.port in (None, 443)
                     and not destination.username and not destination.password and not destination.fragment
                     and (host.endswith(".blob.core.windows.net") or host.endswith(".githubusercontent.com")), "LOG_REDIRECT_HOST")
                # Signed storage request is deliberately rebuilt without GitHub credentials.
                response = self.opener.open(urllib.request.Request(location,
                    headers={"User-Agent": "meridian-readonly-reconcile"}, method="GET"), timeout=15)
            with response:
                need(response.status == 200, "LOG_STATUS")
                raw = response.read(MAX_LOG + 1)
                need(len(raw) <= MAX_LOG, "LOG_SIZE")
                return raw
        except (OSError, urllib.error.URLError, ValueError) as error:
            raise Rejected("LOG_READ_FAILED") from error


def parse_tap_summary(raw):
    """Parse reported counters, not proof against malicious test-output forgery."""
    need(type(raw) is bytes and len(raw) <= MAX_LOG, "LOG_SIZE")
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeError as error:
        raise Rejected("LOG_ENCODING") from error
    prefix = r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z "
    starts = [i for i, line in enumerate(lines) if re.fullmatch(prefix + r"##\[group\]Run node --test test/\*\.test\.js", line)]
    need(len(starts) == 1, "TEST_STEP_AMBIGUOUS")
    start = starts[0] + 1
    ends = [i for i in range(start, len(lines)) if re.match(prefix + r"##\[group\]Run ", lines[i])]
    need(bool(ends), "TEST_STEP_UNBOUNDED")
    rows = {}
    for line in lines[start:ends[0]]:
        match = re.fullmatch(prefix + r"# (tests|pass|fail|cancelled|skipped|todo) ([0-9]+)", line)
        if match:
            key, count = match.groups()
            need(key not in rows and len(count) <= 9, "TOTALS_AMBIGUOUS")
            rows[key] = int(count)
    need(set(rows) == {"tests", "pass", "fail", "cancelled", "skipped", "todo"}, "TOTALS_MISSING")
    need(rows["tests"] > 0 and rows["pass"] == rows["tests"] and
         all(rows[k] == 0 for k in ("fail", "cancelled", "skipped", "todo")), "TOTALS_NOT_ALL_PASS")
    return {"total": rows["tests"], "passed": rows["pass"], "failed": rows["fail"],
            "cancelled": rows["cancelled"], "skipped": rows["skipped"], "todo": rows["todo"]}


def ci_evidence(api, run):
    run_id, attempt, head = run["id"], run["run_attempt"], run["head_sha"]
    jobs, count = [], None
    for page in range(1, 4):
        data = obj(api(f"actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=50&page={page}"))
        total, batch = data.get("total_count"), data.get("jobs")
        need(type(total) is int and 1 <= total <= 128 and type(batch) is list, "JOB_PAGE_SCHEMA")
        if count is None: count = total
        need(total == count and len(batch) == min(50, count-len(jobs)), "JOB_PAGE_PARTIAL")
        jobs.extend(batch)
        if len(jobs) == count: break
    need(len(jobs) == count, "JOB_PAGE_INCOMPLETE")
    ids = set()
    for job in jobs:
        obj(job)
        need(integer(job.get("id")) and job["id"] not in ids, "JOB_DUPLICATE")
        ids.add(job["id"])
        need(integer(job.get("run_id")) and integer(job.get("run_attempt"))
             and job.get("run_id") == run_id and job.get("run_attempt") == attempt
             and job.get("head_sha") == head, "JOB_SCOPE")
    targets = [j for j in jobs if j.get("name") == "syntax"]
    need(len(targets) == 1, "REQUIRED_JOB_AMBIGUOUS")
    job = targets[0]
    need(job.get("status") == "completed" and job.get("conclusion") == "success", "REQUIRED_JOB_NOT_SUCCESS")
    steps = job.get("steps")
    need(type(steps) is list and len(steps) <= 128, "STEPS_SCHEMA")
    selected = [obj(s) for s in steps if obj(s).get("name") == "Research and auth regression tests"]
    need(len(selected) == 1 and selected[0].get("status") == "completed"
         and selected[0].get("conclusion") == "success" and integer(selected[0].get("number")), "TEST_STEP_IDENTITY")
    raw = api.job_log(job["id"])
    counters = parse_tap_summary(raw)
    # Re-read after log transport: a rerun must not substitute newer attempt evidence.
    fresh = obj(api("actions/runs/" + str(run_id)))
    need(all(fresh.get(k) == run.get(k) for k in ("id", "run_attempt", "head_sha", "workflow_id", "status", "conclusion")), "RUN_MOVED")
    return {"runId": run_id, "runAttempt": attempt, "workflowId": run["workflow_id"], "headSha": head,
        "completeJobPagination": True, "jobCount": len(jobs),
        "jobs": [{"id": job["id"], "name": "syntax", "status": "completed", "conclusion": "success", **counters}],
        "logSha256": hashlib.sha256(raw).hexdigest(), "evidenceClass": "JOB_LOG_REPORTED_COUNTERS",
        "authenticated": False, "provenanceVerified": False,
        "testOutputForgeryExcluded": False, "dispatchAllowed": False, "mergeAllowed": False}


def adapter_ci_fields(evidence, base_sha):
    """Project collected reported counts into the existing adapter's exact shape."""
    need(sha(base_sha), "ADAPTER_BASE")
    obj(evidence)
    need(evidence.get("evidenceClass") == "JOB_LOG_REPORTED_COUNTERS"
         and evidence.get("completeJobPagination") is True
         and evidence.get("authenticated") is False and evidence.get("provenanceVerified") is False
         and evidence.get("dispatchAllowed") is False and evidence.get("mergeAllowed") is False,
         "ADAPTER_EVIDENCE")
    need(integer(evidence.get("runId")) and integer(evidence.get("runAttempt"))
         and evidence.get("workflowId") == 347821227 and sha(evidence.get("headSha")), "ADAPTER_SCOPE")
    jobs = evidence.get("jobs")
    need(type(jobs) is list and len(jobs) == 1, "ADAPTER_JOBS")
    for job in jobs:
        obj(job)
        need(job.get("name") == "syntax" and job.get("status") == "completed" and job.get("conclusion") == "success"
             and integer(job.get("total")) and type(job.get("passed")) is int and job["passed"] == job["total"]
             and all(type(job.get(k)) is int and job[k] == 0 for k in ("failed", "cancelled", "skipped", "todo")), "ADAPTER_COUNTERS")
    return {"workCi": {"headSha": evidence["headSha"], "baseSha": base_sha,
        "runId": evidence["runId"], "jobs": [{"name": job["name"], "conclusion": "SUCCESS",
        "total": job["total"], "passed": job["passed"], "failed": job["failed"]} for job in evidence["jobs"]]},
        "ciBinding": {key: evidence[key] for key in ("runId", "runAttempt", "workflowId", "headSha")}}


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
             ("success", "failure", "cancelled", "timed_out", "skipped", "neutral", "action_required", "stale", "startup_failure"), "RUN_TERMINAL")
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
            # Reported run association must match the fresh PR; do not relabel
            # old CI with a newer base. This is not checkout authentication.
            associated = obj(prs[0])
            ah, ab = obj(associated.get("head")), obj(associated.get("base"))
            need(ah.get("sha") == head and ab.get("sha") == main
                 and ab.get("ref") == "main", "STALE_RUN_PR")
            source.update({"prNumber": number, "baseSha": main})
        else:
            need(source_event == "push" and head == main and run.get("head_branch") == "main", "PUSH_SCOPE")
        if workflow_id == 347821227 and run["conclusion"] == "success":
            source["ciEvidence"] = ci_evidence(api, run)
            source["ciEvidence"]["adapterFields"] = adapter_ci_fields(source["ciEvidence"], main)
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
