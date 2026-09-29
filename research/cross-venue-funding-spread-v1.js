export const CROSS_VENUE_FUNDING_SPREAD_V1_RULESET='CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN';

export const CROSS_VENUE_FUNDING_SPREAD_V1_ASSETS=Object.freeze(['BTC','ETH','SOL']);

export const CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG=Object.freeze({
  startEquityPerAsset:20000,
  notionalPerLeg:10000,
  feeBpsPerFill:5,
  slippageBpsPerFill:3,
  stressExtraBpsPerFill:5,
  minCycleDays:25,
  minBinanceFundingPerMonth:60,
  minHyperliquidFundingPerMonth:500,
  maxBinanceFundingGapHours:12,
  maxHyperliquidFundingGapHours:2,
  maxMarkGapHours:16,
  maxBoundaryLagHours:16,
  gate:Object.freeze({
    minAssetMonthCycles:24,
    minCyclesPerAsset:8,
    minProfitFactor:1.15,
    maxDrawdownPct:10,
    minPositiveWindows:4,
    maxPositivePnlConcentrationPct:60
  })
});

const HOUR=3600000,DAY=24*HOUR;
const finite=x=>Number.isFinite(Number(x));
const num=x=>Number(x);
const round=(x,d=8)=>Number.isFinite(Number(x))?Number(Number(x).toFixed(d)):null;

function uniqueSorted(rows){
  const m=new Map();
  for(const row of rows||[])if(Number.isFinite(row.time))m.set(row.time,row);
  return [...m.values()].sort((a,b)=>a.time-b.time);
}
export function normalizeFunding(rows){
  return uniqueSorted((rows||[]).map(x=>({
    time:num(x?.fundingTime??x?.time??x?.ts),
    rate:num(x?.fundingRate??x?.rate)
  })).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.rate)));
}
export function normalizeMarks(rows){
  return uniqueSorted((rows||[]).map(x=>{
    if(Array.isArray(x))return{time:num(x[0]),close:num(x[4]),closeTime:num(x[6]??x[0])};
    return{time:num(x?.t??x?.openTime??x?.time),close:num(x?.c??x?.close??x?.markPrice),closeTime:num(x?.T??x?.closeTime??x?.time??x?.t)};
  }).filter(x=>Number.isFinite(x.time)&&x.close>0));
}
const monthKey=ts=>{
  const d=new Date(ts);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
};
function monthBounds(key){
  const [y,m]=key.split('-').map(Number);
  const start=Date.UTC(y,m-1,1),end=Date.UTC(y,m,1)-1;
  return{start,end};
}
function maxGapHours(rows){
  if(!rows||rows.length<2)return Infinity;
  let g=0;
  for(let i=1;i<rows.length;i++)g=Math.max(g,(rows[i].time-rows[i-1].time)/HOUR);
  return g;
}
function firstAtOrAfter(rows,ts){return rows.find(x=>x.time>=ts)||null}
function lastAtOrBefore(rows,ts){
  for(let i=rows.length-1;i>=0;i--)if(rows[i].time<=ts)return rows[i];
  return null;
}
function fundingSlice(rows,start,end){return rows.filter(x=>x.time>=start&&x.time<=end)}
function markSlice(rows,start,end){return rows.filter(x=>x.time>=start&&x.time<=end)}
function sum(a){return a.reduce((s,x)=>s+x,0)}
function mean(a){return a.length?sum(a)/a.length:0}
function profitFactor(values){
  const wins=sum(values.filter(x=>x>0)),loss=Math.abs(sum(values.filter(x=>x<0)));
  return loss>0?wins/loss:(wins>0?99:0);
}
function summaryFromReturns(returns,startEquity=100){
  let eq=startEquity,peak=eq,maxDD=0;
  for(const r of returns){
    eq*=1+r;
    peak=Math.max(peak,eq);
    maxDD=Math.max(maxDD,peak>0?(peak-eq)/peak*100:0);
  }
  return{
    periods:returns.length,
    totalReturnPct:(eq/startEquity-1)*100,
    endEquity:eq,
    profitFactor:profitFactor(returns),
    maxDrawdownPct:maxDD,
    positivePeriods:returns.filter(x=>x>0).length
  };
}
function chronologicalWindows(periods,parts=5){
  if(!periods.length)return{windows:[],positiveWindows:0};
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
function cycleForMonth(asset,key,data,cfg){
  const bounds=monthBounds(key);
  const bm=normalizeMarks(data.binanceMarks),hm=normalizeMarks(data.hyperliquidMarks);
  const bf=normalizeFunding(data.binanceFunding),hf=normalizeFunding(data.hyperliquidFunding);
  const b0=firstAtOrAfter(bm,bounds.start),h0=firstAtOrAfter(hm,bounds.start);
  const b1=lastAtOrBefore(bm,bounds.end),h1=lastAtOrBefore(hm,bounds.end);
  const reasons=[];
  if(!b0||!h0||!b1||!h1)reasons.push('MISSING_BOUNDARY_MARK');
  if(reasons.length)return{asset,month:key,valid:false,reasons};
  const entry=Math.max(b0.time,h0.time),exit=Math.min(b1.time,h1.time);
  const be=firstAtOrAfter(bm,entry),he=firstAtOrAfter(hm,entry),bx=lastAtOrBefore(bm,exit),hx=lastAtOrBefore(hm,exit);
  const durationDays=(exit-entry)/DAY;
  if(durationDays<cfg.minCycleDays)reasons.push('CYCLE_TOO_SHORT');
  if((be.time-bounds.start)/HOUR>cfg.maxBoundaryLagHours||(he.time-bounds.start)/HOUR>cfg.maxBoundaryLagHours)reasons.push('ENTRY_BOUNDARY_LAG');
  if((bounds.end-bx.time)/HOUR>cfg.maxBoundaryLagHours||(bounds.end-hx.time)/HOUR>cfg.maxBoundaryLagHours)reasons.push('EXIT_BOUNDARY_LAG');
  const bfs=fundingSlice(bf,entry,exit),hfs=fundingSlice(hf,entry,exit),bms=markSlice(bm,entry,exit),hms=markSlice(hm,entry,exit);
  if(bfs.length<cfg.minBinanceFundingPerMonth)reasons.push('BINANCE_FUNDING_COUNT');
  if(hfs.length<cfg.minHyperliquidFundingPerMonth)reasons.push('HYPERLIQUID_FUNDING_COUNT');
  if(maxGapHours(bfs)>cfg.maxBinanceFundingGapHours)reasons.push('BINANCE_FUNDING_GAP');
  if(maxGapHours(hfs)>cfg.maxHyperliquidFundingGapHours)reasons.push('HYPERLIQUID_FUNDING_GAP');
  if(maxGapHours(bms)>cfg.maxMarkGapHours)reasons.push('BINANCE_MARK_GAP');
  if(maxGapHours(hms)>cfg.maxMarkGapHours)reasons.push('HYPERLIQUID_MARK_GAP');
  if(reasons.length)return{asset,month:key,valid:false,reasons,counts:{binanceFunding:bfs.length,hyperliquidFunding:hfs.length,binanceMarks:bms.length,hyperliquidMarks:hms.length}};
  const qB=cfg.notionalPerLeg/be.close,qH=cfg.notionalPerLeg/he.close;
  const binanceFundingUsd=-cfg.notionalPerLeg*sum(bfs.map(x=>x.rate));
  const hyperliquidFundingUsd=cfg.notionalPerLeg*sum(hfs.map(x=>x.rate));
  const fundingUsd=binanceFundingUsd+hyperliquidFundingUsd;
  const basisUsd=qB*(bx.close-be.close)+qH*(he.close-hx.close);
  const baseCosts=costUsd(cfg,false),stressCosts=costUsd(cfg,true);
  const netUsd=fundingUsd+basisUsd-baseCosts,stressNetUsd=fundingUsd+basisUsd-stressCosts;
  return{
    asset,month:key,valid:true,entry,exit,durationDays:round(durationDays,3),
    marks:{binanceEntry:be.close,binanceExit:bx.close,hyperliquidEntry:he.close,hyperliquidExit:hx.close},
    counts:{binanceFunding:bfs.length,hyperliquidFunding:hfs.length,binanceMarks:bms.length,hyperliquidMarks:hms.length},
    maxGapsHours:{binanceFunding:round(maxGapHours(bfs),3),hyperliquidFunding:round(maxGapHours(hfs),3),binanceMarks:round(maxGapHours(bms),3),hyperliquidMarks:round(maxGapHours(hms),3)},
    pnl:{binanceFundingUsd:round(binanceFundingUsd,4),hyperliquidFundingUsd:round(hyperliquidFundingUsd,4),fundingUsd:round(fundingUsd,4),basisUsd:round(basisUsd,4),costsUsd:round(baseCosts,4),stressCostsUsd:round(stressCosts,4),netUsd:round(netUsd,4),stressNetUsd:round(stressNetUsd,4)},
    return:netUsd/cfg.startEquityPerAsset,
    stressReturn:stressNetUsd/cfg.startEquityPerAsset
  };
}
export function runCrossVenueFundingSpreadV1(dataset,config={}){
  const cfg={...CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG,...config,gate:{...CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG.gate,...(config.gate||{})}};
  const cycles=[],rejected=[];
  for(const asset of CROSS_VENUE_FUNDING_SPREAD_V1_ASSETS){
    const data=dataset?.[asset]||{};
    const marks=[...normalizeMarks(data.binanceMarks),...normalizeMarks(data.hyperliquidMarks)];
    const months=[...new Set(marks.map(x=>monthKey(x.time)))].sort();
    for(const key of months){
      const c=cycleForMonth(asset,key,data,cfg);
      (c.valid?cycles:rejected).push(c);
    }
  }
  const monthlyKeys=[...new Set(cycles.map(x=>x.month))].sort();
  const periods=monthlyKeys.map(month=>{
    const xs=cycles.filter(x=>x.month===month),capital=cfg.startEquityPerAsset*xs.length;
    const net=sum(xs.map(x=>x.pnl.netUsd)),stress=sum(xs.map(x=>x.pnl.stressNetUsd));
    return{month,assets:xs.map(x=>x.asset),netUsd:net,stressNetUsd:stress,return:capital>0?net/capital:0,stressReturn:capital>0?stress/capital:0};
  });
  const summary=summaryFromReturns(periods.map(x=>x.return));
  const stressSummary=summaryFromReturns(periods.map(x=>x.stressReturn));
  const stability=chronologicalWindows(periods,5);
  const byAsset=CROSS_VENUE_FUNDING_SPREAD_V1_ASSETS.map(asset=>{
    const xs=cycles.filter(x=>x.asset===asset);
    return{asset,cycles:xs.length,netPnl:sum(xs.map(x=>x.pnl.netUsd)),stressNetPnl:sum(xs.map(x=>x.pnl.stressNetUsd)),fundingPnl:sum(xs.map(x=>x.pnl.fundingUsd)),basisPnl:sum(xs.map(x=>x.pnl.basisUsd)),costs:sum(xs.map(x=>x.pnl.costsUsd))};
  });
  const positive=byAsset.filter(x=>x.netPnl>0),positiveTotal=sum(positive.map(x=>x.netPnl));
  const concentration=positiveTotal>0?Math.max(...positive.map(x=>x.netPnl/positiveTotal*100)):0;
  const g=cfg.gate,reasons=[];
  if(cycles.length<g.minAssetMonthCycles)reasons.push('CYCLES_LT_'+g.minAssetMonthCycles);
  for(const x of byAsset)if(x.cycles<g.minCyclesPerAsset)reasons.push(x.asset+'_CYCLES_LT_'+g.minCyclesPerAsset);
  if(summary.totalReturnPct<=0)reasons.push('RETURN_NOT_POSITIVE');
  if(summary.profitFactor<g.minProfitFactor)reasons.push('PF_LT_'+g.minProfitFactor);
  if(summary.maxDrawdownPct>g.maxDrawdownPct)reasons.push('DD_GT_'+g.maxDrawdownPct+'PCT');
  if(stability.positiveWindows<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+g.minPositiveWindows);
  for(const x of byAsset)if(x.netPnl<=0)reasons.push(x.asset+'_PNL_NOT_POSITIVE');
  if(concentration>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_'+g.maxPositivePnlConcentrationPct+'PCT');
  if(stressSummary.totalReturnPct<=0)reasons.push('STRESS_RETURN_NOT_POSITIVE');
  return{
    ruleset:CROSS_VENUE_FUNDING_SPREAD_V1_RULESET,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    direction:'LONG_BINANCE_USDM_PERP_SHORT_HYPERLIQUID_PERP',
    config:cfg,
    cycles,rejected,periods,byAsset,
    summary:{...summary,totalNetPnl:sum(cycles.map(x=>x.pnl.netUsd)),totalFundingPnl:sum(cycles.map(x=>x.pnl.fundingUsd)),totalBasisPnl:sum(cycles.map(x=>x.pnl.basisUsd)),totalCosts:sum(cycles.map(x=>x.pnl.costsUsd))},
    stressSummary,
    stability,
    positivePnlConcentrationPct:concentration,
    gate:{pass:reasons.length===0,reasons},
    decision:reasons.length?'DISCOVERY_FAIL_RESEARCH_REDESIGN':'DISCOVERY_PASS_HOLDOUT_REQUIRED'
  };
}
