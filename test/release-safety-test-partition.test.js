import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const workflow = fs.readFileSync(new URL('.github/workflows/backend-safety.yml', root), 'utf8');
const partitionScript = new URL('../scripts/release-safety-partition.mjs', import.meta.url);
const shards = ['browser', 'core-auth', 'supervisor'];
const controlTests = new Set(['release-safety-sharding.test.js', 'release-safety-test-partition.test.js']);

test('partitioned Release Safety keeps the required bounded shard semantics', () => {
  assert.match(workflow, /shard: \[browser, core-auth, supervisor\]/);
  assert.match(workflow, /node scripts\/release-safety-partition\.mjs --shard/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=60s 8m node --test/);
  assert.match(workflow, /timeout --signal=TERM --kill-after=60s 35m node --test/);
  assert.match(workflow, /Require all safety shards/);
  assert.match(workflow, /needs: \[safety-preflight, safety-tests\]/);
  assert.match(workflow, /if-no-files-found: error/);
});

test('partition control tests stay in preflight and runtime shards remain complete', () => {
  const selected = shards.flatMap(shard => {
    const result = spawnSync(process.execPath, [partitionScript.pathname, '--shard', shard], {
      cwd: root, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim() ? result.stdout.trim().split('\n') : [];
  });
  const expected = fs.readdirSync(new URL('../test/', root))
    .filter(name => name.endsWith('.test.js') && !controlTests.has(name))
    .map(name => path.posix.join('test', name)).sort();
  assert.equal(new Set(selected).size, selected.length, 'no runtime test executes twice');
  assert.deepEqual(selected.sort(), expected, 'all runtime tests execute exactly once');
  for (const control of controlTests) {
    assert.equal(selected.includes(path.posix.join('test', control)), false, `control test is preflight-only: ${control}`);
  }
});

test('unknown shard fails closed', () => {
  const result = spawnSync(process.execPath, [partitionScript.pathname, '--shard', 'unknown'], {
    cwd: root, encoding: 'utf8'
  });
  assert.equal(result.status, 2);
});
