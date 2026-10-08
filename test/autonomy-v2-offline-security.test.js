import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';
import {replayRestart} from '../scripts/autonomy-v2-offline-restart.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
const seed=(taskId='T')=>({taskId,state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[]});
const claim=(opId='claim',revision=0,taskId='T')=>({taskId,writer:'lead',revision,head,base,now:100,ttl:10,opId});
const recovery={taskId:'T',revision:1,fence:1,now:110,opId:'recover'};
const requeue={taskId:'T',revision:2,fence:1,opId:'requeue'};
const finish={taskId:'T',revision:1,fence:1,writer:'lead',opId:'done'};
const ops=[{type:'CLAIM',args:claim()},{type:'MARK_RECOVERY',args:recovery},{type:'REQUEUE',args:requeue},{type:'CLAIM',args:claim('claim2',3)}];
const snapshot=(count=ops.length)=>replayRestart([seed()],ops.slice(0,count)).snapshot[0];
const rejects=task=>assert.throws(()=>createOfflineStore([task]),/INVALID_RESTORED_TASK/);

test('restore rejects historical fence reuse and nonmonotone claims',()=>{
 const queued=snapshot(3);rejects({...queued,nextFence:1});
 const current=snapshot();
 for(const fence of [1,0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1,undefined]){
  const t=structuredClone(current);t.operations[3].fence=fence;rejects(t);
 }
 const t=structuredClone(current);t.nextFence=2;t.lease.fence=1;rejects(t);
});
test('restore derives state, revision, charges and current lease from the ledger',()=>{
 const current=snapshot();
 for(const mutate of [
  t=>{t.state='RECOVERY_PENDING';},t=>{t.state='COMPLETED';t.lease=null;t.writer=null;},
  t=>{t.state='FAILED';t.lease=null;t.writer=null;},t=>{t.revision=99;},
  t=>{t.lease.fence=1;},t=>{t.operations[0].units=0;t.budget.used=1;},
  t=>{t.operations[1].units=1;t.budget.used=3;t.budget.limit=3;},
  t=>{t.operations[1].kind='NOTE';},t=>{t.operations[2].fence=2;},
  t=>{t.operations[1].kind='REQUEUE';t.operations[2].kind='RECOVERY_MARK';},
  t=>{t.extra=true;},t=>{t.budget.extra=true;},t=>{t.lease.extra=true;},
  t=>{t.operations[0].extra=true;},t=>{t.operations.push({...t.operations[3],opId:'duplicate-fence'});t.revision++;t.budget.used++;t.budget.limit++;}
 ]){const t=structuredClone(current);mutate(t);rejects(t);}
 const q=seed();q.state='COMPLETED';rejects(q);
 const c=snapshot(1);c.operations.push({opId:'terminal',kind:'COMPLETED',units:0,fence:1});c.revision++;rejects(c);
});
test('valid snapshots roundtrip at every recovery and terminal boundary',()=>{
 for(let count=0;count<=ops.length;count++){
  const t=snapshot(count);assert.deepEqual(createOfflineStore([t]).snapshot('T'),t);
 }
 for(const outcome of ['COMPLETED','FAILED']){
  const s=createOfflineStore([seed()]);s.claim(claim());assert.equal(s.complete({...finish,outcome}).ok,true);
  const t=s.snapshot('T');assert.deepEqual(createOfflineStore([t]).snapshot('T'),t);
 }
});
test('restore rejects malformed record types, unsafe counters and duplicated IDs',()=>{
 for(const mutate of [
  t=>{t.nextFence=2;},t=>{t.nextFence=Infinity;},t=>{t.budget.used=0;},
  t=>{t.budget.limit=0;},t=>{t.lease.expiresAt=0;},t=>{t.lease.owner='other';},
  t=>{t.operations[0].fence=NaN;},t=>{t.operations[0].units=Number.MAX_SAFE_INTEGER;},
  t=>{t.operations[1].opId=t.operations[0].opId;},t=>{t.operations[0].opId=' ';},
  t=>{delete t.operations[0].fence;},t=>{t.operations[1].kind='constructor';},
  t=>{t.operations[1].kind='FAILED';},t=>{t.operations[1].kind='COMPLETED';},
  t=>{t.head={toString:()=>head};},t=>{t.operations[0]=Object.create(t.operations[0]);}
 ]){const t=structuredClone(snapshot());mutate(t);rejects(t);}
 const q=seed();Object.defineProperty(q,'head',{enumerable:true,get(){throw Error('ACCESSOR_EXECUTED');}});rejects(q);
});
test('unknown prototype keys and malformed arguments reject without throwing or mutation',()=>{
 for(const type of ['constructor','toString','valueOf','__proto__','hasOwnProperty','DELETE',null,{},42]){
  const r=replayRestart([seed()],[{type,args:claim()}]);
  assert.equal(r.results[0].reason,'UNSUPPORTED_OPERATION');assert.deepEqual(r.snapshot,[seed()]);assert.deepEqual(r.audit,[]);
 }
 for(const type of ['CLAIM','MARK_RECOVERY','REQUEUE','COMPLETE'])for(const args of [null,[],42,'text']){
  const r=replayRestart([seed()],[{type,args}]);assert.equal(r.results[0].ok,false);assert.deepEqual(r.snapshot,[seed()]);
 }
 const s=createOfflineStore([seed()]);for(const method of ['claim','markRecovery','reconcileToQueue','complete']){
  assert.equal(s[method](null).reason,'INVALID_OPERATION');assert.equal(s[method]([]).reason,'INVALID_OPERATION');
 }
});
test('lost acknowledgements for every mutation survive snapshot rebuild',()=>{
 for(const {type,args} of [ops[0],ops[1],ops[2],{type:'COMPLETE',args:finish}]){
  const index=type==='COMPLETE'?1:ops.findIndex(op=>op.type===type);
  const pre=type==='COMPLETE'?ops.slice(0,1):ops.slice(0,index);
  const r=replayRestart([seed()],[...pre,{type,args},{type,args}],{crashAfter:pre.length+1});
  assert.equal(r.results.at(-1).reason,'OP_ID_SEEN');assert.equal(r.restarts,1);assert.deepEqual(r.audit,[]);
  assert.equal(r.snapshot[0].operations.length,pre.length+1);
 }
});
test('all mutation methods reject cross-task operation collisions after restore',()=>{
 const owner=createOfflineStore([seed('A')]);owner.claim(claim('global',0,'A'));
 for(const [method,task,args] of [
  ['claim',seed(),claim('global')],['markRecovery',snapshot(1),{...recovery,opId:'global'}],
  ['reconcileToQueue',snapshot(2),{...requeue,opId:'global'}],['complete',snapshot(1),{...finish,opId:'global'}]
 ]){
  const s=createOfflineStore([...owner.snapshotAll(),task]),before=s.snapshotAll();
  assert.equal(s[method](args).reason,'OP_ID_COLLISION');assert.deepEqual(s.snapshotAll(),before);assert.deepEqual(s.audit(),[]);
 }
});
test('recovery, requeue and completion CAS failures are atomic; rejected IDs may retry',()=>{
 const s=createOfflineStore([snapshot(1)]),before=s.snapshotAll();
 assert.equal(s.markRecovery({...recovery,revision:0}).reason,'STALE_REVISION');
 assert.equal(s.markRecovery({...recovery,fence:2}).reason,'STALE_FENCE');
 assert.equal(s.complete({...finish,writer:'other'}).reason,'STALE_FENCE');
 assert.deepEqual(s.snapshotAll(),before);assert.deepEqual(s.audit(),[]);
 assert.equal(s.markRecovery(recovery).ok,true);const pending=s.snapshotAll();
 assert.equal(s.reconcileToQueue({...requeue,revision:1}).reason,'STALE_CAS');
 assert.equal(s.reconcileToQueue({...requeue,fence:2}).reason,'STALE_FENCE');
 assert.equal(s.complete({...finish,revision:2}).reason,'STALE_CAS');assert.deepEqual(s.snapshotAll(),pending);
 assert.equal(s.reconcileToQueue(requeue).ok,true);assert.equal(s.claim(claim('claim2',3)).ok,true);
 const reclaimed=s.snapshotAll();assert.equal(s.complete({...finish,revision:4}).reason,'STALE_FENCE');
 assert.deepEqual(s.snapshotAll(),reclaimed);
});
test('third claim exhausts quota after two explicit recoveries',()=>{
 const s=createOfflineStore([snapshot()]);assert.equal(s.markRecovery({...recovery,revision:4,fence:2,opId:'recover2'}).ok,true);
 assert.equal(s.reconcileToQueue({...requeue,revision:5,fence:2,opId:'requeue2'}).ok,true);
 const restored=createOfflineStore(s.snapshotAll()),before=restored.snapshotAll();
 assert.equal(restored.claim(claim('claim3',6)).reason,'BUDGET_EXHAUSTED');assert.deepEqual(restored.snapshotAll(),before);
});
test('each crash boundary preserves ledger and snapshot; audit is process-local',()=>{
 const reference=replayRestart([seed()],ops);
 for(let crashAfter=0;crashAfter<ops.length;crashAfter++){
  const r=replayRestart([seed()],ops,{crashAfter});assert.deepEqual(r.results,reference.results);assert.deepEqual(r.snapshot,reference.snapshot);
  assert.deepEqual(r.audit,reference.audit.slice(crashAfter));assert.equal(r.restarts,1);
 }
});
test('completion after expiry is advisory until explicit recovery revokes the writer',()=>{
 const s=createOfflineStore([snapshot(1)]);assert.equal(s.inspectExpired('T',999,1,1).action,'RECONCILE_REQUIRED');
 assert.equal(s.complete(finish).ok,true);
 const pending=createOfflineStore([snapshot(2)]);assert.equal(pending.complete({...finish,revision:2}).reason,'STALE_CAS');
});
test('snapshot ordering uses locale-independent code units',()=>{
 const ids=['z','ä','A','a','Z'];assert.deepEqual(createOfflineStore(ids.map(seed)).snapshotAll().map(t=>t.taskId),ids.sort());
});
