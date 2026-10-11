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
    result.status=201;p.api('pulls','POST',p.draft_payload(),201,publisher_token=env['MERIDIAN_PUBLISHER_TOKEN'])
    request=opener.return_value.open.call_args.args[0]
    assert request.get_header('Authorization')=='Bearer '+env['MERIDIAN_PUBLISHER_TOKEN']
    assert json.loads(request.data)==p.draft_payload()
    for args in [('pulls/653','GET',None,200),('git/refs','POST',{},201),
                 ('pulls','POST',{**p.draft_payload(),'draft':False},201),
                 ('pulls','POST',{**p.draft_payload(),'head':'other'},201),
                 ('pulls','POST',{**p.draft_payload(),'body':'injected'},201),
                 ('pulls','POST',p.draft_payload(),200)]:
        opener.reset_mock();rejects(lambda:p.api(*args,publisher_token=env['MERIDIAN_PUBLISHER_TOKEN']));opener.assert_not_called()
    opener.reset_mock();rejects(lambda:p.api('pulls','POST',p.draft_payload(),201));opener.assert_not_called()
`);
});

test('unwired factory or unpinned bot stops publication before downloads and writes', () => {
  python(String.raw`
for factory,login in [(None,bot),(42,bot),(lambda:None,None),(lambda:None,'ordinary-user')]:
    with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',login), \
         mock.patch.object(p,'identity',return_value=evidence()),mock.patch.object(p,'validate_claim',return_value=(claim,tree)), \
         mock.patch.object(p,'api') as api,mock.patch.object(p,'artifact_bytes') as download:
        rejects(lambda:p.publish(factory));api.assert_not_called();download.assert_not_called()
assert p.PUBLISHER_BOT_LOGIN is None
assert p.SOURCE_SHA=='2b267ecc0f94565fe005156bf45e8f0ae139eb9b'
assert p.SOURCE_RUN==38070967939 and p.SOURCE_ATTEMPT==5 and p.DEADLINE==1791660600
assert p.BRANCH=='pilot/version-history-ledger-20261010-t3'
with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',bot), mock.patch('time.time',return_value=p.DEADLINE-60), mock.patch('urllib.request.build_opener') as opener:
    for token in [None,False,42,'',env['GH_TOKEN'],'github_pat_invalid','ghs_bad\n','ghs_'+'x'*4096]:
        rejects(lambda:p.api('pulls','POST',p.draft_payload(),201,publisher_token=token))
    opener.assert_not_called()
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

test('publisher enters memory credential only after branch work and revokes on success, POST failure, interrupt or invalid response', () => {
  python(String.raw`
data=evidence();packet={'evidence':data,'claim':claim,'files':p.assemble_files({p.PATHS[0]:p.ledger_contract(data)})}
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w') as archive:archive.writestr('packet.json',json.dumps(packet))
raw=buf.getvalue()
artifact={'id':300,'name':p.ARTIFACT,'expired':False,'size_in_bytes':len(raw),
    'workflow_run':{'id':200,'head_sha':base},'digest':'sha256:'+p.hashlib.sha256(raw).hexdigest()}
for outcome in ('success','post-error','interrupt','bad-response','bad-token','bad-artifact','bad-digest','bad-packet','bad-ledger','existing-pr','branch-error','mint-evidence-drift','mint-branch-drift'):
    calls=[];reads=[claim,commit,commit];lifecycle=[]
    @__import__('contextlib').contextmanager
    def factory():
        assert calls[-1][0]=='git/ref/heads/'+p.BRANCH
        assert any(c[1]=='PATCH' for c in calls)
        lifecycle.append('mint')
        try:yield 'invalid' if outcome=='bad-token' else 'ghs_memory_only_fixture'
        finally:lifecycle.append('revoke')
    def fake(path,method='GET',payload=None,expected=200,*,publisher_token=None):
        calls.append((path,method,publisher_token is not None))
        if path=='actions/artifacts/300':
            if outcome=='bad-artifact':return {**artifact,'expired':True}
            if outcome=='bad-digest':return {**artifact,'digest':'sha256:invalid'}
            return artifact
        if path.startswith('pulls?'):return [response()] if outcome=='existing-pr' else []
        if path=='git/trees':return {'sha':newtree}
        if path=='git/commits':return {'sha':commit}
        if path=='git/ref/heads/main':return {'object':{'sha':base}}
        if path=='git/ref/heads/'+p.BRANCH:
            value=reads.pop(0)
            return {'object':{'sha':base if outcome=='mint-branch-drift' and lifecycle else value}}
        if path=='git/refs/heads/'+p.BRANCH:
            if outcome=='branch-error':raise ValueError('branch outcome unknown')
            return {'object':{'sha':commit}}
        if path=='pulls':
            assert lifecycle==['mint'] and publisher_token=='ghs_memory_only_fixture'
            if outcome=='post-error':raise ValueError('POST failed')
            if outcome=='interrupt':raise KeyboardInterrupt()
            return {**response(),'draft':False} if outcome=='bad-response' else response()
        raise AssertionError(path)
    with mock.patch.dict(os.environ,{**env,'ARTIFACT_ID':'300'},clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',bot), \
         mock.patch.object(p,'identity',side_effect=lambda: {**data,'base':'9'*40} if outcome=='mint-evidence-drift' and lifecycle else data),mock.patch.object(p,'validate_claim',return_value=(claim,tree)), \
         mock.patch.object(p,'api',side_effect=fake),mock.patch.object(p,'artifact_bytes',return_value=raw),mock.patch('builtins.print') as output:
        actual_packet=copy.deepcopy(packet)
        if outcome=='bad-packet':actual_packet['claim']='x'*40
        if outcome=='bad-ledger':actual_packet['files'][p.PATHS[0]]='Invalid ledger text with no evidence'
        with mock.patch.object(p,'unpack',return_value=actual_packet):
            if outcome=='success':p.publish(factory);output.assert_called_once()
            elif outcome=='interrupt':
                try:p.publish(factory)
                except KeyboardInterrupt:pass
                else:raise AssertionError('interrupt swallowed')
                output.assert_not_called()
            else:rejects(lambda:p.publish(factory));output.assert_not_called()
    early=outcome in ('bad-artifact','bad-digest','bad-packet','bad-ledger','existing-pr','branch-error')
    assert lifecycle==([] if early else ['mint','revoke'])
    posts=[c for c in calls if c[2]]
    assert posts==([] if early or outcome in ('bad-token','mint-evidence-drift','mint-branch-drift') else [('pulls','POST',True)])
    if outcome in ('bad-artifact','bad-digest','bad-packet','bad-ledger','existing-pr'):
        assert all(c[1]=='GET' for c in calls)
    if outcome=='success':
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

test('real broker context drives publisher HTTP credential and reconciles exceptional lifecycle outcomes', () => {
  python(String.raw`
spec=importlib.util.spec_from_file_location('broker',pathlib.Path(p.__file__).with_name('copilot-publisher-broker.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
pins={'app_id':101,'app_slug':'reviewed-fixture-app','bot_login':bot,'installation_id':202,
      'account_id':b.ACCOUNT_ID,'account_login':'Achi1984','repository_id':b.REPOSITORY_ID,'repository_full_name':p.REPO}
owner={'id':b.ACCOUNT_ID,'login':'Achi1984','type':'User'}
brepo={**repo,'id':b.REPOSITORY_ID,'owner':owner}
perms={'metadata':'read','pull_requests':'write'}
install={'id':202,'app_id':101,'app_slug':pins['app_slug'],'repository_selection':'selected',
         'suspended_at':None,'target_id':b.ACCOUNT_ID,'target_type':'User','account':owner,'permissions':perms}
data=evidence();packet={'evidence':data,'claim':claim,'files':p.assemble_files({p.PATHS[0]:p.ledger_contract(data)})}
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w') as archive:archive.writestr('packet.json',json.dumps(packet))
raw=buf.getvalue()
artifact={'id':300,'name':p.ARTIFACT,'expired':False,'size_in_bytes':len(raw),
    'workflow_run':{'id':200,'head_sha':base},'digest':'sha256:'+p.hashlib.sha256(raw).hexdigest()}
original_api=p.api
minted_token='ghs_minted_memory_B'
assert env['MERIDIAN_PUBLISHER_TOKEN']!=minted_token
for outcome in ('success','post-error','wrong-response','revoke-error','unknown-mint','not-context'):
    events=[];refs=[claim,commit,commit]
    def http(method,url,credential,payload):
        path=url.removeprefix(b.API)
        events.append((method,path))
        if path=='/app':return 200,{'id':101,'slug':pins['app_slug'],'owner':owner,'permissions':perms}
        if path in ('/app/installations/202','/repos/'+p.REPO+'/installation'):return 200,install
        if path=='/app/installations/202/access_tokens':
            assert payload=={'repository_ids':[b.REPOSITORY_ID],'permissions':{'pull_requests':'write'}}
            if outcome=='unknown-mint':raise TimeoutError('uncertain fixture mint')
            expiry=b.datetime.datetime.fromtimestamp(p.DEADLINE-60+1800,b.datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
            return 201,{'token':minted_token,'expires_at':expiry,'repository_selection':'selected','permissions':perms,'repositories':[brepo]}
        if path=='/installation/repositories?per_page=100':
            assert credential==minted_token
            return 200,{'total_count':1,'repositories':[brepo]}
        if path=='/installation/token':
            assert method=='DELETE' and credential==minted_token and payload is None
            return (500 if outcome=='revoke-error' else 204),None
        raise AssertionError('unexpected broker path')
    def api(path,method='GET',payload=None,expected=200,*,publisher_token=None):
        events.append((method,path))
        if path=='pulls':return original_api(path,method,payload,expected,publisher_token=publisher_token)
        assert publisher_token is None
        if path=='actions/artifacts/300':return artifact
        if path.startswith('pulls?'):return []
        if path=='git/trees':return {'sha':newtree}
        if path=='git/commits':return {'sha':commit}
        if path=='git/ref/heads/main':return {'object':{'sha':base}}
        if path=='git/ref/heads/'+p.BRANCH:return {'object':{'sha':refs.pop(0)}}
        if path=='git/refs/heads/'+p.BRANCH:return {'object':{'sha':commit}}
        raise AssertionError('unexpected ordinary path')
    def factory():
        assert ('PATCH','git/refs/heads/'+p.BRANCH) in events
        if outcome=='not-context':return object()
        return b.publisher_token(http=http,sign=lambda message:b'x'*256,pins=pins,clock=lambda:p.DEADLINE-60)
    with mock.patch.dict(os.environ,{**env,'ARTIFACT_ID':'300'},clear=True),mock.patch.object(p,'PUBLISHER_BOT_LOGIN',bot), \
         mock.patch.object(p,'identity',return_value=data),mock.patch.object(p,'validate_claim',return_value=(claim,tree)), \
         mock.patch.object(p,'api',side_effect=api),mock.patch.object(p,'artifact_bytes',return_value=raw), \
         mock.patch('time.time',return_value=p.DEADLINE-60),mock.patch('urllib.request.build_opener') as opener, \
         mock.patch('builtins.print') as output:
        def open_request(request,**kwargs):
            assert request.full_url=='https://api.github.com/repos/'+p.REPO+'/pulls'
            assert request.method=='POST' and json.loads(request.data)==p.draft_payload()
            assert request.get_header('Authorization')=='Bearer '+minted_token
            assert env['MERIDIAN_PUBLISHER_TOKEN'] not in str(request.headers)
            if outcome=='post-error':raise TimeoutError('uncertain fixture POST')
            result=mock.MagicMock();result.__enter__.return_value=result;result.status=201
            result.read.return_value=json.dumps({**response(),'draft':False} if outcome=='wrong-response' else response()).encode()
            return result
        opener.return_value.open.side_effect=open_request
        if outcome=='success':p.publish(factory);output.assert_called_once()
        else:
            try:p.publish(factory)
            except (b.BrokerError,TypeError) as error:
                if outcome=='not-context':assert isinstance(error,TypeError)
                else:assert isinstance(error,b.BrokerError)
                if outcome=='revoke-error':assert 'reconciliation required' in str(error)
                if outcome=='unknown-mint':assert 'mint outcome unknown' in str(error)
                assert minted_token not in str(error) and env['MERIDIAN_PUBLISHER_TOKEN'] not in str(error)
            else:raise AssertionError('failure swallowed')
            output.assert_not_called()
        expected_posts=0 if outcome in ('unknown-mint','not-context') else 1
        assert opener.return_value.open.call_count==expected_posts
    assert events.count(('POST','pulls'))==expected_posts
    assert events.count(('POST','/app/installations/202/access_tokens'))==(0 if outcome=='not-context' else 1)
    assert events.count(('DELETE','/installation/token'))==(0 if outcome in ('unknown-mint','not-context') else 1)
    assert events.index(('PATCH','git/refs/heads/'+p.BRANCH))<len(events)
    if outcome not in ('unknown-mint','not-context'):
        assert events[-1]==('DELETE','/installation/token')
assert b.PINS is None and p.PUBLISHER_BOT_LOGIN is None
`);
});
