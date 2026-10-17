"""Durable local parent observation around the pinned role supervisor, not authority.

run_attempt(existing_private_root, binding, baseline, transcript, services_factory)
claims one activation and closure slot at ONE fixed root/cycle/common binding.
The root and immediate parent must be owned 0700 directories; all records are
exclusive canonical 0600 files, fsynced with their directory before success.
A nonblocking parent lifetime flock covers anchor/start, supervision, terminal
write and cleanup. The protected child closes its inherited descriptor (without
LOCK_UN) before invoking the trusted child-only services factory. No connection,
credential or service handle is created by this module in the parent.

Missing/uncertain parent terminal blocks closure even if a child journal says
CONFIRMED. Confirmed parent activation is necessary, never sufficient: the real
child journal/prewrite and authentic external approval remain independently
required by the trusted factory/launcher. No override, reset, rotation, dispatch,
network, provider or operational CLI is supplied. Input bindings are untrusted
syntax, not authenticated approval. The fixed root is trusted launcher input;
new roots, whole-root replacement across restart, storage loss and hostile
same-user changes are outside local replay guarantees. Arbitrary privileged
DB concurrency is not excluded by this filesystem lock.

A terminal records the parent-observed validated supervisor result, NOT receipt
of the final return by an external caller. A crash after its durable write cannot
prove that caller acknowledgement occurred; no additional ACK file could close
that final boundary. Dispatch authority is ALWAYS false. Parent filesystem and
fsync operations are outside child phase deadlines; an external launcher/watchdog
is required to bound stalled parent I/O. No parent I/O timeout is claimed. Caught storage/close
ambiguity attempts a persistent blocker; crashes before terminal leave a consumed
unfinished slot. If blocker persistence also fails, a valid terminal may remain
despite an uncertain storage acknowledgement; external reconciliation/storage
trust remains necessary. Tests may inject budgets only for disposable local work.
"""
import contextlib
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import sys

ROOT=Path(__file__).resolve().parent
PINS={
    'publisher_role_cycle.py':'fb46bfbd8ba52546bec25a7bab3864ac96abbd34d1e10cf0e8ab1939dc39c230',
    'publisher_role_transition.py':'93bd773e584072227a659b836bbb7aa079eb9a86736ab6e5ef3e97e7cb98785a',
    'publisher_role_journal.py':'3789410d4d67cc12db3404bd1cf58b4b6c0bb8633646b849e9c8106dec046425',
    'publisher_role_supervision.py':'80cfd10ab5c90feb93fab1bcde6963136074994eb54cdf2a2176acc8a52f90fe',
}


def load_dependencies():
    modules={}
    for filename,digest in PINS.items():
        path=ROOT/filename
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
        try:
            info=os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0,os.getuid())
                    or info.st_mode & 0o022 or not 0<info.st_size<=262144):
                raise ValueError('parent source boundary')
            data=os.read(fd,262145)
        finally: os.close(fd)
        if len(data)!=info.st_size or hashlib.sha256(data).hexdigest()!=digest:
            raise ValueError('parent source pin')
        name=filename[:-3]
        module=importlib.util.module_from_spec(importlib.util.spec_from_file_location(name,path))
        sys.modules[name]=module
        exec(compile(data,str(path),'exec'),module.__dict__)
        modules[name]=module
    return modules


def _common(binding): return {k:v for k,v in binding.items() if k not in ('direction','operation_id')}


class _Store:
    def __init__(self,path,helpers,transition):
        self.path=Path(path); self.h=helpers; self.transition=transition
        self.fd=None; self.locked=False
        parent=self.h._open_directory(self.path.parent)
        try: self.h._info(parent,True)
        finally: os.close(parent)
        self.fd=self.h._open_directory(self.path)
        try:
            self.identity=self.h._info(self.fd,True)
            fcntl.flock(self.fd,fcntl.LOCK_EX|fcntl.LOCK_NB); self.locked=True
        except BaseException:
            os.close(self.fd); self.fd=None; raise

    def check(self):
        other=self.h._open_directory(self.path)
        try:
            if self.h._info(other,True)!=self.identity or self.h._info(self.fd,True)!=self.identity:
                raise ValueError('parent root replaced')
        finally: os.close(other)

    def names(self):
        names=set()
        with os.scandir(self.fd) as entries:
            for entry in entries:
                names.add(entry.name)
                if len(names)>5: raise ValueError('parent evidence bound')
        allowed={'anchor.json','activation.start.json','activation.terminal.json','closure.start.json','closure.terminal.json'}
        if names-allowed: raise ValueError('unexpected parent evidence')
        return names

    def read(self,name):
        import json
        fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=self.fd)
        try:
            self.h._info(fd,False); size=os.fstat(fd).st_size
            data=os.read(fd,self.h.MAX_BYTES+1)
        finally: os.close(fd)
        if len(data)!=size: raise ValueError('parent read length')
        value=json.loads(data.decode('ascii'),object_pairs_hook=self.h._pairs,parse_constant=self.h._bad_constant)
        if self.h._encode(value)!=data: raise ValueError('parent canonical bytes')
        return value

    def write(self,name,value):
        self.check()
        data=self.h._encode(value)
        if len(data)>self.h.MAX_BYTES: raise ValueError('parent write bound')
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=self.fd)
        try:
            info=os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid()
                    or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1): raise ValueError('parent new file')
            if os.write(fd,data)!=len(data): raise ValueError('parent short write')
            os.fsync(fd)
        finally: os.close(fd)
        os.fsync(self.fd)

    def poison(self):
        if self.locked and self.fd is not None:
            try: self.write('blocked.json',{'schema':1,'state':'INDETERMINATE'})
            except BaseException: pass

    def validate(self,binding):
        self.check(); names=self.names()
        if not names: return None
        anchor=self.read('anchor.json')
        if anchor!={'schema':1,'common':_common(binding)} or type(anchor.get('schema')) is not int:
            raise ValueError('parent anchor mismatch')
        slots={}
        for direction in ('activation','closure'):
            start=direction+'.start.json'; terminal=direction+'.terminal.json'
            if start not in names:
                if terminal in names: raise ValueError('orphan parent terminal')
                slots[direction]=None; continue
            record=self.read(start); self.h._keys(record,('schema','binding'))
            if type(record['schema']) is not int or record['schema']!=1: raise ValueError('parent start schema')
            saved=record['binding']; self.transition.validate_binding(saved,saved)
            if saved['direction']!=direction or _common(saved)!=_common(binding): raise ValueError('parent start binding')
            state='UNFINISHED'
            if terminal in names:
                value=self.read(terminal)
                self.h._keys(value,('schema','binding_sha256','outcome'))
                if (type(value['schema']) is not int or value['schema']!=1
                        or value['binding_sha256']!=hashlib.sha256(self.h._encode(saved)).hexdigest()
                        or type(value['outcome']) is not str or value['outcome'] not in ('CONFIRMED','INDETERMINATE')):
                    raise ValueError('parent terminal schema')
                state=value['outcome']
            slots[direction]=state
        if slots['activation'] is None: raise ValueError('incomplete parent initialization')
        if slots['closure'] is not None and slots['activation']!='CONFIRMED': raise ValueError('parent closure order')
        return slots

    def close(self):
        if self.fd is not None:
            descriptor=self.fd
            # Close only: never explicit LOCK_UN, including the inherited child FD.
            os.close(descriptor)
            self.fd=None; self.locked=False


def _supervisor_confirmed(result):
    expected={'outcome':'CONFIRMED','parentObservedConfirmedChildExit':True,
              'activationAuthorized':False,'dispatchAuthorized':False,'retryAuthorized':False,
              'productionTargetValidated':False,'fullGateAEstablished':False}
    return (type(result) is dict and set(result)==set(expected)
            and all(type(result[k]) is type(v) and result[k]==v for k,v in expected.items()))


def run_attempt(root,binding,baseline,transcript,services_factory,*,_test_budgets=None):
    """Direct pinned invocation; no API accepts a caller-authored success receipt."""
    store=None; invoked=False; recorded=False; confirmed=False; observed=False; writing=False
    try:
        modules=load_dependencies(); transition=modules['publisher_role_transition']
        transition.validate_binding(binding,binding)
        transition.cycle.validate_baseline(baseline); transition.cycle.evaluate_cycle(baseline,transcript)
        if not callable(services_factory): raise ValueError('parent factory')
        store=_Store(root,modules['publisher_role_journal'],transition)
        slots=store.validate(binding)
        if slots is None:
            if binding['direction']!='activation': raise ValueError('activation required first')
            writing=True
            store.write('anchor.json',{'schema':1,'common':_common(binding)})
        elif (slots[binding['direction']] is not None
                or binding['direction']=='closure' and slots['activation']!='CONFIRMED'):
            raise ValueError('parent attempt already consumed or uncertain')
        writing=True
        store.write(binding['direction']+'.start.json',{'schema':1,'binding':binding})
        parent_pid=os.getpid(); inherited_fd=store.fd
        @contextlib.contextmanager
        def child_factory(phase):
            if os.getpid()==parent_pid: raise ValueError('parent factory execution')
            os.close(inherited_fd)  # Shared flock remains held by parent's own FD.
            with services_factory(phase) as services: yield services
        invoked=True
        result=modules['publisher_role_supervision'].supervise_transition(
            binding,baseline,transcript,child_factory,_test_budgets=_test_budgets)
        confirmed=_supervisor_confirmed(result); observed=confirmed
        store.write(binding['direction']+'.terminal.json',{'schema':1,
            'binding_sha256':hashlib.sha256(store.h._encode(binding)).hexdigest(),
            'outcome':'CONFIRMED' if confirmed else 'INDETERMINATE'})
        recorded=True
    except BaseException:
        confirmed=False
        # Never poison another writer. Once this process has the lock, ambiguity
        # is conservative: persistent blocking evidence is better than replay.
        if store is not None and writing: store.poison()
    finally:
        if store is not None:
            try: store.close()
            except BaseException:
                confirmed=False; store.poison()
                try: store.close()
                except BaseException: pass
    return {'outcome':'CONFIRMED' if confirmed else 'INDETERMINATE',
            'supervisorInvoked':invoked,'parentCompletionRecorded':recorded,
            'parentObservedConfirmedChildExit':observed,
            'activationAuthorized':False,'dispatchAuthorized':False,'retryAuthorized':False,
            'evidenceAuthenticated':False,'productionTargetValidated':False,'fullGateAEstablished':False}
