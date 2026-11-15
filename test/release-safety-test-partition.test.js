import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = new URL('../', import.meta.url);
const workflow = fs.readFileSync(new URL('.github/workflows/backend-safety.yml', root), 'utf8');
const script = new URL('../scripts/release-safety-partition.mjs', import.meta.url);

test('Release Safety partitions every discovered test exactly once', () => {
  assert.match(workflow, /shard: \[browser, core-auth, supervisor\]/);
  const expected = fs.readdirSync(new URL('../test/', import.meta.url))
    .filter(name => name.endsWith('.test.js'))
    .map(name => path.posix.join('test', name))
    .sort();
  const selected = ['browser', 'core-auth', 'supervisor'].flatMap(shard => {
    const result = spawnSync(process.execPath, [script.pathname, '--shard', shard], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim() ? result.stdout.trim().split('\n') : [];
  });
  assert.equal(new Set(selected).size, selected.length, 'no test executes twice');
  assert.deepEqual(selected.sort(), expected, 'no discovered test is omitted');
});

test('unknown Release Safety shard fails closed', () => {
  const result = spawnSync(process.execPath, [script.pathname, '--shard', 'unknown'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 2);
});
