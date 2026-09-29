import {
  CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG,
  normalizeFunding,
  normalizeMarks
} from './cross-venue-funding-spread-v1.js';

export const SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_RULESET='SELECTIVE-STATIC-CROSS-VENUE-FUNDING-V4-FROZEN';
export const SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS=Object.freeze(['HBAR','SUI','NEAR','FIL','UNI','AAVE','ATOM','ARB']);
export const SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG=Object.freeze({
  ...CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG,
  noTradeThreshold:0.0078,
  reservedCapitalPerAsset:20000,
  portfolioReservedCapital:160000,
  validationMonths:Object.freeze(['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']),
  gate:Object.freeze({
    expectedDecisionSlots:96,
    minActiveCycles:24,
    minAssetsWithTwoActiveCycles:6,
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

function monthBounds(key){
  const [y,m]=key.split('-').map(Number);
  return{start:Date.UTC(y,m-1,1),end:m===12?Date.UTC(y+1,0,1):Date.UTC(y,m,1)};
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
function fundingSlice(rows,start,end){return rows.filter(x=>x.time>=start&&x.time<end)}
function markSlice(rows,start,end){return rows.filter(x=>x.time>=start&&x.time<end)}
function firstAtOrAfter(rows,ts){return rows.find(x=>x.time>=ts)||null}
function lastBefore(rows,ts){for(let i=rows.length-1;i>=0;i--)if(rows[i].time<ts)return rows[i];return null}
function profitFactor(values){
  const wins=sum(values.filter(x=>x>0)),loss=Math.abs(sum(values.filter(x=>x<0)));
  return loss>0?wins/loss:(wins>0?99:0);
}
function summaryFromReturns(returns){
  let eq=1,peak=1,maxDD=0;
  for(const r of returns){eq*=1+r;peak=Math.max(peak,eq);if(peak>0)maxDD=Math.max(maxDD,(peak-eq)/peak)}
  return{periods:returns.length,totalReturnPct:(eq-1)*100,profitFactor:profitFactor(returns),maxDrawdownPct:maxDD*100,positivePeriods:returns.filter(x=>x>0).length};
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
  const reasons=[];
  if(hasDuplicateTimestamp(rawBF,'funding'))reasons.push('BINANCE_FUNDING_DUPLICATE');
  if(hasDuplicateTimestamp(rawHF,'funding'))reasons.push('HYPERLIQUID_FUNDING_DUPLICATE');
  if(hasDuplicateTimestamp(rawBM,'mark'))reasons.push('BINANCE_MARK_DUPLICATE');
  if(hasDuplicateTimestamp(rawHM,'mark'))reasons.push('HYPERLIQUID_MARK_DUPLICATE');
  const bf=normalizeFunding(rawBF),hf=normalizeFunding(rawHF),bm=normalizeMarks(rawBM),hm=normalizeMarks(rawHM);
  if(!strictlyIncreasing(bf))reasons.push('BINANCE_FUNDING_NONMONOTONIC');
  if(!strictlyIncreasing(hf))reasons.push('HYPERLIQUID_FUNDING_NONMONOTONIC');
  if(!strictlyIncreasing(bm))reasons.push('BINANCE_MARK_NONMONOTONIC');
  if(!strictlyIncreasing(hm))reasons.push('HYPERLIQUID_MARK_NONMONOTONIC');
  return{bf,hf,bm,hm,reasons};
}
function validateFundingMonth(bf,hf,key,cfg,prefix){
  const {start,end}=monthBounds(key);
  const bfs=fundingSlice(bf,start,end),hfs=fundingSlice(hf,start,end),reasons=[];
  if(bfs.length<cfg.minBinanceFundingPerMonth)reasons.push(prefix+'_BINANCE_FUNDING_COUNT');
  if(hfs.length<cfg.minHyperliquidFundingPerMonth)reasons.push(prefix+'_HYPERLIQUID_FUNDING_COUNT');
  if(maxGapHours(bfs)>cfg.maxBinanceFundingGapHours)reasons.push(prefix+'_BINANCE_FUNDING_GAP');
  if(maxGapHours(hfs)>cfg.maxHyperliquidFundingGapHours)reasons.push(prefix+'_HYPERLIQUID_FUNDING_GAP');
  if(bfs.some(x=>!finite(x.rate))||hfs.some(x=>!finite(x.rate)))reasons.push(prefix+'_NONFINITE_FUNDING');
  return{bfs,hfs,reasons,spread:sum(hfs.map(x=>x.rate))-sum(bfs.map(x=>x.rate))};
}
export function decideSelectiveStaticV4(trailingSpread,threshold=SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG.noTradeThreshold){
  if(!finite(trailingSpread))throw new Error('non-finite trailing spread');
  return trailingSpread>=threshold
    ?{active:true,direction:1,label:'LONG_BINANCE_SHORT_HYPERLIQUID'}
    :{active:false,direction:0,label:'NO_TRADE'};
}
function activeCycle(asset,key,data,cfg,signal){
  const current=validateFundingMonth(data.bf,data.hf,key,cfg,'CURRENT');
  const {start,end}=monthBounds(key);
  const bms=markSlice(data.bm,start,end),hms=markSlice(data.hm,start,end),reasons=[...current.reasons];
  if(maxGapHours(bms)>cfg.maxMarkGapHours)reasons.push('CURRENT_BINANCE_MARK_GAP');
  if(maxGapHours(hms)>cfg.maxMarkGapHours)reasons.push('CURRENT_HYPERLIQUID_MARK_GAP');
  const be=firstAtOrAfter(bms,start),he=firstAtOrAfter(hms,start),bx=lastBefore(bms,end),hx=lastBefore(hms,end);
  if(!be||!he||!bx||!hx)reasons.push('CURRENT_BOUNDARY_MARK_MISSING');
  if(reasons.length)return{valid:false,reasons};
  if((be.time-start)/HOUR>cfg.maxBoundaryLagHours||(he.time-start)/HOUR>cfg.maxBoundaryLagHours)reasons.push('ENTRY_BOUNDARY_LAG');
  if((end-bx.time)/HOUR>cfg.maxBoundaryLagHours||(end-hx.time)/HOUR>cfg.maxBoundaryLagHours)reasons.push('EXIT_BOUNDARY_LAG');
  const entry=Math.max(be.time,he.time),exit=Math.min(bx.time,hx.time);
  if((exit-entry)/DAY<cfg.minCycleDays)reasons.push('CYCLE_TOO_SHORT');
  if(reasons.length)return{valid:false,reasons};

  const qB=cfg.notionalPerLeg/be.close,qH=cfg.notionalPerLeg/he.close;
  const fundingUsd=cfg.notionalPerLeg*current.spread;
  const basisUsd=qB*(bx.close-be.close)+qH*(he.close-hx.close);
  const baseCosts=costUsd(cfg,false),stressCosts=costUsd(cfg,true);
  const netUsd=fundingUsd+basisUsd-baseCosts,stressNetUsd=fundingUsd+basisUsd-stressCosts;
  return{
    valid:true,asset,month:key,direction:1,directionLabel:'LONG_BINANCE_SHORT_HYPERLIQUID',
    signalSpread:signal.trailingSpread,currentSpread:current.spread,
    signAgreement:Math.sign(signal.trailingSpread)===Math.sign(current.spread),
    pnl:{fundingUsd,basisUsd,costsUsd:baseCosts,stressCostsUsd:stressCosts,netUsd,stressNetUsd}
  };
}
function evaluateGate(result,gate){
  const reasons=[];
  if(result.decisionSlots!==gate.expectedDecisionSlots)reasons.push('DECISION_SLOTS_NE_'+gate.expectedDecisionSlots);
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  if(result.activeCycles<gate.minActiveCycles)reasons.push('ACTIVE_CYCLES_LT_'+gate.minActiveCycles);
  const breadth=result.byAsset.filter(x=>x.activeCycles>=2).length;
  if(breadth<gate.minAssetsWithTwoActiveCycles)reasons.push('ACTIVE_ASSET_BREADTH_LT_'+gate.minAssetsWithTwoActiveCycles);
  if(!(result.summary.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(result.summary.totalNetPnl>0))reasons.push('NET_PNL_NOT_POSITIVE');
  if(!(result.summary.profitFactor>=gate.minProfitFactor))reasons.push('PF_LT_'+gate.minProfitFactor);
  if(!(result.summary.maxDrawdownPct<=gate.maxDrawdownPct))reasons.push('DD_GT_'+gate.maxDrawdownPct);
  if(result.positiveWindows<gate.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  if(!(result.summary.totalFundingPnl>0))reasons.push('FUNDING_PNL_NOT_POSITIVE');
  if(!(result.fundingCostRatio>=gate.minFundingCostRatio))reasons.push('FUNDING_COST_RATIO_LT_'+gate.minFundingCostRatio);
  if(!(result.stressSummary.totalReturnPct>0))reasons.push('STRESS_RETURN_NOT_POSITIVE');
  if(result.positiveAssets<gate.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+gate.minPositiveAssets);
  if(result.positiveConcentrationPct>gate.maxPositiveConcentrationPct)reasons.push('POSITIVE_CONCENTRATION_GT_'+gate.maxPositiveConcentrationPct);
  return{pass:reasons.length===0,reasons,decision:reasons.length?'VALIDATION_FAIL_RESEARCH_REDESIGN':'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY'};
}

export function runSelectiveStaticCrossVenueFundingV4(dataset){
  const cfg=SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG,months=[...cfg.validationMonths],slots=[],cycles=[],dataIntegrityErrors=[];
  let dataIntegrityFailure=false;
  for(const asset of SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS){
    const data=normalizeAssetData(dataset?.[asset]||{});
    if(data.reasons.length){dataIntegrityFailure=true;dataIntegrityErrors.push({asset,reasons:data.reasons})}
    for(const key of months){
      const sigKey=previousMonth(key),sig=validateFundingMonth(data.bf,data.hf,sigKey,cfg,'SIGNAL');
      if(sig.reasons.length){
        dataIntegrityFailure=true;dataIntegrityErrors.push({asset,month:key,signalMonth:sigKey,reasons:sig.reasons});
        slots.push({asset,month:key,valid:false,active:false,reasons:sig.reasons});continue;
      }
      const d=decideSelectiveStaticV4(sig.spread,cfg.noTradeThreshold);
      slots.push({asset,month:key,signalMonth:sigKey,valid:true,active:d.active,trailingSpread:sig.spread,directionLabel:d.label});
      if(!d.active)continue;
      const c=activeCycle(asset,key,data,cfg,{...d,trailingSpread:sig.spread});
      if(!c.valid){dataIntegrityFailure=true;dataIntegrityErrors.push({asset,month:key,reasons:c.reasons});continue}
      cycles.push(c);
    }
  }
  const periods=months.map(month=>{
    const xs=cycles.filter(x=>x.month===month),netUsd=sum(xs.map(x=>x.pnl.netUsd)),stressNetUsd=sum(xs.map(x=>x.pnl.stressNetUsd));
    return{month,activeCycles:xs.length,netUsd,stressNetUsd,return:netUsd/cfg.portfolioReservedCapital,stressReturn:stressNetUsd/cfg.portfolioReservedCapital};
  });
  const summary=summaryFromReturns(periods.map(x=>x.return)),stressSummary=summaryFromReturns(periods.map(x=>x.stressReturn)),stability=chronologicalWindows(periods,5);
  const byAsset=SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS.map(asset=>{
    const xs=cycles.filter(x=>x.asset===asset);
    return{asset,activeCycles:xs.length,netPnl:sum(xs.map(x=>x.pnl.netUsd)),stressNetPnl:sum(xs.map(x=>x.pnl.stressNetUsd)),fundingPnl:sum(xs.map(x=>x.pnl.fundingUsd)),basisPnl:sum(xs.map(x=>x.pnl.basisUsd)),costs:sum(xs.map(x=>x.pnl.costsUsd))};
  });
  const positive=byAsset.filter(x=>x.netPnl>0),positiveTotal=sum(positive.map(x=>x.netPnl));
  const totalFundingPnl=sum(cycles.map(x=>x.pnl.fundingUsd)),totalCosts=sum(cycles.map(x=>x.pnl.costsUsd);
  const activeSpreads=cycles.map(x=>Math.abs(x.signalSpread)).sort((a,b)=>a-b);
  const median=a=>!a.length?0:(a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2);
  const result={
    ruleset:SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_RULESET,
    stage:'INDEPENDENT_VALIDATION',researchOnly:true,executionImpact:false,autoPromotion:false,
    assets:[...SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS],months,
    decisionSlots:slots.length,activeCycles:cycles.length,noTradeCycles:slots.filter(x=>x.valid&&!x.active).length,
    dataIntegrityFailure,dataIntegrityErrors,slots,cycles,periods,byAsset,
    summary:{...summary,totalNetPnl:sum(cycles.map(x=>x.pnl.netUsd)),totalFundingPnl,totalBasisPnl:sum(cycles.map(x=>x.pnl.basisUsd)),totalCosts},
    stressSummary,positiveWindows:stability.positiveWindows,windows:stability.windows,
    fundingCostRatio:totalCosts>0?totalFundingPnl/totalCosts:0,
    positiveAssets:positive.length,
    positiveConcentrationPct:positiveTotal>0?Math.max(...positive.map(x=>x.netPnl))/positiveTotal*100:0,
    signalSignAgreementPct:cycles.length?cycles.filter(x=>x.signAgreement).length/cycles.length*100:0,
    meanActiveTrailingSpread:activeSpreads.length?sum(activeSpreads)/activeSpreads.length:0,
    medianActiveTrailingSpread:median(activeSpreads)
  };
  result.gate=evaluateGate(result,cfg.gate);
  result.decision=result.gate.decision;
  return result;
}
