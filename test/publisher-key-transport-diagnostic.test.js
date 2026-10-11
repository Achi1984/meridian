import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('manual key transport diagnostic passes exact-inline offline Python checks', () => {
  const path = fileURLToPath(new URL('./publisher-key-transport-diagnostic.test.py', import.meta.url));
  const result = spawnSync('python3', ['-I', path], {encoding: 'utf8', timeout: 30000});
  assert.equal(result.status, 0, result.stderr || result.stdout || 'Python test did not complete');
});
