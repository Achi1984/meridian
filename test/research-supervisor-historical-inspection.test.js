import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('historical journal inspection: generated fixtures only, bounded and read-only', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('python3', ['-B', 'scripts/research-supervisor/test_historical_inspection_report.py'], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /OK/);
});
