export const SPOT_PERP_BASIS_DISLOCATION_V1_RULESET='SPOT-PERP-BASIS-DISLOCATION-V1-FROZEN';

export const SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS=Object.freeze([
  'APT','APE','CRV','SUSHI','DYDX','LDO','GALA','IMX'
]);

export const SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG=Object.freeze({
  spotNotional:10000,
  perpNotional:10000,
  fixedPortfolioCapital:160000,
  spotTakerFeeBps:10,
  perpTakerFeeBps:5,
  slippageBpsPerFill:3,
  stressExtraBpsPerFill:5,
  historyBars:270,
  historyPercentile:0.95,
  signalBasisFloor:0.00775,
  executionBasisFloor:0.0062,
  fundingConfirmMs:7*24*60*60*1000,
  holdMs:24*60*60*1000,
  maxFundingGapHours:12,
  barMs:8*60*60*1000,
  discoveryStart:Date.UTC(2024,8,1),
  discoveryEnd:Date.UTC(2025,8,1),
  holdoutStart:Date.UTC(2025,8,1),
  holdoutEnd:Date.UTC(2026,8,1),
  discoveryGate:Object.freeze({
    minTrades:32,
    minAssetsWithThreeTrades:6,
    minActiveMonths:8,
    minProfitFactor:1.20,
    maxClosedDrawdownPct:5,
    maxMtmDrawdownPct:7.5,
    minPositiveWindows:4,
    minGrossEdgeCostRatio:1.25,
    minPositiveAssets:6,
    maxPositiveConcentrationPct:40
  }),
  holdoutGate:Object.freeze({
    minTrades:32,
    minAssetsWithThreeTrades:6,
    minActiveMonths:8,
    minProfitFactor:1.10,
    maxClosedDrawdownPct:7.5,
    maxMtmDrawdownPct:10,
    minPositiveWindows:3,
    minGrossEdgeCostRatio:1.15,
    minPositiveAssets:5,
    maxPositiveConcentrationPct:45
  })
});

const HOUR=3600000;
const n=x=>Number(x);
const finite=x=>Number.isFinite(n(x));
const sum=a=>a.reduce((s,x)=>s+x,0);
const mean=a=>a.length?sum(a)/a.length:null;
const median=a=>{
  if(!a.length)return null;
  const x=[...a].sort((a,b)=>a-b),m=Math.floor(x.length/2);
  return x.length%2?x[m]:(x[m-1]+x[m])/2;
};

function monthKey(ts){
  const d=new Date(ts);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
}

export function normalizeBasisKlines(rows){
  const out=(rows||[]).map(x=>{
    if(Array.isArray(x))return{
      time:n(x[0]),
      open:n(x[2]??x[1]),
      high:n(x[3]??x[2]),
      low:n(x[4]??x[3]),
      close:n(x[5]??x[4])
    };
    return{
      time:n(x?.time??x?.openTime??x?.t),
      open:n(x?.open??x?.o),
      high:n(x?.high??x?.h),
      low:n(x?.low??x?.l),
      close:n(x?.close??x?.c)
    };
  });
  if(out.some(x=>!finite(x.time)||![x.open,x.high,x.low,x.close].every(v=>finite(v)&&v>0)))throw new Error('INVALID_KLINE');
  out.sort((a,b)=>a.time-b.time);
  for(let i=1;i<out.length;i++){
    if(out[i].time===out[i-1].time)throw new Error('DUPLICATE_KLINE_TIMESTAMP');
    if(out[i].time<out[i-1].time)throw new Error('NON_MONOTONIC_KLINE');
  }
  return out;
}

export function normalizeBasisFunding(rows){
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

export function basisBaseRoundTripCostUsd(config={}){
  const c={...SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG,...config};
  const spotFees=c.spotNotional*2*c.spotTakerFeeBps/10000;
  const perpFees=c.perpNotional*2*c.perpTakerFeeBps/10000;
  const slip=(c.spotNotional*2+c.perpNotional*2)*c.slippageBpsPerFill/10000;
  return spotFees+perpFees+slip;
}

export function basisStressRoundTripCostUsd(config={}){
  const c={...SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG,...config};
  return basisBaseRoundTripCostUsd(c)+(c.spotNotional*2+c.perpNotional*2)*c.stressExtraBpsPerFill/10000;
}

export function nearestRankPercentile(values,p){
  if(!values.length)throw new Error('EMPTY_PERCENTILE');
  if(!(p>0&&p<=1))throw new Error('INVALID_PERCENTILE');
  const xs=[...values].sort((a,b)=>a-b);
  const idx=Math.ceil(p*xs.length)-1;
  return xs[Math.max(0,Math.min(xs.length-1,idx))];
}

function validateSynchronized(spot,perp,cfg){
  const reasons=[];
  if(spot.length!==perp.length)reasons.push('ROW_COUNT_MISMATCH');
  const len=Math.min(spot.length,perp.length);
  for(let i=0;i<len;i++){
    if(spot[i].time!==perp[i].time){reasons.push('TIMESTAMP_MISMATCH');break}
    if(i>0&&spot[i].time-spot[i-1].time!==cfg.barMs){reasons.push('SPOT_NON_8H_CADENCE');break}
    if(i>0&&perp[i].time-perp[i-1].time!==cfg.barMs){reasons.push('PERP_NON_8H_CADENCE');break}
  }
  return reasons;
}

function fundingWindow(funding,start,end,maxGapHours){
  const xs=funding.filter(x=>x.time>start&&x.time<end);
  if(!xs.length)return{valid:false,reasons:['NO_FUNDING_ROWS'],rows:xs,sumRate:0,maxGapHours:Infinity};
  const gaps=[(xs[0].time-start)/HOUR];
  for(let i=1;i<xs.length;i++)gaps.push((xs[i].time-xs[i-1].time)/HOUR);
  gaps.push((end-xs.at(-1).time)/HOUR);
  const maxGap=Math.max(...gaps);
  const reasons=[];
  if(maxGap>maxGapHours)reasons.push('FUNDING_GAP_GT_'+maxGapHours+'H');
  return{valid:reasons.length===0,reasons,rows:xs,sumRate:sum(xs.map(x=>x.rate)),maxGapHours:maxGap};
}

function fundingConfirmWindow(funding,start,end,maxGapHours){
  const xs=funding.filter(x=>x.time>=start&&x.time<end);
  if(!xs.length)return{valid:false,reasons:['NO_FUNDING_ROWS'],rows:xs,sumRate:0,maxGapHours:Infinity};
  const gaps=[(xs[0].time-start)/HOUR];
  for(let i=1;i<xs.length;i++)gaps.push((xs[i].time-xs[i-1].time)/HOUR);
  gaps.push((end-xs.at(-1).time)/HOUR);
  const maxGap=Math.max(...gaps);
  const reasons=[];
  if(maxGap>maxGapHours)reasons.push('FUNDING_GAP_GT_'+maxGapHours+'H');
  return{valid:reasons.length===0,reasons,rows:xs,sumRate:sum(xs.map(x=>x.rate)),maxGapHours:maxGap};
}

function summarizeMonthly(months){
  let equity=1,peak=1,dd=0;
  for(const m of months){
    equity*=1+m.return;
    peak=Math.max(peak,equity);
    if(peak>0)dd=Math.max(dd,(peak-equity)/peak);
  }
  return{totalReturnPct:(equity-1)*100,maxDrawdownPct:dd*100};
}

function profitFactor(values){
  const wins=sum(values.filter(x=>x>0));
  const losses=Math.abs(sum(values.filter(x=>x<0)));
  return losses>0?wins/losses:(wins>0?99:0);
}

function windowStats(months,parts=5){
  const out=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(months.length*i/parts),b=Math.floor(months.length*(i+1)/parts);
    let e=1;
    for(const x of months.slice(a,b))e*=1+x.return;
    out.push({index:i+1,months:b-a,returnPct:(e-1)*100});
  }
  return{windows:out,positiveWindows:out.filter(x=>x.returnPct>0).length};
}

function maxMtmDrawdown(trades,seriesByAsset,cfg,start,end){
  if(!trades.length)return 0;
  const times=[];
  for(let t=start;t<end;t+=cfg.barMs)times.push(t);
  let peak=cfg.fixedPortfolioCapital,equity=cfg.fixedPortfolioCapital,maxDD=0;
  for(const t of times){
    let realizedPnl=0,openPnl=0;
    for(const tr of trades){
      if(tr.exitTime<=t){
        realizedPnl+=tr.pnl.netUsd;
        continue;
      }
      if(tr.entryTime>=t)continue;
      const s=seriesByAsset[tr.asset];
      const idx=s.index.get(t-cfg.barMs);
      if(idx==null)continue;
      const spotClose=s.spot[idx].close,perpClose=s.perp[idx].close;
      const spotMtm=tr.qSpot*(spotClose-tr.spotEntry);
      const perpMtm=tr.qPerp*(perpClose-tr.perpEntry);
      const fw=fundingWindow(s.funding,tr.entryTime,t,cfg.maxFundingGapHours);
      const fund=fw.rows.length?cfg.perpNotional*fw.sumRate:0;
      openPnl+=spotMtm+perpMtm+fund-tr.pnl.costsUsd;
    }
    equity=cfg.fixedPortfolioCapital+realizedPnl+openPnl;
    peak=Math.max(peak,equity);
    if(peak>0)maxDD=Math.max(maxDD,(peak-equity)/peak*100);
  }
  return maxDD;
}

function evaluateGate(result,gate){
  const reasons=[];
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  if(result.completedTrades<gate.minTrades)reasons.push('TRADES_LT_'+gate.minTrades);
  const breadth=result.byAsset.filter(x=>x.completedTrades>=3).length;
  if(breadth<gate.minAssetsWithThreeTrades)reasons.push('ASSETS_WITH_3_TRADES_LT_'+gate.minAssetsWithThreeTrades);
  if(result.activeMonths<gate.minActiveMonths)reasons.push('ACTIVE_MONTHS_LT_'+gate.minActiveMonths);
  if(!(result.summary.totalReturnPct>0))reasons.push('RETURN_NOT_POSITIVE');
  if(!(result.summary.totalNetPnl>0))reasons.push('NET_PNL_NOT_POSITIVE');
  if(result.summary.profitFactor<gate.minProfitFactor)reasons.push('PF_LT_'+gate.minProfitFactor);
  if(result.summary.maxDrawdownPct>gate.maxClosedDrawdownPct)reasons.push('CLOSED_DD_GT_'+gate.maxClosedDrawdownPct);
  if(result.mtmMaxDrawdownPct>gate.maxMtmDrawdownPct)reasons.push('MTM_DD_GT_'+gate.maxMtmDrawdownPct);
  if(result.positiveWindows<gate.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_'+gate.minPositiveWindows);
  if(!(result.summary.totalBasisPnl>0))reasons.push('BASIS_PNL_NOT_POSITIVE');
  if(!(result.summary.totalFundingPnl>0))reasons.push('FUNDING_PNL_NOT_POSITIVE');
  if(!(result.stressSummary.totalReturnPct>0))reasons.push('STRESS_RETURN_NOT_POSITIVE');
  if(!(result.summary.grossEdgeCostRatio>=gate.minGrossEdgeCostRatio))reasons.push('GROSS_EDGE_COST_RATIO_LT_'+gate.minGrossEdgeCostRatio);
  if(result.positiveAssets<gate.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_'+gate.minPositiveAssets);
  if(result.positiveConcentrationPct>gate.maxPositiveConcentrationPct)reasons.push('POSITIVE_CONCENTRATION_GT_'+gate.maxPositiveConcentrationPct);
  return{pass:reasons.length===0,reasons};
}

export function runSpotPerpBasisDislocationV1(dataset,{stage='DISCOVERY',config={}}={}){
  const cfg={...SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG,...config};
  const assets=[...SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS];
  const start=stage==='HOLDOUT'?cfg.holdoutStart:cfg.discoveryStart;
  const end=stage==='HOLDOUT'?cfg.holdoutEnd:cfg.discoveryEnd;
  const dataIntegrityErrors=[];
  const seriesByAsset={};
  const trades=[];
  let eligibleSignalEvaluations=0,percentileQualifiedSignals=0,cancelledByExecutionBasis=0;
  const signalBasisValues=[],entryBasisValues=[],basisCompressions=[];

  for(const asset of assets){
    let spot,perp,funding;
    try{
      spot=normalizeBasisKlines(dataset?.[asset]?.spot||[]);
      perp=normalizeBasisKlines(dataset?.[asset]?.perp||[]);
      funding=normalizeBasisFunding(dataset?.[asset]?.funding||[]);
    }catch(e){
      dataIntegrityErrors.push({asset,reason:'NORMALIZATION:'+String(e?.message||e)});
      continue;
    }
    const syncReasons=validateSynchronized(spot,perp,cfg);
    if(syncReasons.length){
      dataIntegrityErrors.push({asset,reason:syncReasons.join('|')});
      continue;
    }
    const index=new Map(spot.map((x,i)=>[x.time,i]));
    seriesByAsset[asset]={spot,perp,funding,index};
    let openUntil=-Infinity;

    for(let i=cfg.historyBars;i<spot.length-4;i++){
      const signal=spot[i],signalPerp=perp[i];
      const entryIdx=i+1;
      const entryTime=spot[entryIdx].time;
      const exitTime=entryTime+cfg.holdMs;
      if(entryTime<start||entryTime>=end||exitTime>=end)continue;
      if(signal.time<openUntil)continue;

      const expectedEntry=signal.time+cfg.barMs;
      if(entryTime!==expectedEntry){
        dataIntegrityErrors.push({asset,time:signal.time,reason:'MISSING_NEXT_8H_ENTRY'});
        continue;
      }
      const exitIdx=index.get(exitTime);
      if(exitIdx==null){
        dataIntegrityErrors.push({asset,time:entryTime,reason:'MISSING_EXACT_24H_EXIT'});
        continue;
      }

      const history=[];
      for(let h=i-cfg.historyBars;h<i;h++){
        const b=perp[h].close/spot[h].close-1;
        if(!finite(b)){history.length=0;break}
        history.push(b);
      }
      if(history.length!==cfg.historyBars)continue;
      eligibleSignalEvaluations++;

      const signalBasis=signalPerp.close/signal.close-1;
      const p95=nearestRankPercentile(history,cfg.historyPercentile);
      if(!(signalBasis>0&&signalBasis>=p95&&signalBasis>=cfg.signalBasisFloor))continue;
      percentileQualifiedSignals++;

      const entryBasis=perp[entryIdx].open/spot[entryIdx].open-1;
      if(entryBasis<cfg.executionBasisFloor){
        cancelledByExecutionBasis++;
        continue;
      }

      const confirm=fundingConfirmWindow(funding,entryTime-cfg.fundingConfirmMs,entryTime,cfg.maxFundingGapHours);
      if(!confirm.valid){
        dataIntegrityErrors.push({asset,time:entryTime,reason:'CONFIRM_'+confirm.reasons.join('|')});
        continue;
      }
      if(!(confirm.sumRate>0))continue;

      const holdFunding=fundingWindow(funding,entryTime,exitTime,cfg.maxFundingGapHours);
      if(!holdFunding.valid){
        dataIntegrityErrors.push({asset,time:entryTime,reason:'HOLD_'+holdFunding.reasons.join('|')});
        continue;
      }

      const se=spot[entryIdx].open,pe=perp[entryIdx].open;
      const sx=spot[exitIdx].open,px=perp[exitIdx].open;
      const qSpot=cfg.spotNotional/se,qPerp=-cfg.perpNotional/pe;
      const spotPricePnl=qSpot*(sx-se);
      const perpPricePnl=qPerp*(px-pe);
      const basisPnl=spotPricePnl+perpPricePnl;
      const fundingPnl=cfg.perpNotional*holdFunding.sumRate;
      const costsUsd=basisBaseRoundTripCostUsd(cfg);
      const stressCostsUsd=basisStressRoundTripCostUsd(cfg);
      const netUsd=basisPnl+fundingPnl-costsUsd;
      const stressNetUsd=basisPnl+fundingPnl-stressCostsUsd;
      const exitBasis=px/sx-1;
      const trade={
        asset,signalTime:signal.time,entryTime,exitTime,
        signalBasis,p95,entryBasis,exitBasis,
        basisCompression:entryBasis-exitBasis,
        fundingConfirm:confirm.sumRate,
        qSpot,qPerp,spotEntry:se,perpEntry:pe,spotExit:sx,perpExit:px,
        pnl:{spotPricePnl,perpPricePnl,basisUsd:basisPnl,fundingUsd:fundingPnl,costsUsd,stressCostsUsd,netUsd,stressNetUsd}
      };
      trades.push(trade);
      signalBasisValues.push(signalBasis);
      entryBasisValues.push(entryBasis);
      basisCompressions.push(trade.basisCompression);
      openUntil=exitTime;
    }
  }

  const months=[];
  for(let t=Date.UTC(new Date(start).getUTCFullYear(),new Date(start).getUTCMonth(),1);t<end;){
    const key=monthKey(t);
    const xs=trades.filter(x=>monthKey(x.exitTime)===key);
    const net=sum(xs.map(x=>x.pnl.netUsd));
    const stress=sum(xs.map(x=>x.pnl.stressNetUsd));
    months.push({month:key,trades:xs.length,netUsd:net,stressNetUsd:stress,return:net/cfg.fixedPortfolioCapital,stressReturn:stress/cfg.fixedPortfolioCapital});
    const d=new Date(t);t=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
  }

  const closed=summarizeMonthly(months);
  closed.profitFactor=profitFactor(trades.map(x=>x.pnl.netUsd));
  const stressClosed=summarizeMonthly(months.map(x=>({...x,return:x.stressReturn})));
  const ws=windowStats(months,5);

  const byAsset=assets.map(asset=>{
    const xs=trades.filter(x=>x.asset===asset);
    return{
      asset,completedTrades:xs.length,
      netPnl:sum(xs.map(x=>x.pnl.netUsd)),
      stressNetPnl:sum(xs.map(x=>x.pnl.stressNetUsd)),
      basisPnl:sum(xs.map(x=>x.pnl.basisUsd)),
      fundingPnl:sum(xs.map(x=>x.pnl.fundingUsd)),
      costs:sum(xs.map(x=>x.pnl.costsUsd))
    };
  });
  const positive=byAsset.filter(x=>x.netPnl>0);
  const positiveTotal=sum(positive.map(x=>x.netPnl));
  const positiveConcentrationPct=positiveTotal>0?Math.max(...positive.map(x=>x.netPnl))/positiveTotal*100:0;
  const totalBasisPnl=sum(trades.map(x=>x.pnl.basisUsd));
  const totalFundingPnl=sum(trades.map(x=>x.pnl.fundingUsd));
  const totalCosts=sum(trades.map(x=>x.pnl.costsUsd));
  const totalNetPnl=sum(trades.map(x=>x.pnl.netUsd));
  const totalStressNetPnl=sum(trades.map(x=>x.pnl.stressNetUsd));
  const activeMonths=months.filter(x=>x.trades>0).length;
  const mtmMaxDrawdownPct=maxMtmDrawdown(trades,seriesByAsset,cfg,start,end);

  const result={
    ruleset:SPOT_PERP_BASIS_DISLOCATION_V1_RULESET,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    stage,start,end,assets,
    dataIntegrityFailure:dataIntegrityErrors.length>0,
    dataIntegrityErrors,
    eligibleSignalEvaluations,
    percentileQualifiedSignals,
    cancelledByExecutionBasis,
    completedTrades:trades.length,
    activeMonths,
    trades,
    months,
    byAsset,
    summary:{
      ...closed,
      totalNetPnl,totalBasisPnl,totalFundingPnl,totalCosts,
      grossEdgeCostRatio:totalCosts>0?(totalBasisPnl+totalFundingPnl)/totalCosts:null,
      winRate:trades.length?trades.filter(x=>x.pnl.netUsd>0).length/trades.length:0
    },
    stressSummary:{...stressClosed,totalStressNetPnl},
    mtmMaxDrawdownPct,
    positiveWindows:ws.positiveWindows,
    windows:ws.windows,
    positiveAssets:positive.length,
    positiveConcentrationPct,
    diagnostics:{
      meanSignalBasis:mean(signalBasisValues),
      medianSignalBasis:median(signalBasisValues),
      meanEntryBasis:mean(entryBasisValues),
      medianEntryBasis:median(entryBasisValues),
      meanBasisCompression:mean(basisCompressions),
      medianBasisCompression:median(basisCompressions),
      compressionRate:trades.length?trades.filter(x=>x.basisCompression>0).length/trades.length:0
    }
  };
  const gate=stage==='HOLDOUT'?cfg.holdoutGate:cfg.discoveryGate;
  const verdict=evaluateGate(result,gate);
  const passDecision=stage==='HOLDOUT'?'HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED';
  const failDecision=stage==='HOLDOUT'?'HOLDOUT_FAIL_RESEARCH_REDESIGN':'DISCOVERY_FAIL_RESEARCH_REDESIGN';
  result.gate={...verdict,decision:verdict.pass?passDecision:failDecision};
  result.decision=result.gate.decision;
  return result;
}
