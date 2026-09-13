// Public, read-only bot telemetry. Deliberately excludes portfolio holdings,
// credentials, position identifiers, quantities and private dashboard data.
const number=(v,f=null)=>v!=null&&Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=2)=>{const n=number(v);return n==null?null:Math.round(n*10**d)/10**d;};
const time=v=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:null;};
const lifecycle=x=>String(x?.lifecycle?.status||x?.lifecycle||x?.status||'UNKNOWN');

function trade(row={}){
  const risk=number(row.plannedRiskBudgetUsd),pnl=round(row.realized);
  return {
    symbol:String(row.symbol||''),side:String(row.side||''),closedAt:row.closedAt||null,
    exitReason:row.exitReason||null,pnl,netR:risk>0?round(pnl/risk,2):null
  };
}

function directional(name,status={},fallbackLifecycle='UNKNOWN'){
  const recent=(Array.isArray(status.recentClosed)?status.recentClosed:[]).slice(0,10).map(trade);
  const last=recent.map(x=>time(x.closedAt)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  const account=status.account||{},start=number(account.startEquity),equity=number(account.equity);
  const performance=status.learning?.performance||{};
  const reasons=status.lastSignal?.gate?.reasons||status.lastSignal?.challenger?.reasons||status.lastSignal?.reasons||status.lastDecision?.reasons||[];
  return {
    name,lifecycle:lifecycle(status)==='UNKNOWN'?fallbackLifecycle:lifecycle(status),closedTrades:number(status.closedCount,0),openTrades:number(status.openCount,0),
    pnl:start!=null&&equity!=null?round(equity-start):round(account.realizedPnl),
    drawdownPct:round(account.drawdownPct),profitFactor:round(status.profitFactor),winRate:round(status.winRate,1),
    phase:{status:status.learning?.status||null,trades:number(performance.closedTrades),expectancy:round(performance.expectancy),profitFactor:round(performance.profitFactor),remainingTrades:number(status.learning?.remainingTrades)},
    lastClosedAt:Number.isFinite(last)?new Date(last).toISOString():null,lastScanAt:status.lastScanAt||null,
    blockedReasons:[...new Set((Array.isArray(reasons)?reasons:[]).map(String))].slice(0,5),recentClosed:recent
  };
}

function baseline(state={}){
  const allRows=(Array.isArray(state.trades)?state.trades:[]).filter(x=>x?.status==='CLOSED');
  const rows=allRows.slice(-10).reverse();
  const wins=allRows.filter(x=>number(x.realized,0)>0),losses=allRows.filter(x=>number(x.realized,0)<0);
  const gp=wins.reduce((s,x)=>s+number(x.realized,0),0),gl=Math.abs(losses.reduce((s,x)=>s+number(x.realized,0),0));
  const a=state.account||{},start=number(a.startEquity),eq=number(a.equity),peak=number(a.peakEquity,eq);
  return {name:'BASELINE',lifecycle:'REFERENCE',closedTrades:allRows.length,openTrades:(state.positions||[]).filter(x=>x?.status==='OPEN').length,
    pnl:start!=null&&eq!=null?round(eq-start):round(a.realizedPnl),drawdownPct:peak>0&&eq!=null?round(Math.max(0,(peak-eq)/peak*100)):null,
    profitFactor:gl>0?round(gp/gl):(gp>0?99:0),winRate:allRows.length?round(wins.length/allRows.length*100,1):null,
    lastClosedAt:rows[0]?.closedAt||null,lastScanAt:null,blockedReasons:[],recentClosed:rows.map(trade)};
}

function carry(status={}){
  const b=status.basket||{},t=status.telemetry||{},last=t.lastSettlement||null;
  return {name:'BTC FUNDING CARRY V1',lifecycle:lifecycle(status),
    pnl:round(b.netPnl??status.closedCycles?.[0]?.realizedPnl),fundingIncome:round(b.fundingIncome),basisPnl:round(b.basisPnl),estimatedCosts:round(b.totalEstimatedCosts),
    breakEvenRemaining:round(t.breakEvenRemaining),nextFundingTime:t.nextFundingTime||null,lastCheckedAt:status.lastCheckedAt||null,
    lastSettlement:last?{at:last.at||null,rate:round(last.rate,8),income:round(last.income)}:null,
    eligibility:{eligible:!!status.lastEligibility?.eligible,reasons:(status.lastEligibility?.reasons||[]).map(String).slice(0,5),periods:number(status.lastEligibility?.periods),positiveShare:round(status.lastEligibility?.positiveShare,4),sumFundingRate:round(status.lastEligibility?.sumFundingRate,8)}
  };
}

export function buildBotObserver({engine={},safety={},baselineState={},challengerV2={},challengerV3={},fundingCarry={},botLifecycle={}}={}){
  return {schemaVersion:'8.0-BOT-OBSERVER-V1',publicReadOnly:true,executionImpact:false,generatedAt:new Date().toISOString(),
    engine:{state:engine.state||null,running:!!engine.running,marketFresh:!!engine.marketFresh,lastCycleAt:engine.lastCycleAt||null,lastSignalScanAt:engine.lastSignalScanAt||null,errors:number(engine.errors,0)},
    safety:{paperTrading:!!safety.paperTrading,liveTrading:!!safety.liveTrading},
    bots:{baseline:baseline(baselineState),challengerV2:directional('CHALLENGER V2',challengerV2,'SEALED_REFERENCE'),challengerV3:directional('CHALLENGER V3',challengerV3),fundingCarry:carry(fundingCarry)},
    archived:{shadow:botLifecycle.SHADOW_V1||null,regime:botLifecycle.REGIME_V1||null}
  };
}
