"""Actual fork + local journal tests; SQL/prewrite/approval remain synthetic."""
import contextlib
import ctypes
import importlib.util
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('role_driver_test_helpers',ROOT/'test/test_publisher_role_transition.py')
f=importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
import publisher_role_supervision as m
import publisher_role_journal as journal
BUDGETS=dict.fromkeys(('setup','connect','mutation','cleanup','exit'),0.15)


class SupervisionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='meridian-supervision-')
        self.root=Path(self.tmp.name); self.jroot=self.root/'journal'; self.jroot.mkdir(mode=0o700)
        self.parent=os.getpid()
    def tearDown(self): self.tmp.cleanup()
    def factory(self,*,hang=None,fail=None,exit_error=False,suppress=False,nonzero=False):
        parent=self.parent; root=self.root; jroot=self.jroot
        @contextlib.contextmanager
        def factory(phase):
            assert os.getpid()!=parent
            (root/'worker').write_text(str(os.getpid()))
            if hang=='factory': time.sleep(5)
            with journal.LocalRoleJournal(jroot) as handle:
                class Services(f.Services):
                    def hit(self,name):
                        super().hit(name)
                        if hang==name: time.sleep(5)
                        if fail==name: raise RuntimeError('synthetic failure')
                    def phase(self,token): phase(token)
                    def claim(self,binding):
                        self.hit('claim'); return handle.claim(binding)
                    def record(self,binding,stage,status):
                        self.hit('record_'+stage); return handle.record(binding,stage,status)
                try: yield Services()
                except BaseException:
                    if not suppress: raise
                if hang=='exit': time.sleep(5)
                if nonzero: os._exit(7)
                if exit_error: raise RuntimeError('synthetic context failure')
        return factory
    def run_worker(self,factory=None):
        return m.supervise_transition(f.binding(),f.baseline(),[],factory or self.factory(),_test_budgets=BUDGETS)
    def assert_unknown(self,result):
        self.assertEqual(result['outcome'],'INDETERMINATE')
        self.assertFalse(result['parentObservedConfirmedChildExit'])
        self.assertFalse(result['retryAuthorized'])
    def assert_reaped(self):
        if (self.root/'worker').exists():
            pid=int((self.root/'worker').read_text())
            try: observed=os.waitpid(pid,os.WNOHANG)
            except ChildProcessError: return
            self.fail(f'child {pid} not already reaped at return: waitpid={observed!r}')

    def test_actual_fork_driver_journal_success_and_restart_replay(self):
        result=self.run_worker()
        self.assertEqual(result['outcome'],'CONFIRMED')
        self.assertTrue(result['parentObservedConfirmedChildExit'])
        self.assertTrue(all(v is False for k,v in result.items() if k not in ('outcome','parentObservedConfirmedChildExit')))
        self.assertNotEqual(int((self.root/'worker').read_text()),self.parent)
        self.assert_reaped()
        with journal.LocalRoleJournal(self.jroot) as handle:
            changed=f.binding(); changed['operation_id']='9'*32
            self.assertFalse(handle.claim(changed))

    def test_all_pre_mutation_work_is_connect_bounded(self):
        for step in ('factory','claim','connect','prewrite','record_mutation_started'):
            with self.subTest(step=step):
                # Separate private root per case; consumed slots must never be reset.
                self.jroot=self.root/step; self.jroot.mkdir(mode=0o700)
                started=time.monotonic(); self.assert_unknown(self.run_worker(self.factory(hang=step)))
                self.assertLess(time.monotonic()-started,2); self.assert_reaped()

    def test_mutation_and_context_cleanup_timeouts(self):
        for step in ('alter','commit','close','record_finished','exit'):
            with self.subTest(step=step):
                self.jroot=self.root/step; self.jroot.mkdir(mode=0o700)
                self.assert_unknown(self.run_worker(self.factory(hang=step))); self.assert_reaped()

    def test_context_exit_failure_never_confirmed(self):
        self.assert_unknown(self.run_worker(self.factory(exit_error=True))); self.assert_reaped()

    def test_context_suppression_cannot_turn_driver_exception_into_success(self):
        with patch.object(m.transition,'drive_transition',side_effect=RuntimeError('synthetic')):
            self.assert_unknown(self.run_worker(self.factory(suppress=True)))
        self.assert_reaped()

    def test_nonzero_exit_after_driver_success(self):
        self.assert_unknown(self.run_worker(self.factory(nonzero=True))); self.assert_reaped()

    def test_malformed_driver_and_truthy_flags_rejected(self):
        original=m.transition.drive_transition
        for value in ('missing',1):
            self.jroot=self.root/str(value); self.jroot.mkdir(mode=0o700)
            def malformed(*args):
                result=original(*args)
                if value=='missing': result.pop('state')
                else: result['connectionCleanupConfirmed']=value
                return result
            with patch.object(m.transition,'drive_transition',side_effect=malformed):
                self.assert_unknown(self.run_worker())

    def test_invalid_phase_order_is_unknown(self):
        @contextlib.contextmanager
        def invalid(phase):
            phase(b'P'); yield f.Services()
        self.assert_unknown(self.run_worker(invalid))

    def test_sigstop_at_unbounded_handshake_gaps_is_reaped(self):
        original=m._worker
        for token in (b'A',b'P'):
            self.jroot=self.root/token.decode(); self.jroot.mkdir(mode=0o700)
            def stopped(supervisor,binding,baseline,transcript,factory,phase):
                (self.root/'worker').write_text(str(os.getpid()))
                def wrapped(value):
                    phase(value)
                    if value==token: os.kill(os.getpid(),signal.SIGSTOP)
                return original(supervisor,binding,baseline,transcript,factory,wrapped)
            before=set(os.listdir('/proc/self/fd'))
            handlers=(signal.getsignal(signal.SIGTERM),signal.getsignal(signal.SIGALRM))
            started=time.monotonic()
            # CI scheduling can consume the old 150ms test-only reap allowance.
            # Preserve immediate reaping checks; do not poll to manufacture success.
            with patch.dict(BUDGETS,{'exit':1.0}),patch.object(m,'_worker',side_effect=stopped):
                self.assert_unknown(self.run_worker())
            self.assertLess(time.monotonic()-started,5)
            self.assert_reaped()
            self.assertEqual(set(os.listdir('/proc/self/fd')),before)
            self.assertEqual((signal.getsignal(signal.SIGTERM),signal.getsignal(signal.SIGALRM)),handlers)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))

    def test_existing_timer_refused_without_altering_it(self):
        signal.setitimer(signal.ITIMER_REAL,10,3)
        try:
            self.assert_unknown(self.run_worker())
            remaining,interval=signal.getitimer(signal.ITIMER_REAL)
            self.assertGreater(remaining,9); self.assertEqual(interval,3)
            self.assertFalse((self.root/'worker').exists())
        finally: signal.setitimer(signal.ITIMER_REAL,0)

    def test_handlers_timer_and_fds_restored_after_timeout(self):
        previous=signal.getsignal(signal.SIGALRM); custom=lambda *_: None
        signal.signal(signal.SIGALRM,custom)
        term=signal.getsignal(signal.SIGTERM)
        before=set(os.listdir('/proc/self/fd'))
        try:
            self.assert_unknown(self.run_worker(self.factory(hang='factory')))
            self.assertIs(signal.getsignal(signal.SIGALRM),custom)
            self.assertEqual(signal.getsignal(signal.SIGTERM),term)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))
            self.assertEqual(set(os.listdir('/proc/self/fd')),before)
        finally: signal.signal(signal.SIGALRM,previous)

    def test_fallback_never_signals_reaped_or_unowned_pid(self):
        with patch.object(m.os,'waitpid',side_effect=ChildProcessError),patch.object(m.os,'kill') as kill:
            self.assertEqual(m._fallback_reap(123,0.1),'already_reaped'); kill.assert_not_called()
        with patch.object(m.os,'waitpid',return_value=(123,0)),patch.object(m.os,'kill') as kill:
            self.assertEqual(m._fallback_reap(123,0.1),'fallback_reaped'); kill.assert_not_called()

    def test_source_pin_rejects_changed_source_before_factory(self):
        with patch.object(m,'SUPERVISOR_SHA256','0'*64): self.assert_unknown(self.run_worker())
        self.assertFalse((self.root/'worker').exists())

    def test_real_parent_death_kills_protected_worker(self):
        run=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).resolve()),'parent-death'],
                           capture_output=True,text=True,timeout=6)
        self.assertEqual(run.returncode,0,run.stderr)


def parent_death():
    libc=ctypes.CDLL(None,use_errno=True)
    assert libc.prctl(36,1,0,0,0)==0
    rd,wr=os.pipe(); parent=os.fork()
    if parent==0:
        os.close(rd)
        @contextlib.contextmanager
        def factory(phase):
            os.write(wr,str(os.getpid()).encode()); os.close(wr)
            time.sleep(10); yield f.Services()
        m.supervise_transition(f.binding(),f.baseline(),[],factory)
        os._exit(8)
    os.close(wr); worker=None
    try:
        assert select.select([rd],[],[],2)[0]
        worker=int(os.read(rd,32))
        os.kill(parent,signal.SIGKILL); os.waitpid(parent,0); parent=None
        deadline=time.monotonic()+2
        while time.monotonic()<deadline:
            found,status=os.waitpid(worker,os.WNOHANG)
            if found:
                worker=None; assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL; return
            time.sleep(.01)
        raise AssertionError('protected worker survived parent')
    finally:
        os.close(rd)
        for pid in (parent,worker):
            if pid:
                try: os.kill(pid,signal.SIGKILL); os.waitpid(pid,0)
                except (ProcessLookupError,ChildProcessError): pass


if __name__=='__main__':
    if len(sys.argv)==2 and sys.argv[1]=='parent-death': parent_death()
    else: unittest.main()
