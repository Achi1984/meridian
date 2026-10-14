"""Real subprocess/fork fault injection; no database, driver or real passwords.

python -I -m unittest discover -s test -p test_publisher_test_password_setup_supervisor.py
Linux process primitives are required; failures are not silently skipped.
"""
from pathlib import Path
import os
import subprocess
import sys
import time
import unittest

FIXTURES = Path(__file__).with_name('test_publisher_test_password_setup.py').resolve()
CHILD = r'''
import ctypes, importlib.util, os, select, signal, sys, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('offline_fixtures',sys.argv[1])
f=importlib.util.module_from_spec(spec); spec.loader.exec_module(f); m=f.m
scenario=sys.argv[2]
budgets={'setup':1,'connect':0.25,'mutation':0.25,'cleanup':0.25,'exit':0.25}
secret='SYNTHETIC_SECRET_MUST_NOT_LEAK'
def finish(result):
    assert result in (m.STATUS_OK,m.STATUS_FAIL,m.STATUS_UNKNOWN)
    if not m.emit_status(result): os._exit(2)
    os._exit({m.STATUS_OK:0,m.STATUS_FAIL:1,m.STATUS_UNKNOWN:2}[result])
def assert_reaped():
    try: os.waitpid(-1,os.WNOHANG)
    except ChildProcessError: return
    raise AssertionError('worker not reaped')

if scenario=='parent_death':
    libc=ctypes.CDLL(None,use_errno=True)
    assert libc.prctl(36,1,0,0,0)==0, 'subreaper unavailable'
    rd,wr=os.pipe()
    supervisor=os.fork()
    if supervisor==0:
        os.close(rd)
        def waiting_worker(phase):
            phase(b'A')
            os.write(wr,str(os.getpid()).encode()+b'\n')
            time.sleep(60)
        m.supervise(waiting_worker,budgets); os._exit(9)
    os.close(wr)
    assert select.select([rd],[],[],3)[0], 'worker not ready'
    worker=int(os.read(rd,64).strip()); os.close(rd)
    os.kill(supervisor,signal.SIGKILL)
    assert os.waitpid(supervisor,0)[0]==supervisor
    until=time.monotonic()+3
    while time.monotonic()<until:
        pid,status=os.waitpid(worker,os.WNOHANG)
        if pid==worker:
            assert os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL
            finish(m.STATUS_UNKNOWN)
        time.sleep(0.01)
    os.kill(worker,signal.SIGKILL)
    raise AssertionError('orphan worker remained alive')

if scenario=='full_output':
    def complete_worker(phase):
        for token in (b'A',b'C',b'P',b'M',b'L'): phase(token)
        return m.STATUS_OK
    result=m.supervise(complete_worker,budgets)
    assert result==m.STATUS_OK
    assert_reaped()
    rd,wr=os.pipe(); os.set_blocking(wr,False)
    try:
        while True: os.write(wr,b'x'*4096)
    except BlockingIOError: pass
    os.set_blocking(wr,True)
    alias=os.dup(wr)
    os.dup2(wr,1); os.close(wr)
    # No reader consumes this pipe; emit must return promptly, then exit2.
    assert m.emit_status(result) is False
    assert os.get_blocking(1) is True and os.get_blocking(alias) is True
    os.close(alias); os.close(rd); os._exit(2)

if scenario=='stdout_success':
    os._exit(0 if m.emit_status(m.STATUS_OK) else 2)

if scenario in ('output_partial','output_broken','output_restore_failure'):
    saved=os.dup(1)
    rd,wr=os.pipe(); alias=os.dup(wr); os.dup2(wr,1); os.close(wr)
    original_write=m.os.write; original_set=m.os.set_blocking
    if scenario=='output_partial':
        # A small pipe write is normally atomic. Inject the documented short
        # return path while retaining a real write and shared descriptor flags.
        m.os.write=lambda fd,data: original_write(fd,data[:5])
    if scenario=='output_broken':
        os.close(rd); rd=None
    restores=[]
    if scenario=='output_restore_failure':
        def fail_restore(fd,blocking):
            restores.append(blocking)
            if blocking: raise OSError('SYNTHETIC_SECRET_MUST_NOT_LEAK')
            return original_set(fd,blocking)
        m.os.set_blocking=fail_restore
    assert m.emit_status(m.STATUS_OK) is False
    m.os.write=original_write; m.os.set_blocking=original_set
    if scenario=='output_restore_failure':
        assert restores==[False,True]
        original_set(1,True)
    else:
        assert os.get_blocking(1) is True and os.get_blocking(alias) is True
    os.dup2(saved,1); os.close(saved); os.close(alias)
    if rd is not None:
        payload=os.read(rd,4096); os.close(rd)
        assert payload==(b'PASSW' if scenario=='output_partial' else (m.STATUS_OK+'\n').encode())
    finish(m.STATUS_UNKNOWN)

if scenario=='exit_stall':
    original=m._child_transition
    def stalled_exit(event,ack,token):
        original(event,ack,token)
        if token==b'O': time.sleep(60)
    m._child_transition=stalled_exit
if scenario=='malformed_wire':
    original=m._child_transition
    def malformed(event,ack,token):
        if token==b'A':
            os.write(event,b'X'); os.read(ack,1)
        else: original(event,ack,token)
    m._child_transition=malformed

class Adapter(f.Fake):
    def connect(self,**kwargs):
        if scenario=='connect': time.sleep(60)
        if scenario=='native_connect': ctypes.CDLL(None).pause()
        return super().connect(**kwargs)
    def execute(self,query):
        if scenario=='query' and query==m.IDENTITY_SQL: time.sleep(60)
        if scenario=='mutation' and isinstance(query,tuple): time.sleep(60)
        return super().execute(query)
    def commit(self):
        if scenario=='commit': time.sleep(60)
        return super().commit()
    def close(self):
        if scenario=='cleanup': time.sleep(60)
        if scenario=='cleanup_raises': raise RuntimeError(secret)
        return super().close()

def worker(phase):
    if scenario=='setup': time.sleep(60)
    if scenario=='early_success': return m.STATUS_OK
    if scenario=='worker_death': os._exit(7)
    if scenario=='worker_death_after_mutation':
        for token in (b'A',b'C',b'P',b'M'): phase(token)
        os._exit(7)
    if scenario=='bad_order': phase(b'M')
    adapter=Adapter('alter' if scenario=='normal_failure' else None)
    inputs=f.reader()
    reads=[0]
    def hidden(prompt):
        reads[0]+=1
        if scenario=='input_exempt' and reads[0] in (1,2): time.sleep(0.5)
        if scenario=='reader_exception': raise RuntimeError(secret)
        return inputs(prompt)
    result=m.perform(f.baseline(),Path('/synthetic/ca.pem'),adapter,hidden,phase)
    if scenario=='normal_failure':
        assert adapter.rolled_back and adapter.closed and not adapter.committed
    if result==m.STATUS_OK:
        assert adapter.committed and adapter.closed
    return result
result=m.supervise(worker,budgets)
assert_reaped()
if scenario=='disarm':
    time.sleep(0.5)
    assert m.supervise(worker,budgets)==m.STATUS_OK
    assert_reaped()
finish(result)
'''


class SupervisorTests(unittest.TestCase):
    def scenario(self, name, status, code):
        started = time.monotonic()
        result = subprocess.run([sys.executable, '-I', '-c', CHILD, str(FIXTURES), name],
                                capture_output=True, text=True, timeout=8)
        self.assertLess(time.monotonic() - started, 8)
        self.assertEqual(result.returncode, code, result.stderr)
        self.assertEqual(result.stdout, status + '\n' if status else '')
        self.assertEqual(result.stderr, '')
        self.assertNotIn('SYNTHETIC_SECRET', result.stdout + result.stderr)

    def test_stalled_setup_connect_and_query_are_failed_and_reaped(self):
        for phase in ('setup', 'connect', 'native_connect', 'query'):
            with self.subTest(phase=phase): self.scenario(phase, 'PASSWORD_SETUP_FAILED', 1)

    def test_stalled_mutation_commit_and_cleanup_are_indeterminate(self):
        for phase in ('mutation', 'commit', 'cleanup', 'cleanup_raises'):
            with self.subTest(phase=phase): self.scenario(phase, 'PASSWORD_SETUP_INDETERMINATE', 2)

    def test_owner_input_exceeds_network_budgets_without_timeout(self):
        self.scenario('input_exempt', 'PASSWORD_SETUP_CONFIRMED', 0)

    def test_normal_cleanup_returns_failure_without_claiming_forced_cleanup(self):
        self.scenario('normal_failure', 'PASSWORD_SETUP_FAILED', 1)

    def test_clean_success_disarms_and_reaps_before_next_invocation(self):
        self.scenario('disarm', 'PASSWORD_SETUP_CONFIRMED', 0)

    def test_malformed_protocol_order_and_unearned_success_fail_closed(self):
        for scenario in ('bad_order', 'malformed_wire', 'early_success'):
            with self.subTest(scenario=scenario): self.scenario(scenario, 'PASSWORD_SETUP_FAILED', 1)

    def test_worker_death_before_and_after_mutation(self):
        self.scenario('worker_death', 'PASSWORD_SETUP_FAILED', 1)
        self.scenario('worker_death_after_mutation', 'PASSWORD_SETUP_INDETERMINATE', 2)

    def test_success_message_followed_by_stalled_worker_exit_is_indeterminate(self):
        self.scenario('exit_stall', 'PASSWORD_SETUP_INDETERMINATE', 2)

    def test_full_stdout_pipe_never_blocks_exit_or_reports_success(self):
        self.scenario('full_output', '', 2)

    def test_output_restores_flags_on_the_parent_shared_open_file_description(self):
        for originally_blocking in (True, False):
            with self.subTest(blocking=originally_blocking):
                rd, wr = os.pipe()
                try:
                    os.set_blocking(wr, originally_blocking)
                    alias = os.dup(wr)
                    try:
                        result = subprocess.run([sys.executable, '-I', '-c', CHILD, str(FIXTURES), 'stdout_success'],
                                                stdout=wr, stderr=subprocess.PIPE, timeout=8)
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(result.stderr, b'')
                        self.assertEqual(os.get_blocking(wr), originally_blocking)
                        self.assertEqual(os.get_blocking(alias), originally_blocking)
                    finally:
                        os.close(alias)
                    os.close(wr); wr = None
                    self.assertEqual(os.read(rd, 4096), b'PASSWORD_SETUP_CONFIRMED\n')
                finally:
                    os.close(rd)
                    if wr is not None: os.close(wr)

    def test_partial_broken_and_flag_restore_failures_cannot_report_success(self):
        for scenario in ('output_partial', 'output_broken', 'output_restore_failure'):
            with self.subTest(scenario=scenario):
                self.scenario(scenario, 'PASSWORD_SETUP_INDETERMINATE', 2)

    def test_parent_death_kills_worker_even_in_unbounded_input(self):
        self.scenario('parent_death', 'PASSWORD_SETUP_INDETERMINATE', 2)

    def test_secret_bearing_worker_exception_is_not_emitted(self):
        self.scenario('reader_exception', 'PASSWORD_SETUP_FAILED', 1)


if __name__ == '__main__':
    unittest.main()
