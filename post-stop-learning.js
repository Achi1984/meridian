// MERIDIAN R27 — deterministic post-stop analysis and frozen successor policy.
// Pure research logic: it never mutates a ledger and has no live execution path.
const number=(v,f=0)=>v!=null&&Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=3)=>Math.round(Number(v)*10**d)/10**d;
const time=v=>{const x=Date.parse(v||'');return Number.isFinite(x)?x:null};

export const POST_STOP_POLICY=Object.freeze({
  schemaVersion:'8.27-POST-STOP-LEARNING-V1',
  minimumClosedTrades:20,
  materialLossR:1.25,
  reentryWindowMinutes:360,
  successorReentryMinutes:720,
  successorCooldownMinutes:180,
  riskMultiplier:.5,
  tradeScoreIncrease:2,
  cautionScoreIncrease:4,
  maxSuccessorPositions:1
});

function closedTrades(state={}){
  return Array.isArray(state?.trades)?state.trades.filter(x=>x?.status==='CLOSED'):[];
}
function drawdownPct(state={}){
  const equity=number(state?.account?.equity,number(state?.account?.startEquity,0));
  const peak=number(state?.account?.peakEquity,equity);
  return peak>0?Math.max(0,(peak-equity)/peak*100):0;
}
function pnlStats(rows=[]){
  const wins=rows.filter(x=>number(x.realized)>0),losses=rows.filter(x=>number(x.realized)<0);
  const grossProfit=wins.reduce((s,x)=>s+number(x.realized),0);
  const grossLoss=Math.abs(losses.reduce((s,x)=>s+number(x.realized),0));
  const pnl=rows.reduce((s,x)=>s+number(x.realized),0);
  return {closedTrades:rows.length,pnl:round(pnl,2),expectancy:rows.length?round(pnl/rows.length,2):null,profitFactor:grossLoss>0?round(grossProfit/grossLoss,3):(grossProfit>0?99:0),winRate:rows.length?round(wins.length/rows.length*100,1):null};
}
function stopStats(rows=[],policy=POST_STOP_POLICY){
  const stops=rows.filter(x=>x.exitReason==='SL').map(x=>{
    const entry=number(x.entry,NaN),stop=number(x.sl,NaN),qty=Math.abs(number(x.qty,NaN));
    const initialRisk=Number.isFinite(entry)&&Number.isFinite(stop)&&Number.isFinite(qty)?Math.abs(entry-stop)*qty:NaN;
    return initialRisk>0?Math.abs(Math.min(0,number(x.realized)))/initialRisk:null;
  }).filter(Number.isFinite);
  return {stopExits:rows.filter(x=>x.exitReason==='SL').length,evaluable:stops.length,materialLosses:stops.filter(x=>x>policy.materialLossR).length,maximumLossR:stops.length?round(Math.max(...stops),3):null};
}
function behaviorStats(rows=[],policy=POST_STOP_POLICY){
  const ordered=rows.filter(x=>time(x.openedAt)!=null).slice().sort((a,b)=>time(a.openedAt)-time(b.openedAt));
  let postStopReentries=0;
  for(let i=1;i<ordered.length;i++){
    const current=ordered[i];
    for(let j=i-1;j>=0;j--){
      const previous=ordered[j];
      if(previous.symbol!==current.symbol||previous.side!==current.side)continue;
      const delta=time(current.openedAt)-time(previous.closedAt);
      if(previous.exitReason==='SL'&&delta>=0&&delta<=policy.reentryWindowMinutes*60000)postStopReentries++;
      break;
    }
  }
  const buckets=new Map();
  for(const row of ordered){
    const opened=time(row.openedAt);if(opened==null)continue;
    const key=`${row.side}:${Math.floor(opened/(30*60000))}`;
    const set=buckets.get(key)||new Set();set.add(row.symbol);buckets.set(key,set);
  }
  return {postStopReentries,directionalBundles:[...buckets.values()].filter(x=>x.size>1).length};
}

export function analyzePostStop(state={},limits={},policy=POST_STOP_POLICY){
  const rows=closedTrades(state),performance=pnlStats(rows),stops=stopStats(rows,policy),behavior=behaviorStats(rows,policy);
  const openTrades=Array.isArray(state?.positions)?state.positions.filter(x=>x?.status==='OPEN').length:0;
  const maximumDrawdownPct=round(drawdownPct(state),2);
  const maxDrawdownPct=number(limits.maxDrawdownPct,8);
  const causes=[];
  if(performance.profitFactor<1)causes.push('NEGATIVE_EDGE');
  if(stops.evaluable&&stops.materialLosses/stops.evaluable>=.25)causes.push('MATERIAL_STOP_LOSSES');
  if(behavior.postStopReentries>0)causes.push('POST_STOP_REENTRY');
  if(behavior.directionalBundles>0)causes.push('DIRECTIONAL_BUNDLING');
  return Object.freeze({
    schemaVersion:policy.schemaVersion,generatedAt:new Date().toISOString(),researchOnly:true,executionImpact:false,
    trigger:'MAX_DRAWDOWN',triggered:drawdownPct(state)>=maxDrawdownPct,adequate:rows.length>=policy.minimumClosedTrades,
    maximumDrawdownPct,maxDrawdownPct,openTrades,performance,stops,behavior,causes,
    limitations:['One deterministic successor only; no parameter search.','No asset or side is excluded from this in-sample ledger.','Promotion requires prospective evidence.']
  });
}

export function buildSuccessorPlan(state={},limits={},parentParams={},policy=POST_STOP_POLICY){
  const analysis=analyzePostStop(state,limits,policy);
  if(!analysis.triggered||!analysis.adequate||analysis.openTrades>0)return Object.freeze({eligible:false,analysis,parameters:null});
  const baseRisk=Math.max(0,number(parentParams.fullRiskPct,number(limits.riskPerTradePct,1)));
  const causes=new Set(analysis.causes);
  const riskMultiplier=causes.has('MATERIAL_STOP_LOSSES')?policy.riskMultiplier:.75;
  const parameters=Object.freeze({
    parameterVersion:'8.27-CHALLENGER-V3-FROZEN-V1',frozen:true,
    tradeScore:Math.min(90,number(parentParams.tradeScore,72)+(causes.has('NEGATIVE_EDGE')?policy.tradeScoreIncrease:0)),
    cautionScore:Math.min(89,number(parentParams.cautionScore,62)+(causes.has('NEGATIVE_EDGE')?policy.cautionScoreIncrease:0)),
    fullRiskPct:baseRisk*riskMultiplier,
    cautionRiskPct:baseRisk*riskMultiplier*.5,
    cooldownMinutes:causes.has('POST_STOP_REENTRY')?Math.max(number(limits.cooldownMinutes,30),policy.successorCooldownMinutes):number(limits.cooldownMinutes,30),
    postStopReentryMinutes:causes.has('POST_STOP_REENTRY')?policy.successorReentryMinutes:policy.reentryWindowMinutes,
    maxOpenPositions:causes.has('DIRECTIONAL_BUNDLING')?policy.maxSuccessorPositions:Math.min(2,number(limits.maxOpenPositions,2)),
    maxPortfolioRiskPct:number(limits.maxPortfolioRiskPct,3),
    maxDailyLossPct:number(limits.maxDailyLossPct,3),
    maxDrawdownPct:number(limits.maxDrawdownPct,8),
    maxTradesPerDay:number(limits.maxTradesPerDay,8),
    weights:Object.freeze({technical:.42,candidate:.38,entryDistance:.20}),
    assetFilter:null,sideFilter:null
  });
  return Object.freeze({eligible:true,analysis,parameters});
}
