import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import journal
import supervisor


FAULT_ADAPTER = ROOT / "test_fault_adapter.mjs"
class ResearchSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = str(Path(self.temporary.name) / "research.sqlite")
        journal.initialize(self.database)
        self.source = "a" * 64
        self.data = "1" * 64
        self.policy = {
            "enabled": True,
            "protocol_sha256": journal.PROTOCOL_SHA256,
            "source_sha256": self.source,
            "data_sha256": self.data,
            "daily_batch_limit": 1,
            "daily_compute_seconds": journal.MAX_BATCH_SECONDS,
            "daily_data_bytes": 1024,
            "daily_model_calls": 0,
        }

    def tearDown(self):
        self.temporary.cleanup()

    def enqueue(self, key="trial-demo", source=None, data=None, data_bytes=0):
        return journal.enqueue(self.database, key, source or self.source, data or self.data, data_bytes)

    def claim(self, key="trial-demo", source=None, data=None, data_bytes=0):
        self.enqueue(key, source, data, data_bytes)
        policy = {**self.policy, "source_sha256": source or self.source, "data_sha256": data or self.data}
        result = journal.scheduler_tick(self.database, policy)
        self.assertTrue(result["claimed"])
        return result["claim"]

    def run_fault(self, source, limits=None, key="trial-fault"):
        self.database = str(Path(self.temporary.name) / (key + ".sqlite"))
        journal.initialize(self.database)
        claim = self.claim(key, source, self.data)
        with patch.object(supervisor, "ADAPTER", FAULT_ADAPTER):
            return supervisor.run_batch(self.database, claim, limits=limits)

    def test_enqueue_conflict_is_immutable_and_duplicate_is_idempotent(self):
        first = self.enqueue()
        self.assertEqual(first, self.enqueue())
        self.assertEqual(len(first["trialId"]), 64)
        with self.assertRaisesRegex(journal.JournalError, "TRIAL_ID_CONFLICT"):
            self.enqueue(source="2" * 64)

    def test_explicit_scheduler_off_and_pinned_policy_rejection_are_durable(self):
        trial = self.enqueue()
        self.assertEqual(journal.scheduler_tick(self.database)["state"], "off")
        mismatch = {**self.policy, "source_sha256": "3" * 64}
        outcome = journal.scheduler_tick(self.database, mismatch)
        self.assertEqual((outcome["state"], outcome["reason"]), ("rejected", "PINNED_POLICY_MISMATCH"))
        self.assertEqual(journal.inspect(self.database, trial["trialId"])["state"], "rejected")

    def test_synthetic_batch_is_sequential_bounded_and_recovers_without_rerun(self):
        claim = self.claim()
        with patch.dict(os.environ, {"NODE_OPTIONS": "--require /missing/research-hook.js"}):
            with patch.object(supervisor, "ADAPTER", ROOT / "synthetic_adapter.mjs"):
                completed = supervisor.run_batch(self.database, claim)
        self.assertEqual(completed["state"], "completed")
        self.assertEqual(len(completed["paths"]), 44)
        self.assertEqual(completed["paths"][0]["variantId"], "synthetic-development")
        self.assertEqual(completed["paths"][1]["variantId"], "synthetic-frozen-control")
        self.assertTrue(all(path["state"] == "completed" for path in completed["paths"]))
        self.assertLessEqual(len(completed["result"].encode()), journal.MAX_RESULT_BYTES)
        recovered = self._inspect_in_new_process(completed["trialId"])
        self.assertEqual(recovered["resultSha256"], completed["resultSha256"])
        self.assertEqual(recovered["state"], "completed")
        self.assertFalse(recovered["executionAuthorized"])
        self.assertFalse(recovered["promotionAuthorized"])
        self.assertEqual(journal.enqueue(self.database, "trial-demo", self.source, self.data)["attempts"], 1)
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "idle")

    def test_path_timeout_kills_real_child_and_persists_timed_out_trial(self):
        started = time.monotonic()
        result = self.run_fault("b" * 64, {"path_seconds": 0.15, "batch_seconds": 0.7})
        self.assertEqual(result["state"], "timed_out")
        self.assertEqual(result["reason"], "DEADLINE_EXCEEDED")
        self.assertEqual(result["paths"][0]["state"], "started")
        self.assertLess(time.monotonic() - started, 2)

    def test_whole_batch_deadline_is_absolute_across_path_processes(self):
        started = time.monotonic()
        result = self.run_fault("7" * 64, {"path_seconds": 0.4, "batch_seconds": 0.6})
        self.assertEqual(result["state"], "timed_out")
        self.assertGreater(len(result["paths"]), 0)
        self.assertLess(time.monotonic() - started, 1.5)

    def test_output_flood_and_parent_exit_with_inherited_pipe_are_bounded(self):
        for source, reason in (("c" * 64, "STDOUT_BOUND"), ("9" * 64, "STDERR_BOUND"),
                               ("d" * 64, "DEADLINE_EXCEEDED")):
            with self.subTest(source=source):
                started = time.monotonic()
                result = self.run_fault(source, {"path_seconds": 0.2, "batch_seconds": 0.4},
                                        "trial-" + source[0])
                self.assertEqual(result["state"], "timed_out" if source.startswith("d") else "failed")
                self.assertEqual(result["reason"], reason)
                self.assertLess(time.monotonic() - started, 2)

    def test_missed_and_false_path_events_never_count_as_completed(self):
        missed = self.run_fault("f" * 64, key="trial-missed")
        false = self.run_fault("e" * 64, key="trial-false")
        partial = self.run_fault("8" * 64, key="trial-partial")
        self.assertEqual((missed["state"], missed["reason"]), ("failed", "EVENT_MISSING"))
        self.assertEqual((false["state"], false["reason"]), ("failed", "PATH_START_EVENT_INVALID"))
        self.assertEqual((partial["state"], partial["reason"]), ("partial", "PATH_COMPLETE_EVENT_INVALID"))
        self.assertEqual(len(partial["paths"]), 2)
        self.assertEqual([path["state"] for path in partial["paths"]], ["completed", "started"])

    def test_competing_process_claims_allow_only_one_and_budget_survives_new_ids(self):
        trial = self.enqueue()
        child = r'''
import json,sys
sys.path.insert(0,sys.argv[1])
import journal
policy=json.loads(sys.argv[3])
print(json.dumps(journal.scheduler_tick(sys.argv[2],policy,owner='process-'+str(sys.argv[4]))))
'''
        workers = [
            subprocess.Popen([sys.executable, "-B", "-c", child, str(ROOT), self.database,
                              json.dumps(self.policy), str(index)], stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
            for index in range(4)
        ]
        values = []
        for worker in workers:
            stdout, stderr = worker.communicate(timeout=10)
            self.assertEqual(worker.returncode, 0, stderr)
            values.append(json.loads(stdout))
        self.assertEqual(sum(value["claimed"] for value in values), 1)
        self.assertEqual(journal.inspect(self.database, trial["trialId"])["attempts"], 1)
        active = journal.inspect(self.database, trial["trialId"])
        journal.start(self.database, active)
        unresolved = self._inspect_in_new_process(trial["trialId"])
        self.assertEqual(unresolved["state"], "unknown")
        self.assertTrue(unresolved["unresolved"])
        second = self.enqueue("trial-new-id")
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")
        journal.reconcile(self.database, trial["trialId"], "OPERATOR_RECONCILED_UNKNOWN")
        rejected = journal.scheduler_tick(self.database, self.policy)
        self.assertEqual((rejected["state"], rejected["reason"]), ("rejected", "DAILY_BUDGET_EXHAUSTED"))
        self.assertEqual(journal.inspect(self.database, second["trialId"])["state"], "rejected")
        self.assertEqual(len(journal.budget_status(self.database)), 1)

    def test_failed_settlement_rolls_back_and_keeps_active_until_reconciliation(self):
        claim = self.claim()
        active = journal.start(self.database, claim)
        with sqlite_connect(self.database) as connection:
            connection.execute("""CREATE TRIGGER refuse_reconcile BEFORE UPDATE OF state ON jobs
                WHEN NEW.state='UNKNOWN' BEGIN SELECT RAISE(ABORT,'injected settlement interruption'); END""")
        with self.assertRaisesRegex(journal.JournalError, "JOURNAL_STORAGE_ERROR"):
            journal.reconcile(self.database, active["trialId"], "OPERATOR_RECONCILED_UNKNOWN")
        unresolved = journal.inspect(self.database, active["trialId"])
        self.assertTrue(unresolved["unresolved"])
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")
        with sqlite_connect(self.database) as connection:
            connection.execute("DROP TRIGGER refuse_reconcile")
        journal.reconcile(self.database, active["trialId"], "OPERATOR_RECONCILED_UNKNOWN")
        self.assertFalse(journal.inspect(self.database, active["trialId"])["unresolved"])

    def test_crash_after_claim_before_start_is_unresolved_and_reconcilable(self):
        claim = self.claim()
        restored = self._inspect_in_new_process(claim["trialId"])
        self.assertEqual(restored["state"], "unknown")
        self.assertTrue(restored["unresolved"])
        with self.assertRaisesRegex(journal.JournalError, "RECONCILIATION_INVALID"):
            journal.reconcile(self.database, claim["trialId"], "bad note")
        reconciled = journal.reconcile(self.database, claim["trialId"], "OPERATOR_RECONCILED_CLAIM")
        self.assertEqual(reconciled["state"], "unknown")
        self.assertFalse(reconciled["unresolved"])

    def test_result_capacity_failure_does_not_unlock_or_retry(self):
        claim = self.claim()
        active = journal.start(self.database, claim)
        with patch.object(journal, "MAX_RESULT_BYTES", 128):
            with self.assertRaisesRegex(journal.JournalError, "RESULT_BOUND"):
                journal.settle(self.database, active, "FAILED", "INJECTED_FAILURE")
        saved = journal.inspect(self.database, active["trialId"])
        self.assertTrue(saved["unresolved"])
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")

    def test_contract_rejects_unbounded_or_nonzero_model_budget(self):
        self.enqueue()
        for edit in ({"daily_model_calls": 1}, {"daily_batch_limit": 2},
                     {"daily_compute_seconds": journal.MAX_BATCH_SECONDS + 1}):
            with self.subTest(edit=edit), self.assertRaises(journal.JournalError):
                journal.scheduler_tick(self.database, {**self.policy, **edit})

    def _inspect_in_new_process(self, trial_id):
        code = r'''
import json,sys
sys.path.insert(0,sys.argv[1])
import journal
print(json.dumps(journal.inspect(sys.argv[2],sys.argv[3])))
'''
        completed = subprocess.run([sys.executable, "-B", "-c", code, str(ROOT), self.database, trial_id],
                                   capture_output=True, text=True, timeout=10)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)


class sqlite_connect:
    def __init__(self, database):
        import sqlite3
        self.connection = sqlite3.connect(database)

    def __enter__(self):
        return self.connection

    def __exit__(self, kind, value, traceback):
        if kind is None:
            self.connection.commit()
        else:
            self.connection.rollback()
        self.connection.close()


if __name__ == "__main__":
    unittest.main()
