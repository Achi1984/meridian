import test from 'node:test';
import assert from 'node:assert/strict';
import {planOfflineRecovery} from '../scripts/autonomy-v2-offline-recovery.mjs';
const queued={taskId:'T',state:'QUEUED',revision:1};
const claimed={...queued,state:'CLAIMED',writer:'lead',lease:{owner:'lead',fence:7,expiresAt:120}};
const ctx={now:100,expectedRevision:1,expectedFence:7};
test('invalid input, stale revision and stale fence fail closed',()=>{
 assert.equal(planOfflineRecovery(null,ctx).reason,'INVALID_INPUT');assert.equal(planOfflineRecovery(claimed,{...ctx,expectedRevision:0}).reason,'STALE_REVISION');
 assert.equal(planOfflineRecovery(claimed,{...ctx,expectedFence:6}).reason,'STALE_FENCE');
});
test('queue has no recovery action and inconsistent queue blocks',()=>{
 assert.equal(planOfflineRecovery(queued,ctx).action,'NO_ACTION');assert.equal(planOfflineRecovery({...queued,lease:claimed.lease},ctx).reason,'INCONSISTENT_QUEUE');
});
test('lease fence is independent from revision and expiry requires reconciliation',()=>{
 assert.deepEqual(planOfflineRecovery(claimed,ctx),{action:'WAIT',until:120});
 assert.deepEqual(planOfflineRecovery(claimed,{...ctx,now:120}),{action:'HUMAN_RECONCILIATION_REQUIRED',taskId:'T',revision:1,fence:7});
});
test('recovery pending cannot trigger another takeover decision',()=>{
 assert.equal(planOfflineRecovery({...claimed,state:'RECOVERY_PENDING'},{...ctx,now:999}).action,'NO_ACTION');
});
