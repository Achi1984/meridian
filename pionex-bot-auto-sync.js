import crypto from 'node:crypto';
import pg from 'pg';

const { Pool }=pg;
const API_BASE='https://api.pionex.com';
const PRIVATE_STATE_KEY='private_dashboard_v1';
const ACTIVE_TYPES=new Set(['futures_grid','future_hedge_grid']);
const ACTIVE_STATUSES=new Set([
  'prepare','lock_currency','condition_lock','open_position','init_grid','running',
  'adjust_params','adjust_params_open_position','adjust_params_init_grid',
  'pre_pause','pausing','paused','pre_resume','resuming'
]);

export function canonicalQuery(params={}){
  const rows=[];
  for(const [k,v] of Object.entries(params)){
    if(v===undefined||v===null||v==='')continue;
    if(Array.isArray(v)){for(const item of v)if(item!==undefined&&item!==null&&item!=='')rows.push([k,String(item)]);}
    else rows.push([k,String(v)]);
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  return rows.map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
}

export function signPionexGet(path,params,secret){
  const query=canonicalQuery(params);
  const payload='GET'+path+(query?'?'+query:'');
  return crypto.createHmac('sha256',String(secret||'')).update(payload).digest('hex');
}

function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function firstNum(obj,keys){for(const k of keys){const x=n(obj?.[k]);if(x!=null)return x}return null}
function baseSymbol(v){return String(v||'').toUpperCase().replace(/\.PERP$/,'').replace(/[-_/]?(USDT|USDC|USD)$/,'')}
function direction(v){const x=String(v||'').toLowerCase();return x==='short'?'SHORT':x==='long'?'LONG':x==='no_trend'?'NEUTRAL':String(v||'LONG').toUpperCase()}
function activeOrder(o){const status=String(o?.buOrderData?.status||o?.status||'').toLowerCase();return ACTIVE_STATUSES.has(status)}
function liquidationFor(d,side){
  const direct=firstNum(d,['liquidationPrice']);
  if(direct!=null)return direct;
  return side==='SHORT'?firstNum(d,['estimateLiquidationPriceUp','estimateLiquidationPriceDown']):firstNum(d,['estimateLiquidationPriceDown','estimateLiquidationPriceUp']);
}
function tpFor(d,side){
  if(String(d?.profitStopType||'').toLowerCase()==='price'){
    const x=n(d?.profitStop);if(x>0)return x;
  }
  return side==='SHORT'?n(d?.bottom):n(d?.top);
}
function reliableUsdInvestment(d){
  const usd=firstNum(d,['usdtInvestment','investmentUsd','investmentUSDT']);
  if(usd!=null&&usd>=0)return usd;
  if(String(d?.investCoin||'').toUpperCase()==='USDT'){
    const q=n(d?.quoteInvestment);if(q!=null&&q>=0)return q;
  }
  return null;
}
function optionalPnl(d){
  return firstNum(d,['totalProfitUsd','totalProfitUSDT','pnlUsd','unrealizedPnlUsd','floatingProfitUsd','totalProfit','unrealizedProfit','floatingProfit']);
}
function optionalPnlPct(d){
  return firstNum(d,['totalProfitPct','pnlPct','profitPct','profitRate','profitRatio','floatingProfitRate']);
}

export function normalizePionexBotOrder(order){
  if(!order||!ACTIVE_TYPES.has(String(order.buOrderType||'')))return null;
  if(!activeOrder(order))return null;
  const d=order.buOrderData||{},side=direction(d.trend),symbol=baseSymbol(order.base);
  if(!symbol||!['LONG','SHORT','NEUTRAL'].includes(side))return null;
  const row={
    id:String(order.buOrderId||order.id||symbol),
    botOrderId:String(order.buOrderId||''),
    botType:String(order.buOrderType||''),
    symbol,
    side,
    leverage:n(d.leverage),
    lower:n(d.bottom),
    upper:n(d.top),
    liquidationPrice:liquidationFor(d,side),
    takeProfit:tpFor(d,side),
    investmentUsd:reliableUsdInvestment(d),
    pnlUsd:optionalPnl(d),
    totalProfitPct:optionalPnlPct(d),
    grids:n(d.row),
    position:n(d.position),
    positionOpenPrice:n(d.positionOpenPrice),
    extraMargin:n(d.extraMargin),
    riskStatus:d.riskStatus||null,
    marginStatus:d.marginStatus||null,
    cateType:d.cateType||null,
    investCurrency:d.investCoin||null,
    quoteInvestment:n(d.quoteInvestment),
    usdtInvestment:n(d.usdtInvestment),
    source:'PIONEX_BOT_API'
  };
  return row;
}

export async function pionexGet(path,params,{apiKey,apiSecret,fetchImpl=fetch,now=Date.now}={}){
  if(!apiKey||!apiSecret)throw new Error('pionex_bot_credentials_missing');
  const all={...params,timestamp:now()},query=canonicalQuery(all),sig=signPionexGet(path,all,apiSecret);
  const r=await fetchImpl(API_BASE+path+'?'+query,{
    method:'GET',
    headers:{accept:'application/json','PIONEX-KEY':apiKey,'PIONEX-SIGNATURE':sig},
    signal:AbortSignal.timeout(12000)
  });
  const raw=await r.text();let j={};
  try{j=raw?JSON.parse(raw):{}}catch{throw new Error('pionex_bot_invalid_json_'+r.status)}
  if(!r.ok)throw new Error('pionex_bot_http_'+r.status);
  if(j?.result!==true)throw new Error('pionex_bot_api_'+String(j?.code||'error')+':'+String(j?.message||'unknown'));
  return j;
}

export async function fetchRunningBotOrders({apiKey,apiSecret,fetchImpl=fetch,now=Date.now,maxPages=20}={}){
  const results=[];let pageToken=null,pages=0;
  do{
    const j=await pionexGet('/api/v1/bot/orders',{status:'running',...(pageToken?{pageToken}:{})},{apiKey,apiSecret,fetchImpl,now});
    const data=j?.data||{},rows=Array.isArray(data?.results)?data.results:[];
    results.push(...rows);
    pageToken=data?.nextPageToken?String(data.nextPageToken):null;
    pages++;
    if(pageToken)await new Promise(r=>setTimeout(r,125));
  }while(pageToken&&pages<maxPages);
  return {orders:results,pages,truncated:!!pageToken};
}

export function buildPionexRiskSnapshot(orders,iso=new Date().toISOString()){
  const bots=(orders||[]).map(normalizePionexBotOrder).filter(Boolean);
  return {
    source:'PIONEX_BOT_API',
    syncMode:'BOT_READING_BETA',
    updatedAt:iso,
    snapshotAt:iso,
    apiRows:Array.isArray(orders)?orders.length:0,
    bots,
    botCount:bots.length
  };
}

function clone(x){return x==null?x:JSON.parse(JSON.stringify(x))}
function configured(env){
  const apiKey=String(env.PIONEX_BOT_READ_API_KEY||env.PIONEX_API_KEY||'').trim();
  const apiSecret=String(env.PIONEX_BOT_READ_API_SECRET||env.PIONEX_API_SECRET||'').trim();
  return {apiKey,apiSecret,ok:!!(apiKey&&apiSecret)};
}

export function mergePionexSyncState(current,{risk=null,status,error=null,attemptAt,successAt=null,configured:cfg=false,pages=0,truncated=false}={}){
  const base=clone(current)||{},prevRisk=base.pionexRisk||{};
  if(risk)base.pionexRisk={...prevRisk,...risk};
  base.pionexBotSync={
    configured:!!cfg,
    readOnly:true,
    endpoint:'GET /api/v1/bot/orders',
    status:String(status||'UNKNOWN'),
    lastAttemptAt:attemptAt||new Date().toISOString(),
    lastSuccessAt:successAt||base?.pionexBotSync?.lastSuccessAt||null,
    error:error?String(error):null,
    pages:Number(pages)||0,
    truncated:!!truncated
  };
  base.privateRevision=(Number.isInteger(base.privateRevision)?base.privateRevision:0)+1;
  base.privateUpdatedAt=attemptAt||new Date().toISOString();
  base.privateUpdateSource='automatic_read_only_pionex_bot_sync';
  return base;
}

let pool=null,running=false;
function db(env){if(!env.DATABASE_URL)return null;if(!pool)pool=new Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});return pool}

async function updatePrivateState(env,mutate){
  const p=db(env);if(!p)return false;
  const client=await p.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT value FROM meridian_state WHERE key=$1 FOR UPDATE',[PRIVATE_STATE_KEY]);
    const current=r.rows[0]?.value??null;
    if(!current){await client.query('ROLLBACK');return false;}
    const next=mutate(current);
    await client.query('UPDATE meridian_state SET value=$2::jsonb,updated_at=now() WHERE key=$1',[PRIVATE_STATE_KEY,JSON.stringify(next)]);
    await client.query('COMMIT');return true;
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e}
  finally{client.release()}
}

export async function runPionexBotSyncOnce({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  if(running)return {ok:false,reason:'already_running'};running=true;
  const at=new Date(now()).toISOString(),creds=configured(env);
  try{
    if(!env.DATABASE_URL)return {ok:false,reason:'no_database'};
    if(!creds.ok){
      await updatePrivateState(env,current=>mergePionexSyncState(current,{status:'DISABLED_MISSING_CREDENTIALS',attemptAt:at,configured:false}));
      return {ok:false,reason:'missing_credentials'};
    }
    const {orders,pages,truncated}=await fetchRunningBotOrders({apiKey:creds.apiKey,apiSecret:creds.apiSecret,fetchImpl,now});
    const risk=buildPionexRiskSnapshot(orders,at);
    await updatePrivateState(env,current=>mergePionexSyncState(current,{risk,status:'OK',attemptAt:at,successAt:at,configured:true,pages,truncated}));
    return {ok:true,botCount:risk.botCount,apiRows:risk.apiRows,pages,truncated};
  }catch(e){
    const msg=String(e?.message||e);
    try{if(env.DATABASE_URL)await updatePrivateState(env,current=>mergePionexSyncState(current,{status:'ERROR',error:msg,attemptAt:at,configured:creds.ok}))}catch{}
    return {ok:false,reason:msg};
  }finally{running=false}
}

export function startPionexBotAutoSync({env=process.env,fetchImpl=fetch}={}){
  const mins=Math.max(5,Number(env.MERIDIAN_PIONEX_BOT_SYNC_MINUTES||5)),creds=configured(env);
  if(!env.DATABASE_URL){console.log('[PIONEX_BOT_SYNC] disabled · missing database');return {enabled:false,reason:'no_database'};}
  const tick=async()=>{const r=await runPionexBotSyncOnce({env,fetchImpl});console.log('[PIONEX_BOT_SYNC]',r.ok?'ok':'not-ready',r);};
  setTimeout(tick,12000);
  const timer=setInterval(tick,mins*60000);timer.unref?.();
  console.log('[PIONEX_BOT_SYNC] '+(creds.ok?'enabled':'waiting for read-only credentials')+' · every '+mins+' min');
  return {enabled:creds.ok,configured:creds.ok,intervalMin:mins,readOnly:true};
}
