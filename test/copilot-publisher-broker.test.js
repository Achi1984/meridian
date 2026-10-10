import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper = fileURLToPath(new URL('../scripts/copilot-publisher-broker.py', import.meta.url));
function python(body) {
  const result = spawnSync('python3', ['-c', `import importlib.util\nspec=importlib.util.spec_from_file_location('broker',${JSON.stringify(helper)})\np=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(p)\n${fixture}\n${body}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
const fixture = String.raw`
import copy, datetime, json, os, pathlib, stat, subprocess, tempfile, traceback, unittest.mock as mock, urllib.error
pins={'app_id':123,'app_slug':'reviewed-fixture','bot_login':'reviewed-fixture[bot]',
      'installation_id':456,'account_id':319562141,'account_login':'Achi1984',
      'repository_id':1342084551,'repository_full_name':'Achi1984/meridian'}
owner={'id':pins['account_id'],'login':'Achi1984','type':'User'}
repo={'id':pins['repository_id'],'full_name':'Achi1984/meridian','fork':False,'owner':owner}
now=1791660000
token='ghs_123_fixture.JWT-token'
grants={'pull_requests':'write','metadata':'read'}
def stamp(value):return datetime.datetime.fromtimestamp(value,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def fresh():
    installation={'id':456,'app_id':123,'app_slug':pins['app_slug'],'repository_selection':'selected',
                  'account':owner,'target_id':pins['account_id'],'target_type':'User','suspended_at':None,'permissions':grants}
    return {'/app':{'id':123,'slug':pins['app_slug'],'owner':owner,'permissions':grants},
      '/app/installations/456':copy.deepcopy(installation),
      '/repos/Achi1984/meridian/installation':copy.deepcopy(installation),
      '/app/installations/456/access_tokens':{'token':token,'expires_at':stamp(now+3600),
          'permissions':grants,'repository_selection':'selected','repositories':[repo]},
      '/installation/repositories?per_page=100':{'total_count':1,'repositories':[repo]}}
def transport(data,calls):
    def http(method,url,credential,payload):
        path=url.removeprefix(p.API);calls.append((method,path,credential,payload))
        if method=='DELETE':return 204,None
        return (201 if method=='POST' else 200),copy.deepcopy(data[path])
    return http
def signer(message):return b'x'*256
def denied(fn,contains=None):
    try:fn()
    except p.BrokerError as error:
        text=''.join(traceback.format_exception(error))
        assert token not in text
        if contains:assert contains in str(error),str(error)
        return str(error)
    else:raise AssertionError('invalid operation accepted')
def consume(http,data_pins=pins,consumer=lambda t:None,clock=lambda:now):
    with p.publisher_token(http=http,sign=signer,pins=data_pins,clock=clock) as value:consumer(value)
`;

test('unconfigured broker is inert and rejects missing or foreign pins before signing/network', () => {
  python(String.raw`
assert p.PINS is None
for value in [None,{},dict(pins,app_id=True),dict(pins,repository_id=1),dict(pins,account_id=1),
              dict(pins,bot_login='foreign[bot]'),dict(pins,app_slug='github-actions',bot_login='github-actions[bot]')]:
    with mock.patch('urllib.request.build_opener') as opener:
        denied(lambda:consume(mock.Mock(side_effect=AssertionError('network')),value));opener.assert_not_called()
`);
});

test('identity-pinned broker narrows mint and always revokes after trusted consumption', () => {
  python(String.raw`
data=fresh();calls=[];seen=[]
consume(transport(data,calls),consumer=seen.append)
assert seen==[token]
assert [(c[0],c[1]) for c in calls]==[('GET','/app'),('GET','/app/installations/456'),
    ('GET','/repos/Achi1984/meridian/installation'),('POST','/app/installations/456/access_tokens'),
    ('GET','/installation/repositories?per_page=100'),('DELETE','/installation/token')]
assert calls[3][3]=={'repository_ids':[1342084551],'permissions':{'pull_requests':'write'}}
assert all(c[2]!=token for c in calls[:4]) and calls[4][2]==calls[5][2]==token
payload=json.loads(p.base64.urlsafe_b64decode(calls[0][2].split('.')[1]+'=='))
assert payload=={'iat':now-60,'exp':now+300,'iss':'123'}
assert 'MERIDIAN_PUBLISHER_TOKEN' not in os.environ
`);
});

test('foreign App, installation, repository and excess grants fail before mint', () => {
  python(String.raw`
for path,field,value in [('/app','id',1),('/app','slug','other'),('/app','permissions',{'pull_requests':'write','contents':'write'}),
    ('/app/installations/456','id',1),('/app/installations/456','app_id',1),('/app/installations/456','app_slug','other'),
    ('/app/installations/456','suspended_at','2026-01-01T00:00:00Z'),('/app/installations/456','repository_selection','all'),
    ('/app/installations/456','account',dict(owner,id=1)),('/repos/Achi1984/meridian/installation','id',999)]:
    data=fresh();data[path][field]=value;calls=[]
    denied(lambda:consume(transport(data,calls)))
    assert all(c[0]=='GET' for c in calls)
`);
});

test('malformed decoded mint responses revoke known token and never yield', () => {
  python(String.raw`
for field,value in [('permissions',{'pull_requests':'write','contents':'read'}),('permissions',{'pull_requests':'read'}),
    ('permissions',{'pull_requests':'write','metadata':'write'}),('repository_selection','all'),('repositories',[]),
    ('repositories',[repo,repo]),('repositories',[dict(repo,id=1)]),('expires_at',stamp(now+3601)),
    ('expires_at',stamp(now+20)),('expires_at','broken')]:
    data=fresh();data['/app/installations/456/access_tokens'][field]=value;calls=[];seen=[]
    denied(lambda:consume(transport(data,calls),consumer=seen.append))
    assert not seen and calls[-1][:2]==('DELETE','/installation/token')
# Metadata is implicit and can be absent.
data=fresh();data['/app/installations/456/access_tokens']['permissions']={'pull_requests':'write'}
consume(transport(data,[]))
data=fresh();calls=[];raw=transport(data,calls)
def wrong_status(method,*args):
    status,body=raw(method,*args);return (500 if method=='POST' else status),body
denied(lambda:consume(wrong_status));assert calls[-1][0]=='DELETE'
`);
});

test('token repository listing independently denies excess scope and revokes', () => {
  python(String.raw`
data=fresh();data['/installation/repositories?per_page=100']={'total_count':2,'repositories':[repo,repo]};calls=[]
denied(lambda:consume(transport(data,calls)));assert calls[-1][0]=='DELETE'
`);
});

test('unknown mint never retries; consumer and revocation failures are redacted with both stages retained', () => {
  python(String.raw`
data=fresh();calls=[];raw=transport(data,calls)
def unknown(method,*args):
    if method=='POST':calls.append(('POST',));raise RuntimeError(token)
    return raw(method,*args)
denied(lambda:consume(unknown),'mint outcome unknown');assert len([c for c in calls if c[0]=='POST'])==1
assert not any(c[0]=='DELETE' for c in calls)
for error in [RuntimeError(token),KeyboardInterrupt(token),SystemExit(token)]:
    calls=[];raw=transport(data,calls)
    def revoke_fails(method,*args):
        if method=='DELETE':calls.append(('DELETE',));raise RuntimeError(token)
        return raw(method,*args)
    def failing_consumer(_):raise error
    message=denied(lambda:consume(revoke_fails,consumer=failing_consumer),'trusted publisher')
    assert 'revocation failed' in message and calls[-1][0]=='DELETE'
`);
});

test('legitimate mint expiry allows time spent verifying App before mint', () => {
  python(String.raw`
data=fresh();data['/app/installations/456/access_tokens']['expires_at']=stamp(now+3615)
times=iter([now,now+15,now+16]);consume(transport(data,[]),clock=lambda:next(times))
`);
});

test('HTTPS adapter rejects redirects/foreign origins, bounds bodies and redacts unknown errors without retry', () => {
  python(String.raw`
for url in ['http://api.github.com/app','https://api.github.com.evil.test/app','https://user@api.github.com/app']:
    with mock.patch('urllib.request.build_opener') as opener:
        denied(lambda:p.github_http('GET',url,token,None));opener.assert_not_called()
for status,body in [(302,b'{}'),(200,b'x'*262145),(200,b'{"token":"a","token":"b"}'),(200,b'not-json')]:
    with mock.patch('urllib.request.build_opener') as opener:
        result=opener.return_value.open.return_value
        result.status=status;result.read.return_value=body
        denied(lambda:p.github_http('POST',p.API+'/app/installations/456/access_tokens',token,{}))
        assert opener.return_value.open.call_count==1
assert p.NoRedirect().redirect_request(None,None,302,'',{},'https://evil.test') is None
for status,body,expected in [(200,b'{"ok":true}',{'ok':True}),
                            (201,json.dumps({'token':token}).encode(),{'token':token}),(204,b'',None)]:
    with mock.patch('urllib.request.build_opener') as opener:
        result=opener.return_value.open.return_value
        result.status=status;result.read.return_value=body
        assert p.github_http('POST',p.API+'/app/installations/456/access_tokens',token,{})==(status,expected)
        result.read.assert_called_once_with(262145)
import io
with mock.patch('urllib.request.build_opener') as opener:
    opener.return_value.open.side_effect=urllib.error.HTTPError(p.API,500,'redacted',{},io.BytesIO(json.dumps({'token':token}).encode()))
    assert p.github_http('POST',p.API+'/app/installations/456/access_tokens',token,{})==(500,{'token':token})
    assert opener.return_value.open.call_count==1
data=fresh();methods=[]
def open_response(request,timeout):
    methods.append(request.method)
    if request.method=='POST':
        raise urllib.error.HTTPError(request.full_url,500,'redacted',{},io.BytesIO(json.dumps({'token':token}).encode()))
    result=mock.MagicMock()
    result.status=204 if request.method=='DELETE' else 200
    result.read.return_value=b'' if request.method=='DELETE' else json.dumps(data[request.full_url.removeprefix(p.API)]).encode()
    return result
with mock.patch('urllib.request.build_opener') as opener:
    opener.return_value.open.side_effect=open_response
    denied(lambda:consume(p.github_http),'mint response validation')
    assert methods==['GET','GET','GET','POST','DELETE']
with mock.patch('urllib.request.build_opener') as opener:
    opener.return_value.open.side_effect=RuntimeError(token)
    denied(lambda:p.github_http('GET',p.API+'/app',token,None));assert opener.return_value.open.call_count==1
`);
});

test('RSA signer uses protected temporary key, sanitized environment and no shell; cleans up on error', () => {
  python(String.raw`
key=b'fixture-key-bytes-not-a-real-key';paths=[]
def run(args,**kwargs):
    path=pathlib.Path(args[-1]);paths.append(path)
    assert path.read_bytes()==key and stat.S_IMODE(path.stat().st_mode)==0o600
    assert args[:4]==['/usr/bin/openssl','dgst','-sha256','-sign']
    assert key.decode() not in str(args) and kwargs['shell'] is False and kwargs['timeout']==15
    assert kwargs['env']=={'PATH':'/usr/bin:/bin','LANG':'C'}
    return mock.Mock(returncode=0,stdout=b'x'*256)
with mock.patch('subprocess.run',side_effect=run):assert p.rsa_signer(key)(b'input')==b'x'*256
assert all(not path.exists() for path in paths)
with mock.patch('subprocess.run',side_effect=RuntimeError(token)):
    denied(lambda:p.rsa_signer(key)(b'input'),'signing failed')
`);
});

test('real local ephemeral RSA signature verifies without network or committed key material', () => {
  python(String.raw`
with tempfile.TemporaryDirectory() as folder:
    root=pathlib.Path(folder);key=root/'ephemeral.pem';public=root/'public.pem';message=root/'message';signature=root/'signature'
    subprocess.run(['/usr/bin/openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(key)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['/usr/bin/openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    message.write_bytes(b'local signing probe')
    signature.write_bytes(p.rsa_signer(key.read_bytes())(message.read_bytes()))
    result=subprocess.run(['/usr/bin/openssl','dgst','-sha256','-verify',str(public),'-signature',str(signature),str(message)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    assert result.returncode==0
`);
});
