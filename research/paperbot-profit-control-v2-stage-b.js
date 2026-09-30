export const PAPER_PROFIT_CONTROL_V2_STAGE_B=Object.freeze({
  profile:'PROFIT_FIRST_BALANCED_V1',
  researchOnly:true,
  executionImpact:false,
  autoPromotion:false,
  gate:Object.freeze({
    maxDrawdownPct:20,
    minProfitFactor:1.15,
    maxPositivePnlConcentrationPct:35,
    minEvaluationPeriods:30,
    chronologicalWindows:5,
    minPositiveWindows:4,
    universeSize:8,
    minPositiveAssets:5,
    baselineCostBps:8,
    stressCostBps:16,
    requireStressNetPositive:true,
    maxResearchLeverage:2
  }),
  universe:Object.freeze(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']),
  candidateFamilies:Object.freeze([
    'VOL_MANAGED_TSMOM',
    'REGIME_GATED_TREND_BREAKOUT',
    'DELTA_NEUTRAL_FUNDING_CARRY',
    'VALIDATED_RANGE_GRID'
  ]),
  holdout:Object.freeze({
    separateDiscoveryAndHoldout:true,
    immutableHoldoutParameters:true,
    retuneAfterResult:false,
    singleAssetPromotion:false,
    singleWindowPromotion:false,
    livePromotion:false
  })
});

export function evaluateStageBGate(input={}){
  const g=PAPER_PROFIT_CONTROL_V2_STAGE_B.gate;
  const reasons=[];
  const periods=Number(input.evaluationPeriods||0);
  const net=Number(input.netCompoundedReturnPct);
  const pf=Number(input.profitFactor);
  const dd=Number(input.maxDrawdownPct);
  const windows=Number(input.positiveWindows||0);
  const assets=Number(input.positiveAssets||0);
  const concentration=Number(input.positivePnlConcentrationPct);
  const stressNet=Number(input.stressNetCompoundedReturnPct);
  if(periods<g.minEvaluationPeriods)reasons.push('PERIODS_LT_30');
  if(!Number.isFinite(net)||net<=0)reasons.push('BASELINE_NET_NOT_POSITIVE');
  if(!Number.isFinite(pf)||pf<g.minProfitFactor)reasons.push('PF_LT_1_15');
  if(!Number.isFinite(dd)||dd>g.maxDrawdownPct)reasons.push('DD_GT_20PCT');
  if(windows<g.minPositiveWindows)reasons.push('POSITIVE_WINDOWS_LT_4_OF_5');
  if(assets<g.minPositiveAssets)reasons.push('POSITIVE_ASSETS_LT_5_OF_8');
  if(!Number.isFinite(concentration)||concentration>g.maxPositivePnlConcentrationPct)reasons.push('POSITIVE_PNL_CONCENTRATION_GT_35PCT');
  if(!Number.isFinite(stressNet)||stressNet<=0)reasons.push('STRESS_16BPS_NET_NOT_POSITIVE');
  if(input.provenanceOk!==true)reasons.push('PROVENANCE_NOT_CONFIRMED');
  if(input.holdoutUntouched!==true)reasons.push('HOLDOUT_NOT_CONFIRMED_UNTOUCHED');
  return Object.freeze({
    pass:reasons.length===0,
    label:reasons.length?'STAGE_B_GATE_FAIL':'STAGE_B_GATE_PASS',
    reasons:Object.freeze(reasons),
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false
  });
}
