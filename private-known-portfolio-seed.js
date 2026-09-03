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
function pionexEquity(){
  if(!PIONEX_EQUITY_RAW)return null;
  const n=Number(PIONEX_EQUITY_RAW);
  return Number.isFinite(n)&&n>=0?n:null;
}
function manualTradingSignature(state){
  const balances=Array.isArray(state?.portfolio?.manualVenueBalances)?state.portfolio.manualVenueBalances:[];
  return balances.map(x=>`${clean(x?.venue).toLowerCase()}|${Number(x?.valueUsd??x?.value??0).toFixed(8)}|${clean(x?.kind).toUpperCase()}`).sort().join(';');
}
function desiredTradingSignature(equity){
  if(equity==null)return '';
  return `pionex|${Number(equity).toFixed(8)}|TRADING_CAPITAL`;
}
function setPionexEquity(state,equity){
  state.portfolio=state.portfolio&&typeof state.portfolio==='object'?state.portfolio:{};
  // SSOT policy: manualVenueBalances is reserved for external trading/bot capital.
  // Store both value and valueUsd because the stable v7.60 frontend reads value,
  // while private/backend state uses valueUsd in newer paths.
  state.portfolio.manualVenueBalances=equity==null?[]:[{
    venue:'Pionex',
    value:equity,
    valueUsd:equity,
    kind:'TRADING_CAPITAL',
    updatedAt:new Date().toISOString()
  }];
  state.portfolio.pionexEquityUsd=equity;
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
  const equity=pionexEquity();
  const currentEquity=Number(current?.portfolio?.pionexEquityUsd);
  const equityValueChanged=equity!=null && (!Number.isFinite(currentEquity)||Math.abs(currentEquity-equity)>1e-9);
  const tradingBalancesChanged=equity!=null && manualTradingSignature(current)!==desiredTradingSignature(equity);
  const equityChanged=equityValueChanged||tradingBalancesChanged;
  if(equityChanged){
    if(!holdingsChanged){
      next=JSON.parse(JSON.stringify(current));
      next.privateRevision=(Number.isInteger(next.privateRevision)?next.privateRevision:0)+1;
      next.privateUpdatedAt=new Date().toISOString();
    }
    setPionexEquity(next,equity);
  }
  if(!(holdingsChanged||equityChanged)){
    console.log(`[KNOWN_PORTFOLIO] no change${venues.length?` · ${venues.join(', ')}`:''}`);
    return {enabled:true,changed:false,venues};
  }
  next.privateUpdateSource='known_holdings_startup_seed';
  next.portfolio=next.portfolio&&typeof next.portfolio==='object'?next.portfolio:{};
  next.portfolio.knownHoldingsSeedAt=new Date().toISOString();
  await stateSet(next);
  console.log(`[KNOWN_PORTFOLIO] updated · ${venues.length?venues.join(', '):'Pionex'} · trading capital normalized · revision ${next.privateRevision}`);
  return {enabled:true,changed:true,venues,revision:next.privateRevision};
}
