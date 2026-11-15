import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const script = new URL('../scripts/release-safety-partition.mjs', import.meta.url);

test('release safety sharding is disjoint and complete', () => {
  const shards = ['browser', 'core-auth', 'supervisor'];
  const selected = shards.flatMap(shard => {
    const result = spawnSync(process.execPath, [script.pathname, '--shard', shard], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim() ? result.stdout.trim().split('\n') : [];
  });
  const expected = fs.readdirSync(new URL('../test/', import.meta.url)).filter(name => name.endsWith('.test.js')).map(name => path.posix.join('test', name)).sort();
  assert.equal(new Set(selected).size, selected.length, 'no test is assigned twice');
  assert.deepEqual(selected.sort(), expected, 'all tests are assigned exactly once');
});

test('unknown shard fails closed', () => {
  const result = spawnSync(process.execPath, [script.pathname, '--shard', 'unknown'], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 2);
});
