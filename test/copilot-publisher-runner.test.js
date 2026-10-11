import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper = fileURLToPath(new URL('../scripts/copilot-publisher-runner.py', import.meta.url));
const workflow = readFileSync(new URL('../.github/workflows/copilot-coding-pilot.yml', import.meta.url), 'utf8');
function python(body) {
  const result = spawnSync('python3', ['-c', `import importlib.util, os, sys, base64, contextlib, unittest.mock as mock\nspec=importlib.util.spec_from_file_location('runner',${JSON.stringify(helper)})\nr=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(r)\n${body}`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
const fixture = String.raw`
# Build synthetic PEM transport delimiters; payload is not a private key.
def delimiter(kind,label='RSA PRIVATE KEY'):
    return '-----'+kind+' '+label+'-----'
key=delimiter('BEGIN')+'\n'+base64.b64encode(b'fixture-only-not-a-real-key'*2).decode()+'\n'+delimiter('END')+'\n'
# Wrap fixture base64 at ordinary PEM width.
head,body,tail=key.splitlines();key=head+'\n'+body[:64]+'\n'+body[64:]+'\n'+tail+'\n'
secret='MERIDIAN_PUBLISHER_APP_PRIVATE_KEY'
`;

test('runner import is inert and never reads secret or loads sibling modules', () => {
  python(String.raw`
with mock.patch.dict(os.environ,{},clear=True),mock.patch('importlib.util.spec_from_file_location') as sibling, \
     mock.patch('urllib.request.build_opener') as network,mock.patch('subprocess.run') as child, \
     mock.patch('os._Environ.pop',side_effect=AssertionError('secret read during import')):
    spec.loader.exec_module(r)
    sibling.assert_not_called();network.assert_not_called();child.assert_not_called()
`);
});

test('runner consumes only bounded ASCII PEM transport and fails sanitized before module load', () => {
  python(fixture+String.raw`
invalid=[None,'','x'*32769,key.replace('\n','\v'),delimiter('BEGIN','PRIVATE KEY')+'\né\n'+delimiter('END','PRIVATE KEY'),
         key.replace('END RSA','END OTHER'),key.replace(body[:64],'!'),key+'trailing',
         delimiter('BEGIN')+'\nYQ==\n'+delimiter('END'),
         key.replace('BEGIN RSA PRIVATE','BEGIN PUBLIC')]
for value in invalid:
    env={} if value is None else {secret:value}
    with mock.patch.dict(os.environ,env,clear=True),mock.patch.object(sys,'argv',['runner.py']), \
         mock.patch.object(r,'sibling') as sibling,mock.patch('builtins.print') as output:
        assert r.main()==1
        assert secret not in os.environ
        sibling.assert_not_called()
        output.assert_any_call('PUBLISHER_STOPPED; reconcile outcome before retry',file=sys.stderr)
with mock.patch.dict(os.environ,{secret:key},clear=True),mock.patch.object(sys,'argv',['runner.py','publish']), \
     mock.patch.object(r,'sibling') as sibling,mock.patch('builtins.print'):
    assert r.main()==1 and secret not in os.environ
    sibling.assert_not_called()
`);
});

test('runner passes real broker factory only after publish checks and clears secret before signing', () => {
  python(fixture+String.raw`
broker=r.sibling('copilot-publisher-broker.py')
for entered in (False,True):
    events=[];pilot=mock.Mock()
    def publish(*,publisher_factory,observer=None):
        assert secret not in os.environ
        assert pilot.PUBLISHER_BOT_LOGIN==r.PINS['bot_login']
        events.append('validated')
        if not entered:raise ValueError('expired packet fixture')
        with publisher_factory() as token:
            assert token=='ghs_mock_memory_token'
            assert 'MERIDIAN_PUBLISHER_TOKEN' not in os.environ
            events.append('post')
    pilot.publish.side_effect=publish
    def signer(raw):
        assert raw==key.encode('ascii') and secret not in os.environ
        assert events==['validated']
        events.append('signer')
        return sign
    sign=mock.Mock()
    @contextlib.contextmanager
    def token_context(*,http,sign,pins,observer=None):
        assert http is broker.github_http and pins==r.PINS
        assert pins is not r.PINS
        events.append('mint')
        try:yield 'ghs_mock_memory_token'
        finally:events.append('revoke')
    with mock.patch.dict(os.environ,{secret:key,'GH_TOKEN':'ghs_job_fixture'},clear=True), \
         mock.patch.object(sys,'argv',['runner.py']),mock.patch.object(r,'sibling',side_effect=[pilot,broker]) as load, \
         mock.patch.object(broker,'rsa_signer',side_effect=signer) as signing, \
         mock.patch.object(broker,'publisher_token',side_effect=token_context) as token, \
         mock.patch('builtins.print') as output:
        # Mock publisher omits evidence events, so even a returned call is not receipt-success.
        assert r.main()==1
        assert [call.args[0] for call in load.call_args_list]==['copilot-coding-pilot.py','copilot-publisher-broker.py']
        assert signing.call_count==int(entered) and token.call_count==int(entered)
        assert events==(['validated','signer','mint','post','revoke'] if entered else ['validated'])
`);
});

test('runner uses actual broker identity checks and sanitizes signer errors without exposing key', () => {
  python(fixture+String.raw`
broker=r.sibling('copilot-publisher-broker.py');pilot=mock.Mock()
def publish(*,publisher_factory,observer=None):
    with publisher_factory():raise AssertionError('must fail before yielding')
pilot.publish.side_effect=publish
with mock.patch.dict(os.environ,{secret:key},clear=True),mock.patch.object(sys,'argv',['runner.py']), \
     mock.patch.object(r,'sibling',side_effect=[pilot,broker]), \
     mock.patch.object(broker,'rsa_signer',return_value=lambda message:(_ for _ in ()).throw(ValueError(key))), \
     mock.patch.object(broker,'github_http') as http,mock.patch('builtins.print') as output:
    assert r.main()==1
    http.assert_not_called()
    output.assert_any_call('PUBLISHER_STOPPED; reconcile outcome before retry',file=sys.stderr)
`);
});

test('publish alone receives protected-environment secret and executes only verified fixed sibling files', () => {
  const [earlier,publish] = workflow.split('  publish:\n');
  assert.doesNotMatch(earlier,/secrets\.|MERIDIAN_PUBLISHER_APP_PRIVATE_KEY/);
  assert.match(publish,/environment: meridian-draft-publisher/);
  assert.match(publish,/pull-requests: read/);
  assert.doesNotMatch(publish,/pull-requests: write|checkout@|download-artifact@|workflow_dispatch/);
  assert.equal((publish.match(/secrets\./g)||[]).length,1);
  const [loader,executor] = publish.split('      - name: Validate artifact and create one Draft with scoped App token');
  assert.doesNotMatch(loader,/secrets\.|\$GITHUB_SHA|head_sha|MERIDIAN_PUBLISHER_APP_PRIVATE_KEY/);
  assert.match(loader,/set -euo pipefail/);
  assert.match(loader,/umask 077/);
  for (const [name,label] of [['coding-pilot','PILOT'],['publisher-broker','BROKER'],['publisher-runner','RUNNER']]) {
    assert.match(loader,new RegExp(`contents/scripts/copilot-${name}\\.py\\?ref=[a-f0-9]{40}'`));
    assert.match(loader,new RegExp(`[a-f0-9]{64}  copilot-${name}\\.py`));
  }
  assert.match(loader,/sha256sum --check --strict -/);
  assert.match(executor,/MERIDIAN_PUBLISHER_APP_PRIVATE_KEY: \$\{\{ secrets\.MERIDIAN_PUBLISHER_APP_PRIVATE_KEY \}\}/);
  assert.match(executor,/run: exec python3 -I "\$RUNNER_TEMP\/trusted-publisher\/copilot-publisher-runner\.py"/);
  assert.doesNotMatch(executor,/\$\{\{ github\.event|MERIDIAN_PUBLISHER_TOKEN|run: \|/);
});

test('receipt rejects untrusted payloads and duplicate or reversed events without logging them', () => {
  python(String.raw`
import json
receipt=r.Receipt()
for event,fields in [('unknown',{'key':'secret-marker'}),('draft_validated',{'pr_number':True}),
                     ('app_verified',{'app_id':{'token':'secret-marker'}}),
                     ('scope_verified',{'repository_id':1,'expires_at':'secret-marker'}),
                     ('mint_attempted',{'mint_requested_at':-1}),
                     ('revocation_confirmed',{'raw':'secret-marker'})]:
    try:receipt.observe(event,**fields)
    except ValueError:pass
    else:raise AssertionError('bad receipt accepted')
receipt.observe('publication_attempted')
for event in ('publication_attempted','validated'):
    try:receipt.observe(event)
    except ValueError:pass
    else:raise AssertionError('duplicate or reversed event accepted')
with mock.patch('builtins.print') as output:
    receipt.emit(False)
    text=output.call_args.args[0]
    assert 'secret-marker' not in text
    assert json.loads(text.split(' ',1)[1])['outcome']=='reconciliation_required'
with mock.patch.object(r,'run'),mock.patch.object(sys,'argv',['runner.py']),mock.patch('builtins.print',side_effect=OSError('log unavailable')):
    assert r.main()==1
`);
});
