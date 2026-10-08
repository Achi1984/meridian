import test from 'node:test';
import assert from 'node:assert/strict';
import {planOfflineRecovery} from '../scripts/autonomy-v2-offline-recovery.mjs';
const queued={taskId:'T',state:'QUEUED',revision:1};
const claimed={...queued,state:'CLAIMED',writer:'lead',lease:{owner:'lead',fence:1,expiresAt:120}};
const ctx={now:100,expectedRevision:1,expectedFence:1};
test('invalid input and stale revision fail closed',()=>{
 assert.equal(planOfflineRecovery(null,ctx).reason,'INVALID_INPUT');
 assert.equal(planOfflineRecovery(queued,{...ctx,now:-1}).reason,'INVALID_INPUT');
 assert.equal(planOfflineRecovery(queued,{...ctx,expectedRevision:0}).reason,'STALE_REVISION');
});
test('queue requires no lease or writer',()=>{
 assert.equal(planOfflineRecovery(queued,ctx).action,'NO_ACTION');
 assert.equal(planOfflineRecovery({...queued,lease:claimed.lease},ctx).reason,'INCONSISTENT_QUEUE');
});
test('invalid lease and stale fence fail closed',()=>{
 assert.equal(planOfflineRecovery({...claimed,lease:null},ctx).reason,'INVALID_LEASE');
 assert.equal(planOfflineRecovery({...claimed,lease:{...claimed.lease,owner:'other'}},ctx).reason,'INVALID_LEASE');
 assert.equal(planOfflineRecovery(claimed,{...ctx,expectedFence:0}).reason,'STALE_FENCE');
});
test('unexpired lease waits; expired lease needs human reconciliation',()=>{
 assert.deepEqual(planOfflineRecovery(claimed,ctx),{action:'WAIT',until:120});
 assert.deepEqual(planOfflineRecovery(claimed,{...ctx,now:120}),{
  action:'HUMAN_RECONCILIATION_REQUIRED',taskId:'T',revision:1,fence:1});
});
