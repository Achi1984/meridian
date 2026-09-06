// MERIDIAN v7.87 — research-only ledger telemetry + Paperbot deep dive.
// Pure analytics: no entry, exit, sizing, risk or execution effects.
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=2)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const isoMs=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?t:null;};

function group(rows,keyFn,valueFn=r=>num(r.realized)){
  const out={};
  for(const r of rows){
    const key=String(keyFn(r)||'UNKNOWN');
    const x=out[key]||(out[key]={trades:0,pnl:0,wins:0,losses:0});
    const p=num(valueFn(r));x.trades++;x.pnl+=p;if(p>0)x.wins++;else if(p<0)x.losses++;
  }
  for(const x of Object.values(out)){x.pnl=round(x.pnl,3);x.winRate=x.trades?round(x.wins/x.trades*100,1):0;}
  return out;
}
function maxDrawdownPct(state={},fallbackEq=0){
  const curve=Array.isArray(state?.equityCurve)?state.equityCurve:[];
  const values=curve.map(x=>num(x?.equity,NaN)).filter(v=>Number.isFinite(v)&&v>0);
  const eq=num(state?.account?.equity,fallbackEq);
  if(eq>0)values.push(eq);
  if(!values.length)return 0;
  let peak=values[0],maxDd=0;
  for(const v of values){peak=Math.max(peak,v);if(peak>0)maxDd=Math.max(maxDd,(peak-v)/peak*100);}
  return maxDd;
}
function regimeOf(t,bot){
  if(bot==='regime')return t.regimeType||t.regime||null;
  if(bot==='challenger')return t.challengerRegime||t.regime||null;
  if(bot==='shadow')return t.shadowRegime||t.regime||null;
  return t.regime||t.evidenceSnapshot?.regime||null;
}
function decisionOf(t,bot){
  if(bot==='challenger')return t.challengerDecision||null;
  if(bot==='regime')return t.regimeDecision||null;
  return null;
}
function scoreOf(t,bot){
  if(bot==='challenger')return num(t.challengerConfidence,NaN);
  if(bot==='regime')return num(t.regimeScore,NaN);
  return NaN;
}
function closedTrades(state={}){return Array.isArray(state?.trades)?state.trades.filter(t=>t&&t.status==='CLOSED'):[];}
function tradeTime(t){return isoMs(t?.closedAt)||isoMs(t?.openedAt);}
function within(rows,startMs,endMs){
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)return rows;
  return rows.filter(t=>{const x=tradeTime(t);return Number.isFinite(x)&&x>=startMs&&x<=endMs;});
}
function cohortStats(rows=[]){
  const wins=rows.filter(t=>num(t.realized)>0),losses=rows.filter(t=>num(t.realized)<0);
  const gp=wins.reduce((a,t)=>a+num(t.realized),0),gl=Math.abs(losses.reduce((a,t)=>a+num(t.realized),0));
  const pnl=rows.reduce((a,t)=>a+num(t.realized),0);
  return {
    trades:rows.length,pnl:round(pnl,2),expectancy:rows.length?round(pnl/rows.length,2):null,
    profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),winRate:rows.length?round(wins.length/rows.length*100,1):null,
    adequate:rows.length>=8
  };
}
function cohortMap(rows,keyFn){
  const buckets={};
  for(const t of rows){const k=String(keyFn(t)||'UNKNOWN');(buckets[k]||(buckets[k]=[])).push(t);}
  return Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,cohortStats(v)]));
}
function compareCohorts(base={},chall={}){
  const keys=[...new Set([...Object.keys(base),...Object.keys(chall)])].sort();
  return Object.fromEntries(keys.map(k=>{
    const b=base[k]||cohortStats([]),c=chall[k]||cohortStats([]);
    return [k,{baseline:b,challenger:c,delta:{trades:c.trades-b.trades,pnl:round((c.pnl||0)-(b.pnl||0),2),expectancy:round((c.expectancy||0)-(b.expectancy||0),2),profitFactor:round((c.profitFactor||0)-(b.profitFactor||0),2)}}];
  }));
}
function temporalSlices(baseRows,challRows,startMs,endMs){
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)return [];
  const width=(endMs-startMs)/3;
  return [0,1,2].map(i=>{
    const a=startMs+i*width,b=i===2?endMs:startMs+(i+1)*width;
    return {slice:i+1,start:new Date(a).toISOString(),end:new Date(b).toISOString(),baseline:cohortStats(within(baseRows,a,b)),challenger:cohortStats(within(challRows,a,b))};
  });
}

export function ledgerAnalytics(state={},bot='baseline'){
  const trades=closedTrades(state);
  const open=Array.isArray(state?.positions)?state.positions.filter(p=>p&&p.status==='OPEN'):[];
  const wins=trades.filter(t=>num(t.realized)>0),losses=trades.filter(t=>num(t.realized)<0);
  const gp=wins.reduce((a,t)=>a+num(t.realized),0),gl=Math.abs(losses.reduce((a,t)=>a+num(t.realized),0));
  const pnl=trades.reduce((a,t)=>a+num(t.realized),0);
  const avgWin=wins.length?gp/wins.length:0,avgLoss=losses.length?gl/losses.length:0;
  const holds=trades.map(t=>{const a=isoMs(t.openedAt),b=isoMs(t.closedAt);return a!=null&&b!=null&&b>=a?(b-a)/60000:null;}).filter(Number.isFinite);
  const first=trades.map(t=>isoMs(t.openedAt)).filter(Number.isFinite).sort((a,b)=>a-b)[0]??null;
  const last=trades.map(t=>isoMs(t.closedAt||t.openedAt)).filter(Number.isFinite).sort((a,b)=>b-a)[0]??null;
  const spanDays=first!=null&&last!=null&&last>first?(last-first)/86400000:null;
  const eq=num(state?.account?.equity,num(state?.account?.startEquity,10000));
  const start=num(state?.account?.startEquity,10000);
  const riskOpen=open.reduce((a,p)=>a+num(p.riskPct),0);
  const result={
    bot,closedTrades:trades.length,openTrades:open.length,startEquity:round(start,2),equity:round(eq,2),pnl:round(eq-start,2),realizedTradePnl:round(pnl,2),
    wins:wins.length,losses:losses.length,winRate:trades.length?round(wins.length/trades.length*100,1):0,
    profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),expectancy:trades.length?round(pnl/trades.length,2):0,
    avgWin:round(avgWin,2),avgLoss:round(avgLoss,2),payoffRatio:avgLoss>0?round(avgWin/avgLoss,2):(avgWin>0?99:0),
    maxDrawdownPct:round(maxDrawdownPct(state,eq),2),openRiskPct:round(riskOpen,3),avgHoldMinutes:holds.length?round(holds.reduce((a,b)=>a+b,0)/holds.length,1):null,
    tradesPerDay:spanDays&&spanDays>0?round(trades.length/spanDays,3):null,
    activeSpanDays:spanDays?round(spanDays,2):null,
    bySide:group(trades,t=>t.side),bySymbol:group(trades,t=>t.symbol),byExit:group(trades,t=>t.exitReason),byRegime:group(trades,t=>regimeOf(t,bot))
  };
  const decisions=trades.filter(t=>decisionOf(t,bot));
  if(decisions.length)result.byDecision=group(decisions,t=>decisionOf(t,bot));
  const scores=trades.map(t=>scoreOf(t,bot)).filter(Number.isFinite);
  if(scores.length)result.avgEntryScore=round(scores.reduce((a,b)=>a+b,0)/scores.length,1);
  if(bot==='regime'){
    const adapted=trades.filter(t=>t.sourceSide&&t.side&&String(t.sourceSide)!==String(t.side));
    result.sideAdaptation={trades:adapted.length,pnl:round(adapted.reduce((a,t)=>a+num(t.realized),0),2),winRate:adapted.length?round(adapted.filter(t=>num(t.realized)>0).length/adapted.length*100,1):0};
  }
  return result;
}

export function challengerCounterfactual(state={}){
  const all=Array.isArray(state?.counterfactuals)?state.counterfactuals:[];
  const closed=all.filter(x=>x?.status==='CLOSED'&&Number.isFinite(Number(x.outcomeR)));
  const positive=closed.filter(x=>num(x.outcomeR)>0),negative=closed.filter(x=>num(x.outcomeR)<0);
  const byReason=group(closed,x=>x.reason,x=>num(x.outcomeR));
  const byRegime=group(closed,x=>x.regime,x=>num(x.outcomeR));
  for(const x of [...Object.values(byReason),...Object.values(byRegime)]){x.netR=x.pnl;delete x.pnl;}
  return {
    tracked:all.length,closed:closed.length,open:all.filter(x=>x?.status==='OPEN').length,
    missedWinners:positive.length,avoidedLosers:negative.length,
    netCounterfactualR:round(closed.reduce((a,x)=>a+num(x.outcomeR),0),3),avgCounterfactualR:closed.length?round(closed.reduce((a,x)=>a+num(x.outcomeR),0)/closed.length,3):null,
    byReason,byRegime
  };
}

export function paperBotDeepDive(states={},window={}){
  const baselineAll=closedTrades(states.baseline||{}),challengerAll=closedTrades(states.challenger||{});
  const startMs=isoMs(window?.start),endMs=isoMs(window?.end);
  const baseline=within(baselineAll,startMs,endMs),challenger=within(challengerAll,startMs,endMs);
  const baseRegime=t=>regimeOf(t,'baseline'),challRegime=t=>regimeOf(t,'challenger');
  return {
    schemaVersion:'7.87-PAPER-DEEP-DIVE-V1',researchOnly:true,executionImpact:false,
    commonWindow:Number.isFinite(startMs)&&Number.isFinite(endMs)&&endMs>startMs?{start:new Date(startMs).toISOString(),end:new Date(endMs).toISOString(),days:round((endMs-startMs)/86400000,2)}:null,
    summary:{baseline:cohortStats(baseline),challenger:cohortStats(challenger)},
    bySide:compareCohorts(cohortMap(baseline,t=>t.side),cohortMap(challenger,t=>t.side)),
    byRegime:compareCohorts(cohortMap(baseline,baseRegime),cohortMap(challenger,challRegime)),
    bySymbol:compareCohorts(cohortMap(baseline,t=>t.symbol),cohortMap(challenger,t=>t.symbol)),
    temporalSlices:temporalSlices(baselineAll,challengerAll,startMs,endMs),
    opportunityCost:challengerCounterfactual(states.challenger||{}),
    caveats:[
      'Challenger V2 historically depends on Baseline READY.',
      'Temporal slices are descriptive out-of-time stability slices, not a retrained-model OOS test.',
      'Cohorts with fewer than 8 closed trades are marked inadequate and must not drive promotion.'
    ]
  };
}

export function researchComparison(states={}){
  const baseline=ledgerAnalytics(states.baseline||{},'baseline');
  const shadow=ledgerAnalytics(states.shadow||{},'shadow');
  const challenger=ledgerAnalytics(states.challenger||{},'challenger');
  const regime=ledgerAnalytics(states.regime||{},'regime');
  const baseTrades=Math.max(1,baseline.closedTrades);
  for(const x of [shadow,challenger,regime]){
    x.vsBaseline={
      pnlDelta:round(x.pnl-baseline.pnl,2),ddDeltaPctPoints:round(x.maxDrawdownPct-baseline.maxDrawdownPct,2),
      tradeDelta:x.closedTrades-baseline.closedTrades,retentionPct:round(x.closedTrades/baseTrades*100,1),expectancyDelta:round(x.expectancy-baseline.expectancy,2)
    };
  }
  return {
    schemaVersion:'7.47-TELEMETRY-V1',researchOnly:true,executionImpact:false,generatedAt:new Date().toISOString(),
    ledgers:{baseline,shadow,challenger,regime},
    opportunityCost:{challenger:challengerCounterfactual(states.challenger||{}),shadow:{available:false,reason:'NO_SHADOW_COUNTERFACTUAL_LEDGER_YET'},regime:{available:false,reason:'NO_REGIME_COUNTERFACTUAL_LEDGER_YET'}},
    deepDive:paperBotDeepDive(states),
    auditFlags:{challengerBaselineReadyDependency:true,regimeAdaptedSideUsesBaselineDirectionalScores:true,liveBacktestExitSequencingMismatch:true}
  };
}
