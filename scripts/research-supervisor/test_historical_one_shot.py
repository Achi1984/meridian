import json
import hashlib
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
import historical_one_shot as launcher
import journal
import supervisor


PROFILE_GENERATOR = ROOT / "test_b1_historical_fixture.mjs"
HISTORICAL_TEST_ADAPTER = PROFILE_GENERATOR


class HistoricalOneShotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="meridian-d2-launcher-")
        self.root = Path(self.temporary.name)
        os.chmod(self.root, 0o700)
        self.profile = self.root / "historical-test-launcher.json"
        self.database = self.root / "historical.sqlite"
        self.evidence = self.root / "evidence.jsonl"

    def tearDown(self):
        self.temporary.cleanup()

    def profile_context(self):
        return (
            patch.object(journal, "HISTORICAL_PROFILE_PATH", self.profile),
            patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"}),
        )

    def make_profile(self, scenario="SUCCESS"):
        result = subprocess.run(
            ["node", str(PROFILE_GENERATOR), "--profile", str(self.profile), scenario],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def initialize(self, scenario="SUCCESS"):
        self.make_profile(scenario)
        with self.profile_context()[0], self.profile_context()[1]:
            journal.initialize(
                str(self.database), profile=journal.HISTORICAL_PROFILE_NAME)

    def worker_helper(self, script, env, pass_fds=(), deadline_seconds=5):
        return supervisor._spawn_guarded_worker(
            sys.executable, script, env=env, pass_fds=pass_fds,
            batch_deadline=time.monotonic() + deadline_seconds)

    def test_absent_admission_and_existing_journal_stop_before_writes(self):
        database = self.root / "dormant.sqlite"
        journal.initialize(str(database), profile=journal.HISTORICAL_PROFILE_NAME)
        with self.assertRaises(launcher.LaunchError) as blocked:
            launcher.run_once(str(database), str(self.evidence), "test-owner")
        self.assertEqual(blocked.exception.code, "HISTORICAL_ADMISSION_REQUIRED")
        self.assertFalse(self.evidence.exists())

        self.initialize()
        with self.profile_context()[0], self.profile_context()[1]:
            journal.enqueue_b1(str(self.database), launcher.TRIAL_KEY)
            with self.assertRaises(launcher.LaunchError) as existing:
                launcher.run_once(str(self.database), str(self.evidence), "test-owner")
            self.assertEqual(existing.exception.code, "JOURNAL_NOT_EMPTY")
            self.assertFalse(self.evidence.exists())
            queued = journal._b1_connect(str(self.database), readonly=True)
            try:
                state = queued.execute(
                    "SELECT state,attempts FROM b1_jobs WHERE trial_key=?",
                    (launcher.TRIAL_KEY,)).fetchone()
            finally:
                queued.rollback()
                queued.close()
        self.assertEqual(state, ("QUEUED", 0))

    def test_enqueue_ambiguity_records_boundary_and_never_retries(self):
        self.initialize()
        real_enqueue = journal.enqueue_b1
        calls = 0

        def commit_then_lose_response(*args, **kwargs):
            nonlocal calls
            calls += 1
            real_enqueue(*args, **kwargs)
            raise OSError("ambiguous synthetic response")

        with self.profile_context()[0], self.profile_context()[1], \
                patch.object(journal, "enqueue_b1", side_effect=commit_then_lose_response):
            with self.assertRaises(OSError):
                launcher.run_once(str(self.database), str(self.evidence), "test-owner")
            with self.assertRaises(launcher.LaunchError) as duplicate:
                launcher.run_once(str(self.database), str(self.root / "retry.jsonl"), "test-owner")
        self.assertEqual(calls, 1)
        self.assertEqual(duplicate.exception.code, "JOURNAL_NOT_EMPTY")
        records = [json.loads(line) for line in self.evidence.read_text().splitlines()]
        self.assertIn({"sequence": 2, "event": "enqueue_outcome", "state": "AMBIGUOUS"}, records)
        self.assertEqual(records[-1]["event"], "failure")
        self.assertEqual(stat.S_IMODE(self.evidence.stat().st_mode), 0o600)

    def test_unexpected_claim_preserves_fence_and_skips_run(self):
        self.initialize()
        real_tick = journal.scheduler_tick_b1
        run = patch.object(supervisor, "run_b1_batch")
        with self.profile_context()[0], self.profile_context()[1], run as run_batch:
            def wrong_identity(*args, **kwargs):
                scheduled = real_tick(*args, **kwargs)
                scheduled["claim"]["owner"] = "unexpected-owner"
                return scheduled

            with patch.object(journal, "scheduler_tick_b1", side_effect=wrong_identity):
                with self.assertRaises(launcher.LaunchError) as mismatch:
                    launcher.run_once(str(self.database), str(self.evidence), "test-owner")
            self.assertEqual(mismatch.exception.code, "CLAIM_IDENTITY_MISMATCH")
            run_batch.assert_not_called()
            current = journal.inspect_b1(
                str(self.database), hashlib.sha256(launcher.TRIAL_KEY.encode()).hexdigest())
        self.assertEqual((current["state"], current["attempts"], current["fence"]),
                         ("unknown", 1, 1))
        self.assertTrue(current["unresolved"])
        self.assertEqual(json.loads(self.evidence.read_text().splitlines()[-2])["event"],
                         "claim_returned")
        self.assertFalse(json.loads(self.evidence.read_text().splitlines()[-2])[
            "claimedIdentityValid"])

    def test_successful_launch_runs_once_and_duplicate_is_refused(self):
        self.initialize()
        with (self.profile_context()[0], self.profile_context()[1],
              patch.object(journal, "enqueue_b1", wraps=journal.enqueue_b1) as enqueue,
              patch.object(journal, "scheduler_tick_b1", wraps=journal.scheduler_tick_b1) as tick,
              patch.object(supervisor, "run_b1_batch", wraps=supervisor.run_b1_batch) as run):
            # Reapply the test profile for each API call that validates the historical receipt.
            with patch.object(supervisor, "HISTORICAL_ADAPTER", HISTORICAL_TEST_ADAPTER):
                original_popen = subprocess.Popen

                def spawn(*args, **kwargs):
                    if Path(args[0][-1]).resolve() == HISTORICAL_TEST_ADAPTER.resolve():
                        child_env = dict(kwargs["env"])
                        child_env.update({
                            "B1_TEST_HISTORICAL_PROFILE_PATH": str(self.profile),
                            "B1_TEST_SCENARIO": "SUCCESS",
                        })
                        kwargs["env"] = child_env
                    return original_popen(*args, **kwargs)

                with patch.object(supervisor.subprocess, "Popen", side_effect=spawn):
                    result = launcher.run_once(
                        str(self.database), str(self.evidence), "test-owner")
            self.assertEqual(result["state"], "completed")
            self.assertEqual((enqueue.call_count, tick.call_count, run.call_count), (1, 1, 1))
            current = journal.inspect_b1(
                str(self.database), hashlib.sha256(launcher.TRIAL_KEY.encode()).hexdigest())
        self.assertEqual((current["state"], current["attempts"]), ("completed", 1))
        records = [json.loads(line) for line in self.evidence.read_text().splitlines()]
        self.assertEqual([item["event"] for item in records][-2:],
                         ["run_invoked", "run_returned"])
        self.assertEqual(stat.S_IMODE(self.evidence.stat().st_mode), 0o600)
        self.assertNotIn("result", self.evidence.read_text())
        with self.profile_context()[0], self.profile_context()[1]:
            with self.assertRaises(launcher.LaunchError) as duplicate:
                launcher.run_once(str(self.database), str(self.root / "second.jsonl"),
                                  "test-owner")
        self.assertEqual(duplicate.exception.code, "JOURNAL_NOT_EMPTY")
        self.assertFalse((self.root / "second.jsonl").exists())

    def test_engine_failure_result_is_durably_recorded_without_retry(self):
        self.initialize("INSUFFICIENT_EVIDENCE")
        original_popen = subprocess.Popen

        def spawn(*args, **kwargs):
            if Path(args[0][-1]).resolve() == HISTORICAL_TEST_ADAPTER.resolve():
                child_env = dict(kwargs["env"])
                child_env.update({
                    "B1_TEST_HISTORICAL_PROFILE_PATH": str(self.profile),
                    "B1_TEST_SCENARIO": "INSUFFICIENT_EVIDENCE",
                })
                kwargs["env"] = child_env
            return original_popen(*args, **kwargs)

        with (self.profile_context()[0], self.profile_context()[1],
              patch.object(supervisor, "HISTORICAL_ADAPTER", HISTORICAL_TEST_ADAPTER),
              patch.object(supervisor.subprocess, "Popen", side_effect=spawn)):
            result = launcher.run_once(str(self.database), str(self.evidence), "test-owner")
            current = journal.inspect_b1(
                str(self.database), hashlib.sha256(launcher.TRIAL_KEY.encode()).hexdigest())
        self.assertEqual((result["state"], result["reason"]),
                         ("failed", "INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR"))
        self.assertEqual(current["state"], "failed")
        self.assertEqual(current["attempts"], 1)
        records = [json.loads(line) for line in self.evidence.read_text().splitlines()]
        self.assertEqual(records[-1]["event"], "run_returned")
        self.assertEqual(records[-1]["state"], "failed")

    def test_launcher_sigterm_preserves_unresolved_claim_and_receipt(self):
        profile = self.root / "historical-test-interrupt.json"
        database = self.root / "interrupt.sqlite"
        evidence = self.root / "interrupt-evidence.jsonl"
        worker_pid = self.root / "direct-worker.pid"
        generated = subprocess.run(
            ["node", str(PROFILE_GENERATOR), "--profile", str(profile), "SUCCESS"],
            cwd=PROJECT_ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(generated.returncode, 0, generated.stderr)
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile), \
                patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"}):
            journal.initialize(str(database), profile=journal.HISTORICAL_PROFILE_NAME)

        helper = self.root / "interrupted-launcher.py"
        helper.write_text(
            "import os,sys\n"
            f"sys.path.insert(0,{str(ROOT)!r})\n"
            "from pathlib import Path\n"
            "import journal,supervisor,historical_one_shot\n"
            f"journal.HISTORICAL_PROFILE_PATH=Path({str(profile)!r})\n"
            "os.environ['MERIDIAN_HISTORICAL_TEST_MODE']='1'\n"
            f"supervisor.HISTORICAL_ADAPTER=Path({str(HISTORICAL_TEST_ADAPTER)!r})\n"
            "spawn=supervisor._spawn_guarded_worker\n"
            "def capture(*args,**kwargs):\n"
            " process=spawn(*args,**kwargs)\n"
            f" Path({str(worker_pid)!r}).write_text(str(process.pid))\n"
            " return process\n"
            "supervisor._spawn_guarded_worker=capture\n"
            "popen=supervisor.subprocess.Popen\n"
            "def add_test_input(*args,**kwargs):\n"
            f" if Path(args[0][-1]).resolve()==Path({str(HISTORICAL_TEST_ADAPTER)!r}).resolve():\n"
            "  env=dict(kwargs['env'])\n"
            f"  env.update({{'B1_TEST_HISTORICAL_PROFILE_PATH':{str(profile)!r},"
            "'B1_TEST_SCENARIO':'HISTORICAL_TIMEOUT'}})\n"
            "  kwargs['env']=env\n"
            " return popen(*args,**kwargs)\n"
            "supervisor.subprocess.Popen=add_test_input\n"
            "raise SystemExit(historical_one_shot.main([\n"
            f" 'execute','--journal',{str(database)!r},'--evidence',{str(evidence)!r},"
            " '--owner','test-owner']))\n")
        parent = subprocess.Popen(
            [sys.executable, "-B", str(helper)], cwd=PROJECT_ROOT,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and not worker_pid.exists():
            if parent.poll() is not None:
                self.fail("launcher exited before the guarded Node worker started")
            time.sleep(0.02)
        self.assertTrue(worker_pid.exists(), "guarded worker was not launched")
        pid = int(worker_pid.read_text())
        time.sleep(0.2)
        os.kill(parent.pid, signal.SIGTERM)
        self.assertNotEqual(parent.wait(timeout=10), 0)
        self._assert_not_running(pid)
        with patch.object(journal, "HISTORICAL_PROFILE_PATH", profile), \
                patch.dict(os.environ, {"MERIDIAN_HISTORICAL_TEST_MODE": "1"}):
            current = journal.inspect_b1(
                str(database), hashlib.sha256(launcher.TRIAL_KEY.encode()).hexdigest())
        self.assertEqual((current["state"], current["attempts"], current["fence"]),
                         ("unknown", 1, 1))
        self.assertTrue(current["unresolved"])
        records = [json.loads(line) for line in evidence.read_text().splitlines()]
        self.assertIn("run_invoked", [item["event"] for item in records])
        self.assertEqual(records[-2]["event"], "run_outcome")
        self.assertEqual(records[-2]["state"], "AMBIGUOUS")

    def test_guard_bootstrap_rejects_registration_failure_and_wrong_parent(self):
        worker = self.root / "worker.py"
        marker = self.root / "worker-started"
        worker.write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        cases = (
            (supervisor.PDEATHSIG_BOOTSTRAP, os.getpid() + 50000),
            (supervisor.PDEATHSIG_BOOTSTRAP.replace(
                "if prctl(1, signal.SIGKILL, 0, 0, 0) != 0:",
                "if prctl(999999, signal.SIGKILL, 0, 0, 0) != 0:"),
             os.getpid()),
        )
        for code, expected_parent in cases:
            read_fd, write_fd = os.pipe()
            os.set_inheritable(write_fd, True)
            write_open = True
            try:
                command = supervisor._worker_bootstrap_command(
                    expected_parent, write_fd, sys.executable, worker)
                command[3] = code
                process = subprocess.Popen(
                    command, pass_fds=(write_fd,), start_new_session=True,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env={"PATH": os.path.dirname(sys.executable), "LANG": "C.UTF-8"})
                self.assertEqual(process.wait(timeout=5), 120)
                os.close(write_fd)
                write_open = False
                self.assertEqual(os.read(read_fd, 64), b"")
                self.assertFalse(marker.exists())
                process.stdout.close()
                process.stderr.close()
            finally:
                os.close(read_fd)
                if write_open:
                    os.close(write_fd)

    def test_parent_sigterm_and_sigkill_before_and_after_guard_readiness(self):
        worker = self.root / "sleeping-worker.py"
        worker_marker = self.root / "worker-started"
        worker.write_text(
            "import os,time\n"
            f"open({str(worker_marker)!r},'w').write(str(os.getpid()))\n"
            "while True: time.sleep(1)\n")
        real_python = str(Path(sys.executable).resolve())

        for before_ready in (False, True):
            for signum in (signal.SIGTERM, signal.SIGKILL):
                with self.subTest(before_ready=before_ready, signal=signum):
                    self._parent_death_case(
                        worker, worker_marker, real_python, before_ready, signum)
                    worker_marker.unlink(missing_ok=True)

    def _parent_death_case(self, worker, worker_marker, real_python, before_ready, signum):
        parent_ready = self.root / f"parent-ready-{before_ready}-{signum}"
        prelaunch = self.root / f"prelaunch-{before_ready}-{signum}"
        wrapper = self.root / f"python-wrapper-{before_ready}-{signum}"
        wrapper.write_text(
            f"#!{real_python}\n"
            "import os,sys,time\n"
            f"open({str(prelaunch)!r},'w').write(str(os.getpid()))\n"
            "time.sleep(1.5)\n"
            f"os.execv({real_python!r}, [{real_python!r}, *sys.argv[1:]])\n")
        wrapper.chmod(0o700)
        helper = self.root / f"parent-{before_ready}-{signum}.py"
        source = (
            "import os,sys,time\n"
            f"sys.path.insert(0,{str(ROOT)!r})\n"
            "import supervisor\n"
            f"worker={str(worker)!r}\n"
            f"real_python={real_python!r}\n"
        )
        if before_ready:
            source += f"supervisor.sys.executable={str(wrapper)!r}\n"
        source += (
            "process=supervisor._spawn_guarded_worker(\n"
            " real_python, worker, env={'PATH':os.path.dirname(real_python),'LANG':'C.UTF-8'},\n"
            " pass_fds=(), batch_deadline=time.monotonic()+5)\n"
            f"open({str(parent_ready)!r},'w').write(str(process.pid))\n"
            "while True: time.sleep(1)\n")
        helper.write_text(source)
        parent = subprocess.Popen(
            [sys.executable, "-B", str(helper)], cwd=PROJECT_ROOT,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True)
        signal_file = prelaunch if before_ready else parent_ready
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not signal_file.exists():
            if parent.poll() is not None:
                self.fail("worker parent exited before its synchronization marker")
            time.sleep(0.01)
        self.assertTrue(signal_file.exists(), "worker did not reach the expected launch boundary")
        worker_pid = int(signal_file.read_text())
        os.kill(parent.pid, signum)
        parent.wait(timeout=5)
        self._assert_not_running(worker_pid)
        self.assertEqual(worker_marker.exists(), not before_ready)

    def _assert_not_running(self, pid):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                status = Path(f"/proc/{pid}/stat").read_text()
                state = status[status.rfind(")") + 2]
                if state == "Z":
                    return
            except FileNotFoundError:
                return
            time.sleep(0.02)
        self.fail("direct worker remained running after its parent exited")

    def test_guarded_worker_preserves_result_descriptor_and_normal_exit(self):
        result_read, result_write = os.pipe()
        script = self.root / "descriptor-worker.py"
        script.write_text(
            "import os\n"
            "os.write(int(os.environ['TEST_RESULT_FD']), b'guarded')\n")
        process = self.worker_helper(
            script, {"PATH": os.path.dirname(sys.executable), "LANG": "C.UTF-8",
                     "TEST_RESULT_FD": str(result_write)}, (result_write,))
        os.close(result_write)
        try:
            self.assertEqual(process.wait(timeout=5), 0)
            self.assertEqual(os.read(result_read, 7), b"guarded")
        finally:
            supervisor._terminate_group(process, immediate=True)
            for stream in (process.stdin, process.stdout, process.stderr):
                if not stream.closed:
                    stream.close()
            os.close(result_read)

    def test_guard_startup_deadline_terminates_worker(self):
        real_python = str(Path(sys.executable).resolve())
        marker = self.root / "delayed-python-start"
        wrapper = self.root / "delayed-python"
        wrapper.write_text(
            f"#!{real_python}\n"
            "import os,sys,time\n"
            f"open({str(marker)!r},'w').write('started')\n"
            "time.sleep(2)\n"
            f"os.execv({real_python!r}, [{real_python!r}, *sys.argv[1:]])\n")
        wrapper.chmod(0o700)
        script = self.root / "noop.py"
        script.write_text("pass\n")
        with patch.object(supervisor.sys, "executable", str(wrapper)):
            with self.assertRaises(supervisor.ChildFailure) as timed_out:
                supervisor._spawn_guarded_worker(
                    sys.executable, script, env={"PATH": os.path.dirname(real_python),
                                                  "LANG": "C.UTF-8"},
                    pass_fds=(), batch_deadline=time.monotonic() + 0.1)
        self.assertTrue(timed_out.exception.timed_out)
        self.assertTrue(marker.exists())


if __name__ == "__main__":
    unittest.main()
