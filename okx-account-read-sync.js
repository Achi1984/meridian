import pg from 'pg';
import {OKX_ACCOUNT_BALANCE_PATH,OKX_DEFAULT_API_BASE,normalizeOkxApiBase,okxReadGet} from './okx-read-client.js';

const {Pool}=pg;
const PRIVATE_STATE_KEY='private_dashboard_v1';

function num(v){return v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null)}
function isoFromMs(v){const n=num(v);if(n==null||n<0)return null;const d=new Date(n);return Number.isFinite(d.getTime())?d.toISOString():null}

export function normalizeOkxBalanceResponse(j={},at=new Date().toISOString()){
  if(String(j?.code)!=='0'||!Array.isArray(j?.data)||j.data.length!==1)throw new Error('okx_balance_snapshot_invalid');
  const row=j.data[0]||{},totalEqUsd=num(row.totalEq);
  if(totalEqUsd==null||totalEqUsd<0)throw new Error('okx_total_equity_invalid');
  const details=Array.isArray(row.details)?row.details:[];
  const sourceUpdateMs=details.map(x=>num(x?.uTime)).filter(x=>x!=null&&x>=0).reduce((a,b)=>Math.max(a,b),0)||null;
  return {
    source:'OKX_ACCOUNT_READ_API',
    readOnly:true,
    endpoint:'GET '+OKX_ACCOUNT_BALANCE_PATH,
    totalEqUsd,
    snapshotAt:String(at),
    sourceUpdateAt:sourceUpdateMs==null?null:isoFromMs(sourceUpdateMs),
    currencyCount:details.filter(x=>String(x?.ccy||'').trim()).length
  };
}

export async function fetchOkxAccountSnapshot({apiKey,apiSecret,passphrase,apiBase=OKX_DEFAULT_API_BASE,fetchImpl=fetch,now=Date.now}={}){
  const j=await okxReadGet(OKX_ACCOUNT_BALANCE_PATH,{apiKey,apiSecret,passphrase,apiBase,fetchImpl,now});
  return normalizeOkxBalanceResponse(j,new Date(now()).toISOString());
}

export function readOkxCredentials(env={}){
  const apiKey=String(env.OKX_READ_API_KEY||'').trim();
  const apiSecret=String(env.OKX_READ_API_SECRET||'').trim();
  const passphrase=String(env.OKX_READ_API_PASSPHRASE||'').trim();
  let apiBase=null,error=null;
  try{apiBase=normalizeOkxApiBase(env.OKX_READ_API_BASE_URL||env.OKX_API_BASE_URL||OKX_DEFAULT_API_BASE)}catch(e){error=String(e?.message||e)}
  return {apiKey,apiSecret,passphrase,apiBase,error,ok:!!(apiKey&&apiSecret&&passphrase&&apiBase&&!error)};
}

export function mergeOkxAccountState(current,{snapshot=null,status,error=null,attemptAt,successAt=null,configured=false,apiBase=null}={}){
  const base=current==null?{}:JSON.parse(JSON.stringify(current));
  if(snapshot)base.okxAccount=snapshot;
  base.okxAccountSync={
    configured:!!configured,
    readOnly:true,
    endpoints:['GET '+OKX_ACCOUNT_BALANCE_PATH],
    apiBase:apiBase||base?.okxAccountSync?.apiBase||null,
    status:String(status||'UNKNOWN'),
    lastAttemptAt:attemptAt||new Date().toISOString(),
    lastSuccessAt:successAt||base?.okxAccountSync?.lastSuccessAt||null,
    error:error?String(error):null
  };
  base.privateRevision=(Number.isInteger(base.privateRevision)?base.privateRevision:0)+1;
  base.privateUpdatedAt=attemptAt||new Date().toISOString();
  base.privateUpdateSource='automatic_read_only_okx_account_sync';
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

export async function runOkxAccountReadOnce({env=process.env,fetchImpl=fetch,now=Date.now}={}){
  if(running)return {ok:false,reason:'already_running'};
  running=true;
  const at=new Date(now()).toISOString(),creds=readOkxCredentials(env);
  try{
    if(!env.DATABASE_URL)return {ok:false,reason:'no_database'};
    if(!creds.ok){
      await updatePrivateState(env,current=>mergeOkxAccountState(current,{
        status:creds.error?'DISABLED_INVALID_API_BASE':'DISABLED_MISSING_CREDENTIALS',
        error:creds.error,attemptAt:at,configured:false,apiBase:creds.apiBase
      }));
      return {ok:false,reason:creds.error||'missing_credentials'};
    }
    const snapshot=await fetchOkxAccountSnapshot({...creds,fetchImpl,now});
    const applied=await updatePrivateState(env,current=>mergeOkxAccountState(current,{
      snapshot,status:'OK',attemptAt:at,successAt:at,configured:true,apiBase:creds.apiBase
    }));
    return {ok:applied,totalEqUsd:snapshot.totalEqUsd,currencyCount:snapshot.currencyCount,source:snapshot.source,readOnly:true};
  }catch(e){
    const msg=String(e?.message||e);
    try{
      if(env.DATABASE_URL)await updatePrivateState(env,current=>mergeOkxAccountState(current,{
        status:'ERROR',error:msg,attemptAt:at,configured:creds.ok,apiBase:creds.apiBase
      }));
    }catch{}
    return {ok:false,reason:msg};
  }finally{running=false}
}

export function startOkxAccountReadSync({env=process.env,fetchImpl=fetch}={}){
  const mins=Math.max(5,Number(env.MERIDIAN_OKX_READ_SYNC_MINUTES||5));
  const creds=readOkxCredentials(env);
  if(!env.DATABASE_URL){
    console.log('[OKX_ACCOUNT_READ] disabled · missing database');
    return {enabled:false,reason:'no_database'};
  }
  const tick=async()=>{
    const r=await runOkxAccountReadOnce({env,fetchImpl});
    console.log('[OKX_ACCOUNT_READ]',r.ok?'ok':'not-ready',{...r,totalEqUsd:r.ok?'[present]':undefined});
  };
  setTimeout(tick,11000);
  if(!creds.ok){
    console.log('[OKX_ACCOUNT_READ] waiting for read-only credentials · diagnostic will be published once');
    return {enabled:false,configured:false,intervalMin:mins,readOnly:true,reason:creds.error||'missing_credentials'};
  }
  const timer=setInterval(tick,mins*60000);timer.unref?.();
  console.log('[OKX_ACCOUNT_READ] enabled · every '+mins+' min · '+creds.apiBase);
  return {enabled:true,configured:true,intervalMin:mins,readOnly:true,apiBase:creds.apiBase};
}
