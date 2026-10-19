import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
import journal
import supervisor


FAULT_ADAPTER = ROOT / "test_fault_adapter.mjs"
HISTORICAL_TEST_ADAPTER = ROOT / "test_b1_historical_fixture.mjs"
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

    def lock_database(self, exclusive=False):
        begin = "EXCLUSIVE" if exclusive else "IMMEDIATE"
        code = f'''
import sqlite3,sys
connection=sqlite3.connect(sys.argv[1],isolation_level=None)
connection.execute('BEGIN {begin}')
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

    def test_historical_journal_profile_stays_dormant_without_d2_receipt(self):
        self.database = str(Path(self.temporary.name) / "historical.sqlite")
        initialized = journal.initialize(
            self.database, profile=journal.HISTORICAL_PROFILE_NAME)
        profile = journal._b1_profile(journal.HISTORICAL_PROFILE_NAME)
        self.assertFalse(initialized["executionAuthorized"])
        self.assertEqual(profile["status"], "NOT_FROZEN")
        self.assertIsNone(profile["inputManifest"])
        self.assertIsNone(profile["approvalReceipt"])
        with self.assertRaises(journal.JournalError) as missing:
            journal.enqueue_b1(self.database, profile["trialKey"])
        self.assertEqual(missing.exception.code, "HISTORICAL_ADMISSION_REQUIRED")
        outcome = journal.scheduler_tick_b1(self.database, enabled=True)
        self.assertEqual(outcome["state"], "blocked")
        self.assertFalse(outcome["claimed"])
        self.assertFalse(outcome["executionAuthorized"])
        with sqlite_connect(self.database) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM b1_jobs").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT fence,active FROM b1_meta").fetchone(), (0, None))

    def b1_fault_adapter(self, mode):
        alias = Path(self.temporary.name) / f"b1-{mode}-adapter.mjs"
        alias.write_text(f"import {json.dumps((ROOT / 'test_b1_fault_adapter.mjs').as_uri())};\n")
        return alias

    def run_actual_b1_adapter_test_scenario(self, claim, scenario, manifest_path=None):
        original_popen = subprocess.Popen

        def spawn(*args, **kwargs):
            if Path(args[0][1]).resolve() == supervisor.B1_ADAPTER.resolve():
                environment = dict(kwargs["env"])
                environment.update({"NODE_ENV": "test", "B1_TEST_SCENARIO": scenario})
                if manifest_path is not None:
                    environment["B1_TEST_MANIFEST_PATH"] = str(manifest_path)
                kwargs["env"] = environment
            return original_popen(*args, **kwargs)

        with patch.object(supervisor.subprocess, "Popen", side_effect=spawn):
            return supervisor.run_b1_batch(
                self.database, claim, limits={"path_seconds": 10, "batch_seconds": 20})

    def prepare_historical_fixture(self, name, scenario="SUCCESS"):
        self.database = str(Path(self.temporary.name) / f"{name}.sqlite")
        profile_path = Path(self.temporary.name) / f"{name}-profile.json"
        generated = subprocess.run(
            ["node", str(HISTORICAL_TEST_ADAPTER), "--profile", str(profile_path), scenario],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=30)
        if generated.returncode:
            raise AssertionError(generated.stderr)
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path):
            journal.initialize(self.database, profile=journal.HISTORICAL_PROFILE_NAME)
            queued = journal.enqueue_b1(self.database, "trial-historical-d2-r1")
            outcome = journal.scheduler_tick_b1(self.database, enabled=True)
        self.assertTrue(outcome["claimed"])
        self.assertEqual(outcome["claim"]["trialId"], queued["trialId"])
        return profile_path, outcome["claim"]

    def run_historical_fixture(self, profile_path, claim, scenario, limits=None):
        original_popen = subprocess.Popen

        def spawn(*args, **kwargs):
            if Path(args[0][1]).resolve() == HISTORICAL_TEST_ADAPTER.resolve():
                environment = dict(kwargs["env"])
                environment.update({
                    "NODE_ENV": "test",
                    "B1_TEST_SCENARIO": scenario,
                    "B1_TEST_HISTORICAL_PROFILE_PATH": str(profile_path),
                })
                kwargs["env"] = environment
            return original_popen(*args, **kwargs)

        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.object(supervisor, "HISTORICAL_ADAPTER", HISTORICAL_TEST_ADAPTER),
              patch.object(supervisor.subprocess, "Popen", side_effect=spawn)):
            return supervisor.run_b1_batch(
                self.database, claim,
                limits=limits or {"path_seconds": 10, "batch_seconds": 20})

    def test_generated_historical_profile_runs_all_paths_and_refuses_repeat(self):
        profile_path, claim = self.prepare_historical_fixture("historical-success")
        result = self.run_historical_fixture(profile_path, claim, "SUCCESS")
        self.assertEqual(result["state"], "completed")
        self.assertEqual(result["attempts"], 1)
        self.assertEqual(len(result["paths"]), 44)
        self.assertEqual(result["executionAuthorized"], False)
        self.assertEqual(result["promotionAuthorized"], False)
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path):
            inspected = journal.inspect_b1(self.database, claim["trialId"])
            again = journal.scheduler_tick_b1(self.database, enabled=True)
        self.assertEqual(inspected["state"], "completed")
        self.assertEqual(inspected["attempts"], 1)
        self.assertFalse(again["claimed"])

    def test_generated_historical_insufficient_evidence_stays_failed_and_labeled(self):
        profile_path, claim = self.prepare_historical_fixture(
            "historical-insufficient", "INSUFFICIENT_EVIDENCE")
        result = self.run_historical_fixture(
            profile_path, claim, "INSUFFICIENT_EVIDENCE")
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["reason"], "INSUFFICIENT_EVIDENCE")
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path):
            inspected = journal.inspect_b1(self.database, claim["trialId"])
        summary = json.loads(inspected["result"])
        self.assertEqual(summary["status"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(summary["evidence"]["sourceAuthenticity"], "NOT_ESTABLISHED")
        self.assertFalse(summary["authority"]["executionAuthorized"])
        self.assertFalse(summary["authority"]["paperAuthorized"])

    def test_generated_historical_identity_corruption_fails_closed(self):
        profile_path, _ = self.prepare_historical_fixture("historical-corrupt")
        profile = json.loads(profile_path.read_text())
        profile["approvalReceipt"]["pathIds"][0] = "0" * 64
        profile_path.write_text(json.dumps(profile))
        database = str(Path(self.temporary.name) / "historical-corrupt-check.sqlite")
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path):
            with self.assertRaises(journal.JournalError) as invalid:
                journal.initialize(database, profile=journal.HISTORICAL_PROFILE_NAME)
        self.assertEqual(invalid.exception.code, "HISTORICAL_APPROVAL_INVALID")

    def test_generated_historical_timeout_keeps_attempt_and_fence_without_retry(self):
        profile_path, claim = self.prepare_historical_fixture("historical-timeout")
        result = self.run_historical_fixture(
            profile_path, claim, "HISTORICAL_TIMEOUT",
            limits={"path_seconds": 2, "batch_seconds": 1})
        self.assertEqual(result["state"], "timed_out")
        self.assertEqual(result["attempts"], 1)
        self.assertGreater(result["fence"], 0)
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path):
            again = journal.scheduler_tick_b1(self.database, enabled=True)
        self.assertFalse(again["claimed"])

    @staticmethod
    def b1_insufficient_profile():
        result = subprocess.run(
            ["node", str(ROOT / "test_b1_generated_fixture.mjs"), "--profile"],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise AssertionError(result.stderr)
        return json.loads(result.stdout)

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
        self.assertEqual(completed["resultSha256"],
                         hashlib.sha256(completed["result"].encode()).hexdigest())
        with sqlite_connect(self.database) as connection:
            summary_bytes, stored_summary_sha = connection.execute(
                "SELECT summary_json,summary_sha256 FROM b1_jobs WHERE trial_id=?",
                (completed["trialId"],)).fetchone()
        self.assertEqual(stored_summary_sha, hashlib.sha256(summary_bytes).hexdigest())
        self.assertEqual(completed["summarySha256"], hashlib.sha256(summary_bytes).hexdigest())
        actual = json.loads(completed["result"])
        self.assertEqual(actual, direct)
        self.assertEqual([path["pathId"] for path in actual["paths"]], direct["paths"] and
                         [path["pathId"] for path in direct["paths"]])
        progress = journal.inspect_b1(self.database, completed["trialId"])
        self.assertEqual(progress["attempts"], 1)
        self.assertFalse(progress["unresolved"])
        self.assertEqual(len(progress["paths"]), 44)
        self.assertEqual([item["phase"] for item in progress["paths"][:19]],
                         ["DEVELOPMENT"] * 19)
        self.assertEqual([item["phase"] for item in progress["paths"][19:]],
                         ["DIAGNOSTIC"] * 25)
        profile = journal._b1_profile()
        self.assertEqual([item["pathId"] for item in progress["paths"]],
                         [item["pathId"] for item in profile["computation"]])
        self.assertEqual(progress["controlBindings"], {
            "primaryDevelopmentSha256": progress["paths"][0]["payloadSha256"],
            "fullBasketDevelopmentSha256": progress["paths"][15]["payloadSha256"],
        })
        self.assertEqual(progress["controls"], json.dumps(
            direct["controlDefinitions"], separators=(",", ":"), ensure_ascii=True))
        self.assertTrue(direct["authority"]["researchOnly"])
        self.assertTrue(all(value is False for key, value in direct["authority"].items()
                            if key != "researchOnly"))

    def test_b1_engine_failure_preserves_reason_without_fabricating_controls(self):
        claim = self.new_b1_claim("trial-b1-engine-failure")
        result = self.run_actual_b1_adapter_test_scenario(claim, "ENGINE_FAILURE")

        self.assertEqual((result["state"], result["reason"]), ("failed", "BUDGET_EXCEEDED"))
        recovered = journal.inspect_b1(self.database, claim["trialId"])
        self.assertEqual(recovered["attempts"], 1)
        self.assertFalse(recovered["unresolved"])
        self.assertEqual(len(recovered["paths"]), 1)
        self.assertEqual(recovered["paths"][0]["state"], "started")
        self.assertIsNone(recovered["controls"])
        self.assertIsNone(recovered["result"])
        self.assertIsNone(recovered["summarySha256"])
        self.assertEqual(journal.scheduler_tick_b1(self.database, enabled=True)["state"], "idle")
        with self.assertRaisesRegex(journal.JournalError, "STALE_FENCE"):
            journal.start_b1(self.database, claim)

    def test_b1_generated_insufficient_evidence_settles_through_real_adapter_and_journal(self):
        profile_path = Path(self.temporary.name) / "insufficient-b1-profile.json"
        profile_path.write_text(json.dumps(self.b1_insufficient_profile()))
        with patch.object(journal, "B1_MANIFEST_PATH", profile_path):
            claim = self.new_b1_claim("trial-b1-insufficient-evidence")
            result = self.run_actual_b1_adapter_test_scenario(
                claim, "INSUFFICIENT_EVIDENCE", profile_path)
            recovered = journal.inspect_b1(self.database, claim["trialId"])
            self.assertEqual((result["state"], result["reason"]),
                             ("failed", "INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR"))
            self.assertEqual(recovered["attempts"], 1)
            self.assertFalse(recovered["unresolved"])
            self.assertEqual(len(recovered["paths"]), 19)
            self.assertTrue(all(path["state"] == "completed" for path in recovered["paths"]))
            self.assertTrue(all(path["phase"] == "DEVELOPMENT" for path in recovered["paths"]))
            controls = json.loads(recovered["controls"])
            self.assertEqual(controls["status"], "INSUFFICIENT_EVIDENCE")
            self.assertEqual(controls["reason"], "INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR")
            self.assertLessEqual(controls["benchmarkSd"], 1e-12)
            summary = json.loads(recovered["result"])
            self.assertEqual(summary["status"], "INSUFFICIENT_EVIDENCE")
            self.assertEqual(summary["controlDefinitions"], controls)
            self.assertEqual((summary["attemptedPaths"], summary["completedPaths"],
                              summary["computedPaths"], summary["plannedPaths"]),
                             (19, 19, 19, 44))
            self.assertIsNone(summary["failure"])
            self.assertEqual(summary["screen"], {"status": "INSUFFICIENT_EVIDENCE"})
            self.assertEqual(len(summary["paths"]), 44)
            completed = [path for path in summary["paths"]
                         if path["status"] != "NOT_RUN_INSUFFICIENT_EVIDENCE"]
            not_run = [path for path in summary["paths"]
                       if path["status"] == "NOT_RUN_INSUFFICIENT_EVIDENCE"]
            self.assertEqual(len(completed), 19)
            self.assertTrue(all(path["segmentId"] == "development" for path in completed))
            self.assertEqual(len(not_run), 25)
            self.assertTrue(all(path["segmentId"] == "diagnostic" for path in not_run))
            self.assertEqual(journal.scheduler_tick_b1(self.database, enabled=True)["state"], "idle")
            with self.assertRaisesRegex(journal.JournalError, "STALE_FENCE"):
                journal.start_b1(self.database, claim)

    def test_b1_manifest_claim_and_phase_boundaries_are_fixed(self):
        claim = self.new_b1_claim("trial-b1-boundary")
        with self.assertRaisesRegex(TypeError, "positional"):
            journal.enqueue_b1(self.database, "trial-other", "f" * 64)
        started = journal.start_b1(self.database, claim)
        with self.assertRaisesRegex(journal.JournalError, "PATH_ORDER"):
            journal.record_b1_path_started(self.database, started, 1, "0" * 64)
        with self.assertRaisesRegex(journal.JournalError, "PATH_ORDER"):
            journal.record_b1_path_started(self.database, started, 0, "0" * 64)
        controls = {
            "status": "FROZEN_DEVELOPMENT_ONLY",
            "meanExposure": 0.2,
            "riskExposure": 0.3,
            "primaryDevelopmentSd": 0.1,
            "fullBasketDevelopmentSd": 0.2,
            "calibration": "DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS",
        }
        with self.assertRaisesRegex(journal.JournalError, "CONTROLS_ORDER"):
            journal.record_b1_controls(self.database, started, json.dumps(controls).encode())
        self.assertEqual(journal.inspect_b1(self.database, claim["trialId"])["paths"], [])
        expected_path = journal._b1_profile()["computation"][0]["pathId"]
        journal.record_b1_path_started(self.database, started, 0, expected_path)
        with self.assertRaisesRegex(journal.JournalError, "PATH_ORDER"):
            journal.record_b1_path_started(self.database, started, 0, expected_path)
        with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
            journal.start_b1(self.database, claim)

    def test_b1_controls_are_bound_to_committed_development_results_once(self):
        direct = self.direct_b1_result()
        claim = self.new_b1_claim("trial-b1-control-freeze")
        journal.start_b1(self.database, claim)
        profile = journal._b1_profile()
        paths_by_id = {path["pathId"]: path for path in direct["paths"]}
        for index in range(19):
            path_id = profile["computation"][index]["pathId"]
            path = paths_by_id[path_id]
            journal.record_b1_path_started(self.database, claim, index, path_id)
            payload = json.dumps(path, separators=(",", ":"), ensure_ascii=True,
                                 allow_nan=False).encode()
            journal.record_b1_path_completed(self.database, claim, index, payload)

        diagnostic_id = profile["computation"][19]["pathId"]
        with self.assertRaisesRegex(journal.JournalError, "CONTROLS_NOT_FROZEN"):
            journal.record_b1_path_started(self.database, claim, 19, diagnostic_id)

        controls = dict(direct["controlDefinitions"])
        altered = dict(controls)
        altered["meanExposure"] += 0.01
        with self.assertRaisesRegex(journal.JournalError, "CONTROLS_BINDING_INVALID"):
            journal.record_b1_controls(
                self.database, claim, json.dumps(altered, separators=(",", ":")).encode())
        self.assertIsNone(journal.inspect_b1(self.database, claim["trialId"])["controls"])

        frozen = journal.record_b1_controls(
            self.database, claim, json.dumps(controls, separators=(",", ":")).encode())
        self.assertEqual(frozen["controlBindings"], {
            "primaryDevelopmentSha256": frozen["paths"][0]["payloadSha256"],
            "fullBasketDevelopmentSha256": frozen["paths"][15]["payloadSha256"],
        })
        with self.assertRaisesRegex(journal.JournalError, "CONTROLS_ORDER"):
            journal.record_b1_controls(
                self.database, claim, json.dumps(controls, separators=(",", ":")).encode())
        journal.record_b1_path_started(self.database, claim, 19, diagnostic_id)

    def test_b1_result_and_summary_schemas_reject_minimal_or_screenless_results(self):
        direct = self.direct_b1_result()
        profile = journal._b1_profile()
        descriptor = profile["paths"][0]
        minimal = {
            "pathId": descriptor["pathId"], "kind": descriptor["kind"],
            "variantId": descriptor["variantId"], "scenarioId": descriptor["scenarioId"],
            "segmentId": descriptor["segmentId"], "status": "COMPLETED", "attempts": 1,
        }
        with self.assertRaisesRegex(journal.JournalError, "PATH_RESULT_INVALID"):
            journal._validate_b1_path_payload(minimal, profile["computation"][0])

        summary = {key: value for key, value in direct.items()
                   if key not in ("paths", "controlDefinitions")}
        summary.pop("screen")
        with self.assertRaisesRegex(journal.JournalError, "RESULT_SCHEMA_INVALID"):
            journal.settle_b1(
                self.database, {}, "COMPLETED", "ALL_PATHS_COMPLETED",
                json.dumps(summary, separators=(",", ":"), allow_nan=False).encode())

    def test_b1_summary_rejects_coerced_counts_and_substituted_control_identity(self):
        direct = self.direct_b1_result()
        profile = journal._b1_profile()
        summary = {key: value for key, value in direct.items()
                   if key not in ("paths", "controlDefinitions")}
        summary["attemptedPaths"] = True
        with self.assertRaisesRegex(journal.JournalError, "RESULT_SCHEMA_INVALID"):
            journal._validate_b1_summary(summary, profile)

        summary = {key: value for key, value in direct.items()
                   if key not in ("paths", "controlDefinitions")}
        summary["controlRealization"][0]["variantId"] = "substituted-control"
        with self.assertRaisesRegex(journal.JournalError, "RESULT_SCHEMA_INVALID"):
            journal._validate_b1_summary(summary, profile)

    def test_b1_insufficient_evidence_schema_is_valid_but_never_completed(self):
        direct = self.direct_b1_result()
        summary = {key: value for key, value in direct.items()
                   if key not in ("paths", "controlDefinitions")}
        summary.update({
            "status": "INSUFFICIENT_EVIDENCE",
            "attemptedPaths": 19,
            "completedPaths": 19,
            "computedPaths": 19,
            "screen": {"status": "INSUFFICIENT_EVIDENCE"},
        })
        for control in summary["controlRealization"]:
            control["status"] = "NOT_RUN_INSUFFICIENT_EVIDENCE"
            control["frozenTargetExposure"] = None
            control["meanRealizedExposure"] = None
            control["meanTargetRealizedMismatch"] = None
            control["meanAbsoluteTargetMismatch"] = None
            control["maxAbsoluteTargetMismatch"] = None
        profile = journal._b1_profile()
        journal._validate_b1_summary(summary, profile, allow_insufficient=True)
        with self.assertRaisesRegex(journal.JournalError, "RESULT_SCHEMA_INVALID"):
            journal._validate_b1_summary(summary, profile)

    def test_b1_crash_after_committed_boundary_keeps_attempt_and_fence(self):
        claim = self.new_b1_claim("trial-b1-ack-loss")
        path_id = journal._b1_profile()["computation"][0]["pathId"]
        journal.start_b1(self.database, claim)
        journal.record_b1_path_started(self.database, claim, 0, path_id)
        recovered = journal.inspect_b1(self.database, claim["trialId"])
        self.assertTrue(recovered["unresolved"])
        self.assertEqual(recovered["attempts"], 1)
        self.assertEqual(recovered["paths"][0]["state"], "started")
        self.assertEqual(journal.scheduler_tick_b1(self.database, enabled=True)["state"], "active")
        with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
            journal.start_b1(self.database, claim)

    def test_b1_lost_ack_after_durable_boundaries_keeps_fence_and_attempt(self):
        cases = (
            ("start-ack-loss", 1, "started", None),
            ("path-ack-loss", 1, "completed", None),
            ("controls-ack-loss", 19, "completed", "FROZEN_DEVELOPMENT_ONLY"),
        )
        original_popen = subprocess.Popen
        for phase, expected_count, last_state, controls_status in cases:
            with self.subTest(phase=phase):
                claim = self.new_b1_claim("trial-b1-" + phase)
                alias = self.b1_fault_adapter(phase)
                children = []

                def spawn(*args, **kwargs):
                    child = original_popen(*args, **kwargs)
                    children.append(child)
                    return child

                with patch.object(supervisor, "B1_ADAPTER", alias), \
                        patch.object(supervisor.subprocess, "Popen", side_effect=spawn):
                    result = supervisor.run_b1_batch(
                        self.database, claim, limits={"path_seconds": 10, "batch_seconds": 8})
                self.assertEqual(result["state"], "UNSETTLED")
                self.assertEqual(result["reason"], "PARENT_ACK_FAILED")
                self.assertEqual(len(children), 1)
                self.assertIsNotNone(children[0].poll())
                current = journal.inspect_b1(self.database, claim["trialId"])
                self.assertTrue(current["unresolved"])
                self.assertEqual(current["attempts"], 1)
                self.assertEqual(len(current["paths"]), expected_count)
                self.assertEqual(current["paths"][-1]["state"], last_state)
                if controls_status:
                    self.assertEqual(json.loads(current["controls"])["status"], controls_status)
                self.assertEqual(journal.scheduler_tick_b1(
                    self.database, enabled=True)["state"], "active")
                with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
                    journal.start_b1(self.database, claim)
                journal.reconcile_b1(
                    self.database, claim["trialId"], "OPERATOR_RECONCILED_ACK_LOSS")

    def test_b1_preparation_path_calibration_and_finalization_share_deadline(self):
        scenarios = (
            ("prepare", 0),
            ("path", 1),
            ("calibration", 19),
            ("finalization", 44),
        )
        original_popen = subprocess.Popen
        for phase, expected_paths in scenarios:
            with self.subTest(phase=phase):
                claim = self.new_b1_claim("trial-b1-" + phase)
                alias = self.b1_fault_adapter(phase)
                marker = alias.parent / f"phase-{phase}.ready"
                marker.unlink(missing_ok=True)
                children = []

                def spawn(*args, **kwargs):
                    child = original_popen(*args, **kwargs)
                    children.append(child)
                    return child

                clock_origin = time.monotonic()
                clock_advances = [0]

                def deterministic_monotonic():
                    if marker.exists():
                        clock_advances[0] += 1
                        return clock_origin + 1801 * clock_advances[0]
                    return time.monotonic()

                with patch.object(supervisor, "B1_ADAPTER", alias), \
                        patch.object(supervisor.subprocess, "Popen", side_effect=spawn), \
                        patch.object(supervisor, "time",
                                     SimpleNamespace(monotonic=deterministic_monotonic)):
                    result = supervisor.run_b1_batch(
                        self.database, claim,
                        limits={"path_seconds": 60, "batch_seconds": 1800})
                self.assertEqual(len(children), 1)
                self.assertIsNotNone(children[0].poll(), "timed-out persistent child was not reaped")
                self.assertTrue(marker.is_file(), f"{phase} boundary was not reached")
                self.assertEqual((result["state"], result["reason"]),
                                 ("timed_out", "DEADLINE_EXCEEDED"))
                current = journal.inspect_b1(self.database, claim["trialId"])
                self.assertEqual(len(current["paths"]), expected_paths)
                if phase == "path":
                    self.assertEqual(current["paths"][0]["state"], "started")
                if phase in ("calibration", "finalization"):
                    self.assertTrue(all(path["state"] == "completed" for path in current["paths"]))
                self.assertFalse(current["unresolved"])
                self.assertEqual(current["attempts"], 1)
                marker.unlink(missing_ok=True)

    def test_b1_parent_ready_orders_result_fd_and_postcommit_child_failure_is_durable(self):
        claim = self.new_b1_claim("trial-b1-postcommit-child-failure")
        alias = self.b1_fault_adapter("postcommit")
        original_popen = subprocess.Popen
        children = []

        def spawn(*args, **kwargs):
            child = original_popen(*args, **kwargs)
            children.append(child)
            return child

        started_at = time.monotonic()
        with patch.object(supervisor, "B1_ADAPTER", alias), \
                patch.object(supervisor.subprocess, "Popen", side_effect=spawn):
            # This checks postcommit durability, not a ten-second throughput target.
            # The unchanged path cap and enclosing 90-second suite bound remain.
            result = supervisor.run_b1_batch(
                self.database, claim, limits={"path_seconds": 10, "batch_seconds": 30})
        elapsed = time.monotonic() - started_at

        self.assertEqual(len(children), 1)
        diagnostic = {
            "elapsedSeconds": round(elapsed, 3), "state": result.get("state"),
            "reason": result.get("reason"),
            "postSettlementFailure": result.get("postSettlementFailure"),
            "pathCount": len(result.get("paths", [])),
        }
        self.assertEqual(children[0].returncode, 1, diagnostic)
        self.assertEqual(result["state"], "completed")
        self.assertEqual(result["postSettlementFailure"], "TRAILING_CONTROL_EVENT")
        self.assertEqual(len(json.loads(result["result"])["paths"]), 44)
        recovered = journal.inspect_b1(self.database, claim["trialId"])
        self.assertEqual(recovered["state"], "completed")
        self.assertEqual(recovered["resultSha256"],
                         hashlib.sha256(recovered["result"].encode()).hexdigest())

    def test_b1_result_framing_schema_and_capacity_faults_never_complete(self):
        cases = (
            ("flood-control", "failed", "STDOUT_BOUND", 0),
            ("oversized-frame", "partial", "RESULT_CAPACITY", 1),
            ("duplicate-result", "partial", "PATH_RESULT_INVALID", 1),
            ("forged-digest", "partial", "PATH_RESULT_INVALID", 1),
            ("truncated-frame", "partial", "FRAME_TRUNCATED", 1),
            ("extra-frame", "partial", "EXTRA_RESULT_FRAME", 1),
            ("cumulative-cap", "partial", "RESULT_CAPACITY", 1),
        )
        for mode, expected_state, expected_reason, path_count in cases:
            with self.subTest(mode=mode):
                claim = self.new_b1_claim("trial-b1-frame-" + mode)
                alias = self.b1_fault_adapter(mode)
                with patch.object(supervisor, "B1_ADAPTER", alias):
                    if mode == "cumulative-cap":
                        with patch.object(journal, "MAX_RESULT_BYTES", 2_000):
                            result = supervisor.run_b1_batch(
                                self.database, claim,
                                limits={"path_seconds": 2, "batch_seconds": 3})
                    else:
                        result = supervisor.run_b1_batch(
                            self.database, claim,
                            limits={"path_seconds": 2, "batch_seconds": 3})
                self.assertEqual((result["state"], result["reason"]),
                                 (expected_state, expected_reason))
                self.assertNotEqual(result["state"], "completed")
                self.assertEqual(len(result["paths"]), path_count)
                self.assertFalse(result["executionAuthorized"])
                self.assertFalse(result["promotionAuthorized"])

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

    def test_b1_child_failure_with_unreadable_journal_returns_unsettled(self):
        claim = self.new_b1_claim("trial-b1-unreadable-journal")
        with patch.object(supervisor, "_run_b1_child",
                          side_effect=supervisor.ChildFailure("FRAME_TRUNCATED")), \
                patch.object(journal, "inspect_b1",
                             side_effect=journal.JournalError("PERSISTENCE_FAILURE")) as inspect, \
                patch.object(journal, "settle_b1") as settle:
            result = supervisor.run_b1_batch(self.database, claim)

        self.assertEqual((result["state"], result["trialId"], result["reason"]),
                         ("UNSETTLED", claim["trialId"], "PERSISTENCE_FAILURE"))
        self.assertFalse(result["persistConfirmed"])
        self.assertEqual(inspect.call_count, 2)
        settle.assert_not_called()
        current = journal.inspect_b1(self.database, claim["trialId"])
        self.assertTrue(current["unresolved"])
        self.assertEqual(current["attempts"], 1)
        self.assertEqual(current["paths"], [])
        with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
            journal.start_b1(self.database, claim)

    def test_b1_exclusive_lock_after_child_failure_returns_unsettled_and_reaps_child(self):
        claim = self.new_b1_claim("trial-b1-child-failure-lock")
        alias = self.b1_fault_adapter("path")
        original_popen = subprocess.Popen
        children = []
        result = []
        failure = []

        def spawn(*args, **kwargs):
            child = original_popen(*args, **kwargs)
            if str(alias) in args[0]:
                children.append(child)
            return child

        def execute():
            try:
                with patch.object(supervisor, "B1_ADAPTER", alias), \
                        patch.object(supervisor.subprocess, "Popen", side_effect=spawn):
                    result.append(supervisor.run_b1_batch(
                        self.database, claim,
                        limits={"path_seconds": 0.35, "batch_seconds": 2}))
            except BaseException as error:
                failure.append(error)

        thread = threading.Thread(target=execute)
        thread.start()
        lock = None
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    current = journal.inspect_b1(self.database, claim["trialId"])
                    if current["paths"] and current["paths"][0]["state"] == "started":
                        break
                except journal.JournalError as error:
                    if error.code != "DATABASE_BUSY":
                        raise
                time.sleep(0.005)
            else:
                self.fail("B1 fault child did not durably start its first path")

            lock = self.lock_database(exclusive=True)
            thread.join(3)
            self.assertFalse(thread.is_alive(), "B1 persistence failure blocked beyond its deadline")
            self.assertFalse(failure)
            self.assertEqual(len(children), 1)
            self.assertEqual((result[0]["state"], result[0]["trialId"], result[0]["reason"]),
                             ("UNSETTLED", claim["trialId"], "DATABASE_BUSY"))
            self.assertIsNotNone(children[0].poll(), "B1 child survived parent failure cleanup")
        finally:
            if lock is not None:
                self.release_lock(lock)
            thread.join(6)

        current = journal.inspect_b1(self.database, claim["trialId"])
        self.assertTrue(current["unresolved"])
        self.assertEqual(current["attempts"], 1)
        self.assertEqual([path["state"] for path in current["paths"]], ["started"])
        self.assertEqual(journal.scheduler_tick_b1(self.database, enabled=True)["state"], "active")
        with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
            journal.start_b1(self.database, claim)

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
                batch_seconds = 0.4 if source.startswith("d") else 10
                result = self.run_fault(source, {"path_seconds": 0.2, "batch_seconds": batch_seconds},
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
        thread, result, failure = self.run_in_thread(
            claim, {"path_seconds": 10, "batch_seconds": 10})
        lock = None
        try:
            marker_deadline = time.monotonic() + 8
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
            claim, {"path_seconds": 60, "batch_seconds": 1800})
        lock = None
        try:
            setup_deadline = time.monotonic() + 60
            while not marker.exists() and thread.is_alive() and time.monotonic() < setup_deadline:
                time.sleep(0.005)
            self.assertTrue(marker.exists(), f"final child did not reach barrier: {result!r} {failure!r}")
            self.wait_for_path_state(
                claim["trialId"], 44, "completed",
                timeout=max(0.1, setup_deadline - time.monotonic()))
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
