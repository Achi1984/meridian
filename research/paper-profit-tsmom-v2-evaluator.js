import {runTsmomClassic} from './documented-edge-v1.js';
import {evaluateStageBGate} from './paperbot-profit-control-v2-stage-b.js';
import {freezeTsmomV2Split,TSMOM_V2_PREREGISTRATION} from './paper-profit-tsmom-v2-preregistration.js';

const finite=v=>Number.isFinite(Number(v));
const n=v=>Number(v);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const pf=rows=>{
  const w=rows.filter(x=>x>0).reduce((a,b)=>a+b,0);
  const l=Math.abs(rows.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return l>0?w/l:(w>0?99:0);
};
function summary(returns,startEquity=10000){
  let eq=startEquity,peak=startEquity,maxDD=0;
  for(const r of returns){
    eq*=1+r;peak=Math.max(peak,eq);
    if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);
  }
  return {
    periods:returns.length,
    totalReturnPct:(eq/startEquity-1)*100,
    pnl:eq-startEquity,
    endEquity:eq,
    profitFactor:pf(returns),
    avgReturnPct:mean(returns)*100,
    maxDrawdownPct:maxDD,
    positivePeriods:returns.filter(x=>x>0).length
  };
}
function windows(periods,parts=5,startEquity=10000){
  if(!periods.length)return{windows:[],positiveWindows:0};
  const out=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    const slice=periods.slice(a,b),s=summary(slice.map(x=>x.netReturn),startEquity);
    out.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.at??null,...s,positive:s.totalReturnPct>0});
  }
  return{windows:out,positiveWindows:out.filter(x=>x.positive).length};
}
function assets(periods,startEquity=10000){
  const by=new Map();
  for(const p of periods)for(const leg of p.legs||[]){
    if(!by.has(leg.symbol))by.set(leg.symbol,[]);
    by.get(leg.symbol).push(n(leg.netReturn)||0);
  }
  return [...by.entries()].map(([symbol,rs])=>({symbol,periods:rs.length,summary:summary(rs,startEquity)})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}
function concentration(rows){
  const pos=rows.filter(x=>x.summary?.pnl>0),total=pos.reduce((a,x)=>a+x.summary.pnl,0);
  return total>0?Math.max(...pos.map(x=>x.summary.pnl/total*100)):0;
}
function filtered(base,{start=null,end=null}={}){
  const periods=(base?.periods||[]).filter(p=>(start==null||p.at>=start)&&(end==null||p.at<=end));
  const startEquity=base?.config?.startEquity||10000;
  const s=summary(periods.map(x=>x.netReturn),startEquity);
  const st=windows(periods,5,startEquity),as=assets(periods,startEquity),c=concentration(as);
  return {periods,summary:s,stability:st,assets:as,positivePnlConcentrationPct:c};
}
function commonTimestamps(dataset){
  const sets=TSMOM_V2_PREREGISTRATION.universe.map(symbol=>new Set((dataset?.[symbol]||[]).map(r=>Number(r.openTime)).filter(Number.isFinite)));
  if(!sets.length)return[];
  return [...sets[0]].filter(ts=>sets.every(s=>s.has(ts))).sort((a,b)=>a-b);
}
function gateView(view,stressView,{holdoutUntouched=true}={}){
  const positiveAssets=(view.assets||[]).filter(x=>x.summary?.pnl>0).length;
  return evaluateStageBGate({
    evaluationPeriods:view.summary?.periods||0,
    netCompoundedReturnPct:view.summary?.totalReturnPct,
    profitFactor:view.summary?.profitFactor,
    maxDrawdownPct:view.summary?.maxDrawdownPct,
    positiveWindows:view.stability?.positiveWindows||0,
    positiveAssets,
    positivePnlConcentrationPct:view.positivePnlConcentrationPct,
    stressNetCompoundedReturnPct:stressView.summary?.totalReturnPct,
    provenanceOk:true,
    holdoutUntouched
  });
}
function concise(view,stressView,gate){
  return {
    periods:view.summary.periods,
    totalReturnPct:view.summary.totalReturnPct,
    pnl:view.summary.pnl,
    profitFactor:view.summary.profitFactor,
    maxDrawdownPct:view.summary.maxDrawdownPct,
    positiveWindows:view.stability.positiveWindows,
    positiveAssets:view.assets.filter(x=>x.summary?.pnl>0).length,
    positivePnlConcentrationPct:view.positivePnlConcentrationPct,
    stress16BpsReturnPct:stressView.summary.totalReturnPct,
    gate
  };
}

export function runTsmomV2Discovery(dataset){
  const timestamps=commonTimestamps(dataset);
  const split=freezeTsmomV2Split(timestamps);
  if(!split.ok)return{ruleset:TSMOM_V2_PREREGISTRATION.ruleset,split,decision:'INSUFFICIENT_SPLIT_SAMPLE',researchOnly:true,executionImpact:false,autoPromotion:false};

  const discoveryData=Object.fromEntries(TSMOM_V2_PREREGISTRATION.universe.map(symbol=>[
    symbol,(dataset?.[symbol]||[]).filter(r=>Number(r.openTime)<=split.discoveryTo)
  ]));
  const base=runTsmomClassic(discoveryData,{costBps:TSMOM_V2_PREREGISTRATION.config.baselineCostBps});
  const stress=runTsmomClassic(discoveryData,{costBps:TSMOM_V2_PREREGISTRATION.config.stressCostBps});
  const d=filtered(base),ds=filtered(stress);

  if(d.summary.periods<TSMOM_V2_PREREGISTRATION.gate.minEvaluationPeriods || split.holdoutCount<2){
    return {
      ruleset:TSMOM_V2_PREREGISTRATION.ruleset,split,
      discovery:concise(d,ds,{pass:false,label:'STAGE_B_GATE_FAIL',reasons:['INSUFFICIENT_SPLIT_SAMPLE'],researchOnly:true,executionImpact:false,autoPromotion:false}),
      decision:'INSUFFICIENT_SPLIT_SAMPLE',holdout:null,
      researchOnly:true,executionImpact:false,autoPromotion:false
    };
  }

  const discoveryGate=gateView(d,ds,{holdoutUntouched:true});
  const discovery=concise(d,ds,discoveryGate);
  if(!discoveryGate.pass){
    return {ruleset:TSMOM_V2_PREREGISTRATION.ruleset,split,discovery,decision:'TSMOM_V2_DISCOVERY_FAIL',holdout:null,researchOnly:true,executionImpact:false,autoPromotion:false};
  }

  // Only after discovery PASS is the holdout return path evaluated.
  const baseFull=runTsmomClassic(dataset,{costBps:TSMOM_V2_PREREGISTRATION.config.baselineCostBps});
  const stressFull=runTsmomClassic(dataset,{costBps:TSMOM_V2_PREREGISTRATION.config.stressCostBps});
  const h=filtered(baseFull,{start:split.holdoutFrom,end:split.holdoutTo});
  const hs=filtered(stressFull,{start:split.holdoutFrom,end:split.holdoutTo});
  if(h.summary.periods<TSMOM_V2_PREREGISTRATION.gate.minEvaluationPeriods){
    return {ruleset:TSMOM_V2_PREREGISTRATION.ruleset,split,discovery,holdout:concise(h,hs,{pass:false,label:'STAGE_B_GATE_FAIL',reasons:['INSUFFICIENT_SPLIT_SAMPLE'],researchOnly:true,executionImpact:false,autoPromotion:false}),decision:'INSUFFICIENT_SPLIT_SAMPLE',researchOnly:true,executionImpact:false,autoPromotion:false};
  }
  const holdoutGate=gateView(h,hs,{holdoutUntouched:true});
  return {
    ruleset:TSMOM_V2_PREREGISTRATION.ruleset,split,discovery,
    holdout:concise(h,hs,holdoutGate),
    decision:holdoutGate.pass?'TSMOM_V2_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED':'TSMOM_V2_HOLDOUT_FAIL',
    researchOnly:true,executionImpact:false,autoPromotion:false
  };
}
