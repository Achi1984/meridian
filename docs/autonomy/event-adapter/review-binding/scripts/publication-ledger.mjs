// Inactive Postgres adapter preparation. No pg import, pool creation or entrypoint.
// A future trusted adapter must supply a dedicated AUTOCOMMIT Pool, never a Client
// participating in a transaction. Caller-supplied bindings are not authentication.
const flags = Object.freeze({authenticated:false, provenanceVerified:false,
  authorized:false, dispatchAllowed:false, mergeAllowed:false, durable:false, sendAllowed:false});
const fields = ['operationKey','intentSha256','bodySha256','runId','runAttempt'];
function check(binding) {
  if (!binding || Object.getPrototypeOf(binding)!==Object.prototype ||
      Object.keys(binding).sort().join()!==[...fields].sort().join()) throw new Error('LEDGER_SCHEMA');
  for (const k of ['operationKey','intentSha256','bodySha256'])
    if (typeof binding[k]!=='string' || !/^[a-f0-9]{64}$/.test(binding[k])) throw new Error('LEDGER_DIGEST');
  if (!Number.isSafeInteger(binding.runId) || binding.runId<1 || binding.runAttempt!==1)
    throw new Error('LEDGER_RUN');
  return [binding.operationKey,binding.intentSha256,binding.bodySha256,binding.runId,binding.runAttempt];
}
export const RESERVE_SQL = `INSERT INTO meridian_publisher.reservations
 (operation_key,intent_sha256,body_sha256,run_id,run_attempt,status)
 VALUES ($1,$2,$3,$4,$5,'RESERVED')
 ON CONFLICT (operation_key) DO NOTHING RETURNING operation_key,intent_sha256,status`;
export const SETTLE_SQL = `UPDATE meridian_publisher.reservations
 SET status=$6, comment_id=$7
 WHERE operation_key=$1 AND intent_sha256=$2 AND body_sha256=$3
 AND run_id=$4 AND run_attempt=$5 AND status='RESERVED'
 RETURNING operation_key,intent_sha256,status`;

function response(result, binding, status) {
  if (!result || !Array.isArray(result.rows) || !Number.isInteger(result.rowCount) ||
      result.rowCount!==result.rows.length || result.rowCount<0 || result.rowCount>1) return 'UNCERTAIN';
  if (result.rowCount===0) return 'NOT_ACQUIRED';
  const row=result.rows[0];
  if (!row || Object.keys(row).sort().join()!=='intent_sha256,operation_key,status' ||
      row.operation_key!==binding.operationKey || row.intent_sha256!==binding.intentSha256 ||
      row.status!==status) return 'UNCERTAIN';
  return 'ACKNOWLEDGED';
}
async function execute(pool, sql, values, binding, status) {
  // One call only. No retry, read-back promotion, lease recovery or pool fallback.
  try {
    const result=await pool.query(sql,values);
    return {outcome:response(result,binding,status), ...flags};
  } catch {
    // Do not surface DB messages or connection details. The write may have committed.
    return {outcome:'UNCERTAIN', ...flags};
  }
}
export async function reserve(pool,binding) {
  const values=check(binding);
  // Snapshot before awaiting; later caller mutation cannot change reply validation.
  return execute(pool,RESERVE_SQL,values,{...binding},'RESERVED');
}
export async function settle(pool,binding,status,commentId=null) {
  const values=check(binding);
  if (!['CONFIRMED','AMBIGUOUS'].includes(status) ||
      (status==='CONFIRMED' ? !Number.isSafeInteger(commentId) || commentId<1 : commentId!==null))
    throw new Error('LEDGER_SETTLEMENT');
  return execute(pool,SETTLE_SQL,[...values,status,commentId],{...binding},status);
}
