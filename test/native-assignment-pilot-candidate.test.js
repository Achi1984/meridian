import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../docs/autonomy/native-assignment-pilot.workflow.yml', import.meta.url), 'utf8');
const programs = [...workflow.matchAll(/          python3(?: -B)? - <<'PY'\n([\s\S]*?)          PY/g)].map(m => m[1].replace(/^          /gm, ''));
const runtime = process.env.NATIVE_PILOT_TEST_RUNTIME_PATH || fileURLToPath(new URL('../scripts/native-copilot-task-runtime.py', import.meta.url));
function python(source, env = {}) {
  const result = spawnSync('python3', ['-B', '-c', source], {encoding:'utf8', timeout:5000, env:{...process.env,...env}});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('config input cannot change executable paths, source revision or inject shell text', () => {
  assert.equal(programs.length, 3);
  const validationPrefix = programs[0].split('files = [')[0];
  for (const value of ['A'.repeat(40), '../main', 'main', 'a'.repeat(39), 'a'.repeat(41), '$(touch /tmp/no)', '']) {
    python(`try:\n${validationPrefix.split('\n').map(l=>'    '+l).join('\n')}\nexcept AssertionError:\n    pass\nelse:\n    raise AssertionError('invalid SHA accepted')`, {CONFIG_COMMIT_SHA:value});
  }
  python(validationPrefix, {CONFIG_COMMIT_SHA:'a'.repeat(40)});
  assert.match(programs[0], /source_sha = 'fc706326c1af1ac63303d273467d2100ec83b3a3'/);
  assert.match(programs[0], /\('docs\/autonomy\/native-assignment-pilot-config.json', 'approved-task.json', config_sha\)/);
  assert.equal((programs[0].match(/, source_sha\)/g)||[]).length, 2);
  assert.doesNotMatch(programs.join('\n'), /\$\{\{|exec\(cfg|eval\(|spec_from_file_location\([^\n]*cfg/);
});

const setup = `
import importlib.util, json, os, time, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('runtime', ${JSON.stringify(runtime)})
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
cfg={'repository':'Achi1984/meridian','issue_number':900001,'issue_body_sha256':'a'*64,
 'expected_main_sha':'b'*40,'release_run_id':123,'release_run_attempt':2,'workflow_id':456,
 'workflow_name':'MERIDIAN Release Safety','workflow_path':'.github/workflows/backend-safety.yml',
 'authorization_identity':'Achi1984','authorization_expires_at':int(time.time())+60,'expected_assignees':[]}
`;

test('config main mismatch fails in the pre-secret validation program', () => {
  assert.ok(workflow.indexOf('Validate config against executing main') < workflow.indexOf('NATIVE_USER_TOKEN:'));
  python(setup + `
program=${JSON.stringify(programs[1])}
with tempfile.TemporaryDirectory() as directory:
 os.chdir(directory)
 Path('native-copilot-task-runtime.py').write_text(Path(${JSON.stringify(runtime)}).read_text())
 Path('native-copilot-task-dispatch.py').write_text(Path(${JSON.stringify(runtime)}).with_name('native-copilot-task-dispatch.py').read_text())
 Path('approved-task.json').write_text(json.dumps(cfg))
 os.environ['GITHUB_SHA']='c'*40
 try: exec(program)
 except AssertionError: pass
 else: raise AssertionError('mismatched main accepted')
 os.environ['GITHUB_SHA']='b'*40
 exec(program)
`);
});

test('capability false performs no HTTP construction despite a provided token', () => {
  assert.match(programs[2], /verified_user_token_auth = False/);
  python(setup + `
task=r._dispatcher.ApprovedTask.from_mapping(cfg)
event={'run_id':123,'run_attempt':2,'workflow_id':456,'head_sha':'b'*40,'repository':'Achi1984/meridian'}
def forbidden(*args,**kwargs): raise AssertionError('transport must not be built')
r.GitHubHTTPS=forbidden
result=r.run_once(task,event,'syntactic-token',verified_user_token_auth=False,fence_mode='github_ref')
assert result['status']=='INACTIVE'
cfg['command']='print(123)'
try:r._dispatcher.ApprovedTask.from_mapping(cfg)
except ValueError:pass
else:raise AssertionError('executable config key accepted')
`);
});

test('receiver stays inactive and owner-only; loader has read-only job permission', () => {
  for (const expected of ["github.actor == 'Achi1984'", "github.triggering_actor == 'Achi1984'", "github.ref == 'refs/heads/main'", 'github.run_number == 0', 'github.run_attempt == 1', 'permissions: {}', 'contents: read', 'timeout-minutes: 3']) assert.ok(workflow.includes(expected));
  assert.doesNotMatch(workflow, /contents: write|workflow_run:|schedule:/);
});
