import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
test('Trial4 recovery identity, transport and one-shot safeguards', () => {
  const directory = path.resolve(__dirname, '../scripts/autonomy/trial4-recovery');
  const result = spawnSync('python3', ['-I', '-m', 'unittest', 'discover', '-s', directory, '-p', 'test_recovery_*.py'], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
