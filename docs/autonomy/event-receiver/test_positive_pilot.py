import copy
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from receipt_summary import check_expiry, summarize

HEAD = "a" * 40
NOW = datetime.datetime(2026, 10, 12, 9, tzinfo=datetime.timezone.utc)
WORKFLOW = Path(__file__).with_name("positive-native-pilot.yml").read_text()


def receipt():
    return {"schema": 1, "kind": "MERIDIAN_READ_ONLY_EVENT_RECEIPT", "repository": "Achi1984/meridian",
        "controlSha": HEAD, "mainSha": HEAD, "event": "workflow_run", "authority": "NONE",
        "dispatchAllowed": False, "mergeAllowed": False, "durableDeduplication": False, "leaseAcquired": False,
        "source": {"runId": 123, "attempt": 2, "workflowId": 347821227, "headSha": HEAD,
            "conclusion": "success", "sourceEvent": "push", "ciEvidence": {"runId": 123,
                "runAttempt": 2, "workflowId": 347821227, "headSha": HEAD,
                "evidenceClass": "JOB_LOG_REPORTED_COUNTERS", "authenticated": False,
                "provenanceVerified": False, "testOutputForgeryExcluded": False,
                "dispatchAllowed": False, "mergeAllowed": False}}}


class Tests(unittest.TestCase):
    def test_summary_projects_only_fixed_scalars(self):
        data = receipt()
        data["secret"] = "TOKEN_SECRET"
        data["source"]["ciEvidence"]["rawLog"] = "TOKEN_SECRET"
        result = summarize(data, HEAD, 123)
        self.assertLessEqual(len(result.encode()), 1024)
        self.assertNotIn("TOKEN_SECRET", result)
        parsed = json.loads(result)
        self.assertEqual(parsed["runId"], 123)
        self.assertEqual(parsed["authority"], "NONE")
        self.assertIs(parsed["authenticated"], False)

    def test_summary_rejects_changed_bindings_and_authority(self):
        for section, keys in (((), ("dispatchAllowed", "mergeAllowed", "durableDeduplication", "leaseAcquired")),
            (("source", "ciEvidence"), ("authenticated", "provenanceVerified", "testOutputForgeryExcluded", "dispatchAllowed", "mergeAllowed"))):
            for key in keys:
                for value in (True, 0, "false", None):
                    data = receipt(); target = data
                    for part in section: target = target[part]
                    target[key] = value
                    with self.assertRaises(ValueError): summarize(data, HEAD, 123)
        for section in ("source", "evidence"):
            for key, value in (("runId", True), ("runId", 124), ("workflowId", "347821227"),
                               ("headSha", "b" * 40), ("attempt" if section == "source" else "runAttempt", 1)):
                data = receipt(); target = data["source"]
                if section == "evidence": target = target["ciEvidence"]
                target[key] = value
                with self.assertRaises(ValueError): summarize(data, HEAD, 123)
        for key in ("schema", "kind", "repository", "controlSha", "mainSha", "event", "authority", "source"):
            data = receipt(); del data[key]
            with self.assertRaises(ValueError): summarize(data, HEAD, 123)

    def test_expiry_window_and_inactive_literal(self):
        check_expiry("2026-10-12T09:15:00Z", NOW)
        for value in ("YYYY-MM-DDTHH:MM:SSZ", "2026-10-12T00:00:00Z", "2026-10-12T09:00:00Z", "2026-10-12T10:31:00Z"):
            with self.assertRaises(ValueError): check_expiry(value, NOW)
        self.assertIn("PILOT_EXPIRES_AT: '2026-10-12T00:00:00Z'", WORKFLOW)
        code = WORKFLOW.split("python3 -I -B - <<'PY'\n", 1)[1].split("\n          PY", 1)[0]
        code = "\n".join(line[10:] for line in code.splitlines())
        result = subprocess.run([sys.executable, "-I", "-B", "-c", code],
            env={**os.environ, "PILOT_EXPIRES_AT": "2026-10-12T00:00:00Z"}, capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)

    def test_workflow_envelope(self):
        self.assertIn("on:\n  workflow_run:\n    workflows: [MERIDIAN Release Safety]\n    types: [completed]\npermissions:", WORKFLOW)
        self.assertIn("permissions:\n  contents: read\n  actions: read\n  issues: read\n  pull-requests: read\njobs:", WORKFLOW)
        self.assertEqual(WORKFLOW.count("permissions:"), 1)
        for guard in ("github.run_attempt == 1", "github.event.workflow_run.run_attempt == 2",
            "github.event.workflow_run.head_sha == github.sha", "github.event.workflow_run.event == 'push'",
            "github.event.workflow_run.head_branch == 'main'", "github.event.workflow_run.workflow_id == 347821227",
            "github.event.workflow_run.path == '.github/workflows/backend-safety.yml'",
            "github.event.workflow_run.conclusion == 'success'", "timeout-minutes: 4"):
            self.assertIn(guard, WORKFLOW)
        self.assertNotRegex(WORKFLOW, r"\buses:|\bsecrets\.|:\s*write\b|workflow_dispatch:|schedule:|checkout@|upload-artifact|\bcopilot\b|\bclaude\b")
        self.assertLess(WORKFLOW.index("Reject unset or expired"), WORKFLOW.index("gh api"))

    def test_cli_rejects_oversize_and_duplicate_json_without_echo(self):
        expiry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for raw in (b"TOKEN_SECRET" * 400, b'{"schema":1,"schema":1,"secret":"TOKEN_SECRET"}'):
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "receipt.json"; path.write_bytes(raw)
                result = subprocess.run([sys.executable, "-I", "-B", str(Path(__file__).with_name("receipt_summary.py"))],
                    env={**os.environ, "PILOT_EXPIRES_AT": expiry, "RECEIPT_PATH": str(path), "GITHUB_SHA": HEAD, "SOURCE_RUN_ID": "123"},
                    capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, "Read-only receipt summary rejected\n")


if __name__ == "__main__":
    unittest.main()
