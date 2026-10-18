"""Canonical SYNTHETIC TEST launch binding, never human/owner authentication.

run_synthetic_attempt(root, raw_manifest, expected_sha256, direction, baseline,
transcript, factory, decision, now=integer_epoch) verifies bounded canonical bytes,
immutable source files, baseline, scope and direction-specific expiry BEFORE
calling the pinned parent coordinator. factory(derived_binding, phase) runs only
in its protected child. Neither approval dictionaries nor owner-authored GitHub
comments are authentic human decisions. No CLI, credentials, network, workflow
installation, dispatch or operational authority is supplied.

root is a pre-existing owned0700 container with owned0700 attempts/ directory.
An exclusive immutable manifest.json companion binds fields absent from the older
coordinator binding without changing its allowed files. Container flock lives
across the coordinator call; child closes inherited FD WITHOUT unlocking parent's
shared lock before constructing services. The same canonical bytes are required
for activation and closure; the manifest is never regenerated from the clock.
now is explicitly synthetic supplied time, not authenticated freshness evidence.
Elapsed monotonic time advances it before the immediate pre-coordinator recheck;
slow preparation cannot refresh the window. Wall-clock trust and a watchdog for
stalled parent I/O remain external; no parent I/O deadline is provided.
Closure has its own later deadline; expiration requires external reconciliation,
never automatic deadline extension, retry or NOLOGIN repair.

source_commit selects a release independently of fixed dependency byte pins:
no self-referential Git commit/file hash cycle. The reviewed outer caller pins
this adapter itself; SOURCES pins its runtime dependencies, not its own bytes. Installed workflow commit is an
explicit SYNTHETIC observation distinct from proposed bytes, not an installation
claim. No manifest is shipped with real authority. Root replacement/storage loss,
hostile same-user mutation, privileged database concurrency, external caller ACK
and unbounded parent filesystem I/O retain the coordinator's stated limitations.
Fresh direct human approval, trusted clock/transport/target and exact operational
launcher remain external reviewed orchestration prerequisites.
"""
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import time

ROOT=Path(__file__).resolve().parent
MAX_BYTES=16384
COORDINATOR_SHA='724e99f08c9b3ad96c4ff426bc4318ed317897018fdc8851e794f6c394bce585'
SOURCES={
 'publisher_parent_completion.py':COORDINATOR_SHA,
 'publisher_role_cycle.py':'fb46bfbd8ba52546bec25a7bab3864ac96abbd34d1e10cf0e8ab1939dc39c230',
 'publisher_role_transition.py':'93bd773e584072227a659b836bbb7aa079eb9a86736ab6e5ef3e97e7cb98785a',
 'publisher_role_journal.py':'3789410d4d67cc12db3404bd1cf58b4b6c0bb8633646b849e9c8106dec046425',
 'publisher_role_supervision.py':'80cfd10ab5c90feb93fab1bcde6963136074994eb54cdf2a2176acc8a52f90fe',
 'publisher_role_prewrite.py':'8f78391afbc0d6af1ddee328df25a53254fe3d35aae9a1ed0db94a999f10e363',
 'publisher_test_password_setup.py':'3f3e4cab7fa64b5890fda1483bc73ac277636f001ec933bf514c926267ef68fb',
 'publisher_test_readonly_inspection.py':'cef46e32d0d20e20f0051d06920c984fe19977a9354b2ea8cce6c0dd582dd5b9',
 'publisher-test-readonly-queries.json':'99ac288ed3e1dd5681345aa828bed3e129e729a1430f9022ca456622b62e7789',
 'publisher_fixture_catalog.py':'aecca8ba7ea9ae20c848ae8b240cb179389c13a93a5c1ba9d1a20a605e1495c5',
 'publisher-fixture-catalog-pg16.json':'611ce25904b59473149f5cb8bc69613309b0b8b147df6296defdfecc0ee11274',
}
WORKFLOW_SHA='1d934231bb3439c3808f9501c7ee78854f657fe6734ec9ded8f0e14ef09d6968'
WORKFLOW_PATH=ROOT.parent/'docs/autonomy/event-adapter/review-binding/fixtures/meridian-database-readiness.yml'
REPOSITORY={'name':'Achi1984/meridian','id':1342084551,'owner_id':319562141}
ENVIRONMENT='meridian-publisher-test'
EFFECTS={'activation':['ROLE_LOGIN'],'closure':['ROLE_NOLOGIN'],'workflow_installation':False,'dispatch':False}


def encode(value): return (json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
def digest(raw): return hashlib.sha256(raw).hexdigest()
def _keys(value,keys):
    if type(value) is not dict or set(value)!=set(keys): raise ValueError('manifest fields')
def _pairs(items):
    value={}
    for key,item in items:
        if key in value: raise ValueError('manifest duplicate')
        value[key]=item
    return value

def _nonfinite(unused): raise ValueError('manifest nonfinite')
def _hex(value,count): return type(value) is str and re.fullmatch('[0-9a-f]{'+str(count)+'}',value) is not None

def pinned_bytes(path,expected):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    try:
        info=os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,os.getuid())
                or info.st_mode & 0o022 or not 0<info.st_size<=262144): raise ValueError('launch source boundary')
        raw=os.read(fd,262145)
    finally: os.close(fd)
    if len(raw)!=info.st_size or digest(raw)!=expected: raise ValueError('launch source pin')
    return raw


def source_bytes(name): return pinned_bytes(ROOT/name,SOURCES[name])


def dependencies():
    captured={name:source_bytes(name) for name in SOURCES}
    pinned_bytes(WORKFLOW_PATH,WORKFLOW_SHA)  # Proposed source bytes only, never installation evidence.
    path=ROOT/'publisher_parent_completion.py'
    module=importlib.util.module_from_spec(importlib.util.spec_from_file_location('manifest_parent',path))
    exec(compile(captured[path.name],str(path),'exec'),module.__dict__)
    loaded=module.load_dependencies()
    return module,loaded['publisher_role_transition'],loaded['publisher_role_journal']


def validate(raw,expected,direction,baseline,root,decision,now,transition):
    if type(raw) is not bytes or not 0<len(raw)<=MAX_BYTES or not _hex(expected,64) or digest(raw)!=expected:
        raise ValueError('manifest digest or size')
    manifest=json.loads(raw.decode('ascii'),object_pairs_hook=_pairs,parse_constant=_nonfinite)
    if encode(manifest)!=raw: raise ValueError('manifest canonical bytes')
    _keys(manifest,('schema','kind','source_commit','sources','baseline_sha256','catalog_sha256','workflow',
                    'repository','environment','target','cycle_id','root','window','effects','synthetic_decision_ref'))
    if type(manifest['schema']) is not int or manifest['schema']!=1 or manifest['kind']!='SYNTHETIC_TEST_LAUNCH_MANIFEST':
        raise ValueError('manifest kind')
    if not _hex(manifest['source_commit'],40) or not _hex(manifest['cycle_id'],32) or manifest['sources']!=SOURCES:
        raise ValueError('manifest sources')
    transition.cycle.validate_baseline(baseline)
    if manifest['baseline_sha256']!=digest(encode(baseline)) or manifest['catalog_sha256']!=transition.MANIFEST:
        raise ValueError('manifest baseline/catalog')
    if (encode(manifest['repository'])!=encode(REPOSITORY) or manifest['environment']!=ENVIRONMENT
            or manifest['target']!=transition.TARGET or encode(manifest['effects'])!=encode(EFFECTS)):
        raise ValueError('manifest scope')
    if not isinstance(root,Path) or not root.is_absolute() or '..' in root.parts or manifest['root']!=str(root):
        raise ValueError('manifest root')
    workflow=manifest['workflow']; _keys(workflow,('proposed_sha256','installed'))
    installed=workflow['installed']; _keys(installed,('kind','commit','bytes_sha256'))
    if (workflow['proposed_sha256']!=WORKFLOW_SHA or installed['kind']!='SYNTHETIC_OBSERVATION'
            or not _hex(installed['commit'],40) or installed['bytes_sha256']!=WORKFLOW_SHA):
        raise ValueError('manifest workflow')
    window=manifest['window']; _keys(window,('not_before','activation_expires','closure_expires'))
    if (type(direction) is not str or direction not in ('activation','closure') or type(now) is not int
            or any(type(v) is not int for v in window.values())
            or not 0<=window['not_before']<window['activation_expires']<window['closure_expires']<=window['not_before']+86400
            or not window['not_before']<=now<window[direction+'_expires']):
        raise ValueError('manifest time/direction')
    ref=manifest['synthetic_decision_ref']
    if type(ref) is not str or re.fullmatch('[1-9][0-9]{0,19}',ref) is None:
        raise ValueError('synthetic reference')
    _keys(decision,('kind','manifest_sha256','reference'))
    if decision!={'kind':'SYNTHETIC_DECISION_INPUT','manifest_sha256':expected,'reference':ref}:
        raise ValueError('synthetic decision binding')
    binding={'operation_id':digest((expected+':'+direction).encode())[:32], 'cycle_id':manifest['cycle_id'],
             'direction':direction,'source_sha':manifest['source_commit'],'baseline_sha256':manifest['baseline_sha256'],
             'manifest_sha256':manifest['catalog_sha256'],'workflow_sha':installed['commit'],
             'approval_ref':ref,'target':dict(transition.TARGET)}
    transition.validate_binding(binding,binding)
    return binding


def run_synthetic_attempt(root,raw,expected,direction,baseline,transcript,factory,decision,now,*,_test_budgets=None):
    result={'outcome':'INDETERMINATE','supervisorInvoked':False,'parentCompletionRecorded':False,
            'parentObservedConfirmedChildExit':False,'activationAuthorized':False,'dispatchAuthorized':False,
            'retryAuthorized':False,'evidenceAuthenticated':False,'productionTargetValidated':False,'fullGateAEstablished':False}
    fd=None; locked=False; accepted=False; writing=False; helpers=None
    started=time.monotonic()
    def check():
        current=helpers._open_directory(root)
        try:
            if helpers._info(current,True)!=identity or helpers._info(fd,True)!=identity: raise ValueError('manifest root replaced')
        finally: os.close(current)
    def stored():
        check()
        descriptor=os.open('manifest.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=fd)
        try:
            info=os.fstat(descriptor)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or stat.S_IMODE(info.st_mode)!=0o600
                    or info.st_nlink!=1 or not 0<info.st_size<=MAX_BYTES): raise ValueError('manifest file boundary')
            content=os.read(descriptor,MAX_BYTES+1)
        finally: os.close(descriptor)
        if content!=raw: raise ValueError('manifest companion drift')
    def poison():
        if fd is not None and locked:
            try:
                check()
                marker=os.open('blocked.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
                try:
                    if os.write(marker,b'BLOCKED\n')!=8: raise ValueError('marker write')
                    os.fsync(marker)
                finally: os.close(marker)
                os.fsync(fd)
            except BaseException: pass
    try:
        # Detach caller-owned mutable objects before source reads or locking.
        if type(decision) is not dict: raise ValueError('synthetic decision type')
        frozen=[]
        for value in (baseline,transcript,decision):
            encoded=encode(value)
            if len(encoded)>MAX_BYTES*4: raise ValueError('launch input size')
            frozen.append(json.loads(encoded,object_pairs_hook=_pairs,parse_constant=_nonfinite))
        baseline,transcript,decision=frozen
        coordinator,transition,helpers=dependencies()
        binding=validate(raw,expected,direction,baseline,root,decision,now,transition)
        parent=helpers._open_directory(root.parent)
        try: helpers._info(parent,True)
        finally: os.close(parent)
        fd=helpers._open_directory(root); identity=helpers._info(fd,True)
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); locked=True
        names=set()
        with os.scandir(fd) as entries:
            for entry in entries:
                names.add(entry.name)
                if len(names)>2: raise ValueError('manifest root entries')
        if names not in ({'attempts'},{'attempts','manifest.json'}): raise ValueError('manifest root layout')
        attempt=helpers._open_directory(root/'attempts')
        try:
            helpers._info(attempt,True)
            if 'manifest.json' not in names:
                if direction!='activation' or os.listdir(attempt): raise ValueError('manifest missing with history')
                writing=True
                descriptor=os.open('manifest.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=fd)
                try:
                    if os.write(descriptor,raw)!=len(raw): raise ValueError('manifest short write')
                    os.fsync(descriptor)
                finally: os.close(descriptor)
                os.fsync(fd)
        finally: os.close(attempt)
        stored()
        elapsed=time.monotonic()-started
        if elapsed<0: raise ValueError('synthetic clock movement')
        binding=validate(raw,expected,direction,baseline,root,decision,now+int(elapsed),transition)
        accepted=True; writing=True
        parent_pid=os.getpid(); inherited=fd
        @contextlib.contextmanager
        def child(phase):
            if os.getpid()==parent_pid: raise ValueError('manifest factory parent')
            os.close(inherited)  # Close-only preserves the parent's lifetime flock.
            with factory(binding,phase) as services: yield services
        result=coordinator.run_attempt(root/'attempts',binding,baseline,transcript,child,_test_budgets=_test_budgets)
        stored()
    except BaseException:
        result['outcome']='INDETERMINATE'
        if writing: poison()
    finally:
        if fd is not None:
            try: os.close(fd)
            except BaseException:
                result['outcome']='INDETERMINATE'; poison()
                try: os.close(fd)
                except BaseException: pass
    result.update(manifestIntegrityChecked=accepted,syntheticExecutionOnly=True)
    return result
