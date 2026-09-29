export const SPOT_PERP_FUNDING_HARVEST_V1_RULESET='SPOT-PERP-FUNDING-HARVEST-V1-FROZEN';

export const SPOT_PERP_FUNDING_HARVEST_V1_ASSETS=Object.freeze([
  'OP','INJ','WLD','SEI','TIA','PENDLE','RUNE','ICP'
]);

export const SPOT_PERP_FUNDING_HARVEST_V1_CONFIG=Object.freeze({
  spotNotional:10000,
  perpNotional:10000,
  capitalPerAsset:20000,
  spotTakerFeeBps:10,
  perpTakerFeeBps:5,
  slippageBpsPerFill:3,
  stressExtraBpsPerFill:5,
  fundingThreshold:0.00775,
  minFundingCount:60,
  maxFundingGapHours:12,
  minKlineRows:84,
  maxBoundaryStartHours:8,
  maxBoundaryEndHours:16,
  barHours:8,
  discoveryGate:Object.freeze({
    decisionSlots:88,
    minActiveCycles:32,
    minAssetsWithTwoActiveCycles:6,
    minProfitFactor:1.20,
    maxDrawdownPct:10,
    minPositiveWindows:4,
    minFundingCostRatio:1.25,
    minPositiveAssets:6,
    maxPositiveConcentrationPct:40
  }),
  holdoutGate:Object.freeze({
    decisionSlots:96,
    minActiveCycles:32,
    minAssetsWithTwoActiveCycles:6,
    minProfitFactor:1.10,
    maxDrawdownPct:12.5,
    minPositiveWindows:3,
    minFundingCostRatio:1.15,
    minPositiveAssets:5,
    maxPositiveConcentrationPct:45
  })
});

const HOUR=3600000;
const BAR8=8*HOUR;

const n=x=>Number(x);
const finite=x=>Number.isFinite(n(x));
const sum=a=>a.reduce((s,x)=>s+x,0);

function monthBounds(key){
  const [y,m]=String(key).split('-').map(Number);
  const start=Date.UTC(y,m-1,1);
  const end=m===12?Date.UTC(y+1,0,1):Date.UTC(y,m,1);
  return{start,end};
}

export function previousMonthKey(key){
  const [y,m]=String(key).split('-').map(Number);
  const d=new Date(Date.UTC(y,m-2,1));
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
}

export function normalizeKlines(rows){
  const out=(rows||[]).map(x=>{
    if(Array.isArray(x))return{time:n(x[0]),open:n(x[2]??x[1]),high:n(x[3]??x[2]),low:n(x[4]??x[3]),close:n(x[5]??x[4])};
    return{time:n(x?.time??x?.openTime??x?.t),open:n(x?.open??x?.o),high:n(x?.high??x?.h),low:n(x?.low??x?.l),close:n(x?.close??x?.c)};
  });
  if(out.some(x=>!finite(x.time)||![x.open,x.high,x.low,x.close].every(v=>finite(v)&&v>0)))throw new Error('INVALID_KLINE');
  out.sort((a,b)=>a.time-b.time);
  for(let i=1;i<out.length;i++){
    if(out[i].time===out[i-1].time)throw new Error('DUPLICATE_KLINE_TIMESTAMP');
    if(out[i].time<out[i-1].time)throw new Error('NON_MONOTONIC_KLINE');
  }
  return out;
}

export function normalizeFunding(rows){
  const out=(rows||[]).map(x=>({
    time:n(x?.time??x?.fundingTime??x?.ts??(Array.isArray(x)?x[0]:NaN)),
    rate:n(x?.rate??x?.fundingRate??(Array.isArray(x)?x[1]:NaN))
  }));
  if(out.some(x=>!finite(x.time)||!finite(x.rate)))throw new Error('INVALID_FUNDING');
  out.sort((a,b)=>a.time-b.time);
  for(let i=1;i<out.length;i++){
    if(out[i].time===out[i-1].time)throw new Error('DUPLICATE_FUNDING_TIMESTAMP');
    if(out[i].time<out[i-1].time)throw new Error('NON_MONOTONIC_FUNDING');
  }
  return out;
}

function sliceMonth(rows,key){
  const {start,end}=monthBounds(key);
  return rows.filter(x=>x.time>=start&&x.time<end);
}

function auditKlineMonth(rows,key,cfg){
  const {start,end}=monthBounds(key);
  const xs=sliceMonth(rows,key);
  const reasons=[];
  if(xs.length<cfg.minKlineRows)reasons.push('ROWS_LT_'+cfg.minKlineRows);
  for(let i=1;i<xs.length;i++)if(xs[i].time-xs[i-1].time!==BAR8)reasons.push('NON_8H_CADENCE');
  const first=xs[0]?.time,last=xs.at(-1)?.time;
  if(first==null||first-start>cfg.maxBoundaryStartHours*HOUR)reasons.push('START_BOUNDARY');
  if(last==null||end-last>cfg.maxBoundaryEndHours*HOUR)reasons.push('END_BOUNDARY');
  return{valid:reasons.length===0,reasons,rows:xs,entry:xs[0]||null,exit:xs.at(-1)||null};
}

function auditFundingMonth(rows,key,cfg){
  const {start,end}=monthBounds(key);
  const xs=sliceMonth(rows,key);
  const reasons=[];
  if(xs.length<cfg.minFundingCount)reasons.push('ROWS_LT_'+cfg.minFundingCount);
  const gaps=[];
  if(xs.length){
    gaps.push((xs[0].time-start)/HOUR);
    for(let i=1;i<xs.length;i++)gaps.push((xs[i].time-xs[i-1].time)/HOUR);
    gaps.push((end-xs.at(-1).time)/HOUR);
  }
  const maxGap=gaps.length?Math.max(...gaps):Infinity;
  if(maxGap>cfg.maxFundingGapHours)reasons.push('GAP_GT_'+cfg.maxFundingGapHours+'H');
  return{valid:reasons.length===0,reasons,rows:xs,sumRate:sum(xs.map(x=>x.rate)),maxGapHours:maxGap};
}

export function baseRoundTripCostUsd(config={}){
  const c={...SPOT_PERP_FUNDING_HARVEST_V1_CONFIG,...config};
  const spotFees=c.spotNotional*(2*c.spotTakerFeeBps)/10000;
  const perpFees=c.perpNotional*(2*c.perpTakerFeeBps)/10000;
  const slippage=(c.spotNotional*2+c.perpNotional*2)*c.slippageBpsPerFill/10000;
  return spotFees+perpFees+slippage;
}

export function stressRoundTripCostUsd(config={}){
  const c={...SPOT_PERP_FUNDING_HARVEST_V1_CONFIG,...config};
  const base=baseRoundTripCostUsd(c);
  const stress=(c.spotNotional*2+c.perpNotional*2)*c.stressExtraBpsPerFill/10000;
  return base+stress;
}

function assetMonth(asset,month,data,cfg){
  let spot,perp,funding;
  try{
    spot=normalizeKlines(data?.spot||[]);
    perp=normalizeKlines(data?.perp||[]);
    funding=normalizeFunding(data?.funding||[]);
  }catch(e){
    return{asset,month,valid:false,active:false,reasons:['NORMALIZATION:'+String(e?.message||e)]};
  }

  const prior=previousMonthKey(month);
  const priorFunding=auditFundingMonth(funding,prior,cfg);
  if(!priorFunding.valid){
    return{asset,month,priorMonth:prior,valid:false,active:false,reasons:priorFunding.reasons.map(x=>'SIGNAL_'+x)};
  }

  const signal=priorFunding.sumRate;
  if(signal<cfg.fundingThreshold){
    return{
      asset,month,priorMonth:prior,valid:true,active:false,signalFunding:signal,
      pnl:{fundingUsd:0,basisUsd:0,costsUsd:0,stressCostsUsd:0,netUsd:0,stressNetUsd:0},
      return:0,stressReturn:0,currentFunding:null,signAgreement:null
    };
  }

  const currentFunding=auditFundingMonth(funding,month,cfg);
  const spotMonth=auditKlineMonth(spot,month,cfg);
  const perpMonth=auditKlineMonth(perp,month,cfg);
  const reasons=[];
  if(!currentFunding.valid)reasons.push(...currentFunding.reasons.map(x=>'CURRENT_FUNDING_'+x));
  if(!spotMonth.valid)reasons.push(...spotMonth.reasons.map(x=>'SPOT_'+x));
  if(!perpMonth.valid)reasons.push(...perpMonth.reasons.map(x=>'PERP_'+x));
  if(reasons.length)return{asset,month,priorMonth:prior,valid:false,active:true,signalFunding:signal,reasons};

  const se=spotMonth.entry.close,sx=spotMonth.exit.close;
  const pe=perpMonth.entry.close,px=perpMonth.exit.close;
  const qSpot=cfg.spotNotional/se;
  const qPerp=-cfg.perpNotional/pe;
  const spotPricePnl=qSpot*(sx-se);
  const perpPricePnl=qPerp*(px-pe);
  const basisUsd=spotPricePnl+perpPricePnl;
  const fundingUsd=cfg.perpNotional*currentFunding.sumRate;
  const costsUsd=baseRoundTripCostUsd(cfg);
  const stressCostsUsd=stressRoundTripCostUsd(cfg);
  const netUsd=fundingUsd+basisUsd-costsUsd;
  const stressNetUsd=fundingUsd+basisUsd-stressCostsUsd;

  return{
    asset,month,priorMonth:prior,valid:true,active:true,signalFunding:signal,
    currentFunding:currentFunding.sumRate,
    signAgreement:Math.sign(signal)===Math.sign(currentFunding.sumRate),
    marks:{spotEntry:se,spotExit:sx,perpEntry:pe,perpExit:px},
    pnl:{spotPricePnl,perpPricePnl,basisUsd,fundingUsd,costsUsd,stressCostsUsd,netUsd,stressNetUsd},
    return:netUsd/cfg.capitalPerAsset,
    stressReturn:stressNetUsd/cfg.capitalPerAsset
  };
}

function profitFactor(values){
  const wins=sum(values.filter(x=>x>0)),losses=Math.abs(sum(values.filter(x=>x<0)));
  return losses>0?wins/losses:(wins>0?99:0);
}

function summarizePeriods(periods,key='return'){
  let eq=1,peak=1,dd=0;
  for(const p of periods){
    eq*=1+p[key];
    peak=Math.max(peak,eq);
    dd=Math.max(dd,(peak-eq)/peak);
  }
  return{totalReturnPct:(eq-1)*100,profitFactor:profitFactor(periods.map(x=>x[key])),maxDrawdownPct:dd*100};
}

function windowStats(periods,parts=5){
  const windows=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    let e=1;
    for(const p of periods.slice(a,b))e*=1+p.return;
    windows.push({index:i+1,periods:b-a,returnPct:(e-1)*100});
  }
  return{windows,positiveWindows:windows.filter(x=>x.returnPct>0).length};
}

function evaluateGate(result,gate){
  const reasons=[];
  if(result.decisionSlots!==gate.decisionSlots)reasons.push('DECISION_SLOTS_NE_'+gate.decisionSlots);
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  if(result.activeCycles<gate.minActiveCycles)reasons.push('ACTIVE_CYCLES_LT_'+gate.minActiveCycles);
  const breadth=result.byAsset.filter(x=>x.activeCycles>=2).length;
  if(breadth<gate.minAssetsWithTwoActiveCycles)reasons.push('ACTIVE_ASSET_BREADTH_LT_'+gate.minAssetsWithTwoActiveCycles);
  if(!(result.summary.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(result.summary.totalNetPnl>0))reasons.push('NET_PNL_NOT_POSITIVE');
  if(result.summary.profitFactor<gate.minProfitFactor)reasons.push('PF_LT_'+gate.minProfitFactor);
  if(result.summary.maxDrawdownPct>gate.maxDrawdownPct)reasons.push('DD_GT_'+gate.maxDrawdownPct);
  if(result.positiveWindows<gate.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  if(!(result.stressSummary.totalReturnPct>0))reasons.push('STRESS_RETURN_NOT_POSITIVE');
  if(!(result.summary.totalFundingPnl>result.summary.totalCosts))reasons.push('FUNDING_NOT_ABOVE_COSTS');
  if(!(result.summary.fundingCostRatio>=gate.minFundingCostRatio))reasons.push('FUNDING_COST_RATIO_LT_'+gate.minFundingCostRatio);
  if(result.positiveAssets<gate.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+gate.minPositiveAssets);
  if(result.positiveConcentrationPct>gate.maxPositiveConcentrationPct)reasons.push('POSITIVE_CONCENTRATION_GT_'+gate.maxPositiveConcentrationPct);
  return{pass:reasons.length===0,reasons};
}

export function runSpotPerpFundingHarvestV1(dataset,{tradeMonths,stage='DISCOVERY',config={}}={}){
  const cfg={...SPOT_PERP_FUNDING_HARVEST_V1_CONFIG,...config};
  const assets=[...SPOT_PERP_FUNDING_HARVEST_V1_ASSETS];
  if(!Array.isArray(tradeMonths)||!tradeMonths.length)throw new Error('tradeMonths required');

  const slots=[];
  for(const month of tradeMonths){
    for(const asset of assets)slots.push(assetMonth(asset,month,dataset?.[asset]||{},cfg));
  }

  const invalid=slots.filter(x=>!x.valid);
  const valid=slots.filter(x=>x.valid);
  const active=valid.filter(x=>x.active);
  const noTrade=valid.filter(x=>!x.active);

  const periods=tradeMonths.map(month=>{
    const xs=valid.filter(x=>x.month===month);
    const capital=xs.length*cfg.capitalPerAsset;
    const net=sum(xs.map(x=>x.pnl?.netUsd||0));
    const stress=sum(xs.map(x=>x.pnl?.stressNetUsd||0));
    return{month,decisionSlots:xs.length,activeCycles:xs.filter(x=>x.active).length,netUsd:net,stressNetUsd:stress,return:capital?net/capital:0,stressReturn:capital?stress/capital:0};
  });

  const base=summarizePeriods(periods,'return');
  const stress=summarizePeriods(periods,'stressReturn');
  const ws=windowStats(periods,5);

  const byAsset=assets.map(asset=>{
    const xs=active.filter(x=>x.asset===asset);
    return{
      asset,
      activeCycles:xs.length,
      noTradeCycles:noTrade.filter(x=>x.asset===asset).length,
      netPnl:sum(xs.map(x=>x.pnl.netUsd)),
      stressNetPnl:sum(xs.map(x=>x.pnl.stressNetUsd)),
      fundingPnl:sum(xs.map(x=>x.pnl.fundingUsd)),
      basisPnl:sum(xs.map(x=>x.pnl.basisUsd)),
      costs:sum(xs.map(x=>x.pnl.costsUsd))
    };
  });

  const positive=byAsset.filter(x=>x.netPnl>0);
  const positiveTotal=sum(positive.map(x=>x.netPnl));
  const positiveConcentrationPct=positiveTotal>0?Math.max(...positive.map(x=>x.netPnl))/positiveTotal*100:0;
  const totalFundingPnl=sum(active.map(x=>x.pnl.fundingUsd));
  const totalBasisPnl=sum(active.map(x=>x.pnl.basisUsd));
  const totalCosts=sum(active.map(x=>x.pnl.costsUsd));
  const totalNetPnl=sum(active.map(x=>x.pnl.netUsd));
  const totalStressNetPnl=sum(active.map(x=>x.pnl.stressNetUsd));
  const signComparable=active.filter(x=>x.signAgreement!==null);
  const signAgreementRate=signComparable.length?signComparable.filter(x=>x.signAgreement).length/signComparable.length:null;

  const result={
    ruleset:SPOT_PERP_FUNDING_HARVEST_V1_RULESET,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    stage,assets,tradeMonths:[...tradeMonths],
    decisionSlots:slots.length,
    validDecisionSlots:valid.length,
    rejectedDecisionSlots:invalid.length,
    dataIntegrityFailure:invalid.length>0,
    invalid,
    activeCycles:active.length,
    noTradeCycles:noTrade.length,
    activeRate:valid.length?active.length/valid.length:0,
    byAsset,periods,
    summary:{
      ...base,totalNetPnl,totalFundingPnl,totalBasisPnl,totalCosts,
      fundingCostRatio:totalCosts>0?totalFundingPnl/totalCosts:null
    },
    stressSummary:{...stress,totalStressNetPnl},
    positiveWindows:ws.positiveWindows,
    windows:ws.windows,
    positiveAssets:positive.length,
    positiveConcentrationPct,
    signalDiagnostics:{signAgreementRate}
  };

  const gate=stage==='HOLDOUT'?cfg.holdoutGate:cfg.discoveryGate;
  const verdict=evaluateGate(result,gate);
  const passDecision=stage==='HOLDOUT'?'HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED';
  const failDecision=stage==='HOLDOUT'?'HOLDOUT_FAIL_RESEARCH_REDESIGN':'DISCOVERY_FAIL_RESEARCH_REDESIGN';
  result.gate={...verdict,decision:verdict.pass?passDecision:failDecision};
  result.decision=result.gate.decision;
  return result;
}
