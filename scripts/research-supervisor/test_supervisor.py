import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
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
MAX_DIAGNOSTIC_ELAPSED_MS = 60_000
MAX_DIAGNOSTIC_PATHS = 44
MAX_DIAGNOSTIC_CPU_COUNT = 1024
MAX_DIAGNOSTIC_HELPER_CALLS = 100_000
HISTORICAL_FIXTURE_LIMITS = {"path_seconds": 10, "batch_seconds": 20}
HISTORICAL_HELPERS = {
    "_historical_profile": "profile",
    "_b1_job": "job",
    "_validate_b1_path_payload": "payload",
}
HISTORICAL_JOURNAL_STATES = {
    "queued", "claimed", "running", "completed", "rejected",
    "failed", "timed_out", "partial", "unknown",
}


def _bounded_diagnostic_ms(value):
    if type(value) not in (int, float) or value < 0 or value > MAX_DIAGNOSTIC_ELAPSED_MS:
        return None
    try:
        if not math.isfinite(value):
            return None
        return round(float(value), 3)
    except (OverflowError, TypeError, ValueError):
        return None


def _record_path_timing(timings, index, field, started_at, clock):
    try:
        if type(index) is not int or not 0 <= index < MAX_DIAGNOSTIC_PATHS:
            return
        if index not in timings and len(timings) >= MAX_DIAGNOSTIC_PATHS:
            return
        if type(started_at) not in (int, float):
            return
        elapsed_ms = _bounded_diagnostic_ms((clock() - started_at) * 1000)
        if elapsed_ms is None:
            return
        record = timings.setdefault(index, {"index": index})
        record[field] = elapsed_ms
    except BaseException:
        pass


def _timed_path_callback(callback, phase, timings, started_at, clock=time.monotonic):
    attempt_field = f"{phase}AttemptMs"
    accepted_field = f"{phase}AcceptedMs"

    def wrapped(*args, **kwargs):
        index = args[2] if len(args) > 2 else kwargs.get("index")
        _record_path_timing(timings, index, attempt_field, started_at, clock)
        try:
            result = callback(*args, **kwargs)
        except BaseException:
            raise
        _record_path_timing(timings, index, accepted_field, started_at, clock)
        return result

    return wrapped


def _record_historical_helper_metric(metrics, helper, field, amount=1):
    try:
        record = metrics[helper]
        current = record.get(field)
        if field in ("calls", "successfulCalls"):
            if type(current) is not int or current < 0:
                return
            if current >= MAX_DIAGNOSTIC_HELPER_CALLS:
                record[f"{field}Capped"] = True
            else:
                record[field] = current + amount
        elif field == "inclusiveMs":
            bounded_current = _bounded_diagnostic_ms(current)
            if (bounded_current is None or type(amount) not in (int, float)
                    or amount < 0 or not math.isfinite(amount)):
                return
            bounded_amount = min(round(float(amount), 3), MAX_DIAGNOSTIC_ELAPSED_MS)
            total = bounded_current + bounded_amount
            record[field] = _bounded_diagnostic_ms(
                min(total, MAX_DIAGNOSTIC_ELAPSED_MS))
            if total > MAX_DIAGNOSTIC_ELAPSED_MS or amount > MAX_DIAGNOSTIC_ELAPSED_MS:
                record["inclusiveMsCapped"] = True
    except BaseException:
        pass


def _timed_historical_helper(callback, helper, metrics, clock=time.monotonic):
    def wrapped(*args, **kwargs):
        started_at = None
        try:
            started_at = clock()
        except BaseException:
            pass
        _record_historical_helper_metric(metrics, helper, "calls")
        try:
            result = callback(*args, **kwargs)
        except BaseException:
            try:
                elapsed = (clock() - started_at) * 1000
                _record_historical_helper_metric(metrics, helper, "inclusiveMs", elapsed)
            except BaseException:
                pass
            raise
        _record_historical_helper_metric(metrics, helper, "successfulCalls")
        try:
            elapsed = (clock() - started_at) * 1000
            _record_historical_helper_metric(metrics, helper, "inclusiveMs", elapsed)
        except BaseException:
            pass
        return result

    return wrapped


def _historical_helper_diagnostic_fields(metrics):
    if type(metrics) is not dict:
        return {}
    measured = {}
    for helper, label in HISTORICAL_HELPERS.items():
        try:
            record = metrics.get(helper)
            if type(record) is not dict:
                continue
            calls = record.get("calls")
            successes = record.get("successfulCalls")
            elapsed = _bounded_diagnostic_ms(record.get("inclusiveMs"))
            if (type(calls) is not int or not 0 <= calls <= MAX_DIAGNOSTIC_HELPER_CALLS
                    or type(successes) is not int or not 0 <= successes <= calls
                    or elapsed is None):
                continue
            entry = {"calls": calls, "successfulCalls": successes, "inclusiveMs": elapsed}
            for field in ("callsCapped", "successfulCallsCapped", "inclusiveMsCapped"):
                if record.get(field) is True:
                    entry[field] = True
            measured[label] = entry
        except BaseException:
            continue
    if not measured:
        return {}
    return {
        "historicalHelperMetrics": measured,
        "historicalHelperTiming": "inclusive_overlapping",
    }


def _best_effort_historical_journal_inspection(database, trial_id, profile_path):
    try:
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            inspected = journal.inspect_b1(database, trial_id)
        return (inspected, None) if type(inspected) is dict else (None, "INSPECTION_UNAVAILABLE")
    except BaseException:
        return None, "INSPECTION_UNAVAILABLE"


def _best_effort_host_metrics():
    cpu_count = None
    load1 = None
    try:
        cpu_count = os.cpu_count()
    except BaseException:
        pass
    try:
        getloadavg = getattr(os, "getloadavg", None)
        if callable(getloadavg):
            loads = getloadavg()
            if type(loads) in (tuple, list) and loads:
                load1 = loads[0]
    except BaseException:
        pass
    return cpu_count, load1


def _timing_diagnostic_fields(timings):
    records = []
    if type(timings) is dict:
        for index in sorted(key for key in timings
                            if type(key) is int and 0 <= key < MAX_DIAGNOSTIC_PATHS)[:MAX_DIAGNOSTIC_PATHS]:
            record = timings.get(index)
            if type(record) is not dict or type(record.get("index")) is not int \
                    or record["index"] != index:
                continue
            values = {
                field: _bounded_diagnostic_ms(record.get(field))
                for field in ("startAttemptMs", "startAcceptedMs",
                              "completionAttemptMs", "completionAcceptedMs")
            }
            records.append((index, values))

    fields = {}
    start_attempts = [(index, values["startAttemptMs"])
                      for index, values in records if values["startAttemptMs"] is not None]
    start_accepted_count = sum(values["startAcceptedMs"] is not None
                               for _, values in records)
    completion_attempt_count = sum(values["completionAttemptMs"] is not None
                                   for _, values in records)
    completed = [(index, values["completionAcceptedMs"])
                 for index, values in records if values["completionAcceptedMs"] is not None]
    latencies = [
        values["completionAcceptedMs"] - values["startAcceptedMs"]
        for _, values in records
        if values["startAcceptedMs"] is not None
        and values["completionAcceptedMs"] is not None
        and values["completionAcceptedMs"] >= values["startAcceptedMs"]
    ]

    if start_attempts:
        fields["startupToFirstPathMs"] = min(value for _, value in start_attempts)
    fields["pathStartAttemptCount"] = len(start_attempts)
    fields["pathStartAcceptedCount"] = start_accepted_count
    fields["pathCompletionAttemptCount"] = completion_attempt_count
    fields["pathCompletionAcceptedCount"] = len(completed)
    if completed:
        fields["completedPathIndices0Based"] = sorted(index for index, _ in completed)
        fields["lastCompletedIndex0Based"] = max(completed, key=lambda item: item[1])[0]
    if latencies:
        ordered = sorted(latencies)
        fields["maxPathMs"] = round(ordered[-1], 3)
        middle = len(ordered) // 2
        median = ordered[middle] if len(ordered) % 2 else (
            ordered[middle - 1] + ordered[middle]) / 2
        fields["medianPathMs"] = round(median, 3)
    return fields


def _generated_historical_result_diagnostic(
        result, elapsed_ms=None, configured_batch_seconds=None, *,
        path_timings=None, journal_snapshot=None, inspection_error=None,
        cpu_count=None, load1=None, helper_metrics=None):
    diagnostic = {}
    if type(result) is dict:
        for key in ("state", "reason"):
            value = result.get(key)
            if type(value) is str and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", value):
                diagnostic[key] = value
        trial_id = result.get("trialId")
        if type(trial_id) is str and re.fullmatch(r"[a-f0-9]{64}", trial_id):
            diagnostic["trialId"] = trial_id
        attempts = result.get("attempts")
        if type(attempts) is int and attempts in (0, 1):
            diagnostic["attempts"] = attempts
        paths = result.get("paths")
        if type(paths) is list and len(paths) <= MAX_DIAGNOSTIC_PATHS:
            diagnostic["pathCount"] = len(paths)
            diagnostic["completedPathCount"] = sum(
                type(path) is dict and path.get("state") == "completed" for path in paths)

    bounded_elapsed = _bounded_diagnostic_ms(elapsed_ms)
    if bounded_elapsed is not None:
        diagnostic["elapsedMs"] = bounded_elapsed
    if (type(configured_batch_seconds) in (int, float) and
            0 < configured_batch_seconds <= journal.MAX_BATCH_SECONDS and
            math.isfinite(configured_batch_seconds)):
        diagnostic["configuredBatchSeconds"] = configured_batch_seconds

    diagnostic.update(_timing_diagnostic_fields(path_timings))
    diagnostic.update(_historical_helper_diagnostic_fields(helper_metrics))
    if type(journal_snapshot) is dict:
        state = journal_snapshot.get("state")
        if type(state) is str and state in HISTORICAL_JOURNAL_STATES:
            diagnostic["journalState"] = state
        attempts = journal_snapshot.get("attempts")
        if type(attempts) is int and attempts in (0, 1):
            diagnostic["journalAttemptCount"] = attempts
        paths = journal_snapshot.get("paths")
        if type(paths) is list and len(paths) <= MAX_DIAGNOSTIC_PATHS:
            diagnostic["journalPathCount"] = len(paths)
            diagnostic["journalCompletedPathCount"] = sum(
                type(path) is dict and path.get("state") == "completed" for path in paths)
    if inspection_error == "INSPECTION_UNAVAILABLE":
        diagnostic["journalInspectionError"] = inspection_error

    if type(cpu_count) is int and 1 <= cpu_count <= MAX_DIAGNOSTIC_CPU_COUNT:
        diagnostic["cpuCount"] = cpu_count
    bounded_load1 = _bounded_diagnostic_ms(load1)
    if bounded_load1 is not None:
        diagnostic["load1"] = bounded_load1

    rendered = json.dumps(diagnostic, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(rendered) <= 1024:
        return rendered
    for key in ("completedPathIndices0Based", "trialId", "reason", "state"):
        diagnostic.pop(key, None)
        rendered = json.dumps(diagnostic, sort_keys=True, separators=(",", ":"), allow_nan=False)
        if len(rendered) <= 1024:
            return rendered
    for key in ("cpuCount", "load1", "journalInspectionError", "journalState", "journalAttemptCount",
                "journalPathCount", "journalCompletedPathCount", "completedPathCount",
                "pathCount", "startupToFirstPathMs", "pathStartAttemptCount",
                "pathStartAcceptedCount", "pathCompletionAttemptCount",
                "pathCompletionAcceptedCount", "lastCompletedIndex0Based",
                "maxPathMs", "medianPathMs", "configuredBatchSeconds", "elapsedMs"):
        diagnostic.pop(key, None)
        rendered = json.dumps(diagnostic, sort_keys=True, separators=(",", ":"), allow_nan=False)
        if len(rendered) <= 1024:
            return rendered
    return "{}"


def _b1_readiness_diagnostic(thread, result, failure, children, last_state):
    def bounded_repr(value, limit):
        try:
            rendered = repr(value)
        except BaseException:
            rendered = "<repr failed>"
        return rendered if len(rendered) <= limit else rendered[:limit - 3] + "..."

    child_states = []
    for child in children[:8]:
        state = {"pid": child.pid}
        try:
            state["exit_status"] = child.poll()
        except BaseException as error:
            state["poll_error"] = bounded_repr(error, 256)
        child_states.append(state)

    diagnostic = {
        "thread_alive": thread.is_alive(),
        "result": [
            {
                "state": bounded_repr(item.get("state"), 128),
                "reason": bounded_repr(item.get("reason"), 256),
            }
            for item in result[:2]
        ],
        "worker_exceptions": [bounded_repr(error, 384) for error in failure[:2]],
        "children": child_states,
        "children_omitted": max(0, len(children) - len(child_states)),
        "last_journal_state": last_state,
    }
    rendered = json.dumps(diagnostic, sort_keys=True, separators=(",", ":"))
    return rendered if len(rendered) <= 4096 else rendered[:4096]


def _deadline_diagnostic(elapsed, result, current, completed):
    diagnostic = {
        "elapsed_seconds": round(elapsed, 3),
        "completed_paths": completed,
        "path_count": len(current["paths"]),
        "result_state": result.get("state"),
        "result_reason": result.get("reason"),
        "trial_state": current["state"],
        "unresolved": current["unresolved"],
        "attempts": current["attempts"],
    }
    rendered = json.dumps(diagnostic, sort_keys=True, separators=(",", ":"))
    return rendered if len(rendered) <= 1024 else rendered[:1021] + "..."


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
            if Path(args[0][-1]).resolve() == supervisor.B1_ADAPTER.resolve():
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
        profile_path = Path(self.temporary.name) / f"historical-test-{name}.json"
        generated = subprocess.run(
            ["node", str(HISTORICAL_TEST_ADAPTER), "--profile", str(profile_path), scenario],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=30)
        if generated.returncode:
            raise AssertionError(generated.stderr)
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            journal.initialize(self.database, profile=journal.HISTORICAL_PROFILE_NAME)
            queued = journal.enqueue_b1(self.database, "trial-historical-d2-r1")
            outcome = journal.scheduler_tick_b1(self.database, enabled=True)
        self.assertTrue(outcome["claimed"])
        self.assertEqual(outcome["claim"]["trialId"], queued["trialId"])
        return profile_path, outcome["claim"]

    def run_historical_fixture(self, profile_path, claim, scenario, limits=None):
        original_popen = subprocess.Popen

        def spawn(*args, **kwargs):
            if Path(args[0][-1]).resolve() == HISTORICAL_TEST_ADAPTER.resolve():
                environment = dict(kwargs["env"])
                environment.update({
                    "NODE_ENV": "test",
                    "B1_TEST_SCENARIO": scenario,
                    "B1_TEST_HISTORICAL_PROFILE_PATH": str(profile_path),
                })
                kwargs["env"] = environment
            return original_popen(*args, **kwargs)

        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"}),
              patch.object(supervisor, "HISTORICAL_ADAPTER", HISTORICAL_TEST_ADAPTER),
              patch.object(supervisor.subprocess, "Popen", side_effect=spawn)):
            return supervisor.run_b1_batch(
                self.database, claim,
                limits=limits or HISTORICAL_FIXTURE_LIMITS)

    def test_generated_historical_result_diagnostic_is_allowlisted_and_bounded(self):
        trial_id = "a" * 64
        private_text = "PRIVATE_DIAGNOSTIC_TEXT " + ("x" * 2048)
        result = {
            "state": "UNSETTLED",
            "reason": "OPERATION_DEADLINE",
            "trialId": trial_id,
            "attempts": True,
            "paths": [
                {"state": "completed", "path": "/synthetic/private/path"},
                {"state": "started", "path": "../private/path"},
            ],
            "realPath": "/home/runner/private",
            "freeText": private_text,
            "extraField": {"value": "not permitted"},
        }
        timings = {
            index: {
                "index": index,
                "startAttemptMs": 10 + index,
                "startAcceptedMs": 11 + index,
                "completionAttemptMs": 21 + index,
                "completionAcceptedMs": 23 + index,
                "pathId": private_text,
            }
            for index in range(MAX_DIAGNOSTIC_PATHS)
        }
        journal_snapshot = {
            "state": "completed",
            "attempts": 1,
            "paths": [
                {"state": "completed", "pathId": private_text, "payload": private_text}
                for _ in range(MAX_DIAGNOSTIC_PATHS)
            ],
            "reason": private_text,
        }

        diagnostic = _generated_historical_result_diagnostic(
            result, 1234.6, HISTORICAL_FIXTURE_LIMITS["batch_seconds"],
            path_timings=timings, journal_snapshot=journal_snapshot,
            cpu_count=8, load1=1.25)
        rendered = json.loads(diagnostic)

        self.assertEqual(rendered, {
            "state": "UNSETTLED",
            "reason": "OPERATION_DEADLINE",
            "trialId": trial_id,
            "pathCount": 2,
            "completedPathCount": 1,
            "elapsedMs": 1234.6,
            "configuredBatchSeconds": 20,
            "startupToFirstPathMs": 10,
            "pathStartAttemptCount": 44,
            "pathStartAcceptedCount": 44,
            "pathCompletionAttemptCount": 44,
            "pathCompletionAcceptedCount": 44,
            "completedPathIndices0Based": list(range(44)),
            "lastCompletedIndex0Based": 43,
            "maxPathMs": 12,
            "medianPathMs": 12,
            "journalState": "completed",
            "journalAttemptCount": 1,
            "journalPathCount": 44,
            "journalCompletedPathCount": 44,
            "cpuCount": 8,
            "load1": 1.25,
        })
        self.assertNotIn("attempts", rendered)
        self.assertLessEqual(len(diagnostic), 1024)
        self.assertNotIn("/synthetic/private/path", diagnostic)
        self.assertNotIn("../private/path", diagnostic)
        self.assertNotIn("/home/runner/private", diagnostic)
        self.assertNotIn(private_text, diagnostic)
        self.assertNotIn("pathId", rendered)
        self.assertNotIn("payload", rendered)

        for invalid_elapsed in (-1, True, float("nan"), float("inf"),
                                float("-inf"), MAX_DIAGNOSTIC_ELAPSED_MS + 1,
                                10 ** 400, private_text):
            with self.subTest(invalid_elapsed=repr(invalid_elapsed)):
                invalid = json.loads(
                    _generated_historical_result_diagnostic(
                        result, invalid_elapsed, HISTORICAL_FIXTURE_LIMITS["batch_seconds"],
                        path_timings=timings, journal_snapshot=journal_snapshot))
                self.assertNotIn("elapsedMs", invalid)
                self.assertEqual(invalid["configuredBatchSeconds"], 20)
        for invalid_batch_seconds in (0, -1, True, float("nan"), float("inf"),
                                      float("-inf"), journal.MAX_BATCH_SECONDS + 1,
                                      10 ** 400, private_text):
            with self.subTest(invalid_batch_seconds=repr(invalid_batch_seconds)):
                invalid = json.loads(
                    _generated_historical_result_diagnostic(
                        result, 1234.6, invalid_batch_seconds,
                        path_timings=timings, journal_snapshot=journal_snapshot))
                self.assertEqual(invalid["elapsedMs"], 1234.6)
                self.assertNotIn("configuredBatchSeconds", invalid)

        invalid_values = (None, True, float("nan"), float("inf"), -1,
                          MAX_DIAGNOSTIC_ELAPSED_MS + 1, 10 ** 400, private_text)
        for field in ("startAttemptMs", "startAcceptedMs",
                      "completionAttemptMs", "completionAcceptedMs"):
            for invalid_value in invalid_values:
                with self.subTest(field=field, invalid_value=repr(invalid_value)):
                    invalid_timing = {
                        0: {"index": 0, field: invalid_value},
                    }
                    invalid = json.loads(_generated_historical_result_diagnostic(
                        result, path_timings=invalid_timing))
                    self.assertNotIn("startupToFirstPathMs", invalid)
                    self.assertNotIn("maxPathMs", invalid)
                    self.assertNotIn("medianPathMs", invalid)
                    self.assertEqual(invalid["pathStartAttemptCount"], 0)
                    self.assertEqual(invalid["pathCompletionAcceptedCount"], 0)
        for invalid_index in (True, -1, MAX_DIAGNOSTIC_PATHS, private_text):
            with self.subTest(invalid_index=repr(invalid_index)):
                invalid = json.loads(_generated_historical_result_diagnostic(
                    result, path_timings={invalid_index: {
                        "index": invalid_index, "completionAcceptedMs": 1,
                    }}))
                self.assertEqual(invalid["pathCompletionAcceptedCount"], 0)
                self.assertNotIn("completedPathIndices0Based", invalid)

        for invalid_cpu_count in (None, True, 0, -1, MAX_DIAGNOSTIC_CPU_COUNT + 1,
                                  1.5, private_text):
            with self.subTest(invalid_cpu_count=repr(invalid_cpu_count)):
                invalid = json.loads(_generated_historical_result_diagnostic(
                    result, cpu_count=invalid_cpu_count))
                self.assertNotIn("cpuCount", invalid)
        for invalid_load1 in (None, True, float("nan"), float("inf"), -1,
                              MAX_DIAGNOSTIC_ELAPSED_MS + 1, 10 ** 400, private_text):
            with self.subTest(invalid_load1=repr(invalid_load1)):
                invalid = json.loads(_generated_historical_result_diagnostic(
                    result, load1=invalid_load1))
                self.assertNotIn("load1", invalid)

        invalid_snapshot = {
            "state": private_text,
            "paths": [{"state": "completed"}] * (MAX_DIAGNOSTIC_PATHS + 1),
        }
        for invalid_attempts in (None, True, float("nan"), -1, 2, 10 ** 400, private_text):
            with self.subTest(invalid_attempts=repr(invalid_attempts)):
                invalid_snapshot["attempts"] = invalid_attempts
                invalid = json.loads(_generated_historical_result_diagnostic(
                    result, journal_snapshot=invalid_snapshot,
                    inspection_error=private_text))
                self.assertNotIn("journalState", invalid)
                self.assertNotIn("journalAttemptCount", invalid)
                self.assertNotIn("journalPathCount", invalid)
                self.assertNotIn("journalCompletedPathCount", invalid)
                self.assertNotIn("journalInspectionError", invalid)
                self.assertNotIn(private_text, json.dumps(invalid))
        unavailable = json.loads(_generated_historical_result_diagnostic(
            result, inspection_error="INSPECTION_UNAVAILABLE"))
        self.assertEqual(unavailable["journalInspectionError"], "INSPECTION_UNAVAILABLE")
        missing = json.loads(_generated_historical_result_diagnostic(result))
        self.assertNotIn("cpuCount", missing)
        self.assertNotIn("load1", missing)
        self.assertNotIn("journalState", missing)
        self.assertLessEqual(len(json.dumps(rendered, separators=(",", ":"))), 1024)

        valid_helper_metrics = {
            "_historical_profile": {"calls": 3, "successfulCalls": 3, "inclusiveMs": 12.5},
            "_b1_job": {"calls": 4, "successfulCalls": 3, "inclusiveMs": 25},
            "_validate_b1_path_payload": {"calls": 8, "successfulCalls": 8, "inclusiveMs": 50},
            private_text: {"calls": 999, "successfulCalls": 999, "inclusiveMs": 999},
        }
        helper_diagnostic = _generated_historical_result_diagnostic(
            result, helper_metrics=valid_helper_metrics)
        helper_rendered = json.loads(helper_diagnostic)
        self.assertEqual(helper_rendered["historicalHelperTiming"], "inclusive_overlapping")
        self.assertEqual(helper_rendered["historicalHelperMetrics"], {
            "profile": {"calls": 3, "successfulCalls": 3, "inclusiveMs": 12.5},
            "job": {"calls": 4, "successfulCalls": 3, "inclusiveMs": 25.0},
            "payload": {"calls": 8, "successfulCalls": 8, "inclusiveMs": 50.0},
        })
        self.assertNotIn(private_text, helper_diagnostic)
        self.assertLessEqual(len(helper_diagnostic), 1024)
        combined_diagnostic = _generated_historical_result_diagnostic(
            result, 1234.6, HISTORICAL_FIXTURE_LIMITS["batch_seconds"],
            path_timings=timings, journal_snapshot=journal_snapshot,
            cpu_count=8, load1=1.25, helper_metrics=valid_helper_metrics)
        combined_rendered = json.loads(combined_diagnostic)
        self.assertLessEqual(len(combined_diagnostic), 1024)
        self.assertEqual(combined_rendered["historicalHelperTiming"], "inclusive_overlapping")
        self.assertEqual(combined_rendered["historicalHelperMetrics"], {
            "profile": {"calls": 3, "successfulCalls": 3, "inclusiveMs": 12.5},
            "job": {"calls": 4, "successfulCalls": 3, "inclusiveMs": 25.0},
            "payload": {"calls": 8, "successfulCalls": 8, "inclusiveMs": 50.0},
        })
        self.assertNotIn(private_text, combined_diagnostic)

        invalid_helper_values = {
            "calls": (None, True, float("nan"), float("inf"), -1,
                      MAX_DIAGNOSTIC_HELPER_CALLS + 1, 10 ** 400, private_text),
            "successfulCalls": (None, True, float("nan"), float("inf"), -1,
                                MAX_DIAGNOSTIC_HELPER_CALLS + 1, 10 ** 400, private_text),
            "inclusiveMs": (None, True, float("nan"), float("inf"), -1,
                            MAX_DIAGNOSTIC_ELAPSED_MS + 1, 10 ** 400, private_text),
        }
        for field, invalid_values_for_field in invalid_helper_values.items():
            for invalid_value in invalid_values_for_field:
                with self.subTest(helper_field=field, invalid_value=repr(invalid_value)):
                    invalid_metrics = {
                        helper: {"calls": 1, "successfulCalls": 1, "inclusiveMs": 1}
                        for helper in HISTORICAL_HELPERS
                    }
                    invalid_metrics["_historical_profile"][field] = invalid_value
                    invalid = json.loads(_generated_historical_result_diagnostic(
                        result, helper_metrics=invalid_metrics))
                    self.assertNotIn("profile", invalid.get("historicalHelperMetrics", {}))
                    self.assertNotIn(private_text, json.dumps(invalid))

        returned = object()
        forwarded = []
        timing = {}
        ticks = iter((10.1, 10.2))

        def original_callback(*args, **kwargs):
            forwarded.append((args, kwargs))
            return returned

        wrapped = _timed_path_callback(
            original_callback, "start", timing, 10.0, clock=lambda: next(ticks))
        callback_args = (object(), object(), 0, private_text)
        callback_kwargs = {"deadline": object()}
        self.assertIs(wrapped(*callback_args, **callback_kwargs), returned)
        self.assertEqual(len(forwarded[0][0]), len(callback_args))
        for actual, expected in zip(forwarded[0][0], callback_args):
            self.assertIs(actual, expected)
        self.assertIs(forwarded[0][1]["deadline"], callback_kwargs["deadline"])
        self.assertEqual(timing, {
            0: {"index": 0, "startAttemptMs": 100, "startAcceptedMs": 200},
        })
        self.assertNotIn(private_text, repr(timing))

        expected_error = RuntimeError(private_text)
        failure_effects = []
        failed_ticks = iter((10.1,))

        def failing_callback(*args, **kwargs):
            failure_effects.append((args, kwargs))
            raise expected_error

        failed_timing = {}
        failed_wrapper = _timed_path_callback(
            failing_callback, "completion", failed_timing, 10.0,
            clock=lambda: next(failed_ticks))
        with self.assertRaises(RuntimeError) as caught:
            failed_wrapper(*callback_args, **callback_kwargs)
        self.assertIs(caught.exception, expected_error)
        self.assertEqual(failure_effects, [(callback_args, callback_kwargs)])
        self.assertEqual(failed_timing, {
            0: {"index": 0, "completionAttemptMs": 100},
        })
        failure_diagnostic = json.loads(_generated_historical_result_diagnostic(
            result, path_timings=failed_timing))
        self.assertEqual(failure_diagnostic["pathCompletionAttemptCount"], 1)
        self.assertEqual(failure_diagnostic["pathCompletionAcceptedCount"], 0)

        effects = []
        successful_with_monitor_error = _timed_path_callback(
            lambda *args, **kwargs: effects.append((args, kwargs)) or returned,
            "completion", {}, 10.0, clock=lambda: (_ for _ in ()).throw(
                RuntimeError(private_text)))
        self.assertIs(successful_with_monitor_error(*callback_args, **callback_kwargs), returned)
        self.assertEqual(effects, [(callback_args, callback_kwargs)])

        helper_metrics = {
            name: {"calls": 0, "successfulCalls": 0, "inclusiveMs": 0}
            for name in HISTORICAL_HELPERS
        }
        helper_effects = []
        helper_ticks = iter((1.0, 1.125))
        helper_wrapper = _timed_historical_helper(
            lambda *args, **kwargs: helper_effects.append((args, kwargs)) or returned,
            "_historical_profile", helper_metrics, clock=lambda: next(helper_ticks))
        self.assertIs(helper_wrapper(*callback_args, **callback_kwargs), returned)
        self.assertEqual(helper_effects, [(callback_args, callback_kwargs)])
        self.assertEqual(helper_metrics["_historical_profile"], {
            "calls": 1, "successfulCalls": 1, "inclusiveMs": 125.0,
        })

        raising_metrics = {
            name: {"calls": 0, "successfulCalls": 0, "inclusiveMs": 0}
            for name in HISTORICAL_HELPERS
        }
        raising_error = RuntimeError(private_text)
        raising_ticks = iter((2.0, 2.25))
        raising_effects = []

        def raise_helper(*args, **kwargs):
            raising_effects.append((args, kwargs))
            raise raising_error

        raising_wrapper = _timed_historical_helper(
            raise_helper, "_b1_job", raising_metrics, clock=lambda: next(raising_ticks))
        with self.assertRaises(RuntimeError) as caught_helper:
            raising_wrapper(*callback_args, **callback_kwargs)
        self.assertIs(caught_helper.exception, raising_error)
        self.assertEqual(raising_effects, [(callback_args, callback_kwargs)])
        self.assertEqual(raising_metrics["_b1_job"], {
            "calls": 1, "successfulCalls": 0, "inclusiveMs": 250.0,
        })

        monitoring_metrics = {
            name: {"calls": 0, "successfulCalls": 0, "inclusiveMs": 0}
            for name in HISTORICAL_HELPERS
        }
        monitoring_effects = []
        monitoring_wrapper = _timed_historical_helper(
            lambda *args, **kwargs: monitoring_effects.append((args, kwargs)) or returned,
            "_validate_b1_path_payload", monitoring_metrics,
            clock=lambda: (_ for _ in ()).throw(RuntimeError(private_text)))
        self.assertIs(monitoring_wrapper(*callback_args, **callback_kwargs), returned)
        self.assertEqual(monitoring_effects, [(callback_args, callback_kwargs)])
        self.assertEqual(monitoring_metrics["_validate_b1_path_payload"], {
            "calls": 1, "successfulCalls": 1, "inclusiveMs": 0,
        })
        broken_monitor = _timed_historical_helper(
            lambda *args, **kwargs: returned, "_historical_profile", None,
            clock=lambda: (_ for _ in ()).throw(RuntimeError(private_text)))
        self.assertIs(broken_monitor(*callback_args, **callback_kwargs), returned)

        capped_metrics = {
            name: {"calls": 0, "successfulCalls": 0, "inclusiveMs": 0}
            for name in HISTORICAL_HELPERS
        }
        capped_metrics["_historical_profile"].update({
            "calls": MAX_DIAGNOSTIC_HELPER_CALLS,
            "successfulCalls": MAX_DIAGNOSTIC_HELPER_CALLS,
            "inclusiveMs": MAX_DIAGNOSTIC_ELAPSED_MS,
        })
        capped_ticks = iter((10.0, 10.1))
        capped_wrapper = _timed_historical_helper(
            lambda *args, **kwargs: returned, "_historical_profile", capped_metrics,
            clock=lambda: next(capped_ticks))
        self.assertIs(capped_wrapper(*callback_args, **callback_kwargs), returned)
        capped_helper = json.loads(_generated_historical_result_diagnostic(
            result, helper_metrics=capped_metrics))["historicalHelperMetrics"]["profile"]
        self.assertEqual(capped_helper["calls"], MAX_DIAGNOSTIC_HELPER_CALLS)
        self.assertEqual(capped_helper["successfulCalls"], MAX_DIAGNOSTIC_HELPER_CALLS)
        self.assertEqual(capped_helper["inclusiveMs"], MAX_DIAGNOSTIC_ELAPSED_MS)
        self.assertTrue(capped_helper["callsCapped"])
        self.assertTrue(capped_helper["successfulCallsCapped"])
        self.assertTrue(capped_helper["inclusiveMsCapped"])

        with (patch.object(os, "cpu_count", side_effect=RuntimeError(private_text)),
              patch.object(os, "getloadavg", new=None, create=True)):
            unavailable_cpu, unavailable_load = _best_effort_host_metrics()
        self.assertIsNone(unavailable_cpu)
        self.assertIsNone(unavailable_load)
        portable = json.loads(_generated_historical_result_diagnostic(
            result, cpu_count=unavailable_cpu, load1=unavailable_load))
        self.assertNotIn("cpuCount", portable)
        self.assertNotIn("load1", portable)

        before_inspection = Path(self.database).read_bytes()
        with patch.object(journal, "inspect_b1", side_effect=RuntimeError(private_text)):
            unavailable_snapshot, unavailable_error = _best_effort_historical_journal_inspection(
                self.database, trial_id, Path(self.temporary.name) / "unused-profile.json")
        self.assertIsNone(unavailable_snapshot)
        self.assertEqual(unavailable_error, "INSPECTION_UNAVAILABLE")
        self.assertEqual(Path(self.database).read_bytes(), before_inspection)
        self.assertNotIn(private_text, _generated_historical_result_diagnostic(
            result, inspection_error=unavailable_error))

    def test_generated_historical_profile_runs_all_paths_and_refuses_repeat(self):
        profile_path, claim = self.prepare_historical_fixture("historical-success")
        try:
            started_at = time.monotonic()
        except BaseException:
            started_at = None
        path_timings = {}
        helper_metrics = {
            name: {"calls": 0, "successfulCalls": 0, "inclusiveMs": 0}
            for name in HISTORICAL_HELPERS
        }
        original_path_started = journal.record_b1_path_started
        original_path_completed = journal.record_b1_path_completed
        original_helpers = {name: getattr(journal, name) for name in HISTORICAL_HELPERS}
        result = None
        try:
            with (patch.object(
                    journal, "record_b1_path_started",
                    new=_timed_path_callback(
                        original_path_started, "start", path_timings, started_at)),
                  patch.object(
                    journal, "record_b1_path_completed",
                    new=_timed_path_callback(
                        original_path_completed, "completion", path_timings, started_at)),
                  patch.object(
                    journal, "_historical_profile",
                    new=_timed_historical_helper(
                        original_helpers["_historical_profile"], "_historical_profile",
                        helper_metrics)),
                  patch.object(
                    journal, "_b1_job",
                    new=_timed_historical_helper(
                        original_helpers["_b1_job"], "_b1_job", helper_metrics)),
                  patch.object(
                    journal, "_validate_b1_path_payload",
                    new=_timed_historical_helper(
                        original_helpers["_validate_b1_path_payload"],
                        "_validate_b1_path_payload", helper_metrics))):
                result = self.run_historical_fixture(
                    profile_path, claim, "SUCCESS", limits=HISTORICAL_FIXTURE_LIMITS)
        finally:
            diagnostic = "{}"
            try:
                try:
                    elapsed_ms = (
                        (time.monotonic() - started_at) * 1000
                        if type(started_at) in (int, float) else None)
                except BaseException:
                    elapsed_ms = None
                inspected, inspection_error = _best_effort_historical_journal_inspection(
                    self.database, claim["trialId"], profile_path)
                cpu_count, load1 = _best_effort_host_metrics()
                diagnostic = _generated_historical_result_diagnostic(
                    result, elapsed_ms, HISTORICAL_FIXTURE_LIMITS["batch_seconds"],
                    path_timings=path_timings, journal_snapshot=inspected,
                    inspection_error=inspection_error, cpu_count=cpu_count, load1=load1,
                    helper_metrics=helper_metrics)
                print(f"SYNTHETIC_SUPERVISOR_TIMING {diagnostic}", flush=True)
            except BaseException:
                pass
        self.assertEqual(result["state"], "completed", diagnostic)
        self.assertEqual(result["attempts"], 1, diagnostic)
        self.assertEqual(len(result["paths"]), 44, diagnostic)
        self.assertEqual(result["executionAuthorized"], False)
        self.assertEqual(result["promotionAuthorized"], False)
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
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
        self.assertEqual(result["reason"], "INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR")
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            inspected = journal.inspect_b1(self.database, claim["trialId"])
        summary = json.loads(inspected["result"])
        self.assertEqual(summary["status"], "INSUFFICIENT_EVIDENCE")
        self.assertEqual(summary["evidence"]["sourceAuthenticity"], "NOT_ESTABLISHED")
        self.assertFalse(summary["authority"]["executionAuthorized"])
        self.assertFalse(summary["authority"]["paperAuthorized"])

    def test_generated_completed_historical_insufficient_screen_roundtrips_without_promotion(self):
        profile_path, claim = self.prepare_historical_fixture(
            "completed-insufficient-screen", "COMPLETED_INSUFFICIENT_SCREEN")
        result = self.run_historical_fixture(
            profile_path, claim, "COMPLETED_INSUFFICIENT_SCREEN")
        self.assertEqual(result["state"], "completed")
        self.assertEqual(result["attempts"], 1)
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            inspected = journal.inspect_b1(self.database, claim["trialId"])
        summary = json.loads(inspected["result"])
        self.assertEqual(summary["status"], "COMPLETED")
        self.assertEqual(summary["completedPaths"], 44)
        self.assertEqual(len(summary["paths"]), 44)
        self.assertTrue(all(path["status"] == "COMPLETED" for path in summary["paths"]))
        self.assertEqual(summary["screen"], {
            "status": "INSUFFICIENT_EVIDENCE",
            "checks": {"fullBasketDrawdownDenominator": False},
            "relativeDrawdownReduction": None,
        })
        self.assertEqual(summary["evidence"]["sourceAuthenticity"], "NOT_ESTABLISHED")
        self.assertFalse(summary["authority"]["executionAuthorized"])
        self.assertFalse(summary["authority"]["paperAuthorized"])

    def test_generated_historical_identity_corruption_fails_closed(self):
        profile_path, _ = self.prepare_historical_fixture("historical-corrupt")
        profile = json.loads(profile_path.read_text())
        profile["approvalReceipt"]["pathIds"][0] = "0" * 64
        profile_path.write_text(json.dumps(profile))
        database = str(Path(self.temporary.name) / "historical-corrupt-check.sqlite")
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            with self.assertRaises(journal.JournalError) as invalid:
                journal.initialize(database, profile=journal.HISTORICAL_PROFILE_NAME)
        self.assertEqual(invalid.exception.code, "HISTORICAL_APPROVAL_INVALID")

    def test_test_receipt_requires_explicit_mode_and_isolated_profile_location(self):
        profile_path, _ = self.prepare_historical_fixture("receipt-boundary")
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {}, clear=True)):
            with self.assertRaises(journal.JournalError) as no_test_mode:
                journal._historical_profile()
        self.assertEqual(no_test_mode.exception.code, "HISTORICAL_APPROVAL_INVALID")

        repository = Path(self.temporary.name) / "repository"
        profile_file = repository / "scripts/research-supervisor/historical_run_profile.json"
        profile_file.parent.mkdir(parents=True)
        profile_file.write_bytes(profile_path.read_bytes())
        source_paths = set(json.loads(profile_path.read_text())["sourceFiles"].values())
        source_paths.update(journal.B1_SOURCE_FILES.values())
        for relative in source_paths:
            source = PROJECT_ROOT / relative
            target = repository / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        fake_journal = repository / "scripts/research-supervisor/journal.py"
        production_database = repository / "production.sqlite"
        with (patch.object(journal, "__file__", str(fake_journal)),
              patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_file),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            with self.assertRaises(journal.JournalError) as repository_profile:
                journal.initialize(str(production_database),
                                   profile=journal.HISTORICAL_PROFILE_NAME)
        self.assertEqual(repository_profile.exception.code, "HISTORICAL_APPROVAL_INVALID")
        self.assertFalse(production_database.exists())

        alias = Path(self.temporary.name) / "historical-test-profile-alias.json"
        alias.symlink_to(profile_path)
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", alias),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
            with self.assertRaises(journal.JournalError) as symlink_profile:
                journal._historical_profile()
        self.assertEqual(symlink_profile.exception.code, "HISTORICAL_APPROVAL_INVALID")

    def test_generated_historical_timeout_keeps_attempt_and_fence_without_retry(self):
        profile_path, claim = self.prepare_historical_fixture("historical-timeout")
        result = self.run_historical_fixture(
            profile_path, claim, "HISTORICAL_TIMEOUT",
            limits={"path_seconds": 1, "batch_seconds": 10})
        self.assertEqual(result["state"], "timed_out")
        self.assertEqual(result["attempts"], 1)
        self.assertGreater(result["fence"], 0)
        with (patch.object(journal, "HISTORICAL_PROFILE_PATH", profile_path),
              patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"})):
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
        last_journal_state = None
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    current = journal.inspect_b1(self.database, claim["trialId"])
                    last_journal_state = {
                        "state": current.get("state"),
                        "reason": current.get("reason"),
                        "attempts": current.get("attempts"),
                        "unresolved": current.get("unresolved"),
                        "paths": [path.get("state") for path in current.get("paths", [])],
                    }
                    if current["paths"] and current["paths"][0]["state"] == "started":
                        break
                except journal.JournalError as error:
                    if error.code != "DATABASE_BUSY":
                        raise
                time.sleep(0.005)
            else:
                diagnostic = _b1_readiness_diagnostic(
                    thread, result, failure, children, last_journal_state)
                self.fail(
                    "B1 fault child did not durably start its first path; "
                    f"diagnostic={diagnostic}")

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
        original_popen = subprocess.Popen
        children = []

        def spawn(*args, **kwargs):
            child = original_popen(*args, **kwargs)
            if Path(args[0][-1]).resolve() == FAULT_ADAPTER.resolve():
                children.append(child)
            return child

        with patch.object(supervisor.subprocess, "Popen", side_effect=spawn):
            result = self.run_fault(
                "b" * 64, {"path_seconds": 1.0, "batch_seconds": 4.0})
        elapsed = time.monotonic() - started
        paths = result.get("paths") if type(result) is dict else None
        diagnostic = json.dumps({
            "elapsed_seconds": round(elapsed, 3),
            "state": result.get("state") if type(result) is dict else None,
            "reason": result.get("reason") if type(result) is dict else None,
            "path_count": len(paths) if type(paths) is list else None,
        }, sort_keys=True, separators=(",", ":"))
        self.assertLessEqual(len(diagnostic), 512)
        self.assertEqual(result["state"], "timed_out", diagnostic)
        self.assertEqual(result["reason"], "DEADLINE_EXCEEDED", diagnostic)
        self.assertIsInstance(paths, list, diagnostic)
        self.assertTrue(paths, diagnostic)
        self.assertEqual(paths[0]["state"], "started", diagnostic)
        self.assertEqual(len(children), 1, diagnostic)
        self.assertIsNotNone(children[0].poll(), diagnostic)
        current = journal.inspect(self.database, result["trialId"])
        self.assertEqual((current["state"], current["attempts"]), ("timed_out", 1), diagnostic)
        self.assertFalse(current["unresolved"], diagnostic)
        self.assertEqual(current["paths"][0]["state"], "started", diagnostic)
        self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"],
                         "idle", diagnostic)
        self.assertLess(elapsed, 2.9, diagnostic)

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
        self._assert_run_batch_uses_one_absolute_deadline()
        started = time.monotonic()
        result = self.run_fault("7" * 64, {"path_seconds": 2, "batch_seconds": 1},
                                key="trial-absolute-batch-deadline")
        elapsed = time.monotonic() - started
        current = journal.inspect(self.database, result["trialId"])
        completed = sum(path["state"] == "completed" for path in current["paths"])
        diagnostic = _deadline_diagnostic(elapsed, result, current, completed)
        self.assertLess(elapsed, 2.5, diagnostic)
        self.assertIn((result["state"], result["reason"]), (
            ("timed_out", "DEADLINE_EXCEEDED"),
            ("UNSETTLED", "OPERATION_DEADLINE"),
        ), diagnostic)
        self.assertLess(completed, journal.MAX_PATHS, diagnostic)
        self.assertEqual(current["attempts"], 1, diagnostic)
        if result["state"] == "UNSETTLED":
            self.assertEqual(current["state"], "unknown", diagnostic)
            self.assertTrue(current["unresolved"], diagnostic)
            self.assertFalse(result["persistConfirmed"])
            self.assertEqual(journal.scheduler_tick(self.database, self.policy)["state"], "active")
            with self.assertRaisesRegex(journal.JournalError, "ATTEMPT_CONSUMED"):
                journal.start(self.database, current)
            journal.reconcile(self.database, result["trialId"], "OPERATOR_RECONCILED_DEADLINE")
        else:
            self.assertEqual(current["state"], "timed_out", diagnostic)
            self.assertFalse(current["unresolved"], diagnostic)
        with self.assertRaisesRegex(journal.JournalError, "STALE_FENCE",
                                    msg=diagnostic):
            journal.start(self.database, current)

    def _assert_run_batch_uses_one_absolute_deadline(self):
        clock = SimpleNamespace(now=100.0)
        clock.monotonic = lambda: clock.now
        paths = tuple(
            {"id": f"controlled-path-{index}", "variant": f"controlled-variant-{index}"}
            for index in range(3)
        )
        started = {
            "trialId": "1" * 64,
            "trialKey": "controlled-deadline",
            "owner": "controlled-owner",
            "fence": 1,
            "protocolSha256": "2" * 64,
            "sourceSha256": "3" * 64,
            "dataSha256": "4" * 64,
            "manifestSha256": "5" * 64,
            "pathIds": [path["id"] for path in paths],
            "variantIds": [path["variant"] for path in paths],
            "budget": {},
        }
        child_calls = []
        journal_progress = []

        def record_started(database, receipt, index, path_id, predecessor,
                           *, busy_timeout, deadline):
            journal_progress.append(("started", index, deadline))

        def record_completed(database, receipt, index, path_id, predecessor,
                             output_sha256, *, busy_timeout, deadline):
            journal_progress.append(("completed", index, deadline))

        def run_child(request, path_deadline, batch_deadline, path_seconds, on_event):
            child_calls.append({
                "index": request["index"],
                "path_deadline": path_deadline,
                "batch_deadline": batch_deadline,
                "started_at": clock.now,
                "predecessor": request["predecessorSha256"],
            })
            start_event = {
                "event": "path_started",
                "index": request["index"],
                "pathId": request["pathId"],
                "variantId": request["variantId"],
                "predecessorSha256": request["predecessorSha256"],
            }
            complete_event = {
                **start_event,
                "event": "path_completed",
                "outputSha256": hashlib.sha256(
                    f"controlled-output-{request['index']}".encode()).hexdigest(),
            }
            on_event(start_event, 0, batch_deadline)
            on_event(complete_event, 1, path_deadline)
            clock.now += 5
            return [start_event, complete_event]

        settled = {"state": "timed_out", "reason": "DEADLINE_EXCEEDED"}
        with (
            patch.object(supervisor, "time", SimpleNamespace(monotonic=clock.monotonic)),
            patch.object(journal, "PATHS", paths),
            patch.object(journal, "start", return_value=started),
            patch.object(journal, "record_path_started", side_effect=record_started),
            patch.object(journal, "record_path_completed", side_effect=record_completed),
            patch.object(journal, "settle", return_value=settled) as settle,
            patch.object(supervisor, "_run_child", side_effect=run_child),
        ):
            result = supervisor.run_batch(
                self.database, {"trialId": started["trialId"]},
                limits={"path_seconds": 20, "batch_seconds": 10})

        diagnostic = json.dumps({
            "child_indices": [child["index"] for child in child_calls],
            "batch_deadlines": [child["batch_deadline"] for child in child_calls],
            "journal_progress": journal_progress,
            "clock": clock.now,
            "state": result.get("state"),
            "reason": result.get("reason"),
        }, sort_keys=True, separators=(",", ":"))[:1024]
        self.assertEqual(result, settled, diagnostic)
        self.assertEqual([child["index"] for child in child_calls], [0, 1], diagnostic)
        self.assertEqual([child["started_at"] for child in child_calls], [100.0, 105.0], diagnostic)
        self.assertEqual([child["batch_deadline"] for child in child_calls], [110.0, 110.0], diagnostic)
        self.assertEqual([child["path_deadline"] for child in child_calls], [110.0, 110.0], diagnostic)
        self.assertEqual(child_calls[1]["predecessor"],
                         hashlib.sha256(b"controlled-output-0").hexdigest(), diagnostic)
        self.assertEqual(journal_progress, [
            ("started", 0, 110.0), ("completed", 0, 110.0),
            ("started", 1, 110.0), ("completed", 1, 110.0),
        ], diagnostic)
        self.assertEqual(settle.call_args.args[2:4], ("TIMED_OUT", "DEADLINE_EXCEEDED"), diagnostic)

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
