"""Explicit local fixed-catalog check; never authenticates remote provenance."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import subprocess
import time
from datetime import datetime, timezone

CHECK_ID = 'event-adapter-leaf'
COMMAND = ('node','--test','docs/autonomy/event-adapter/test/event-continuation-adapter.test.mjs')
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def digest(raw): return hashlib.sha256(raw).hexdigest()
COMMAND_SHA256 = digest(canonical(list(COMMAND)).encode())
REQUIRED_POLICY = {'requiredChecks':[{'id':CHECK_ID,'commandSha256':COMMAND_SHA256}]}
MAX_OUTPUT = 262144
FLAGS = {'authenticated':False,'provenanceVerified':False,'authorized':False,'dispatchAllowed':False,'mergeAllowed':False,'durable':False}
def need(ok, code):
    if not ok: raise ValueError(code)
def utc(): return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00','Z')

def _run(argv, root, timeout, env):
    process=subprocess.Popen(argv,cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,close_fds=True)
    selector=selectors.DefaultSelector(); buffers=[bytearray(),bytearray()];deadline=time.monotonic()+timeout
    try:
        for index,stream in enumerate((process.stdout,process.stderr)):
            os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,index)
        while selector.get_map():
            remaining=deadline-time.monotonic();need(remaining>0,'PROCESS_TIMEOUT')
            for key,_ in selector.select(min(.1,remaining)):
                chunk=os.read(key.fileobj.fileno(),8192)
                if not chunk:selector.unregister(key.fileobj);key.fileobj.close();continue
                buffer=buffers[key.data];need(len(buffer)+len(chunk)<=MAX_OUTPUT,'PROCESS_OUTPUT_BOUND');buffer.extend(chunk)
        remaining=deadline-time.monotonic();need(remaining>0,'PROCESS_TIMEOUT')
        try:code=process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:raise ValueError('PROCESS_TIMEOUT') from None
        return code,bytes(buffers[0]),bytes(buffers[1])
    finally:
        selector.close()
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        process.wait(timeout=2)
        for stream in (process.stdout,process.stderr):
            if not stream.closed:stream.close()

def _scope(scope):
    need(type(scope) is dict and set(scope)=={'repository','requestId','opId','headSha','baseSha','prNumber','ci'},'SCOPE_SCHEMA')
    need(scope['repository']=='Achi1984/meridian','REPOSITORY_PIN')
    for key in ('requestId','opId'):need(type(scope[key]) is str and re.fullmatch(r'[A-Za-z0-9._:-]{1,120}',scope[key]),'REQUEST_PIN')
    for key in ('headSha','baseSha'):need(type(scope[key]) is str and re.fullmatch('[a-f0-9]{40}',scope[key]),'SHA_PIN')
    need(type(scope['prNumber']) is int and 0<scope['prNumber']<=9007199254740991,'PR_PIN')
    need(scope['headSha']!=scope['baseSha'],'HEAD_BASE_IDENTICAL')
    ci=scope['ci'];need(type(ci) is dict and set(ci)=={'runId','runAttempt','workflowId','headSha'},'CI_SCHEMA')
    need(ci['headSha']==scope['headSha'],'CI_HEAD_PIN')
    for key in ('runId','runAttempt','workflowId'):need(type(ci[key]) is int and 0<ci[key]<=9007199254740991,'CI_PIN')

def execute_check(repo_root, expected_scope, timeout_seconds=30):
    """Caller supplies trusted checkout and pins, never an event-selected command."""
    _scope(expected_scope)
    scope=json.loads(canonical(expected_scope))
    need(type(timeout_seconds) in (int,float) and 0<timeout_seconds<=60,'TIMEOUT_BOUND')
    root=Path(repo_root).resolve();need(root.is_dir(),'ROOT_INVALID')
    node=shutil.which('node');git=shutil.which('git');need(node and git,'EXECUTABLE_UNAVAILABLE')
    node=str(Path(node).resolve());git=str(Path(git).resolve())
    env={'PATH':os.pathsep.join(sorted({str(Path(node).parent),str(Path(git).parent)})), 'LANG':'C.UTF-8',
         'GIT_NO_LAZY_FETCH':'1','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':os.devnull,'GIT_NO_REPLACE_OBJECTS':'1','GIT_OPTIONAL_LOCKS':'0','GIT_TERMINAL_PROMPT':'0'}
    def git_read(*args):
        code,out,_=_run([git,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',*args],root,5,env)
        need(code==0,'GIT_READ_FAILED');return out
    def verify():
        # Reading config does not run filters; reject before any status/diff path.
        config_names=git_read('config','--includes','--name-only','--list').decode('utf-8',errors='strict').splitlines()
        need(not any(name.lower().startswith('filter.') for name in config_names),'GIT_FILTER_UNSUPPORTED')
        need(not any(name.lower() == 'extensions.partialclone' or (name.lower().startswith('remote.') and name.lower().endswith(('.promisor','.partialclonefilter'))) for name in config_names),'GIT_PARTIAL_CLONE_UNSUPPORTED')
        need(Path(os.fsdecode(git_read('rev-parse','--show-toplevel').strip())).resolve()==root,'ROOT_NOT_CHECKOUT')
        need(git_read('rev-parse','--verify','HEAD').decode().strip()==scope['headSha'],'HEAD_MOVED')
        need(git_read('cat-file','-t',scope['baseSha']).strip()==b'commit','BASE_NOT_COMMIT')
        need(not any(row.startswith(b'160000 ') for row in git_read('ls-files','--stage').splitlines()),'SUBMODULE_UNSUPPORTED')
        need(not git_read('status','--porcelain=v1','--untracked-files=all','--ignored'),'CHECKOUT_NOT_CLEAN')
        need(all(row[:1] == b'H' for row in git_read('ls-files','-v').splitlines()),'INDEX_FLAGS_UNSUPPORTED')
        git_read('merge-base','--is-ancestor',scope['baseSha'],scope['headSha'])
    verify()
    script=root/COMMAND[2];need(script.is_file() and script.resolve().is_relative_to(root),'SCRIPT_UNAVAILABLE')
    started=utc()
    code,out,err=_run([node,*COMMAND[1:]],root,timeout_seconds,env)
    finished=utc();verify()
    need(0<=code<=255,'PROCESS_SIGNAL_EXIT')
    record={'kind':'LOCAL_CHECK_EXECUTION','scope':scope,'commandSha256':COMMAND_SHA256,
            'exitCode':code,'stdoutSha256':digest(out),'stderrSha256':digest(err),
            'startedAt':started,'finishedAt':finished,**FLAGS}
    evidence=digest(canonical(record).encode())
    check={'id':CHECK_ID,'commandSha256':COMMAND_SHA256,'executed':True,
           'status':'passed' if code==0 else 'failed','exitCode':code,'evidenceSha256':evidence,
           **{key:scope[key] for key in ('headSha','baseSha','requestId','ci')}}
    return {**record,'evidenceSha256':evidence,'check':check}
