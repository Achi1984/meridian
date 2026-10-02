import crypto from 'node:crypto';
import pg from 'pg';
import {upsertOkxPortfolioAuthority} from './portfolio-authority-update.js';

const {Pool}=pg;
const PRIVATE_STATE_KEY='private_dashboard_v1';
const DEFAULT_BASE_URL='https://www.okx.com';
const DEFAULT_INTERVAL_MIN=10;
const DEFAULT_MAX_SOURCE_AGE_MS=5*60*1000;
let pool=null,running=false,poolUrl='';

const finite=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const clean=v=>String(v||'').trim();

export function readOkxPortfolioAuthorityCredentials(env={}){
  const apiKey=clean(env.OKX_READ_API_KEY),apiSecret=clean(env.OKX_READ_API_SECRET),passphrase=clean(env.OKX_READ_API_PASSPHRASE);
  return{apiKey,apiSecret,passphrase,ok:!!(apiKey&&apiSecret&&passphrase)};
}

export function okxPortfolioAuthorityBaseUrl(env={}){
  const raw=clean(env.OKX_READ_API_BASE_URL||env.OKX_API_BASE_URL||DEFAULT_BASE_URL).replace(/\/+$/,'');
  if(!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(raw))throw new Error('invalid_okx_api_base_url');
  return raw;
}

export function okxPortfolioAuthorityPath(){return'/api/v5/asset/asset-valuation?ccy=USD'}

export function okxPortfolioAuthorityHeaders(path,{apiKey,apiSecret,passphrase,now=Date.now}={}){
  if(!(apiKey&&apiSecret&&passphrase))throw new Error('okx_credentials_missing');
  const timestamp=new Date(now()).toISOString(),prehash=timestamp+'GET'+path,sign=crypto.createHmac('sha256',apiSecret).update(prehash).digest('base64');
  return{'OK-ACCESS-KEY':apiKey,'OK-ACCESS-SIGN':sign,'OK-ACCESS-TIMESTAMP':timestamp,'OK-ACCESS-PASSPHRASE':passphrase};
}

export function parseOkxAssetValuation(body={},opts={}){
  if(String(body?.code)!=='0')throw new Error('okx_asset_valuation_api_error');
  const row=Array.isArray(body?.data)?body.data[0]:null,totalUsd=finite(row?.totalBal),timestampMs=finite(row?.ts),nowMs=finite(opts.nowMs)??Date.now(),maxAgeMs=Math.max(0,finite(opts.maxAgeMs)??DEFAULT_MAX_SOURCE_AGE_MS);
  if(totalUsd==null||totalUsd<0)throw new Error('okx_asset_valuation_invalid_total');
  if(timestampMs==null)throw new Error('okx_asset_valuation_timestamp_missing');
  if(timestampMs>nowMs+30000)throw new Error('okx_asset_valuation_future_timestamp');
  const ageMs=Math.max(0,nowMs-timestampMs);
  if(ageMs>maxAgeMs)throw new Error('okx_asset_valuation_stale');
  return{
    totalUsd,
    timestampMs,
    updatedAt:new Date(timestampMs).toISOString(),
    ageMs,
    source:'OKX_READ_API_ASSET_VALUATION',
    currency:'USD'
  };
}

export async function fetchOkxPortfolioAuthoritySnapshot({env=process.env,fetchImpl=fetch,now=Date.now,maxAgeMs=DEFAULT_MAX_SOURCE_AGE_MS}={}){
  const creds=readOkxPortfolioAuthorityCredentials(env);
  if(!creds.ok)throw new Error('okx_credentials_missing');
  const path=okxPortfolioAuthorityPath(),base=okxPortfolioAuthorityBaseUrl(env),nowMs=Number(now()),headers=okxPortfolioAuthorityHeaders(path,{...creds,now:nowMs});
  const response=await fetchImpl(base+path,{method:'GET',headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(12000)});
  const text=await response.text();
  let body={};try{body=text?JSON.parse(text):{}}catch{throw new Error('okx_asset_valuation_invalid_json')}
  if(!response.ok)throw new Error('okx_asset_valuation_http_'+response.status);
  return parseOkxAssetValuation(body,{nowMs,maxAgeMs});
}

export function applyOkxPortfolioAuthoritySnapshot(current={},snapshot={}){
  if(String(snapshot?.source)!=='OKX_READ_API_ASSET_VALUATION')return{ok:false,error:'invalid_okx_authority_source',currentRevision:Number.isInteger(current?.privateRevision)?current.privateRevision:0};
  return upsertOkxPortfolioAuthority(current,snapshot.totalUsd,{
    now:snapshot.updatedAt,
    source:'OKX_READ_API_ASSET_VALUATION',
    privateUpdateSource:'automatic_read_only_okx_portfolio_authority_sync'
  });
}

function db(env={}){
  const url=clean(env.DATABASE_URL);
  if(!url)return null;
  if(!pool||poolUrl!==url){pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:false}});poolUrl=url}
  return pool;
}

async function updatePrivateState(env,snapshot){
  const p=db(env);if(!p)return{ok:false,reason:'no_database'};
  const client=await p.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT value FROM meridian_state WHERE key=$1 FOR UPDATE',[PRIVATE_STATE_KEY]);
    const current=r.rows[0]?.value??null;
    if(!current){await client.query('ROLLBACK');return{ok:false,reason:'private_dashboard_unavailable'}}
    const merged=applyOkxPortfolioAuthoritySnapshot(current,snapshot);
    if(!merged.ok){await client.query('ROLLBACK');return{ok:false,reason:merged.error||'merge_failed'}}
    if(merged.changed===false){await client.query('ROLLBACK');return{ok:true,changed:false,reason:merged.reason||'unchanged'}}
    await client.query('UPDATE meridian_state SET value=$2::jsonb,updated_at=now() WHERE key=$1',[PRIVATE_STATE_KEY,JSON.stringify(merged.data)]);
    await client.query('COMMIT');
    return{ok:true,changed:true,revision:merged.nextRevision};
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    throw e;
  }finally{client.release()}
}

export async function runOkxPortfolioAuthorityOnce({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  if(running)return{ok:false,reason:'already_running'};
  running=true;
  try{
    if(!clean(env.DATABASE_URL))return{ok:false,reason:'no_database'};
    const creds=readOkxPortfolioAuthorityCredentials(env);
    if(!creds.ok)return{ok:false,reason:'missing_credentials'};
    const snapshot=await fetchOkxPortfolioAuthoritySnapshot({env,fetchImpl,now});
    const applied=await updatePrivateState(env,snapshot);
    return{...applied,source:snapshot.source,sourceAgeMs:snapshot.ageMs,currency:snapshot.currency};
  }catch(e){
    return{ok:false,reason:String(e?.message||e)};
  }finally{running=false}
}

export function startOkxPortfolioAuthoritySync({env=process.env,fetchImpl=fetch}={}){
  const creds=readOkxPortfolioAuthorityCredentials(env),intervalMin=Math.max(5,Number(env.MERIDIAN_OKX_AUTHORITY_SYNC_MINUTES||DEFAULT_INTERVAL_MIN));
  if(!clean(env.DATABASE_URL)){console.log('[OKX_PORTFOLIO_AUTHORITY] disabled · missing database');return{enabled:false,configured:creds.ok,reason:'no_database'}}
  if(!creds.ok){console.log('[OKX_PORTFOLIO_AUTHORITY] disabled · missing read-only credentials');return{enabled:false,configured:false,reason:'missing_credentials'}}
  const tick=async()=>{
    const r=await runOkxPortfolioAuthorityOnce({env,fetchImpl});
    console.log('[OKX_PORTFOLIO_AUTHORITY]',r.ok?(r.changed===false?'confirmed':'updated'):'not-ready',{ok:r.ok,changed:r.changed===true,reason:r.reason||null,source:r.source||null,sourceAgeMs:r.sourceAgeMs??null});
  };
  setTimeout(tick,8000);
  const timer=setInterval(tick,intervalMin*60000);timer.unref?.();
  console.log('[OKX_PORTFOLIO_AUTHORITY] enabled · every '+intervalMin+' min · read-only asset valuation');
  return{enabled:true,configured:true,intervalMin,readOnly:true};
}
