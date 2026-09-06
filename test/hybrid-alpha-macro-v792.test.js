import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridAlphaMacroDecision} from '../hybrid-alpha-macro-v792.js';

const bull={regime:'BULL',trend:.9,momentum:.8,relativeStrength:.6,volatilityRatio:1,liquidityQuality:1};
const bear={regime:'BEAR',trend:-.9,momentum:-.8,relativeStrength:-.6,volatilityRatio:1,liquidityQuality:1};

test('opposing macro trend only attenuates long risk',()=>{
  const aligned=hybridAlphaMacroDecision({...bull,macroTrend:.8});
  const opposed=hybridAlphaMacroDecision({...bull,macroTrend:-.8});
  assert.equal(aligned.side,'LONG');
  assert.ok(opposed.riskMultiplier<aligned.riskMultiplier);
  assert.ok(opposed.riskMultiplier<=opposed.riskMultiplier/opposed.macroRiskFactor);
});

test('overlay is symmetric for short side',()=>{
  const aligned=hybridAlphaMacroDecision({...bear,macroTrend:-.8});
  const opposed=hybridAlphaMacroDecision({...bear,macroTrend:.8});
  assert.equal(aligned.side,'SHORT');
  assert.ok(opposed.riskMultiplier<aligned.riskMultiplier);
});

test('macro overlay stays research-only and never raises risk',()=>{
  const x=hybridAlphaMacroDecision({...bull,macroTrend:1});
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
  assert.ok(x.macroRiskFactor<=1);
});
