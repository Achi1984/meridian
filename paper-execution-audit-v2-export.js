import crypto from 'node:crypto';

const LEDGERS=Object.freeze([
  ['BASELINE','paper'],
  ['SHADOW_V1','shadow_v1'],
  ['CHALLENGER_V2','challenger_v2'],
  ['CHALLENGER_V3','challenger_v3'],
  ['REGIME_V1','regime_v1']
]);

function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function digest(value){return crypto.createHash('sha256').update(stable(value)).digest('hex');}
function cleanTrade(x){
  if(!x||typeof x!=='object')return null;
  const allow=['id','symbol','side','status','entry','qty','sl','tp1','tp2','openedAt','closedAt','exit','exitReason','realized','feeOpen','feeClose','riskPct','ruleset','source','parameterVersion','regimeType'];
  return Object.fromEntries(allow.filter(k=>Object.hasOwn(x,k)).map(k=>[k,x[k]]));
}
function ledgerReceipt(name,key,state){
  if(!state||typeof state!=='object')return{name,key,available:false,updatedAt:null,openCount:0,closedCount:0,trades:[],digest:null};
  const positions=(Array.isArray(state.positions)?state.positions:[]).filter(x=>x?.status==='OPEN').map(cleanTrade).filter(Boolean);
  const trades=(Array.isArray(state.trades)?state.trades:[]).filter(x=>x?.status==='CLOSED'||x?.closedAt).map(cleanTrade).filter(Boolean);
  const payload={name,key,updatedAt:state.updatedAt||null,positions,trades};
  return{available:true,...payload,openCount:positions.length,closedCount:trades.length,digest:digest(payload)};
}
async function buildPaperExecutionAuditExport(stateGet,{generatedAt=new Date().toISOString()}={}){
  const rows=await Promise.all(LEDGERS.map(async([name,key])=>ledgerReceipt(name,key,await stateGet(key))));
  const payload={schemaVersion:'PAPER-EXECUTION-AUDIT-V2-LEDGER-EXPORT-1',generatedAt,researchOnly:true,executionImpact:false,source:'POSTGRES_STATE',ledgers:rows};
  return{...payload,digest:digest(payload)};
}
export {LEDGERS,stable,digest,cleanTrade,ledgerReceipt,buildPaperExecutionAuditExport};
