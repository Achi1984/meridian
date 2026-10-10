import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper = fileURLToPath(new URL('../scripts/copilot-coding-pilot.py', import.meta.url));
const workflow = readFileSync(new URL('../.github/workflows/copilot-coding-pilot.yml', import.meta.url), 'utf8');
function python(body) {
  const result = spawnSync('python3', ['-c', `import importlib.util\nspec=importlib.util.spec_from_file_location('pilot',${JSON.stringify(helper)})\np=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(p)\n${body}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
test('workflow separates generation from writes and uses only CI completion', () => {
  assert.match(workflow, /types: \[completed\]/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|schedule:|secrets\.|checkout@/);
  const generator = workflow.split('  generate:\n')[1].split('  publish:\n')[0];
  assert.match(generator, /contents: read/);
  assert.match(generator, /pull-requests: read/);
  assert.doesNotMatch(generator, /contents: write|pull-requests: write|actions: write/);
  assert.match(generator, /copilot-requests: write/);
  assert.match(generator, /upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.match(workflow, /needs: \[claim, generate\]/);
  assert.match(workflow, /ARTIFACT_ID: \$\{\{ needs.generate.outputs.artifact \}\}/);
});

const fixture = String.raw`
import copy, io, json, os, pathlib, stat, tempfile, time, unittest.mock as mock, urllib.error, zipfile
repo={'full_name':p.REPO,'fork':False,'owner':{'login':'Achi1984','type':'User'}}
base='a'*40
def fixture():
    source={'id':p.SOURCE_RUN,'workflow_id':p.RELEASE_ID,'head_sha':p.SOURCE_SHA,'run_attempt':2,
      'path':'.github/workflows/backend-safety.yml','event':'pull_request','status':'completed','conclusion':'success',
      'repository':repo,'head_repository':repo,'head_branch':'copilot/packet','pull_requests':[{'number':653}]}
    data={'actions/runs/'+str(p.SOURCE_RUN):source,'pulls/653':{'number':653,'state':'open','merged':False,
      'head':{'sha':p.SOURCE_SHA,'ref':'copilot/packet','repo':repo},'base':{'ref':'main','repo':repo}},
      'git/ref/heads/main':{'object':{'sha':base}}}
    for wid,path in [(p.RELEASE_ID,'.github/workflows/backend-safety.yml'),(347846572,'.github/workflows/runtime-smoke.yml')]:
        data['actions/workflows/'+str(wid)+'/runs?head_sha='+base+'&event=push&per_page=100']={'total_count':1,'workflow_runs':[
          dict(source,workflow_id=wid,path=path,head_sha=base,head_branch='main',event='push')]}
    for number in (646,651):
        data['pulls/'+str(number)]={'number':number,'merged':True,'merge_commit_sha':'c'*40,
          'merged_at':'2026-10-10T16:00:00Z','base':{'ref':'main','repo':repo}}
    event={'action':'completed','repository':repo,'workflow_run':copy.deepcopy(source)}
    return copy.deepcopy(data),copy.deepcopy(event)
def trial(change=lambda d,e:None, accept=False):
    data,event=fixture(); change(data,event)
    with tempfile.TemporaryDirectory() as tmp:
        eventpath=pathlib.Path(tmp)/'event.json'; eventpath.write_text(json.dumps(event))
        env={'GITHUB_REPOSITORY':p.REPO,'GITHUB_EVENT_NAME':'workflow_run','GITHUB_REF':'refs/heads/main',
          'GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'200','GITHUB_SHA':base,'GITHUB_EVENT_PATH':str(eventpath)}
        with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(p,'api',side_effect=lambda path:copy.deepcopy(data[path])),mock.patch('time.time',return_value=p.DEADLINE-60):
            try: result=p.identity()
            except (ValueError,KeyError,TypeError):
                if accept:raise
                return
            assert accept,'invalid identity accepted'
            return result
def rejects(fn):
    try:fn()
    except (ValueError,UnicodeError):pass
    else:raise AssertionError('unsafe value accepted')
`;
test('fresh source binding permits approved attempt2 but denies stale/fork/foreign CI', () => {
  python(fixture + String.raw`
result=trial(accept=True); assert result['source_attempt']==2
for field,value in [('workflow_id',9),('head_sha','b'*40),('run_attempt',3),('status','queued'),('conclusion','failure'),('event','push'),('pull_requests',[])]:
    trial(lambda d,e:d['actions/runs/'+str(p.SOURCE_RUN)].update({field:value}))
trial(lambda d,e:e.update(action='requested'))
trial(lambda d,e:e['repository'].update(fork=True))
trial(lambda d,e:d['actions/runs/'+str(p.SOURCE_RUN)]['head_repository'].update(fork=True))
trial(lambda d,e:d['pulls/653']['head'].update(sha='b'*40))
trial(lambda d,e:d['pulls/653']['base'].update(ref='other'))
trial(lambda d,e:d['pulls/653'].update(state='closed'))
trial(lambda d,e:d['git/ref/heads/main']['object'].update(sha='b'*40))
trial(lambda d,e:d['pulls/646'].update(merged=False))
trial(lambda d,e:e['workflow_run'].update(id=100))
trial(lambda d,e:d['actions/workflows/'+str(p.RELEASE_ID)+'/runs?head_sha='+base+'&event=push&per_page=100'].update(total_count=0,workflow_runs=[]))
trial(lambda d,e:d['actions/workflows/'+str(p.RELEASE_ID)+'/runs?head_sha='+base+'&event=push&per_page=100']['workflow_runs'][0].update(conclusion='failure'))
with mock.patch('time.time',return_value=p.DEADLINE):rejects(p.remaining)
`);
});
test('JSON and ZIP reject duplicate keys, traversal, symlinks, extra files and oversized content', () => {
  python(fixture + String.raw`
good={path:'Valid preview ledger content' for path in p.PATHS}
assert p.validate_files(good)==good
for data in [{},dict(good,**{'../escape':'bad'}),{p.PATHS[0]:'x'},dict(good,**{p.PATHS[0]:'x'*20001}),dict(good,**{p.PATHS[0]:'x\0'*20})]:
    rejects(lambda:p.validate_files(data))
rejects(lambda:p.strict_json(b'{' + b'"x":1,"x":2}'))
rejects(lambda:p.strict_json(b'{"x":NaN}'))
rejects(lambda:p.validate_files({**good,p.PATHS[0]:'\ud800'*20}))
def archive(name='packet.json',mode=stat.S_IFREG|0o600,extra=False):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as z:
        item=zipfile.ZipInfo(name);item.external_attr=mode<<16
        z.writestr(item,json.dumps({'ok':True}))
        if extra:z.writestr('extra','bad')
    return output.getvalue()
assert p.unpack(archive())=={'ok':True}
rejects(lambda:p.unpack(archive('../packet.json')))
rejects(lambda:p.unpack(archive(mode=stat.S_IFLNK|0o777)))
rejects(lambda:p.unpack(archive(extra=True)))
rejects(lambda:p.unpack(b'x'*131073))
`);
});
test('claim is durable and fails before mutation on existing, uncertain or expired state', () => {
  python(fixture + String.raw`
evidence=trial(accept=True)
with mock.patch.object(p,'identity',return_value=evidence):
    calls=[]
    with mock.patch.object(p,'api',side_effect=lambda *a,**kw:calls.append(a) or {'object':{'sha':'c'*40}}):
        rejects(p.claim)
        assert len(calls)==1 and calls[0][0].startswith('git/ref/')
    with mock.patch.object(p,'api',side_effect=urllib.error.HTTPError('url',500,'error',{},None)) as api:
        rejects(p.claim); assert api.call_count==1
with mock.patch('time.time',return_value=p.DEADLINE),mock.patch('urllib.request.build_opener') as opener:
    rejects(lambda:p.api('git/refs','POST',{},201));opener.assert_not_called()
`);
});
test('publisher refuses artifact from another run before any write', () => {
  python(fixture + String.raw`
evidence=trial(accept=True)
bad={'id':300,'name':p.ARTIFACT,'expired':False,'size_in_bytes':100,'workflow_run':{'id':999,'head_sha':base}}
with mock.patch.object(p,'identity',return_value=evidence),mock.patch.object(p,'validate_claim',return_value=('c'*40,'d'*40)), \
     mock.patch.dict(os.environ,{'ARTIFACT_ID':'300'}),mock.patch.object(p,'api',return_value=bad) as api, \
     mock.patch.object(p,'artifact_bytes') as download:
    rejects(p.publish);assert api.call_count==1;download.assert_not_called()
`);
});

test('publisher only stages the two approved files and creates a Draft on claimed branch', () => {
  python(fixture + String.raw`
evidence=trial(accept=True); claim='c'*40; tree='d'*40; newtree='e'*40; newcommit='f'*40
packet={'evidence':evidence,'claim':claim,'files':{path:'Valid preview ledger content' for path in p.PATHS}}
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w') as archive:archive.writestr('packet.json',json.dumps(packet))
raw=buf.getvalue()
artifact={'id':300,'name':p.ARTIFACT,'expired':False,'size_in_bytes':len(raw),
  'workflow_run':{'id':200,'head_sha':base},'digest':'sha256:'+p.hashlib.sha256(raw).hexdigest()}
writes=[]; branch_reads=0
def fake(path,method='GET',payload=None,expected=200):
    global branch_reads
    if method!='GET':writes.append((path,method,payload,expected))
    if path=='actions/artifacts/300':return artifact
    if path.startswith('pulls?'):return []
    if path=='git/trees':return {'sha':newtree}
    if path=='git/commits':return {'sha':newcommit}
    if path=='git/ref/heads/main':return {'object':{'sha':base}}
    if path=='git/ref/heads/'+p.BRANCH:
        branch_reads+=1
        return {'object':{'sha':claim if branch_reads==1 else newcommit}}
    if path=='git/refs/heads/'+p.BRANCH:return {'object':{'sha':newcommit}}
    if path=='pulls':return {'number':999,'draft':True}
    raise AssertionError(path)
with mock.patch.object(p,'identity',return_value=evidence),mock.patch.object(p,'validate_claim',return_value=(claim,tree)), \
     mock.patch.dict(os.environ,{'ARTIFACT_ID':'300'}),mock.patch.object(p,'api',side_effect=fake), \
     mock.patch.object(p,'artifact_bytes',return_value=raw):p.publish()
assert [x[0] for x in writes]==['git/trees','git/commits','git/refs/heads/'+p.BRANCH,'pulls']
assert [x['path'] for x in writes[0][2]['tree']]==list(p.PATHS)
assert all(x['mode']=='100644' for x in writes[0][2]['tree'])
assert writes[1][2]['parents']==[claim]
assert writes[2][2]=={'sha':newcommit,'force':False}
assert writes[3][2]['draft'] is True and writes[3][2]['base']=='main' and writes[3][2]['head']==p.BRANCH
`);
});

test('claim conflict stops without inference and generation kills its process group on timeout', () => {
  python(fixture + String.raw`
evidence=trial(accept=True)
def race(path,method='GET',payload=None,expected=200):
    if path.startswith('git/ref/'):raise urllib.error.HTTPError('url',404,'missing',{},None)
    if path.startswith('git/commits/') :return {'tree':{'sha':'d'*40}}
    if path=='git/commits':return {'sha':'c'*40}
    raise urllib.error.HTTPError('url',422,'already exists',{},None)
with mock.patch.object(p,'identity',return_value=evidence),mock.patch.object(p,'api',side_effect=race),mock.patch.object(p,'generate') as generate:
    try:p.claim()
    except urllib.error.HTTPError as error:assert error.code==422
    else:raise AssertionError('claim race accepted')
    generate.assert_not_called()
with tempfile.TemporaryDirectory() as tmp, mock.patch.object(p,'identity',return_value=evidence), \
     mock.patch.object(p,'validate_claim'),mock.patch.dict(os.environ,{'RUNNER_TEMP':tmp,'GH_TOKEN':'readonly-test','CLAIM_SHA':'c'*40}), \
     mock.patch('time.time',return_value=p.DEADLINE-2),mock.patch('subprocess.Popen') as spawn,mock.patch('os.killpg') as kill:
    proc=spawn.return_value;proc.pid=999
    proc.wait.side_effect=[p.subprocess.TimeoutExpired('copilot',2),0]
    rejects(p.generate)
    kill.assert_called_once_with(999,p.signal.SIGKILL)
    assert '--excluded-tools=view' in spawn.call_args.args[0]
with mock.patch('time.time',return_value=p.DEADLINE),mock.patch('subprocess.Popen') as spawn:
    rejects(p.generate);spawn.assert_not_called()
`);
});
