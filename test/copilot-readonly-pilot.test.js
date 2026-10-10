import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const text = readFileSync(new URL('../.github/workflows/copilot-readonly-pilot.yml', import.meta.url), 'utf8');
test('one-shot pilot has manual-only trigger and no source checkout', () => {
  assert.match(text, /on:\n  workflow_dispatch:\n\npermissions: \{\}/);
  assert.doesNotMatch(text, /\buses:|\bsecrets\.|\bschedule:|\bworkflow_run:|\bpull_request:|\bpush:/);
});
test('one-shot pilot pins identity and bounded execution', () => {
  for (const guard of ["github.repository == 'Achi1984/meridian'", "github.actor == 'Achi1984'",
    "github.triggering_actor == 'Achi1984'", "github.ref == 'refs/heads/main'", 'github.run_attempt == 1',
    'github.run_number == 1', "github.event.repository.owner.type == 'User'", "github.repository_owner == 'Achi1984'",
    'timeout-minutes: 6', 'timeout --kill-after=10s 90s', 'cancel-in-progress: false']) assert.ok(text.includes(guard), guard);
  assert.equal((text.match(/timeout --kill-after=10s 90s \.\/cli\/node_modules\/\.bin\/copilot/g) || []).length, 1);
  assert.equal((text.match(/ -p /g) || []).length, 1);
  assert.doesNotMatch(text, /--autopilot|--allow-all|--allow-tool|--resume/);
});
test('one-shot pilot has read-only repository token and denies model tools', () => {
  assert.deepEqual([...text.matchAll(/^      ([\w-]+): (read|write)$/gm)].map(m => m.slice(1)),
    [['contents','read'], ['actions','read'], ['copilot-requests','write']]);
  for (const flag of ['--disable-builtin-mcps', '--no-custom-instructions', '--no-auto-update',
    "--deny-tool='shell,write,read,url,memory'", "--available-tools='view'", '--no-remote-export', '--no-ask-user']) assert.ok(text.includes(flag));
  assert.match(text, /--ignore-scripts --no-audit --no-fund @github\/copilot@1\.0\.95/);
});
test('one-shot gate executes and rejects prior/concurrent runs, reruns and changed research', () => {
  const block = text.split("python3 - <<'PY'\n")[1].split('\n          PY')[0].replace(/^          /gm, '');
  const harness = `import os, tempfile, unittest.mock as mock, json, base64\nsource=${JSON.stringify(block)}\n` + String.raw`
sha = 'a' * 40
keys = ['canonicalExecutionAuthorized','strategyPnlAuthorized','discoveryAuthorized','validationAuthorized','holdoutAuthorized','paperAuthorized','liveAuthorized']
def trial(change, should_pass):
    with tempfile.TemporaryDirectory() as tmp:
        env = {'GH_TOKEN':'test-only', 'GITHUB_RUN_ID':'123', 'GITHUB_SHA':sha, 'RUNNER_TEMP':tmp}
        data = {'runs': {'total_count':1,'workflow_runs':[{'id':123,'run_attempt':1,'event':'workflow_dispatch'}]},
                'sha':sha,'research':{k:False for k in keys}}
        change(data)
        def fetch(request, timeout):
            url = request.full_url
            if '/runs?' in url: result = data['runs']
            elif '/git/ref/' in url: result = {'object':{'sha':data['sha']}}
            else: result = {'content':base64.b64encode(json.dumps({'activeResearch':data['research']}).encode()).decode()}
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps(result).encode()
            return response
        with mock.patch.dict(os.environ, env, clear=True), mock.patch('urllib.request.urlopen', side_effect=fetch):
            try: exec(compile(source, '<gate>', 'exec'), {})
            except (ValueError, KeyError):
                if should_pass: raise
            else:
                assert should_pass, 'unsafe gate accepted'
trial(lambda d: None, True)
trial(lambda d: d['runs'].update(total_count=2), False)
trial(lambda d: d['runs'].update(total_count=0,workflow_runs=[]), False)
trial(lambda d: d['runs']['workflow_runs'][0].update(id=124), False)
trial(lambda d: d['runs']['workflow_runs'][0].update(run_attempt=2), False)
trial(lambda d: d['runs']['workflow_runs'][0].update(event='push'), False)
trial(lambda d: d.update(sha='b'*40), False)
for key in keys:
    trial(lambda d: d['research'].update({key:True}), False)
    trial(lambda d: d['research'].pop(key), False)
print('21 gate scenarios passed')
`;
  const result = spawnSync('python3', ['-c', harness], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /21 gate scenarios passed/);
});
