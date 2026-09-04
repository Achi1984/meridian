import pg from 'pg';
import { mergeVenueHoldings } from './private-holdings-sync.js';

const { Pool } = pg;
const DATABASE_URL=String(process.env.DATABASE_URL||'').trim();
const PRIVATE_STATE_KEY='private_dashboard_v1';
const HOLDINGS_TEXT=String(process.env.MERIDIAN_KNOWN_HOLDINGS_TEXT||'').trim();
const PIONEX_EQUITY_RAW=String(process.env.MERIDIAN_PIONEX_EQUITY_USD||'').trim();

let pool=null;
function db(){
  if(!DATABASE_URL)return null;
  if(!pool)pool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});
  return pool;
}
async function stateGet(){
  const p=db(); if(!p)return null;
  const r=await p.query('SELECT value FROM meridian_state WHERE key=$1',[PRIVATE_STATE_KEY]);
  return r.rows[0]?.value??null;
}
async function stateSet(value){
  const p=db(); if(!p)return false;
  await p.query(`INSERT INTO meridian_state(key,value,updated_at)
    VALUES($1,$2::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[PRIVATE_STATE_KEY,JSON.stringify(value)]);
  return true;
}
function clean(v){return String(v||'').trim()}
function normalizeHolding(h){
  return `${clean(h?.venue).toLowerCase()}|${clean(h?.sourceSymbol||h?.symbol).toUpperCase()}|${Number(h?.quantity||0).toFixed(12)}`;
}
function currentVenueSignature(current,venues){
  const wanted=new Set(venues.map(v=>clean(v).toLowerCase()));
  return (current?.portfolio?.holdings||[])
    .filter(h=>wanted.has(clean(h?.venue).toLowerCase()))
    .map(normalizeHolding).sort().join(';');
}
function incomingSignature(rows){return rows.map(normalizeHolding).sort().join(';')}
function parseRowsFromMerged(merged,venues){
  const wanted=new Set(venues.map(v=>clean(v).toLowerCase()));
  return (merged?.data?.portfolio?.holdings||[]).filter(h=>wanted.has(clean(h?.venue).toLowerCase()));
}
function seedPionexEquity(){
  if(!PIONEX_EQUITY_RAW)return null;
  const n=Number(PIONEX_EQUITY_RAW);
  return Number.isFinite(n)&&n>=0?n:null;
}
function existingPionexEquity(state){
  const direct=Number(state?.portfolio?.pionexEquityUsd);
  if(Number.isFinite(direct)&&direct>=0)return direct;
  const balances=Array.isArray(state?.portfolio?.manualVenueBalances)?state.portfolio.manualVenueBalances:[];
  const p=balances.find(x=>clean(x?.venue||x?.name).toLowerCase()==='pionex');
  const n=Number(p?.valueUsd??p?.value);
  return Number.isFinite(n)&&n>=0?n:null;
}
function setPionexEquity(state,equity){
  state.portfolio=state.portfolio&&typeof state.portfolio==='object'?state.portfolio:{};
  const now=new Date().toISOString();
  state.portfolio.manualVenueBalances=[{
    venue:'Pionex',
    value:equity,
    valueUsd:equity,
    kind:'TRADING_CAPITAL',
    updatedAt:now,
    source:'KNOWN_SEED'
  }];
  state.portfolio.pionexEquityUsd=equity;
  state.portfolio.pionexEquitySource='KNOWN_SEED';
  state.portfolio.pionexEquityUpdatedAt=now;
}

export async function seedKnownPortfolioOnce(){
  if(!DATABASE_URL){console.log('[KNOWN_PORTFOLIO] disabled · no database');return {enabled:false,reason:'no_database'}}
  if(!HOLDINGS_TEXT&&!PIONEX_EQUITY_RAW){console.log('[KNOWN_PORTFOLIO] disabled · no private seed env');return {enabled:false,reason:'no_seed_env'}}
  const current=await stateGet();
  if(!current){console.error('[KNOWN_PORTFOLIO] private dashboard unavailable');return {enabled:false,reason:'private_dashboard_unavailable'}}

  let next=JSON.parse(JSON.stringify(current));
  let holdingsChanged=false;
  let venues=[];
  if(HOLDINGS_TEXT){
    const merged=mergeVenueHoldings(current,HOLDINGS_TEXT);
    if(!merged.ok){console.error('[KNOWN_PORTFOLIO] holdings seed rejected',merged.error||'invalid_holdings');return {enabled:false,reason:merged.error||'invalid_holdings'}}
    venues=merged.venues||[];
    const incoming=parseRowsFromMerged(merged,venues);
    holdingsChanged=currentVenueSignature(current,venues)!==incomingSignature(incoming);
    if(holdingsChanged)next=merged.data;
  }

  // v7.62 policy: the env value is bootstrap-only. Never overwrite an existing
  // private Pionex equity value at startup. This prevents deploys from rolling
  // a newer/manual/private snapshot back to an older static seed.
  const existingEquity=existingPionexEquity(current);
  const seedEquity=seedPionexEquity();
  const equityChanged=existingEquity==null && seedEquity!=null;
  if(equityChanged){
    if(!holdingsChanged){
      next=JSON.parse(JSON.stringify(current));
      next.privateRevision=(Number.isInteger(next.privateRevision)?next.privateRevision:0)+1;
      next.privateUpdatedAt=new Date().toISOString();
    }
    setPionexEquity(next,seedEquity);
  }

  if(!(holdingsChanged||equityChanged)){
    console.log(`[KNOWN_PORTFOLIO] no change${venues.length?` · ${venues.join(', ')}`:''} · Pionex equity preserved`);
    return {enabled:true,changed:false,venues,pionexEquityPreserved:existingEquity!=null};
  }

  next.privateUpdateSource=holdingsChanged?'known_holdings_startup_seed':'known_pionex_bootstrap_seed';
  next.portfolio=next.portfolio&&typeof next.portfolio==='object'?next.portfolio:{};
  next.portfolio.knownHoldingsSeedAt=new Date().toISOString();
  await stateSet(next);
  console.log(`[KNOWN_PORTFOLIO] updated · ${venues.length?venues.join(', '):'Pionex bootstrap'} · existing Pionex equity protected · revision ${next.privateRevision}`);
  return {enabled:true,changed:true,venues,revision:next.privateRevision};
}
