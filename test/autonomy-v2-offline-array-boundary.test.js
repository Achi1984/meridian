import test from 'node:test';
import assert from 'node:assert/strict';
import {isOfflineDataArray} from '../scripts/autonomy-v2-offline-data.mjs';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';
import {replayRestart} from '../scripts/autonomy-v2-offline-restart.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const queued=(taskId='T')=>({taskId,state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[]});
const claim=(extra={})=>({taskId:'T',writer:'lead',revision:0,head,base,now:10,ttl:10,opId:'claim',...extra});
const active=()=>createOfflineStore([queued()]).claim(claim()).task;
const call={type:'CLAIM',args:claim()};

const malformed=[
 ['sparse',value=>{const a=[value];delete a[0];return a;}],
 ['large sparse',()=>new Array(2**32-1)],
 ['subclass',value=>new (class extends Array {})(value)],
 ['custom prototype',value=>Object.setPrototypeOf([value],Object.create(Array.prototype))],
 ['null prototype',value=>Object.setPrototypeOf([value],null)],
 ['own iterator',value=>{const a=[value];a[Symbol.iterator]=function*(){yield value;};return a;}],
 ['symbol metadata',value=>{const a=[value];a[Symbol('metadata')]=true;return a;}],
 ['named property',value=>Object.assign([value],{metadata:true})],
 ['noncanonical index',value=>Object.assign([value],{'01':value})],
 ['hidden index',value=>{const a=[value];Object.defineProperty(a,'0',{enumerable:false});return a;}],
];
for(const [name,make] of malformed){
 test(`snapshot list rejects ${name}`,()=>assert.throws(()=>createOfflineStore(make(queued())),/INVALID_SNAPSHOT/));
 test(`ledger rejects ${name}`,()=>{const t=active();t.operations=make(t.operations[0]);assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);});
 test(`restart list rejects ${name}`,()=>assert.throws(()=>replayRestart([queued()],make(call)),/INVALID_OPERATIONS/));
}
for(const boundary of ['snapshot','ledger','restart']) test(`${boundary} index getter rejected without execution`,()=>{
 let calls=0;const list=[];Object.defineProperty(list,'0',{enumerable:true,configurable:true,get(){calls++;return boundary==='ledger'?active().operations[0]:boundary==='restart'?call:queued();}});
 if(boundary==='snapshot')assert.throws(()=>createOfflineStore(list),/INVALID_SNAPSHOT/);
 if(boundary==='ledger'){const t=active();t.operations=list;assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);}
 if(boundary==='restart')assert.throws(()=>replayRestart([queued()],list),/INVALID_OPERATIONS/);
 assert.equal(calls,0);
});
test('custom iterator cannot hide a lower restored fence or a consumed operation ID',()=>{
 const t=active();let calls=0;
 t.operations=[{opId:'shadowed',kind:'CLAIM',units:1,fence:9}];
 t.operations[Symbol.iterator]=function*(){calls++;yield {opId:'validated',kind:'CLAIM',units:1,fence:1};};
 assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);assert.equal(calls,0);
});
test('index getter cannot change the ledger between validation, replay-index rebuild and clone',()=>{
 const t=active();let calls=0;const list=[];
 Object.defineProperty(list,'0',{enumerable:true,get(){calls++;return {opId:calls<3?'validated':'shadowed',kind:'CLAIM',units:1,fence:calls<3?1:9};}});
 t.operations=list;assert.throws(()=>createOfflineStore([t]),/INVALID_RESTORED_TASK/);assert.equal(calls,0);
});
test('ordinary dense and frozen arrays pass the own-data boundary',()=>{
 assert.equal(isOfflineDataArray([]),true);assert.equal(isOfflineDataArray(Object.freeze([])),true);
 assert.equal(isOfflineDataArray(Object.freeze([null,1,'value',{}])),true);
 assert.equal(isOfflineDataArray({length:0}),false);
 const t=active();Object.freeze(t.operations);const store=createOfflineStore(Object.freeze([t]));
 assert.deepEqual(store.snapshotAll(),[t]);assert.equal(store.complete({taskId:'T',revision:1,fence:1,writer:'lead',opId:'claim'}).reason,'OP_ID_SEEN');
 const result=replayRestart(Object.freeze([queued()]),Object.freeze([call]),{crashAfter:1});
 assert.equal(result.restarts,1);assert.equal(result.snapshot[0].budget.used,1);assert.deepEqual(result.audit,[]);
});
test('dense null-prototype records still round-trip through ordinary arrays',()=>{
 const t=queued();Object.setPrototypeOf(t,null);Object.setPrototypeOf(t.budget,null);
 const store=createOfflineStore([t]);const claimed=store.claim(claim());assert.equal(claimed.ok,true);
 assert.deepEqual(createOfflineStore(store.snapshotAll()).snapshotAll(),store.snapshotAll());
});
test('ordinary serialized arrays preserve fence monotonicity, global replay IDs and quota across every crash boundary',()=>{
 const operations=[call,
  {type:'MARK_RECOVERY',args:{taskId:'T',revision:1,fence:1,now:20,opId:'recover'}},
  {type:'REQUEUE',args:{taskId:'T',revision:2,fence:1,opId:'requeue'}},
  {type:'CLAIM',args:claim({revision:3,now:21,opId:'claim2'})},
  {type:'COMPLETE',args:{taskId:'T',revision:4,fence:2,writer:'lead',opId:'done'}}];
 const reference=replayRestart([queued()],operations);
 for(let crashAfter=0;crashAfter<=operations.length;crashAfter++){
  const result=replayRestart(JSON.parse(JSON.stringify([queued()])),JSON.parse(JSON.stringify(operations)),{crashAfter});
  assert.equal(result.restarts,1);assert.deepEqual(result.snapshot,reference.snapshot);assert.deepEqual(result.results,reference.results);
  const final=result.snapshot[0];assert.equal(final.nextFence,3);assert.equal(final.budget.used,2);assert.equal(final.revision,5);
  const rebuilt=createOfflineStore(result.snapshot);
  for(const operation of operations){const method={CLAIM:'claim',MARK_RECOVERY:'markRecovery',REQUEUE:'reconcileToQueue',COMPLETE:'complete'}[operation.type];assert.equal(rebuilt[method](operation.args).reason,'OP_ID_SEEN');}
  assert.deepEqual(rebuilt.snapshotAll(),result.snapshot);
 }
});
