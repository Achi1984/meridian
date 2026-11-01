// Private manual Ledger snapshots. No prices, credentials or user holdings in source.
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const decimal=x=>typeof x==='string'&&/^(?:0|[1-9]\d{0,15})(?:\.\d{1,18})?$/.test(x)&&Number.isFinite(Number(x));
export function validateLedgerManualSnapshot(value,{now=Date.now()}={}){
  if(!plain(value)||value.source!=='USER_MANUAL_SNAPSHOT'||
    typeof value.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt))return null;
  const at=Date.parse(value.observedAt);
  if(!Number.isFinite(at)||at<=0||at>now||new Date(at).toISOString()!==value.observedAt||
    !Array.isArray(value.holdings)||!value.holdings.length||value.holdings.length>100)return null;
  const seen=new Set(),holdings=[];
  for(const row of value.holdings){
    if(!plain(row)||typeof row.symbol!=='string'||!/^[A-Z0-9._-]{1,20}$/.test(row.symbol)||seen.has(row.symbol)||
      !decimal(row.quantity))return null;
    seen.add(row.symbol);holdings.push({symbol:row.symbol,quantity:row.quantity});
  }
  return {source:'USER_MANUAL_SNAPSHOT',observedAt:value.observedAt,holdings};
}
export function prepareLedgerManualSnapshot(current,body,{now=new Date().toISOString()}={}){
  if(!plain(current)||!Number.isSafeInteger(current.privateRevision)||current.privateRevision<0)return {ok:false,status:409,error:'revision_unavailable'};
  if(body?.expectedRevision!==current.privateRevision)return {ok:false,status:409,error:'revision_conflict'};
  const snapshot=validateLedgerManualSnapshot(body?.snapshot,{now:Date.parse(now)});
  if(!snapshot)return {ok:false,status:400,error:'invalid_ledger_snapshot'};
  const next=JSON.parse(JSON.stringify(current));
  next.portfolio=plain(next.portfolio)?next.portfolio:{};
  const previous=next.portfolio.holdings;
  if(previous!==undefined&&!Array.isArray(previous))return {ok:false,status:400,error:'invalid_existing_holdings'};
  const kept=(previous||[]).filter(h=>String(h?.venue||'').trim().toLowerCase()!=='ledger');
  next.portfolio.holdings=[...kept,...snapshot.holdings.map(h=>({venue:'Ledger',symbol:h.symbol,quantity:h.quantity,
    updatedAt:snapshot.observedAt,authoritySource:'USER_MANUAL_SNAPSHOT'}))];
  next.portfolio.ledgerManualSnapshot={...snapshot,savedAt:now};
  // A manual historical screenshot must never inherit the legacy live-price authority.
  delete next.portfolio.ledgerAuthorityAt;delete next.portfolio.ledgerAuthoritySource;
  next.privateRevision=current.privateRevision+1;next.privateUpdatedAt=now;
  next.privateUpdateSource='ledger_manual_snapshot';
  return {ok:true,data:next,revision:next.privateRevision,updatedAt:now};
}
export async function saveLedgerManualSnapshot({db,key,current,body,now}){
  const result=prepareLedgerManualSnapshot(current,body,{now});if(!result.ok)return result;
  const written=await db.query('UPDATE meridian_state SET value=$2::jsonb,updated_at=now() WHERE key=$1 AND value=$3::jsonb RETURNING key',
    [key,JSON.stringify(result.data),JSON.stringify(current)]);
  if(written.rowCount!==1)return {ok:false,status:409,error:'revision_conflict'};
  return {ok:true,revision:result.revision,updatedAt:result.updatedAt};
}
