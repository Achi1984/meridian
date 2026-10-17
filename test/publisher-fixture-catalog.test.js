import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('publisher fixture catalog: offline generator and comparator suite', {timeout:30000}, () => {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const run=spawnSync('python3',['-I','-B','-m','unittest','discover','-s','test',
    '-p','test_publisher_fixture_catalog.py','-v'],{
    cwd:root,encoding:'utf8',timeout:25000,maxBuffer:1024*1024,
  });
  assert.ifError(run.error);
  assert.equal(run.status,0,`Offline fixture catalog tests failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr,/Ran 17 tests/);
  assert.match(run.stderr,/\nOK\s*$/);
});
