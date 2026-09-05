const API_BASE=(window.MERIDIAN_V8_CONFIG?.apiBase||'').replace(/\/$/,'');
const TOKEN_KEY='meridian.v8.readToken';

export function setReadToken(token){
  const v=String(token||'').trim();
  if(v) sessionStorage.setItem(TOKEN_KEY,v); else sessionStorage.removeItem(TOKEN_KEY);
}
export function hasReadToken(){return !!sessionStorage.getItem(TOKEN_KEY)}
function authHeaders(){const t=sessionStorage.getItem(TOKEN_KEY);return t?{authorization:`Bearer ${t}`}:{}}
export async function getJson(path){
  const r=await fetch(`${API_BASE}${path}`,{cache:'no-store',headers:{accept:'application/json',...authHeaders()}});
  if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.status=r.status;throw e}
  return r.json();
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function livePrice(data,h){return n(data?.livePrices?.[h?.symbol]?.price)}
function holdingValue(data,h){
  const q=n(h?.quantity),live=livePrice(data,h),own=n(h?.price),stored=n(h?.value)??n(h?.valueUsd)??n(h?.usdValue);
  if(q!=null&&q>=0&&live!=null&&live>0)return q*live;
  if(q!=null&&q>=0&&own!=null&&own>0)return q*own;
  return stored??0;
}
function spotHoldings(data){
  const hs=data?.portfolio?.holdings;
  return Array.isArray(hs)?hs.filter(h=>String(h?.venue||'').toLowerCase()!=='pionex'):[];
}
function holdingsValue(data){return spotHoldings(data).reduce((sum,h)=>sum+holdingValue(data,h),0)}
function tradingValue(data){
  const direct=n(data?.portfolio?.pionexEquityUsd)??n(data?.pionexEquityUsd)??n(data?.pionexRisk?.equityUsd);
  if(direct!=null&&direct>=0)return direct;
  const rows=Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[];
  const row=rows.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
  return n(row?.value)??n(row?.valueUsd)??0;
}
function canonicalTotal(data){return holdingsValue(data)+tradingValue(data)}
function normalizeBot(b){
  return {
    id:String(b?.id||b?.botId||b?.name||b?.symbol||'BOT'),
    symbol:String(b?.symbol||b?.asset||'').toUpperCase(),
    buffer:n(b?.pionexLiqBufferPct)??n(b?.liqBufferPct)??n(b?.liquidationDistancePct),
    status:String(b?.status||b?.riskState||'').toUpperCase(),
    side:String(b?.side||b?.direction||'').toUpperCase(),
    leverage:n(b?.leverage)??n(b?.leverageX),
    liquidationPrice:n(b?.pionexLiquidationPrice)??n(b?.liquidationPrice)??n(b?.liqPrice),
    breakEvenPrice:n(b?.breakEvenPrice)??n(b?.breakevenPrice),
    pnlUsd:n(b?.pnlUsd)??n(b?.unrealizedPnlUsd)??n(b?.pnl),
    investmentUsd:n(b?.investmentUsd)??n(b?.investedUsd)??n(b?.marginUsd)
  };
}
function botRows(data){
  const xs=data?.pionexRisk?.bots;
  return Array.isArray(xs)?xs.map(normalizeBot):[];
}
function riskState(data){
  const bots=botRows(data).filter(b=>Number.isFinite(b.buffer)).sort((a,b)=>a.buffer-b.buffer);
  const b=bots[0]||null;
  if(!b)return {state:'CHECK',tone:'muted',bot:null,next:'Risikodaten prüfen',targetPct:null,remainingPct:null};
  if(b.buffer<8)return {state:'DANGER',tone:'danger',bot:b,next:`${b.id}: Buffer zuerst auf ≥8% bringen`,targetPct:8,remainingPct:8-b.buffer};
  if(b.buffer<12)return {state:'WATCH',tone:'watch',bot:b,next:`${b.id}: Buffer auf SAFE ≥12% erhöhen`,targetPct:12,remainingPct:12-b.buffer};
  return {state:'SAFE',tone:'safe',bot:b,next:'Keine akute Liquidationsmaßnahme',targetPct:null,remainingPct:0};
}
function marketState(data){
  const r=data?.market?.regime||data?.btcRegime?.label||data?.regime?.label;
  return r?String(r).toUpperCase():'—';
}
function bestOpportunity(data){
  const xs=data?.scanner?.opportunities||data?.scanner?.signals||data?.signals;
  if(!Array.isArray(xs))return null;
  const ready=xs.filter(x=>/READY|TRADE|ENTRY/.test(String(x?.status||x?.action||'').toUpperCase()));
  return ready.sort((a,b)=>(n(b?.confidence)||0)-(n(a?.confidence)||0))[0]||null;
}
function exposureSymbol(raw){
  const s=String(raw||'—').toUpperCase();
  if(s==='BETH')return 'ETH';
  if(s==='OKSOL')return 'SOL';
  return s;
}
function topPositions(data,total){
  const map=new Map();
  for(const h of spotHoldings(data)){
    const symbol=exposureSymbol(h?.symbol),value=holdingValue(data,h),venue=String(h?.venue||'').trim();
    const row=map.get(symbol)||{symbol,value:0,venues:new Set()};row.value+=value;if(venue)row.venues.add(venue);map.set(symbol,row);
  }
  return [...map.values()].sort((a,b)=>b.value-a.value).slice(0,4).map(x=>({symbol:x.symbol,value:x.value,pct:total>0?x.value/total*100:null,venue:[...x.venues].join(' + ')||'—'}));
}
function historyModel(raw,currentTotal,data){
  const points=Array.isArray(raw?.points)?raw.points.filter(p=>n(p?.timestamp)!=null&&n(p?.totalUsd)!=null).map(p=>({timestamp:n(p.timestamp),totalUsd:n(p.totalUsd),adjustedUsd:n(p.cashflowAdjustedTotalUsd)})):[];
  const now=Date.now();
  if(currentTotal!=null)points.push({timestamp:now,totalUsd:currentTotal,adjustedUsd:null});
  points.sort((a,b)=>a.timestamp-b.timestamp);
  const first=points[0]||null,last=points.at(-1)||null;
  const coverageMs=first&&last?last.timestamp-first.timestamp:0;
  const mature=points.length>=2&&coverageMs>=16.8*60*60*1000;
  const cumulative=n(data?.portfolio?.cumulativeCashflowUsd);
  const currentAdjusted=currentTotal!=null&&cumulative!=null?currentTotal-cumulative:null;
  let from=null,to=null,basis='RAW';
  if(first&&currentAdjusted!=null&&first.adjustedUsd!=null){from=first.adjustedUsd;to=currentAdjusted;basis='CASHFLOW_ADJUSTED'}
  else if(first&&currentTotal!=null){from=first.totalUsd;to=currentTotal}
  const delta=from!=null&&to!=null?to-from:null;
  const pct=delta!=null&&from?delta/from*100:null;
  return {source:String(raw?.source||'UNKNOWN'),points,coverageMs,mature,basis,performance:mature&&delta!=null?{deltaUsd:delta,pct}:null};
}
function normalizeLedger(key,x={}){
  return {
    key,name:key==='baseline'?'BASELINE':key==='shadow'?'SHADOW V1':key==='challenger'?'CHALLENGER V2':'REGIME V1',
    closedTrades:n(x?.closedTrades)??0,openTrades:n(x?.openTrades)??0,pnl:n(x?.pnl),expectancy:n(x?.expectancy),profitFactor:n(x?.profitFactor),
    winRate:n(x?.winRate),maxDrawdownPct:n(x?.maxDrawdownPct),tradesPerDay:n(x?.tradesPerDay),activeSpanDays:n(x?.activeSpanDays),
    retentionPct:n(x?.vsBaseline?.retentionPct),expectancyDelta:n(x?.vsBaseline?.expectancyDelta),pnlDelta:n(x?.vsBaseline?.pnlDelta)
  };
}
function paperModel(analytics={},activity={}){
  const ledgers=analytics?.ledgers||{};
  const keys=['baseline','shadow','challenger','regime'];
  const rows=keys.map(k=>normalizeLedger(k,ledgers[k]||{}));
  const common=activity?.commonWindow||null;
  const commonRows=common?.ledgers||{};
  for(const row of rows){
    const c=commonRows[row.key]||null;
    row.commonClosed=c?Number(c.closed||0):null;
    row.commonActiveDays=c?Number(c.activeDays||0):null;
  }
  const challenger=analytics?.opportunityCost?.challenger||{};
  const flags=analytics?.auditFlags||{};
  const warnings=[];
  if(flags.challengerBaselineReadyDependency)warnings.push('Challenger V2 hängt historisch an Baseline READY.');
  if(flags.regimeAdaptedSideUsesBaselineDirectionalScores)warnings.push('Regime V1 kann Side wechseln, nutzt aber teils Baseline-Richtungsscores.');
  if(flags.liveBacktestExitSequencingMismatch)warnings.push('Live/Backtest Exit-Sequencing ist als Audit-Risiko markiert.');
  return {
    ok:true,locked:false,source:'RESEARCH_ANALYTICS',researchOnly:analytics?.researchOnly!==false,executionImpact:analytics?.executionImpact===true,
    schemaVersion:String(analytics?.schemaVersion||'—'),rows,
    commonWindow:common?{days:n(common.days),start:common.start||null,end:common.end||null}:null,
    opportunityCost:{closed:n(challenger.closed)??0,missedWinners:n(challenger.missedWinners)??0,avoidedLosers:n(challenger.avoidedLosers)??0,netR:n(challenger.netCounterfactualR)},
    warnings
  };
}

export async function loadCenter(){
  try{
    const payload=await getJson('/api/private/dashboard');
    const data=payload?.data||payload;
    const risk=riskState(data);
    const opp=bestOpportunity(data);
    return {
      ok:true,locked:false,source:'PRIVATE_DASHBOARD',
      portfolioUsd:canonicalTotal(data),market:marketState(data),risk,
      nextAction:risk.next,
      opportunity:opp?{symbol:String(opp.symbol||opp.asset||'SETUP'),side:String(opp.side||opp.direction||''),confidence:n(opp.confidence)}:null
    };
  }catch(e){
    if(e?.status===401)return {ok:false,locked:true,source:'PRIVATE_DASHBOARD',error:'READ_TOKEN_REQUIRED'};
    return {ok:false,locked:false,source:'PRIVATE_DASHBOARD',error:String(e?.message||e)};
  }
}

export async function loadDepot(){
  try{
    const payload=await getJson('/api/private/dashboard');
    const data=payload?.data||payload;
    const spotUsd=holdingsValue(data),tradingUsd=tradingValue(data),totalUsd=spotUsd+tradingUsd;
    let historyRaw={source:'UNAVAILABLE',points:[]};
    try{historyRaw=await getJson('/api/private/portfolio-history?range=1d')}catch(_e){}
    return {
      ok:true,locked:false,source:'PRIVATE_DASHBOARD',totalUsd,spotUsd,tradingUsd,
      spotPct:totalUsd>0?spotUsd/totalUsd*100:null,tradingPct:totalUsd>0?tradingUsd/totalUsd*100:null,
      topPositions:topPositions(data,totalUsd),history:historyModel(historyRaw,totalUsd,data)
    };
  }catch(e){
    if(e?.status===401)return {ok:false,locked:true,source:'PRIVATE_DASHBOARD',error:'READ_TOKEN_REQUIRED'};
    return {ok:false,locked:false,source:'PRIVATE_DASHBOARD',error:String(e?.message||e)};
  }
}

export async function loadTrade(){
  try{
    const payload=await getJson('/api/private/dashboard');
    const data=payload?.data||payload;
    const bots=botRows(data).sort((a,b)=>{
      const av=Number.isFinite(a.buffer)?a.buffer:999,bv=Number.isFinite(b.buffer)?b.buffer:999;
      return av-bv;
    });
    const risk=riskState(data);
    return {
      ok:true,locked:false,source:'PRIVATE_DASHBOARD',
      risk,criticalBot:risk.bot,bots,
      activeCount:bots.length,
      tradingEquityUsd:tradingValue(data),
      nextAction:risk.next
    };
  }catch(e){
    if(e?.status===401)return {ok:false,locked:true,source:'PRIVATE_DASHBOARD',error:'READ_TOKEN_REQUIRED'};
    return {ok:false,locked:false,source:'PRIVATE_DASHBOARD',error:String(e?.message||e)};
  }
}

export async function loadPaper(){
  try{
    const [analytics,activity]=await Promise.all([getJson('/api/research-analytics'),getJson('/api/activity-summary')]);
    return paperModel(analytics,activity);
  }catch(e){
    if(e?.status===401)return {ok:false,locked:true,source:'RESEARCH_ANALYTICS',error:'READ_TOKEN_REQUIRED'};
    return {ok:false,locked:false,source:'RESEARCH_ANALYTICS',error:String(e?.message||e)};
  }
}
