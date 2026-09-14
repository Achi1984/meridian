import test from 'node:test';
import assert from 'node:assert/strict';
import {relativeMomentum,residualPairs,squeezeExhaustion,carrySelector,R42_POLICY} from '../research/r42-candidates.js';
const now=100000000;
test('R42 momentum rejects missing data and beta imbalance',()=>{
  assert.equal(relativeMomentum([],now).eligible,false);
  const rows=Array.from({length:8},(_,i)=>({symbol:`S${i}`,quoteAt:now,return30d:i/100,beta:1,quoteVolumeUsd:3e7,historyComplete:true}));
  assert.equal(relativeMomentum(rows,now).eligible,true);
  rows[7].beta=3;assert.deepEqual(relativeMomentum(rows,now).reasons,['BETA_IMBALANCE']);
  rows[7].quoteAt=now+1;assert.equal(relativeMomentum(rows,now).eligible,false);
});
test('R42 pairs requires statistical evidence rather than correlation',()=>{
  assert.equal(residualPairs({asOf:now,correlation:.99},now).eligible,false);
  const e={asOf:now,method:'ENGLE_GRANGER_RESIDUAL_ADF',multipleTestingAdjusted:true,observations:300,pValue:.005,stableAcrossWindows:true,hedgeRatio:1,zScore:3,expectedNetEdge:.01};
  assert.equal(residualPairs(e,now).spreadSide,'SHORT_SPREAD');
  assert.equal(residualPairs({...e,pValue:NaN},now).eligible,false);
  assert.equal(residualPairs({...e,zScore:5},now).eligible,false);
});
test('R42 squeeze requires complete event data and confirmed reversal',()=>{
  const e={asOf:now,liquidationCoverageComplete:true,fundingPercentile:.99,openInterestChange:-.05,liquidationPercentile:.99,takerBuyShare:.3,confirmedCloseBelowVwap:true};
  assert.equal(squeezeExhaustion(e,now).side,'SHORT');
  assert.equal(squeezeExhaustion({...e,liquidationCoverageComplete:false},now).eligible,false);
  assert.equal(squeezeExhaustion({...e,confirmedCloseBelowVwap:false},now).eligible,false);
});
test('R42 carry ranks net estimates only with executable complete inputs',()=>{
  const e={symbol:'BTCUSDT',asOf:now,completeFundingHistory:true,executableQuotes:true,basisWithinBand:true,liquidityPassed:true,conservativeFundingUsd:100,allInRoundTripCostsUsd:30};
  assert.equal(carrySelector([e],now).projectedNetUsd,70);
  assert.equal(carrySelector([{...e,conservativeFundingUsd:60}],now).eligible,false);
  assert.equal(carrySelector([{...e,allInRoundTripCostsUsd:0}],now).eligible,false);
  assert.equal(R42_POLICY.executionImpact,false);
});
