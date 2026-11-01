import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('role supervision actual fork and local journal boundaries', {timeout: 30000}, (t) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = spawnSync('python3', ['-I', '-B', '-m', 'unittest', 'discover', '-s', 'test',
    '-p', 'test_publisher_role_supervision.py', '-v'],
  {cwd: root, encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024});
  assert.ifError(run.error);
  t.diagnostic(run.stderr);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /Ran 15 tests/);
  assert.match(run.stderr, /\nOK\s*$/);
});
