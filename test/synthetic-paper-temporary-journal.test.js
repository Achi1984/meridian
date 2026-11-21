import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createSyntheticPaperHarness} from '../test-support/synthetic-paper/harness.mjs';

const script=fileURLToPath(new URL('../test-support/synthetic-paper/temporary-journal-fixture.py',import.meta.url));
const wire=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));
function fixture(phase,kind){
  const identity=`synthetic-test:temp-${phase}-${kind}`;
  const harness=createSyntheticPaperHarness({syntheticIdentity:identity,clock:()=>123,
    initialCashCents:100000n,limits:{maxInitialCashCents:100000n,maxQuantityPerFillShares:2n,
      maxAggregateShares:2n,maxPriceCentsPerShare:10000n,maxFeePerFillCents:100n,
      maxAggregateFeesCents:100n,maxEvents:1,maxAttempts:1,maxIdentityChars:128,
      maxMarkAgeMs:1,maxProjectionReceipts:1}});
  const before={stateIdentity:harness.stateIdentity,account:harness.account,sequence:0};
  const action={kind,eventIdentity:`${identity}:event`,syntheticIdentity:identity,
    ...(kind==='FILL'?{quantityShares:2n,priceCentsPerShare:10000n,feeCents:100n,
      feeIdentity:`${identity}:fee`,eventTimeMs:2,decisionDurableAtMs:1,causalProof:{strictlyAfter:true}}:{})};
  const proposal=harness.propose(action);
  assert.equal(proposal.status,'PROPOSED');
  const claim=harness.claim(harness.stateIdentity);
  const committed=harness.commit(claim,proposal);
  assert.equal(committed.status,'COMMITTED');
  const after={stateIdentity:harness.stateIdentity,account:harness.account,sequence:1};
  return wire({scope:'SYNTHETIC_TEST_ONLY',identity,phase,before,after,committed});
}
for(const kind of ['FILL','NO_ACTION'])for(const phase of ['normal','before','after']){
  test(`${kind}: ${phase} commit process exit retains atomic outcome and blocks restart`,()=>{
    const generated=fixture(phase,kind);
    const env=Object.fromEntries(['PATH','LANG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
    const child=spawnSync('python3',['-I',script],{input:JSON.stringify(generated),encoding:'utf8',
      timeout:10000,maxBuffer:16384,env,shell:false});
    assert.equal(child.error,undefined,'existing Python SQLite required, never skipped');
    assert.equal(child.signal,null);
    assert.equal(child.status,0,child.stderr);
    const got=JSON.parse(child.stdout);
    assert.deepEqual(got.snapshot,phase==='before'?generated.before:generated.after);
    assert.equal(got.receiptCount,phase==='before'?0:1);
    assert.equal(got.fence,generated.committed.receipt.fenceToken);
    assert.equal(got.fenceState,phase==='before'?'ACTIVE_UNRESOLVED':'RESOLVED_COMMITTED');
    assert.deepEqual(got.exact,phase==='before'?{status:'UNKNOWN',reason:'PERSISTENCE_UNKNOWN'}:generated.committed);
    assert.deepEqual(got.repeated,got.exact);
    for(const key of ['wrongFence','missing'])assert.equal(got[key].status,'UNKNOWN');
    assert.equal(got.blocked,true);
    assert.equal(got.retryAuthorized,false);
    assert.equal(got.reconciliationImplemented,false);
    assert.equal(got.readOnlyUnchanged,true);
    assert.equal(got.temporaryDirectoryRemoved,true);
  });
}
