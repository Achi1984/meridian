import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('V8 policy negative controls run in the existing Node CI suite', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'test_work_package_policy.py'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 8 tests/);
});
