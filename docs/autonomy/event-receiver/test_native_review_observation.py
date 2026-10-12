import copy
import hashlib
import json
import unittest
from native_review_observation import ACTOR, observe_native_review
from test_collector import A, B, C, workflow

PATH = "pulls/702/reviews/99"


def fixture():
    _, api = workflow()
    body = "Synthetic approval; not executed-check evidence."
    version = {"id": 99, "submittedAt": "2026-10-12T19:00:00Z",
               "bodySha256": hashlib.sha256(body.encode()).hexdigest()}
    expected = {"scope": {"prNumber": 702, "headSha": B, "baseSha": A,
                          "ci": {"runId": 123, "runAttempt": 1, "workflowId": 347821227, "headSha": B}},
                "review": version}
    api.rows[PATH] = {"id": 99, "user": dict(ACTOR), "body": body,
                      "submitted_at": version["submittedAt"], "commit_id": B, "state": "APPROVED",
                      "pull_request_url": "https://api.github.com/repos/Achi1984/meridian/pulls/702"}
    return expected, api


class NativeObservationTests(unittest.TestCase):
    def observe(self, expected, api):
        result = observe_native_review(json.dumps(expected).encode(), api)
        for key in ("authenticated", "provenanceVerified", "authorized", "dispatchAllowed",
                    "mergeAllowed", "durable", "fullReviewEvidence"):
            self.assertIs(result[key], False)
        self.assertIsNone(result["plannerResponse"])
        return result

    def blocked(self, expected, api):
        result = self.observe(expected, api)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertIsNone(result["observation"])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_match_is_incomplete_and_read_only(self):
        expected, api = fixture()
        result = self.observe(expected, api)
        self.assertEqual(result["status"], "OBSERVED_APPROVAL_INCOMPLETE")
        self.assertEqual(result["observation"]["scope"], expected["scope"])
        self.assertNotIn("Synthetic", json.dumps(result))
        self.assertEqual(api.calls, ["commits/main", "pulls/702", "actions/runs/123", PATH] * 2 + ["commits/main"])

    def test_review_rejection_matrix(self):
        for key, value in [("id", True), ("id", 100), ("state", "DISMISSED"),
                           ("state", "CHANGES_REQUESTED"), ("commit_id", C),
                           ("submitted_at", "2026-10-11T19:00:00Z"), ("body", "SECRET"),
                           ("body", None), ("body", "a" * 16385), ("pull_request_url", "SECRET")]:
            with self.subTest(key=key, value=str(value)[:30]):
                expected, api = fixture()
                api.rows[PATH][key] = value
                self.blocked(expected, api)

    def test_actor_rejection_matrix(self):
        for key, value in [("id", 209825114), ("login", "Copilot"), ("type", "User")]:
            expected, api = fixture()
            api.rows[PATH]["user"][key] = value
            self.blocked(expected, api)

    def test_ci_rejection_matrix(self):
        for key, value in [("run_attempt", 2), ("head_sha", C), ("conclusion", "failure"),
                           ("event", "push"), ("workflow_id", 1), ("status", "queued"),
                           ("pull_requests", []), ("pull_requests", [{"number": 703}])]:
            expected, api = fixture()
            api.rows["actions/runs/123"][key] = value
            self.blocked(expected, api)

    def test_ci_association_sha_and_base(self):
        for side in ("head", "base"):
            expected, api = fixture()
            api.rows["actions/runs/123"]["pull_requests"][0][side]["sha"] = C
            self.blocked(expected, api)

    def test_pr_closed_fork_or_changed(self):
        for change in ("closed", "fork", "head", "base"):
            expected, api = fixture()
            pr = api.rows["pulls/702"]
            if change == "closed":
                pr["state"] = "closed"
            elif change == "fork":
                pr["head"]["repo"] = {**pr["head"]["repo"], "fork": True}
            else:
                pr[change]["sha"] = C
            self.blocked(expected, api)

    def test_changes_during_reread(self):
        for target in (PATH, "pulls/702", "actions/runs/123", "commits/main"):
            expected, api = fixture()
            def reader(path):
                if path == target and target in api.calls:
                    raise ValueError("SECRET changed during read")
                return api(path)
            self.blocked(expected, reader)

    def test_final_main_reread(self):
        expected, api = fixture()
        def reader(path):
            if path == "commits/main" and api.calls.count(path) == 2:
                return {"sha": C}
            return api(path)
        self.blocked(expected, reader)

    def test_missing_review_and_transport_errors_are_redacted(self):
        expected, api = fixture()
        api.rows[PATH] = RuntimeError("SECRET token")
        self.blocked(expected, api)

    def test_invalid_pins_never_read(self):
        for key, value in [("id", True), ("id", 2**63), ("bodySha256", "SECRET"),
                           ("submittedAt", None)]:
            expected, api = fixture()
            expected["review"][key] = value
            self.blocked(expected, api)
            self.assertEqual(api.calls, [])
        expected, api = fixture()
        expected["authorized"] = True
        self.blocked(expected, api)
        self.assertEqual(api.calls, [])

    def test_raw_bounds_and_duplicate_keys(self):
        for raw in (b'{"scope":{},"scope":{}}', b"x" * 16385, b"NaN", {}, b"[]"):
            _, api = fixture()
            self.assertEqual(observe_native_review(raw, api)["status"], "BLOCKED")
            self.assertEqual(api.calls, [])


if __name__ == "__main__":
    unittest.main()
