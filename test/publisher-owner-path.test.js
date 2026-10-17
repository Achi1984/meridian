import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('publisher owner path: isolated read-only canonical traversal', {timeout:30000}, () => {
  const run=spawnSync('python3',['-I','-B','-m','unittest','discover','-s','test',
    '-p','test_publisher_owner_path.py','-v'],{
    cwd:fileURLToPath(new URL('../',import.meta.url)),
    encoding:'utf8',timeout:25000,maxBuffer:1024*1024,
  });
  assert.ifError(run.error);
  assert.equal(run.status,0,`Offline owner-path tests failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr,/Ran \d+ tests/);
  assert.match(run.stderr,/\nOK\s*$/);
});
