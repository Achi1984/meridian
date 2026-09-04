// MERIDIAN v7.77 — Challenger V3.3 Risk Allocation Shadow
// Research-only. Keeps Challenger V3.2 entries/ranking/exits frozen and only tests bounded context-conditioned risk allocation.
import { replayPortfolioPath } from './portfolio-path-v767.js';
import { buildContextReliabilityMap, contextDescriptor } from './context-reliability-v776.js';

const round=(v,d=3)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;
const finite=v=>Number.isFinite(Number(v));
const key=r=>`${r?.sampledAt||''}|${r?.symbol||''}`;
const ts=r=>Date.parse(r?.sampledAt||'');
const exitTs=r=>Date.parse(r?.exitAtIso||r?.exitAt||'');

export const V777_CONFIG=Object.freeze({
  baseRiskPct:0.25,
  stepRiskPct:0.025,
  maxRiskPct:0.35,
  minSamples:20,
  minAvgR:0,
  minPf:1,
  minCaptureEfficiency:0.5
});

function descriptorKeys(row){
  const d=contextDescriptor(row);
  return [d.evidence,d.mtf,d.volume,d.momentum,d.volatility].map(bucket=>`${d.sideRegime}|${bucket}`);
}

export function deriveChronologicalRiskPolicy(trainingPeriods={},options={}){
  const cfg={...V777_CONFIG,...options};
  const names=Object.keys(trainingPeriods);
  const maps=Object.fromEntries(names.map(name=>[name,buildContextReliabilityMap(trainingPeriods[name]||[],{minSamples:cfg.minSamples})]));
  const allKeys=[...new Set(Object.values(maps).flatMap(m=>(m.cells||[]).map(c=>c.key)))];
  const cells=[];
  for(const cellKey of allKeys){
    const observations=names.map(name=>(maps[name].cells||[]).find(c=>c.key===cellKey)).filter(Boolean);
    if(observations.length!==names.length)continue;
    if(observations.some(c=>!c.adequate||!(c.avgR>cfg.minAvgR)||!(c.pf>cfg.minPf)||!(c.captureEfficiency>cfg.minCaptureEfficiency)))continue;
    const avgR=observations.reduce((s,c)=>s+c.avgR,0)/observations.length;
    const pf=observations.reduce((s,c)=>s+c.pf,0)/observations.length;
    const capture=observations.reduce((s,c)=>s+c.captureEfficiency,0)/observations.length;
    cells.push({key:cellKey,windows:observations.length,avgR:round(avgR),pf:round(pf),captureEfficiency:round(capture,1),samples:observations.reduce((s,c)=>s+c.samples,0)});
  }
  cells.sort((a,b)=>b.windows-a.windows||b.captureEfficiency-a.captureEfficiency||b.avgR-a.avgR);
  return {
    schemaVersion:'7.77-V33-RISK-POLICY-V1',researchOnly:true,executionImpact:false,
    trainingPeriods:names,cells,
    config:{baseRiskPct:cfg.baseRiskPct,stepRiskPct:cfg.stepRiskPct,maxRiskPct:cfg.maxRiskPct,minSamples:cfg.minSamples,minAvgR:cfg.minAvgR,minPf:cfg.minPf,minCaptureEfficiency:cfg.minCaptureEfficiency}
  };
}

export function riskAllocationForRow(row,policy={},options={}){
  const cfg={...V777_CONFIG,...(policy.config||{}),...options};
  const eligible=new Set((policy.cells||[]).map(c=>c.key));
  const matches=descriptorKeys(row).filter(k=>eligible.has(k));
  const riskPct=Math.min(cfg.maxRiskPct,cfg.baseRiskPct+matches.length*cfg.stepRiskPct);
  return {riskPct:round(riskPct,4),matches,matchCount:matches.length};
}

function summarize(trades,startEquity,endEquity,maxDD){
  const wins=trades.filter(t=>t.outcomeR>0),losses=trades.filter(t=>t.outcomeR<0);
  const grossWin=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  const avgRisk=trades.length?trades.reduce((s,t)=>s+t.riskPct,0)/trades.length:0;
  const avgWinnerRisk=wins.length?wins.reduce((s,t)=>s+t.riskPct,0)/wins.length:0;
  const avgLoserRisk=losses.length?losses.reduce((s,t)=>s+t.riskPct,0)/losses.length:0;
  return {
    trades:trades.length,startEquity:round(startEquity,2),endEquity:round(endEquity,2),returnPct:round((endEquity/startEquity-1)*100,3),maxDrawdownPct:round(maxDD,3),
    pf:grossLoss>0?round(grossWin/grossLoss):grossWin>0?99:0,
    avgRiskPct:round(avgRisk,4),avgWinnerRiskPct:round(avgWinnerRisk,4),avgLoserRiskPct:round(avgLoserRisk,4),winnerMinusLoserRiskPct:round(avgWinnerRisk-avgLoserRisk,4)
  };
}

function simulateFrozen(selected=[],sourceRows=[],policy=null,options={}){
  const cfg={...V777_CONFIG,...options};
  const source=new Map(sourceRows.map(r=>[key(r),r]));
  const opens=selected.map(t=>({...t,__source:source.get(key(t))||t})).filter(t=>finite(ts(t))&&finite(exitTs(t))&&finite(t.outcomeR)).sort((a,b)=>ts(a)-ts(b)||String(a.symbol).localeCompare(String(b.symbol)));
  const startEquity=Number(options.startEquity)||10000;
  let equity=startEquity,peak=startEquity,maxDD=0,i=0;
  const positions=[],closed=[];
  const closeDue=t=>{
    const due=positions.filter(p=>p.exitAt<=t).sort((a,b)=>a.exitAt-b.exitAt||String(a.symbol).localeCompare(String(b.symbol)));
    for(const p of due){
      const idx=positions.indexOf(p);if(idx>=0)positions.splice(idx,1);
      const pnl=p.equityAtOpen*(p.riskPct/100)*p.outcomeR;equity+=pnl;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak>0?(peak-equity)/peak*100:0);
      closed.push({...p,pnl:round(pnl,4),equityAfter:round(equity,4)});
    }
  };
  while(i<opens.length){
    const t=ts(opens[i]);closeDue(t);
    while(i<opens.length&&ts(opens[i])===t){
      const tr=opens[i++],allocation=policy?riskAllocationForRow(tr.__source,policy,cfg):{riskPct:cfg.baseRiskPct,matches:[],matchCount:0};
      positions.push({symbol:tr.symbol,side:tr.side,sampledAt:tr.sampledAt,exitAt:exitTs(tr),outcomeR:Number(tr.outcomeR),riskPct:Number(allocation.riskPct),matches:allocation.matches,matchCount:allocation.matchCount,equityAtOpen:equity});
    }
  }
  closeDue(Number.POSITIVE_INFINITY);
  return {summary:summarize(closed,startEquity,equity,maxDD),trades:closed};
}

export function replayV33RiskShadow(rows=[],policy={},options={}){
  const cfg={...V777_CONFIG,...options};
  const frozen=replayPortfolioPath(rows,{config:{riskPerTradePct:cfg.baseRiskPct},includeTrades:true});
  const selected=frozen?.tradeDetails?.challengerV32||[];
  const constant=simulateFrozen(selected,rows,null,cfg);
  const adaptive=simulateFrozen(selected,rows,policy,cfg);
  return {
    schemaVersion:'7.77-V33-RISK-SHADOW-V1',researchOnly:true,executionImpact:false,entriesFrozen:true,exitsFrozen:true,coverageEqual:constant.summary.trades===adaptive.summary.trades,
    selectedTrades:selected.length,policyCells:(policy.cells||[]).length,
    constant:constant.summary,adaptive:adaptive.summary,
    delta:{returnPct:round(adaptive.summary.returnPct-constant.summary.returnPct,3),maxDrawdownPct:round(adaptive.summary.maxDrawdownPct-constant.summary.maxDrawdownPct,3),pf:round(adaptive.summary.pf-constant.summary.pf,3),winnerMinusLoserRiskPct:adaptive.summary.winnerMinusLoserRiskPct},
    allocation:{boostedTrades:adaptive.trades.filter(t=>t.riskPct>cfg.baseRiskPct).length,maxRiskPct:adaptive.trades.length?Math.max(...adaptive.trades.map(t=>t.riskPct)):cfg.baseRiskPct}
  };
}

export function runChronologicalV33RiskShadow(periods={},options={}){
  const order=['P3','P2','P1','P0'].filter(p=>Array.isArray(periods[p]));
  const steps=[];
  for(let i=1;i<order.length;i++){
    const test=order[i],training=order.slice(0,i);
    const trainingPeriods=Object.fromEntries(training.map(p=>[p,periods[p]]));
    const policy=deriveChronologicalRiskPolicy(trainingPeriods,options);
    const replay=replayV33RiskShadow(periods[test],policy,options);
    steps.push({training,test,policy,replay});
  }
  const positive=steps.filter(s=>s.replay.delta.returnPct>0).length;
  const ddSafe=steps.filter(s=>s.replay.delta.maxDrawdownPct<=0.25).length;
  const allocationEfficient=steps.filter(s=>s.replay.adaptive.winnerMinusLoserRiskPct>0).length;
  const equalCoverage=steps.every(s=>s.replay.coverageEqual);
  const persistent=steps.length===3&&positive>=2&&ddSafe===steps.length&&allocationEfficient>=2&&equalCoverage;
  return {
    schemaVersion:'7.77-CHRONOLOGICAL-V33-RISK-SHADOW-V1',researchOnly:true,executionImpact:false,method:'strict chronological expanding training: P3→P2, P3+P2→P1, P3+P2+P1→P0; test period never informs its policy; V3.2 trade set/exits frozen; only risk allocation changes',
    steps,summary:{positiveReturnSteps:positive,ddSafeSteps:ddSafe,allocationEfficientSteps:allocationEfficient,equalCoverage,persistent},promotionAllowed:false,
    nextStep:persistent?'PROSPECTIVE_V33_RISK_SHADOW':'KEEP_V32_025_NO_CONTEXT_RISK'
  };
}
