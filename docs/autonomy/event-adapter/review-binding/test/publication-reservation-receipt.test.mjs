import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveWithReceipt,RESERVE_RECEIPT_SQL} from '../scripts/publication-reservation-receipt.mjs';
const binding=()=>({operationKey:'a'.repeat(64),intentSha256:'b'.repeat(64),bodySha256:'c'.repeat(64),runId:123,runAttempt:1});
const answer=(b=binding())=>({rowCount:1,rows:[{operation_key:b.operationKey,intent_sha256:b.intentSha256,
 body_sha256:b.bodySha256,run_id:String(b.runId),run_attempt:b.runAttempt,status:'RESERVED',reserved_at_ms:'1791957600123'}]});
function poolWith(fn){const calls=[];return {calls,async query(sql,args){calls.push({sql,args});return fn(sql,args);}};}
function noAuthority(result){
 for(const k of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'])
  assert.equal(result[k],false,k);
}
test('fresh INSERT ACK returns frozen exact binding and database timestamp only',async()=>{
 const b=binding(),pool=poolWith(()=>answer(b)),r=await reserveWithReceipt(pool,b);
 assert.equal(r.outcome,'ACKNOWLEDGED');noAuthority(r);
 assert.deepEqual(r.reservation,{binding:b,reservedAtMs:1791957600123});
 assert.notEqual(r.reservation.binding,b);assert.ok(Object.isFrozen(r.reservation));
 assert.ok(Object.isFrozen(r.reservation.binding));
 assert.deepEqual(pool.calls,[{sql:RESERVE_RECEIPT_SQL,args:Object.values(b)}]);
 assert.match(RESERVE_RECEIPT_SQL,/ON CONFLICT \(operation_key\) DO NOTHING/);
 assert.match(RESERVE_RECEIPT_SQL,/floor\(extract\(epoch FROM created_at\)\*1000\)::bigint::text AS reserved_at_ms/);
 assert.doesNotMatch(RESERVE_RECEIPT_SQL,/SELECT|UPDATE/);
});
test('existing reservation returns no receipt and cannot be promoted by readback',async()=>{
 const pool=poolWith(()=>({rowCount:0,rows:[]})),r=await reserveWithReceipt(pool,binding());
 assert.equal(r.outcome,'NOT_ACQUIRED');assert.equal('reservation' in r,false);noAuthority(r);
 assert.equal(pool.calls.length,1);
});
test('lost acknowledgement and restart conflict never recover a receipt',async()=>{
 let committed=false;
 const pool=poolWith(()=>{if(committed)return {rowCount:0,rows:[]};committed=true;throw Error('secret connection data');});
 const lost=await reserveWithReceipt(pool,binding());
 assert.equal(lost.outcome,'UNCERTAIN');assert.equal('reservation' in lost,false);noAuthority(lost);
 assert.equal(pool.calls.length,1);assert.equal(JSON.stringify(lost).includes('secret'),false);
 const restart=await reserveWithReceipt(pool,binding());
 assert.equal(restart.outcome,'NOT_ACQUIRED');assert.equal('reservation' in restart,false);
 assert.equal(pool.calls.length,2);
});
test('concurrent exact reservations receive exactly one fresh receipt',async()=>{
 let committed=false;
 const pool=poolWith(()=>{if(committed)return {rowCount:0,rows:[]};committed=true;return answer();});
 const results=await Promise.all([reserveWithReceipt(pool,binding()),reserveWithReceipt(pool,binding())]);
 assert.deepEqual(results.map(r=>r.outcome).sort(),['ACKNOWLEDGED','NOT_ACQUIRED']);
 assert.equal(results.filter(r=>'reservation' in r).length,1);assert.equal(pool.calls.length,2);
});
test('invalid bindings fail before a database query',async()=>{
 const pool=poolWith(()=>assert.fail('query must not run'));
 for(const b of [null,[],{...binding(),extra:1},{...binding(),operationKey:'z'.repeat(64)},
  {...binding(),intentSha256:123},{...binding(),bodySha256:'A'.repeat(64)},
  {...binding(),runId:0},{...binding(),runId:true},{...binding(),runId:'123'},
  {...binding(),runId:Number.MAX_SAFE_INTEGER+1},{...binding(),runAttempt:2},Object.create(binding())])
  await assert.rejects(reserveWithReceipt(pool,b),/RESERVATION_RECEIPT_REJECTED/);
 assert.equal(pool.calls.length,0);
});
test('mismatched binding, status, and exact row schema yield uncertainty without receipt',async()=>{
 const base=answer().rows[0];
 const rows=[null,[],Object.create(base),{...base,extra:1},
  Object.fromEntries(Object.entries(base).filter(([k])=>k!=='reserved_at_ms')),
  {...base,operation_key:'d'.repeat(64)},{...base,intent_sha256:'d'.repeat(64)},
  {...base,body_sha256:'d'.repeat(64)},{...base,run_id:'124'},{...base,run_attempt:2},
  {...base,run_attempt:'1'},{...base,status:'CONFIRMED'}];
 for(const row of rows){
  const pool=poolWith(()=>({rowCount:1,rows:[row]})),r=await reserveWithReceipt(pool,binding());
  assert.equal(r.outcome,'UNCERTAIN');assert.equal('reservation' in r,false);noAuthority(r);
  assert.equal(pool.calls.length,1);
 }
});
test('malformed result counts and rows are uncertain',async()=>{
 for(const result of [null,{}, {rowCount:'1',rows:answer().rows},{rowCount:1,rows:[]},
  {rowCount:0,rows:answer().rows},{rowCount:2,rows:[...answer().rows,...answer().rows]},
  {rowCount:0,rows:null},{rowCount:-1,rows:[]}]){
  const pool=poolWith(()=>result),r=await reserveWithReceipt(pool,binding());
  assert.equal(r.outcome,'UNCERTAIN');assert.equal('reservation' in r,false);assert.equal(pool.calls.length,1);
 }
});
test('canonical integer strings required for run ID and database time',async()=>{
 for(const key of ['run_id','reserved_at_ms'])for(const value of [null,123,0,true,'0','-1','01','1.0','1e3',' 123','123 ',
  'NaN','Infinity','9007199254740992','12345678901234567']){
  const pool=poolWith(()=>({rowCount:1,rows:[{...answer().rows[0],[key]:value}]}));
  const r=await reserveWithReceipt(pool,binding());assert.equal(r.outcome,'UNCERTAIN');assert.equal('reservation' in r,false);
 }
 for(const value of ['8640000000000001','9007199254740991']){
  const pool=poolWith(()=>({rowCount:1,rows:[{...answer().rows[0],reserved_at_ms:value}]}));
  assert.equal((await reserveWithReceipt(pool,binding())).outcome,'UNCERTAIN');
 }
});
test('safe integer and representable timestamp boundaries are accepted as data, not freshness proof',async()=>{
 const b={...binding(),runId:Number.MAX_SAFE_INTEGER};
 for(const time of ['1','8640000000000000']){
  const pool=poolWith(()=>({rowCount:1,rows:[{...answer(b).rows[0],reserved_at_ms:time}]}));
  const r=await reserveWithReceipt(pool,b);assert.equal(r.outcome,'ACKNOWLEDGED');
  assert.equal(r.reservation.reservedAtMs,Number(time));noAuthority(r);
 }
});
test('binding mutation during query cannot change validated receipt or SQL arguments',async()=>{
 const b=binding(),original={...b};let finish;
 const pool=poolWith(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=reserveWithReceipt(pool,b);b.operationKey='d'.repeat(64);b.runId=999;
 finish(answer(original));const r=await pending;
 assert.equal(r.outcome,'ACKNOWLEDGED');assert.deepEqual(r.reservation.binding,original);
 assert.deepEqual(pool.calls[0].args,Object.values(original));
});
test('host query timeout remains uncertain even when the simulated database commits later',async()=>{
 let commit;let committed=false;
 const lateCommit=new Promise(resolve=>{commit=()=>{committed=true;resolve(answer());};});
 const pool=poolWith(()=>Promise.race([lateCommit,Promise.reject(Error('HOST_WRITE_TIMEOUT'))]));
 const result=await reserveWithReceipt(pool,binding());assert.equal(result.outcome,'UNCERTAIN');
 commit();await lateCommit;assert.equal(committed,true);assert.equal('reservation' in result,false);
 assert.equal(pool.calls.length,1);noAuthority(result);
});
