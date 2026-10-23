"""Generated-fixture tests for bounded, read-only historical journal inspection."""

import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import journal
import historical_inspection_report as report
import supervisor


ROOT = Path(__file__).resolve().parents[2]
PROFILE_GENERATOR = Path(__file__).with_name("test_b1_historical_fixture.mjs")
FIXTURE_ADAPTER = PROFILE_GENERATOR


class HistoricalInspectionReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile_temp = tempfile.TemporaryDirectory()
        cls.profiles = {}
        for scenario in ("SUCCESS", "INSUFFICIENT_EVIDENCE", "COMPLETED_INSUFFICIENT_SCREEN"):
            profile_path = Path(cls.profile_temp.name) / f"historical-test-{scenario.lower()}.json"
            generated = subprocess.run(
                ["node", str(PROFILE_GENERATOR), "--profile", str(profile_path), scenario],
                cwd=ROOT, capture_output=True, text=True, timeout=30,
            )
            if generated.returncode:
                raise AssertionError(generated.stderr)
            cls.profiles[scenario] = profile_path

    @classmethod
    def tearDownClass(cls):
        cls.profile_temp.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "historical.sqlite"
        self.profile_path = self.profiles["SUCCESS"]
        self.profile = json.loads(self.profile_path.read_text())

    def tearDown(self):
        self.temp.cleanup()

    def historical_profile(self):
        return patch.object(journal, "HISTORICAL_PROFILE_PATH", self.profile_path)

    def _test_mode(self):
        return patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})

    def create_queued(self, database=None):
        database = database or self.database
        with self.historical_profile(), self._test_mode():
            journal.initialize(database, profile=journal.HISTORICAL_PROFILE_NAME)
            job = journal.enqueue_b1(database, self.profile["trialKey"])
        return job["trialId"]

    def create_claimed(self, database=None):
        database = database or self.database
        trial_id = self.create_queued(database)
        with self.historical_profile(), self._test_mode():
            claim = journal.scheduler_tick_b1(database, enabled=True)["claim"]
        self.assertEqual(claim["trialId"], trial_id)
        return claim

    def run_scenario(self, claim, scenario, limits=None):
        original_popen = subprocess.Popen

        def spawn(*args, **kwargs):
            if Path(args[0][1]).resolve() == FIXTURE_ADAPTER.resolve():
                environment = dict(kwargs["env"])
                environment.update({
                    "NODE_ENV": "test",
                    "B1_TEST_SCENARIO": scenario,
                    "B1_TEST_HISTORICAL_PROFILE_PATH": str(self.profile_path),
                })
                kwargs["env"] = environment
            return original_popen(*args, **kwargs)

        with (self.historical_profile(), self._test_mode(),
              patch.object(supervisor, "HISTORICAL_ADAPTER", FIXTURE_ADAPTER),
              patch.object(supervisor.subprocess, "Popen", side_effect=spawn)):
            return supervisor.run_b1_batch(
                self.database, claim,
                limits=limits or {"path_seconds": 10, "batch_seconds": 20},
            )

    def snapshot(self, database=None):
        database = database or self.database
        with sqlite3.connect(database) as connection:
            logical = list(connection.iterdump())
        return hashlib.sha256(Path(database).read_bytes()).hexdigest(), logical

    def invoke_main(self, database=None, trial_id=None):
        output = io.BytesIO()
        stdout = io.TextIOWrapper(output, encoding="utf-8")
        stderr = io.StringIO()
        with (self.historical_profile(), self._test_mode(),
              patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr)):
            status = report.main([
                str(database or self.database),
                trial_id or hashlib.sha256(self.profile["trialKey"].encode()).hexdigest(),
            ])
            stdout.flush()
        return status, output.getvalue(), stderr.getvalue()

    def test_queued_report_is_bounded_deterministic_and_read_only(self):
        trial_id = self.create_queued()
        before = self.snapshot()
        first = self.invoke_main(trial_id=trial_id)
        second = self.invoke_main(trial_id=trial_id)
        self.assertEqual(first[0], 0, first[2])
        self.assertEqual(first[1], second[1])
        self.assertLessEqual(len(first[1]), report.MAX_REPORT_BYTES)
        result = json.loads(first[1])
        self.assertEqual((result["profile"], result["trialId"], result["state"]),
                         (journal.HISTORICAL_PROFILE_NAME, trial_id, "queued"))
        self.assertEqual(result["observationScope"], "ONE_JOURNAL_TRIAL")
        self.assertEqual(result["attempts"], 0)
        self.assertFalse(result["unresolved"])
        self.assertEqual(result["historicalCompleteness"], "NOT_ESTABLISHED")
        self.assertEqual(result["sourceAuthenticity"], "NOT_ESTABLISHED")
        self.assertNotIn("remainingExecutionBudget", result)
        self.assertEqual(before, self.snapshot())

    def test_completed_and_insufficient_results_are_observations_only(self):
        claim = self.create_claimed()
        completed = self.run_scenario(claim, "SUCCESS")
        self.assertEqual(completed["state"], "completed")
        before = self.snapshot()
        status, output, error = self.invoke_main(trial_id=claim["trialId"])
        self.assertEqual(status, 0, error)
        result = json.loads(output)
        self.assertEqual((result["state"], result["attempts"]), ("completed", 1))
        self.assertEqual((result["pathsStarted"], result["pathsCompleted"]), (44, 44))
        self.assertRegex(result["identities"]["resultSha256"], r"^[a-f0-9]{64}$")
        self.assertRegex(result["identities"]["summarySha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(before, self.snapshot())

        database = Path(self.temp.name) / "insufficient.sqlite"
        self.profile_path = self.profiles["INSUFFICIENT_EVIDENCE"]
        self.profile = json.loads(self.profile_path.read_text())
        claim = self.create_claimed(database)
        original_database = self.database
        self.database = database
        try:
            self.run_scenario(claim, "INSUFFICIENT_EVIDENCE")
            status, output, error = self.invoke_main(database, claim["trialId"])
        finally:
            self.database = original_database
        self.assertEqual(status, 0, error)
        result = json.loads(output)
        self.assertEqual((result["state"], result["reasonCode"], result["attempts"]),
                         ("failed", "INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR", 1))
        self.assertEqual((result["pathsStarted"], result["pathsCompleted"]), (19, 19))

    def test_completed_insufficient_screen_remains_observation_only(self):
        self.profile_path = self.profiles["COMPLETED_INSUFFICIENT_SCREEN"]
        self.profile = json.loads(self.profile_path.read_text())
        claim = self.create_claimed()
        completed = self.run_scenario(claim, "COMPLETED_INSUFFICIENT_SCREEN")
        self.assertEqual(completed["state"], "completed")
        before = self.snapshot()
        with self.historical_profile(), self._test_mode():
            stored = journal.inspect_b1(self.database, claim["trialId"])
        summary = json.loads(stored["result"])
        self.assertEqual(summary["status"], "COMPLETED")
        self.assertEqual(summary["screen"]["status"], "INSUFFICIENT_EVIDENCE")
        status, output, error = self.invoke_main(trial_id=claim["trialId"])
        self.assertEqual(status, 0, error)
        report_value = json.loads(output)
        self.assertEqual(report_value["state"], "completed")
        self.assertEqual(report_value["pathsCompleted"], 44)
        self.assertFalse(report_value["executionAuthorized"])
        self.assertFalse(report_value["promotionAuthorized"])
        self.assertEqual(before, self.snapshot())

    def test_unresolved_consumed_attempt_and_failed_or_timed_out_states(self):
        claim = self.create_claimed()
        before = self.snapshot()
        status, output, error = self.invoke_main(trial_id=claim["trialId"])
        self.assertEqual(status, 0, error)
        result = json.loads(output)
        self.assertEqual(result["state"], "unknown")
        self.assertTrue(result["unresolved"])
        self.assertEqual(result["attempts"], 1)
        self.assertGreater(result["fence"], 0)
        self.assertEqual(before, self.snapshot())

        database = Path(self.temp.name) / "failed.sqlite"
        claim = self.create_claimed(database)
        original_database = self.database
        self.database = database
        try:
            self.run_scenario(claim, "ENGINE_FAILURE")
            status, output, error = self.invoke_main(database, claim["trialId"])
        finally:
            self.database = original_database
        self.assertEqual(status, 0, error)
        failed = json.loads(output)
        self.assertEqual((failed["state"], failed["attempts"]), ("failed", 1))
        self.assertIsNotNone(failed["reasonCode"])

        database = Path(self.temp.name) / "timed-out.sqlite"
        claim = self.create_claimed(database)
        self.database = database
        try:
            self.run_scenario(claim, "HISTORICAL_TIMEOUT",
                              limits={"path_seconds": 1, "batch_seconds": 10})
            status, output, error = self.invoke_main(database, claim["trialId"])
        finally:
            self.database = original_database
        self.assertEqual(status, 0, error)
        timed_out = json.loads(output)
        self.assertEqual((timed_out["state"], timed_out["attempts"]), ("timed_out", 1))
        self.assertGreater(timed_out["fence"], 0)

    def test_missing_locked_corrupt_and_wrong_profile_are_not_observed(self):
        missing = Path(self.temp.name) / "missing.sqlite"
        status, output, error = self.invoke_main(missing)
        self.assertEqual(status, 1)
        self.assertEqual(output, b"")
        self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")
        self.assertLessEqual(len(error.encode()), report.MAX_REPORT_BYTES)
        self.assertFalse(missing.exists())

        trial_id = self.create_queued()
        connection = sqlite3.connect(self.database, isolation_level=None)
        try:
            connection.execute("BEGIN EXCLUSIVE")
            status, output, error = self.invoke_main(trial_id=trial_id)
            self.assertEqual(status, 1)
            self.assertEqual(output, b"")
            self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")
        finally:
            connection.rollback()
            connection.close()

        corrupt = Path(self.temp.name) / "corrupt.sqlite"
        corrupt.write_bytes(b"not a sqlite database")
        status, output, error = self.invoke_main(corrupt, trial_id)
        self.assertEqual(status, 1)
        self.assertEqual(output, b"")
        self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")

        wrong_profile = Path(self.temp.name) / "generated.sqlite"
        with self.historical_profile(), self._test_mode():
            journal.initialize(wrong_profile, profile=journal.B1_PROFILE_NAME)
            trial = journal.enqueue_b1(wrong_profile, "trial-generated-fixture")
        status, output, error = self.invoke_main(wrong_profile, trial["trialId"])
        self.assertEqual(status, 1)
        self.assertEqual(output, b"")
        self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")

    def test_missing_exact_trial_is_not_observed_without_storage_change(self):
        existing_trial = self.create_queued()
        before = self.snapshot()
        missing_trial = "f" * 64
        self.assertNotEqual(existing_trial, missing_trial)
        status, output, error = self.invoke_main(trial_id=missing_trial)
        self.assertEqual(status, 1)
        self.assertEqual(output, b"")
        self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")
        self.assertEqual(before, self.snapshot())

    def test_corrupt_rows_output_bounds_and_no_mutating_actions(self):
        trial_id = self.create_queued()
        with sqlite3.connect(self.database) as connection:
            connection.execute("UPDATE b1_jobs SET identity_json='{}'")
        before = self.snapshot()
        status, output, error = self.invoke_main(trial_id=trial_id)
        self.assertEqual(status, 1)
        self.assertEqual(output, b"")
        self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")
        self.assertEqual(before, self.snapshot())

        value = {
            "schema": report.SCHEMA,
            "status": "OBSERVED",
            "observationScope": "ONE_JOURNAL_TRIAL",
        }
        valid_database = Path(self.temp.name) / "valid.sqlite"
        valid_trial_id = self.create_queued(valid_database)
        before = self.snapshot(valid_database)
        with patch.object(report, "MAX_REPORT_BYTES", 256):
            with self.assertRaisesRegex(report.ReportError, "REPORT_TOO_LARGE"):
                report.encode_report({"oversized": "x" * 257})
            status, output, error = self.invoke_main(valid_database, valid_trial_id)
        self.assertEqual(status, 1)
        self.assertEqual(output, b"")
        self.assertEqual(json.loads(error)["status"], "NOT_OBSERVED")
        self.assertLessEqual(len(error.encode()), 256)
        self.assertEqual(before, self.snapshot(valid_database))

        forbidden = ("initialize", "initialize_b1", "enqueue_b1", "scheduler_tick_b1",
                     "start_b1", "reconcile_b1", "settle_b1", "record_b1_path_started")
        with patch.object(report.journal, "inspect_b1", wraps=journal.inspect_b1):
            from contextlib import ExitStack
            with ExitStack() as stack:
                stack.enter_context(self.historical_profile())
                stack.enter_context(self._test_mode())
                for name in forbidden:
                    stack.enter_context(patch.object(
                        journal, name, side_effect=AssertionError(name)))
                stack.enter_context(patch.object(
                    journal, "b1_remaining_capacity", side_effect=AssertionError("capacity")))
                stack.enter_context(patch.object(
                    supervisor, "run_b1_batch", side_effect=AssertionError("execution")))
                stack.enter_context(patch.object(
                    subprocess, "Popen", side_effect=AssertionError("process launch")))
                self.assertEqual(
                    report.build_report(
                        valid_database,
                        valid_trial_id
                    )["state"], "queued")


if __name__ == "__main__":
    unittest.main()
