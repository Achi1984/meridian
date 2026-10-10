import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('failure diagnostic Python regression suite', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('python3', ['-I', '-B', 'test/test_claude_failure_diagnostic.py'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 65536,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'Python suite terminated by signal');
  assert.equal(result.status, 0, `Python regressions failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 9 tests\b/, 'Expected all nine Python regressions');
  assert.match(result.stderr, /\bOK\s*$/, 'Python suite must report success');
});
