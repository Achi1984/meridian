import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridAlphaTransitionDecision,HYBRID_ALPHA_V793_TRANSITION_SHORT_FACTOR} from '../hybrid-alpha-transition-v793.js';

test('v7.93 only attenuates SHORT risk in TRANSITION',()=>{
  const shortTransition=hybridAlphaTransitionDecision({regime:'TRANSITION',trend:-.8,momentum:-.7,relativeStrength:-.5,macroTrend:-.2,volatilityRatio:1,liquidityQuality:1});
  const longTransition=hybridAlphaTransitionDecision({regime:'TRANSITION',trend:.8,momentum:.7,relativeStrength:.5,macroTrend:.2,volatilityRatio:1,liquidityQuality:1});
  assert.equal(shortTransition.side,'SHORT');
  assert.equal(shortTransition.transitionRiskFactor,HYBRID_ALPHA_V793_TRANSITION_SHORT_FACTOR);
  assert.ok(shortTransition.riskMultiplier<1);
  assert.equal(longTransition.side,'LONG');
  assert.equal(longTransition.transitionRiskFactor,1);
});

test('v7.93 never increases v7.92 risk and remains research-only',()=>{
  const x=hybridAlphaTransitionDecision({regime:'BULL',trend:.8,momentum:.7,relativeStrength:.5,macroTrend:.8,volatilityRatio:.8,liquidityQuality:1});
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
  assert.ok(x.riskMultiplier<=1);
});
