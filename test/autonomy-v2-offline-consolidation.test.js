import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';
import {planOfflineRecovery} from '../scripts/autonomy-v2-offline-recovery.mjs';
import {replayRestart} from '../scripts/autonomy-v2-offline-restart.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
const seed=(overrides={})=>({taskId:'T',state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[],...overrides});
const claim={taskId:'T',writer:'lead',revision:0,head,base,now:100,ttl:20,opId:'claim'};
const recovery={taskId:'T',revision:1,fence:1,now:120,opId:'recover'};
const requeue={taskId:'T',revision:2,fence:1,opId:'queue'};
const complete={taskId:'T',revision:4,fence:2,writer:'lead',opId:'complete'};
const cycle=[{type:'CLAIM',args:claim},{type:'MARK_RECOVERY',args:recovery},
 {type:'REQUEUE',args:requeue},{type:'CLAIM',args:{...claim,revision:3,now:121,opId:'claim2'}}];
const taskAt=count=>replayRestart([seed()],cycle.slice(0,count)).snapshot[0];

for(const [name,operations] of [
 ['empty',[]],['claim',cycle.slice(0,1)],['recovery',cycle.slice(0,2)],
 ['requeue',cycle.slice(0,3)],['reclaim',cycle],
 ['completed',[...cycle,{type:'COMPLETE',args:complete}]],
 ['failed',[...cycle,{type:'COMPLETE',args:{...complete,outcome:'FAILED'}}]],
])test(`end-of-list crash rebuilds ${name} exactly once and retains only current-epoch audit`,()=>{
 const expected=replayRestart([seed()],operations);
 const actual=replayRestart([seed()],operations,{crashAfter:operations.length});
 assert.equal(actual.restarts,1);assert.deepEqual(actual.results,expected.results);
 assert.deepEqual(actual.snapshot,expected.snapshot);assert.deepEqual(actual.audit,[]);
 assert.deepEqual(createOfflineStore(actual.snapshot).snapshotAll(),actual.snapshot);
 if(operations.length){
  const last=operations.at(-1);
  const replay=replayRestart(actual.snapshot,[last]);assert.equal(replay.results[0].reason,'OP_ID_SEEN');
  assert.deepEqual(replay.snapshot,actual.snapshot);assert.deepEqual(replay.audit,[]);
 }
});
test('all crash boundaries including the terminal boundary preserve results and replay authority',()=>{
 const operations=[...cycle,{type:'COMPLETE',args:complete}],reference=replayRestart([seed()],operations);
 for(let crashAfter=0;crashAfter<=operations.length;crashAfter++){
  const r=replayRestart([seed()],operations,{crashAfter});
  assert.equal(r.restarts,1);assert.deepEqual(r.snapshot,reference.snapshot);assert.deepEqual(r.results,reference.results);
  assert.deepEqual(r.audit,reference.audit.slice(crashAfter));
 }
 assert.equal(replayRestart([seed()],operations,{crashAfter:operations.length+1}).restarts,0);
 assert.equal(replayRestart([seed()],operations).restarts,0);
});
test('a rejected operation neither advances the crash counter nor creates a phantom end crash',()=>{
 const operations=[cycle[0],{type:'REQUEUE',args:requeue}];
 const r=replayRestart([seed()],operations,{crashAfter:2});
 assert.equal(r.restarts,0);assert.equal(r.results.at(-1).reason,'NOT_RECOVERY_PENDING');
 assert.equal(r.snapshot[0].operations.length,1);assert.equal(r.audit.length,1);
 const boundary=replayRestart([seed()],operations,{crashAfter:1});
 assert.equal(boundary.restarts,1);assert.deepEqual(boundary.audit,[]);assert.deepEqual(boundary.snapshot,r.snapshot);
});

const invalidTimes=[undefined,null,-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'120',120n,{}];
for(const state of ['QUEUED','CLAIMED','RECOVERY_PENDING'])for(const [index,now] of invalidTimes.entries())
 test(`recovery clock case ${index} blocks before ${state} decisions without side effects`,()=>{
  const task=taskAt({QUEUED:0,CLAIMED:1,RECOVERY_PENDING:2}[state]);
  const context={now,expectedRevision:task.revision,expectedFence:task.lease?.fence};
  assert.equal(planOfflineRecovery(task,context).reason,'INVALID_INPUT');
  const s=createOfflineStore([task]),before=s.snapshotAll();
  assert.equal(s.inspectExpired('T',now,task.revision,task.lease?.fence).reason,'INVALID_INPUT');
  assert.equal(s.markRecovery({taskId:'T',revision:task.revision,fence:task.lease?.fence,now,opId:'new'}).reason,'INVALID_INPUT');
  assert.deepEqual(s.snapshotAll(),before);assert.deepEqual(s.audit(),[]);
 });
test('the last safe clock value is accepted and expiry inspection remains advisory',()=>{
 const s=createOfflineStore([seed()]);const r=s.claim({...claim,now:Number.MAX_SAFE_INTEGER-1,ttl:1});
 assert.equal(r.ok,true);const before=s.snapshotAll();
 assert.deepEqual(s.inspectExpired('T',Number.MAX_SAFE_INTEGER,1,1),{action:'RECONCILE_REQUIRED',fence:1});
 assert.deepEqual(s.snapshotAll(),before);assert.equal(s.complete({...complete,revision:1,fence:1}).ok,true);
});
test('Phase-1A named expiry cases retain caller CAS and never transfer ownership automatically',()=>{
 const s=createOfflineStore([seed()]);const task=s.claim(claim).task;
 assert.deepEqual(s.inspectExpired('T',119,1,1),{action:'NO_ACTION'});
 assert.deepEqual(s.inspectExpired('T',120,1,1),{action:'RECONCILE_REQUIRED',fence:1});
 assert.equal(s.inspectExpired('T',120,0,1).reason,'STALE_REVISION');
 assert.equal(s.inspectExpired('T',120,1,0).reason,'STALE_FENCE');
 assert.equal(s.inspectExpired('T',120).action,'BLOCK');assert.deepEqual(s.snapshot('T'),task);
});
for(const context of [null,[],false,42,'context',Object.create({now:120,expectedRevision:1,expectedFence:1})])
 test(`malformed planner context ${String(context)} blocks deterministically`,()=>{
  assert.deepEqual(planOfflineRecovery(taskAt(1),context),{action:'BLOCK',reason:'INVALID_INPUT'});
 });
test('planner rejects accessor context without executing it',()=>{
 let calls=0;const context={expectedRevision:1,expectedFence:1};
 Object.defineProperty(context,'now',{enumerable:true,get(){calls++;return 120;}});
 assert.equal(planOfflineRecovery(taskAt(1),context).reason,'INVALID_INPUT');assert.equal(calls,0);
});
test('planner rejects malformed task shapes and whitespace-only lease writers',()=>{
 const task=taskAt(1);
 assert.equal(planOfflineRecovery({...task,writer:' ',lease:{...task.lease,owner:' '}},{now:120,expectedRevision:1,expectedFence:1}).reason,'INVALID_LEASE');
 const array=Object.assign([],{state:'QUEUED',revision:0});
 assert.equal(planOfflineRecovery(array,{now:120,expectedRevision:0}).reason,'INVALID_INPUT');
});
for(const options of [null,[],false,42,'options',Object.create({crashAfter:0})])
 test(`malformed crash options ${String(options)} reject deterministically`,()=>{
  assert.throws(()=>replayRestart([seed()],cycle,options),/INVALID_OPERATIONS/);
 });
test('restart rejects accessor operation metadata without execution',()=>{
 let calls=0;const operation={args:claim};
 Object.defineProperty(operation,'type',{enumerable:true,get(){calls++;return 'CLAIM';}});
 const r=replayRestart([seed()],[operation]);
 assert.equal(r.results[0].reason,'UNSUPPORTED_OPERATION');assert.equal(calls,0);assert.deepEqual(r.snapshot,[seed()]);
});
test('restart rejects inherited operation metadata without dispatching a known method',()=>{
 const r=replayRestart([seed()],[Object.create({type:'CLAIM',args:claim})]);
 assert.equal(r.results[0].reason,'UNSUPPORTED_OPERATION');assert.deepEqual(r.snapshot,[seed()]);
});
test('null-prototype data records work through restore, recovery and restart',()=>{
 const record=Object.assign(Object.create(null),seed());
 const args=Object.assign(Object.create(null),claim),context=Object.assign(Object.create(null),{now:120,expectedRevision:1,expectedFence:1});
 const r=replayRestart([record],[Object.assign(Object.create(null),{type:'CLAIM',args})],{crashAfter:1});
 assert.equal(r.results[0].ok,true);assert.equal(planOfflineRecovery(r.snapshot[0],context).action,'HUMAN_RECONCILIATION_REQUIRED');
});
test('near-exhausted fences survive recovery and restore, then reject before issuing another lease',()=>{
 const fence=Number.MAX_SAFE_INTEGER-1,s=createOfflineStore([seed({nextFence:fence})]);
 assert.equal(s.claim(claim).ok,true);
 assert.equal(s.markRecovery({...recovery,fence}).ok,true);assert.equal(s.reconcileToQueue({...requeue,fence}).ok,true);
 const restored=createOfflineStore(s.snapshotAll()),before=restored.snapshotAll();
 assert.equal(restored.claim({...claim,revision:3,opId:'next'}).reason,'COUNTER_EXHAUSTED');
 assert.deepEqual(restored.snapshotAll(),before);assert.deepEqual(restored.audit(),[]);
 assert.equal(restored.claim(claim).reason,'OP_ID_SEEN');
});
test('quota exhaustion takes precedence over an exhausted fence without consuming the operation ID',()=>{
 const fence=Number.MAX_SAFE_INTEGER-1,s=createOfflineStore([seed({nextFence:fence,budget:{limit:1,used:0}})]);
 s.claim(claim);s.markRecovery({...recovery,fence});s.reconcileToQueue({...requeue,fence});
 const before=s.snapshotAll();assert.equal(s.claim({...claim,revision:3,opId:'next'}).reason,'BUDGET_EXHAUSTED');
 assert.deepEqual(s.snapshotAll(),before);assert.equal(s.audit().length,3);
});
test('lease arithmetic overflow leaves an operation ID available for a valid retry',()=>{
 const s=createOfflineStore([seed()]);
 assert.equal(s.claim({...claim,now:Number.MAX_SAFE_INTEGER,ttl:1}).reason,'INVALID_CLAIM');
 assert.deepEqual(s.snapshotAll(),[seed()]);assert.deepEqual(s.audit(),[]);assert.equal(s.claim(claim).ok,true);
});
