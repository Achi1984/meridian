import crypto from 'node:crypto';
import pg from 'pg';
import {PIONEX_FUTURES_GRID_DETAIL_PATH,PIONEX_SUPPORTED_BOT_TYPES,hydratePionexBotSummaries} from './pionex-bot-detail-read.js';

const { Pool }=pg;
const API_BASE='https://api.pionex.com';
const PRIVATE_STATE_KEY='private_dashboard_v1';
const ACTIVE_TYPES=new Set(PIONEX_SUPPORTED_BOT_TYPES);
const ACTIVE_STATUSES=new Set([
  'prepare','lock_currency','condition_lock','open_position','init_grid','running',
  'adjust_params','adjust_params_open_position','adjust_params_init_grid',
  'pre_pause','pausing','paused','pre_resume','resuming'
]);

function canonicalRows(params={}){
  const rows=[];
  for(const [k,v] of Object.entries(params)){
    if(v===undefined||v===null||v==='')continue;
    if(Array.isArray(v)){for(const item of v)if(item!==undefined&&item!==null&&item!=='')rows.push([String(k),String(item)]);}
    else rows.push([String(k),String(v)]);
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  return rows;
}
export function canonicalQuery(params={},encode=true){
  return canonicalRows(params).map(([k,v])=>(encode?encodeURIComponent(k):k)+'='+(encode?encodeURIComponent(v):v)).join('&');
}

export function signPionexGet(path,params,secret){
  const query=canonicalQuery(params,false);
  const payload='GET'+path+(query?'?'+query:'');
  return crypto.createHmac('sha256',String(secret||'')).update(payload).digest('hex');
}

function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function firstNum(obj,keys){for(const k of keys){const x=n(obj?.[k]);if(x!=null)return x}return null}
function baseSymbol(v){return String(v||'').trim().toUpperCase().replace(/\.PERP$/,'').replace(/[-_/]?(USDT|USDC|USD)$/,'')}
function direction(v){const x=String(v||'').trim().toLowerCase();return x==='short'?'SHORT':x==='long'?'LONG':x==='no_trend'?'NEUTRAL':null}
function activeOrder(o){const status=String(o?.buOrderData?.status||o?.status||'').trim().toLowerCase();return ACTIVE_STATUSES.has(status)}
function assetClass(v){
  const raw=String(v||'').trim().toUpperCase();
  if(!raw)return 'missing';
  if(/^(USDT|USDC|USD)(\.PERP)?$/.test(raw))return 'stable_quote';
  return baseSymbol(raw)?'asset':'unresolved';
}
function inverseCoinM(order){
  const d=order?.buOrderData||{};
  return [d?.cateType,d?.gridType,order?.cateType].some(v=>String(v||'').trim().toLowerCase()==='inverse');
}
function resolvedSymbol(order){
  const baseClass=assetClass(order?.base),quoteClass=assetClass(order?.quote);
  if(baseClass==='asset')return{symbol:baseSymbol(order?.base),source:'base',baseClass,quoteClass};
  if(inverseCoinM(order)&&baseClass==='stable_quote'&&quoteClass==='asset')return{symbol:baseSymbol(order?.quote),source:'quote_inverse',baseClass,quoteClass};
  return{symbol:'',source:'none',baseClass,quoteClass};
}
function quoteInverseConvention(order){
  return resolvedSymbol(order).source==='quote_inverse';
}
function assetPrice(order,v){
  const x=n(v);
  if(!(x>0))return null;
  return quoteInverseConvention(order)?1/x:x;
}
function firstAssetPrice(order,obj,keys){
  for(const k of keys){
    const x=assetPrice(order,obj?.[k]);
    if(x!=null)return x;
  }
  return null;
}
function assetDeclaredDirection(order,declaredSide){
  if(!quoteInverseConvention(order))return declaredSide;
  if(declaredSide==='LONG')return'SHORT';
  if(declaredSide==='SHORT')return'LONG';
  return declaredSide;
}
function directEconomicSide(order,d){
  const entry=firstAssetPrice(order,d,['positionOpenPrice','openPrice','initPrice']),liq=firstAssetPrice(order,d,['liquidationPrice']);
  if(!(entry>0&&liq>0))return null;
  const gap=Math.abs(liq-entry)/Math.max(entry,liq,1e-12);
  if(gap<.002)return null;
  return liq<entry?'LONG':'SHORT';
}
function resolvedDirection(order){
  const d=order?.buOrderData||{},declaredSide=direction(d?.trend),assetDeclaredSide=assetDeclaredDirection(order,declaredSide),economicSide=inverseCoinM(order)?directEconomicSide(order,d):null;
  if(economicSide)return{side:economicSide,source:'economic_inverse_asset',declaredSide,assetDeclaredSide,economicSide};
  return{side:assetDeclaredSide,source:quoteInverseConvention(order)?'trend_inverse_asset':'trend',declaredSide,assetDeclaredSide,economicSide};
}
export function inspectPionexBotOrder(order){
  const d=order?.buOrderData||{},type=String(order?.buOrderType||'').trim(),status=String(d?.status||order?.status||'').trim().toLowerCase(),resolved=resolvedSymbol(order),resolvedSide=resolvedDirection(order),side=resolvedSide.side;
  return {
    typePass:!!order&&ACTIVE_TYPES.has(type),
    statusPass:ACTIVE_STATUSES.has(status),
    symbolPass:!!resolved.symbol,
    sidePass:['LONG','SHORT','NEUTRAL'].includes(side),
    baseClass:resolved.baseClass,
    quoteClass:resolved.quoteClass,
    symbolSource:resolved.source,
    sideSource:resolvedSide.source,
    declaredSide:resolvedSide.declaredSide,
    assetDeclaredSide:resolvedSide.assetDeclaredSide,
    economicSide:resolvedSide.economicSide,
    status,
    side
  };
}
function liquidationFor(order,d,side){
  const direct=firstAssetPrice(order,d,['liquidationPrice']);
  if(direct!=null)return direct;
  const entry=firstAssetPrice(order,d,['positionOpenPrice','openPrice','initPrice']);
  const candidates=['estimateLiquidationPriceUp','estimateLiquidationPriceDown']
    .map(k=>firstAssetPrice(order,d,[k]))
    .filter(x=>x>0);
  if(!(entry>0)||!candidates.length)return null;
  const valid=candidates.filter(x=>side==='SHORT'?x>entry:side==='LONG'?x<entry:false);
  if(!valid.length)return null;
  valid.sort((a,b)=>Math.abs(a-entry)-Math.abs(b-entry));
  return valid[0];
}
function tpFor(order,d){
  if(String(d?.profitStopType||'').toLowerCase()==='price'){
    const x=assetPrice(order,d?.profitStop);if(x>0)return x;
  }
  return null;
}
function slFor(order,d){
  if(String(d?.lossStopType||'').toLowerCase()==='price'){
    const x=assetPrice(order,d?.lossStop);if(x>0)return x;
  }
  return firstAssetPrice(order,d,['stopLoss','stopLossPrice','lossStopPrice']);
}
function rangeFor(order,d){
  const a=assetPrice(order,d?.bottom),b=assetPrice(order,d?.top);
  if(a>0&&b>0)return{lower:Math.min(a,b),upper:Math.max(a,b)};
  return{lower:a,upper:b};
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
  return firstNum(d,['totalProfitUsd','totalProfitUSDT','pnlUsd','unrealizedPnlUsd','floatingProfitUsd']);
}
function optionalPnlPct(d){
  return firstNum(d,['totalProfitPct','pnlPct','profitPct']);
}

export function normalizePionexBotOrder(order){
  const check=inspectPionexBotOrder(order);
  if(!check.typePass||!check.statusPass||!check.symbolPass||!check.sidePass)return null;
  const d=order.buOrderData||{},side=check.side,symbol=resolvedSymbol(order).symbol,range=rangeFor(order,d);
  const row={
    id:String(order.buOrderId||order.id||symbol),
    botOrderId:String(order.buOrderId||''),
    botType:String(order.buOrderType||''),
    symbol,
    side,
    declaredSide:check.declaredSide,
    assetDeclaredSide:check.assetDeclaredSide,
    sideSource:check.sideSource,
    leverage:n(d.leverage),
    lower:range.lower,
    upper:range.upper,
    liquidationPrice:liquidationFor(order,d,side),
    takeProfit:tpFor(order,d),
    stopLoss:slFor(order,d),
    investmentUsd:reliableUsdInvestment(d),
    pnlUsd:optionalPnl(d),
    totalProfitPct:optionalPnlPct(d),
    grids:n(d.row),
    position:n(d.position),
    positionOpenPrice:firstAssetPrice(order,d,['positionOpenPrice','openPrice','initPrice']),
    extraMargin:n(d.extraMargin),
    riskStatus:d.riskStatus||null,
    marginStatus:d.marginStatus||null,
    cateType:d.cateType||order.cateType||null,
    investCurrency:d.investCoin||null,
    quoteInvestment:n(d.quoteInvestment),
    usdtInvestment:n(d.usdtInvestment),
    source:'PIONEX_BOT_API'
  };
  return row;
}

export async function pionexGet(path,params,{apiKey,apiSecret,fetchImpl=fetch,now=Date.now}={}){
  if(!apiKey||!apiSecret)throw new Error('pionex_bot_credentials_missing');
  const all={...params,timestamp:now()},query=canonicalQuery(all,true),sig=signPionexGet(path,all,apiSecret);
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
    const j=await pionexGet('/api/v1/bot/orders',{
      status:'running',
      ...(pageToken?{pageToken}:{})
    },{apiKey,apiSecret,fetchImpl,now});
    const data=j?.data||{},rows=Array.isArray(data?.results)?data.results:[];
    results.push(...rows);
    pageToken=data?.nextPageToken?String(data.nextPageToken):null;
    pages++;
    if(pageToken)await new Promise(r=>setTimeout(r,125));
  }while(pageToken&&pages<maxPages);
  return {orders:results,pages,truncated:!!pageToken};
}

export function summarizePionexBotList(orders=[]){
  const typeCounts={},statusCounts={};
  for(const row of Array.isArray(orders)?orders:[]){
    const type=String(row?.buOrderType||'UNKNOWN').trim()||'UNKNOWN';
    const status=String(row?.buOrderData?.status||row?.status||'UNKNOWN').trim().toLowerCase()||'unknown';
    typeCounts[type]=(typeCounts[type]||0)+1;
    statusCounts[status]=(statusCounts[status]||0)+1;
  }
  return {
    requestMode:'ALL_RUNNING_LOCAL_ALLOWLIST',
    localSupportedTypes:[...PIONEX_SUPPORTED_BOT_TYPES],
    listRows:Array.isArray(orders)?orders.length:0,
    typeCounts,
    statusCounts
  };
}

export async function fetchFuturesGridOrderDetail({buOrderId,apiKey,apiSecret,fetchImpl=fetch,now=Date.now}={}){
  const id=String(buOrderId||'').trim();
  if(!id)throw new Error('pionex_bot_detail_missing_id');
  const j=await pionexGet(PIONEX_FUTURES_GRID_DETAIL_PATH,{buOrderId:id},{apiKey,apiSecret,fetchImpl,now});
  if(!j?.data||typeof j.data!=='object')throw new Error('pionex_bot_detail_invalid');
  return j.data;
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

export function mergePionexSyncState(current,{risk=null,status,error=null,attemptAt,successAt=null,configured:cfg=false,pages=0,truncated=false,diagnostics=null}={}){
  const base=clone(current)||{},prevRisk=base.pionexRisk||{},prevSync=base.pionexBotSync||{};
  if(risk)base.pionexRisk={...prevRisk,...risk};
  base.pionexBotSync={
    configured:!!cfg,
    readOnly:true,
    endpoint:'GET /api/v1/bot/orders',
    queryMode:'ALL_RUNNING_LOCAL_ALLOWLIST',
    supportedTypes:[...PIONEX_SUPPORTED_BOT_TYPES],
    status:String(status||'UNKNOWN'),
    lastAttemptAt:attemptAt||new Date().toISOString(),
    lastSuccessAt:successAt||prevSync.lastSuccessAt||null,
    error:error?String(error):null,
    pages:Number(pages)||0,
    truncated:!!truncated,
    diagnostics:diagnostics?clone(diagnostics):(prevSync.diagnostics||null)
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
    const diagnostics=summarizePionexBotList(orders);
    if(truncated)throw new Error('pionex_bot_pagination_truncated');
    const hydrated=await hydratePionexBotSummaries(orders,{
      loadDetail:buOrderId=>fetchFuturesGridOrderDetail({buOrderId,apiKey:creds.apiKey,apiSecret:creds.apiSecret,fetchImpl,now}),
      validateDetail:row=>normalizePionexBotOrder(row)!=null
    });
    const risk={
      ...buildPionexRiskSnapshot(hydrated.orders,at),
      apiRows:hydrated.listRows,
      supportedRows:hydrated.supportedRows,
      detailRows:hydrated.detailRows,
      detailsComplete:hydrated.detailsComplete,
      syncMode:'BOT_READING_DETAIL_HYDRATED'
    };
    let applied=false,guarded=false;
    await updatePrivateState(env,current=>{
      const previousCount=Array.isArray(current?.pionexRisk?.bots)?current.pionexRisk.bots.length:0;
      if(previousCount>0&&risk.botCount===0){
        guarded=true;
        return mergePionexSyncState(current,{status:'EMPTY_GUARD',error:'zero_supported_running_bots',attemptAt:at,configured:true,pages,truncated:false,diagnostics});
      }
      applied=true;
      return mergePionexSyncState(current,{risk,status:'OK',attemptAt:at,successAt:at,configured:true,pages,truncated:false,diagnostics});
    });
    if(guarded)return {ok:false,reason:'empty_guard',botCount:0,apiRows:risk.apiRows,supportedRows:risk.supportedRows,detailRows:risk.detailRows,pages,diagnostics};
    return {ok:applied,botCount:risk.botCount,apiRows:risk.apiRows,supportedRows:risk.supportedRows,detailRows:risk.detailRows,detailsComplete:risk.detailsComplete,pages,truncated:false,diagnostics};
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
  if(!creds.ok){
    console.log('[PIONEX_BOT_SYNC] waiting for read-only credentials · diagnostic will be published once');
    return {enabled:false,configured:false,intervalMin:mins,readOnly:true,reason:'missing_credentials'};
  }
  const timer=setInterval(tick,mins*60000);timer.unref?.();
  console.log('[PIONEX_BOT_SYNC] enabled · every '+mins+' min');
  return {enabled:true,configured:true,intervalMin:mins,readOnly:true};
}
