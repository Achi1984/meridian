// Inactive host-only PostgreSQL preparation. No pool, route, sender or credentials.
const fields=['operationKey','intentSha256','bodySha256','runId','runAttempt'];
function need(ok){if(!ok)throw new Error('SEND_RECORD_REJECTED');}
function values(binding){
 need(binding&&Object.getPrototypeOf(binding)===Object.prototype
  &&Object.keys(binding).sort().join()===[...fields].sort().join());
 for(const k of fields.slice(0,3))need(typeof binding[k]==='string'&&/^[a-f0-9]{64}$/.test(binding[k]));
 need(Number.isSafeInteger(binding.runId)&&binding.runId>0&&binding.runAttempt===1);
 return fields.map(k=>binding[k]);
}
export const RETAIN_SQL=`WITH reservation AS (
 SELECT operation_key FROM meridian_publisher.reservations
 WHERE operation_key=$1 AND intent_sha256=$2 AND body_sha256=$3
 AND run_id=$4 AND run_attempt=$5 AND status='RESERVED' FOR UPDATE
)
INSERT INTO meridian_publisher.send_records (operation_key,comment_id)
 SELECT operation_key,$6 FROM reservation
 ON CONFLICT DO NOTHING RETURNING operation_key,comment_id::text AS comment_id`;
export const READ_SQL=`SELECT r.operation_key,r.intent_sha256,r.body_sha256,
 r.run_id::text AS run_id,r.run_attempt,s.comment_id::text AS comment_id
 FROM meridian_publisher.reservations r JOIN meridian_publisher.send_records s USING(operation_key)
 WHERE r.operation_key=$1 AND r.intent_sha256=$2 AND r.body_sha256=$3
 AND r.run_id=$4 AND r.run_attempt=$5 AND r.status='RESERVED'`;
function integer(raw){
 need(typeof raw==='string'&&/^[1-9][0-9]{0,15}$/.test(raw));
 const n=Number(raw);need(Number.isSafeInteger(n)&&String(n)===raw);return n;
}
// Only the trusted sender may retain its actual response ID, using a dedicated
// autocommit pool with a host-enforced write timeout. No retry on uncertain writes.
export async function retainSendRecord(pool,binding,commentId){
 const args=values(binding);need(Number.isSafeInteger(commentId)&&commentId>0);
 let outcome='UNCERTAIN';
 try{
  const r=await pool.query(RETAIN_SQL,[...args,commentId]);
  if(r?.rowCount===0&&Array.isArray(r.rows)&&r.rows.length===0)outcome='NOT_ACQUIRED';
  if(r?.rowCount===1&&Array.isArray(r.rows)&&r.rows.length===1){
   const row=r.rows[0];
   if(row&&Object.keys(row).sort().join()==='comment_id,operation_key'
    &&row.operation_key===args[0]&&integer(row.comment_id)===commentId)outcome='ACKNOWLEDGED';
  }
 }catch{}
 return {outcome,authenticated:false,provenanceVerified:false,authorized:false,durable:false,sendAllowed:false};
}
export function createSendRecordReader(pool){
 return async function readSendRecord(binding,signal){
  const args=values(binding),snapshot=Object.fromEntries(fields.map((k,i)=>[k,args[i]]));
  need(!signal?.aborted);let timer,onAbort;
  const deadline=new Promise((_,reject)=>{
   onAbort=()=>reject(new Error('SEND_RECORD_REJECTED'));
   timer=setTimeout(onAbort,4500);signal?.addEventListener('abort',onAbort,{once:true});
  });
  try{
   // Deadline bounds the caller; host statement_timeout must also bound DB work.
   const work=Promise.resolve().then(()=>{need(!signal?.aborted);return pool.query(READ_SQL,args);});
   const r=await Promise.race([work,deadline]);need(!signal?.aborted);
   need(r&&Array.isArray(r.rows)&&r.rowCount===r.rows.length&&[0,1].includes(r.rowCount));
   if(r.rowCount===0)return null;
   const row=r.rows[0];need(row&&Object.keys(row).sort().join()==='body_sha256,comment_id,intent_sha256,operation_key,run_attempt,run_id');
   const record={operationKey:row.operation_key,intentSha256:row.intent_sha256,bodySha256:row.body_sha256,
    runId:integer(row.run_id),runAttempt:row.run_attempt,commentId:integer(row.comment_id)};
   need(fields.every(k=>record[k]===snapshot[k]));return record;
  }catch{throw new Error('SEND_RECORD_REJECTED');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
 };
}
