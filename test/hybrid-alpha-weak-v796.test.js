import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridAlphaWeakDecision,HYBRID_ALPHA_V796_WEAK_ALPHA} from '../hybrid-alpha-weak-v796.js';

const base={regime:'TRANSITION',trend:.5,momentum:.35,relativeStrength:.2,meanReversion:0,macroTrend:.2,volatilityRatio:1,liquidityQuality:1,reversalRisk:0};

test('v7.96 is research-only and never increases risk',()=>{
  const d=hybridAlphaWeakDecision(base);
  assert.equal(d.researchOnly,true);
  assert.equal(d.executionImpact,false);
  assert.ok(d.riskMultiplier<=1);
});

test('weak alpha uses fixed 0.60 attenuation without blocking trade',()=>{
  let found=null;
  for(let t=.2;t<=.8;t+=.01){
    const d=hybridAlphaWeakDecision({...base,trend:t,momentum:t*.7,relativeStrength:t*.4});
    if(d.side!=='OBSERVE'&&Math.abs(d.alpha)>=HYBRID_ALPHA_V796_WEAK_ALPHA.min&&Math.abs(d.alpha)<HYBRID_ALPHA_V796_WEAK_ALPHA.max){found=d;break}
  }
  assert.ok(found,'expected a weak-alpha research trade fixture');
  assert.equal(found.weakAlphaRiskFactor,.6);
  assert.equal(found.weakAlphaBand,'WEAK');
  assert.notEqual(found.side,'OBSERVE');
});

test('stronger alpha is not attenuated by v7.96',()=>{
  const d=hybridAlphaWeakDecision({regime:'BULL',trend:1,momentum:1,relativeStrength:1,meanReversion:0,macroTrend:1,volatilityRatio:1,liquidityQuality:1,reversalRisk:0});
  assert.notEqual(d.side,'OBSERVE');
  assert.ok(Math.abs(d.alpha)>=.35);
  assert.equal(d.weakAlphaRiskFactor,1);
});
