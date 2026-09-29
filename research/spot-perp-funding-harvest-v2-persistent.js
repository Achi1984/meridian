import {
  SPOT_PERP_FUNDING_HARVEST_V1_ASSETS,
  SPOT_PERP_FUNDING_HARVEST_V1_CONFIG,
  normalizeKlines,
  normalizeFunding
} from './spot-perp-funding-harvest-v1.js';

export const SPOT_PERP_FUNDING_HARVEST_V2_RULESET='SPOT-PERP-FUNDING-HARVEST-V2-PERSISTENT-FROZEN';
export const SPOT_PERP_FUNDING_HARVEST_V2_ASSETS=SPOT_PERP_FUNDING_HARVEST_V1_ASSETS;

export const SPOT_PERP_FUNDING_HARVEST_V2_CONFIG=Object.freeze({
  ...SPOT_PERP_FUNDING_HARVEST_V1_CONFIG,
  entryThreshold:0.00775,
  holdThresholdExclusive:0,
  monthlyPortfolioCapital:160000,
  developmentGate:Object.freeze({
    decisionSlots:88,
    minExposureMonths:32,
    minEntryEvents:8,
    minAssetsWithThreeExposureMonths:6,
    minProfitFactor:1.20,
    maxDrawdownPct:10,
    minPositiveWindows:4,
    minFundingCostRatio:1.25,
    minPositiveAssets:6,
    maxPositiveConcentrationPct:40
  }),
  validationGate:Object.freeze({
    decisionSlots:96,
    minExposureMonths:32,
    minEntryEvents:8,
    minAssetsWithThreeExposureMonths:6,
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

function sliceMonth(rows,key){
  const {start,end}=monthBounds(key);
  return rows.filter(x=>x.time>=start&&x.time<end);
}

function auditKlines(rows,key,cfg){
  const {start,end}=monthBounds(key);
  const xs=sliceMonth(rows,key);
  const reasons=[];
  if(xs.length<cfg.minKlineRows)reasons.push('ROWS_LT_'+cfg.minKlineRows);
  for(let i=1;i<xs.length;i++)if(xs[i].time-xs[i-1].time!==BAR8)reasons.push('NON_8H_CADENCE');
  const first=xs[0],last=xs.at(-1);
  if(!first||first.time-start>cfg.maxBoundaryStartHours*HOUR)reasons.push('START_BOUNDARY');
  if(!last||end-last.time>cfg.maxBoundaryEndHours*HOUR)reasons.push('END_BOUNDARY');
  return{
    valid:reasons.length===0,reasons,rows:xs,
    firstOpen:first?.open,lastClose:last?.close,
    firstTime:first?.time,lastTime:last?.time
  };
}

function auditFunding(rows,key,cfg){
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
  return{valid:reasons.length===0,reasons,rows:xs,sumRate:sum(xs.map(x=>x.rate)),maxGapHours:maxGap,start,end};
}

function legCost(notional,feeBps,slippageBps,stressExtra=0){
  return notional*(feeBps+slippageBps+stressExtra)/10000;
}

export function entryCostUsd(config={},stress=false){
  const c={...SPOT_PERP_FUNDING_HARVEST_V2_CONFIG,...config};
  const extra=stress?c.stressExtraBpsPerFill:0;
  return legCost(c.spotNotional,c.spotTakerFeeBps,c.slippageBpsPerFill,extra)
    +legCost(c.perpNotional,c.perpTakerFeeBps,c.slippageBpsPerFill,extra);
}

export function exitCostUsd({spotNotional,perpNotional},config={},stress=false){
  const c={...SPOT_PERP_FUNDING_HARVEST_V2_CONFIG,...config};
  const extra=stress?c.stressExtraBpsPerFill:0;
  return legCost(spotNotional,c.spotTakerFeeBps,c.slippageBpsPerFill,extra)
    +legCost(perpNotional,c.perpTakerFeeBps,c.slippageBpsPerFill,extra);
}

function profitFactor(values){
  const wins=sum(values.filter(x=>x>0)),loss=Math.abs(sum(values.filter(x=>x<0)));
  return loss>0?wins/loss:(wins>0?99:0);
}

function summarize(periods,key='return'){
  let eq=1,peak=1,dd=0;
  for(const p of periods){
    eq*=1+p[key]; peak=Math.max(peak,eq); dd=Math.max(dd,(peak-eq)/peak);
  }
  return{totalReturnPct:(eq-1)*100,profitFactor:profitFactor(periods.map(x=>x[key])),maxDrawdownPct:dd*100};
}

function windows(periods,parts=5){
  const xs=[];
  for(let i=0;i<parts;i++){
    const a=Math.floor(periods.length*i/parts),b=Math.floor(periods.length*(i+1)/parts);
    let e=1;
    for(const p of periods.slice(a,b))e*=1+p.return;
    xs.push({index:i+1,periods:b-a,returnPct:(e-1)*100});
  }
  return{windows:xs,positiveWindows:xs.filter(x=>x.returnPct>0).length};
}

function gateResult(result,gate,stage){
  const reasons=[];
  if(result.decisionSlots!==gate.decisionSlots)reasons.push('DECISION_SLOTS_NE_'+gate.decisionSlots);
  if(result.dataIntegrityFailure)reasons.push('DATA_INTEGRITY_FAILURE');
  if(result.exposureMonths<gate.minExposureMonths)reasons.push('EXPOSURE_MONTHS_LT_'+gate.minExposureMonths);
  if(result.entryEvents<gate.minEntryEvents)reasons.push('ENTRY_EVENTS_LT_'+gate.minEntryEvents);
  const breadth=result.byAsset.filter(x=>x.exposureMonths>=3).length;
  if(breadth<gate.minAssetsWithThreeExposureMonths)reasons.push('EXPOSURE_ASSET_BREADTH_LT_'+gate.minAssetsWithThreeExposureMonths);
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
  const pass=!reasons.length;
  const decision=stage==='VALIDATION'
    ?(pass?'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'VALIDATION_FAIL_RESEARCH_REDESIGN')
    :(pass?'DEVELOPMENT_PASS_INDEPENDENT_VALIDATION_REQUIRED':'DEVELOPMENT_FAIL_RESEARCH_REDESIGN');
  return{pass,reasons,decision};
}

export function runSpotPerpFundingHarvestV2(dataset,{tradeMonths,stage='DEVELOPMENT',config={}}={}){
  const cfg={...SPOT_PERP_FUNDING_HARVEST_V2_CONFIG,...config};
  const assets=[...SPOT_PERP_FUNDING_HARVEST_V2_ASSETS];
  if(!Array.isArray(tradeMonths)||!tradeMonths.length)throw new Error('tradeMonths required');

  const normalized={};
  const prepErrors=[];
  for(const asset of assets){
    try{
      normalized[asset]={
        spot:normalizeKlines(dataset?.[asset]?.spot||[]),
        perp:normalizeKlines(dataset?.[asset]?.perp||[]),
        funding:normalizeFunding(dataset?.[asset]?.funding||[])
      };
    }catch(e){prepErrors.push({asset,reason:'NORMALIZATION:'+String(e?.message||e)});}
  }

  const states=Object.fromEntries(assets.map(a=>[a,{position:null,broken:prepErrors.some(x=>x.asset===a)}]));
  const slots=[];
  const ledger=Object.fromEntries(assets.map(a=>[a,{
    asset:a,exposureMonths:0,entryEvents:0,exitEvents:0,persistentHoldMonths:0,
    netPnl:0,stressNetPnl:0,fundingPnl:0,basisPnl:0,costs:0
  }]));

  for(const month of tradeMonths){
    for(const asset of assets){
      const state=states[asset], L=ledger[asset];
      if(state.broken){
        slots.push({asset,month,valid:false,exposure:false,transition:'BROKEN',reasons:['STATE_UNCERTAIN_AFTER_DATA_FAILURE']});
        continue;
      }
      const d=normalized[asset];
      const priorKey=previousMonthKey(month);
      const priorFunding=auditFunding(d.funding,priorKey,cfg);
      const spotMonth=auditKlines(d.spot,month,cfg);
      const perpMonth=auditKlines(d.perp,month,cfg);
      const reasons=[];
      if(!priorFunding.valid)reasons.push(...priorFunding.reasons.map(x=>'SIGNAL_'+x));
      if(!spotMonth.valid)reasons.push(...spotMonth.reasons.map(x=>'SPOT_'+x));
      if(!perpMonth.valid)reasons.push(...perpMonth.reasons.map(x=>'PERP_'+x));
      if(reasons.length){
        state.broken=true;
        slots.push({asset,month,valid:false,exposure:false,transition:'INVALID',reasons});
        continue;
      }

      const signal=priorFunding.sumRate;
      let baseNet=0,stressNet=0,fundingPnl=0,basisPnl=0,baseCost=0,stressCost=0;
      let transition='FLAT',exposure=false;

      if(!state.position){
        if(signal>=cfg.entryThreshold){
          const currentFunding=auditFunding(d.funding,month,cfg);
          if(!currentFunding.valid){
            state.broken=true;
            slots.push({asset,month,valid:false,exposure:false,transition:'INVALID',reasons:currentFunding.reasons.map(x=>'CURRENT_FUNDING_'+x)});
            continue;
          }
          const qSpot=cfg.spotNotional/spotMonth.firstOpen;
          const qPerp=-cfg.perpNotional/perpMonth.firstOpen;
          const rates=currentFunding.rows.filter(x=>x.time>currentFunding.start);
          fundingPnl=Math.abs(qPerp)*perpMonth.firstOpen*sum(rates.map(x=>x.rate));
          basisPnl=qSpot*(spotMonth.lastClose-spotMonth.firstOpen)+qPerp*(perpMonth.lastClose-perpMonth.firstOpen);
          baseCost=entryCostUsd(cfg,false);
          stressCost=entryCostUsd(cfg,true);
          baseNet=fundingPnl+basisPnl-baseCost;
          stressNet=fundingPnl+basisPnl-stressCost;
          state.position={qSpot,qPerp,lastSpot:spotMonth.lastClose,lastPerp:perpMonth.lastClose,entryMonth:month};
          transition='ENTER'; exposure=true; L.entryEvents++; L.exposureMonths++;
        }
      }else if(signal<=cfg.holdThresholdExclusive){
        const p=state.position;
        basisPnl=p.qSpot*(spotMonth.firstOpen-p.lastSpot)+p.qPerp*(perpMonth.firstOpen-p.lastPerp);
        const spotNotional=Math.abs(p.qSpot)*spotMonth.firstOpen;
        const perpNotional=Math.abs(p.qPerp)*perpMonth.firstOpen;
        baseCost=exitCostUsd({spotNotional,perpNotional},cfg,false);
        stressCost=exitCostUsd({spotNotional,perpNotional},cfg,true);
        baseNet=basisPnl-baseCost;
        stressNet=basisPnl-stressCost;
        state.position=null;
        transition='EXIT'; exposure=true; L.exitEvents++; L.exposureMonths++;
      }else{
        const currentFunding=auditFunding(d.funding,month,cfg);
        if(!currentFunding.valid){
          state.broken=true;
          slots.push({asset,month,valid:false,exposure:false,transition:'INVALID',reasons:currentFunding.reasons.map(x=>'CURRENT_FUNDING_'+x)});
          continue;
        }
        const p=state.position;
        fundingPnl=Math.abs(p.qPerp)*perpMonth.firstOpen*currentFunding.sumRate;
        basisPnl=p.qSpot*(spotMonth.lastClose-p.lastSpot)+p.qPerp*(perpMonth.lastClose-p.lastPerp);
        baseNet=fundingPnl+basisPnl;
        stressNet=baseNet;
        p.lastSpot=spotMonth.lastClose; p.lastPerp=perpMonth.lastClose;
        transition='HOLD'; exposure=true; L.persistentHoldMonths++; L.exposureMonths++;
      }

      L.netPnl+=baseNet; L.stressNetPnl+=stressNet; L.fundingPnl+=fundingPnl; L.basisPnl+=basisPnl; L.costs+=baseCost;
      slots.push({
        asset,month,priorMonth:priorKey,valid:true,transition,exposure,signalFunding:signal,
        pnl:{fundingPnl,basisPnl,baseCost,stressCost,netUsd:baseNet,stressNetUsd:stressNet}
      });
    }
  }

  // Forced terminal close at final month's last close for every still-open position.
  const finalMonth=tradeMonths.at(-1);
  for(const asset of assets){
    const state=states[asset],L=ledger[asset];
    if(state.broken||!state.position)continue;
    const d=normalized[asset],spotMonth=auditKlines(d.spot,finalMonth,cfg),perpMonth=auditKlines(d.perp,finalMonth,cfg);
    const p=state.position;
    const spotNotional=Math.abs(p.qSpot)*spotMonth.lastClose;
    const perpNotional=Math.abs(p.qPerp)*perpMonth.lastClose;
    const bc=exitCostUsd({spotNotional,perpNotional},cfg,false);
    const sc=exitCostUsd({spotNotional,perpNotional},cfg,true);
    L.netPnl-=bc;L.stressNetPnl-=sc;L.costs+=bc;L.exitEvents++;
    const target=slots.findLast(x=>x.asset===asset&&x.month===finalMonth&&x.valid);
    if(target){
      target.pnl.baseCost+=bc;target.pnl.stressCost+=sc;target.pnl.netUsd-=bc;target.pnl.stressNetUsd-=sc;target.terminalExit=true;
      if(target.transition==='HOLD'){
        target.transition='HOLD_FINAL_EXIT';
        L.persistentHoldMonths=Math.max(0,L.persistentHoldMonths-1);
      }else if(target.transition==='ENTER'){
        target.transition='ENTER_FINAL_EXIT';
      }
    }
    state.position=null;
  }

  const invalid=slots.filter(x=>!x.valid);
  const periods=tradeMonths.map(month=>{
    const xs=slots.filter(x=>x.month===month&&x.valid);
    const capital=cfg.monthlyPortfolioCapital;
    const net=sum(xs.map(x=>x.pnl?.netUsd||0));
    const stress=sum(xs.map(x=>x.pnl?.stressNetUsd||0));
    return{month,decisionSlots:xs.length,exposureMonths:xs.filter(x=>x.exposure).length,netUsd:net,stressNetUsd:stress,return:capital?net/capital:0,stressReturn:capital?stress/capital:0};
  });

  const base=summarize(periods,'return'),stress=summarize(periods,'stressReturn'),ws=windows(periods,5);
  const byAsset=assets.map(a=>ledger[a]);
  const positive=byAsset.filter(x=>x.netPnl>0),positiveTotal=sum(positive.map(x=>x.netPnl));
  const positiveConcentrationPct=positiveTotal>0?Math.max(...positive.map(x=>x.netPnl))/positiveTotal*100:0;
  const totalNetPnl=sum(byAsset.map(x=>x.netPnl));
  const totalStressNetPnl=sum(byAsset.map(x=>x.stressNetPnl));
  const totalFundingPnl=sum(byAsset.map(x=>x.fundingPnl));
  const totalBasisPnl=sum(byAsset.map(x=>x.basisPnl));
  const totalCosts=sum(byAsset.map(x=>x.costs));
  const exposureMonths=sum(byAsset.map(x=>x.exposureMonths));
  const entryEvents=sum(byAsset.map(x=>x.entryEvents));
  const exitEvents=sum(byAsset.map(x=>x.exitEvents));
  const persistentHoldMonths=sum(byAsset.map(x=>x.persistentHoldMonths));

  const result={
    ruleset:SPOT_PERP_FUNDING_HARVEST_V2_RULESET,researchOnly:true,executionImpact:false,autoPromotion:false,
    stage,assets,tradeMonths:[...tradeMonths],decisionSlots:slots.length,
    validDecisionSlots:slots.length-invalid.length,rejectedDecisionSlots:invalid.length,
    dataIntegrityFailure:invalid.length>0,invalid,
    exposureMonths,entryEvents,exitEvents,persistentHoldMonths,
    averageHoldingStreakLength:entryEvents?exposureMonths/entryEvents:0,
    slots,byAsset,periods,
    summary:{...base,totalNetPnl,totalFundingPnl,totalBasisPnl,totalCosts,fundingCostRatio:totalCosts>0?totalFundingPnl/totalCosts:null},
    stressSummary:{...stress,totalStressNetPnl},
    positiveWindows:ws.positiveWindows,windows:ws.windows,
    positiveAssets:positive.length,positiveConcentrationPct
  };

  const gate=stage==='VALIDATION'?cfg.validationGate:cfg.developmentGate;
  result.gate=gateResult(result,gate,stage);
  result.decision=result.gate.decision;
  return result;
}
