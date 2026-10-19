"""Temporary generated-journal tests; no engine, market files, or strategy runs."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import journal
import inspection_report as report


class InspectionReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temp.name) / "b1.sqlite")
        journal.initialize_b1(self.database)
        self.job = journal.enqueue_b1(self.database, "trial-inspection")
        self.trial = self.job["trialId"]

    def tearDown(self):
        self.temp.cleanup()

    def cli(self, database=None, trial=None):
        return subprocess.run([sys.executable, "-B", str(Path(report.__file__)),
                               database or self.database, trial or self.trial],
                              capture_output=True, timeout=10)

    def snapshot(self):
        with sqlite3.connect(self.database) as connection:
            logical = list(connection.iterdump())
        return hashlib.sha256(Path(self.database).read_bytes()).hexdigest(), logical

    def test_queued_cli_deterministic_readonly_bounded(self):
        before = self.snapshot()
        first, second = self.cli(), self.cli()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(first.stdout, second.stdout)
        self.assertLessEqual(len(first.stdout), report.MAX_REPORT_BYTES)
        result = json.loads(first.stdout)
        self.assertEqual(result["state"], "queued")
        self.assertFalse(result["unresolved"])
        self.assertEqual(result["pathsCompleted"], 0)
        self.assertEqual(result["evidenceClass"], "SYNTHETIC_ONLY")
        self.assertEqual(before, self.snapshot())
        self.assertFalse({"result", "controls", "paths", "owner", "trialKey"} & set(result))

    def test_claimed_and_started_restart_preserves_fence(self):
        claim = journal.scheduler_tick_b1(self.database, enabled=True)["claim"]
        for start in (False, True):
            if start:
                journal.start_b1(self.database, claim)
            before = self.snapshot()
            completed = self.cli()
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["state"], "unknown")
            self.assertTrue(result["unresolved"])
            self.assertTrue(result["requiresExplicitReconciliation"])
            self.assertEqual(result["attempts"], 1)
            self.assertEqual(result["fence"], claim["fence"])
            self.assertFalse(result["recoveryPerformed"])
            self.assertEqual(before, self.snapshot())

    def test_started_path_and_terminal_failure_are_not_completion(self):
        claim = journal.scheduler_tick_b1(self.database, enabled=True)["claim"]
        started = journal.start_b1(self.database, claim)
        journal.record_b1_path_started(self.database, claim, 0, started["computationPathIds"][0])
        result = json.loads(self.cli().stdout)
        self.assertEqual((result["pathsStarted"], result["pathsCompleted"]), (1, 0))
        self.assertTrue(result["unresolved"])
        journal.settle_b1(self.database, claim, "FAILED", "GENERATED_TEST_FAILURE")
        before = self.snapshot()
        result = json.loads(self.cli().stdout)
        self.assertEqual(result["state"], "failed")
        self.assertFalse(result["unresolved"])
        self.assertEqual(result["reasonCode"], "GENERATED_TEST_FAILURE")
        self.assertIsNone(result["identities"]["resultSha256"])
        self.assertEqual(before, self.snapshot())

    def test_no_mutating_api_or_process_launch(self):
        forbidden = ("initialize", "initialize_b1", "enqueue_b1", "scheduler_tick_b1",
                     "start_b1", "reconcile_b1", "settle_b1", "record_b1_path_started")
        from contextlib import ExitStack
        with ExitStack() as stack:
            for name in forbidden:
                stack.enter_context(patch.object(journal, name, side_effect=AssertionError(name)))
            stack.enter_context(patch.object(subprocess, "Popen", side_effect=AssertionError("launch")))
            self.assertEqual(report.build_report(self.database, self.trial)["state"], "queued")

    def test_missing_database_does_not_create_file(self):
        missing = str(Path(self.temp.name) / "missing.sqlite")
        result = self.cli(database=missing)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertFalse(Path(missing).exists())
        self.assertNotIn(missing.encode(), result.stderr)

    def test_wrong_profile_no_fallback(self):
        legacy = str(Path(self.temp.name) / "legacy.sqlite")
        journal.initialize(legacy)
        result = self.cli(database=legacy)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")

    def test_tampered_identity_fails_closed_without_repair(self):
        with sqlite3.connect(self.database) as connection:
            connection.execute("UPDATE b1_jobs SET identity_json='{}'")
        before = self.snapshot()
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(before, self.snapshot())

    def test_incomplete_schema_emits_only_sanitized_error_without_mutation(self):
        with sqlite3.connect(self.database) as connection:
            connection.execute("DROP TABLE b1_path_payloads")
        before = self.snapshot()
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        expected = ('{"schema":"' + report.SCHEMA + '","error":"INSPECTION_FAILED"}\n').encode()
        self.assertEqual(result.stderr, expected)
        self.assertEqual(before, self.snapshot())

    def test_invalid_or_missing_trial_and_busy_database(self):
        for trial in ("bad-id", "f" * 64):
            result = self.cli(trial=trial)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, b"")
        connection = sqlite3.connect(self.database, isolation_level=None)
        try:
            connection.execute("BEGIN EXCLUSIVE")
            result = self.cli()
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, b"")
        finally:
            connection.rollback()
            connection.close()

    def test_projection_authority_and_size_fail_closed(self):
        value = journal.inspect_b1(self.database, self.trial)
        with patch.object(journal, "inspect_b1", return_value={**value, "executionAuthorized": True}):
            with self.assertRaises(report.ReportError):
                report.build_report(self.database, self.trial)
        with self.assertRaisesRegex(report.ReportError, "REPORT_TOO_LARGE"):
            report.encode_report({"oversized": "x" * report.MAX_REPORT_BYTES})
        with patch.object(journal, "inspect_b1", return_value={**value, "reason": "secret\nraw", "result": "private"}):
            result = report.build_report(self.database, self.trial)
            self.assertIsNone(result["reasonCode"])
            self.assertNotIn("private", report.encode_report(result).decode())


if __name__ == "__main__":
    unittest.main()
