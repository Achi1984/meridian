"""Real files/fork/journal evidence; SQL and authority remain explicit test doubles."""
import contextlib
import copy
import ctypes
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import sys
import subprocess
import tempfile
import time
import types
import unittest
from unittest import mock
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('parent_driver_helpers',ROOT/'test/test_publisher_role_transition.py')
f=importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
import publisher_parent_completion as m


class ParentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='meridian-parent-test-')
        self.base=Path(self.tmp.name); self.root=self.base/'anchor'; self.root.mkdir(mode=0o700)
        self.jroot=self.base/'journal'; self.jroot.mkdir(mode=0o700)
        self.modules=m.load_dependencies()
        self.binding=f.binding(); self.parent=os.getpid()
    def tearDown(self): self.tmp.cleanup()
    def factory(self,binding=None):
        binding=binding or self.binding; root=self.root; parent=self.parent
        journal_module=self.modules['publisher_role_journal']; jroot=self.jroot
        @contextlib.contextmanager
        def factory(phase):
            assert os.getpid()!=parent
            # Inherited anchor FD is already closed before any service creation.
            for entry in Path('/proc/self/fd').iterdir():
                try: target=os.readlink(entry)
                except FileNotFoundError: continue
                assert target!=str(root)
            descriptor=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
            try:
                try: fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError: pass
                else: raise AssertionError('parent lifetime lock lost')
            finally: os.close(descriptor)
            with journal_module.LocalRoleJournal(jroot) as journal:
                class Services(f.Services):
                    def expected_binding(self): return binding
                    def phase(self,token): phase(token)
                    def claim(self,value): return journal.claim(value)
                    def record(self,value,stage,status): return journal.record(value,stage,status)
                yield Services(binding['direction'])
        return factory
    def run_attempt(self,binding=None,events=None):
        binding=binding or self.binding
        return m.run_attempt(self.root,binding,f.baseline(),events or [],self.factory(binding))
    def terminal(self): return json.loads((self.root/'activation.terminal.json').read_text())
    def closure(self):
        binding=dict(self.binding,direction='closure',operation_id='8'*32)
        return self.run_attempt(binding,f.closure_transcript())

    def test_real_fork_parent_receipt_journal_closure_and_replay(self):
        result=self.run_attempt()
        self.assertEqual(result['outcome'],'CONFIRMED'); self.assertTrue(result['parentObservedConfirmedChildExit'])
        self.assertTrue(result['parentCompletionRecorded']); self.assertTrue(result['supervisorInvoked'])
        self.assertFalse(result['dispatchAuthorized']); self.assertFalse(result['evidenceAuthenticated'])
        self.assertEqual(self.terminal()['outcome'],'CONFIRMED')
        replay=self.run_attempt(dict(self.binding,operation_id='9'*32))
        self.assertFalse(replay['supervisorInvoked']); self.assertFalse((self.root/'blocked.json').exists())
        self.assertEqual(self.closure()['outcome'],'CONFIRMED')
        self.assertFalse(self.closure()['supervisorInvoked'])

    def test_changed_cycle_source_and_approval_cannot_create_new_slot(self):
        self.assertEqual(self.run_attempt()['outcome'],'CONFIRMED')
        for key in ('cycle_id','source_sha','approval_ref','baseline_sha256','workflow_sha'):
            changed=copy.deepcopy(self.binding); changed[key]='9'*len(changed[key])
            self.assertFalse(self.run_attempt(changed)['supervisorInvoked'])
        self.assertEqual(self.closure()['outcome'],'CONFIRMED')

    def test_parent_start_crash_consumes_attempt_without_terminal(self):
        pid=os.fork()
        if pid==0:
            original=m._Store.write
            def crash(store,name,value):
                original(store,name,value)
                if name=='activation.start.json': os._exit(17)
            m._Store.write=crash
            self.run_attempt(); os._exit(18)
        _,status=os.waitpid(pid,0); self.assertEqual(os.waitstatus_to_exitcode(status),17)
        self.assertTrue((self.root/'activation.start.json').exists())
        self.assertFalse(self.run_attempt()['supervisorInvoked'])
        self.assertFalse(self.closure()['supervisorInvoked'])

    def test_crash_after_child_confirmed_before_parent_terminal_blocks_closure(self):
        pid=os.fork()
        if pid==0:
            # Preserve child's real service PID guard for this intermediate parent.
            self.parent=os.getpid()
            original=m._Store.write
            def crash(store,name,value):
                if name=='activation.terminal.json': os._exit(19)
                return original(store,name,value)
            m._Store.write=crash
            self.run_attempt(); os._exit(20)
        _,status=os.waitpid(pid,0); self.assertEqual(os.waitstatus_to_exitcode(status),19)
        child=json.loads((self.jroot/self.binding['cycle_id']/'activation.03-finished.json').read_text())
        self.assertEqual(child['status'],'CONFIRMED')
        self.assertFalse((self.root/'activation.terminal.json').exists())
        self.assertFalse(self.closure()['supervisorInvoked'])

    def test_terminal_persist_ack_loss_poison_blocks_confirmed_disk_record(self):
        original=m._Store.write
        def fail(store,name,value):
            original(store,name,value)
            if name=='activation.terminal.json': raise OSError('synthetic acknowledgement loss')
        with mock.patch.object(m._Store,'write',fail): result=self.run_attempt()
        self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertTrue(result['parentObservedConfirmedChildExit'])
        self.assertEqual(self.terminal()['outcome'],'CONFIRMED')
        self.assertTrue((self.root/'blocked.json').exists()); self.assertFalse(self.closure()['supervisorInvoked'])

    def test_terminal_fsync_error_and_short_write_fail_closed(self):
        original_write=m._Store.write; real_fsync=m.os.fsync
        def fail(store,name,value):
            if name=='activation.terminal.json':
                with mock.patch.object(m.os,'fsync',side_effect=OSError('synthetic fsync')):
                    return original_write(store,name,value)
            return original_write(store,name,value)
        with mock.patch.object(m._Store,'write',fail): result=self.run_attempt()
        self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertFalse(self.closure()['supervisorInvoked'])
        other=self.base/'short'; other.mkdir(mode=0o700)
        with mock.patch.object(m.os,'write',return_value=0):
            result=m.run_attempt(other,self.binding,f.baseline(),[],self.factory())
        self.assertFalse(result['supervisorInvoked'])
        self.assertFalse(m.run_attempt(other,self.binding,f.baseline(),[],self.factory())['supervisorInvoked'])

    def test_concurrent_process_blocked_during_parent_terminal_critical_interval(self):
        rd,wr=os.pipe(); release_rd,release_wr=os.pipe(); pid=os.fork()
        if pid==0:
            os.close(rd); os.close(release_wr); self.parent=os.getpid()
            original=m._Store.write
            def pause(store,name,value):
                if name=='activation.terminal.json':
                    os.write(wr,b'R'); os.read(release_rd,1)
                return original(store,name,value)
            m._Store.write=pause
            result=self.run_attempt(); os._exit(0 if result['outcome']=='CONFIRMED' else 7)
        os.close(wr); os.close(release_rd)
        try:
            self.assertTrue(select.select([rd],[],[],3)[0]); self.assertEqual(os.read(rd,1),b'R')
            self.assertFalse(self.run_attempt()['supervisorInvoked'])
            self.assertFalse(self.closure()['supervisorInvoked'])
            os.write(release_wr,b'G')
            _,status=os.waitpid(pid,0); pid=None
            self.assertEqual(os.waitstatus_to_exitcode(status),0)
            self.assertEqual(self.closure()['outcome'],'CONFIRMED')
        finally:
            os.close(rd); os.close(release_wr)
            if pid:
                os.kill(pid,signal.SIGKILL); os.waitpid(pid,0)

    def test_strict_malformed_supervisor_flags_never_confirm(self):
        supervisor=self.modules['publisher_role_supervision']
        result={'outcome':'CONFIRMED','parentObservedConfirmedChildExit':1,
                'activationAuthorized':False,'dispatchAuthorized':False,'retryAuthorized':False,
                'productionTargetValidated':False,'fullGateAEstablished':False}
        with mock.patch.object(m,'load_dependencies',return_value=self.modules),mock.patch.object(supervisor,'supervise_transition',return_value=result):
            observed=self.run_attempt()
        self.assertEqual(observed['outcome'],'INDETERMINATE')
        self.assertEqual(self.terminal()['outcome'],'INDETERMINATE')
        self.assertFalse(self.closure()['supervisorInvoked'])

    def test_corrupt_duplicate_and_unexpected_evidence_fail_closed(self):
        for index,data in enumerate((b'{"schema":1,"schema":1}',b'{}',b'{"schema":NaN}',b'x'*4097)):
            root=self.base/str(index); root.mkdir(mode=0o700)
            path=root/'anchor.json'; path.write_bytes(data); path.chmod(0o600)
            self.assertFalse(m.run_attempt(root,self.binding,f.baseline(),[],self.factory())['supervisorInvoked'])
        (self.root/'unexpected').write_text('x')
        self.assertFalse(self.run_attempt()['supervisorInvoked'])

    def test_symlink_mode_and_replacement_boundaries(self):
        other=self.base/'other'; other.mkdir(mode=0o700)
        link=self.base/'link'; link.symlink_to(other)
        self.assertFalse(m.run_attempt(link,self.binding,f.baseline(),[],self.factory())['supervisorInvoked'])
        self.root.chmod(0o750); self.assertFalse(self.run_attempt()['supervisorInvoked']); self.root.chmod(0o700)
        original=m._Store.write
        def replace(store,name,value):
            if name=='activation.terminal.json':
                self.root.rename(self.base/'displaced'); self.root.mkdir(mode=0o700)
            return original(store,name,value)
        with mock.patch.object(m._Store,'write',replace): result=self.run_attempt()
        self.assertEqual(result['outcome'],'INDETERMINATE')
        self.assertFalse((self.root/'activation.terminal.json').exists())
        self.assertFalse((self.base/'displaced'/'activation.terminal.json').exists())

    def test_close_failure_never_returns_confirmed(self):
        original=m._Store.close; calls=[]
        def fail(store):
            if not calls: calls.append(True); raise OSError('synthetic close')
            original(store)
        with mock.patch.object(m._Store,'close',fail): result=self.run_attempt()
        self.assertEqual(result['outcome'],'INDETERMINATE'); self.assertFalse(self.closure()['supervisorInvoked'])

    def test_sigkill_parent_leaves_consumed_slot_and_protected_child_reaped(self):
        run=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).resolve()),'parent-death'],
                           capture_output=True,text=True,timeout=6)
        self.assertEqual(run.returncode,0,run.stderr)

    def test_source_pin_is_verified_before_any_attempt(self):
        with mock.patch.dict(m.PINS,{'publisher_role_supervision.py':'0'*64}): result=self.run_attempt()
        self.assertFalse(result['supervisorInvoked']); self.assertEqual(list(self.root.iterdir()),[])

def parent_death():
    assert ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0
    with tempfile.TemporaryDirectory(prefix='meridian-parent-death-') as tmp:
        root=Path(tmp)/'anchor'; root.mkdir(mode=0o700)
        rd,wr=os.pipe(); parent=os.fork(); worker=None
        if parent==0:
            os.close(rd)
            @contextlib.contextmanager
            def factory(phase):
                os.write(wr,str(os.getpid()).encode()); os.close(wr)
                time.sleep(10); yield None
            m.run_attempt(root,f.binding(),f.baseline(),[],factory)
            os._exit(8)
        os.close(wr)
        try:
            assert select.select([rd],[],[],2)[0]
            worker=int(os.read(rd,32))
            os.kill(parent,signal.SIGKILL); os.waitpid(parent,0); parent=None
            deadline=time.monotonic()+2
            while time.monotonic()<deadline:
                found,status=os.waitpid(worker,os.WNOHANG)
                if found:
                    worker=None
                    assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL
                    break
                time.sleep(.01)
            assert worker is None
            assert (root/'activation.start.json').exists()
            assert not (root/'activation.terminal.json').exists()
            result=m.run_attempt(root,f.binding(),f.baseline(),[],lambda phase:None)
            assert result['supervisorInvoked'] is False
        finally:
            os.close(rd)
            for pid in (parent,worker):
                if pid:
                    try: os.kill(pid,signal.SIGKILL); os.waitpid(pid,0)
                    except (ProcessLookupError,ChildProcessError): pass

if __name__=='__main__':
    if len(sys.argv)==2 and sys.argv[1]=='parent-death': parent_death()
    else: unittest.main()
