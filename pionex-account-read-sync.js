import pg from 'pg';
import {pionexReadGet} from './pionex-read-client.js';

const {Pool}=pg;
const PRIVATE_STATE_KEY='private_dashboard_v1';

function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function text(v){const s=String(v??'').trim();return s||null}

export function normalizeSpotBalances(data={}){
  return (Array.isArray(data?.balances)?data.balances:[]).map(x=>({
    coin:text(x?.coin),
    free:num(x?.free),
    frozen:num(x?.frozen),
    source:'PIONEX_READ_API'
  })).filter(x=>x.coin);
}

export function normalizeFuturesBalances(data={}){
  const balances=(Array.isArray(data?.balances)?data.balances:[]).map(x=>({
    coin:text(x?.coin),
    free:num(x?.free),
    frozen:num(x?.frozen),
    debts:num(x?.debts),
    source:'PIONEX_FUTURES_READ_API'
  })).filter(x=>x.coin);
  const isolates=(Array.isArray(data?.isolates)?data.isolates:[]).map(x=>({
    symbol:text(x?.symbol),
    isolatedMode:text(x?.isolatedMode),
    balances:(Array.isArray(x?.balances)?x.balances:[]).map(b=>({
      coin:text(b?.coin),free:num(b?.free),frozen:num(b?.frozen),debts:num(b?.debts)
    })).filter(b=>b.coin)
  })).filter(x=>x.symbol);
  return {balances,isolates};
}

export function normalizeFuturesPositions(data={}){
  return (Array.isArray(data?.positions)?data.positions:[]).map(x=>({
    positionId:text(x?.positionId),
    symbol:text(x?.symbol),
    isolatedMode:text(x?.isolatedMode),
    riskState:text(x?.riskState),
    side:text(x?.positionSide),
    netSize:num(x?.netSize),
    avgPrice:num(x?.avgPrice),
    unrealizedPnl:num(x?.unrealizedPnL),
    sizeLong:num(x?.sizeLong),
    sizeShort:num(x?.sizeShort),
    markPrice:num(x?.markPrice),
    initialMargin:num(x?.initialMargin),
    maintMargin:num(x?.maintMargin),
    liquidationPrice:num(x?.liquidationPrice),
    leverage:num(x?.leverage),
    createTime:num(x?.createTime),
    updateTime:num(x?.updateTime),
    source:'PIONEX_FUTURES_READ_API'
  })).filter(x=>x.symbol&&['LONG','SHORT'].includes(String(x.side||'').toUpperCase()));
}

export async function fetchPionexReadSnapshot({apiKey,apiSecret,fetchImpl=fetch,now=Date.now}={}){
  const [spot,fut,positions]=await Promise.all([
    pionexReadGet('/api/v1/account/balances',{}, {apiKey,apiSecret,fetchImpl,now}),
    pionexReadGet('/uapi/v1/account/balances',{}, {apiKey,apiSecret,fetchImpl,now}),
    pionexReadGet('/uapi/v1/account/positions',{}, {apiKey,apiSecret,fetchImpl,now})
  ]);
  const futures=normalizeFuturesBalances(fut?.data||{});
  const normalizedPositions=normalizeFuturesPositions(positions?.data||{});
  const at=new Date(now()).toISOString();
  return {
    source:'PIONEX_READ_API',
    readOnly:true,
    updatedAt:at,
    snapshotAt:at,
    spotBalances:normalizeSpotBalances(spot?.data||{}),
    futuresBalances:futures.balances,
    isolatedBalances:futures.isolates,
    futuresPositions:normalizedPositions,
    spotBalanceCount:normalizeSpotBalances(spot?.data||{}).length,
    futuresBalanceCount:futures.balances.length,
    futuresPositionCount:normalizedPositions.length
  };
}

export function readCredentials(env={}){
  const apiKey=String(env.PIONEX_READ_API_KEY||env.PIONEX_API_KEY||'').trim();
  const apiSecret=String(env.PIONEX_READ_API_SECRET||env.PIONEX_API_SECRET||'').trim();
  return {apiKey,apiSecret,ok:!!(apiKey&&apiSecret)};
}

export function mergePionexAccountState(current,{snapshot=null,status,error=null,attemptAt,successAt=null,configured=false}={}){
  const base=current==null?{}:JSON.parse(JSON.stringify(current));
  if(snapshot)base.pionexAccount=snapshot;
  base.pionexAccountSync={
    configured:!!configured,
    readOnly:true,
    endpoints:[
      'GET /api/v1/account/balances',
      'GET /uapi/v1/account/balances',
      'GET /uapi/v1/account/positions'
    ],
    status:String(status||'UNKNOWN'),
    lastAttemptAt:attemptAt||new Date().toISOString(),
    lastSuccessAt:successAt||base?.pionexAccountSync?.lastSuccessAt||null,
    error:error?String(error):null
  };
  base.privateRevision=(Number.isInteger(base.privateRevision)?base.privateRevision:0)+1;
  base.privateUpdatedAt=attemptAt||new Date().toISOString();
  base.privateUpdateSource='automatic_read_only_pionex_account_sync';
  return base;
}

let pool=null,running=false;
function db(env){
  if(!env.DATABASE_URL)return null;
  if(!pool)pool=new Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  return pool;
}

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
    await client.query('COMMIT');
    return true;
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  }finally{client.release()}
}

export async function runPionexAccountReadOnce({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  if(running)return {ok:false,reason:'already_running'};
  running=true;
  const at=new Date(now()).toISOString(),creds=readCredentials(env);
  try{
    if(!env.DATABASE_URL)return {ok:false,reason:'no_database'};
    if(!creds.ok){
      await updatePrivateState(env,current=>mergePionexAccountState(current,{
        status:'DISABLED_MISSING_CREDENTIALS',attemptAt:at,configured:false
      }));
      return {ok:false,reason:'missing_credentials'};
    }
    const snapshot=await fetchPionexReadSnapshot({apiKey:creds.apiKey,apiSecret:creds.apiSecret,fetchImpl,now});
    const applied=await updatePrivateState(env,current=>mergePionexAccountState(current,{
      snapshot,status:'OK',attemptAt:at,successAt:at,configured:true
    }));
    return {
      ok:applied,
      spotBalanceCount:snapshot.spotBalanceCount,
      futuresBalanceCount:snapshot.futuresBalanceCount,
      futuresPositionCount:snapshot.futuresPositionCount
    };
  }catch(e){
    const msg=String(e?.message||e);
    try{
      if(env.DATABASE_URL)await updatePrivateState(env,current=>mergePionexAccountState(current,{
        status:'ERROR',error:msg,attemptAt:at,configured:creds.ok
      }));
    }catch{}
    return {ok:false,reason:msg};
  }finally{running=false}
}

export function startPionexAccountReadSync({env=process.env,fetchImpl=fetch}={}){
  const mins=Math.max(5,Number(env.MERIDIAN_PIONEX_READ_SYNC_MINUTES||5));
  const creds=readCredentials(env);
  if(!env.DATABASE_URL){
    console.log('[PIONEX_ACCOUNT_READ] disabled · missing database');
    return {enabled:false,reason:'no_database'};
  }
  const tick=async()=>{
    const r=await runPionexAccountReadOnce({env,fetchImpl});
    console.log('[PIONEX_ACCOUNT_READ]',r.ok?'ok':'not-ready',r);
  };
  setTimeout(tick,9000);
  if(!creds.ok){
    console.log('[PIONEX_ACCOUNT_READ] waiting for read-only credentials · diagnostic will be published once');
    return {enabled:false,configured:false,intervalMin:mins,readOnly:true,reason:'missing_credentials'};
  }
  const timer=setInterval(tick,mins*60000);timer.unref?.();
  console.log('[PIONEX_ACCOUNT_READ] enabled · every '+mins+' min');
  return {enabled:true,configured:true,intervalMin:mins,readOnly:true};
}
