import pg from 'pg';
import {pionexReadGet} from './pionex-read-client.js';
import {PIONEX_FUTURES_GRID_DETAIL_PATH,mergePionexOrderDetail} from './pionex-bot-detail-read.js';
import {inspectPionexBotOrder,normalizePionexBotOrder} from './pionex-bot-auto-sync.js';

const {Pool}=pg;
const PRIVATE_STATE_KEY='private_dashboard_v1';

function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function text(v){const s=String(v??'').trim();return s||null}
function baseAsset(v){return String(v||'').toUpperCase().replace(/\.PERP$/,'').replace(/[-_/](USDT|USDC|USD)_?PERP$/,'').replace(/[-_/](USDT|USDC|USD)$/,'')||null}

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
    asset:baseAsset(x?.symbol),
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

function fieldNames(rows){
  const set=new Set();
  for(const row of Array.isArray(rows)?rows:[])if(row&&typeof row==='object'&&!Array.isArray(row))for(const k of Object.keys(row))set.add(String(k));
  return [...set].sort().slice(0,40);
}
function normalizeWalletPrices(prices={}){
  const out={};
  for(const [coin,row] of Object.entries(prices&&typeof prices==='object'?prices:{})){
    const symbol=String(coin||'').trim().toUpperCase();if(!symbol)continue;
    const priceInUsd=num(row?.priceInUsd),priceInBtc=num(row?.priceInBtc);
    if(priceInUsd!=null||priceInBtc!=null)out[symbol]={priceInUsd,priceInBtc};
  }
  return out;
}
function inverseWalletProfitUsd(wallet,row,walletPrices={}){
  const cate=String(wallet?.cateType||'').trim().toLowerCase(),token=String(wallet?.investmentToken||'').trim().toUpperCase(),symbol=String(row?.symbol||'').trim().toUpperCase(),profit=wallet?.profit==null||wallet?.profit===''?null:num(wallet.profit);
  if(cate!=='inverse'||profit==null||!token||token!==symbol)return{value:null,token:token||null,source:'NONE'};
  const rawPx=walletPrices?.[token]?.priceInUsd,px=rawPx==null||rawPx===''?null:num(rawPx);
  if(!(px>0))return{value:null,token,source:'NO_WALLET_USD_PRICE'};
  return{value:profit*px,token,source:'WALLET_PROFIT_X_PIONEX_WALLET_PRICE'};
}
function normalizeWalletCategories(rows=[]){
  return (Array.isArray(rows)?rows:[]).map(x=>({
    type:text(x?.type),
    title:text(x?.title),
    totalInUsdt:num(x?.totalInUsdt),
    count:Number.isInteger(Number(x?.count))?Number(x.count):null,
    hasMore:x?.hasMore===true,
    listCount:Array.isArray(x?.list)?x.list.length:0,
    entryFields:fieldNames(x?.list),
    balanceCount:Array.isArray(x?.balances)?x.balances.length:0,
    positionCount:Array.isArray(x?.positions)?x.positions.length:0,
    balanceFields:fieldNames(x?.balances),
    positionFields:fieldNames(x?.positions)
  })).filter(x=>x.type||x.title||x.count!=null||x.listCount||x.balanceCount||x.positionCount);
}
function countBy(rows,key){
  const out={};
  for(const row of Array.isArray(rows)?rows:[]){
    const v=String(row?.[key]||'UNKNOWN').trim()||'UNKNOWN';
    out[v]=(out[v]||0)+1;
  }
  return out;
}
export function normalizeWalletBotEntries(detail=[]){
  const out=[];
  for(const category of Array.isArray(detail)?detail:[]){
    const categoryType=String(category?.type||'').toUpperCase();
    if(!['TRADING_BOT','FUTURES_LITE'].includes(categoryType))continue;
    for(const row of Array.isArray(category?.list)?category.list:[]){
      const buOrderId=text(row?.buOrderId);
      if(!buOrderId)continue;
      out.push({
        walletCategory:categoryType,
        buOrderId,
        buOrderType:text(row?.buOrderType),
        cateType:text(row?.cateType),
        baseList:Array.isArray(row?.baseList)?row.baseList.map(x=>text(x)).filter(Boolean):[],
        investmentAmount:num(row?.investmentAmount),
        investmentToken:text(row?.investmentToken),
        profit:num(row?.profit),
        source:'PIONEX_WALLET_READ_API'
      });
    }
  }
  return out;
}
export async function probeWalletBotDetails(entries=[],{apiKey,apiSecret,fetchImpl=fetch,now=Date.now,delayMs=125,maxRows=50}={}){
  const rows=Array.isArray(entries)?entries:[];
  if(rows.length>maxRows)throw new Error('pionex_wallet_bot_probe_row_limit');
  const details=[],failures=[];
  const seen=new Set();
  for(let i=0;i<rows.length;i++){
    const row=rows[i],id=String(row?.buOrderId||'').trim();
    if(!id||seen.has(id)){failures.push({buOrderId:id||null,reason:id?'duplicate_id':'missing_id'});continue;}
    seen.add(id);
    try{
      const j=await pionexReadGet(PIONEX_FUTURES_GRID_DETAIL_PATH,{buOrderId:id},{apiKey,apiSecret,fetchImpl,now});
      const data=j?.data;
      if(!data||typeof data!=='object')throw new Error('detail_invalid');
      details.push({wallet:row,detail:data});
    }catch(e){
      failures.push({buOrderId:id,reason:String(e?.message||e).slice(0,120)});
    }
    if(i<rows.length-1&&delayMs>0)await new Promise(r=>setTimeout(r,delayMs));
  }
  return {
    candidateCount:rows.length,
    successCount:details.length,
    failureCount:failures.length,
    buOrderTypeCounts:countBy(rows,'buOrderType'),
    cateTypeCounts:countBy(rows,'cateType'),
    successBuOrderTypeCounts:countBy(details.map(x=>x.wallet),'buOrderType'),
    successCateTypeCounts:countBy(details.map(x=>x.wallet),'cateType'),
    details,
    failures
  };
}

export function buildWalletBotRisk(probe={},iso=new Date().toISOString(),walletPrices={}){
  const details=Array.isArray(probe?.details)?probe.details:[],expected=Number(probe?.buOrderTypeCounts?.futures_grid)||0,detailSuccess=Number(probe?.successBuOrderTypeCounts?.futures_grid)||0,unsupported=Math.max(0,(Number(probe?.candidateCount)||0)-expected);
  const bots=[],rejected=[],seen=new Set(),statusCounts={},trendCounts={},rejectReasonCounts={},envelopeFields=new Set(),botDataFields=new Set(),baseClassCounts={},quoteClassCounts={},pnlSourceCounts={};
  let detailBasePresentCount=0,walletBaseFallbackCount=0,missingBaseCount=0,typePassCount=0,statusPassCount=0,symbolPassCount=0,sidePassCount=0,allStagePassCount=0,pnlUsdRows=0,walletProfitRows=0;
  const bump=(obj,key)=>{const k=String(key||'UNKNOWN');obj[k]=(obj[k]||0)+1;};
  const reject=reason=>{const r=String(reason||'unknown').slice(0,80);rejected.push({reason:r});bump(rejectReasonCounts,r);};
  for(const item of details){
    const wallet=item?.wallet||{},detail=item?.detail||{};
    if(String(wallet?.buOrderType||'')!=='futures_grid')continue;
    Object.keys(detail||{}).forEach(k=>envelopeFields.add(String(k)));
    Object.keys(detail?.buOrderData||{}).forEach(k=>botDataFields.add(String(k)));
    const id=String(wallet?.buOrderId||'').trim();
    if(!id||seen.has(id)){reject(id?'duplicate_id':'missing_id');continue;}
    seen.add(id);
    try{
      const directBase=String(detail?.base||'').trim(),walletBase=String(wallet?.baseList?.[0]||'').trim();
      if(directBase)detailBasePresentCount++;
      else if(walletBase)walletBaseFallbackCount++;
      else missingBaseCount++;
      const summary={
        buOrderType:'futures_grid',
        buOrderId:id,
        base:directBase||walletBase||null,
        quote:detail?.quote||wallet?.investmentToken||null,
        cateType:wallet?.cateType||detail?.cateType||detail?.buOrderData?.cateType||null,
        status:detail?.status||detail?.buOrderData?.status||'running',
        buOrderData:{}
      };
      const merged=mergePionexOrderDetail(summary,detail),d=merged?.buOrderData||{},status=String(d?.status||merged?.status||'UNKNOWN').trim().toLowerCase()||'unknown',trend=String(d?.trend||'UNKNOWN').trim().toLowerCase()||'unknown',check=inspectPionexBotOrder(merged);
      bump(statusCounts,status);bump(trendCounts,trend);bump(baseClassCounts,check.baseClass);bump(quoteClassCounts,check.quoteClass);
      if(check.typePass)typePassCount++;
      if(check.statusPass)statusPassCount++;
      if(check.symbolPass)symbolPassCount++;
      if(check.sidePass)sidePassCount++;
      if(check.typePass&&check.statusPass&&check.symbolPass&&check.sidePass)allStagePassCount++;
      const row=normalizePionexBotOrder(merged);
      if(!row){
        if(!String(merged?.base||'').trim())reject('missing_base');
        else if(!['long','short','no_trend'].includes(trend))reject('invalid_trend');
        else if(['destroy_grid','close_position','unlock_currency','canceled'].includes(status))reject('inactive_status');
        else reject('normalizer_rejected');
        continue;
      }
      const walletPnl=inverseWalletProfitUsd(wallet,row,walletPrices),detailPnl=row?.pnlUsd==null||row?.pnlUsd===''?null:num(row.pnlUsd),resolvedPnl=detailPnl!=null?detailPnl:walletPnl.value;
      const pnlSource=detailPnl!=null?'BOT_DETAIL_USD':walletPnl.source,walletProfit=wallet?.profit==null||wallet?.profit===''?null:num(wallet.profit);
      if(walletProfit!=null)walletProfitRows++;
      if(resolvedPnl!=null)pnlUsdRows++;
      bump(pnlSourceCounts,pnlSource);
      const resolvedInvest=row?.investmentUsd==null||row?.investmentUsd===''?null:num(row.investmentUsd),detailPct=row?.totalProfitPct==null||row?.totalProfitPct===''?null:num(row.totalProfitPct),derivedPct=resolvedPnl!=null&&resolvedInvest>0?resolvedPnl/resolvedInvest*100:null;
      bots.push({...row,pnlUsd:resolvedPnl,totalProfitPct:detailPct??derivedPct,pnlSource,walletProfitNative:walletProfit,walletProfitToken:walletPnl.token,source:'PIONEX_WALLET_BOT_DETAIL'});
    }catch(e){reject(String(e?.message||e))}
  }
  const ids=new Set(bots.map(x=>String(x?.botOrderId||x?.id||'')));
  const unique=ids.size===bots.length,detailsComplete=expected>0&&detailSuccess===expected&&bots.length===expected&&rejected.length===0&&unique;
  return {
    source:'PIONEX_WALLET_BOT_DETAIL',
    syncMode:'WALLET_BOT_DETAIL_FALLBACK',
    updatedAt:iso,
    snapshotAt:iso,
    apiRows:Number(probe?.candidateCount)||0,
    supportedRows:expected,
    detailRows:detailSuccess,
    unsupportedRows:unsupported,
    normalizedRows:bots.length,
    detailsComplete,
    bots,
    botCount:bots.length,
    rejectedCount:rejected.length,
    rejectReasonCounts,
    statusCounts,
    trendCounts,
    typePassCount,
    statusPassCount,
    symbolPassCount,
    sidePassCount,
    allStagePassCount,
    pnlUsdRows,
    walletProfitRows,
    pnlSourceCounts,
    baseClassCounts,
    quoteClassCounts,
    detailBasePresentCount,
    walletBaseFallbackCount,
    missingBaseCount,
    detailEnvelopeFields:[...envelopeFields].sort().slice(0,40),
    detailBotDataFields:[...botDataFields].sort().slice(0,80),
    rejected
  };
}
export function normalizeWalletOverview(data={}){
  const bot=data?.botAccount||{},trader=data?.traderAccount||{};
  const botCategories=normalizeWalletCategories(bot?.detail);
  const traderCategories=normalizeWalletCategories(trader?.detail);
  const botEntries=normalizeWalletBotEntries(bot?.detail);
  return {
    totalInUsdt:num(data?.totalInUsdt),
    totalInBtc:num(data?.totalInBtc),
    prices:normalizeWalletPrices(data?.prices||{}),
    botAccountTotalInUsdt:num(bot?.totalInUsdt),
    traderAccountTotalInUsdt:num(trader?.totalInUsdt),
    botCategories,
    traderCategories,
    botEntries,
    botEntryCount:botEntries.length,
    botBuOrderTypeCounts:countBy(botEntries,'buOrderType'),
    botCateTypeCounts:countBy(botEntries,'cateType'),
    botCategoryCount:botCategories.length,
    botReportedCount:botCategories.reduce((n,x)=>n+(Number.isFinite(x.count)?x.count:x.listCount),0),
    botListCount:botCategories.reduce((n,x)=>n+x.listCount,0),
    traderCategoryCount:traderCategories.length,
    source:'PIONEX_WALLET_READ_API'
  };
}

export async function fetchPionexReadSnapshot({apiKey,apiSecret,fetchImpl=fetch,now=Date.now}={}){
  const [spot,fut,positions,walletResult]=await Promise.all([
    pionexReadGet('/api/v1/account/balances',{}, {apiKey,apiSecret,fetchImpl,now}),
    pionexReadGet('/uapi/v1/account/balances',{}, {apiKey,apiSecret,fetchImpl,now}),
    pionexReadGet('/uapi/v1/account/positions',{}, {apiKey,apiSecret,fetchImpl,now}),
    pionexReadGet('/api/v1/wallet/balancesFull',{}, {apiKey,apiSecret,fetchImpl,now}).then(value=>({ok:true,value}),error=>({ok:false,error:String(error?.message||error)}))
  ]);
  const futures=normalizeFuturesBalances(fut?.data||{});
  const normalizedPositions=normalizeFuturesPositions(positions?.data||{});
  const wallet=walletResult.ok?normalizeWalletOverview(walletResult.value?.data||{}):null;
  const walletBotProbe=walletResult.ok?await probeWalletBotDetails(wallet?.botEntries||[],{apiKey,apiSecret,fetchImpl,now}):null;
  const spotBalances=normalizeSpotBalances(spot?.data||{});
  const at=new Date(now()).toISOString();
  const walletBotRisk=walletBotProbe?buildWalletBotRisk(walletBotProbe,at,wallet?.prices||{}):null;
  return {
    source:'PIONEX_READ_API',
    readOnly:true,
    updatedAt:at,
    snapshotAt:at,
    spotBalances,
    futuresBalances:futures.balances,
    isolatedBalances:futures.isolates,
    futuresPositions:normalizedPositions,
    wallet,
    walletBotProbe,
    walletBotRisk,
    walletStatus:walletResult.ok?'OK':'ERROR',
    walletError:walletResult.ok?null:walletResult.error,
    spotBalanceCount:spotBalances.length,
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
      'GET /uapi/v1/account/positions',
      'GET /api/v1/wallet/balancesFull'
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
      futuresPositionCount:snapshot.futuresPositionCount,
      walletStatus:snapshot.walletStatus,
      walletBotCategoryCount:snapshot.wallet?.botCategoryCount??0,
      walletBotReportedCount:snapshot.wallet?.botReportedCount??0,
      walletBotListCount:snapshot.wallet?.botListCount??0,
      walletBotCandidateCount:snapshot.walletBotProbe?.candidateCount??0,
      walletBotDetailSuccessCount:snapshot.walletBotProbe?.successCount??0,
      walletBotDetailFailureCount:snapshot.walletBotProbe?.failureCount??0,
      walletBotRiskRows:snapshot.walletBotRisk?.botCount??0,
      walletBotRiskSupportedRows:snapshot.walletBotRisk?.supportedRows??0,
      walletBotRiskRejectedCount:snapshot.walletBotRisk?.rejectedCount??0,
      walletBotRiskTypePassCount:snapshot.walletBotRisk?.typePassCount??0,
      walletBotRiskStatusPassCount:snapshot.walletBotRisk?.statusPassCount??0,
      walletBotRiskSymbolPassCount:snapshot.walletBotRisk?.symbolPassCount??0,
      walletBotRiskSidePassCount:snapshot.walletBotRisk?.sidePassCount??0,
      walletBotRiskComplete:snapshot.walletBotRisk?.detailsComplete===true
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
