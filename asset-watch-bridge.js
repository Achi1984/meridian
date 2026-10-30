import crypto from 'node:crypto';
import {WALLET_SCOPE,safeOverwriteRejectionReasons} from './asset-watch-scope.js';

const DEFAULT_STALE_MS=15*60*1000;
const FUTURE_SKEW_MS=5*60*1000;

function num(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
const positiveMetric=value=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;
function text(v){
  const s=String(v??'').trim();
  return s||null;
}
function tsMs(v){
  const n=Date.parse(String(v||''));
  return Number.isFinite(n)?n:null;
}
function freshAt(v,now,staleMs){
  const t=tsMs(v);
  return t!=null&&t<=now+FUTURE_SKEW_MS&&now-t<=staleMs;
}
function botRef(bot={}){
  const raw=String(bot.botOrderId||bot.id||'').trim();
  if(!raw)return null;
  return crypto.createHash('sha256').update('MERIDIAN_ASSET_WATCH_V1|'+raw).digest('hex').slice(0,20);
}
function normalizedSide(v){
  const s=String(v||'').trim().toUpperCase();
  return ['LONG','SHORT','NEUTRAL'].includes(s)?s:null;
}
// Only explicit normalized enums cross the sanitized boundary. Never infer
// COIN-M from the symbol, side or investment currency; missing remains unknown.
function projectedEnum(value,allowed){
  if(typeof value!=='string'||value.length>128)return null;
  const normalized=value.trim();
  return allowed.includes(normalized)?normalized:null;
}
function sanitizedBot(bot={}){
  const symbol=String(bot.symbol||'').trim().toUpperCase()||null;
  const side=normalizedSide(bot.side);
  return {
    botRef:botRef(bot),
    symbol,
    side,
    cateType:projectedEnum(bot.cateType,['inverse','linear','FUTURES_MOON',
      'FUTURE_GRID_COIN_MARGINED','FULLY_HEDGING','SPOT']),
    botType:projectedEnum(bot.botType,['futures_grid','future_hedge_grid']),
    sideSource:projectedEnum(bot.sideSource,['economic_inverse_asset','trend_inverse_asset','trend']),
    leverage:num(bot.leverage),
    limits:{
      lower:num(bot.lower),
      upper:num(bot.upper),
      liquidationPrice:num(bot.liquidationPrice),
      liquidationLowerBound:positiveMetric(bot.liquidationLowerBound),
      liquidationUpperBound:positiveMetric(bot.liquidationUpperBound),
      takeProfit:num(bot.takeProfit),
      stopLoss:num(bot.stopLoss)
    },
    grid:{
      grids:num(bot.grids)
    },
    position:{
      size:num(bot.position),
      positionOpenPrice:num(bot.positionOpenPrice),
      breakEvenPrice:null,
      breakEvenSource:'NOT_EXPOSED_BY_PIONEX_BOT_API'
    },
    margin:{
      extraMargin:num(bot.extraMargin),
      riskStatus:text(bot.riskStatus),
      marginStatus:text(bot.marginStatus)
    },
    investment:{
      usd:num(bot.investmentUsd),
      currency:text(bot.investCurrency),
      quoteAmount:num(bot.quoteInvestment)
    },
    pnl:{
      usd:num(bot.pnlUsd),
      totalProfitPct:num(bot.totalProfitPct)
    },
    source:text(bot.source)
  };
}
function coverageFor(risk={}, {truncated=false,status=null}={}){
  const raw=risk?.coverage&&typeof risk.coverage==='object'?risk.coverage:{};
  const rawStatus=String(raw.status||'').toUpperCase();
  const syncStatus=String(status||'').toUpperCase();
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const listRows=count(raw.listRows)??count(risk.apiRows);
  const recognizedRows=count(raw.recognizedRows)??count(risk.supportedRows);
  const representedRows=count(raw.representedRows)??count(risk.botCount);
  const unsupportedRows=count(raw.unsupportedRows)??count(risk.unsupportedRows);
  const unhydratedRows=count(raw.unhydratedRows)??(
    count(risk.supportedRows)!==null&&representedRows!==null
      ?Math.max(0,risk.supportedRows-representedRows):count(risk.rejectedCount));
  const paginationComplete=truncated===true||risk.paginationComplete===false||
    raw.paginationComplete===false?false:
      risk.paginationComplete===true||raw.paginationComplete===true?true:null;
  const pages=count(raw.pages),pageLimit=count(raw.pageLimit);
  const partial=unsupportedRows>0||unhydratedRows>0||paginationComplete===false||
    rawStatus==='PARTIAL'||syncStatus==='PARTIAL'||risk.detailsComplete===false||
    risk.supportedScope?.exclusionsVerified===false;
  return {
    status:partial?'PARTIAL':raw.status==='DOCUMENTED'?'DOCUMENTED':
      raw.status==='UNVERIFIED'?'UNVERIFIED':'UNKNOWN',
    providerContractStatus:raw.providerContractStatus==='DOCUMENTED'?'DOCUMENTED':'UNVERIFIED',
    liveAccountVerification:raw.liveAccountVerification==='NOT_PERFORMED'?'NOT_PERFORMED':'UNKNOWN',
    listRows,recognizedRows,representedRows,unsupportedRows,unhydratedRows,
    paginationComplete,pages,pageLimit
  };
}
function candidate({name,risk,status,lastSuccessAt,truncated=false,now,staleMs}){
  if(!risk||typeof risk!=='object')return null;
  const snapshotAt=risk.snapshotAt||risk.updatedAt||lastSuccessAt||null;
  const detailsComplete=risk.detailsComplete===true;
  const normalizedStatus=String(status||'').toUpperCase();
  const coverage=coverageFor(risk,{truncated,status});
  const incomplete=truncated===true||risk.paginationComplete===false||
    risk.coverage?.paginationComplete===false||
    String(risk.coverage?.status||'').toUpperCase()==='PARTIAL'||
    normalizedStatus==='PARTIAL'||risk.detailsComplete===false;
  const statusOk=normalizedStatus==='OK'||(normalizedStatus==='PARTIAL'&&incomplete);
  const fresh=freshAt(snapshotAt,now,staleMs);
  const rows=Array.isArray(risk.bots)?risk.bots:[];
  return {
    name,
    risk,
    snapshotAt,
    detailsComplete,
    coverage,
    statusOk,
    fresh,
    incomplete,
    syncStatus:normalizedStatus,
    rows,
    usable:statusOk&&detailsComplete&&fresh
  };
}
function pickSource(data,now,staleMs,preferOverwrite){
  const primary=candidate({
    name:'PIONEX_BOT_API',
    risk:data?.pionexRiskPartial||data?.pionexRisk,
    status:data?.pionexBotSync?.status,
    truncated:data?.pionexBotSync?.truncated===true,
    lastSuccessAt:data?.pionexBotSync?.lastSuccessAt,
    now,staleMs
  });
  const wallet=candidate({
    name:'PIONEX_WALLET_BOT_DETAIL',
    risk:data?.pionexAccount?.walletBotRisk,
    status:data?.pionexAccountSync?.status,
    truncated:data?.pionexAccountSync?.truncated===true,
    lastSuccessAt:data?.pionexAccountSync?.lastSuccessAt,
    now,staleMs
  });
  if(preferOverwrite){
    const qualified=[primary,wallet].find(item=>
      item&&projectSnapshot(item,now,staleMs).usableForOverwrite);
    if(qualified)return qualified;
  }
  if(primary?.usable)return primary;
  if(wallet?.usable)return wallet;
  const available=[primary,wallet].filter(Boolean);
  available.sort((a,b)=>(tsMs(b.snapshotAt)||0)-(tsMs(a.snapshotAt)||0));
  return available[0]||null;
}
function stableSortBots(rows){
  return rows.slice().sort((a,b)=>
    String(a.symbol||'').localeCompare(String(b.symbol||''))||
    String(a.side||'').localeCompare(String(b.side||''))||
    String(a.botRef||'').localeCompare(String(b.botRef||''))
  );
}
function fingerprint(bots){
  const raw=JSON.stringify(bots);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function buildAssetWatchApiSnapshot(data,{now=Date.now(),staleMs=DEFAULT_STALE_MS,preferOverwrite=false}={}){
  return projectSnapshot(pickSource(data||{},now,staleMs,preferOverwrite),now,staleMs);
}
function projectSnapshot(selected,now,staleMs){
  const sourceRows=selected?.rows||[],seen=new Set();
  const bots=stableSortBots(sourceRows.map(sanitizedBot).filter(bot=>{
    if(!bot.symbol||!/^[A-Z0-9][A-Z0-9_/-]{0,31}$/.test(bot.symbol)||
      !bot.side||!bot.botRef||seen.has(bot.botRef))return false;
    seen.add(bot.botRef);return true;
  }));
  const coverage={...(selected?.coverage||coverageFor())};
  const droppedRows=sourceRows.length-bots.length;
  coverage.representedRows=bots.length;
  coverage.unhydratedRows=coverage.unhydratedRows===null?droppedRows:coverage.unhydratedRows+droppedRows;
  if(coverage.unsupportedRows>0||coverage.unhydratedRows>0||coverage.paginationComplete===false)
    coverage.status='PARTIAL';
  const snapshotAt=selected?.snapshotAt||null;
  const ageMs=tsMs(snapshotAt)==null?null:Math.max(0,now-tsMs(snapshotAt));
  const usableForDisplay=selected?.usable===true;
  const risk=selected?.risk||{},scope=risk.supportedScope;
  const wallet=selected?.name==='PIONEX_WALLET_BOT_DETAIL';
  const walletScopeVerified=wallet&&scope?.schemaVersion===WALLET_SCOPE&&
    scope.botType==='futures_grid'&&scope.exclusionsVerified===true&&
    Number.isSafeInteger(scope.excludedRows)&&scope.excludedRows>=0&&
    scope.excludedRows===coverage.unsupportedRows&&
    risk.apiRows===coverage.listRows&&risk.supportedRows===coverage.recognizedRows&&
    risk.unsupportedRows===coverage.unsupportedRows&&coverage.recognizedRows>0&&
    coverage.listRows===coverage.recognizedRows+coverage.unsupportedRows;
  const reasons=[];
  if(!selected)reasons.push('SOURCE_UNAVAILABLE');
  if(wallet?!walletScopeVerified:coverage.unsupportedRows>0)reasons.push('UNSUPPORTED_SCOPE');
  if(coverage.unhydratedRows>0||wallet&&
    (risk.detailRows!==risk.supportedRows||bots.length!==risk.supportedRows||
      risk.normalizedRows!==bots.length||risk.botCount!==bots.length))
    reasons.push('SUPPORTED_HYDRATION_MISSING');
  if(droppedRows>0||wallet&&(risk.rejectedCount>0||scope?.identityComplete===false||
    bots.some(bot=>bot.botType!=='futures_grid')))
    reasons.push('SANITIZATION_LOSS_OR_DUPLICATE');
  if(coverage.paginationComplete===false||wallet&&coverage.paginationComplete!==true)
    reasons.push('PAGINATION_INCOMPLETE');
  if(String(risk.coverage?.status||'').toUpperCase()==='PARTIAL')reasons.push('EXPLICIT_PARTIAL');
  if(selected?.syncStatus==='PARTIAL')reasons.push('SYNC_PARTIAL');
  if(!selected?.detailsComplete)reasons.push('DETAILS_INCOMPLETE');
  if(!selected?.statusOk)reasons.push('SOURCE_STATUS_NOT_OK');
  if(!selected?.fresh)reasons.push('SOURCE_STALE');
  const overwriteRejectionReasons=safeOverwriteRejectionReasons(reasons);
  const usableForOverwrite=usableForDisplay&&!selected?.incomplete&&
    overwriteRejectionReasons.length===0;
  return {
    schemaVersion:'MERIDIAN-ASSET-WATCH-BRIDGE-V1',
    readOnly:true,
    executionImpact:false,
    generatedAt:new Date(now).toISOString(),
    source:selected?.name||'UNAVAILABLE',
    sourceSnapshotAt:snapshotAt,
    sourceAgeMs:ageMs,
    freshnessLimitMs:staleMs,
    detailsComplete:selected?.detailsComplete===true,
    coverage,
    sourceStatusOk:selected?.statusOk===true,
    fresh:selected?.fresh===true,
    usableForDisplay,
    usableForOverwrite,
    overwriteScope:walletScopeVerified?'WALLET_FUTURES_GRID':
      wallet||!selected?'NONE':'PRIMARY_BOT_API',
    excludedScope:wallet&&!walletScopeVerified?'UNVERIFIED':coverage.unsupportedRows>0
      ?walletScopeVerified?'KNOWN_EXCLUDED_PRODUCTS':'UNVERIFIED':'NONE',
    overwriteRejectionReasons,
    overwriteRule:'ONLY_WHEN_usableForOverwrite_IS_TRUE',
    botCount:bots.length,
    snapshotFingerprint:fingerprint(bots),
    bots,
    fieldSemantics:{
      positionOpenPrice:'PIONEX_API_POSITION_OPEN_PRICE_NOT_BREAK_EVEN',
      breakEvenPrice:'NOT_EXPOSED_BY_OFFICIAL_PIONEX_FUTURES_GRID_DETAIL_API',
      screenshotBreakEven:'KEEP_EXISTING_REFERENCE_UNTIL_NEW_SCREENSHOT_OR_DIRECT_SOURCE'
    }
  };
}
