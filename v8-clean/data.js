const API_BASE=(window.MERIDIAN_V8_CONFIG?.apiBase||'').replace(/\/$/,'');
const TOKEN_KEY='meridian.v8.readToken';

function readToken(){
  let v='';
  try{v=String(localStorage.getItem(TOKEN_KEY)||'').trim()}catch(_e){}
  if(v)return v;
  try{
    v=String(sessionStorage.getItem(TOKEN_KEY)||'').trim();
    if(v){localStorage.setItem(TOKEN_KEY,v);sessionStorage.removeItem(TOKEN_KEY)}
  }catch(_e){}
  return v;
}
export function setReadToken(token){
  const v=String(token||'').trim();
  try{if(v)localStorage.setItem(TOKEN_KEY,v);else localStorage.removeItem(TOKEN_KEY)}catch(_e){}
  try{sessionStorage.removeItem(TOKEN_KEY)}catch(_e){}
  try{window.dispatchEvent(new CustomEvent('meridian:v8-tokenchange',{detail:{connected:!!v}}))}catch(_e){}
}
export function hasReadToken(){return !!readToken()}
function authHeaders(){const t=readToken();return t?{authorization:`Bearer ${t}`}:{}}
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
function snapshotSpotValue(data){
  const p=data?.portfolio||{};
  return n(p?.canonicalSnapshot?.spotUsd)??n(p?.spotUsd)??n(p?.snapshotSpotValueUsd);
}
function spotValue(data){
  const live=holdingsValue(data);
  if(live>0)return {value:live,source:'HOLDINGS_LIVE'};
  const snap=snapshotSpotValue(data);
  if(snap!=null&&snap>=0)return {value:snap,source:'PRIVATE_SPOT_SNAPSHOT'};
  return {value:0,source:'MISSING'};
}
function tradingValue(data){
  const direct=n(data?.portfolio?.pionexEquityUsd)??n(data?.pionexEquityUsd)??n(data?.pionexRisk?.equityUsd);
  if(direct!=null&&direct>=0)return direct;
  const rows=Array.isArray(data?.portfolio?.manualVenueBalances)?data.portfolio.manualVenueBalances:[];
  const row=rows.find(x=>String(x?.venue||x?.name||'').toLowerCase()==='pionex');
  return n(row?.value)??n(row?.valueUsd)??0;
}
function canonicalTotal(data){return spotValue(data).value+tradingValue(data)}
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
  const computed=[...map.values()].filter(x=>x.value>0).sort((a,b)=>b.value-a.value).slice(0,4).map(x=>({symbol:x.symbol,value:x.value,pct:total>0?x.value/total*100:null,venue:[...x.venues].join(' + ')||'—'}));
  if(computed.length)return computed;
  const snap=Array.isArray(data?.portfolio?.topPositions)?data.portfolio.topPositions:[];
  return snap.map(x=>{
    const value=n(x?.value)??n(x?.valueUsd)??n(x?.usdValue);
    return {symbol:exposureSymbol(x?.symbol||x?.asset),value:value??0,pct:n(x?.pct)??n(x?.weightPct)??(value!=null&&total>0?value/total*100:null),venue:String(x?.venue||x?.custodian||'SNAPSHOT')};
  }).filter(x=>x.value>0).sort((a,b)=>b.value-a.value).slice(0,4);
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
    key,name:key==='baseline'?'BASELINE':key==='shadow'?'SHADOW V1':key==='challenger'?'CHALLENGER V2':key==='challengerV3'?'CHALLENGER V3':'REGIME V1',
    closedTrades:n(x?.closedTrades)??0,openTrades:n(x?.openTrades)??0,pnl:n(x?.pnl),expectancy:n(x?.expectancy),profitFactor:n(x?.profitFactor),
    winRate:n(x?.winRate),maxDrawdownPct:n(x?.maxDrawdownPct),tradesPerDay:n(x?.tradesPerDay),activeSpanDays:n(x?.activeSpanDays),
    retentionPct:n(x?.vsBaseline?.retentionPct),expectancyDelta:n(x?.vsBaseline?.expectancyDelta),pnlDelta:n(x?.vsBaseline?.pnlDelta)
  };
}
function reasonCounts(rows=[]){
  const counts=new Map();
  for(const row of rows){
    const reasons=Array.isArray(row?.reasons)&&row.reasons.length?row.reasons:[row?.status].filter(Boolean);
    for(const raw of reasons){const key=String(raw||'UNKNOWN').toUpperCase();counts.set(key,(counts.get(key)||0)+1)}
  }
  return [...counts.entries()].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason));
}
function gateReasons(lastSignal={}){
  const raw=Array.isArray(lastSignal?.gate?.reasons)?lastSignal.gate.reasons:Array.isArray(lastSignal?.reasons)?lastSignal.reasons:[];
  return [...new Set(raw.map(x=>String(x||'').toUpperCase()).filter(Boolean))];
}
function recentTrades(baseline={},challenger={},challengerV3={}){
  const base=Array.isArray(baseline?.trades)?baseline.trades.filter(x=>x?.status==='CLOSED').map(x=>({...x,bot:'baseline'})):[];
  const chall=Array.isArray(challenger?.recentClosed)?challenger.recentClosed.map(x=>({...x,bot:'challenger'})):[];
  const v3=Array.isArray(challengerV3?.recentClosed)?challengerV3.recentClosed.map(x=>({...x,bot:'challengerV3'})):[];
  return [...base,...chall,...v3].map(x=>({bot:x.bot,symbol:String(x.symbol||'—').toUpperCase(),side:String(x.side||'—').toUpperCase(),closedAt:x.closedAt||null,realized:n(x.realized),exitReason:String(x.exitReason||'—').toUpperCase()})).filter(x=>x.closedAt).sort((a,b)=>Date.parse(b.closedAt)-Date.parse(a.closedAt)).slice(0,5);
}
function botHealthModel(status={},challenger={},challengerV3={},baseline={},ledgerRows=[],audit={}){
  const engine=status?.engine||{};
  const scanner=status?.scanner||{};
  const rowMap=Object.fromEntries(ledgerRows.map(x=>[x.key,x]));
  const audits=audit?.ledgers||{};
  const baselineEvaluations=Array.isArray(scanner.assets)?scanner.assets:[];
  const challengerEvaluations=Array.isArray(challenger?.lastEvaluations)?challenger.lastEvaluations:[];
  const v3Evaluations=Array.isArray(challengerV3?.lastEvaluations)?challengerV3.lastEvaluations:[];
  const baselineBlocked=baselineEvaluations.filter(x=>String(x?.status||'').toUpperCase()!=='READY');
  const challengerBlocked=challengerEvaluations.filter(x=>String(x?.decision||'').toUpperCase()==='SKIP');
  const v3Blocked=v3Evaluations.filter(x=>String(x?.decision||'').toUpperCase()==='SKIP');
  const baseGate=gateReasons(baseline?.lastSignal),challengerGate=gateReasons(challenger?.lastSignal),v3Gate=gateReasons(challengerV3?.lastSignal);
  return {
    available:!!(status?.engine||challenger?.lastScanAt),
    engine:{state:String(engine.state||'UNKNOWN'),running:engine.running===true,marketFresh:engine.marketFresh===true,lastCycleAt:engine.lastCycleAt||null,lastGoodMarketAt:engine.lastGoodMarketAt||null,lastSignalScanAt:engine.lastSignalScanAt||scanner.updatedAt||null,signalScans:n(engine.signalScans),errors:n(engine.errors),signalErrors:Array.isArray(engine.signalErrors)?engine.signalErrors.length:0},
    bots:{
      baseline:{lifecycle:'ACTIVE',lastScanAt:scanner.updatedAt||engine.lastSignalScanAt||null,lastClosedAt:audits.baseline?.lastClosedAt||null,openCount:Array.isArray(baseline?.positions)?baseline.positions.filter(x=>x?.status==='OPEN').length:0,evaluated:baselineEvaluations.length,ready:baselineEvaluations.length-baselineBlocked.length,blocked:baselineBlocked.length,reasons:reasonCounts(baselineBlocked),gateReasons:baseGate,riskLocked:baseGate.some(x=>x.startsWith('MAX_')),metrics:rowMap.baseline||{}},
      challenger:{lifecycle:'PARENT PAUSED',lastScanAt:challenger?.lastScanAt||null,lastClosedAt:audits.challenger?.lastClosedAt||null,openCount:n(challenger?.openCount)??0,evaluated:challengerEvaluations.length,ready:challengerEvaluations.length-challengerBlocked.length,blocked:challengerBlocked.length,reasons:reasonCounts(challengerBlocked),gateReasons:challengerGate,riskLocked:challengerGate.some(x=>x.startsWith('MAX_')),metrics:rowMap.challenger||{}},
      challengerV3:{enabled:challengerV3?.enabled===true,lifecycle:String(challengerV3?.lifecycle?.status||'WAITING'),lastScanAt:challengerV3?.lastScanAt||null,lastClosedAt:audits.challengerV3?.lastClosedAt||null,openCount:n(challengerV3?.openCount)??0,evaluated:v3Evaluations.length,ready:v3Evaluations.length-v3Blocked.length,blocked:v3Blocked.length,reasons:reasonCounts(v3Blocked),gateReasons:v3Gate,riskLocked:challengerV3?.lifecycle?.status==='STOPPED_REVIEW'||Number(challengerV3?.account?.drawdownPct)>=Number(challengerV3?.parameters?.maxDrawdownPct)||v3Gate.some(x=>['MAX_DAILY_LOSS','MAX_DRAWDOWN'].includes(x)),metrics:rowMap.challengerV3||{},parameters:challengerV3?.parameters||null,analysis:challengerV3?.analysis||null}
    },
    recentTrades:recentTrades(baseline,challenger,challengerV3)
  };
}
function paperModel(analytics={},activity={},status={},challengerStatus={},challengerV3Status={},baselineState={}){
  const ledgers=analytics?.ledgers||{};
  const keys=['baseline','shadow','challenger','challengerV3','regime'];
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
    deepDive:analytics?.deepDive||null,executionAudit:analytics?.executionAudit||null,botHealth:botHealthModel(status,challengerStatus,challengerV3Status,baselineState,rows,analytics?.executionAudit),
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
    const spot=spotValue(data);
    return {
      ok:true,locked:false,source:'PRIVATE_DASHBOARD',
      portfolioUsd:spot.value+tradingValue(data),market:marketState(data),risk,
      portfolioSource:spot.source,
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
    const spot=spotValue(data),spotUsd=spot.value,tradingUsd=tradingValue(data),totalUsd=spotUsd+tradingUsd;
    let historyRaw={source:'UNAVAILABLE',points:[]};
    try{historyRaw=await getJson('/api/private/portfolio-history?range=1d')}catch(_e){}
    return {
      ok:true,locked:false,source:'PRIVATE_DASHBOARD',totalUsd,spotUsd,tradingUsd,spotSource:spot.source,
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

function summaryLedger(raw={},baseline=false){
  const a=raw?.account||{},tr=baseline?(raw?.trades||[]).filter(t=>t.status==='CLOSED'):null;
  const count=baseline?tr.length:Number(raw?.closedCount||0);
  const positions=baseline?(raw?.positions||[]):(raw?.openPositions||[]);
  const realized=baseline?tr.reduce((sum,t)=>sum+Number(t.realized||0),0):Number(a.realizedPnl||0)+positions.reduce((sum,t)=>sum+Number(t.feeOpen||0),0);
  const gp=tr?.reduce((sum,t)=>sum+Math.max(0,Number(t.realized||0)),0)||0,gl=tr?.reduce((sum,t)=>sum+Math.max(0,-Number(t.realized||0)),0)||0;
  const eq=Number(a.equity),peak=Number(a.peakEquity);
  return {closedTrades:count,openTrades:positions.length,pnl:eq-Number(a.startEquity),expectancy:count?realized/count:null,profitFactor:count?(baseline?(gl?gp/gl:gp?99:0):raw.profitFactor):null,winRate:count?(baseline?tr.filter(t=>t.realized>0).length/count*100:raw.winRate):null,maxDrawdownPct:peak>0?Math.max(0,(peak-eq)/peak*100):null};
}
export async function loadPaper({details=false}={}){
  if(!details){
    try{
      const [status,challenger,challengerV3,baseline]=await Promise.all([getJson('/api/status'),getJson('/api/challenger-v2'),getJson('/api/challenger-v3'),getJson('/api/paper')]);
      const ledgers={baseline:summaryLedger(baseline,true),challenger:summaryLedger(challenger),challengerV3:summaryLedger(challengerV3)};
      return {...paperModel({ledgers},{},status,challenger,challengerV3,baseline),detailsLoaded:false,loadedAt:new Date().toISOString()};
    }catch(e){return {ok:false,locked:e?.status===401,error:e?.status===401?'READ_TOKEN_REQUIRED':String(e?.message||e)};}
  }
  try{
    const [analytics,activity,status,challenger,challengerV3,baseline]=await Promise.all([
      getJson('/api/research-analytics'),getJson('/api/activity-summary'),
      getJson('/api/status').catch(()=>null),getJson('/api/challenger-v2').catch(()=>null),getJson('/api/challenger-v3').catch(()=>null),getJson('/api/paper').catch(()=>null)
    ]);
    return paperModel(analytics,activity,status,challenger,challengerV3,baseline);
  }catch(e){
    if(e?.status===401)return {ok:false,locked:true,source:'RESEARCH_ANALYTICS',error:'READ_TOKEN_REQUIRED'};
    return {ok:false,locked:false,source:'RESEARCH_ANALYTICS',error:String(e?.message||e)};
  }
}
