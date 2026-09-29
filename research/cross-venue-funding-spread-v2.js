import {
  CROSS_VENUE_FUNDING_SPREAD_V1_RULESET,
  runCrossVenueFundingSpreadV1
} from './cross-venue-funding-spread-v1.js';

export const CROSS_VENUE_FUNDING_SPREAD_V2_RULESET='CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN';

export const CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS=Object.freeze([
  'BNB','ADA','DOT','LTC','BCH','TRX','ETC'
]);

export const CROSS_VENUE_FUNDING_SPREAD_V2_GATE=Object.freeze({
  minAssetMonthCycles:140,
  minCyclesPerAsset:20,
  minProfitFactor:1.15,
  maxDrawdownPct:10,
  minPositiveWindows:4,
  maxPositivePnlConcentrationPct:60
});

export function runCrossVenueFundingSpreadV2(dataset){
  const base=runCrossVenueFundingSpreadV1(dataset,{
    assets:CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS,
    gate:CROSS_VENUE_FUNDING_SPREAD_V2_GATE
  });
  const pass=base.gate.pass;
  return {
    ...base,
    ruleset:CROSS_VENUE_FUNDING_SPREAD_V2_RULESET,
    parentRuleset:CROSS_VENUE_FUNDING_SPREAD_V1_RULESET,
    stage:'INDEPENDENT_VALIDATION',
    assets:[...CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS],
    researchOnly:true,
    executionImpact:false,
    autoPromotion:false,
    decision:pass?'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY':'VALIDATION_FAIL_RESEARCH_REDESIGN'
  };
}
