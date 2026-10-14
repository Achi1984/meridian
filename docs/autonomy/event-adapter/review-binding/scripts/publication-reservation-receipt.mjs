// Inactive host-only reservation preparation. No pool, route or credentials.
// Supply a dedicated AUTOCOMMIT pool, never a transaction-bound client. The host
// must bound the query/statement duration; a lost/late ACK never permits sending.
// This receipt is data from this INSERT, not authentication or send authority.
const fields=['operationKey','intentSha256','bodySha256','runId','runAttempt'];
const flags=Object.freeze({authenticated:false,provenanceVerified:false,
 authorized:false,dispatchAllowed:false,mergeAllowed:false,durable:false,sendAllowed:false});
function need(ok){if(!ok)throw new Error('RESERVATION_RECEIPT_REJECTED');}
function snapshot(raw){
 need(raw&&Object.getPrototypeOf(raw)===Object.prototype
  &&Object.keys(raw).sort().join()===[...fields].sort().join());
 const binding=Object.fromEntries(fields.map(k=>[k,raw[k]]));
 for(const k of fields.slice(0,3))need(typeof binding[k]==='string'&&/^[a-f0-9]{64}$/.test(binding[k]));
 need(Number.isSafeInteger(binding.runId)&&binding.runId>0&&binding.runAttempt===1);
 return Object.freeze(binding);
}
function integer(raw,max=Number.MAX_SAFE_INTEGER){
 need(typeof raw==='string'&&/^[1-9][0-9]{0,15}$/.test(raw));
 const value=Number(raw);
 need(Number.isSafeInteger(value)&&value<=max&&String(value)===raw);
 return value;
}
export const RESERVE_RECEIPT_SQL=`INSERT INTO meridian_publisher.reservations
 (operation_key,intent_sha256,body_sha256,run_id,run_attempt,status)
 VALUES ($1,$2,$3,$4,$5,'RESERVED')
 ON CONFLICT (operation_key) DO NOTHING
 RETURNING operation_key,intent_sha256,body_sha256,run_id::text AS run_id,
 run_attempt,status,floor(extract(epoch FROM created_at)*1000)::bigint::text AS reserved_at_ms`;
export async function reserveWithReceipt(pool,rawBinding){
 // Validate and copy before the sole query. Never promote an existing row into
 // a fresh receipt, recover uncertain writes, retry, or release a reservation.
 const binding=snapshot(rawBinding),args=fields.map(k=>binding[k]);
 try{
  const result=await pool.query(RESERVE_RECEIPT_SQL,args);
  need(result&&Array.isArray(result.rows)&&Number.isInteger(result.rowCount)
   &&result.rowCount===result.rows.length&&[0,1].includes(result.rowCount));
  if(result.rowCount===0)return {outcome:'NOT_ACQUIRED',...flags};
  const row=result.rows[0];
  need(row&&Object.getPrototypeOf(row)===Object.prototype
   &&Object.keys(row).sort().join()==='body_sha256,intent_sha256,operation_key,reserved_at_ms,run_attempt,run_id,status');
  const observed={operationKey:row.operation_key,intentSha256:row.intent_sha256,
   bodySha256:row.body_sha256,runId:integer(row.run_id),runAttempt:row.run_attempt};
  need(fields.every(k=>observed[k]===binding[k])&&row.status==='RESERVED');
  // PostgreSQL microseconds are intentionally truncated to integer milliseconds.
  const reservedAtMs=integer(row.reserved_at_ms,8640000000000000);
  return {outcome:'ACKNOWLEDGED',reservation:Object.freeze({binding,reservedAtMs}),...flags};
 }catch{
  // The INSERT may have committed. Never expose DB/connection exception text.
  return {outcome:'UNCERTAIN',...flags};
 }
}
