import test from 'node:test';
import assert from 'node:assert/strict';
import {reserve,settle,RESERVE_SQL,SETTLE_SQL} from '../scripts/publication-ledger.mjs';
const binding=()=>({operationKey:'a'.repeat(64),intentSha256:'b'.repeat(64),bodySha256:'c'.repeat(64),runId:123,runAttempt:1});
const answer=(b,status='RESERVED')=>({rowCount:1,rows:[{operation_key:b.operationKey,intent_sha256:b.intentSha256,status}]});
function poolWith(fn){const calls=[];return {calls,async query(sql,args){calls.push({sql,args});return fn(sql,args);}};}
test('fixed parameterized insert and no action authority even with acknowledgment',async()=>{
 const b=binding(),p=poolWith(()=>answer(b));const r=await reserve(p,b);
 assert.equal(r.outcome,'ACKNOWLEDGED');assert.equal(p.calls.length,1);
 assert.equal(p.calls[0].sql,RESERVE_SQL);assert.deepEqual(p.calls[0].args,Object.values(b));
 assert.match(RESERVE_SQL,/ON CONFLICT \(operation_key\) DO NOTHING/);
 for(const [key,value] of Object.entries(r))if(key!=='outcome')assert.equal(value,false);
});
test('existing operation blocks without retry or read-back promotion',async()=>{
 const p=poolWith(()=>({rowCount:0,rows:[]}));assert.equal((await reserve(p,binding())).outcome,'NOT_ACQUIRED');
 assert.equal(p.calls.length,1);
});
test('lost acknowledgement is uncertain even if simulated write committed',async()=>{
 let committed=false;const p=poolWith(()=>{committed=true;throw new Error('sensitive connection details');});
 const r=await reserve(p,binding());assert.equal(committed,true);assert.equal(r.outcome,'UNCERTAIN');
 assert.equal(JSON.stringify(r).includes('sensitive'),false);assert.equal(p.calls.length,1);
});
test('malformed or mismatched responses are uncertain',async()=>{
 const b=binding();for(const reply of [null,{rows:[]},{rowCount:2,rows:[]},
   {rowCount:1,rows:[{...answer(b).rows[0],intent_sha256:'d'.repeat(64)}]},
   {rowCount:1,rows:[{...answer(b).rows[0],extra:true}]}]){
  const p=poolWith(()=>reply);assert.equal((await reserve(p,b)).outcome,'UNCERTAIN');assert.equal(p.calls.length,1);
 }
});
test('invalid input fails before any database call',async()=>{
 const p=poolWith(()=>assert.fail('must not query'));
 for(const b of [{...binding(),runId:true},{...binding(),runAttempt:2},
   {...binding(),operationKey:"'; DROP TABLE x;"},{...binding(),authorized:true}])
  await assert.rejects(reserve(p,b),/LEDGER_/);
 assert.equal(p.calls.length,0);
});
test('settlement binds exact reservation and never upserts',async()=>{
 const b=binding(),p=poolWith(()=>answer(b,'CONFIRMED'));
 assert.equal((await settle(p,b,'CONFIRMED',456)).outcome,'ACKNOWLEDGED');
 assert.equal(p.calls[0].sql,SETTLE_SQL);assert.deepEqual(p.calls[0].args,[...Object.values(b),'CONFIRMED',456]);
 assert.match(SETTLE_SQL,/AND status='RESERVED'/);assert.doesNotMatch(SETTLE_SQL,/INSERT|UPSERT/);
});
test('failed terminal persistence cannot unlock or claim success',async()=>{
 const p=poolWith(()=>{throw new Error('db unavailable');});
 assert.equal((await settle(p,binding(),'AMBIGUOUS')).outcome,'UNCERTAIN');assert.equal(p.calls.length,1);
 const missing=poolWith(()=>({rowCount:0,rows:[]}));
 assert.equal((await settle(missing,binding(),'CONFIRMED',456)).outcome,'NOT_ACQUIRED');
});
test('invalid terminal transitions rejected before database call',async()=>{
 const p=poolWith(()=>assert.fail('must not query'));
 for(const [state,id] of [['RESERVED',null],['CONFIRMED',null],['CONFIRMED',true],['AMBIGUOUS',123]])
  await assert.rejects(settle(p,binding(),state,id),/LEDGER_SETTLEMENT/);
 assert.equal(p.calls.length,0);
});
test('caller mutation while query is pending cannot alter compared binding',async()=>{
 const b=binding(),original={...b};let finish;
 const p=poolWith(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=reserve(p,b);b.intentSha256='d'.repeat(64);finish(answer(original));
 assert.equal((await pending).outcome,'ACKNOWLEDGED');assert.equal(p.calls[0].args[1],original.intentSha256);
});
