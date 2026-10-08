import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const fixture=(taskId='T1',overrides={})=>({taskId,state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[],...overrides});
const args=(overrides={})=>({taskId:'T1',writer:'lead',revision:0,head,base,now:100,ttl:20,opId:'op1',...overrides});
test('claim atomically consumes quota and issues an independent monotone fence',()=>{
 const s=createOfflineStore([fixture()]),r=s.claim(args());assert.equal(r.ok,true);assert.equal(r.task.budget.used,1);
 assert.deepEqual(r.task.lease,{owner:'lead',expiresAt:120,fence:1});assert.equal(r.task.nextFence,2);
});
test('CAS, duplicate delivery and a second writer fail without mutation',()=>{
 const s=createOfflineStore([fixture()]);assert.equal(s.claim(args({revision:1})).reason,'STALE_CAS');assert.equal(s.claim(args()).ok,true);
 assert.equal(s.claim(args()).reason,'OP_ID_SEEN');assert.equal(s.claim(args({writer:'other',opId:'op2'})).reason,'STALE_CAS');
 assert.equal(s.snapshot('T1').budget.used,1);
});
test('operation ids are globally unique across tasks and restore',()=>{
 const s=createOfflineStore([fixture(),fixture('T2')]);assert.equal(s.claim(args()).ok,true);
 assert.equal(s.claim(args({taskId:'T2',opId:'op1'})).reason,'OP_ID_COLLISION');
 const claimed=s.snapshot('T1');
 assert.throws(()=>createOfflineStore([{...claimed,taskId:'A'},{...claimed,taskId:'B'}]),/DUPLICATE_GLOBAL_OP_ID/);
});
test('restored budget is reconciled from charge ledger, not operation count',()=>{
 const s=createOfflineStore([fixture()]);s.claim(args());
 s.markRecovery({taskId:'T1',revision:1,fence:1,now:120,opId:'recover'});
 s.reconcileToQueue({taskId:'T1',revision:2,fence:1,opId:'queue'});
 const valid=s.snapshot('T1');assert.equal(valid.operations.length,3);
 assert.equal(createOfflineStore([valid]).snapshot('T1').budget.used,1);
 assert.throws(()=>createOfflineStore([{...valid,budget:{limit:5,used:2}}]),/INVALID_RESTORED_TASK/);
});
test('strict identities, bounded lease arithmetic and malformed snapshots fail closed',()=>{
 assert.throws(()=>createOfflineStore([fixture('T',{head:'main'})]),/INVALID_RESTORED_TASK/);
 const s=createOfflineStore([fixture()]);assert.equal(s.claim(args({ttl:0})).reason,'INVALID_CLAIM');
 assert.equal(s.claim(args({now:Number.MAX_SAFE_INTEGER,ttl:2})).reason,'INVALID_CLAIM');
 const exhausted=createOfflineStore([fixture('X',{nextFence:Number.MAX_SAFE_INTEGER})]);
 assert.equal(exhausted.claim(args({taskId:'X'})).reason,'COUNTER_EXHAUSTED');
});
test('expiry requires explicit fenced recovery before a new claim',()=>{
 const s=createOfflineStore([fixture()]);const first=s.claim(args()).task;
 assert.deepEqual(s.inspectExpired('T1',120,first.revision,first.lease.fence),{action:'RECONCILE_REQUIRED',fence:1});
 const pending=s.markRecovery({taskId:'T1',revision:1,fence:1,now:120,opId:'recover'}).task;
 assert.equal(s.claim(args({revision:pending.revision,opId:'early'})).reason,'NOT_QUEUED');
 const queued=s.reconcileToQueue({taskId:'T1',revision:pending.revision,fence:1,opId:'requeue'}).task;
 const second=s.claim(args({revision:queued.revision,opId:'claim2',now:121})).task;
 assert.equal(second.lease.fence,2);assert.equal(second.revision,4);assert.equal(second.budget.used,2);
});
test('stale fence cannot complete and deterministic failure is terminal',()=>{
 const s=createOfflineStore([fixture()]),claimed=s.claim(args()).task;
 assert.equal(s.complete({taskId:'T1',revision:1,fence:0,writer:'lead',opId:'done'}).reason,'STALE_FENCE');
 const failed=s.complete({taskId:'T1',revision:claimed.revision,fence:1,writer:'lead',now:119,opId:'fail',outcome:'FAILED'});
 assert.equal(failed.task.state,'FAILED');assert.equal(failed.task.lease,null);
});
test('returned snapshots cannot mutate store',()=>{const s=createOfflineStore([fixture()]),copy=s.snapshot('T1');copy.budget.used=99;assert.equal(s.snapshot('T1').budget.used,0);});
