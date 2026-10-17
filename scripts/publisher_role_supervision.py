"""Bounded parent/child composition for the injected role-transition driver.

supervise_transition(binding, baseline, transcript, services_factory) forks via
an unchanged hash-pinned historical supervisor. The trusted factory is invoked
ONLY in its protected child and returns a context manager whose exit closes all
connection/journal resources. It receives the phase callback used by the driver.
It must not capture preopened credentials, connections or journal handles from
the parent, spawn descendants, swallow failures as success, or bypass driver
phases. This contract is not authenticated by accepting a Python callable.

A,C are consecutive before any factory/claim/connect/prewrite work. The driver
records mutation_started under bounded C; its M callback emits P,M consecutively.
There is no application work under historical unbounded owner-input A/P phases.
Cleanup L precedes context exit, including failure before connection acquisition.
Historical PDEATHSIG, phase-order, timeout and zero-child-exit checks remain intact.
An independent one-shot parent deadline also bounds SIGSTOP in A/P handshake gaps;
a private four-byte PID pipe permits ownership-checked termination and reaping.
The deadline handler never raises through historical resource/signal cleanup.
An existing real timer, pending/blocked SIGALRM or non-main-thread context is refused.
The result carries only parent-observed completion, never a child transcript.

All non-success outcomes are INDETERMINATE: never infer replay permission from
historical FAIL. CONFIRMED requires validated driver success, completed context
exit AND the parent's observed zero child exit. Disk CONFIRMED is not equivalent.
No CLI, credentials, connection factory, approval authentication or provider action
is supplied. PostgreSQL supervision integration and full Gate A remain unproved.
_test_budgets is solely for local fault tests; a future reviewed launcher must use
the historical fixed production budgets and verify its own caller/source context.
"""
import hashlib
import importlib.util
import os
import signal
import struct
import time
from pathlib import Path
import stat
import publisher_role_transition as transition

ROOT=Path(__file__).resolve().parent
SUPERVISOR_SHA256='3f3e4cab7fa64b5890fda1483bc73ac277636f001ec933bf514c926267ef68fb'


def load_supervisor():
    path=ROOT/'publisher_test_password_setup.py'
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,os.getuid())
                or info.st_mode & 0o022 or not 0<info.st_size<=262144):
            raise ValueError('supervisor source boundary')
        data=os.read(fd,262145)
    finally: os.close(fd)
    if len(data)!=info.st_size or hashlib.sha256(data).hexdigest()!=SUPERVISOR_SHA256:
        raise ValueError('supervisor source pin')
    module=importlib.util.module_from_spec(importlib.util.spec_from_file_location('pinned_role_supervisor',path))
    exec(compile(data,str(path),'exec'),module.__dict__)
    return module


def _equal(actual,expected):
    if type(actual) is not type(expected): return False
    if type(expected) is dict:
        return set(actual)==set(expected) and all(_equal(actual[k],v) for k,v in expected.items())
    if type(expected) is list:
        return len(actual)==len(expected) and all(_equal(a,b) for a,b in zip(actual,expected))
    return actual==expected


def _confirmed(result,binding,baseline):
    fields={'outcome','transcript','state','operationClaimConfirmed','connectionCleanupConfirmed',
            'activationAuthorized','dispatchAuthorized','supervisorCompletionEstablished',
            'ownerReconciliationRequired','evidenceAuthenticated'}
    if type(result) is not dict or set(result)!=fields or result['outcome']!='CONFIRMED': return False
    if (result['operationClaimConfirmed'] is not True or result['connectionCleanupConfirmed'] is not True
            or any(result[k] is not False for k in ('activationAuthorized','dispatchAuthorized',
                'supervisorCompletionEstablished','ownerReconciliationRequired','evidenceAuthenticated'))):
        return False
    state=transition.cycle.evaluate_cycle(baseline,result['transcript'])
    if not _equal(result['state'],state): return False
    return state['phase']==('READY' if binding['direction']=='activation' else 'AWAITING_SESSIONS')


def _worker(supervisor,binding,baseline,transcript,factory,phase):
    # No arbitrary factory or journal work between the paired acknowledgements.
    phase(b'A'); phase(b'C')
    last=[b'C']
    def adapted(token):
        if token==b'M' and last[0]==b'C':
            phase(b'P'); phase(b'M'); last[0]=b'M'
        elif token==b'L' and last[0] in (b'C',b'M'):
            phase(b'L'); last[0]=b'L'
        else:
            raise ValueError('role supervision phase order')
    def cleanup():
        if last[0]!=b'L': adapted(b'L')
    body_complete=False
    confirmed=False
    try:
        with factory(adapted) as services:
            try:
                result=transition.drive_transition(binding,baseline,transcript,services)
                confirmed=_confirmed(result,binding,baseline)
            finally:
                cleanup()
            # A context that swallows an exception cannot set this completion bit.
            body_complete=True
        return supervisor.STATUS_OK if body_complete and confirmed else supervisor.STATUS_UNKNOWN
    except BaseException:
        cleanup()
        return supervisor.STATUS_UNKNOWN


def _fallback_reap(pid,seconds):
    """Only signal a still-owned unreaped child; ECHILD must never lead to kill."""
    try:
        found,status=os.waitpid(pid,os.WNOHANG)
    except ChildProcessError:
        return 'already_reaped'
    if found==pid: return 'fallback_reaped'
    try: os.kill(pid,signal.SIGKILL)
    except ProcessLookupError: pass
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        try: found,status=os.waitpid(pid,os.WNOHANG)
        except ChildProcessError: return 'fallback_reaped'
        if found==pid: return 'fallback_reaped'
        time.sleep(min(0.01,max(0,until-time.monotonic())))
    return 'unconfirmed'


def supervise_transition(binding,baseline,transcript,services_factory,*,_test_budgets=None):
    """Return only completion flags; create no provider/journal resources in parent.

    The historical supervisor may already have reaped the PID. Missing PID or
    incomplete fallback cleanup cannot support confirmed completion. This does
    not prove that arbitrary factory-created descendants were cleaned up; those
    are prohibited by the trusted factory contract.
    """
    accepted=False
    rd=wr=None
    prior_handler=None
    armed=False
    original_result=None
    cleanup_result='unconfirmed'
    limits=None
    timed_out=False
    child_pid=None
    try:
        transition.validate_binding(binding,binding)
        transition.cycle.validate_baseline(baseline)
        transition.cycle.evaluate_cycle(baseline,transcript)
        if not callable(services_factory): raise ValueError('services factory')
        supervisor=load_supervisor()
        limits=dict(supervisor.PHASE_BUDGETS if _test_budgets is None else _test_budgets)
        if (set(limits)!=set(supervisor.PHASE_BUDGETS)
                or any(type(v) not in (int,float) or not 0<v<=30 for v in limits.values())):
            raise ValueError('phase budgets')
        if (signal.getitimer(signal.ITIMER_REAL)!=(0.0,0.0)
                or signal.SIGALRM in signal.sigpending()
                or signal.SIGALRM in signal.pthread_sigmask(signal.SIG_BLOCK,[])):
            raise ValueError('existing alarm context')
        prior_handler=signal.getsignal(signal.SIGALRM)
        def receive_pid():
            nonlocal child_pid
            if child_pid is None and rd is not None:
                try: packet=os.read(rd,5)
                except BlockingIOError: return None
                if len(packet)==4:
                    value=struct.unpack('!I',packet)[0]
                    if value>0 and value!=os.getpid(): child_pid=value
            return child_pid
        def expired(unused_signum,unused_frame):
            nonlocal timed_out
            timed_out=True
            # Never raise through the historical supervisor's own cleanup.
            # PID receipt precedes A, so a stopped A/P child has a receipt.
            try:
                pid=receive_pid()
                if pid is not None:
                    found,unused_status=os.waitpid(pid,os.WNOHANG)
                    if found==0: os.kill(pid,signal.SIGKILL)
            except (ChildProcessError,ProcessLookupError,OSError):
                pass
        signal.signal(signal.SIGALRM,expired)
        armed=True
        rd,wr=os.pipe2(os.O_NONBLOCK|os.O_CLOEXEC)
        def worker(phase):
            os.close(rd)
            if os.write(wr,struct.pack('!I',os.getpid()))!=4: raise ValueError('PID receipt')
            os.close(wr)
            return _worker(supervisor,binding,baseline,transcript,services_factory,phase)
        signal.setitimer(signal.ITIMER_REAL,sum(limits.values()))
        original_result=supervisor.supervise(worker,limits)
    except BaseException:
        original_result=None
    finally:
        # Disable our one-shot deadline before any fallback kill/reap work.
        if armed:
            try: signal.setitimer(signal.ITIMER_REAL,0)
            except BaseException: original_result=None
        if rd is not None:
            try:
                pid=receive_pid()
                if pid is not None:
                    cleanup_result=_fallback_reap(pid,limits['exit'])
            except BaseException: original_result=None
        for fd in (rd,wr):
            if fd is not None:
                try: os.close(fd)
                except OSError: original_result=None
        if armed:
            try: signal.signal(signal.SIGALRM,prior_handler)
            except BaseException: original_result=None
    if limits is not None and original_result is not None:
        accepted=not timed_out and original_result==supervisor.STATUS_OK and cleanup_result=='already_reaped'
    return {'outcome':'CONFIRMED' if accepted else 'INDETERMINATE',
            'parentObservedConfirmedChildExit':accepted,
            'activationAuthorized':False,'dispatchAuthorized':False,'retryAuthorized':False,
            'productionTargetValidated':False,'fullGateAEstablished':False}
