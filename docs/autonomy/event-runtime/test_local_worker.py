import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import durable_inbox as inbox
import local_worker as worker


class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        adapter = Path(os.environ.get("MERIDIAN_TEST_ADAPTER", str(worker.ADAPTER))).resolve()
        if not adapter.is_file(): raise RuntimeError("Stage sibling event-adapter")
        worker.ADAPTER = adapter
        fixtures = adapter.parent.parent / "review-binding/test/test_review_binding.py"
        spec = importlib.util.spec_from_file_location("binding_test_fixtures", fixtures)
        cls.fixtures = importlib.util.module_from_spec(spec); spec.loader.exec_module(cls.fixtures)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name) / "inbox.sqlite")
        inbox.initialize(self.db)
        observation, expected = self.fixtures.fixture()
        self.input = self.fixtures.adapter_input(observation, expected)
        self.raw = json.dumps(self.input, separators=(",", ":")).encode()
        self.binding = {"repository": "Achi1984/meridian", **self.input["snapshot"]["eventBinding"],
            "headSha": self.input["expected"]["headSha"], "baseSha": self.input["expected"]["baseSha"],
            "payloadSha256": hashlib.sha256(self.raw).hexdigest()}
        self.event = inbox.enqueue(self.db, self.binding)["eventId"]

    def tearDown(self): self.temp.cleanup()

    def test_actual_adapter_completion_persists_only_summary(self):
        result = worker.run_once(self.db, self.event, "worker1", self.raw)
        self.assertEqual(result["state"], "COMPLETE")
        self.assertTrue(result["persistConfirmed"])
        self.assertEqual(result["decision"]["decision"], "RECONCILE_EVENT")
        stored = inbox.inspect_event(self.db, self.event)
        summary = json.loads(stored["resultJson"])
        self.assertEqual(set(summary), {"decision", "reason"})
        self.assertFalse(result["mergeAllowed"])
        with self.assertRaises(inbox.InboxError): worker.run_once(self.db, self.event, "worker1", self.raw)

    def test_actual_adapter_ready_decision_retains_false_authority(self):
        observation, expected = self.fixtures.fixture()
        self.input["snapshot"]["work"]["responses"] = [self.fixtures.bind(observation, expected)["plannerResponse"]]
        raw = json.dumps(self.input, separators=(",", ":")).encode()
        binding = {**self.binding, "payloadSha256": hashlib.sha256(raw).hexdigest()}
        db = str(Path(self.temp.name) / "ready.sqlite"); inbox.initialize(db)
        event = inbox.enqueue(db, binding)["eventId"]
        result = worker.run_once(db, event, "worker1", raw)
        self.assertEqual(result["decision"]["decision"], "READY_FOR_OWNER_DECISION")
        self.assertEqual(result["decision"]["ledger"]["packets"][0]["state"], "COMPLETE_DRAFT")
        for key in ("authenticated", "provenanceVerified", "authorized", "dispatchAllowed", "mergeAllowed"):
            self.assertFalse(result[key]); self.assertFalse(result["decision"][key])
        self.assertEqual(json.loads(inbox.inspect_event(db, event)["resultJson"])["decision"], "READY_FOR_OWNER_DECISION")

    def test_database_loss_after_start_reports_unsettled_without_recreation(self):
        original = worker.execute_adapter
        def lost(payload, binding, timeout_seconds, preflight=False):
            result = original(payload, binding, timeout_seconds, preflight=preflight)
            if not preflight: os.unlink(self.db)
            return result
        with patch.object(worker, "execute_adapter", lost): result = worker.run_once(self.db, self.event, "worker1", self.raw)
        self.assertEqual(result["state"], "UNSETTLED"); self.assertFalse(result["persistConfirmed"])
        self.assertFalse(Path(self.db).exists())

    def test_bad_digest_and_actual_normalized_event_reject_before_claim(self):
        with self.assertRaises(worker.WorkerError): worker.run_once(self.db, self.event, "worker1", self.raw + b' ')
        self.assertEqual(inbox.inspect_event(self.db, self.event)["state"], "QUEUED")
        changed = dict(self.binding); changed["eventIdentity"] += "-wrong"
        bad_id = inbox.enqueue(self.db, changed)["eventId"]
        with self.assertRaises(worker.WorkerError): worker.run_once(self.db, bad_id, "worker1", self.raw)
        self.assertEqual(inbox.inspect_event(self.db, bad_id)["state"], "QUEUED")

    def test_timeout_after_start_is_unknown_no_restart_replay(self):
        original = worker.execute_adapter
        def execute(payload, binding, timeout_seconds, preflight=False):
            if preflight: return original(payload, binding, timeout_seconds, preflight=True)
            with patch.object(worker, "BRIDGE", "while(true){}"): return original(payload, binding, .1)
        with patch.object(worker, "execute_adapter", execute):
            result = worker.run_once(self.db, self.event, "worker1", self.raw)
        self.assertEqual(result["state"], "UNKNOWN"); self.assertTrue(result["persistConfirmed"])
        self.assertEqual(inbox.inspect_event(self.db, self.event)["state"], "UNKNOWN")
        with self.assertRaises(inbox.InboxError): worker.run_once(self.db, self.event, "worker2", self.raw)

    def test_process_error_and_output_overflow_stay_unknown(self):
        original = worker.execute_adapter
        for source in ("process.exit(2)", "while(true)process.stdout.write('X'.repeat(4096))", "while(true)process.stderr.write('X'.repeat(4096))"):
            # A fresh isolated database is needed because UNKNOWN is permanently consumed.
            db = str(Path(self.temp.name) / (hashlib.sha256(source.encode()).hexdigest() + ".sqlite"))
            inbox.initialize(db); event = inbox.enqueue(db, self.binding)["eventId"]
            def execute(payload, binding, timeout_seconds, preflight=False):
                if preflight: return original(payload, binding, timeout_seconds, preflight=True)
                with patch.object(worker, "BRIDGE", source): return original(payload, binding, .5)
            with patch.object(worker, "execute_adapter", execute): result = worker.run_once(db, event, "worker1", self.raw)
            self.assertEqual(result["state"], "UNKNOWN")

    def test_descendant_holding_pipe_is_bounded_and_node_options_removed(self):
        started = time.monotonic()
        source = "import {spawn} from 'node:child_process';spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:['ignore','inherit','inherit']});process.exit(0)"
        with patch.object(worker, "BRIDGE", source):
            with self.assertRaises(worker.WorkerError): worker.execute_adapter(self.raw.decode(), self.binding, .2)
        self.assertLess(time.monotonic() - started, 2)
        with patch.dict(os.environ, {"NODE_OPTIONS": "--require /definitely-not-a-file"}):
            result = worker.run_once(self.db, self.event, "worker1", self.raw)
        self.assertEqual(result["state"], "COMPLETE")

    def test_stale_fence_cannot_start_and_uncertain_persistence_is_explicit(self):
        original = inbox.claim
        def stale(*args):
            receipt = original(*args); receipt["fence"] += 1; return receipt
        with patch.object(inbox, "claim", stale): result = worker.run_once(self.db, self.event, "worker1", self.raw)
        self.assertEqual(result["state"], "UNSETTLED"); self.assertFalse(result["persistConfirmed"])
        self.assertEqual(inbox.inspect_event(self.db, self.event)["state"], "CLAIMED")
        with self.assertRaises(inbox.InboxError): inbox.claim(self.db, self.event, "worker1")

    def test_crash_after_started_remains_consumed_on_restart(self):
        claim = inbox.claim(self.db, self.event, "worker1"); inbox.start(self.db, claim)
        with self.assertRaises(inbox.InboxError): worker.run_once(self.db, self.event, "worker2", self.raw)
        self.assertEqual(inbox.inspect_event(self.db, self.event)["state"], "STARTED")


if __name__ == "__main__": unittest.main()
