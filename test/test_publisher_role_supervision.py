"""Actual fork + local journal tests; SQL/prewrite/approval remain synthetic."""
import contextlib
from collections import deque
import ctypes
import importlib.util
import os
from pathlib import Path
import select
import signal
import struct
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
# Phase work stays short; owned-child exit needs a separate scheduler allowance.
BUDGETS['exit']=1.0
SUPERVISOR_ROOT_ENV='MERIDIAN_SUPERVISOR_TEST_ROOT'
if os.environ.get(SUPERVISOR_ROOT_ENV):
    m.ROOT=Path(os.environ[SUPERVISOR_ROOT_ENV])


class SupervisionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='meridian-supervision-')
        self.root=Path(self.tmp.name); self.jroot=self.root/'journal'; self.jroot.mkdir(mode=0o700)
        self.parent=os.getpid()
        self.enterContext(self.private_supervisor_root())
    def tearDown(self): self.tmp.cleanup()
    @contextlib.contextmanager
    def private_supervisor_root(self):
        private=tempfile.TemporaryDirectory(prefix='meridian-supervisor-src-')
        private_root=Path(private.name)
        supervisor_path=private_root/'publisher_test_password_setup.py'
        supervisor_path.write_bytes((m.ROOT/'publisher_test_password_setup.py').read_bytes())
        os.chmod(supervisor_path,0o600)
        try:
            with patch.object(m,'ROOT',private_root): yield private_root
        finally: private.cleanup()
    def factory(self,*,hang=None,fail=None,exit_error=False,suppress=False,nonzero=False):
        parent=self.parent; root=self.root; jroot=self.jroot
        @contextlib.contextmanager
        def factory(phase):
            assert os.getpid()!=parent
            (root/'worker').write_text(str(os.getpid()))
            if hang=='factory':
                (root/'ready').write_text(hang); time.sleep(5)
            with journal.LocalRoleJournal(jroot) as handle:
                class Services(f.Services):
                    def hit(self,name):
                        super().hit(name)
                        if hang==name:
                            (root/'ready').write_text(name); time.sleep(5)
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
        events=deque(maxlen=64); started=time.monotonic()
        self.worker_pids=[]
        read,waitpid,kill,reap=m.os.read,m.os.waitpid,m.os.kill,m._fallback_reap
        def note(kind,value):
            if os.getpid()==self.parent:
                count=1
                if events and events[-1][1:3]==(kind,value):
                    count=events.pop()[3]+1
                events.append((round(time.monotonic()-started,4),kind,value,count))
        def observe_read(fd,size):
            value=read(fd,size)
            if size==5 and len(value)==4:
                pid=struct.unpack('!I',value)[0]
                self.worker_pids.append(pid)
                note('pid_receipt',pid)
            elif size==1 and value in (b'A',b'C',b'P',b'M',b'L',b'F',b'U',b'O'):
                note('phase',value.decode())
            return value
        def observe_waitpid(pid,options):
            try: value=waitpid(pid,options)
            except ChildProcessError:
                note('waitpid',(pid,'ECHILD')); raise
            note('waitpid',(pid,value))
            return value
        def observe_kill(pid,sig):
            if os.getpid()==self.parent and (self.root/'ready').exists():
                note('ready',(self.root/'ready').read_text())
            try: value=kill(pid,sig)
            except OSError as exc:
                note('kill',(pid,int(sig),exc.errno)); raise
            note('kill',(pid,int(sig),'sent'))
            return value
        def observe_reap(pid,seconds):
            note('fallback_start',(pid,seconds))
            try: value=reap(pid,seconds)
            except BaseException as exc:
                note('fallback_exception',type(exc).__name__); raise
            note('fallback_end',value)
            return value
        with (
            patch.object(m.os,'read',side_effect=observe_read),
            patch.object(m.os,'waitpid',side_effect=observe_waitpid),
            patch.object(m.os,'kill',side_effect=observe_kill),
            patch.object(m,'_fallback_reap',side_effect=observe_reap),
        ):
            result=m.supervise_transition(f.binding(),f.baseline(),[],factory or self.factory(),_test_budgets=BUDGETS)
        note('return',result['outcome'])
        self.diagnostics=list(events)
        return result
    def assert_unknown(self,result):
        self.assertEqual(result['outcome'],'INDETERMINATE')
        self.assertFalse(result['parentObservedConfirmedChildExit'])
        self.assertTrue(all(v is False for k,v in result.items() if k!='outcome'))
    def assert_reaped(self):
        # PID receipt precedes factory work; a deadline can interrupt the child's
        # marker after truncation but before its buffered write reaches disk.
        if (self.root/'worker').exists():
            self.assertTrue(self.worker_pids,getattr(self,'diagnostics',[]))
        for pid in self.worker_pids:
            try: observed=os.waitpid(pid,os.WNOHANG)
            except ChildProcessError: continue
            self.fail(f'child {pid} not already reaped at return: waitpid={observed!r}; '
                      f'parent trace={getattr(self,"diagnostics",[])}')

    def test_actual_fork_driver_journal_success_and_restart_replay(self):
        with self.private_supervisor_root():
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
                (self.root/'ready').unlink(missing_ok=True)
                started=time.monotonic(); result=self.run_worker(self.factory(hang=step))
                self.assert_reaped()
                elapsed=time.monotonic()-started
                print(f'bounded step={step} ready={(self.root/"ready").exists()} '
                      f'elapsed={elapsed:.4f} phase=0.15 exit=1.0 trace={self.diagnostics}',file=sys.stderr)
                # Connect timeout + two reap allowances + 0.7s parent overhead < 3s.
                self.assert_unknown(result); self.assertLess(elapsed,3,self.diagnostics)
                self.assertEqual((self.root/'ready').read_text(),step,self.diagnostics)
                phases=[event[2] for event in self.diagnostics if event[1]=='phase']
                self.assertEqual(phases,['A','C'],self.diagnostics)

    def test_mutation_and_context_cleanup_timeouts(self):
        for step in ('alter','commit','close','record_finished','exit'):
            with self.subTest(step=step):
                self.jroot=self.root/step; self.jroot.mkdir(mode=0o700)
                self.assert_unknown(self.run_worker(self.factory(hang=step))); self.assert_reaped()

    def test_interrupted_worker_marker_keeps_reaping_assertion(self):
        # Reproduce a deadline between write_text's truncate and buffered write.
        original_write=Path.write_text
        def interrupted_write(path,data,*args,**kwargs):
            if path==self.root/'worker':
                original_write(path,'',*args,**kwargs)
                os.kill(os.getpid(),signal.SIGSTOP)
            return original_write(path,data,*args,**kwargs)
        with patch.object(Path,'write_text',interrupted_write):
            self.assert_unknown(self.run_worker())
        self.assertEqual((self.root/'worker').read_text(),'')
        self.assert_reaped()

    def test_context_exit_failure_never_confirmed(self):
        self.assert_unknown(self.run_worker(self.factory(exit_error=True))); self.assert_reaped()

    def test_context_suppression_cannot_turn_driver_exception_into_success(self):
        with patch.object(m.transition,'drive_transition',side_effect=RuntimeError('synthetic')):
            self.assert_unknown(self.run_worker(self.factory(suppress=True)))
        self.assert_reaped()

    def test_nonzero_exit_after_driver_success(self):
        started=time.monotonic()
        exit7=self.root/'nonzero-exit7'
        confirmed=self.root/'driver-confirmed'
        observed=[]
        real_waitpid=m.os.waitpid
        original_drive=m.transition.drive_transition
        def observe_drive(*args,**kwargs):
            result=original_drive(*args,**kwargs)
            if (type(result) is dict and result.get('outcome')=='CONFIRMED'
                    and result.get('operationClaimConfirmed') is True
                    and result.get('connectionCleanupConfirmed') is True):
                confirmed.write_text('confirmed')
                exit7.write_text('exit7')
                os._exit(7)
            raise AssertionError(f'unexpected drive result: {result!r}')
        def observe_waitpid(pid,options):
            found,status=real_waitpid(pid,options)
            worker=(self.root/'worker')
            if worker.exists() and found==int(worker.read_text()):
                observed.append((found,status))
            return found,status
        with self.private_supervisor_root():
            with (
                patch.object(m.transition,'drive_transition',side_effect=observe_drive),
                patch.object(m.os,'waitpid',side_effect=observe_waitpid),
                patch.dict(BUDGETS,{'exit':3.0}),
            ):
                self.assert_unknown(self.run_worker(self.factory())); self.assert_reaped()
        self.assertEqual(confirmed.read_text(),'confirmed')
        self.assertEqual(exit7.read_text(),'exit7')
        self.assertTrue(any(os.WIFEXITED(status) and os.WEXITSTATUS(status)==7 for _,status in observed),observed)
        self.assertLess(time.monotonic()-started,4.5)

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
            with patch.object(m,'_worker',side_effect=stopped):
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
        for label,observations,ticks,expected in (
            ('delayed_exit',[(0,0),(0,0),(123,0)],[0,0,0.01,0.01],'fallback_reaped'),
            ('deadline',[(0,0),(0,0)],[0,0,0.099,0.1],'unconfirmed'),
            ('deadline_before_poll',[(0,0)],[0,0.1],'unconfirmed'),
            ('ownership_lost',[(0,0),ChildProcessError],[0,0],'fallback_reaped'),
        ):
            with (
                self.subTest(cleanup=label),
                patch.object(m.os,'waitpid',side_effect=observations) as wait,
                patch.object(m.os,'kill') as kill,
                patch.object(m.time,'monotonic',side_effect=ticks),
                patch.object(m.time,'sleep') as sleep,
            ):
                self.assertEqual(m._fallback_reap(123,0.1),expected)
                self.assertEqual(wait.call_count,len(observations))
                kill.assert_called_once_with(123,signal.SIGKILL)
                self.assertLessEqual(sum(call.args[0] for call in sleep.call_args_list),0.1)
            if label=='ownership_lost':
                with patch.object(m.os,'waitpid',side_effect=ChildProcessError),patch.object(m.os,'kill') as kill:
                    self.assertEqual(m._fallback_reap(123,0.1),'already_reaped'); kill.assert_not_called()
        with (
            patch.object(m.os,'waitpid',side_effect=[(0,0),(123,0)]),
            patch.object(m.os,'kill',side_effect=ProcessLookupError),
            patch.object(m.time,'monotonic',side_effect=[0,0]),
        ):
            self.assertEqual(m._fallback_reap(123,0.1),'fallback_reaped')
        for boundary in ('waitpid','kill'):
            with (
                self.subTest(exception=boundary),
                patch.object(m.os,'waitpid',**(
                    {'side_effect':OSError} if boundary=='waitpid' else {'return_value':(0,0)}
                )),
                patch.object(m.os,'kill',side_effect=PermissionError) as kill,
            ):
                with self.assertRaises(OSError): m._fallback_reap(123,0.1)
                self.assertEqual(kill.call_count,0 if boundary=='waitpid' else 1)
        for cleanup in ('unconfirmed',OSError('synthetic cleanup failure')):
            with self.subTest(cleanup=type(cleanup).__name__),self.private_supervisor_root():
                self.jroot=self.root/type(cleanup).__name__; self.jroot.mkdir(mode=0o700)
                before=set(os.listdir('/proc/self/fd'))
                handlers=(signal.getsignal(signal.SIGTERM),signal.getsignal(signal.SIGALRM))
                with patch.object(m,'_fallback_reap',**(
                    {'side_effect':cleanup} if isinstance(cleanup,Exception) else {'return_value':cleanup}
                )):
                    self.assert_unknown(self.run_worker())
                self.assert_reaped()
                self.assertEqual(set(os.listdir('/proc/self/fd')),before)
                self.assertEqual((signal.getsignal(signal.SIGTERM),signal.getsignal(signal.SIGALRM)),handlers)
                self.assertEqual(signal.getitimer(signal.ITIMER_REAL),(0,0))

    def test_source_pin_rejects_changed_source_before_factory(self):
        with patch.object(m,'SUPERVISOR_SHA256','0'*64): self.assert_unknown(self.run_worker())
        self.assertFalse((self.root/'worker').exists())

    def test_real_parent_death_kills_protected_worker(self):
        with self.private_supervisor_root() as private_root:
            env=dict(os.environ)
            env[SUPERVISOR_ROOT_ENV]=str(private_root)
            run=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).resolve()),'parent-death'],
                               capture_output=True,text=True,timeout=6,env=env)
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
