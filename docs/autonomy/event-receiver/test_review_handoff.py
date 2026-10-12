import copy
import hashlib
import json
import os
from pathlib import Path
import unittest
from collector import Rejected
from review_handoff import collect_review, load_binder
from test_collector import API, A, B, C, REPO, workflow


def fixture():
    event, api = workflow()
    scope = {"repository": REPO["full_name"], "requestId": "REQ001", "opId": "OP001", "headSha": B,
             "baseSha": A, "prNumber": 702, "ci": {"runId": 123, "runAttempt": 1, "workflowId": 347821227, "headSha": B}}
    claim = {"schemaVersion": 1, **scope, "verdict": "GREEN_LIGHT",
             "ci": {**scope["ci"], "status": "completed", "conclusion": "success"}}
    body = json.dumps(claim, separators=(",", ":"))
    actor = {"id": 209825114, "login": "claude[bot]", "type": "Bot"}
    timestamp = "2026-10-11T19:00:00Z"
    expected = {"scope": scope, "actor": actor, "version": {"commentId": 789, "createdAt": timestamp,
        "updatedAt": timestamp, "bodySha256": hashlib.sha256(body.encode()).hexdigest()}, "issueNumber": 571, "reviewerFamily": "claude"}
    api.rows["issues/571"] = {"number": 571}
    api.rows["issues/comments/789"] = {"id": 789, "user": actor, "created_at": timestamp,
        "updated_at": timestamp, "body": body, "issue_url": "https://api.github.com/repos/Achi1984/meridian/issues/571"}
    return expected, api


class HandoffTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = os.environ.get("MERIDIAN_TEST_BINDER")
        cls.binder = staticmethod(load_binder(Path(path) if path else None))

    def run_handoff(self, expected, api, action="edited", binder=None):
        return collect_review(json.dumps(expected), A, action, api, binder or self.binder)

    def test_actual_binder_composes_without_body_output(self):
        expected, api = fixture(); receipt = self.run_handoff(expected, api)
        self.assertEqual(receipt["decision"], "CANDIDATE_REVIEW")
        self.assertEqual(receipt["plannerResponse"]["reviewCommentId"], 789)
        self.assertEqual(receipt["reviewBinding"], {**expected["version"], "ci": expected["scope"]["ci"], "prNumber": expected["scope"]["prNumber"]})
        self.assertNotIn('schemaVersion', json.dumps(receipt))
        for key in ("authenticated", "provenanceVerified", "authorized", "dispatchAllowed", "mergeAllowed", "durable"):
            self.assertFalse(receipt[key])
        self.assertEqual(api.calls.count("issues/comments/789"), 2)

    def test_prose_producer_remains_blocked(self):
        expected, api = fixture(); body = "GREEN_LIGHT SECRET_MARKER prose"
        api.rows["issues/comments/789"]["body"] = body
        expected["version"]["bodySha256"] = hashlib.sha256(body.encode()).hexdigest()
        receipt = self.run_handoff(expected, api)
        self.assertEqual(receipt["reason"], "STRUCTURED_CLAUDE_CLAIM_MISSING")
        self.assertNotIn("SECRET_MARKER", json.dumps(receipt))

    def test_edit_during_binding_discards_candidate(self):
        expected, api = fixture()
        def changing(observation, pins):
            result = self.binder(observation, pins)
            api.rows["issues/comments/789"]["body"] += " "
            return result
        receipt = self.run_handoff(expected, api, binder=changing)
        self.assertEqual(receipt["decision"], "BLOCKED"); self.assertIsNone(receipt["plannerResponse"])

    def test_deletion_and_404_fail_closed_no_error_leak(self):
        expected, api = fixture()
        self.assertEqual(self.run_handoff(expected, api, action="deleted")["decision"], "BLOCKED")
        self.assertEqual(api.calls, [])
        for after_binding in (False, True):
            expected, api = fixture()
            def deletion(observation, pins):
                result = self.binder(observation, pins)
                api.rows["issues/comments/789"] = Rejected("404 SECRET_MARKER")
                return result
            if not after_binding: api.rows["issues/comments/789"] = Rejected("404 SECRET_MARKER")
            result = self.run_handoff(expected, api, binder=deletion)
            self.assertEqual(result["decision"], "BLOCKED"); self.assertNotIn("SECRET_MARKER", json.dumps(result))

    def test_actor_mailbox_and_pins(self):
        for field, value in (("user", {"id": 1, "login": "claude[bot]", "type": "Bot"}),
                             ("issue_url", "https://api.github.com/repos/Achi1984/meridian/issues/572"),
                             ("updated_at", "2026-10-11T19:00:01Z")):
            expected, api = fixture(); api.rows["issues/comments/789"][field] = value
            self.assertEqual(self.run_handoff(expected, api)["decision"], "BLOCKED")
        expected, api = fixture(); expected["scope"]["requestId"] = "REQ002"
        self.assertEqual(self.run_handoff(expected, api)["decision"], "BLOCKED")

    def test_main_pr_and_attempt_changes_after_binding(self):
        for mutation in (lambda api: api.rows["commits/main"].update(sha=C),
                         lambda api: api.rows["pulls/702"]["head"].update(sha=C),
                         lambda api: api.rows["actions/runs/123"].update(run_attempt=2)):
            expected, api = fixture()
            def changed(observation, pins):
                result = self.binder(observation, pins); mutation(api); return result
            self.assertEqual(self.run_handoff(expected, api, binder=changed)["decision"], "BLOCKED")

    def test_non_green_remains_adverse_and_oversized_fails(self):
        expected, api = fixture(); comment = api.rows["issues/comments/789"]
        claim = json.loads(comment["body"]); claim["verdict"] = "REVISION_REQUIRED"
        comment["body"] = json.dumps(claim); expected["version"]["bodySha256"] = hashlib.sha256(comment["body"].encode()).hexdigest()
        result = self.run_handoff(expected, api)
        self.assertEqual(result["decision"], "BLOCKED"); self.assertEqual(result["plannerResponse"]["verdict"], "REVISION_REQUIRED")
        comment["body"] = "X" * 16385
        self.assertIsNone(self.run_handoff(expected, api)["plannerResponse"])


if __name__ == "__main__": unittest.main()
