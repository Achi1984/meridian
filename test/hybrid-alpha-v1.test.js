import test from 'node:test';
import assert from 'node:assert/strict';
import {hybridAlphaDecision} from '../hybrid-alpha-v1.js';

test('bull trend evidence produces a research LONG without execution impact',()=>{
  const x=hybridAlphaDecision({regime:'BULL',trend:.8,momentum:.7,relativeStrength:.5,meanReversion:-.1,carry:.1,orderFlow:.4,volatilityRatio:1,liquidityQuality:1});
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
  assert.equal(x.side,'LONG');
  assert.ok(x.alpha>.2);
});

test('range regime gives mean reversion material weight',()=>{
  const x=hybridAlphaDecision({regime:'RANGE',trend:0,momentum:0,relativeStrength:0,meanReversion:.9,carry:0,orderFlow:.4,volatilityRatio:1});
  assert.equal(x.regime,'RANGE');
  assert.equal(x.side,'LONG');
  assert.ok(x.components.meanReversion.weight>x.components.trend.weight);
});

test('missing optional evidence renormalizes and insufficient evidence observes',()=>{
  const x=hybridAlphaDecision({regime:'BEAR',trend:-.8,momentum:-.7});
  assert.equal(x.side,'OBSERVE');
  assert.equal(x.reason,'INSUFFICIENT_EVIDENCE');
});

test('volatility and reversal risk only de-risk; never lever above one',()=>{
  const calm=hybridAlphaDecision({regime:'BULL',trend:.8,momentum:.7,relativeStrength:.6,orderFlow:.4,volatilityRatio:.5,liquidityQuality:1,reversalRisk:0});
  const stressed=hybridAlphaDecision({regime:'BULL',trend:.8,momentum:.7,relativeStrength:.6,orderFlow:.4,volatilityRatio:2,liquidityQuality:.6,reversalRisk:.8});
  assert.ok(calm.riskMultiplier<=1);
  assert.ok(stressed.riskMultiplier<calm.riskMultiplier);
});
