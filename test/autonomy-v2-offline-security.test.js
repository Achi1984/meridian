import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';
import {replayRestart} from '../scripts/autonomy-v2-offline-restart.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
const task=(taskId='T')=>({taskId,state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[]});
const claim={taskId:'T',writer:'lead',revision:0,head,base,now:100,ttl:20,opId:'claim'};
const recovery={taskId:'T',revision:1,fence:1,now:120,opId:'recover'};
const requeue={taskId:'T',revision:2,fence:1,opId:'requeue'};
const complete={taskId:'T',revision:1,fence:1,writer:'lead',now:119,opId:'done'};
const cycle=[{type:'CLAIM',args:claim},{type:'MARK_RECOVERY',args:recovery},
  {type:'REQUEUE',args:requeue},{type:'CLAIM',args:{...claim,revision:3,now:121,opId:'claim2'}}];
function states() {
 const s=createOfflineStore([task()]);const queued=s.snapshot('T');
 const claimed=s.claim(claim).task;
 const pending=s.markRecovery(recovery).task;
 const requeued=s.reconcileToQueue(requeue).task;
 const reclaimed=s.claim(cycle[3].args).task;
 return {queued,claimed,pending,requeued,reclaimed};
}

test('Phase-1A: lease expiry never automatically transfers writer',()=>{
 const s=createOfflineStore([task()]);const t=s.claim(claim).task;
 assert.deepEqual(s.inspectExpired('T',121,t.revision,t.lease.fence),{action:'RECONCILE_REQUIRED',fence:1});
 assert.deepEqual(s.snapshot('T'),t);
});
test('Phase-1A: store expiry inspection delegates waiting and expired decisions with caller CAS',()=>{
 const s=createOfflineStore([task()]);const t=s.claim(claim).task;
 assert.deepEqual(s.inspectExpired('T',110,t.revision,t.lease.fence),{action:'NO_ACTION'});
 assert.deepEqual(s.inspectExpired('T',120,t.revision,t.lease.fence),{action:'RECONCILE_REQUIRED',fence:1});
 assert.equal(s.inspectExpired('T',120,0,1).reason,'STALE_REVISION');
 assert.equal(s.inspectExpired('T',120,1,0).reason,'STALE_FENCE');
 assert.equal(s.inspectExpired('T',120).action,'BLOCK');
 assert.deepEqual(s.snapshot('T'),t);
});

const restoreCases={
 'historical fence reuse':t=>{t.nextFence=1;},
 'noninteger fence':t=>{t.operations[0].fence=1.5;},
 'repeated claim fence':t=>{t.operations[3].fence=1;t.lease.fence=1;},
 'decreasing claim fence':t=>{t.operations[0].fence=5;},
 'active lease matches older claim':t=>{t.lease.fence=1;},
 'state does not match ledger':t=>{t.state='RECOVERY_PENDING';},
 'revision does not match ledger':t=>{t.revision=99;},
 'claim charged zero':t=>{t.operations[0].units=0;t.budget.used=1;},
 'claim charged twice':t=>{t.operations[0].units=2;t.budget={limit:3,used:3};},
 'unknown kind':t=>{t.operations[0].kind='IO';},
 'unknown operation field':t=>{t.operations[0].authorized=true;},
 'unknown task field':t=>{t.approved=true;},
 'unknown lease field':t=>{t.lease.approved=true;},
 'unknown budget field':t=>{t.budget.approved=true;},
 'illegal ledger sequence':t=>{t.operations[1].kind='REQUEUE';},
 'wrong nonclaim fence':t=>{t.operations[1].fence=2;},
 'changed active writer':t=>{t.writer='other';t.lease.owner='other';},
 'changed active expiry':t=>{t.lease.expiresAt=999;},
 'recovery before expiry':t=>{t.operations[1].now=119;},
 'sparse ledger':t=>{delete t.operations[1];},
};
for(const [name,mutate] of Object.entries(restoreCases))test(`restore rejects ${name}`,()=>{
 const t=structuredClone(states().reclaimed);mutate(t);
 assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);
});
for(const state of ['RECOVERY_PENDING','COMPLETED','FAILED'])test(`restore rejects ${state} without its ledger transition`,()=>{
 const t=states().claimed;t.state=state;
 if(state!=='RECOVERY_PENDING'){t.writer=null;t.lease=null;}
 assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);
});
test('all reachable states survive JSON snapshot restore and preserve isolation',()=>{
 const snapshots=Object.values(states());
 for(const outcome of ['COMPLETED','FAILED']){
  const s=createOfflineStore([task()]);s.claim(claim);snapshots.push(s.complete({...complete,outcome}).task);
 }
 for(const t of snapshots){
  const s=createOfflineStore(JSON.parse(JSON.stringify([t])));
  assert.deepEqual(s.snapshot('T'),t);
  if(t.operations.length)assert.equal(s.claim(claim).reason,'OP_ID_SEEN');
  t.budget.used=99;assert.notEqual(s.snapshot('T').budget.used,99);
 }
});
for(const now of [undefined,null,-1,100.5,Number.MAX_SAFE_INTEGER+1,99,120,121])test(`completion fails closed at invalid/expired time ${now}`,()=>{
 const s=createOfflineStore([task()]);s.claim(claim);const before=s.snapshotAll();
 assert.equal(s.complete({...complete,now}).ok,false);
 assert.deepEqual(s.snapshotAll(),before);assert.equal(s.audit().length,1);
 // Rejected IDs remain available to retry once corrected.
 assert.equal(s.complete(complete).ok,true);
});
test('expired completion needs explicit recovery and never revives old writer',()=>{
 const s=createOfflineStore([task()]);s.claim(claim);
 assert.equal(s.complete({...complete,now:120}).reason,'LEASE_EXPIRED');
 s.markRecovery(recovery);s.reconcileToQueue(requeue);const second=s.claim(cycle[3].args).task;
 assert.equal(s.complete({...complete,revision:second.revision,now:122}).reason,'STALE_FENCE');
 assert.equal(s.complete({...complete,revision:second.revision,fence:2,now:122}).ok,true);
});
for(const [method,args,prefix] of [
 ['markRecovery',recovery,cycle.slice(0,1)],
 ['reconcileToQueue',requeue,cycle.slice(0,2)],
 ['complete',complete,cycle.slice(0,1)],
])test(`global op collision is atomic for ${method}`,()=>{
 const s=createOfflineStore([task(),task('U')]);s.claim({...claim,taskId:'U',opId:args.opId});
 for(const op of prefix)s[{CLAIM:'claim',MARK_RECOVERY:'markRecovery'}[op.type]](op.args);
 const before=s.snapshotAll(),audit=s.audit();
 assert.equal(s[method](args).reason,'OP_ID_COLLISION');
 assert.deepEqual(s.snapshotAll(),before);assert.deepEqual(s.audit(),audit);
});
for(const crashAfter of [1,2,3,4])test(`restart after operation ${crashAfter} preserves full ledger and higher fence`,()=>{
 const r=replayRestart([task()],[...cycle,{type:'COMPLETE',args:{...complete,revision:4,fence:2,now:122}}],{crashAfter});
 assert.equal(r.restarts,1);assert.equal(r.results.every(x=>x.ok),true);
 assert.equal(r.snapshot[0].state,'COMPLETED');assert.equal(r.snapshot[0].nextFence,3);
 assert.equal(r.audit.length,5);
 assert.deepEqual(createOfflineStore(r.snapshot).snapshotAll(),r.snapshot);
});
for(const [type,args,prefix] of [
 ['MARK_RECOVERY',recovery,cycle.slice(0,2)],
 ['REQUEUE',requeue,cycle.slice(0,3)],
 ['COMPLETE',complete,[cycle[0],{type:'COMPLETE',args:complete}]],
])test(`lost acknowledgement replay after ${type} cannot mutate or charge twice`,()=>{
 const r=replayRestart([task()],[...prefix,{type,args}],{crashAfter:prefix.length});
 assert.equal(r.results.at(-1).reason,'OP_ID_SEEN');assert.equal(r.snapshot[0].budget.used,1);
 assert.equal(r.snapshot[0].operations.length,prefix.length);assert.equal(r.audit.length,prefix.length);
});
test('third claim exhausts quota after two explicit recoveries',()=>{
 const s=createOfflineStore(replayRestart([task()],cycle).snapshot);
 assert.equal(s.markRecovery({...recovery,revision:4,fence:2,now:141,opId:'recover2'}).ok,true);
 assert.equal(s.reconcileToQueue({...requeue,revision:5,fence:2,opId:'queue2'}).ok,true);
 const before=s.snapshotAll();
 assert.equal(s.claim({...claim,revision:6,now:142,opId:'claim3'}).reason,'BUDGET_EXHAUSTED');
 assert.deepEqual(s.snapshotAll(),before);
});
for(const type of ['constructor','toString','valueOf','__proto__','hasOwnProperty',null,[],{}])test(`restart rejects operation name ${JSON.stringify(type)}`,()=>{
 assert.equal(replayRestart([task()],[{type,args:claim}]).results[0].reason,'UNSUPPORTED_OPERATION');
});
for(const args of [null,0,'args',[],true])test(`restart rejects malformed args ${JSON.stringify(args)}`,()=>{
 const r=replayRestart([task()],[{type:'CLAIM',args}]);
 assert.equal(r.results[0].reason,'INVALID_OPERATION');assert.deepEqual(r.snapshot,[task()]);
});
test('snapshot order uses deterministic code-unit sorting',()=>{
 assert.deepEqual(createOfflineStore(['a','Z','ä','A'].map(task)).snapshotAll().map(t=>t.taskId),['A','Z','a','ä']);
});

for(const [method,initial,args,reason] of [
 ['claim','queued',{...claim,head:base},'STALE_CAS'],
 ['claim','queued',{...claim,base:head},'STALE_CAS'],
 ['claim','queued',{...claim,revision:1},'STALE_CAS'],
 ['claim','queued',{...claim,opId:' '},'INVALID_OPERATION'],
 ['markRecovery','claimed',{...recovery,revision:0},'STALE_REVISION'],
 ['markRecovery','claimed',{...recovery,fence:0},'STALE_FENCE'],
 ['markRecovery','claimed',{...recovery,now:119},'WAIT'],
 ['reconcileToQueue','pending',{...requeue,revision:1},'STALE_CAS'],
 ['reconcileToQueue','pending',{...requeue,fence:0},'STALE_FENCE'],
 ['complete','claimed',{...complete,writer:'other'},'STALE_FENCE'],
 ['complete','claimed',{...complete,revision:0},'STALE_CAS'],
 ['complete','claimed',{...complete,outcome:'REQUEUE'},'INVALID_OUTCOME'],
 ['claim','requeued',{...claim,revision:3,now:119,opId:'claim2'},'INVALID_CLAIM'],
])test(`${method} rejects ${reason} without changing state, audit or replay ownership`,()=>{
 const s=createOfflineStore([states()[initial]]),before=s.snapshotAll();
 assert.equal(s[method](args).reason,reason);
 assert.deepEqual(s.snapshotAll(),before);assert.deepEqual(s.audit(),[]);
});
for(const method of ['claim','markRecovery','reconcileToQueue','complete'])test(`${method} rejects null and array args`,()=>{
 const s=createOfflineStore([task()]);
 for(const args of [null,[],false])assert.equal(s[method](args).reason,'INVALID_OPERATION');
 assert.deepEqual(s.snapshotAll(),[task()]);
});
for(const change of [
 t=>{t.operations[1].kind='FAILED';},
 t=>{t.operations[1].now=120;},
 t=>{t.operations[1].units=1;t.budget.used=2;},
 t=>{t.operations.push({...t.operations[0],opId:'later'});t.revision++;},
])test('restore rejects altered terminal ledger',()=>{
 const s=createOfflineStore([task()]);s.claim(claim);s.complete(complete);
 const t=s.snapshot('T');change(t);
 assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);
});
