import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineTransactionLab} from '../scripts/autonomy-v2-offline-transaction.mjs';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
const options={key:'synthetic fixture key transaction v1',scope:'transaction-fixture'};
const seed=(taskId='T',overrides={})=>({taskId,state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[],...overrides});
const claim=(extra={})=>({taskId:'T',writer:'alice',revision:0,head,base,now:100,ttl:10,opId:'claim',...extra});
const request=(type,args,expectedGeneration)=>({type,args,expectedGeneration});
const run=(lab,writer,type,args,extra={})=>writer.execute(request(type,args,lab.authorityState().generation),extra);
const snapshots=lab=>lab.snapshot().snapshot;
const crashpoints=['BEFORE_STAGE','AFTER_STAGE','BEFORE_COMMIT','AFTER_COMMIT','BEFORE_ACK'];
const flow=[
 ['CLAIM',claim()],
 ['MARK_RECOVERY',{taskId:'T',revision:1,fence:1,now:110,opId:'recover'}],
 ['REQUEUE',{taskId:'T',revision:2,fence:1,opId:'requeue'}],
 ['CLAIM',claim({revision:3,now:111,opId:'claim2'})],
 ['COMPLETE',{taskId:'T',revision:4,fence:2,writer:'alice',opId:'done'}],
];
function prepared(count=0,initial=[seed()]){
 const lab=createOfflineTransactionLab(initial,options),writer=lab.openWriter('alice');
 for(const [type,args] of flow.slice(0,count))assert.equal(run(lab,writer,type,args).ok,true);
 return {lab,writer};
}
function assertLedger(lab){
 const state=snapshots(lab),rebuilt=createOfflineStore(state);
 assert.deepEqual(rebuilt.snapshotAll(),state);
 const ids=new Set();
 for(const task of state){
  assert.equal(task.revision,task.operations.length);
  assert.equal(task.budget.used,task.operations.filter(op=>op.kind==='CLAIM').length);
  assert.ok(task.budget.used<=task.budget.limit);
  for(const op of task.operations){assert.equal(ids.has(op.opId),false);ids.add(op.opId);}
 }
}

for(let count=0;count<flow.length;count++)for(const crashAt of crashpoints)test(`atomic ${flow[count][0]} at ${crashAt} boundary ${count}`,()=>{
 const {lab,writer}=prepared(count),before=lab.snapshot(),authorityBefore=lab.authorityState();
 const [type,args]=flow[count],operation=request(type,args,authorityBefore.generation);
 const result=writer.execute(operation,{crashAt});
 assert.equal(result.ok,false);assert.equal(result.reason,'SIMULATED_CRASH');assert.equal(result.crashAt,crashAt);
 const committed=crashAt==='AFTER_COMMIT'||crashAt==='BEFORE_ACK';
 assert.equal(result.committed,committed);
 const expected=prepared(count+(committed?1:0)).lab;
 assert.deepEqual(snapshots(lab),snapshots(expected));assertLedger(lab);
 assert.equal(lab.authorityState().generation,authorityBefore.generation+(committed?1:0));
 assert.deepEqual(lab.authorityState().fences,expected.authorityState().fences);
 if(!committed)assert.deepEqual(snapshots(lab),before.snapshot);
 assert.equal(lab.restart().ok,true);
 const restarted=lab.openWriter('alice'),retry=run(lab,restarted,type,args);
 assert.equal(retry.reason,committed?'OP_ID_SEEN':flow[count][0]==='REQUEUE'?'REQUEUED':flow[count][0]==='MARK_RECOVERY'?'RECOVERY_PENDING':flow[count][0]==='COMPLETE'?'COMPLETED':'CLAIMED');
 assert.deepEqual(snapshots(lab),snapshots(prepared(count+1).lab));assertLedger(lab);
});

test('interleaved writers stage the same generation but exactly one commits',()=>{
 const lab=createOfflineTransactionLab([seed()],options),alice=lab.openWriter('alice'),bob=lab.openWriter('bob');
 const generation=lab.authorityState().generation;
 const a=alice.stage(request('CLAIM',claim(),generation));
 const b=bob.stage(request('CLAIM',claim({writer:'bob',opId:'bob-claim'}),generation));
 assert.equal(a.ok,true);assert.equal(b.ok,true);
 assert.equal(alice.commit(a.ticket).ok,true);const before=lab.snapshot();
 assert.equal(bob.commit(b.ticket).ok,false);assert.deepEqual(lab.snapshot(),before);assertLedger(lab);
 assert.equal(snapshots(lab)[0].writer,'alice');assert.equal(snapshots(lab)[0].budget.used,1);
});

test('tickets cannot cross writer capabilities, repeat commit or accept forged payloads',()=>{
 const {lab,writer}=prepared(),other=lab.openWriter('bob');
 const candidate=writer.stage(request('CLAIM',claim(),lab.authorityState().generation));assert.equal(candidate.ok,true);
 const before=lab.snapshot();
 for(const ticket of [null,{},structuredClone(candidate.ticket),{...candidate.ticket},Object.create(candidate.ticket)]){
  assert.equal(writer.commit(ticket).ok,false);assert.deepEqual(lab.snapshot(),before);
 }
 assert.equal(other.commit(candidate.ticket).ok,false);assert.deepEqual(lab.snapshot(),before);
 assert.equal(writer.commit(candidate.ticket).ok,true);const committed=lab.snapshot();
 assert.equal(writer.commit(candidate.ticket).ok,false);assert.deepEqual(lab.snapshot(),committed);
});

test('a coordinator restart invalidates old writers and pre-restart staged tickets',()=>{
 const {lab,writer}=prepared(),candidate=writer.stage(request('CLAIM',claim(),lab.authorityState().generation));
 assert.equal(candidate.ok,true);const before=lab.snapshot(),epoch=lab.authorityState().epoch;
 assert.equal(lab.restart().ok,true);assert.ok(lab.authorityState().epoch>epoch);
 const restarted=lab.snapshot();assert.deepEqual(restarted.snapshot,before.snapshot);
 assert.equal(writer.commit(candidate.ticket).ok,false);
 assert.equal(run(lab,writer,'CLAIM',claim()).ok,false);assert.deepEqual(lab.snapshot(),restarted);
 assert.equal(run(lab,lab.openWriter('alice'),'CLAIM',claim()).ok,true);assertLedger(lab);
});

test('operation IDs stay global across tasks and coordinator restarts',()=>{
 const {lab,writer}=prepared(0,[seed(),seed('U')]);
 assert.equal(run(lab,writer,'CLAIM',claim()).ok,true);const before=lab.snapshot();
 assert.equal(run(lab,writer,'CLAIM',claim()).reason,'OP_ID_SEEN');
 assert.equal(run(lab,writer,'CLAIM',claim({taskId:'U'})).reason,'OP_ID_COLLISION');assert.deepEqual(lab.snapshot(),before);
 assert.equal(lab.restart().ok,true);const fresh=lab.openWriter('alice'),restored=lab.snapshot();
 assert.equal(run(lab,fresh,'CLAIM',claim()).reason,'OP_ID_SEEN');
 assert.equal(run(lab,fresh,'CLAIM',claim({taskId:'U'})).reason,'OP_ID_COLLISION');assert.deepEqual(lab.snapshot(),restored);assertLedger(lab);
});

test('each accepted recovery operation remains replay-protected after restart',()=>{
 const {lab}=prepared(flow.length);assert.equal(lab.restart().ok,true);const writer=lab.openWriter('alice'),before=lab.snapshot();
 for(const [type,args] of flow)assert.equal(run(lab,writer,type,args).reason,'OP_ID_SEEN');
 assert.deepEqual(lab.snapshot(),before);assertLedger(lab);
});

test('stale head/base/revision/generation and unknown task leave IDs and budget untouched',()=>{
 const {lab,writer}=prepared();
 for(const change of [{head:'c'.repeat(40)},{base:'c'.repeat(40)},{revision:1},{taskId:'absent'}]){
  const before=lab.snapshot();assert.equal(run(lab,writer,'CLAIM',claim(change)).ok,false);assert.deepEqual(lab.snapshot(),before);
 }
 const before=lab.snapshot();
 assert.equal(writer.execute(request('CLAIM',claim(),lab.authorityState().generation+1)).ok,false);assert.deepEqual(lab.snapshot(),before);
 assert.equal(run(lab,writer,'CLAIM',claim()).ok,true);assertLedger(lab);
});

test('recovery and completion reject stale owner, lease fence, revision and early expiry',()=>{
 const {lab,writer}=prepared(1),before=lab.snapshot();
 const attempts=[
 ['COMPLETE',{taskId:'T',revision:1,fence:0,writer:'alice',opId:'attempt'}],
 ['COMPLETE',{taskId:'T',revision:1,fence:1,writer:'bob',opId:'attempt'}],
 ['COMPLETE',{taskId:'T',revision:0,fence:1,writer:'alice',opId:'attempt'}],
 ['MARK_RECOVERY',{taskId:'T',revision:1,fence:1,now:109,opId:'attempt'}],
 ['MARK_RECOVERY',{taskId:'T',revision:1,fence:2,now:110,opId:'attempt'}],
 ];
 for(const [type,args] of attempts){assert.equal(run(lab,writer,type,args).ok,false);assert.deepEqual(lab.snapshot(),before);}
 assert.equal(run(lab,writer,'MARK_RECOVERY',{...flow[1][1],opId:'attempt'}).ok,true);
 const pending=lab.snapshot();assert.equal(run(lab,writer,'COMPLETE',{taskId:'T',revision:2,fence:1,writer:'alice',opId:'blocked'}).ok,false);assert.deepEqual(lab.snapshot(),pending);
 assertLedger(lab);
});

test('quota stays exhausted after recovery, restore and a lost acknowledgement',()=>{
 const {lab,writer}=prepared(4);
 assert.equal(run(lab,writer,'MARK_RECOVERY',{taskId:'T',revision:4,fence:2,now:121,opId:'recover2'}).ok,true);
 assert.equal(run(lab,writer,'REQUEUE',{taskId:'T',revision:5,fence:2,opId:'requeue2'}).ok,true);
 assert.equal(lab.restart().ok,true);const fresh=lab.openWriter('alice'),before=lab.snapshot();
 assert.equal(run(lab,fresh,'CLAIM',claim({revision:6,now:122,opId:'claim3'})).reason,'BUDGET_EXHAUSTED');
 assert.deepEqual(lab.snapshot(),before);assert.equal(snapshots(lab)[0].budget.used,2);assertLedger(lab);
});

test('safe integer fence and lease arithmetic exhaustion reject without mutation',()=>{
 for(const task of [seed('T',{nextFence:Number.MAX_SAFE_INTEGER}),seed()]){
  const lab=createOfflineTransactionLab([task],options),writer=lab.openWriter('alice'),before=lab.snapshot();
  const args=task.nextFence===Number.MAX_SAFE_INTEGER?claim():claim({now:Number.MAX_SAFE_INTEGER,ttl:1});
  assert.equal(run(lab,writer,'CLAIM',args).ok,false);assert.deepEqual(lab.snapshot(),before);assertLedger(lab);
 }
});

for(const type of ['constructor','toString','valueOf','__proto__','hasOwnProperty','DELETE',null,{},42])test(`unknown operation ${String(type)} cannot mutate authority`,()=>{
 const {lab,writer}=prepared(),before=lab.snapshot();assert.equal(run(lab,writer,type,claim()).ok,false);assert.deepEqual(lab.snapshot(),before);assertLedger(lab);
});

for(const [name,make] of [
 ['null',()=>null],['array',()=>[]],['primitive',()=>42],['inherited',v=>Object.create(v)],
 ['symbol',v=>Object.assign(v,{[Symbol('extra')]:true})],['hidden',v=>{Object.defineProperty(v,'hidden',{value:true});return v;}],
 ['extension',v=>Object.assign(v,{extra:true})],
])test(`transaction request rejects ${name} without state change`,()=>{
 const {lab,writer}=prepared(),before=lab.snapshot();const invalid=make(request('CLAIM',claim(),lab.authorityState().generation));
 assert.equal(writer.execute(invalid).ok,false);assert.deepEqual(lab.snapshot(),before);
});

for(const boundary of ['request','args','options'])test(`${boundary} getter is rejected without invocation`,()=>{
 const {lab,writer}=prepared(),before=lab.snapshot();let calls=0;
 const operation=request('CLAIM',claim(),lab.authorityState().generation),options={};
 const target=boundary==='request'?operation:boundary==='args'?operation.args:options;
 Object.defineProperty(target,boundary==='request'?'type':boundary==='args'?'taskId':'crashAt',{enumerable:true,get(){calls++;throw Error('GETTER_EXECUTED');}});
 assert.equal(writer.execute(operation,options).ok,false);assert.equal(calls,0);assert.deepEqual(lab.snapshot(),before);
});

test('returned task, signed snapshot and authority data cannot alias authoritative state',()=>{
 const {lab,writer}=prepared(),result=run(lab,writer,'CLAIM',claim()),before=lab.snapshot();
 result.task.budget.used=99;result.task.operations[0].opId='changed';
 const snapshot=lab.snapshot();snapshot.snapshot[0].budget.used=99;snapshot.fences[0].fence=99;
 const authority=lab.authorityState();authority.fences[0].fence=99;
 assert.deepEqual(lab.snapshot(),before);assertLedger(lab);
});

const multitaskFlow=flow.flatMap(([type,args],index)=>[
 [type,args],
 [type,{...args,taskId:'U',opId:`u-${args.opId}`,...(Object.hasOwn(args,'writer')?{writer:'bob'}:{})}],
]);
function multiPrepared(count){
 const lab=createOfflineTransactionLab([seed(),seed('U')],options);
 for(const [type,args] of multitaskFlow.slice(0,count))assert.equal(run(lab,lab.openWriter(args.writer??'alice'),type,args).ok,true);
 return lab;
}
for(let count=0;count<multitaskFlow.length;count++)for(const crashAt of crashpoints)test(`cross-task atomic boundary ${count} at ${crashAt}`,()=>{
 const lab=multiPrepared(count),[type,args]=multitaskFlow[count],writer=lab.openWriter(args.writer??'alice');
 const committed=crashAt==='AFTER_COMMIT'||crashAt==='BEFORE_ACK';
 const result=run(lab,writer,type,args,{crashAt});assert.equal(result.reason,'SIMULATED_CRASH');assert.equal(result.committed,committed);
 const expected=multiPrepared(count+(committed?1:0));
 assert.deepEqual(snapshots(lab),snapshots(expected));assert.deepEqual(lab.authorityState().fences,expected.authorityState().fences);assertLedger(lab);
 const fresh=lab.openWriter(args.writer??'alice'),retry=run(lab,fresh,type,args);
 assert.equal(retry.ok,!committed);if(committed)assert.equal(retry.reason,'OP_ID_SEEN');
 assert.deepEqual(snapshots(lab),snapshots(multiPrepared(count+1)));assertLedger(lab);
 const otherTask=args.taskId==='T'?'U':'T',before=lab.snapshot();
 assert.equal(run(lab,fresh,type,{...args,taskId:otherTask}).reason,'OP_ID_COLLISION');assert.deepEqual(lab.snapshot(),before);
});

test('stage captures request values so later caller mutations cannot alter a transaction',()=>{
 const {lab,writer}=prepared(),args=claim(),operation=request('CLAIM',args,lab.authorityState().generation);
 const staged=writer.stage(operation);assert.equal(staged.ok,true);
 args.opId='mutated';args.writer='bob';args.now=0;operation.expectedGeneration=99;operation.type='DELETE';
 assert.equal(writer.commit(staged.ticket).ok,true);
 const task=snapshots(lab)[0];assert.equal(task.writer,'alice');assert.equal(task.operations[0].opId,'claim');assert.equal(task.lease.expiresAt,110);assertLedger(lab);
});

test('null-prototype own-data request and arguments remain supported',()=>{
 const {lab,writer}=prepared(),args=Object.assign(Object.create(null),claim());
 const operation=Object.assign(Object.create(null),request('CLAIM',args,lab.authorityState().generation));
 assert.equal(writer.execute(operation,Object.create(null)).ok,true);assertLedger(lab);
});

for(const args of [null,[],42,'text',Object.create(claim())])test(`invalid transaction argument type ${typeof args} cannot consume IDs`,()=>{
 const {lab,writer}=prepared(),before=lab.snapshot();assert.equal(run(lab,writer,'CLAIM',args).ok,false);assert.deepEqual(lab.snapshot(),before);
 assert.equal(run(lab,writer,'CLAIM',claim()).ok,true);
});

for(const crashOptions of [null,[],42,{crashAt:'UNKNOWN'},{crashAt:null},{crashAt:'AFTER_COMMIT',extra:true}])test(`invalid crash configuration ${JSON.stringify(crashOptions)} is rejected before staging`,()=>{
 const {lab,writer}=prepared(),before=lab.snapshot();assert.equal(run(lab,writer,'CLAIM',claim(),crashOptions).ok,false);assert.deepEqual(lab.snapshot(),before);
 assert.equal(run(lab,writer,'CLAIM',claim()).ok,true);
});

test('FAILED completion is zero-cost, terminal and replay-safe after a committed crash',()=>{
 const {lab,writer}=prepared(1),args={taskId:'T',revision:1,fence:1,writer:'alice',opId:'failed',outcome:'FAILED'};
 assert.equal(run(lab,writer,'COMPLETE',args,{crashAt:'AFTER_COMMIT'}).committed,true);
 const task=snapshots(lab)[0];assert.equal(task.state,'FAILED');assert.equal(task.budget.used,1);assert.equal(task.operations.at(-1).units,0);
 assert.equal(run(lab,lab.openWriter('alice'),'COMPLETE',args).reason,'OP_ID_SEEN');assertLedger(lab);
});

test('completion after advisory expiry remains possible until explicit recovery',()=>{
 const {lab,writer}=prepared(1);
 assert.equal(run(lab,writer,'MARK_RECOVERY',{taskId:'T',revision:1,fence:1,now:109,opId:'too-early'}).ok,false);
 assert.equal(run(lab,writer,'COMPLETE',{taskId:'T',revision:1,fence:1,writer:'alice',opId:'done'}).ok,true);assertLedger(lab);
});
