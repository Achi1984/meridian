"""Local single-attempt evidence store for the injected role-transition driver.

LocalRoleJournal(existing_private_root).claim(binding) / record(binding,stage,
status) implement the service methods; caller MUST close() in its outer finally.
A short root-directory flock serializes initialization. A nonblocking flock on
the cycle directory lives until explicit close, including
after finished. No resumed writer, overwrite, deletion, reset or retry API exists.
Both root and its immediate parent must be current-user-owned 0700 directories.
Existing files are owner-only 0600, single-link, regular, bounded strict JSON.

Claims bind all reviewed source/baseline/manifest/workflow/approval/target fields.
Operation IDs do not create extra slots: one activation and one closure per cycle.
Closure requires an observed CONFIRMED activation record; failed/unfinished or
ambiguous activation needs a future separately reviewed reconciliation adapter.
This module supplies no such override. CONFIRMED on disk is NOT proof that its
acknowledgement, parent supervision or owner approval succeeded. A trusted launcher
must independently enforce those conditions before attempting closure or dispatch.

File+directory fsync precede successful acknowledgements. On storage failures the
handle is poisoned and a blocking marker is attempted without deleting evidence.
A durable claim prevents replay after process restart only within this same root
and cycle under filesystem fsync/flock semantics. Whole-root replacement across
restart, new roots/cycles, storage loss, hostile same-user processes and filesystem
failure are outside that guarantee; a future launcher needs a trusted external
anchor. No credential/provider/network/CLI or activation-authority API is provided.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import publisher_role_transition as transition

MAX_BYTES = 4096
DIRECTIONS = ('activation','closure')
STAGES = {'mutation_started':'01-mutation', 'commit_started':'02-commit', 'finished':'03-finished'}


def _encode(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')


def _keys(value, expected):
    if type(value) is not dict or set(value) != set(expected): raise ValueError('journal fields')


def _pairs(pairs):
    result = {}
    for key,value in pairs:
        if key in result: raise ValueError('duplicate journal key')
        result[key]=value
    return result


def _bad_constant(unused): raise ValueError('nonfinite journal value')


def _info(fd, directory):
    info=os.fstat(fd)
    if (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != (0o700 if directory else 0o600)
            or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or (not directory and (info.st_nlink != 1 or not 0 < info.st_size <= MAX_BYTES))):
        raise ValueError('journal filesystem boundary')
    return (info.st_dev,info.st_ino)


def _open_directory(path):
    """Walk absolute components without following symlinks, including ancestors."""
    if not isinstance(path,Path) or not path.is_absolute() or '..' in path.parts:
        raise ValueError('journal root path')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_CLOEXEC)
    try:
        for component in path.parts[1:]:
            child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=fd)
            os.close(fd); fd=child
        return fd
    except BaseException:
        os.close(fd); raise


class LocalRoleJournal:
    def __init__(self,root):
        self.path=Path(root)
        self.root_fd=self.cycle_fd=None
        self.closed=False; self.poisoned=False; self.claimed=False; self.attempted=False
        self.binding=None; self.phase=None; self.cycle_name=None
        parent=_open_directory(self.path.parent)
        try: _info(parent,True)
        finally: os.close(parent)
        self.root_fd=_open_directory(self.path)
        try: self.root_identity=_info(self.root_fd,True)
        except BaseException:
            os.close(self.root_fd); self.root_fd=None; raise

    def __enter__(self): return self
    def __exit__(self,*unused): self.close()

    def _check_root(self):
        if self.closed or self.poisoned: raise ValueError('journal handle unavailable')
        current=_open_directory(self.path)
        try:
            if _info(current,True) != self.root_identity or _info(self.root_fd,True) != self.root_identity:
                raise ValueError('journal root replaced')
        finally: os.close(current)
        if self.cycle_fd is not None:
            current=os.open(self.cycle_name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=self.root_fd)
            try:
                if _info(current,True) != _info(self.cycle_fd,True): raise ValueError('journal cycle replaced')
            finally: os.close(current)

    def _names(self):
        names=[]
        with os.scandir(self.cycle_fd) as entries:
            for entry in entries:
                names.append(entry.name)
                if len(names)>9: raise ValueError('journal entry bound')
        allowed={'cycle.json'}|{d+'.claim.json' for d in DIRECTIONS}|{
            d+'.'+suffix+'.json' for d in DIRECTIONS for suffix in STAGES.values()}
        if set(names)-allowed: raise ValueError('unexpected journal evidence')
        return set(names)

    def _read(self,name):
        fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK,dir_fd=self.cycle_fd)
        try:
            _info(fd,False)
            data=os.read(fd,MAX_BYTES+1)
        finally: os.close(fd)
        if len(data)>MAX_BYTES: raise ValueError('journal size')
        value=json.loads(data.decode('ascii'),object_pairs_hook=_pairs,parse_constant=_bad_constant)
        if _encode(value) != data: raise ValueError('noncanonical journal bytes')
        return value

    def _write(self,name,value):
        data=_encode(value)
        if len(data)>MAX_BYTES: raise ValueError('journal write bound')
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=self.cycle_fd)
        try:
            info=os.fstat(fd)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode)!=0o600 or not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:
                raise ValueError('journal new file boundary')
            if os.write(fd,data)!=len(data): raise ValueError('short journal write')
            os.fsync(fd)
        finally: os.close(fd)
        os.fsync(self.cycle_fd)

    def _poison(self):
        self.poisoned=True
        # Even a zero-byte/partial marker blocks later readers. Never remove it.
        if self.cycle_fd is not None:
            try: self._write('blocked.json',{'schema':1,'state':'INDETERMINATE'})
            except BaseException: pass

    @staticmethod
    def _common(binding):
        return {key:value for key,value in binding.items() if key not in ('direction','operation_id')}

    def _slot(self,direction,names):
        claim_name=direction+'.claim.json'
        if claim_name not in names:
            if any(n.startswith(direction+'.') for n in names): raise ValueError('orphan stage')
            return None
        claim=self._read(claim_name)
        _keys(claim,('schema','binding'))
        if type(claim['schema']) is not int or claim['schema']!=1: raise ValueError('claim schema')
        binding=claim['binding']; transition.validate_binding(binding,binding)
        if binding['direction']!=direction or binding['cycle_id']!=self.cycle_name: raise ValueError('slot identity')
        if self._common(binding)!=self.common: raise ValueError('cycle binding mismatch')
        phase='claimed'; final=None
        digest=hashlib.sha256(_encode(binding)).hexdigest()
        for stage,suffix in STAGES.items():
            name=direction+'.'+suffix+'.json'
            if name not in names: continue
            record=self._read(name)
            _keys(record,('schema','binding_sha256','stage','status'))
            if (type(record['schema']) is not int or record['schema']!=1
                    or record['binding_sha256']!=digest or record['stage']!=stage):
                raise ValueError('stage identity')
            self._valid_step(phase,stage,record['status'])
            phase=stage
            if stage=='finished': final=record['status']
        return {'binding':binding,'phase':phase,'final':final}

    @staticmethod
    def _valid_step(phase,stage,status):
        if type(stage) is not str or type(status) is not str: raise ValueError('stage type')
        if stage=='mutation_started' and phase=='claimed' and status=='PENDING': return
        if stage=='commit_started' and phase=='mutation_started' and status=='PENDING': return
        if stage=='finished':
            if status=='CONFIRMED' and phase=='commit_started': return
            if status=='FAILED' and phase=='claimed': return
            if status=='INDETERMINATE' and phase in ('claimed','mutation_started','commit_started'): return
        raise ValueError('journal stage order')

    def _validate(self):
        names=self._names()
        anchor=self._read('cycle.json')
        _keys(anchor,('schema','common'))
        if type(anchor['schema']) is not int or anchor['schema']!=1 or anchor['common']!=self.common:
            raise ValueError('cycle anchor mismatch')
        activation=self._slot('activation',names)
        closure=self._slot('closure',names)
        if activation is None: raise ValueError('uninitialized activation evidence')
        if closure is not None and activation['final']!='CONFIRMED': raise ValueError('unreconciled closure evidence')
        return activation,closure

    def claim(self,binding):
        if self.attempted: raise ValueError('one claim per handle')
        self.attempted=True
        self._check_root()
        transition.validate_binding(binding,binding)
        self.binding=json.loads(_encode(binding)); self.common=self._common(self.binding)
        self.cycle_name=self.binding['cycle_id']
        locked=False
        try:
            # Serialize publication of a new cycle anchor and its first claim.
            # A contender must never poison another writer's partial initialization.
            fcntl.flock(self.root_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            locked=True
            return self._claim_locked()
        finally:
            if locked:
                try: fcntl.flock(self.root_fd,fcntl.LOCK_UN)
                except BaseException:
                    self._poison()
                    raise ValueError('journal initialization unlock indeterminate') from None

    def _claim_locked(self):
        binding=self.binding
        created=False
        try:
            if binding['direction']=='activation':
                try:
                    os.mkdir(self.cycle_name,0o700,dir_fd=self.root_fd); created=True
                except FileExistsError: pass
            self.cycle_fd=os.open(self.cycle_name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=self.root_fd)
            _info(self.cycle_fd,True)
            try: fcntl.flock(self.cycle_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(self.cycle_fd); self.cycle_fd=None
                raise ValueError('cycle writer busy') from None
        except BaseException:
            # No writer lock means never modify another process's evidence.
            if self.cycle_fd is not None: os.close(self.cycle_fd); self.cycle_fd=None
            raise
        try:
            self._check_root()
            if created:
                os.fsync(self.root_fd)
                self._write('cycle.json',{'schema':1,'common':self.common})
                self._write('activation.claim.json',{'schema':1,'binding':self.binding})
            else:
                activation,closure=self._validate()
                if binding['direction']=='activation' or closure is not None: return False
                if activation['final']!='CONFIRMED': raise ValueError('activation needs reconciliation')
                self._write('closure.claim.json',{'schema':1,'binding':self.binding})
            self.claimed=True; self.phase='claimed'
            return True
        except BaseException:
            self._poison()
            raise ValueError('journal claim indeterminate') from None

    def record(self,binding,stage,status):
        if not self.claimed: raise ValueError('not the winning writer')
        try:
            self._check_root()
            transition.validate_binding(self.binding,binding)
            activation,closure=self._validate()
            slot=activation if binding['direction']=='activation' else closure
            if slot is None or slot['binding']!=self.binding or slot['phase']!=self.phase:
                raise ValueError('writer evidence mismatch')
            self._valid_step(self.phase,stage,status)
            self._write(binding['direction']+'.'+STAGES[stage]+'.json',
                        {'schema':1,'binding_sha256':hashlib.sha256(_encode(binding)).hexdigest(),'stage':stage,'status':status})
            self.phase=stage
        except BaseException:
            self._poison()
            raise ValueError('journal record indeterminate') from None

    def close(self):
        if self.closed: return
        self.closed=True
        try:
            if self.cycle_fd is not None: os.close(self.cycle_fd)
        finally:
            self.cycle_fd=None
            if self.root_fd is not None: os.close(self.root_fd)
            self.root_fd=None
