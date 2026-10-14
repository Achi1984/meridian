// Test-only extension for the existing disposable PostgreSQL harness. No runner,
// production connection, POST, or authority to start another database test run.
import assert from 'node:assert/strict';
import {reserveWithReceipt,RESERVE_RECEIPT_SQL} from './publication-reservation-receipt.mjs';
const flags=['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'];
const values=b=>[b.operationKey,b.intentSha256,b.bodySha256,b.runId,b.runAttempt];
const projection=`operation_key,intent_sha256,body_sha256,run_id::text AS run_id,
 run_attempt,status,floor(extract(epoch FROM created_at)*1000)::bigint::text AS reserved_at_ms`;
function inactive(r){for(const key of flags)assert.equal(r[key],false,key);}
function missing(r,outcome){assert.equal(r.outcome,outcome);assert.equal('reservation' in r,false);inactive(r);}
async function release(client){
 if(!client)return;
 try{await client.query('ROLLBACK');}catch{}
 finally{client.release(true);}
}
export async function checkReservationReceipts({admin,app,pool,binding}){
 const checked=[];let receiptPool,timeoutPool,locker,rollback;
 const mark=name=>checked.push(name);
 const read=async n=>(await admin.query(`SELECT ${projection} FROM meridian_publisher.reservations WHERE operation_key=$1`,[binding(n).operationKey])).rows;
 const dbNow=async()=>Number((await admin.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS ms')).rows[0].ms);
 try{
  // Production credentials are not used. This role proves the INSERT does not
  // require permission to supply or update its database-generated created_at.
  await admin.query(`CREATE ROLE receipt_test_role LOGIN PASSWORD 'isolated-receipt-only';
   GRANT USAGE ON SCHEMA meridian_publisher TO receipt_test_role;
   GRANT SELECT ON meridian_publisher.reservations TO receipt_test_role;
   GRANT INSERT(operation_key,intent_sha256,body_sha256,run_id,run_attempt,status)
    ON meridian_publisher.reservations TO receipt_test_role;`);
  receiptPool=pool({user:'receipt_test_role',password:'isolated-receipt-only'});
  const before=await dbNow(),fresh=await reserveWithReceipt(receiptPool,binding(200)),after=await dbNow();
  assert.equal(fresh.outcome,'ACKNOWLEDGED');inactive(fresh);
  assert.deepEqual(fresh.reservation.binding,binding(200));
  assert.ok(Object.isFrozen(fresh.reservation)&&Object.isFrozen(fresh.reservation.binding));
  assert.ok(fresh.reservation.reservedAtMs>=before&&fresh.reservation.reservedAtMs<=after);
  // A separate admin connection can see the row before any caller COMMIT:
  // receiptPool.query has completed its own autocommit statement.
  const committed=await read(200);assert.equal(committed.length,1);
  assert.equal(committed[0].reserved_at_ms,String(fresh.reservation.reservedAtMs));
  assert.equal(committed[0].status,'RESERVED');mark('actual_insert_autocommit_database_time');

  const concurrent=await Promise.all([reserveWithReceipt(receiptPool,binding(201)),reserveWithReceipt(receiptPool,binding(201))]);
  assert.deepEqual(concurrent.map(r=>r.outcome).sort(),['ACKNOWLEDGED','NOT_ACQUIRED']);
  assert.equal(concurrent.filter(r=>'reservation' in r).length,1);
  for(const r of concurrent)inactive(r);
  assert.equal((await read(201)).length,1);mark('concurrent_one_fresh_receipt');

  let lostCalls=0;
  const lost=await reserveWithReceipt({query:async(...args)=>{lostCalls++;await receiptPool.query(...args);throw Error('SIMULATED_LOST_ACK');}},binding(202));
  missing(lost,'UNCERTAIN');assert.equal(lostCalls,1);
  assert.equal((await read(202)).length,1); // Diagnostic only, never a receipt.
  missing(await reserveWithReceipt(receiptPool,binding(202)),'NOT_ACQUIRED');
  mark('lost_ack_committed_without_reacquisition');

  let tamperedCalls=0;
  const tampered=await reserveWithReceipt({query:async(...args)=>{
   tamperedCalls++;const result=await receiptPool.query(...args);
   return {...result,rows:result.rows.map(row=>({...row,body_sha256:'d'.repeat(64)}))};
  }},binding(203));
  missing(tampered,'UNCERTAIN');assert.equal(tamperedCalls,1);
  assert.equal((await read(203))[0].body_sha256,binding(203).bodySha256);
  missing(await reserveWithReceipt(receiptPool,binding(203)),'NOT_ACQUIRED');
  mark('altered_return_binding_cannot_create_receipt');

  for(const changed of [{...binding(200),bodySha256:'d'.repeat(64)},
   {...binding(200),intentSha256:'e'.repeat(64)},{...binding(200),runId:999}])
   missing(await reserveWithReceipt(receiptPool,changed),'NOT_ACQUIRED');
  assert.deepEqual(await read(200),committed);mark('existing_key_cannot_replace_binding');

  await assert.rejects(receiptPool.query(`INSERT INTO meridian_publisher.reservations
   (operation_key,intent_sha256,body_sha256,run_id,run_attempt,status,created_at)
   VALUES ($1,$2,$3,$4,$5,'RESERVED',clock_timestamp())`,values(binding(206))),e=>e.code==='42501');
  await assert.rejects(receiptPool.query('UPDATE meridian_publisher.reservations SET created_at=clock_timestamp() WHERE operation_key=$1',[binding(200).operationKey]),e=>e.code==='42501');
  assert.deepEqual(await read(200),committed);assert.deepEqual(await read(206),[]);
  mark('least_privilege_prevents_created_at_injection');

  // Hold a real conflicting relation lock. The production-shaped adapter still
  // receives an autocommit pool, NOT the transaction-bound lock-holder client.
  timeoutPool=pool({user:'receipt_test_role',password:'isolated-receipt-only',statement_timeout:100,query_timeout:2000,max:1});
  locker=await admin.connect();await locker.query('BEGIN');
  await locker.query('LOCK TABLE meridian_publisher.reservations IN ACCESS EXCLUSIVE MODE');
  let code,calls=0;
  try{
   const timed=await reserveWithReceipt({query:async(...args)=>{
    calls++;try{return await timeoutPool.query(...args);}catch(error){code=error.code;throw error;}
   }},binding(204));
   missing(timed,'UNCERTAIN');assert.equal(calls,1);assert.equal(code,'57014');
  }finally{await release(locker);locker=null;}
  // Observe cancellation without retrying the reservation or promoting reads.
  assert.deepEqual(await read(204),[]);mark('actual_statement_timeout_no_receipt_no_retry');

  rollback=await app.connect();
  try{
   await rollback.query('BEGIN');await rollback.query(RESERVE_RECEIPT_SQL,values(binding(205)));
   await rollback.query('ROLLBACK');
  }finally{await release(rollback);rollback=null;}
  // Raw RETURNING within a transaction is deliberately never labelled an ACK.
  assert.deepEqual(await read(205),[]);mark('raw_transaction_returning_is_not_autocommit_receipt');

  const rows=[];for(const n of [200,201,202,203])rows.push(...await read(n));
  assert.equal(rows.length,4);
  return {checks:checked.length,checked,restartRows:rows};
 }finally{
  try{await release(locker);}finally{
   try{await release(rollback);}finally{await Promise.allSettled([receiptPool?.end(),timeoutPool?.end()]);}
  }
 }
}
export async function checkReservationReceiptRestart(admin,app,binding,state){
 const rows=(await admin.query(`SELECT ${projection} FROM meridian_publisher.reservations
  WHERE operation_key >= $1 AND operation_key <= $2 ORDER BY operation_key`,
 [binding(200).operationKey,binding(206).operationKey])).rows;
 assert.deepEqual(rows,state.restartRows);
 for(const n of [200,201,202,203])missing(await reserveWithReceipt(app,binding(n)),'NOT_ACQUIRED');
 // Persisted database evidence after restart cannot mint a fresh send receipt.
 return 1;
}
