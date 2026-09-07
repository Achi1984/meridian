import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridAlphaLiquidityDecision,HYBRID_ALPHA_V797_LOW_LIQUIDITY} from '../hybrid-alpha-liquidity-v797.js';
import {hybridAlphaWeakDecision} from '../hybrid-alpha-weak-v796.js';

const base={regime:'BULL',trend:1,momentum:1,relativeStrength:1,meanReversion:0,macroTrend:1,volatilityRatio:1,reversalRisk:0};

test('v7.97 is research-only and never increases v7.96 risk',()=>{
  const evidence={...base,liquidityQuality:.49};
  const prior=hybridAlphaWeakDecision(evidence);
  const d=hybridAlphaLiquidityDecision(evidence);
  assert.equal(d.researchOnly,true);
  assert.equal(d.executionImpact,false);
  assert.equal(d.side,prior.side);
  assert.ok(d.riskMultiplier<=prior.riskMultiplier);
});

test('liquidity below 0.50 uses fixed 0.60 attenuation without blocking',()=>{
  const evidence={...base,liquidityQuality:.49};
  const prior=hybridAlphaWeakDecision(evidence);
  const d=hybridAlphaLiquidityDecision(evidence);
  assert.equal(HYBRID_ALPHA_V797_LOW_LIQUIDITY.threshold,.5);
  assert.equal(d.lowLiquidityRiskFactor,.6);
  assert.equal(d.liquidityBand,'LOW');
  assert.equal(d.side,prior.side);
  assert.notEqual(d.side,'OBSERVE');
});

test('liquidity at threshold is not attenuated',()=>{
  const evidence={...base,liquidityQuality:.5};
  const prior=hybridAlphaWeakDecision(evidence);
  const d=hybridAlphaLiquidityDecision(evidence);
  assert.equal(d.lowLiquidityRiskFactor,1);
  assert.equal(d.liquidityBand,'OK');
  assert.equal(d.riskMultiplier,prior.riskMultiplier);
});

test('missing liquidity is not fabricated as low liquidity',()=>{
  const prior=hybridAlphaWeakDecision(base);
  const d=hybridAlphaLiquidityDecision(base);
  assert.equal(d.lowLiquidityRiskFactor,1);
  assert.equal(d.liquidityBand,'OK');
  assert.equal(d.riskMultiplier,prior.riskMultiplier);
});
