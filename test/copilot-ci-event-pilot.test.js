import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/copilot-ci-event-pilot.yml', import.meta.url), 'utf8');
const source = workflow.split("<<'PY'\n")[1].split('\n          PY')[0].replace(/^          /gm, '');

test('pilot has only the approved source trigger and bounded read-only authority', () => {
  assert.match(workflow, /workflows: \[MERIDIAN Release Safety\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[feat\/v11-version-history-20261010\]/);
  assert.doesNotMatch(workflow, /\bworkflow_dispatch:|\bschedule:|\buses:|\bsecrets\.|\bcheckout\s*@/);
  assert.deepEqual([...workflow.matchAll(/^      ([\w-]+): (read|write)$/gm)].map(m => m.slice(1)),
    [['contents','read'],['actions','read'],['pull-requests','read'],['copilot-requests','write']]);
  assert.match(workflow, /github.run_number <= 3 && github.run_attempt == 1/);
  assert.match(workflow, /timeout-minutes: 6/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /@github\/copilot@1\.0\.95/);
  assert.match(source, /--available-tools=view/);
  assert.match(source, /--excluded-tools=view/);
  assert.match(source, /--deny-tool=shell,write,read,url,memory/);
  assert.doesNotMatch(source, /--autopilot|--allow-all|--resume/);
  assert.equal((source.match(/subprocess.Popen\(/g) || []).length, 1);
});

function python(harness) {
  const result = spawnSync('python3', ['-c', `source=${JSON.stringify(source)}\n${harness}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

const fixture = String.raw`
import copy, json, os, pathlib, tempfile, unittest.mock as mock
ns = {'__name__':'review_test'}
exec(compile(source, '<workflow-gate>', 'exec'), ns)
repo = {'full_name':'Achi1984/meridian','fork':False,'owner':{'login':'Achi1984','type':'User'}}
sha, control = 'a'*40, 'b'*40
base_run = {'id':111,'workflow_id':347821227,'path':'.github/workflows/backend-safety.yml','run_attempt':1,
    'event':'pull_request','status':'completed','conclusion':'failure','repository':repo,'head_repository':repo,
    'head_branch':'feat/v11-version-history-20261010','head_sha':sha,'pull_requests':[{'number':646}]}
def fixture():
    data = {'':copy.deepcopy(repo), 'actions/runs/111':copy.deepcopy(base_run),
      'pulls/646':{'number':646,'state':'open','merged':False,
        'head':{'sha':sha,'ref':'feat/v11-version-history-20261010','repo':copy.deepcopy(repo)},
        'base':{'ref':'main','repo':copy.deepcopy(repo)}},
      'git/ref/heads/main':{'object':{'sha':control}},
      'actions/workflows/copilot-ci-event-pilot.yml/runs?per_page=100':{'total_count':1,'workflow_runs':[
        {'id':222,'display_title':'copilot-ci-pilot-111','run_attempt':1,'run_number':1,'event':'workflow_run','head_sha':control}]},
      'actions/runs/111/jobs?filter=latest&per_page=100':{'total_count':1,'jobs':[
        {'id':333,'status':'completed','conclusion':'failure','name':'INJECTED_JOB_COMMAND',
         'steps':[{'number':1,'status':'completed','conclusion':'failure','name':'INJECTED_STEP_COMMAND'}]}]}}
    for wid, path in [(347821227,'.github/workflows/backend-safety.yml'),(347846572,'.github/workflows/runtime-smoke.yml')]:
        data['actions/workflows/'+str(wid)+'/runs?head_sha='+control+'&event=push&per_page=100'] = {'total_count':1,'workflow_runs':[
          dict(copy.deepcopy(base_run),workflow_id=wid,path=path,head_sha=control,head_branch='main',event='push',conclusion='success')]}
    event = {'action':'completed','repository':copy.deepcopy(repo),'workflow_run':copy.deepcopy(base_run)}
    env = {'GITHUB_TOKEN':'test-only','GITHUB_REPOSITORY':'Achi1984/meridian','GITHUB_EVENT_NAME':'workflow_run',
      'GITHUB_REF':'refs/heads/main','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_NUMBER':'1','GITHUB_RUN_ID':'222','GITHUB_SHA':control}
    return data,event,env
history = 'actions/workflows/copilot-ci-event-pilot.yml/runs?per_page=100'
ci = 'actions/workflows/347821227/runs?head_sha='+control+'&event=push&per_page=100'
jobs = 'actions/runs/111/jobs?filter=latest&per_page=100'
def trial(change=lambda d,e,v:None, accept=False, remaining=60):
    data,event,env = fixture()
    change(data,event,env)
    with tempfile.TemporaryDirectory() as tmp:
        event_path=pathlib.Path(tmp)/'event.json'
        event_path.write_text(json.dumps(event))
        env['GITHUB_EVENT_PATH']=str(event_path)
        ns['get']=lambda path:copy.deepcopy(data[path])
        with mock.patch.dict(os.environ,env,clear=True),mock.patch('time.time',return_value=ns['DEADLINE']-remaining):
            try: result=ns['gate']()
            except (ValueError,KeyError,TypeError):
                if accept: raise
                return
            assert accept,'unsafe gate accepted'
            assert 'INJECTED_' not in json.dumps(result)
            assert result['implementation_authorized'] is False and result['merge_authorized'] is False
            return result
`;

test('fresh gate accepts each known conclusion and projects no untrusted names', () => {
  python(fixture + String.raw`
for conclusion in sorted(ns['CONCLUSIONS']):
    result=trial(lambda d,e,v:d['actions/runs/111'].update(conclusion=conclusion),True)
    assert result['ci_conclusion']==conclusion
trial(lambda d,e,v:(v.update(GITHUB_RUN_NUMBER='3'),d[history]['workflow_runs'][0].update(run_number=3)),True)
`);
});

test('fresh gate rejects time, cap, foreign origin, stale PR, failed post-CI and duplicate deliveries', () => {
  python(fixture + String.raw`
trial(remaining=0)
trial(remaining=-1)
for key,value in [('GITHUB_RUN_NUMBER','4'),('GITHUB_RUN_NUMBER','0'),('GITHUB_RUN_ATTEMPT','2'),
                  ('GITHUB_REPOSITORY','foreign/repo'),('GITHUB_EVENT_NAME','push'),('GITHUB_REF','refs/heads/other')]:
    trial(lambda d,e,v:v.update({key:value}))
trial(lambda d,e,v:e.update(action='requested'))
trial(lambda d,e,v:e['repository'].update(fork=True))
trial(lambda d,e,v:e['workflow_run'].update(run_attempt=2))
trial(lambda d,e,v:e['workflow_run'].update(workflow_id=99))
trial(lambda d,e,v:d['']['owner'].update(type='Organization'))
for field,value in [('workflow_id',99),('path','other.yml'),('run_attempt',2),('event','push'),('status','in_progress'),
                    ('conclusion','unknown'),('head_branch','other'),('head_sha','c'*40),('pull_requests',[])]:
    trial(lambda d,e,v:d['actions/runs/111'].update({field:value}))
trial(lambda d,e,v:d['actions/runs/111']['head_repository'].update(fork=True))
trial(lambda d,e,v:d['actions/runs/111']['head_repository'].pop('fork'))
trial(lambda d,e,v:d['pulls/646'].update(state='closed'))
trial(lambda d,e,v:d['pulls/646']['head'].update(sha='c'*40))
trial(lambda d,e,v:d['pulls/646']['base'].update(ref='other'))
trial(lambda d,e,v:d['git/ref/heads/main']['object'].update(sha='c'*40))
trial(lambda d,e,v:d[ci].update(total_count=0,workflow_runs=[]))
for field,value in [('status','in_progress'),('conclusion','failure'),('head_sha','c'*40),('event','pull_request'),('workflow_id',99)]:
    trial(lambda d,e,v:d[ci]['workflow_runs'][0].update({field:value}))
trial(lambda d,e,v:d[history].update(total_count=0,workflow_runs=[]))
trial(lambda d,e,v:d[history].update(total_count=101))
trial(lambda d,e,v:d[history]['workflow_runs'][0].update(run_attempt=2))
def duplicate(d,e,v):
    d[history]['workflow_runs'].append(dict(d[history]['workflow_runs'][0],id=223))
    d[history]['total_count']=2
trial(duplicate)
def unknown_history(d,e,v):
    d[history]['workflow_runs'].append({'id':223})
    d[history]['total_count']=2
trial(unknown_history)
def invalid_history_title(d,e,v):
    d[history]['workflow_runs'].append({'id':223,'display_title':''})
    d[history]['total_count']=2
trial(invalid_history_title)
trial(lambda d,e,v:d[jobs]['jobs'][0]['steps'][0].update(conclusion='unknown'))
trial(lambda d,e,v:d[jobs]['jobs'][0].update(status='in_progress'))
trial(lambda d,e,v:d[jobs]['jobs'][0].update(steps=d[jobs]['jobs'][0]['steps']*33))
`);
});

test('invocation rechecks gate, caps remaining runtime and kills process group on deadline', () => {
  python(fixture + String.raw`
result=trial(accept=True)
with tempfile.TemporaryDirectory() as tmp:
    ns['__file__']=str(pathlib.Path(tmp)/'gate.py')
    ns['gate']=mock.Mock(return_value=result)
    proc=mock.Mock(pid=999,returncode=0)
    with mock.patch('sys.argv',['gate.py','invoke']),mock.patch('time.time',return_value=ns['DEADLINE']-7), \
         mock.patch('subprocess.Popen',return_value=proc) as spawn:
        def completed(timeout):
            assert 0 < timeout <= 7
            (pathlib.Path(tmp)/'response.txt').write_text('Observation only')
        proc.wait.side_effect=completed
        ns['main']()
        ns['gate'].assert_called_once()
        assert spawn.call_args.kwargs['start_new_session'] is True
        assert '--available-tools=view' in spawn.call_args.args[0]
        assert '--excluded-tools=view' in spawn.call_args.args[0]
        assert '--deny-tool=shell,write,read,url,memory' in spawn.call_args.args[0]
    with mock.patch('sys.argv',['gate.py','invoke']),mock.patch('time.time',return_value=ns['DEADLINE']), \
         mock.patch('subprocess.Popen') as spawn:
        try:ns['main']()
        except ValueError:pass
        else:raise AssertionError('expired invocation accepted')
        spawn.assert_not_called()
    proc.wait.side_effect=[ns['subprocess'].TimeoutExpired('copilot',2),0]
    with mock.patch('sys.argv',['gate.py','invoke']),mock.patch('time.time',return_value=ns['DEADLINE']-2), \
         mock.patch('subprocess.Popen',return_value=proc),mock.patch('os.killpg') as kill:
        try:ns['main']()
        except ValueError:pass
        else:raise AssertionError('timeout accepted')
        kill.assert_called_once_with(999,ns['signal'].SIGKILL)
`);
});
