import copy
import json
import unittest
from collector import GitHub, NoRedirect, MAX_BYTES, Rejected, decode, reconcile

A, B, C = (x * 40 for x in "abc")
REPO = {"full_name": "Achi1984/meridian", "id": 1342084551, "fork": False}


class API:
    def __init__(self, rows):
        self.rows, self.calls = rows, []
    def __call__(self, path):
        self.calls.append(path)
        value = self.rows[path]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)


def workflow():
    run = {"id": 123, "workflow_id": 347821227, "name": "MERIDIAN Release Safety",
        "path": ".github/workflows/backend-safety.yml", "repository": REPO,
        "head_repository": REPO, "head_sha": B, "status": "completed", "conclusion": "success",
        "run_attempt": 1, "event": "pull_request", "pull_requests": [{"number": 702}]}
    pr = {"number": 702, "state": "open", "head": {"sha": B, "repo": REPO},
          "base": {"sha": A, "repo": REPO, "ref": "main"}}
    event = {"repository": REPO, "action": "completed", "workflow_run": copy.deepcopy(run)}
    api = API({"commits/main": {"sha": A}, "actions/runs/123": run, "pulls/702": pr})
    return event, api


def comment():
    c = {"id": 99, "issue_url": "https://api.github.com/repos/Achi1984/meridian/issues/571",
         "user": {"login": "claude[bot]"}, "updated_at": "2026-10-11T20:00:00Z",
         "body": "SECRET_UNTRUSTED_GREEN_LIGHT"}
    e = {"repository": REPO, "action": "edited", "issue": {"number": 571}, "comment": copy.deepcopy(c)}
    return e, API({"commits/main": {"sha": A}, "issues/571": {"number": 571}, "issues/comments/99": c})


class Tests(unittest.TestCase):
    def test_valid_ci_receipt_no_authority(self):
        e, api = workflow()
        r = reconcile("workflow_run", e, A, api)
        self.assertEqual(r["source"]["baseSha"], A)
        self.assertFalse(r["dispatchAllowed"])
        self.assertFalse(r["mergeAllowed"])
        self.assertEqual(api.calls, ["commits/main", "actions/runs/123", "pulls/702", "commits/main"])

    def test_wrong_repository_and_fork(self):
        for bad in ({"full_name": "attacker/repo", "fork": False}, {"full_name": "Achi1984/meridian", "fork": True}):
            e, api = workflow(); e["repository"] = bad
            with self.assertRaisesRegex(Rejected, "REPOSITORY_SCOPE"):
                reconcile("workflow_run", e, A, api)
            self.assertEqual(api.calls, [])
            e, api = workflow(); api.rows["actions/runs/123"]["head_repository"] = bad
            with self.assertRaisesRegex(Rejected, "REPOSITORY_SCOPE"):
                reconcile("workflow_run", e, A, api)

    def test_wrong_workflow_id_name_path(self):
        for key, value in (("workflow_id", 99), ("name", "fake"), ("path", ".github/workflows/fake.yml")):
            e, api = workflow(); api.rows["actions/runs/123"][key] = value
            with self.assertRaises(Rejected): reconcile("workflow_run", e, A, api)

    def test_stale_pr_head_base_and_attempt(self):
        for part in ("head", "base"):
            e, api = workflow(); api.rows["pulls/702"][part]["sha"] = C
            with self.assertRaisesRegex(Rejected, "STALE_PR"): reconcile("workflow_run", e, A, api)
        e, api = workflow(); api.rows["actions/runs/123"]["run_attempt"] = 2
        with self.assertRaisesRegex(Rejected, "STALE_EVENT"): reconcile("workflow_run", e, A, api)

    def test_partial_pr_association_rejected(self):
        for value in (None, [], [{"number": 702}, {"number": 703}], [{}]):
            e, api = workflow(); api.rows["actions/runs/123"]["pull_requests"] = value
            with self.assertRaises(Rejected): reconcile("workflow_run", e, A, api)

    def test_missing_fields_and_api_failure(self):
        e, api = workflow(); api.rows["actions/runs/123"] = {}
        with self.assertRaises(Rejected): reconcile("workflow_run", e, A, api)
        e, api = workflow(); api.rows["actions/runs/123"] = Rejected("API_READ_FAILED")
        with self.assertRaisesRegex(Rejected, "API_READ_FAILED"): reconcile("workflow_run", e, A, api)

    def test_control_sha_current_and_second_read(self):
        e, api = workflow()
        with self.assertRaisesRegex(Rejected, "CONTROL_NOT_CURRENT_MAIN"): reconcile("workflow_run", e, C, api)
        e, api = workflow()
        def moved(path):
            if path == "commits/main" and path in api.calls:
                return {"sha": C}
            return api(path)
        with self.assertRaisesRegex(Rejected, "MAIN_MOVED"): reconcile("workflow_run", e, A, moved)

    def test_push_only_current_main(self):
        e, api = workflow(); run = api.rows["actions/runs/123"]
        run.update(event="push", head_sha=A, head_branch="main"); e["workflow_run"] = copy.deepcopy(run)
        self.assertNotIn("prNumber", reconcile("workflow_run", e, A, api)["source"])
        run["head_branch"] = "feature"
        with self.assertRaisesRegex(Rejected, "PUSH_SCOPE"): reconcile("workflow_run", e, A, api)

    def test_claude_completion_not_review_approval(self):
        e, api = workflow(); run = api.rows["actions/runs/123"]
        run.update(workflow_id=375606132, name="MERIDIAN Claude Mailbox Review",
                   path=".github/workflows/claude-mailbox-review.yml", head_sha=A, event="issue_comment")
        e["workflow_run"] = copy.deepcopy(run)
        r = reconcile("workflow_run", e, A, api)
        self.assertEqual(r["source"]["reviewEvidence"], "NOT_COLLECTED_REQUEST_COMMENT_BINDING_REQUIRED")
        self.assertFalse(r["mergeAllowed"])

    def test_comment_edited_exact_metadata_only(self):
        e, api = comment(); r = reconcile("issue_comment", e, A, api)
        self.assertEqual(r["source"]["commentId"], 99)
        self.assertFalse(r["source"]["bodyCollected"])
        self.assertNotIn("SECRET", json.dumps(r))
        self.assertNotIn("GREEN_LIGHT", json.dumps(r))

    def test_stale_or_foreign_comment(self):
        for key, value in (("updated_at", "2026-10-11T20:00:01Z"), ("issue_url", "https://api.github.com/repos/Achi1984/meridian/issues/572"), ("user", {"login": "attacker"})):
            e, api = comment(); api.rows["issues/comments/99"][key] = value
            with self.assertRaises(Rejected): reconcile("issue_comment", e, A, api)
        e, api = comment(); e["issue"]["pull_request"] = {}
        with self.assertRaisesRegex(Rejected, "MAILBOX_SCOPE"): reconcile("issue_comment", e, A, api)

    def test_duplicate_delivery_not_durably_deduplicated(self):
        e, api = workflow()
        self.assertEqual(reconcile("workflow_run", e, A, api), reconcile("workflow_run", e, A, api))
        self.assertFalse(reconcile("workflow_run", e, A, api)["durableDeduplication"])

    def test_json_bounds_duplicates_and_nonfinite(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'not json', b' ' * 524289):
            with self.assertRaises(Rejected): decode(raw)

    def test_http_get_bounds_and_no_redirect(self):
        gh = GitHub("test-token")
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                self.size = size
                return b'{"sha":"' + A.encode() + b'"}'
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                self.response = Response()
                return self.response
        fake = Opener(); gh.opener = fake
        self.assertEqual(gh("commits/main"), {"sha": A})
        self.assertEqual(fake.request.method, "GET")
        self.assertEqual(fake.timeout, 15)
        self.assertEqual(fake.response.size, MAX_BYTES + 1)
        self.assertEqual(fake.request.full_url, "https://api.github.com/repos/Achi1984/meridian/commits/main")
        with self.assertRaisesRegex(Rejected, "API_PATH"): gh("https://attacker.invalid")
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://attacker.invalid"))
        class Oversized(Opener):
            def open(self, request, timeout):
                response = super().open(request, timeout)
                response.read = lambda size: b' ' * size
                return response
        gh.opener = Oversized()
        with self.assertRaisesRegex(Rejected, "RESPONSE_SIZE"): gh("commits/main")


if __name__ == "__main__":
    unittest.main()
