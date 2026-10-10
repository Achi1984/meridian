import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper = fileURLToPath(new URL('../scripts/copilot-coding-pilot.py', import.meta.url));
function python(body) {
  const result = spawnSync('python3', ['-c', `import importlib.util\nspec=importlib.util.spec_from_file_location('pilot',${JSON.stringify(helper)})\np=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(p)\n${fixture}\n${body}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
const fixture = String.raw`
import copy, io, json, os, pathlib, tempfile, zipfile, unittest.mock as mock
repo={'full_name':p.REPO,'fork':False,'owner':{'login':'Achi1984','type':'User'}}
base='a'*40; claim='c'*40; tree='d'*40; newtree='e'*40; commit='f'*40
env={'GH_TOKEN':'ghs_job_token','MERIDIAN_PUBLISHER_TOKEN':'ghs_separate_installation_fixture'}
bot='reviewed-fixture-app[bot]'
def rejects(fn):
    try: fn()
    except (ValueError,KeyError,TypeError,AttributeError): pass
    else: raise AssertionError('invalid state accepted')
def response():
    return {'number':700,'state':'open','draft':True,'user':{'login':bot,'type':'Bot'},
        'head':{'sha':commit,'ref':p.BRANCH,'repo':copy.deepcopy(repo)},
        'base':{'sha':base,'ref':'main','repo':copy.deepcopy(repo)}}
def evidence():
    return {'repository':p.REPO,'control_run':200,'base':base,'milestones':[
        {'pr':n,'merged_at':'2026-10-10T16:00:00Z','merge_sha':'b'*40,
         'pr_url':'https://github.com/'+p.REPO+'/pull/'+str(n),
         'commit_url':'https://github.com/'+p.REPO+'/commit/'+'b'*40} for n in (646,651)]}
`;

test('only exact fixed Draft POST uses publisher credential; read and Git writes retain job token', () => {
  python(String.raw`
with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',bot), \
     mock.patch('time.time',return_value=p.DEADLINE-60),mock.patch('urllib.request.build_opener') as opener:
    result=opener.return_value.open.return_value.__enter__.return_value
    result.read.return_value=b'{}'
    for path,method,payload,status in [('pulls/653','GET',None,200),('actions/artifacts/300','GET',None,200),
        ('git/commits','POST',{'message':'claim'},201),('git/refs','POST',{'ref':'refs/heads/'+p.BRANCH},201),
        ('git/trees','POST',{'tree':[]},201),('git/refs/heads/'+p.BRANCH,'PATCH',{'sha':commit,'force':False},200)]:
        result.status=status;p.api(path,method,payload,status)
        assert opener.return_value.open.call_args.args[0].get_header('Authorization')=='Bearer '+env['GH_TOKEN']
    result.status=201;p.api('pulls','POST',p.draft_payload(),201,publisher=True)
    request=opener.return_value.open.call_args.args[0]
    assert request.get_header('Authorization')=='Bearer '+env['MERIDIAN_PUBLISHER_TOKEN']
    assert json.loads(request.data)==p.draft_payload()
    for args in [('pulls/653','GET',None,200),('git/refs','POST',{},201),
                 ('pulls','POST',{**p.draft_payload(),'draft':False},201),
                 ('pulls','POST',{**p.draft_payload(),'head':'other'},201),
                 ('pulls','POST',{**p.draft_payload(),'body':'injected'},201),
                 ('pulls','POST',p.draft_payload(),200)]:
        opener.reset_mock();rejects(lambda:p.api(*args,publisher=True));opener.assert_not_called()
    opener.reset_mock();rejects(lambda:p.api('pulls','POST',p.draft_payload(),201));opener.assert_not_called()
`);
});

test('missing separate credential or unpinned bot stops publication before downloads and writes', () => {
  python(String.raw`
for values,login in [({'GH_TOKEN':'ghs_job_token'},bot),(env,None),
    ({**env,'MERIDIAN_PUBLISHER_TOKEN':env['GH_TOKEN']},bot),
    ({**env,'MERIDIAN_PUBLISHER_TOKEN':'github_pat_not_supported'},bot),
    ({**env,'MERIDIAN_PUBLISHER_TOKEN':'ghs_invalid\n'},bot),(env,'ordinary-user')]:
    with mock.patch.dict(os.environ,values,clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',login), \
         mock.patch.object(p,'identity',return_value=evidence()),mock.patch.object(p,'validate_claim',return_value=(claim,tree)), \
         mock.patch.object(p,'api') as api,mock.patch.object(p,'artifact_bytes') as download:
        rejects(p.publish);api.assert_not_called();download.assert_not_called()
assert p.PUBLISHER_BOT_LOGIN is None
assert p.SOURCE_SHA=='2b267ecc0f94565fe005156bf45e8f0ae139eb9b'
assert p.SOURCE_RUN==38070967939 and p.SOURCE_ATTEMPT==5 and p.DEADLINE==1791660600
assert p.BRANCH=='pilot/version-history-ledger-20261010-t3'
`);
});

test('actual generator subprocess inherits only its job token, never publisher credentials', () => {
  python(String.raw`
data=evidence()
with tempfile.TemporaryDirectory() as tmp,mock.patch.dict(os.environ,{**env,'RUNNER_TEMP':tmp,'PATH':os.environ['PATH'],'CLAIM_SHA':claim},clear=True), \
     mock.patch.object(p,'identity',return_value=data),mock.patch.object(p,'validate_claim'), \
     mock.patch.object(p,'verify_cli_integrity',return_value=pathlib.Path('/tmp/mock-cli')),mock.patch.object(p,'verify_cli_tools'), \
     mock.patch('time.time',return_value=p.DEADLINE-60):
    def fake(command,**kwargs):
        actual=kwargs['env']
        assert actual['GITHUB_TOKEN']==env['GH_TOKEN']
        assert 'MERIDIAN_PUBLISHER_TOKEN' not in actual and env['MERIDIAN_PUBLISHER_TOKEN'] not in actual.values()
        assert set(actual)=={'PATH','COPILOT_HOME','COPILOT_AUTO_UPDATE','DO_NOT_TRACK','GITHUB_TOKEN'}
        kwargs['stdout'].write(json.dumps({p.PATHS[0]:p.ledger_contract(data)}).encode());kwargs['stdout'].flush()
        process=mock.Mock();process.returncode=0;process.wait.return_value=0;return process
    with mock.patch('subprocess.Popen',side_effect=fake) as process:
        p.generate();process.assert_called_once()
    assert (pathlib.Path(tmp)/'coding-pilot/packet.json').exists()
`);
});

test('published Draft response binds actual number, bot, head, base and same repository', () => {
  python(String.raw`
with mock.patch.object(p,'PUBLISHER_BOT_LOGIN',bot):
    assert p.validate_published_draft(response(),commit,base)==700
    changes=[lambda d:d.update(number=True),lambda d:d.update(number=0),lambda d:d.update(number='700'),
      lambda d:d.update(draft=False),lambda d:d.update(state='closed'),
      lambda d:d['user'].update(login='other[bot]'),lambda d:d['user'].update(type='User'),
      lambda d:d['head'].update(sha=base),lambda d:d['head'].update(ref='other'),
      lambda d:d['base'].update(sha=commit),lambda d:d['base'].update(ref='other'),
      lambda d:d['head']['repo'].update(fork=True),lambda d:d['base']['repo'].update(full_name='other/repo')]
    for change in changes:
        item=response();change(item);rejects(lambda:p.validate_published_draft(item,commit,base))
`);
});

test('full publisher revalidates packet, keeps Git writes on ordinary API and validates PR response', () => {
  python(String.raw`
data=evidence();packet={'evidence':data,'claim':claim,'files':p.assemble_files({p.PATHS[0]:p.ledger_contract(data)})}
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w') as archive:archive.writestr('packet.json',json.dumps(packet))
raw=buf.getvalue()
artifact={'id':300,'name':p.ARTIFACT,'expired':False,'size_in_bytes':len(raw),
    'workflow_run':{'id':200,'head_sha':base},'digest':'sha256:'+p.hashlib.sha256(raw).hexdigest()}
for valid in (True,False):
    calls=[];reads=[claim,commit]
    def fake(path,method='GET',payload=None,expected=200,*,publisher=False):
        calls.append((path,method,publisher))
        if path=='actions/artifacts/300':return artifact
        if path.startswith('pulls?'):return []
        if path=='git/trees':return {'sha':newtree}
        if path=='git/commits':return {'sha':commit}
        if path=='git/ref/heads/main':return {'object':{'sha':base}}
        if path=='git/ref/heads/'+p.BRANCH:return {'object':{'sha':reads.pop(0)}}
        if path=='git/refs/heads/'+p.BRANCH:return {'object':{'sha':commit}}
        if path=='pulls':return response() if valid else {**response(),'draft':False}
        raise AssertionError(path)
    with mock.patch.dict(os.environ,{**env,'ARTIFACT_ID':'300'},clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',bot), \
         mock.patch.object(p,'identity',return_value=data),mock.patch.object(p,'validate_claim',return_value=(claim,tree)), \
         mock.patch.object(p,'api',side_effect=fake),mock.patch.object(p,'artifact_bytes',return_value=raw),mock.patch('builtins.print') as output:
        if valid:p.publish();output.assert_called_once()
        else:rejects(p.publish);output.assert_not_called()
    assert [c for c in calls if c[2]]==[('pulls','POST',True)]
    assert [c for c in calls if c[1]!='GET']==[('git/trees','POST',False),('git/commits','POST',False),('git/refs/heads/'+p.BRANCH,'PATCH',False),('pulls','POST',True)]
`);
});

test('artifact transport retains job credential and does not transmit publisher token', () => {
  python(String.raw`
with mock.patch.dict(os.environ,env,clear=True),mock.patch('time.time',return_value=p.DEADLINE-60), \
     mock.patch('urllib.request.build_opener') as opener:
    opener.return_value.open.side_effect=p.urllib.error.HTTPError('url',500,'stop',{},None)
    try:p.artifact_bytes('300')
    except ValueError:pass
    request=opener.return_value.open.call_args.args[0]
    assert request.get_header('Authorization')=='Bearer '+env['GH_TOKEN']
`);
});
