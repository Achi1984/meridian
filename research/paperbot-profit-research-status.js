export const PAPERBOT_PROFIT_RESEARCH_STATUS=Object.freeze({
  updatedAt:'2026-09-28T21:10:04.840Z',
  executionImpact:false,
  livePromotion:false,
  strongestFamily:'REGIME_AWARE_LONG_TREND',
  validationState:'NO_VALIDATED_PROMOTION',
  stages:Object.freeze([
    Object.freeze({
      id:'V1',
      label:'BASELINE TREND',
      decision:'FAIL',
      best:'DONCHIAN_TREND_V1',
      netReturnPct:2.7495760072063335,
      profitFactor:1.0489327931848484,
      maxDrawdownPct:11.13742593739555,
      note:'Only positive V1 candidate; failed PF and stability gates.'
    }),
    Object.freeze({
      id:'V2_DISCOVERY',
      label:'UP-REGIME DAILY',
      decision:'PASS_DISCOVERY_ONLY',
      best:'UP_REGIME_DONCHIAN_V2',
      netReturnPct:11.931786751569984,
      profitFactor:2.3335687708297663,
      maxDrawdownPct:2.803465872625286,
      note:'Discovery gate passed; required independent transfer holdout.'
    }),
    Object.freeze({
      id:'V2_HOLDOUT',
      label:'TRANSFER UNIVERSE',
      decision:'FAIL',
      best:'UP_REGIME_DONCHIAN_V2',
      netReturnPct:5.83898848415092,
      profitFactor:2.2305445568223585,
      maxDrawdownPct:1.5307852604133405,
      note:'Profitable but only 16 periods and 2/5 positive windows.'
    }),
    Object.freeze({
      id:'V3',
      label:'ADAPTIVE UP TREND 6H',
      decision:'FAIL',
      best:'ADAPTIVE_UP_TREND_6H_V3',
      netReturnPct:19.398602374094054,
      profitFactor:1.1751737304592498,
      maxDrawdownPct:7.850969653091777,
      note:'Broad profitable result; failed PF>=1.20 and 4/5 stability gate.'
    })
  ]),
  nextResearch:Object.freeze([
    'RISK_MANAGED_CROSS_SECTIONAL_MOMENTUM',
    'FUNDING_CARRY_V3_DATA_FOUNDATION',
    'DYNAMIC_GRID_AFTER_INTRADAY_PATH_SIMULATOR'
  ]),
  rejectedDefault:Object.freeze([
    'UNBOUNDED_MARTINGALE',
    'ALWAYS_ON_STATIC_GRID'
  ]),
  note:'Profit maximization is evaluated only after frozen risk, cost, breadth and anti-overfitting gates. No result authorizes live execution.'
});
