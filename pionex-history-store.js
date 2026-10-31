// Separate Pionex valuation observations; never derived from aggregate portfolio history.
import {authoritativePionexEquitySnapshot, PIONEX_EQUITY_AUTHORITY_MAX_AGE_MS as TTL} from './portfolio-data-contract.js';
export const PIONEX_HISTORY_VERSION='PIONEX_HISTORY_V1';
const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
const time=v=>typeof v==='number'?v:typeof v==='string'&&v.trim()?Date.parse(v):NaN;
export function pionexHistoryPointValid(p){
  return p?.authorityVersion==='PIONEX_FRESH_V1'&&p.scope==='PIONEX'&&p.currency==='USD/USDT'&&
    Number.isSafeInteger(p.timestamp)&&p.timestamp>0&&Number.isSafeInteger(p.sourceAt)&&p.sourceAt>0&&p.sourceAt<=p.timestamp&&p.timestamp-p.sourceAt<=TTL&&
    typeof p.valueUsd==='number'&&Number.isFinite(p.valueUsd)&&p.valueUsd>=0&&
    typeof p.source==='string'&&!!p.source.trim()&&!['MISSING','MISSING_OR_STALE','UNKNOWN'].includes(p.source);
}
export function pionexHistorySnapshot(data={},timestamp=Date.now()){
  if(!Number.isSafeInteger(timestamp)||timestamp<=0)return null;
  // Reject coercible null/boolean/blank values before using the shared authority selector.
  const clean={...data,portfolio:{...data.portfolio},pionexAccount:{...data.pionexAccount,wallet:{...data.pionexAccount?.wallet}}};
  clean.portfolio.pionexEquityUsd=number(clean.portfolio.pionexEquityUsd);
  clean.portfolio.manualVenueBalances=(Array.isArray(clean.portfolio.manualVenueBalances)?clean.portfolio.manualVenueBalances:[]).map(r=>({...r,valueUsd:number(r.valueUsd??r.value),value:null}));
  clean.pionexAccount.wallet.totalInUsdt=number(clean.pionexAccount.wallet.totalInUsdt);
  const s=authoritativePionexEquitySnapshot(clean,timestamp);
  const point={timestamp,sourceAt:s.timestampMs,valueUsd:s.value,source:s.source,scope:'PIONEX',currency:'USD/USDT',authorityVersion:'PIONEX_FRESH_V1',sourceRevision:Number.isSafeInteger(data.privateRevision)?data.privateRevision:null};
  return s.found&&s.fresh&&pionexHistoryPointValid(point)?point:null;
}
export async function ensurePionexHistorySchema(db){
  await db.query(`CREATE TABLE IF NOT EXISTS meridian_pionex_history (
    id BIGSERIAL PRIMARY KEY, captured_at TIMESTAMPTZ NOT NULL, source_at TIMESTAMPTZ NOT NULL,
    value_usd DOUBLE PRECISION NOT NULL CHECK(value_usd>=0), source TEXT NOT NULL,
    authority_version TEXT NOT NULL, source_revision INTEGER NULL,
    UNIQUE(source_at,source))`);
  await db.query('CREATE INDEX IF NOT EXISTS meridian_pionex_history_capture_idx ON meridian_pionex_history(captured_at)');
}
export async function appendPionexHistory(db,data,opts={}){
  if(!db)return {ok:false,reason:'NO_DATABASE'};
  const p=pionexHistorySnapshot(data,opts.timestamp??Date.now());
  if(!p)return {ok:false,reason:'PIONEX_AUTHORITY_INCOMPLETE'};
  const r=await db.query(`INSERT INTO meridian_pionex_history(captured_at,source_at,value_usd,source,authority_version,source_revision)
    VALUES(to_timestamp($1/1000.0),to_timestamp($2/1000.0),$3,$4,$5,$6)
    ON CONFLICT(source_at,source) DO NOTHING RETURNING id`,[p.timestamp,p.sourceAt,p.valueUsd,p.source,p.authorityVersion,p.sourceRevision]);
  return {ok:true,inserted:r.rows.length>0,reason:r.rows.length?'CAPTURED':'SOURCE_ALREADY_CAPTURED'};
}
export async function readPionexHistory(db,opts={}){
  const now=Number.isFinite(opts.now)?opts.now:Date.now(),rangeMs=Math.min(7*86400000,Math.max(3600000,Number(opts.rangeMs)||86400000));
  const envelope={version:PIONEX_HISTORY_VERSION,source:'POSTGRES_PIONEX_HISTORY',scope:'PIONEX',currency:'USD/USDT',generatedAt:new Date(now).toISOString(),rangeMs,points:[],excludedPoints:0};
  if(!db)return {...envelope,source:'NO_DATABASE'};
  const r=await db.query(`SELECT captured_at,source_at,value_usd,source,authority_version,source_revision FROM meridian_pionex_history
    WHERE captured_at>=to_timestamp($1/1000.0) AND captured_at<=to_timestamp($2/1000.0)
    ORDER BY captured_at ASC,id ASC LIMIT 2200`,[now-rangeMs,now]);
  for(const row of r.rows){
    const p={timestamp:time(row.captured_at instanceof Date?row.captured_at.toISOString():row.captured_at),sourceAt:time(row.source_at instanceof Date?row.source_at.toISOString():row.source_at),valueUsd:number(row.value_usd),source:row.source,authorityVersion:row.authority_version,scope:'PIONEX',currency:'USD/USDT'};
    if(pionexHistoryPointValid(p)&&p.timestamp>=now-rangeMs&&p.timestamp<=now)envelope.points.push(p);else envelope.excludedPoints++;
  }
  return envelope;
}
