import {
  DOCUMENTED_EDGE_ASSETS,
  TSMOM_CLASSIC_CONFIG,
  TSMOM_ENGINE_REVISION,
  runTsmomClassic,
  evaluateTsmomGate
} from './documented-edge-v1.js';

export const TSMOM_HOLDOUT_V1_RULESET='TSMOM-HOLDOUT-V1-FROZEN';
export const TSMOM_TRANSFER_ASSETS=Object.freeze(['BNB','ADA','DOGE','DOT','XLM','TRX','LTC','BCH']);
export const TSMOM_LEGACY_START=Date.UTC(2020,4,1);
export const TSMOM_LEGACY_END=Date.UTC(2022,6,31,23,59,59,999);
export const TSMOM_TRANSFER_DAYS=1460;

const finite=v=>Number.isFinite(Number(v));
const n=v=>Number(v);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const pf=rows=>{
  const w=rows.filter(x=>x>0).reduce((a,b)=>a+b,0),l=Math.abs(rows.filter(x=>x<0).reduce((a,b)=>a+b,0));
  return l>0?w/l:(w>0?99:0);
};

function summarize(returns,startEquity=10000){
  let eq=startEquity,peak=startEquity,maxDD=0;
  for(const r of returns){
    eq*=1+r;peak=Math.max(peak,eq);
    if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak*100);
  }
  return{
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
function windows(periods,parts=5){
  if(!periods.length)return{windows:[],positiveWindows:0};
  const out=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts),slice=periods.slice(a,b);
    const s=summarize(slice.map(x=>x.netReturn));
    out.push({i:i+1,from:slice[0]?.at??null,to:slice.at(-1)?.at??null,...s,positive:s.totalReturnPct>0});
  }
  return{windows:out,positiveWindows:out.filter(x=>x.positive).length};
}
function diagnostics(periods){
  const legs=periods.flatMap(p=>p.legs||[]);
  const long=legs.filter(x=>n(x.position)>0),short=legs.filter(x=>n(x.position)<0);
  const weightedContribution=(rows,side)=>{
    let x=0;
    for(const p of periods){
      const active=Math.max(1,p.activeAssets||0);
      for(const leg of p.legs||[])if(side(leg))x+=n(leg.netReturn)/active;
    }
    return x*100;
  };
  const costs=periods.reduce((a,p)=>a+n(p.costReturn||0),0)*100;
  const grossAbs=periods.reduce((a,p)=>a+Math.abs(n(p.grossReturn||0)),0)*100;
  return{
    avgAbsPosition:legs.length?mean(legs.map(x=>Math.abs(n(x.position)))):0,
    avgLeverage:legs.length?mean(legs.map(x=>n(x.leverage)||0)):0,
    longSignalSharePct:legs.length?long.length/legs.length*100:0,
    shortSignalSharePct:legs.length?short.length/legs.length*100:0,
    longContributionPct:weightedContribution(long,x=>n(x.position)>0),
    shortContributionPct:weightedContribution(short,x=>n(x.position)<0),
    modeledCostSumPct:costs,
    modeledCostVsGrossAbsPct:grossAbs>0?costs/grossAbs*100:0
  };
}
function recomputeAssets(periods,startEquity=10000){
  const by=new Map();
  for(const p of periods){
    for(const leg of p.legs||[]){
      if(!by.has(leg.symbol))by.set(leg.symbol,[]);
      by.get(leg.symbol).push(leg.netReturn);
    }
  }
  return [...by.entries()].map(([symbol,rs])=>({symbol,periods:rs.length,summary:summarize(rs,startEquity)})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}
export function filterTsmomWindow(base,{start,end}){
  const periods=(base?.periods||[]).filter(p=>(start==null||p.at>=start)&&(end==null||p.at<=end));
  const summary=summarize(periods.map(x=>x.netReturn),base?.config?.startEquity||10000);
  const stability=windows(periods,5),assets=recomputeAssets(periods,base?.config?.startEquity||10000);
  const gate=evaluateTsmomGate(summary,stability,assets,base?.config||TSMOM_CLASSIC_CONFIG);
  return{
    ruleset:TSMOM_HOLDOUT_V1_RULESET,
    engineRevision:base?.engineRevision||TSMOM_ENGINE_REVISION,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    config:base?.config||TSMOM_CLASSIC_CONFIG,
    summary,stability,assets,periods,gate,diagnostics:diagnostics(periods),
    start,end
  };
}
export function runLegacyTimeHoldout(dataset){
  const base=runTsmomClassic(dataset);
  return filterTsmomWindow(base,{start:TSMOM_LEGACY_START,end:TSMOM_LEGACY_END});
}
export function runTransferUniverseHoldout(dataset){
  const base=runTsmomClassic(dataset),last=base.periods?.at(-1)?.at??null;
  if(last==null)return{...base,ruleset:TSMOM_HOLDOUT_V1_RULESET,diagnostics:diagnostics([]),transferUniverse:[...TSMOM_TRANSFER_ASSETS],transferDays:TSMOM_TRANSFER_DAYS};
  const start=last-TSMOM_TRANSFER_DAYS*86400000;
  const filtered=filterTsmomWindow(base,{start,end:last});
  return {...filtered,transferUniverse:[...TSMOM_TRANSFER_ASSETS],transferDays:TSMOM_TRANSFER_DAYS};
}
export function evaluateCombinedTsmomHoldout({legacy,transfer}){
  const reasons=[];
  if(!legacy?.gate?.pass)reasons.push('LEGACY_GATE_FAIL');
  if(!transfer?.gate?.pass)reasons.push('TRANSFER_GATE_FAIL');
  if((legacy?.assets||[]).length<4)reasons.push('LEGACY_DATA_BREADTH_LT_4');
  if((transfer?.assets||[]).length<TSMOM_TRANSFER_ASSETS.length)reasons.push('TRANSFER_DATA_BREADTH_LT_8');
  return{
    pass:reasons.length===0,
    reasons,
    autoPromotion:false,
    executionImpact:false,
    label:reasons.length?'HOLDOUT_FAIL':'HOLDOUT_PASS',
    legacyAssets:(legacy?.assets||[]).length,
    transferAssets:(transfer?.assets||[]).length
  };
}
export function holdoutProtocol(){
  return{
    ruleset:TSMOM_HOLDOUT_V1_RULESET,
    engineRevision:TSMOM_ENGINE_REVISION,
    discoveryUniverse:[...DOCUMENTED_EDGE_ASSETS],
    transferUniverse:[...TSMOM_TRANSFER_ASSETS],
    transferDays:TSMOM_TRANSFER_DAYS,
    legacyWindow:{start:TSMOM_LEGACY_START,end:TSMOM_LEGACY_END},
    unchangedConfig:{...TSMOM_CLASSIC_CONFIG},
    requirements:'Both independent holdouts must pass the same frozen TSMOM gate. No parameter changes, no asset dropping, no auto-promotion.'
  };
}
