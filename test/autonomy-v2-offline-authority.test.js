import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineTransactionLab} from '../scripts/autonomy-v2-offline-transaction.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
const options={key:'synthetic fixture key authority v1',scope:'authority-fixture'};
const seed=(taskId='T',overrides={})=>({taskId,state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:3,used:0},operations:[],...overrides});
const claim=(extra={})=>({taskId:'T',writer:'alice',revision:0,head,base,now:100,ttl:10,opId:'claim',...extra});
const execute=(lab,writer,type,args)=>writer.execute({type,args,expectedGeneration:lab.authorityState().generation});
const make=(initial=[seed()],extra={})=>createOfflineTransactionLab(initial,{...options,...extra});
const rejectUnchanged=(lab,envelope,reason)=>{
 const before=lab.snapshot(),authority=lab.authorityState();
 const result=lab.restore(envelope);assert.equal(result.ok,false);if(reason)assert.equal(result.reason,reason);
 assert.deepEqual(lab.snapshot(),before);assert.deepEqual(lab.authorityState(),authority);
};

for(const [name,mutate] of [
 ['head',s=>{s.snapshot[0].head='c'.repeat(40);}],
 ['base',s=>{s.snapshot[0].base='c'.repeat(40);}],
 ['budget limit',s=>{s.snapshot[0].budget.limit=10;}],
 ['budget used',s=>{s.snapshot[0].budget.used=0;}],
 ['operation ID',s=>{s.snapshot[0].operations[0].opId='substituted';}],
 ['lease expiry',s=>{s.snapshot[0].lease.expiresAt=1000;}],
 ['writer and lease owner',s=>{s.snapshot[0].writer='bob';s.snapshot[0].lease.owner='bob';}],
 ['revision',s=>{s.snapshot[0].revision=2;}],
 ['next fence',s=>{s.snapshot[0].nextFence=99;}],
 ['authority fence',s=>{s.fences[0].fence=99;}],
 ['generation',s=>{s.generation++;}],
 ['epoch',s=>{s.epoch++;}],
 ['digest',s=>{s.digest='0'.repeat(s.digest.length);}],
 ['MAC',s=>{s.mac='0'.repeat(s.mac.length);}],
])test(`snapshot authentication rejects tampered ${name}`,()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const snapshot=lab.snapshot();mutate(snapshot);rejectUnchanged(lab,snapshot);
});

test('authentic internally coherent old snapshot cannot roll back the independent authority',()=>{
 const lab=make(),old=lab.snapshot(),writer=lab.openWriter('alice');
 assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 rejectUnchanged(lab,old,'SNAPSHOT_ROLLBACK');
 const current=lab.snapshot();assert.equal(lab.restore(current).ok,true);assert.deepEqual(lab.snapshot(),current);
 const fresh=lab.openWriter('alice');assert.equal(execute(lab,fresh,'CLAIM',claim()).reason,'OP_ID_SEEN');
});

test('same-generation authentic state substitution requires the independent trusted digest',()=>{
 const lab=make(),other=make([seed('T',{head:'c'.repeat(40)})]);
 assert.equal(lab.authorityState().generation,other.authorityState().generation);
 rejectUnchanged(lab,other.snapshot(),'SNAPSHOT_ROLLBACK');
});

test('wrong signing key and cross-scope snapshots fail before authority mutation',()=>{
 const lab=make(),wrongKey=make([seed()],{key:'different synthetic fixture key authority v1'}),wrongScope=make([seed()],{scope:'different-fixture'});
 rejectUnchanged(lab,wrongKey.snapshot(),'INVALID_SNAPSHOT_AUTH');
 rejectUnchanged(lab,wrongScope.snapshot(),'SNAPSHOT_SCOPE_MISMATCH');
});

test('restart seals a new epoch and rejects authentic pre-restart snapshots at equal generation',()=>{
 const lab=make(),before=lab.snapshot(),authority=lab.authorityState();
 assert.equal(lab.restart().ok,true);
 assert.equal(lab.authorityState().generation,authority.generation);
 assert.ok(lab.authorityState().epoch>authority.epoch);
 rejectUnchanged(lab,before,'SNAPSHOT_ROLLBACK');
 assert.equal(lab.restore(lab.snapshot()).ok,true);
});

test('the current authentic snapshot restores after serialization without exposing a signer',()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const snapshot=JSON.parse(JSON.stringify(lab.snapshot())),before=lab.snapshot();
 const restored=lab.restore(snapshot);assert.equal(restored.ok,true);assert.deepEqual(lab.snapshot(),before);
 snapshot.snapshot[0].budget.used=99;if(restored.snapshot)restored.snapshot[0].budget.used=99;
 assert.deepEqual(lab.snapshot(),before);
 assert.equal(Object.hasOwn(lab,'sign'),false);assert.equal(Object.hasOwn(lab,'seal'),false);
 assert.equal(Object.hasOwn(before,'key'),false);assert.equal(Object.hasOwn(lab.authorityState(),'key'),false);
});

test('trusted per-task fence survives coordinator restarts and explicit recovery',()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 assert.equal(writer.checkFence({taskId:'T',fence:1}).ok,true);
 const claimed=lab.snapshot();assert.equal(lab.restart().ok,true);
 assert.equal(writer.checkFence({taskId:'T',fence:1}).reason,'STALE_WRITER');
 const fresh=lab.openWriter('alice');assert.equal(fresh.checkFence({taskId:'T',fence:1}).ok,true);
 assert.equal(execute(lab,fresh,'MARK_RECOVERY',{taskId:'T',revision:1,fence:1,now:110,opId:'recover'}).ok,true);
 assert.equal(fresh.checkFence({taskId:'T',fence:1}).ok,false);
 assert.equal(execute(lab,fresh,'REQUEUE',{taskId:'T',revision:2,fence:1,opId:'requeue'}).ok,true);
 assert.equal(execute(lab,fresh,'CLAIM',claim({revision:3,now:111,opId:'claim2'})).ok,true);
 assert.equal(fresh.checkFence({taskId:'T',fence:1}).ok,false);assert.equal(fresh.checkFence({taskId:'T',fence:2}).ok,true);
 assert.deepEqual(lab.authorityState().fences,[{taskId:'T',fence:2}]);
 rejectUnchanged(lab,claimed,'SNAPSHOT_ROLLBACK');
 assert.equal(lab.restart().ok,true);assert.deepEqual(lab.authorityState().fences,[{taskId:'T',fence:2}]);
});

test('fence admission binds current active task, writer capability and external watermark',()=>{
 const lab=make([seed(),seed('U')]),alice=lab.openWriter('alice'),bob=lab.openWriter('bob');
 assert.equal(alice.checkFence({taskId:'T',fence:1}).ok,false);
 assert.equal(execute(lab,alice,'CLAIM',claim()).ok,true);const before=lab.snapshot();
 for(const args of [{taskId:'T',fence:0},{taskId:'T',fence:2},{taskId:'U',fence:1},{taskId:'unknown',fence:1}])assert.equal(alice.checkFence(args).ok,false);
 assert.equal(bob.checkFence({taskId:'T',fence:1}).ok,false);assert.deepEqual(lab.snapshot(),before);
 assert.equal(execute(lab,alice,'COMPLETE',{taskId:'T',revision:1,fence:1,writer:'alice',opId:'done'}).ok,true);
 assert.equal(alice.checkFence({taskId:'T',fence:1}).ok,false);assert.deepEqual(lab.authorityState().fences,[{taskId:'T',fence:1},{taskId:'U',fence:0}]);
});

test('independent task fences advance without weakening another active writer',()=>{
 const lab=make([seed('A'),seed('B')]),alice=lab.openWriter('alice'),bob=lab.openWriter('bob');
 assert.equal(execute(lab,alice,'CLAIM',claim({taskId:'A',opId:'a'})).ok,true);
 assert.equal(execute(lab,bob,'CLAIM',claim({taskId:'B',writer:'bob',opId:'b'})).ok,true);
 assert.equal(alice.checkFence({taskId:'A',fence:1}).ok,true);assert.equal(bob.checkFence({taskId:'B',fence:1}).ok,true);
 assert.deepEqual(lab.authorityState().fences,[{taskId:'A',fence:1},{taskId:'B',fence:1}]);
});

for(const [name,makeArray] of [
 ['sparse',v=>{const a=[v];delete a[0];return a;}],
 ['large sparse',()=>new Array(2**32-1)],
 ['subclass',v=>new(class extends Array {})(v)],
 ['custom prototype',v=>Object.setPrototypeOf([v],Object.create(Array.prototype))],
 ['null prototype',v=>Object.setPrototypeOf([v],null)],
 ['symbol',v=>Object.assign([v],{[Symbol('extra')]:true})],
 ['hidden index',v=>{const a=[v];Object.defineProperty(a,'0',{enumerable:false});return a;}],
 ['named extension',v=>Object.assign([v],{extra:true})],
])for(const field of ['snapshot','fences'])test(`restore ${field} rejects ${name} arrays`,()=>{
 const lab=make(),snapshot=lab.snapshot();snapshot[field]=makeArray(snapshot[field][0]);rejectUnchanged(lab,snapshot);
});

for(const field of ['snapshot','fences','operations'])test(`restore ${field} rejects an own iterator without invocation`,()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const snapshot=lab.snapshot();let calls=0;
 const array=field==='operations'?snapshot.snapshot[0].operations:snapshot[field];
 array[Symbol.iterator]=function*(){calls++;yield {};};
 rejectUnchanged(lab,snapshot);assert.equal(calls,0);
});

for(const boundary of ['envelope','task','budget','ledger operation','fence record','array index'])test(`restore ${boundary} rejects getters without invocation`,()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const snapshot=lab.snapshot();let calls=0;
 const [target,key]=boundary==='envelope'?[snapshot,'mac']:boundary==='task'?[snapshot.snapshot[0],'head']:boundary==='budget'?[snapshot.snapshot[0].budget,'used']:boundary==='ledger operation'?[snapshot.snapshot[0].operations[0],'opId']:boundary==='fence record'?[snapshot.fences[0],'fence']:[snapshot.snapshot,'0'];
 Object.defineProperty(target,key,{enumerable:true,get(){calls++;throw Error('GETTER_EXECUTED');}});
 rejectUnchanged(lab,snapshot);assert.equal(calls,0);
});

for(const boundary of ['envelope','task','budget','ledger operation','fence record'])test(`restore ${boundary} rejects own toJSON without invocation`,()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const snapshot=lab.snapshot();let calls=0;
 const target=boundary==='envelope'?snapshot:boundary==='task'?snapshot.snapshot[0]:boundary==='budget'?snapshot.snapshot[0].budget:boundary==='ledger operation'?snapshot.snapshot[0].operations[0]:snapshot.fences[0];
 target.toJSON=()=>{calls++;return {};};rejectUnchanged(lab,snapshot);assert.equal(calls,0);
});

for(const invalid of [null,[],42,'snapshot',{},Object.create({version:1})])test(`restore malformed envelope ${typeof invalid} is fail-closed`,()=>{
 const lab=make();rejectUnchanged(lab,invalid);
});

test('fence admission rejects accessor records without evaluation or mutation',()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const before=lab.snapshot();let calls=0,args={taskId:'T'};
 Object.defineProperty(args,'fence',{enumerable:true,get(){calls++;return 1;}});
 assert.equal(writer.checkFence(args).ok,false);assert.equal(calls,0);assert.deepEqual(lab.snapshot(),before);
});

test('canonical authentication ignores object insertion order and accepts dense frozen arrays',()=>{
 const lab=make(),writer=lab.openWriter('alice');assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);
 const reorder=value=>{
  if(Array.isArray(value))return Object.freeze(value.map(reorder));
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reorder(value[key])]));
  return value;
 };
 assert.equal(lab.restore(reorder(lab.snapshot())).ok,true);
});

test('null-prototype own-data snapshots preserve authentication and store compatibility',()=>{
 const lab=make();const nullify=value=>{
  if(Array.isArray(value))return value.map(nullify);
  if(value!==null&&typeof value==='object')return Object.assign(Object.create(null),Object.fromEntries(Object.entries(value).map(([key,item])=>[key,nullify(item)])));
  return value;
 };
 assert.equal(lab.restore(nullify(lab.snapshot())).ok,true);
});

for(const [name,mutate] of [
 ['version',s=>{s.version=2;}],['unknown key',s=>{s.extra=true;}],['negative generation',s=>{s.generation=-1;}],
 ['unsafe epoch',s=>{s.epoch=Number.MAX_SAFE_INTEGER+1;}],['nonhex MAC',s=>{s.mac='x'.repeat(64);}],
 ['short MAC',s=>{s.mac='a';}],['short digest',s=>{s.digest='a';}],['symbol field',s=>{s[Symbol('extra')]=true;}],
 ['hidden field',s=>{Object.defineProperty(s,'hidden',{value:true});}],['inherited envelope',s=>Object.create(s)],
 ['cyclic task',s=>{s.snapshot[0].self=s.snapshot[0];}],
])test(`malformed authenticated envelope ${name} rejects atomically`,()=>{
 const lab=make(),snapshot=lab.snapshot(),changed=mutate(snapshot);rejectUnchanged(lab,changed??snapshot);
});

test('invalid authority constructor options reject getters without invocation',()=>{
 let calls=0;const input={scope:'fixture'};
 Object.defineProperty(input,'key',{enumerable:true,get(){calls++;throw Error('GETTER_EXECUTED');}});
 assert.throws(()=>createOfflineTransactionLab([seed()],input),/INVALID_AUTHORITY_OPTIONS/);assert.equal(calls,0);
 for(const invalid of [null,[],{key:'short'},{key:42},{scope:''},{scope:' '},{extra:true}])assert.throws(()=>createOfflineTransactionLab([seed()],invalid),/INVALID_AUTHORITY_OPTIONS/);
});

test('authority bootstrap rejects malformed task arrays, duplicate tasks and global operation IDs',()=>{
 assert.throws(()=>make(new Array(2)),/INVALID_SNAPSHOT/);
 assert.throws(()=>make([seed(),seed()]),/INVALID_TASK_ID/);
 const a=make([seed('A')]),b=make([seed('B')]);
 assert.equal(execute(a,a.openWriter('alice'),'CLAIM',claim({taskId:'A'})).ok,true);
 assert.equal(execute(b,b.openWriter('alice'),'CLAIM',claim({taskId:'B'})).ok,true);
 assert.throws(()=>make([...a.snapshot().snapshot,...b.snapshot().snapshot]),/DUPLICATE_GLOBAL_OP_ID/);
});

test('trusted fixture bootstrap may skip fence values but recovery never reuses a published fence',()=>{
 const lab=make([seed('T',{nextFence:9})]),writer=lab.openWriter('alice');
 assert.equal(execute(lab,writer,'CLAIM',claim()).ok,true);assert.deepEqual(lab.authorityState().fences,[{taskId:'T',fence:9}]);
 assert.equal(execute(lab,writer,'MARK_RECOVERY',{taskId:'T',revision:1,fence:9,now:110,opId:'recover'}).ok,true);
 assert.equal(execute(lab,writer,'REQUEUE',{taskId:'T',revision:2,fence:9,opId:'requeue'}).ok,true);
 assert.equal(execute(lab,writer,'CLAIM',claim({revision:3,opId:'claim2'})).ok,true);assert.deepEqual(lab.authorityState().fences,[{taskId:'T',fence:10}]);
});
