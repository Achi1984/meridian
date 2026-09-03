import crypto from 'node:crypto';
import pg from 'pg';
import { mergeVenueHoldings } from './private-holdings-sync.js';

const { Pool } = pg;
const DATABASE_URL=String(process.env.DATABASE_URL||'').trim();
const PRIVATE_STATE_KEY='private_dashboard_v1';
const INTERVAL_MIN=Math.max(5,Number(process.env.MERIDIAN_EXCHANGE_SYNC_MINUTES||10));
const OKX_KEY=String(process.env.OKX_READ_API_KEY||'').trim();
const OKX_SECRET=String(process.env.OKX_READ_API_SECRET||'').trim();
const OKX_PASSPHRASE=String(process.env.OKX_READ_API_PASSPHRASE||'').trim();
const BITPANDA_KEY=String(process.env.BITPANDA_READ_API_KEY||'').trim();
const ALIASES={BETH:'ETH',OKSOL:'SOL'};

let pool=null,running=false;
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
function positive(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:0}
function normalizeSymbol(s){const x=String(s||'').trim().toUpperCase();return ALIASES[x]||x}
function holdingsKey(rows){
  return rows.map(x=>`${String(x.venue).toLowerCase()}|${normalizeSymbol(x.symbol)}|${Number(x.quantity).toFixed(12)}`).sort().join(';');
}
function currentVenueRows(current,venues){
  const wanted=new Set(venues.map(v=>v.toLowerCase()));
  return (current?.portfolio?.holdings||[]).filter(x=>wanted.has(String(x?.venue||'').toLowerCase())).map(x=>({venue:x.venue,symbol:x.symbol,quantity:Number(x.quantity)||0}));
}
async function jsonFetch(url,opts={}){
  const r=await fetch(url,{...opts,headers:{accept:'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(12000)});
  const text=await r.text();
  let body={}; try{body=text?JSON.parse(text):{}}catch{throw new Error(`invalid_json_${r.status}`)}
  if(!r.ok)throw new Error(`http_${r.status}`);
  return body;
}
function okxHeaders(path){
  const ts=new Date().toISOString();
  const prehash=ts+'GET'+path;
  const sign=crypto.createHmac('sha256',OKX_SECRET).update(prehash).digest('base64');
  return {'OK-ACCESS-KEY':OKX_KEY,'OK-ACCESS-SIGN':sign,'OK-ACCESS-TIMESTAMP':ts,'OK-ACCESS-PASSPHRASE':OKX_PASSPHRASE};
}
async function okxGet(path){return jsonFetch('https://www.okx.com'+path,{headers:okxHeaders(path)})}
async function fetchOkx(){
  if(!(OKX_KEY&&OKX_SECRET&&OKX_PASSPHRASE))return null;
  const [trading,funding]=await Promise.all([
    okxGet('/api/v5/account/balance'),
    okxGet('/api/v5/asset/balances')
  ]);
  if(String(trading?.code)!=='0'||String(funding?.code)!=='0')throw new Error('okx_api_error');
  const sums=new Map();
  const source=new Map();
  for(const d of trading?.data?.[0]?.details||[]){
    const raw=String(d?.ccy||'').toUpperCase(); if(!raw)continue;
    const q=positive(d?.cashBal ?? d?.eq ?? d?.availBal);
    if(q){sums.set(raw,(sums.get(raw)||0)+q);source.set(raw,raw)}
  }
  for(const d of funding?.data||[]){
    const raw=String(d?.ccy||'').toUpperCase(); if(!raw)continue;
    const q=positive(d?.bal ?? d?.availBal);
    if(q){sums.set(raw,(sums.get(raw)||0)+q);source.set(raw,raw)}
  }
  const fiat=new Set(['USD','EUR','USDT','USDC','USDG']);
  const rows=[...sums].filter(([s,q])=>q>0&&!fiat.has(s)).map(([raw,quantity])=>({venue:'OKX',symbol:normalizeSymbol(raw),sourceSymbol:source.get(raw),quantity}));
  if(!rows.length)throw new Error('okx_empty_holdings_guard');
  return rows;
}
function bitpandaQty(x){
  const candidates=[x?.amount,x?.balance,x?.assetAmount,x?.quantity,x?.available,x?.total];
  for(const c of candidates){
    const v=typeof c==='object'&&c!==null?(c.value??c.amount??c.total):c;
    const n=positive(v); if(n)return n;
  }
  return 0;
}
async function bitpandaAssets(){
  const map=new Map(); let cursor=''; let pages=0;
  do{
    const u=new URL('https://api.public.bitpanda.com/v1/assets');u.searchParams.set('page_size','100');if(cursor)u.searchParams.set('cursor',cursor);
    const j=await jsonFetch(u,{headers:{'x-api-key':BITPANDA_KEY}});
    for(const a of j?.data||[])if(a?.id&&a?.symbol)map.set(String(a.id),String(a.symbol).toUpperCase());
    cursor=j?.hasNextPage?String(j?.nextCursor||''):'';pages++;
  }while(cursor&&pages<20);
  return map;
}
async function fetchBitpanda(){
  if(!BITPANDA_KEY)return null;
  const [portfolio,assetMap]=await Promise.all([
    jsonFetch('https://api.public.bitpanda.com/v1/portfolio',{headers:{'x-api-key':BITPANDA_KEY}}),
    bitpandaAssets()
  ]);
  const rows=[];
  for(const x of portfolio?.data||[]){
    const raw=String(x?.symbol||x?.asset?.symbol||assetMap.get(String(x?.assetId||x?.asset_id||x?.asset?.id||''))||'').toUpperCase();
    const quantity=bitpandaQty(x);
    if(raw&&quantity>0)rows.push({venue:'Bitpanda',symbol:normalizeSymbol(raw),sourceSymbol:raw,quantity});
  }
  if(!rows.length)throw new Error('bitpanda_empty_holdings_guard');
  return rows;
}
function rowsToText(rows){
  const groups=new Map();
  for(const r of rows){
    const v=r.venue; if(!groups.has(v))groups.set(v,[]);
    groups.get(v).push(`${r.sourceSymbol||r.symbol}=${Number(r.quantity)}`);
  }
  return [...groups].map(([v,xs])=>`${v}:${xs.join(',')}`).join('\n');
}
async function syncOnce(){
  if(running)return; running=true;
  try{
    if(!db())return;
    const configured=[]; if(OKX_KEY&&OKX_SECRET&&OKX_PASSPHRASE)configured.push('OKX'); if(BITPANDA_KEY)configured.push('Bitpanda');
    if(!configured.length)return;
    const current=await stateGet(); if(!current)throw new Error('private_dashboard_unavailable');
    const fetched=[];
    const results=await Promise.allSettled([fetchOkx(),fetchBitpanda()]);
    for(const r of results)if(r.status==='fulfilled'&&Array.isArray(r.value))fetched.push(...r.value);
    for(const r of results)if(r.status==='rejected')console.error('[EXCHANGE_SYNC]',String(r.reason?.message||r.reason));
    if(!fetched.length)return;
    const venues=[...new Set(fetched.map(x=>x.venue))];
    if(holdingsKey(currentVenueRows(current,venues))===holdingsKey(fetched)){
      console.log(`[EXCHANGE_SYNC] no change ${venues.join(', ')}`);return;
    }
    const merged=mergeVenueHoldings(current,rowsToText(fetched));
    if(!merged.ok)throw new Error(merged.error||'merge_failed');
    merged.data.privateUpdateSource='automatic_read_only_exchange_sync';
    merged.data.portfolio.exchangeSyncAt=new Date().toISOString();
    merged.data.portfolio.exchangeSyncVenues=venues;
    await stateSet(merged.data);
    console.log(`[EXCHANGE_SYNC] updated ${venues.join(', ')} · ${merged.holdingCount} holdings · revision ${merged.nextRevision}`);
  }catch(e){console.error('[EXCHANGE_SYNC] failed',String(e?.message||e))}
  finally{running=false}
}

export function startExchangeAutoSync(){
  const configured=[]; if(OKX_KEY&&OKX_SECRET&&OKX_PASSPHRASE)configured.push('OKX'); if(BITPANDA_KEY)configured.push('Bitpanda');
  if(!DATABASE_URL||!configured.length){console.log('[EXCHANGE_SYNC] disabled · missing database or read-only exchange credentials');return {enabled:false,configured};}
  console.log(`[EXCHANGE_SYNC] enabled · ${configured.join(', ')} · every ${INTERVAL_MIN} min`);
  setTimeout(syncOnce,15000);
  const timer=setInterval(syncOnce,INTERVAL_MIN*60000);timer.unref?.();
  return {enabled:true,configured,intervalMin:INTERVAL_MIN};
}
