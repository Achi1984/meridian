import test from 'node:test';
import assert from 'node:assert/strict';
import {retainSendRecord,createSendRecordReader,RETAIN_SQL,READ_SQL} from '../scripts/publication-send-record.mjs';
const binding=()=>({operationKey:'a'.repeat(64),intentSha256:'b'.repeat(64),bodySha256:'c'.repeat(64),runId:42,runAttempt:1});
const row=()=>({operation_key:'a'.repeat(64),intent_sha256:'b'.repeat(64),body_sha256:'c'.repeat(64),run_id:'42',run_attempt:1,comment_id:'3333'});
test('retain performs one parameterized write and validates returned identity',async()=>{
 let calls=0;const pool={query:async(sql,args)=>{calls++;assert.equal(sql,RETAIN_SQL);
 assert.deepEqual(args,[...Object.values(binding()),3333]);return {rowCount:1,rows:[{operation_key:args[0],comment_id:'3333'}]};}};
 const r=await retainSendRecord(pool,binding(),3333);assert.equal(r.outcome,'ACKNOWLEDGED');assert.equal(calls,1);
 for(const k of ['authenticated','provenanceVerified','authorized','durable','sendAllowed'])assert.equal(r[k],false);
});
test('conflict lost reply or malformed acknowledgment never retries',async()=>{
 for(const result of [null,{rowCount:0,rows:[]},{rowCount:1,rows:[{operation_key:'wrong',comment_id:'3333'}]},
 {rowCount:1,rows:[{operation_key:binding().operationKey,comment_id:'03333'}]}]){
 let calls=0;const r=await retainSendRecord({query:async()=>{calls++;if(result===null)throw Error('private');return result;}},binding(),3333);
 assert.equal(r.outcome,result?.rowCount===0?'NOT_ACQUIRED':'UNCERTAIN');assert.equal(calls,1);}
});
test('invalid write identity is rejected before database access',async()=>{
 const pool={query:()=>assert.fail('must not query')};
 for(const id of [0,-1,true,'3333',Number.MAX_SAFE_INTEGER+1])await assert.rejects(retainSendRecord(pool,binding(),id),/REJECTED/);
 for(const b of [{...binding(),extra:1},{...binding(),runId:'42'},{...binding(),runAttempt:2},{...binding(),operationKey:'bad'}])
 await assert.rejects(retainSendRecord(pool,b,3333),/REJECTED/);
});
test('reader maps exact database integers into service record and snapshots lookup',async()=>{
 const b=binding();let calls=0;const read=createSendRecordReader({query:async(sql,args)=>{
 calls++;assert.equal(sql,READ_SQL);assert.deepEqual(args,Object.values(binding()));b.runId=99;
 return {rowCount:1,rows:[row()]};}});
 assert.deepEqual(await read(b),{...binding(),commentId:3333});assert.equal(calls,1);
});
test('missing record returns null while malformed or substituted records reject',async()=>{
 assert.equal(await createSendRecordReader({query:async()=>({rowCount:0,rows:[]})})(binding()),null);
 for(const edit of [r=>r.run_id='43',r=>r.run_id=42,r=>r.comment_id='9007199254740992',
 r=>r.comment_id='03333',r=>r.run_attempt='1',r=>r.body_sha256='d'.repeat(64),r=>r.extra=true]){
 const r=row();edit(r);await assert.rejects(createSendRecordReader({query:async()=>({rowCount:1,rows:[r]})})(binding()),/REJECTED/);}
 await assert.rejects(createSendRecordReader({query:async()=>({rowCount:2,rows:[row(),row()]})})(binding()),/REJECTED/);
});
test('reader abort rejects without retry and pre-abort does not query',async()=>{
 const abort=new AbortController();abort.abort();let calls=0;
 const read=createSendRecordReader({query:async()=>{calls++;return {rowCount:0,rows:[]};}});
 await assert.rejects(read(binding(),abort.signal),/REJECTED/);assert.equal(calls,0);
 const active=new AbortController();
 await assert.rejects(createSendRecordReader({query:()=>{calls++;queueMicrotask(()=>active.abort());return new Promise(()=>{});}})(binding(),active.signal),/REJECTED/);
 assert.equal(calls,1);
});
test('reader deadline bounds stalled database work without claiming cancellation',async()=>{
 let calls=0;const start=Date.now();
 await assert.rejects(createSendRecordReader({query:()=>{calls++;return new Promise(()=>{});}})(binding()),/REJECTED/);
 assert.equal(calls,1);assert.ok(Date.now()-start<6500);
});
