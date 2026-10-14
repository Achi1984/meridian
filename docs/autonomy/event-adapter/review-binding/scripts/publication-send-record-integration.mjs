// Test-only extension for the disposable PostgreSQL harness. No standalone runner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {reserve,settle,SETTLE_SQL} from './publication-ledger.mjs';
import {retainSendRecord,createSendRecordReader,RETAIN_SQL} from './publication-send-record.mjs';
export async function checkSendRecords({admin,app,pool,binding}){
 let checks=0,sender,reader;
 const release=async client=>{
  if(!client)return;
  try{await client.query('ROLLBACK');}catch{}
  finally{client.release(true);}
 };
 const denied=async(p,sql,code,args=[])=>{await assert.rejects(p.query(sql,args),e=>e.code===code);checks++;};
 const blocked=async pid=>{
  for(let i=0;i<100;i++){
   const r=await admin.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[pid]);
   if(r.rows[0].n>0)return;
   await delay(10);
  }throw Error('EXPECTED_DATABASE_LOCK_NOT_OBSERVED');
 };
 try{
  await admin.query(readFileSync(new URL('../fixtures/publication-send-record.sql',import.meta.url),'utf8'));
  await admin.query(`CREATE ROLE sender_test_role LOGIN PASSWORD 'isolated-sender-only';
   CREATE ROLE reader_test_role LOGIN PASSWORD 'isolated-reader-only';
   GRANT USAGE ON SCHEMA meridian_publisher TO sender_test_role,reader_test_role;
   GRANT SELECT ON meridian_publisher.reservations TO sender_test_role,reader_test_role;
   GRANT UPDATE(created_at) ON meridian_publisher.reservations TO sender_test_role;
   GRANT SELECT,INSERT ON meridian_publisher.send_records TO sender_test_role;
   GRANT SELECT ON meridian_publisher.send_records TO reader_test_role;`);
  sender=pool({user:'sender_test_role',password:'isolated-sender-only'});
  reader=pool({user:'reader_test_role',password:'isolated-reader-only'});
  const read=createSendRecordReader(reader);
  for(let n=100;n<=107;n++)assert.equal((await reserve(app,binding(n))).outcome,'ACKNOWLEDGED');
  const results=await Promise.all([retainSendRecord(sender,binding(100),9100),retainSendRecord(sender,binding(100),9101)]);
  assert.deepEqual(results.map(r=>r.outcome).sort(),['ACKNOWLEDGED','NOT_ACQUIRED']);
  const first=await read(binding(100));assert.ok([9100,9101].includes(first.commentId));checks++;
  assert.equal((await retainSendRecord(sender,binding(101),first.commentId)).outcome,'NOT_ACQUIRED');
  assert.equal(await read(binding(101)),null);checks++;
  const lost=await retainSendRecord({query:async(...args)=>{await sender.query(...args);throw Error('LOST_ACK');}},binding(101),9201);
  assert.equal(lost.outcome,'UNCERTAIN');assert.equal((await read(binding(101))).commentId,9201);
  assert.equal((await retainSendRecord(sender,binding(101),9201)).outcome,'NOT_ACQUIRED');checks++;
  assert.equal((await retainSendRecord(sender,{...binding(102),runId:999},9202)).outcome,'NOT_ACQUIRED');
  assert.equal(await read(binding(102)),null);checks++;
  await denied(reader,'INSERT INTO meridian_publisher.send_records VALUES ($1,9300,clock_timestamp())','42501',[binding(102).operationKey]);
  await denied(app,'INSERT INTO meridian_publisher.send_records VALUES ($1,9300,clock_timestamp())','42501',[binding(102).operationKey]);
  await denied(sender,'UPDATE meridian_publisher.send_records SET comment_id=9301','42501');
  await denied(sender,'DELETE FROM meridian_publisher.send_records','42501');
  await denied(sender,'TRUNCATE meridian_publisher.send_records','42501');
  await denied(reader,"UPDATE meridian_publisher.reservations SET status='AMBIGUOUS'",'42501');
  await denied(sender,"UPDATE meridian_publisher.reservations SET status='AMBIGUOUS'",'42501');
  await denied(admin,'UPDATE meridian_publisher.send_records SET comment_id=9301','P0001');
  await denied(admin,'DELETE FROM meridian_publisher.send_records','P0001');
  await denied(admin,'TRUNCATE meridian_publisher.send_records','P0001');
  await denied(admin,'INSERT INTO meridian_publisher.send_records(operation_key,comment_id) VALUES ($1,9007199254740992)','23514',[binding(102).operationKey]);
  // Rollback is tested with raw SQL, never represented as an autocommit ACK.
  const rollback=await sender.connect();
  try{await rollback.query('BEGIN');await rollback.query(RETAIN_SQL,[...Object.values(binding(102)),9302]);
   await rollback.query('ROLLBACK');}finally{rollback.release();}
  assert.equal(await read(binding(102)),null);checks++;
  // Terminal update holds the row lock; queued retain must re-evaluate RESERVED.
  let terminal,queued,pending;
  try{
   terminal=await app.connect();queued=await sender.connect();
   await terminal.query('BEGIN');await terminal.query(SETTLE_SQL,[...Object.values(binding(103)),'AMBIGUOUS',null]);
   const pid=(await queued.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   pending=retainSendRecord(queued,binding(103),9303);await blocked(pid);
   await terminal.query('COMMIT');assert.equal((await pending).outcome,'NOT_ACQUIRED');
   assert.equal(await read(binding(103)),null);checks++;
  }finally{
   try{await release(terminal);await pending;}
   finally{await release(queued);}
  }
  // Reverse ordering: retained record commits first, queued settlement follows.
  let retaining,settling,settlement;
  try{
   retaining=await sender.connect();settling=await app.connect();
   await retaining.query('BEGIN');await retaining.query(RETAIN_SQL,[...Object.values(binding(104)),9304]);
   const pid=(await settling.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   settlement=settle(settling,binding(104),'CONFIRMED',9304);await blocked(pid);
   await retaining.query('COMMIT');assert.equal((await settlement).outcome,'ACKNOWLEDGED');
   assert.equal(await read(binding(104)),null);checks++;
  }finally{
   try{await release(retaining);await settlement;}
   finally{await release(settling);}
  }
  return {checks,firstCommentId:first.commentId};
 }finally{await Promise.allSettled([sender?.end(),reader?.end()]);}
}
export async function checkSendRecordRestart(admin,binding,firstCommentId){
 const r=await admin.query('SELECT operation_key,comment_id::text AS comment_id FROM meridian_publisher.send_records ORDER BY operation_key');
 assert.deepEqual(r.rows,[{operation_key:binding(100).operationKey,comment_id:String(firstCommentId)},
  {operation_key:binding(101).operationKey,comment_id:'9201'},
  {operation_key:binding(104).operationKey,comment_id:'9304'}]);
 return 1;
}
