// MERIDIAN v7.64 — server-side canonical portfolio history capture.
// Reads private quantities from PostgreSQL, refreshes public market prices, and stores one canonical total basis.

import pg from 'pg';
import { appendPortfolioHistory, ensurePortfolioHistorySchema } from './portfolio-history-store.js';

const { Pool }=pg;
const DATABASE_URL=String(process.env.DATABASE_URL||'').trim();
const PRIVATE_STATE_KEY='private_dashboard_v1';
const INTERVAL_MIN=Math.max(5,Number(process.env.MERIDIAN_PORTFOLIO_HISTORY_MINUTES||5));
const ALIASES={BETH:'ETH',OKSOL:'SOL'};
let pool=null,running=false;

function db(){if(!DATABASE_URL)return null;if(!pool)pool=new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}});return pool}
function sym(x){const s=String(x||'').trim().toUpperCase();return ALIASES[s]||s}
async function stateGet(){const p=db();if(!p)return null;const r=await p.query('SELECT value FROM meridian_state WHERE key=$1',[PRIVATE_STATE_KEY]);return r.rows[0]?.value??null}
async function jsonFetch(url){const r=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`price_http_${r.status}`);return r.json()}
async function publicPrices(){
  let rows;
  try{rows=await jsonFetch('https://api.binance.com/api/v3/ticker/price')}
  catch(_e){rows=await jsonFetch('https://data-api.binance.vision/api/v3/ticker/price')}
  const out={};
  for(const r of Array.isArray(rows)?rows:[]){
    const pair=String(r?.symbol||'');if(!pair.endsWith('USDT'))continue;
    const asset=pair.slice(0,-4),price=Number(r?.price);if(price>0)out[asset]=price;
  }
  return out;
}
export function mergeRuntimePrices(data={},prices={}){
  const next={...data,livePrices:{...(data.livePrices||{})}};
  for(const h of data?.portfolio?.holdings||[]){const s=sym(h?.symbol),p=Number(prices[s]);if(p>0)next.livePrices[h.symbol]={price:p,source:'BINANCE_PUBLIC_HISTORY_CAPTURE'};}
  return next;
}
export async function capturePortfolioHistoryOnce(opts={}){
  const p=opts.db||db();if(!p)return{ok:false,reason:'NO_DATABASE'};
  await ensurePortfolioHistorySchema(p);
  const current=opts.data||await stateGet();if(!current)return{ok:false,reason:'PRIVATE_DASHBOARD_UNAVAILABLE'};
  let prices={};let priceStatus='LIVE';
  try{prices=opts.prices||await publicPrices()}catch(e){priceStatus='STORED_PRICE_FALLBACK';console.error('[PORTFOLIO_HISTORY] prices',String(e?.message||e))}
  const enriched=mergeRuntimePrices(current,prices);
  const result=await appendPortfolioHistory(p,enriched,{timestamp:opts.timestamp??Date.now(),dedupeMs:opts.dedupeMs??4*60*1000});
  return{...result,priceStatus};
}
export function startPortfolioHistoryCapture(){
  if(!DATABASE_URL){console.log('[PORTFOLIO_HISTORY] disabled · missing database');return{enabled:false}}
  const run=async()=>{if(running)return;running=true;try{const r=await capturePortfolioHistoryOnce();console.log(`[PORTFOLIO_HISTORY] ${r.inserted?'captured':'unchanged'} · ${r.snapshot?.totalUsd??'—'} USD · ${r.priceStatus||r.reason}`)}catch(e){console.error('[PORTFOLIO_HISTORY] failed',String(e?.message||e))}finally{running=false}};
  setTimeout(run,20000);const timer=setInterval(run,INTERVAL_MIN*60000);timer.unref?.();
  console.log(`[PORTFOLIO_HISTORY] enabled · every ${INTERVAL_MIN} min`);return{enabled:true,intervalMin:INTERVAL_MIN};
}
