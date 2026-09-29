export const SPOT_PERP_FUNDING_PERSISTENCE_V2_RULESET='SPOT-PERP-FUNDING-PERSISTENCE-V2-FROZEN';

export const SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS=Object.freeze([
  'OP','INJ','WLD','SEI','TIA','PENDLE','RUNE','ICP'
]);

export const SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG=Object.freeze({
  spotNotional:10000,
  perpNotional:10000,
  capitalPerAsset:20000,
  spotTakerFeeBps:10,
  perpTakerFeeBps:5,
  slippageBpsPerFill:3,
  stressExtraBpsPerFill:5,
  entryFundingThreshold:0.00775,
  continuationFundingThreshold:0,
  minFundingCount:60,
  maxFundingGapHours:12,
  minKlineRows:84,
  maxBoundaryStartHours:8,
  maxBoundaryEndHours:16,
  barHours:8,
  gate:Object.freeze({
    stateSlots:96,
    minActiveStateMonths:32,
    minAssetsWithThreeActiveMonths:6,
    minEntryTransitions:6,
    minContinuationMonths:12,
    minAssetsWithContinuation:4,
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

export function baseTransitionCostUsd(config={}){
  const c={...SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG,...config};
  const spotFee=c.spotNotional*c.spotTakerFeeBps/10000;
  const perpFee=c.perpNotional*c.perpTakerFeeBps/10000;
  const slippage=(c.spotNotional+c.perpNotional)*c.slippageBpsPerFill/10000;
  return spotFee+perpFee+slippage;
}

export function stressTransitionCostUsd(config={}){
  const c={...SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG,...config};
  const base=baseTransitionCostUsd(c);
  const stress=(c.spotNotional+c.perpNotional)*c.stressExtraBpsPerFill/10000;
  return base+stress;
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
  if(result.stateSlots!==gate.stateSlots)reasons.push('STATE_SLOTS_NE_'+gate.stateSlots);
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  if(result.activeStateMonths<gate.minActiveStateMonths)reasons.push('ACTIVE_STATE_MONTHS_LT_'+gate.minActiveStateMonths);
  const activeBreadth=result.byAsset.filter(x=>x.activeMonths>=3).length;
  if(activeBreadth<gate.minAssetsWithThreeActiveMonths)reasons.push('ACTIVE_ASSET_BREADTH_LT_'+gate.minAssetsWithThreeActiveMonths);
  if(result.entryTransitions<gate.minEntryTransitions)reasons.push('ENTRY_TRANSITIONS_LT_'+gate.minEntryTransitions);
  if(result.continuationMonths<gate.minContinuationMonths)reasons.push('CONTINUATION_MONTHS_LT_'+gate.minContinuationMonths);
  const continuationBreadth=result.byAsset.filter(x=>x.continuationMonths>=1).length;
  if(continuationBreadth<gate.minAssetsWithContinuation)reasons.push('CONTINUATION_ASSET_BREADTH_LT_'+gate.minAssetsWithContinuation);
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
  return{pass:reasons.length===0,reasons,decision:reasons.length?'VALIDATION_FAIL_RESEARCH_REDESIGN':'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY'};
}

function emptyPnl(){return{fundingUsd:0,basisUsd:0,costsUsd:0,stressCostsUsd:0,netUsd:0,stressNetUsd:0};}

export function runSpotPerpFundingPersistenceV2(dataset,{tradeMonths,config={}}={}){
  const cfg={...SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG,...config,gate:{...SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG.gate,...(config.gate||{})}};
  const assets=[...SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS];
  if(!Array.isArray(tradeMonths)||!tradeMonths.length)throw new Error('tradeMonths required');

  const prepared={};
  for(const asset of assets){
    try{
      prepared[asset]={
        spot:normalizeKlines(dataset?.[asset]?.spot||[]),
        perp:normalizeKlines(dataset?.[asset]?.perp||[]),
        funding:normalizeFunding(dataset?.[asset]?.funding||[])
      };
    }catch(e){
      prepared[asset]={error:'NORMALIZATION:'+String(e?.message||e)};
    }
  }

  const states=Object.fromEntries(assets.map(a=>[a,{
    active:false,qSpot:0,qPerp:0,episodeMonths:0,episodeDurations:[]
  }]));
  const slots=[];

  for(const month of tradeMonths){
    const prior=previousMonthKey(month);
    for(const asset of assets){
      const state=states[asset];
      const d=prepared[asset];
      if(d.error){
        slots.push({asset,month,priorMonth:prior,valid:false,active:false,transition:'ERROR',reasons:[d.error]});
        continue;
      }

      const priorFunding=auditFundingMonth(d.funding,prior,cfg);
      const priorSpot=auditKlineMonth(d.spot,prior,cfg);
      const priorPerp=auditKlineMonth(d.perp,prior,cfg);
      const currentSpot=auditKlineMonth(d.spot,month,cfg);
      const currentPerp=auditKlineMonth(d.perp,month,cfg);
      const reasons=[];
      if(!priorFunding.valid)reasons.push(...priorFunding.reasons.map(x=>'SIGNAL_'+x));
      if(!priorSpot.valid)reasons.push(...priorSpot.reasons.map(x=>'PRIOR_SPOT_'+x));
      if(!priorPerp.valid)reasons.push(...priorPerp.reasons.map(x=>'PRIOR_PERP_'+x));
      if(!currentSpot.valid)reasons.push(...currentSpot.reasons.map(x=>'CURRENT_SPOT_'+x));
      if(!currentPerp.valid)reasons.push(...currentPerp.reasons.map(x=>'CURRENT_PERP_'+x));
      if(reasons.length){
        slots.push({asset,month,priorMonth:prior,valid:false,active:state.active,transition:'ERROR',signalFunding:priorFunding.sumRate,reasons});
        continue;
      }

      const signal=priorFunding.sumRate;
      const startSpot=priorSpot.exit.close,startPerp=priorPerp.exit.close;
      const endSpot=currentSpot.exit.close,endPerp=currentPerp.exit.close;

      let transition='INACTIVE';
      let baseCost=0,stressCost=0;
      let activeThisMonth=false;
      let currentFunding=null;
      let fundingUsd=0,basisUsd=0;

      if(!state.active){
        transition=signal>=cfg.entryFundingThreshold?'ENTRY':'INACTIVE';
      }else{
        transition=signal>cfg.continuationFundingThreshold?'CONTINUE':'EXIT';
      }

      const willBeActive=transition==='ENTRY'||transition==='CONTINUE';
      let currentFundingAudit=null;
      if(willBeActive){
        currentFundingAudit=auditFundingMonth(d.funding,month,cfg);
        if(!currentFundingAudit.valid){
          slots.push({asset,month,priorMonth:prior,valid:false,active:state.active,transition,signalFunding:signal,reasons:currentFundingAudit.reasons.map(x=>'CURRENT_FUNDING_'+x)});
          continue;
        }
      }

      if(transition==='ENTRY'){
        state.active=true;
        state.qSpot=cfg.spotNotional/startSpot;
        state.qPerp=-cfg.perpNotional/startPerp;
        state.episodeMonths=0;
        baseCost=baseTransitionCostUsd(cfg);
        stressCost=stressTransitionCostUsd(cfg);
      }else if(transition==='EXIT'){
        state.active=false;
        baseCost=baseTransitionCostUsd(cfg);
        stressCost=stressTransitionCostUsd(cfg);
        if(state.episodeMonths>0)state.episodeDurations.push(state.episodeMonths);
        state.episodeMonths=0;
        state.qSpot=0;
        state.qPerp=0;
      }

      if(state.active){
        activeThisMonth=true;
        currentFunding=currentFundingAudit.sumRate;
        const spotPricePnl=state.qSpot*(endSpot-startSpot);
        const perpPricePnl=state.qPerp*(endPerp-startPerp);
        basisUsd=spotPricePnl+perpPricePnl;
        fundingUsd=cfg.perpNotional*currentFunding;
        state.episodeMonths+=1;
      }

      const netUsd=fundingUsd+basisUsd-baseCost;
      const stressNetUsd=fundingUsd+basisUsd-stressCost;
      slots.push({
        asset,month,priorMonth:prior,valid:true,active:activeThisMonth,transition,
        signalFunding:signal,currentFunding,
        marks:{startSpot,startPerp,endSpot,endPerp},
        pnl:{fundingUsd,basisUsd,costsUsd:baseCost,stressCostsUsd:stressCost,netUsd,stressNetUsd},
        return:netUsd/cfg.capitalPerAsset,
        stressReturn:stressNetUsd/cfg.capitalPerAsset
      });
    }
  }

  let forcedTerminalExits=0;
  const lastMonth=tradeMonths.at(-1);
  for(const asset of assets){
    const state=states[asset];
    if(!state.active)continue;
    forcedTerminalExits++;
    const base=baseTransitionCostUsd(cfg),stress=stressTransitionCostUsd(cfg);
    const slot=slots.findLast(x=>x.asset===asset&&x.month===lastMonth&&x.valid);
    if(slot){
      slot.pnl.costsUsd+=base;
      slot.pnl.stressCostsUsd+=stress;
      slot.pnl.netUsd-=base;
      slot.pnl.stressNetUsd-=stress;
      slot.return=slot.pnl.netUsd/cfg.capitalPerAsset;
      slot.stressReturn=slot.pnl.stressNetUsd/cfg.capitalPerAsset;
      slot.forcedTerminalExit=true;
    }
    if(state.episodeMonths>0)state.episodeDurations.push(state.episodeMonths);
    state.active=false;state.qSpot=0;state.qPerp=0;state.episodeMonths=0;
  }

  const invalid=slots.filter(x=>!x.valid);
  const valid=slots.filter(x=>x.valid);
  const active=valid.filter(x=>x.active);
  const periods=tradeMonths.map(month=>{
    const xs=valid.filter(x=>x.month===month);
    const capital=xs.length*cfg.capitalPerAsset;
    const net=sum(xs.map(x=>x.pnl?.netUsd||0));
    const stress=sum(xs.map(x=>x.pnl?.stressNetUsd||0));
    return{month,stateSlots:xs.length,activeStateMonths:xs.filter(x=>x.active).length,netUsd:net,stressNetUsd:stress,return:capital?net/capital:0,stressReturn:capital?stress/capital:0};
  });

  const base=summarizePeriods(periods,'return');
  const stress=summarizePeriods(periods,'stressReturn');
  const ws=windowStats(periods,5);

  const byAsset=assets.map(asset=>{
    const xs=valid.filter(x=>x.asset===asset);
    const exposure=xs.filter(x=>x.active);
    return{
      asset,
      activeMonths:exposure.length,
      inactiveMonths:xs.length-exposure.length,
      entryTransitions:xs.filter(x=>x.transition==='ENTRY').length,
      exitTransitions:xs.filter(x=>x.transition==='EXIT').length,
      continuationMonths:xs.filter(x=>x.transition==='CONTINUE').length,
      forcedTerminalExits:xs.filter(x=>x.forcedTerminalExit).length,
      netPnl:sum(xs.map(x=>x.pnl?.netUsd||0)),
      stressNetPnl:sum(xs.map(x=>x.pnl?.stressNetUsd||0)),
      fundingPnl:sum(xs.map(x=>x.pnl?.fundingUsd||0)),
      basisPnl:sum(xs.map(x=>x.pnl?.basisUsd||0)),
      costs:sum(xs.map(x=>x.pnl?.costsUsd||0)),
      episodeDurations:[...states[asset].episodeDurations]
    };
  });

  const positive=byAsset.filter(x=>x.netPnl>0);
  const positiveTotal=sum(positive.map(x=>x.netPnl));
  const positiveConcentrationPct=positiveTotal>0?Math.max(...positive.map(x=>x.netPnl))/positiveTotal*100:0;
  const totalFundingPnl=sum(valid.map(x=>x.pnl?.fundingUsd||0));
  const totalBasisPnl=sum(valid.map(x=>x.pnl?.basisUsd||0));
  const totalCosts=sum(valid.map(x=>x.pnl?.costsUsd||0));
  const totalNetPnl=sum(valid.map(x=>x.pnl?.netUsd||0));
  const totalStressNetPnl=sum(valid.map(x=>x.pnl?.stressNetUsd||0));
  const durations=byAsset.flatMap(x=>x.episodeDurations);

  const result={
    ruleset:SPOT_PERP_FUNDING_PERSISTENCE_V2_RULESET,
    researchOnly:true,executionImpact:false,autoPromotion:false,
    stage:'INDEPENDENT_VALIDATION',
    assets,tradeMonths:[...tradeMonths],
    stateSlots:slots.length,
    validStateSlots:valid.length,
    rejectedStateSlots:invalid.length,
    dataIntegrityFailure:invalid.length>0,
    invalid,
    activeStateMonths:active.length,
    inactiveStateMonths:valid.length-active.length,
    entryTransitions:valid.filter(x=>x.transition==='ENTRY').length,
    exitTransitions:valid.filter(x=>x.transition==='EXIT').length,
    continuationMonths:valid.filter(x=>x.transition==='CONTINUE').length,
    forcedTerminalExits,
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
    persistenceDiagnostics:{
      assetsWithContinuation:byAsset.filter(x=>x.continuationMonths>=1).length,
      meanEpisodeDurationMonths:durations.length?sum(durations)/durations.length:0,
      maxEpisodeDurationMonths:durations.length?Math.max(...durations):0
    }
  };

  result.gate=evaluateGate(result,cfg.gate);
  result.decision=result.gate.decision;
  return result;
}
