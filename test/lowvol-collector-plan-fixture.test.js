import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('LowVol exact collector planning and funding gate use only generated fixture adapters',()=>{
  const script=fileURLToPath(new URL('../test-support/lowvol/collector-plan-fixture.py',import.meta.url));
  const env=Object.fromEntries(['PATH','LANG'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  const result=spawnSync('python3',['-I',script],{encoding:'utf8',timeout:10000,maxBuffer:8192,env,shell:false});
  assert.equal(result.error,undefined,'Python fixture unavailable or exceeded bound');
  assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/Ran 7 tests/);
  assert.match(result.stderr,/\nOK\s*$/);
});
