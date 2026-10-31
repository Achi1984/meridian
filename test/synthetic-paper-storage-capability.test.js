import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

test('existing Python SQLite supports bounded local marker transactions and process exit',()=>{
  const script=fileURLToPath(new URL('../test-support/synthetic-paper/storage-capability-probe.py',import.meta.url));
  const env=Object.fromEntries(['PATH','LANG'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  const result=spawnSync('python3',['-I',script],{
    encoding:'utf8',timeout:25000,maxBuffer:8192,env,shell:false,
  });
  assert.equal(result.error,undefined,'host capability unavailable or exceeded bound; not a passing skip');
  assert.equal(result.signal,null,'probe must terminate normally');
  assert.equal(result.status,0,result.stdout||'probe failed');
  assert.equal(result.stderr,'');
  const evidence=JSON.parse(result.stdout);
  assert.equal(evidence.scope,'HOST_CAPABILITY_ONLY_NO_PAPER_LEDGER');
  assert.equal(evidence.status,'PASS');
  for(const key of ['commit_and_rollback','exit_before_commit_rolled_back','exit_after_commit_retained','children_reaped','temporary_directory_removed'])assert.equal(evidence[key],true,key);
  assert.equal(evidence.power_loss_durability_proven,false);
  assert.equal(evidence.production_compatibility_proven,false);
  assert.match(evidence.python,/^3\./);
  assert.match(evidence.sqlite,/^3\./);
});
