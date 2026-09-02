// MERIDIAN v7.47 — research-only ledger telemetry.
// Pure analytics: no entry, exit, sizing, risk or execution effects.
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=2)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const isoMs=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?t:null;};

function group(rows,keyFn){
  const out={};
  for(const r of rows){
    const key=String(keyFn(r)||'UNKNOWN');
    const x=out[key]||(out[key]={trades:0,pnl:0,wins:0,losses:0});
    const p=num(r.realized);x.trades++;x.pnl+=p;if(p>0)x.wins++;else if(p<0)x.losses++;
  }
  for(const x of Object.values(out)){x.pnl=round(x.pnl,2);x.winRate=x.trades?round(x.wins/x.trades*100,1):0;}
  return out;
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

export function ledgerAnalytics(state={},bot='baseline'){
  const trades=Array.isArray(state?.trades)?state.trades.filter(t=>t&&t.status==='CLOSED'):[];
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
  const peak=num(state?.account?.peakEquity,eq);
  const start=num(state?.account?.startEquity,10000);
  const dd=peak>0?Math.max(0,(peak-eq)/peak*100):0;
  const riskOpen=open.reduce((a,p)=>a+num(p.riskPct),0);
  const result={
    bot,closedTrades:trades.length,openTrades:open.length,startEquity:round(start,2),equity:round(eq,2),pnl:round(eq-start,2),realizedTradePnl:round(pnl,2),
    wins:wins.length,losses:losses.length,winRate:trades.length?round(wins.length/trades.length*100,1):0,
    profitFactor:gl>0?round(gp/gl,2):(gp>0?99:0),expectancy:trades.length?round(pnl/trades.length,2):0,
    avgWin:round(avgWin,2),avgLoss:round(avgLoss,2),payoffRatio:avgLoss>0?round(avgWin/avgLoss,2):(avgWin>0?99:0),
    maxDrawdownPct:round(dd,2),openRiskPct:round(riskOpen,3),avgHoldMinutes:holds.length?round(holds.reduce((a,b)=>a+b,0)/holds.length,1):null,
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
  return {
    tracked:all.length,closed:closed.length,open:all.filter(x=>x?.status==='OPEN').length,
    missedWinners:positive.length,avoidedLosers:negative.length,
    netCounterfactualR:round(closed.reduce((a,x)=>a+num(x.outcomeR),0),3),avgCounterfactualR:closed.length?round(closed.reduce((a,x)=>a+num(x.outcomeR),0)/closed.length,3):null,
    byReason:group(closed,x=>x.reason),byRegime:group(closed,x=>x.regime)
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
    auditFlags:{challengerBaselineReadyDependency:true,regimeAdaptedSideUsesBaselineDirectionalScores:true,liveBacktestExitSequencingMismatch:true}
  };
}
