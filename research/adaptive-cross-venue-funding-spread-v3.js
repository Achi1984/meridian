import {
  CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG,
  normalizeFunding,
  normalizeMarks
} from './cross-venue-funding-spread-v1.js';

export const ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_RULESET='ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-FROZEN';
export const ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS=Object.freeze(['HBAR','SUI','NEAR','FIL','UNI','AAVE','ATOM','ARB']);
export const ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_CONFIG=Object.freeze({
  ...CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG,
  noTradeThreshold:0.0078,
  reservedCapitalPerAsset:20000,
  portfolioReservedCapital:160000,
  discoveryMonths:Object.freeze(['2024-10','2024-11','2024-12','2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08']),
  holdoutMonths:Object.freeze(['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']),
  discoveryGate:Object.freeze({
    expectedDecisionSlots:88,
    minActiveCycles:32,
    minAssetsWithTwoActiveCycles:6,
    minCyclesPerDirection:4,
    minProfitFactor:1.20,
    maxDrawdownPct:8,
    minPositiveWindows:4,
    minFundingCostRatio:1.25,
    minPositiveAssets:5,
    maxPositiveConcentrationPct:50
  }),
  holdoutGate:Object.freeze({
    expectedDecisionSlots:96,
    minActiveCycles:32,
    minAssetsWithTwoActiveCycles:6,
    minCyclesPerDirection:4,
    minProfitFactor:1.15,
    maxDrawdownPct:8,
    minPositiveWindows:3,
    minFundingCostRatio:1.15,
    minPositiveAssets:5,
    maxPositiveConcentrationPct:50
  })
});

const HOUR=3600000,DAY=86400000;
const sum=a=>a.reduce((s,x)=>s+x,0);
const finite=x=>Number.isFinite(Number(x));
const num=x=>Number(x);
const round=(x,d=8)=>finite(x)?Number(num(x).toFixed(d)):null;

function monthBounds(key){
  const [y,m]=key.split('-').map(Number);
  return {
    start:Date.UTC(y,m-1,1),
    end:m===12?Date.UTC(y+1,0,1):Date.UTC(y,m,1)
  };
}
function previousMonth(key){
  const [y,m]=key.split('-').map(Number);
  const d=new Date(Date.UTC(y,m-1,1));
  d.setUTCMonth(d.getUTCMonth()-1);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
}
function rawTimestamp(x,kind){
  if(Array.isArray(x))return num(x[0]);
  return kind==='funding'?num(x?.fundingTime??x?.time??x?.ts):num(x?.t??x?.openTime??x?.time);
}
function hasDuplicateTimestamp(rows,kind){
  const seen=new Set();
  for(const x of rows||[]){
    const t=rawTimestamp(x,kind);
    if(!finite(t))continue;
    if(seen.has(t))return true;
    seen.add(t);
  }
  return false;
}
function strictlyIncreasing(rows){
  for(let i=1;i<rows.length;i++)if(!(rows[i].time>rows[i-1].time))return false;
  return true;
}
function maxGapHours(rows){
  if(!rows||rows.length<2)return Infinity;
  let g=0;
  for(let i=1;i<rows.length;i++)g=Math.max(g,(rows[i].time-rows[i-1].time)/HOUR);
  return g;
}
function fundingSlice(rows,start,endExclusive){
  return rows.filter(x=>x.time>=start&&x.time<endExclusive);
}
function markSlice(rows,start,endExclusive){
  return rows.filter(x=>x.time>=start&&x.time<endExclusive);
}
function firstAtOrAfter(rows,ts){return rows.find(x=>x.time>=ts)||null}
function lastBefore(rows,ts){
  for(let i=rows.length-1;i>=0;i--)if(rows[i].time<ts)return rows[i];
  return null;
}
function profitFactor(values){
  const wins=sum(values.filter(x=>x>0)),loss=Math.abs(sum(values.filter(x=>x<0)));
  return loss>0?wins/loss:(wins>0?99:0);
}
function summaryFromReturns(returns){
  let eq=1,peak=1,maxDD=0;
  for(const r of returns){
    eq*=1+r;peak=Math.max(peak,eq);
    if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak);
  }
  return{
    periods:returns.length,
    totalReturnPct:(eq-1)*100,
    profitFactor:profitFactor(returns),
    maxDrawdownPct:maxDD*100,
    positivePeriods:returns.filter(x=>x>0).length
  };
}
function chronologicalWindows(periods,parts=5){
  const windows=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    const rs=periods.slice(a,b).map(x=>x.return);
    windows.push({index:i+1,periods:rs.length,returnPct:summaryFromReturns(rs).totalReturnPct});
  }
  return{windows,positiveWindows:windows.filter(x=>x.returnPct>0).length};
}
function costUsd(cfg,stress=false){
  const bps=cfg.feeBpsPerFill+cfg.slippageBpsPerFill+(stress?cfg.stressExtraBpsPerFill:0);
  return cfg.notionalPerLeg*(4*bps)/10000;
}

function normalizeAssetData(data){
  const rawBF=data?.binanceFunding||[],rawHF=data?.hyperliquidFunding||[],rawBM=data?.binanceMarks||[],rawHM=data?.hyperliquidMarks||[];
  const duplicateReasons=[];
  if(hasDuplicateTimestamp(rawBF,'funding'))duplicateReasons.push('BINANCE_FUNDING_DUPLICATE');
  if(hasDuplicateTimestamp(rawHF,'funding'))duplicateReasons.push('HYPERLIQUID_FUNDING_DUPLICATE');
  if(hasDuplicateTimestamp(rawBM,'mark'))duplicateReasons.push('BINANCE_MARK_DUPLICATE');
  if(hasDuplicateTimestamp(rawHM,'mark'))duplicateReasons.push('HYPERLIQUID_MARK_DUPLICATE');
  const bf=normalizeFunding(rawBF),hf=normalizeFunding(rawHF),bm=normalizeMarks(rawBM),hm=normalizeMarks(rawHM);
  if(!strictlyIncreasing(bf))duplicateReasons.push('BINANCE_FUNDING_NONMONOTONIC');
  if(!strictlyIncreasing(hf))duplicateReasons.push('HYPERLIQUID_FUNDING_NONMONOTONIC');
  if(!strictlyIncreasing(bm))duplicateReasons.push('BINANCE_MARK_NONMONOTONIC');
  if(!strictlyIncreasing(hm))duplicateReasons.push('HYPERLIQUID_MARK_NONMONOTONIC');
  return{bf,hf,bm,hm,duplicateReasons};
}

function validateFundingMonth(bf,hf,key,cfg,prefix){
  const {start,end}=monthBounds(key);
  const bfs=fundingSlice(bf,start,end),hfs=fundingSlice(hf,start,end);
  const reasons=[];
  if(bfs.length<cfg.minBinanceFundingPerMonth)reasons.push(prefix+'_BINANCE_FUNDING_COUNT');
  if(hfs.length<cfg.minHyperliquidFundingPerMonth)reasons.push(prefix+'_HYPERLIQUID_FUNDING_COUNT');
  if(maxGapHours(bfs)>cfg.maxBinanceFundingGapHours)reasons.push(prefix+'_BINANCE_FUNDING_GAP');
  if(maxGapHours(hfs)>cfg.maxHyperliquidFundingGapHours)reasons.push(prefix+'_HYPERLIQUID_FUNDING_GAP');
  if(bfs.some(x=>!finite(x.rate))||hfs.some(x=>!finite(x.rate)))reasons.push(prefix+'_NONFINITE_FUNDING');
  return{bfs,hfs,reasons,spread:sum(hfs.map(x=>x.rate))-sum(bfs.map(x=>x.rate))};
}

export function decideAdaptiveDirection(trailingSpread,threshold=ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_CONFIG.noTradeThreshold){
  if(!finite(trailingSpread))throw new Error('non-finite trailing spread');
  if(Math.abs(trailingSpread)<threshold)return{active:false,direction:0,label:'NO_TRADE'};
  if(trailingSpread>0)return{active:true,direction:1,label:'LONG_BINANCE_SHORT_HYPERLIQUID'};
  return{active:true,direction:-1,label:'SHORT_BINANCE_LONG_HYPERLIQUID'};
}

function activeCycle(asset,key,data,cfg,signal){
  const current=validateFundingMonth(data.bf,data.hf,key,cfg,'CURRENT');
  const {start,end}=monthBounds(key);
  const bms=markSlice(data.bm,start,end),hms=markSlice(data.hm,start,end);
  const reasons=[...current.reasons];
  if(maxGapHours(bms)>cfg.maxMarkGapHours)reasons.push('CURRENT_BINANCE_MARK_GAP');
  if(maxGapHours(hms)>cfg.maxMarkGapHours)reasons.push('CURRENT_HYPERLIQUID_MARK_GAP');
  const be=firstAtOrAfter(bms,start),he=firstAtOrAfter(hms,start),bx=lastBefore(bms,end),hx=lastBefore(hms,end);
  if(!be||!he||!bx||!hx)reasons.push('CURRENT_BOUNDARY_MARK_MISSING');
  if(reasons.length)return{valid:false,reasons,current};
  if((be.time-start)/HOUR>cfg.maxBoundaryLagHours||(he.time-start)/HOUR>cfg.maxBoundaryLagHours)reasons.push('ENTRY_BOUNDARY_LAG');
  if((end-bx.time)/HOUR>cfg.maxBoundaryLagHours||(end-hx.time)/HOUR>cfg.maxBoundaryLagHours)reasons.push('EXIT_BOUNDARY_LAG');
  const entry=Math.max(be.time,he.time),exit=Math.min(bx.time,hx.time);
  if((exit-entry)/DAY<cfg.minCycleDays)reasons.push('CYCLE_TOO_SHORT');
  if(reasons.length)return{valid:false,reasons,current};

  const qB=cfg.notionalPerLeg/be.close,qH=cfg.notionalPerLeg/he.close;
  const d=signal.direction;
  const fundingUsd=d*cfg.notionalPerLeg*current.spread;
  const basisBase=qB*(bx.close-be.close)+qH*(he.close-hx.close);
  const basisUsd=d*basisBase;
  const baseCosts=costUsd(cfg,false),stressCosts=costUsd(cfg,true);
  const netUsd=fundingUsd+basisUsd-baseCosts;
  const stressNetUsd=fundingUsd+basisUsd-stressCosts;
  return{
    valid:true,
    asset,month:key,direction:d,directionLabel:signal.label,
    signalSpread:signal.trailingSpread,
    currentSpread:current.spread,
    signAgreement:Math.sign(signal.trailingSpread)===Math.sign(current.spread),
    marks:{binanceEntry:be.close,binanceExit:bx.close,hyperliquidEntry:he.close,hyperliquidExit:hx.close},
    counts:{binanceFunding:current.bfs.length,hyperliquidFunding:current.hfs.length,binanceMarks:bms.length,hyperliquidMarks:hms.length},
    pnl:{fundingUsd,basisUsd,costsUsd:baseCosts,stressCostsUsd:stressCosts,netUsd,stressNetUsd}
  };
}

function gateStage(result,gate,stage){
  const reasons=[];
  if(result.decisionSlots!==gate.expectedDecisionSlots)reasons.push('DECISION_SLOTS_NE_'+gate.expectedDecisionSlots);
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  if(result.activeCycles<gate.minActiveCycles)reasons.push('ACTIVE_CYCLES_LT_'+gate.minActiveCycles);
  const breadth=result.byAsset.filter(x=>x.activeCycles>=2).length;
  if(breadth<gate.minAssetsWithTwoActiveCycles)reasons.push('ACTIVE_ASSET_BREADTH_LT_'+gate.minAssetsWithTwoActiveCycles);
  for(const dir of result.byDirection){
    if(dir.cycles<gate.minCyclesPerDirection)reasons.push(dir.label+':CYCLES_LT_'+gate.minCyclesPerDirection);
    if(!(dir.netPnl>0))reasons.push(dir.label+':PNL_NOT_POSITIVE');
  }
  if(!(result.summary.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(result.summary.profitFactor>=gate.minProfitFactor))reasons.push('PF_LT_'+gate.minProfitFactor);
  if(!(result.summary.maxDrawdownPct<=gate.maxDrawdownPct))reasons.push('DD_GT_'+gate.maxDrawdownPct);
  if(result.positiveWindows<gate.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  if(!(result.summary.totalFundingPnl>0))reasons.push('FUNDING_PNL_NOT_POSITIVE');
  if(!(result.fundingCostRatio>=gate.minFundingCostRatio))reasons.push('FUNDING_COST_RATIO_LT_'+gate.minFundingCostRatio);
  if(!(result.stressSummary.totalReturnPct>0))reasons.push('STRESS_RETURN_NOT_POSITIVE');
  if(result.positiveAssets<gate.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+gate.minPositiveAssets);
  if(result.positiveConcentrationPct>gate.maxPositiveConcentrationPct)reasons.push('POSITIVE_CONCENTRATION_GT_'+gate.maxPositiveConcentrationPct);
  const pass=reasons.length===0;
  return{
    pass,reasons,
    decision:pass
      ?(stage==='DISCOVERY'?'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED':'HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY')
      :(stage==='DISCOVERY'?'DISCOVERY_FAIL_RESEARCH_REDESIGN':'HOLDOUT_FAIL_RESEARCH_REDESIGN')
  };
}

export function runAdaptiveCrossVenueFundingSpreadV3(dataset,{stage='DISCOVERY'}={}){
  const cfg=ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_CONFIG;
  const months=stage==='DISCOVERY'?[...cfg.discoveryMonths]:[...cfg.holdoutMonths];
  const gate=stage==='DISCOVERY'?cfg.discoveryGate:cfg.holdoutGate;
  const slots=[],cycles=[];
  let dataIntegrityFailure=false;
  const dataIntegrityErrors=[];

  for(const asset of ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS){
    const data=normalizeAssetData(dataset?.[asset]||{});
    if(data.duplicateReasons.length){
      dataIntegrityFailure=true;
      dataIntegrityErrors.push({asset,reasons:data.duplicateReasons});
    }
    for(const key of months){
      const sigKey=previousMonth(key);
      const sig=validateFundingMonth(data.bf,data.hf,sigKey,cfg,'SIGNAL');
      if(sig.reasons.length){
        dataIntegrityFailure=true;
        dataIntegrityErrors.push({asset,month:key,signalMonth:sigKey,reasons:sig.reasons});
        slots.push({asset,month:key,signalMonth:sigKey,valid:false,active:false,reasons:sig.reasons});
        continue;
      }
      const decision=decideAdaptiveDirection(sig.spread,cfg.noTradeThreshold);
      const slot={asset,month:key,signalMonth:sigKey,valid:true,active:decision.active,direction:decision.direction,directionLabel:decision.label,trailingSpread:sig.spread};
      slots.push(slot);
      if(!decision.active)continue;
      const cycle=activeCycle(asset,key,data,cfg,{...decision,trailingSpread:sig.spread});
      if(!cycle.valid){
        dataIntegrityFailure=true;
        dataIntegrityErrors.push({asset,month:key,reasons:cycle.reasons});
        continue;
      }
      cycles.push(cycle);
    }
  }

  const periods=months.map(month=>{
    const xs=cycles.filter(x=>x.month===month);
    const netUsd=sum(xs.map(x=>x.pnl.netUsd));
    const stressNetUsd=sum(xs.map(x=>x.pnl.stressNetUsd));
    return{
      month,
      activeAssets:xs.map(x=>x.asset),
      activeCycles:xs.length,
      netUsd,
      stressNetUsd,
      return:netUsd/cfg.portfolioReservedCapital,
      stressReturn:stressNetUsd/cfg.portfolioReservedCapital
    };
  });
  const summary=summaryFromReturns(periods.map(x=>x.return));
  const stressSummary=summaryFromReturns(periods.map(x=>x.stressReturn));
  const stability=chronologicalWindows(periods,5);
  const byAsset=ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS.map(asset=>{
    const xs=cycles.filter(x=>x.asset===asset);
    return{
      asset,
      activeCycles:xs.length,
      binanceLongCycles:xs.filter(x=>x.direction===1).length,
      hyperliquidLongCycles:xs.filter(x=>x.direction===-1).length,
      netPnl:sum(xs.map(x=>x.pnl.netUsd)),
      stressNetPnl:sum(xs.map(x=>x.pnl.stressNetUsd)),
      fundingPnl:sum(xs.map(x=>x.pnl.fundingUsd)),
      basisPnl:sum(xs.map(x=>x.pnl.basisUsd)),
      costs:sum(xs.map(x=>x.pnl.costsUsd))
    };
  });
  const byDirection=[
    {label:'LONG_BINANCE_SHORT_HYPERLIQUID',direction:1},
    {label:'SHORT_BINANCE_LONG_HYPERLIQUID',direction:-1}
  ].map(d=>{
    const xs=cycles.filter(x=>x.direction===d.direction);
    return{...d,cycles:xs.length,netPnl:sum(xs.map(x=>x.pnl.netUsd)),stressNetPnl:sum(xs.map(x=>x.pnl.stressNetUsd)),fundingPnl:sum(xs.map(x=>x.pnl.fundingUsd)),basisPnl:sum(xs.map(x=>x.pnl.basisUsd))};
  });
  const positive=byAsset.filter(x=>x.netPnl>0),positiveTotal=sum(positive.map(x=>x.netPnl));
  const positiveConcentrationPct=positiveTotal>0?Math.max(...positive.map(x=>x.netPnl))/positiveTotal*100:0;
  const totalFundingPnl=sum(cycles.map(x=>x.pnl.fundingUsd));
  const totalCosts=sum(cycles.map(x=>x.pnl.costsUsd));
  const fundingCostRatio=totalCosts>0?totalFundingPnl/totalCosts:0;
  const activeSignals=cycles.map(x=>Math.abs(x.signalSpread));
  const allSignals=slots.filter(x=>x.valid).map(x=>Math.abs(x.trailingSpread));
  const sorted=a=>[...a].sort((x,y)=>x-y);
  const median=a=>{
    if(!a.length)return 0;
    const s=sorted(a),m=Math.floor(s.length/2);
    return s.length%2?s[m]:(s[m-1]+s[m])/2;
  };
  const result={
    ruleset:ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_RULESET,
    stage,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    assets:[...ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS],
    months,
    decisionSlots:slots.length,
    activeCycles:cycles.length,
    noTradeCycles:slots.filter(x=>x.valid&&!x.active).length,
    binanceLongCycles:cycles.filter(x=>x.direction===1).length,
    hyperliquidLongCycles:cycles.filter(x=>x.direction===-1).length,
    dataIntegrityFailure,
    dataIntegrityErrors,
    slots,cycles,periods,byAsset,byDirection,
    summary:{...summary,totalNetPnl:sum(cycles.map(x=>x.pnl.netUsd)),totalFundingPnl,totalBasisPnl:sum(cycles.map(x=>x.pnl.basisUsd)),totalCosts},
    stressSummary,
    positiveWindows:stability.positiveWindows,
    windows:stability.windows,
    fundingCostRatio,
    positiveAssets:positive.length,
    positiveConcentrationPct,
    signalSignAgreementPct:cycles.length?cycles.filter(x=>x.signAgreement).length/cycles.length*100:0,
    meanAbsTrailingSpread:allSignals.length?sum(allSignals)/allSignals.length:0,
    medianAbsTrailingSpread:median(allSignals),
    meanActiveTrailingSpread:activeSignals.length?sum(activeSignals)/activeSignals.length:0,
    medianActiveTrailingSpread:median(activeSignals)
  };
  result.gate=gateStage(result,gate,stage);
  result.decision=result.gate.decision;
  return result;
}
