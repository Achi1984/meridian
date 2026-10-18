import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
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

    def lock_database(self):
        code = r'''
import sqlite3,sys
connection=sqlite3.connect(sys.argv[1],isolation_level=None)
connection.execute('BEGIN IMMEDIATE')
print('LOCKED',flush=True)
sys.stdin.readline()
connection.rollback()
connection.close()
'''
        process = subprocess.Popen([sys.executable, "-c", code, self.database],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        self.assertEqual(process.stdout.readline().strip(), "LOCKED")
        return process

    def run_in_thread(self, claim, limits):
        result = []
        failure = []

        def execute():
            try:
                with patch.object(supervisor, "ADAPTER", FAULT_ADAPTER):
                    result.append(supervisor.run_batch(self.database, claim, limits=limits))
            except BaseException as error:
                failure.append(error)

        thread = threading.Thread(target=execute)
        thread.start()
        return thread, result, failure

    def new_b1_claim(self, key):
        self.database = str(Path(self.temporary.name) / (key + ".sqlite"))
        journal.initialize(self.database, profile=journal.B1_PROFILE_NAME)
        queued = journal.enqueue_b1(self.database, key)
        outcome = journal.scheduler_tick_b1(self.database, enabled=True)
        self.assertTrue(outcome["claimed"])
        self.assertEqual(outcome["claim"]["trialId"], queued["trialId"])
        return outcome["claim"]

    @staticmethod
    def direct_b1_result():
        code = r'''
import {readFileSync} from 'node:fs';
import {createSyntheticSeries} from './test/fixtures/b1-7/synthetic-series.mjs';
import {createExecution, canonicalJson, runBatch, sha256} from './scripts/research/b1-7/engine.mjs';
const fileSha = path => sha256(readFileSync(path));
const implementationSha256 = sha256(canonicalJson({
  capturedInputSha256: fileSha('scripts/research/b1-7/captured-input.mjs'),
  engineSha256: fileSha('scripts/research/b1-7/engine.mjs'),
  validatorSha256: fileSha('scripts/research/b1-7/validate.mjs')
}));
process.stdout.write(JSON.stringify(runBatch({
  seriesByAsset: createSyntheticSeries(),
  source: {kind: 'SYNTHETIC_FIXTURE'},
  implementationSha256
})));
'''
        result = subprocess.run(
            ["node", "--input-type=module", "-e", code],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise AssertionError(result.stderr)
        return json.loads(result.stdout)

    def test_b1_persistent_session_matches_direct_generated_fixture_result(self):
        direct = self.direct_b1_result()
        claim = self.new_b1_claim("trial-b1-parity")
        popen = subprocess.Popen
        with patch.object(subprocess, "Popen", wraps=popen) as child_start:
            completed = supervisor.run_b1_batch(self.database, claim)
        self.assertEqual(child_start.call_count, 1)
        self.assertEqual(completed["state"], "completed")
        actual = json.loads(completed["result"])
        self.assertEqual(actual, direct)
        self.assertEqual([path["pathId"] for path in actual["paths"]], direct["paths"] and
                         [path["pathId"] for path in direct["paths"]])
        progress = journal.inspect_b1(self.database, completed["trialId"])
        self.assertEqual(progress["attempts"], 1)
        self.assertFalse(progress["unresolved"])
        self.assertEqual(len(progress["paths"]), 44)
        self.assertEqual(progress["controls"], json.dumps(
            direct["controlDefinitions"], separators=(",", ":"), ensure_ascii=True))
        self.assertTrue(direct["authority"]["researchOnly"])
        self.assertTrue(all(value is False for key, value in direct["authority"].items()
                            if key != "researchOnly"))

    def test_b1_manifest_claim_and_phase_boundaries_are_fixed(self):
        claim = self.new_b1_claim("trial-b1-boundary")
        with self.assertRaisesRegex(TypeError, "positional"):
            journal.enqueue_b1(self.database, "trial-other", "f" * 64)
        started = journal.start_b1(self.database, claim)
        with self.assertRaisesRegex(journal.JournalError, "PATH_ORDER"):
            journal.record_b1_path_started(self.database, started, 1, "0" * 64)
        with self.assertRaisesRegex(journal.JournalError, "PATH_ORDER"):
            journal.record_b1_path_started(self.database, started, 0, "0" * 64)
        self.assertEqual(journal.inspect_b1(self.database, claim["trialId"])["paths"], [])
        with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
            journal.start_b1(self.database, claim)

    def test_b1_source_pin_tampering_fails_before_path_work(self):
        claim = self.new_b1_claim("trial-b1-source-pin")
        profile = json.loads(journal.B1_MANIFEST_PATH.read_text())
        profile["sourceSha256"]["adapter"] = "0" * 64
        temporary_manifest = Path(self.temporary.name) / "tampered-b1-manifest.json"
        temporary_manifest.write_text(json.dumps(profile))
        with patch.object(journal, "B1_MANIFEST_PATH", temporary_manifest):
            result = supervisor.run_b1_batch(self.database, claim)
        self.assertEqual((result["state"], result["reason"]),
                         ("UNSETTLED", "B1_SOURCE_PIN_MISMATCH"))
        current = journal.inspect_b1(self.database, claim["trialId"])
        self.assertEqual(current["state"], "unknown")
        self.assertEqual(current["paths"], [])
        self.assertTrue(current["unresolved"])

    def wait_for_path_state(self, trial_id, count, state, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                current = journal.inspect(self.database, trial_id)
                if len(current["paths"]) >= count and current["paths"][count - 1]["state"] == state:
                    return current
            except journal.JournalError as error:
                if error.code != "DATABASE_BUSY":
                    raise
            time.sleep(0.005)
        self.fail(f"path {count} did not reach {state}")

    @staticmethod
    def release_lock(process):
        process.stdin.write("\n")
        process.stdin.flush()
        process.wait(timeout=5)
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()

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

    def test_whole_batch_deadline_preempts_a_long_path(self):
        started = time.monotonic()
        result = self.run_fault("b" * 64, {"path_seconds": 2, "batch_seconds": 1.2},
                                key="trial-batch-deadline")
        self.assertIn(result["state"], ("timed_out", "UNSETTLED"))
        self.assertLess(time.monotonic() - started, 2.5)
        if result["state"] == "UNSETTLED":
            current = journal.inspect(self.database, result["trialId"])
            self.assertEqual(current["state"], "unknown")
            self.assertTrue(current["unresolved"])
            self.assertEqual(current["paths"][0]["state"], "started")
            journal.reconcile(self.database, result["trialId"], "OPERATOR_RECONCILED_DEADLINE")
        else:
            self.assertEqual(result["paths"][0]["state"], "started")

    def test_whole_batch_deadline_is_absolute_across_path_processes(self):
        # Each child waits 25 ms, so all 44 paths cannot finish in one second.
        # The longer path limit isolates the shared batch deadline; restarting
        # that deadline per child would incorrectly complete the entire batch.
        started = time.monotonic()
        result = self.run_fault("7" * 64, {"path_seconds": 2, "batch_seconds": 1},
                                key="trial-absolute-batch-deadline")
        self.assertLess(time.monotonic() - started, 2.5)
        self.assertIn((result["state"], result["reason"]), (
            ("timed_out", "DEADLINE_EXCEEDED"),
            ("UNSETTLED", "OPERATION_DEADLINE"),
        ))
        current = journal.inspect(self.database, result["trialId"])
        completed = sum(path["state"] == "completed" for path in current["paths"])
        self.assertGreaterEqual(completed, 2, "deadline must span multiple child processes")
        self.assertLess(completed, journal.MAX_PATHS)
        self.assertEqual(current["attempts"], 1)
        if result["state"] == "UNSETTLED":
            self.assertEqual(current["state"], "unknown")
            self.assertTrue(current["unresolved"])
            self.assertFalse(result["persistConfirmed"])
            self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")
            with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
                journal.start(self.database, current)
            journal.reconcile(self.database, result["trialId"], "OPERATOR_RECONCILED_DEADLINE")
        else:
            self.assertEqual(current["state"], "timed_out")
            self.assertFalse(current["unresolved"])
        with self.assertRaisesRegex(journal.JournalError, "STALE_FENCE"):
            journal.start(self.database, current)

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

    def test_sqlite_lock_during_path_start_kills_process_group_without_retry(self):
        self.database = str(Path(self.temporary.name) / "path-start-lock.sqlite")
        journal.initialize(self.database)
        claim = self.claim("trial-start-lock", "2" * 64, self.data)
        marker = Path(f"/tmp/meridian-m11-descendant-{os.getpid()}.pid")
        proceed = Path(str(marker) + ".go")
        marker.unlink(missing_ok=True)
        proceed.unlink(missing_ok=True)
        started = time.monotonic()
        thread, result, failure = self.run_in_thread(
            claim, {"path_seconds": 0.2, "batch_seconds": 0.35})
        lock = None
        try:
            marker_deadline = time.monotonic() + 2
            while not marker.exists() and time.monotonic() < marker_deadline:
                time.sleep(0.005)
            self.assertTrue(marker.exists(), "fault child did not launch after durable start")
            lock = self.lock_database()
            callback_started = time.monotonic()
            proceed.touch()
            thread.join(0.5)
            self.assertFalse(thread.is_alive(), "SQLite contention blocked the path-start watchdog")
            self.assertFalse(failure)
            self.assertEqual(result[0]["state"], "UNSETTLED")
            self.assertEqual(result[0]["reason"], "DATABASE_BUSY")
            self.assertLess(time.monotonic() - callback_started, 0.15)
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertTrue(marker.is_file())
            child_pid = int(marker.read_text())
            time.sleep(0.65)
        finally:
            if lock is not None:
                self.release_lock(lock)
            thread.join(6)
        self.assertFalse(thread.is_alive())
        self.assertEqual(journal.inspect(self.database, claim["trialId"])["attempts"], 1)
        self.assertEqual(journal.inspect(self.database, claim["trialId"])["paths"], [])
        with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
            journal.start(self.database, claim)
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            pass
        else:
            try:
                process_state = Path(f"/proc/{child_pid}/stat").read_text().split()[2]
            except FileNotFoundError:
                process_state = "X"
            self.assertEqual(process_state, "Z", "descendant survived process-group termination")
        marker.unlink(missing_ok=True)
        proceed.unlink(missing_ok=True)

    def test_sqlite_lock_during_path_finish_returns_unsettled_without_retry(self):
        self.database = str(Path(self.temporary.name) / "path-finish-lock.sqlite")
        journal.initialize(self.database)
        claim = self.claim("trial-finish-lock", "3" * 64, self.data)
        thread, result, failure = self.run_in_thread(
            claim, {"path_seconds": 0.5, "batch_seconds": 2})
        lock = None
        try:
            self.wait_for_path_state(claim["trialId"], 1, "started")
            lock = self.lock_database()
            thread.join(0.5)
            self.assertFalse(thread.is_alive(), "SQLite contention blocked the path-finish watchdog")
            self.assertFalse(failure)
            self.assertEqual((result[0]["state"], result[0]["reason"]), ("UNSETTLED", "DATABASE_BUSY"))
            time.sleep(0.65)
        finally:
            if lock is not None:
                self.release_lock(lock)
            thread.join(6)
        current = journal.inspect(self.database, claim["trialId"])
        self.assertTrue(current["unresolved"])
        self.assertEqual(current["attempts"], 1)
        self.assertEqual([path["state"] for path in current["paths"]], ["started"])
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")

    def test_sqlite_lock_during_final_settlement_retains_completed_progress_and_fence(self):
        self.database = str(Path(self.temporary.name) / "settlement-lock.sqlite")
        journal.initialize(self.database)
        claim = self.claim("trial-settlement-lock", "4" * 64, self.data)
        marker = Path(f"/tmp/meridian-m11-settlement-{os.getpid()}.ready")
        proceed = Path(str(marker) + ".go")
        marker.unlink(missing_ok=True)
        proceed.unlink(missing_ok=True)
        # Startup of 44 real children is setup, not the contention measurement.
        # A final-child barrier separates it from the unchanged 0.6 s check.
        thread, result, failure = self.run_in_thread(
            claim, {"path_seconds": 10, "batch_seconds": 30})
        lock = None
        try:
            setup_deadline = time.monotonic() + 20
            while not marker.exists() and thread.is_alive() and time.monotonic() < setup_deadline:
                time.sleep(0.005)
            self.assertTrue(marker.exists(), f"final child did not reach barrier: {result!r} {failure!r}")
            self.wait_for_path_state(claim["trialId"], 44, "completed")
            lock = self.lock_database()
            callback_started = time.monotonic()
            proceed.touch()
            thread.join(0.6)
            self.assertFalse(thread.is_alive(), "SQLite contention blocked final settlement")
            self.assertFalse(failure)
            self.assertEqual((result[0]["state"], result[0]["reason"]), ("UNSETTLED", "DATABASE_BUSY"))
            self.assertLess(time.monotonic() - callback_started, 0.6)
            time.sleep(0.65)
        finally:
            proceed.touch()
            if lock is not None:
                self.release_lock(lock)
            thread.join(6)
            marker.unlink(missing_ok=True)
            proceed.unlink(missing_ok=True)
        current = journal.inspect(self.database, claim["trialId"])
        self.assertTrue(current["unresolved"])
        self.assertEqual(current["attempts"], 1)
        self.assertEqual(len(current["paths"]), 44)
        self.assertTrue(all(path["state"] == "completed" for path in current["paths"]))
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")
        recovered = journal.reconcile(self.database, claim["trialId"], "OPERATOR_RECONCILED_UNKNOWN")
        self.assertEqual(recovered["state"], "unknown")
        self.assertEqual(len(recovered["paths"]), 44)
        with self.assertRaisesRegex(journal.JournalError, "STALE_FENCE"):
            journal.start(self.database, claim)

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
