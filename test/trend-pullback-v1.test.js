import test from 'node:test';
import assert from 'node:assert/strict';
import {trendPullbackDecision,TREND_PULLBACK_V1_RULESET} from '../trend-pullback-v1.js';

const signal=(overrides={})=>({symbol:'BTCUSDT',status:'NO_SETUP',entry:100,technical:50,candidate:50,frames:{
  '15m':{price:100,ema20:99.6,ema50:98,atr:2,rsi:56,volumeRatio:1},
  '1h':{ema20:102,ema50:98,adx:24,macd:{hist:1}},
  '4h':{ema20:105,ema50:95,adx:28}
},...overrides});

test('trend pullback is independent of Baseline READY and has fixed 2R geometry',()=>{
  const x=trendPullbackDecision(signal());
  assert.equal(x.decision,'TRADE');
  assert.equal(x.baselineGateIndependent,true);
  assert.equal(x.riskPct,.5);
  assert.equal(x.sl,97);
  assert.equal(x.tp1,106);
  assert.equal(x.ruleset,TREND_PULLBACK_V1_RULESET);
});

test('trend pullback rejects weak, unaligned and extended setups',()=>{
  const weak=signal({frames:{...signal().frames,'4h':{ema20:95,ema50:105,adx:12}}});
  const x=trendPullbackDecision(weak);
  assert.equal(x.decision,'SKIP');
  assert.ok(x.reasons.includes('HTF_TREND_NOT_ALIGNED'));
  assert.ok(x.reasons.includes('TREND_STRENGTH_LOW'));
  const extended=signal();extended.frames['15m']={...extended.frames['15m'],price:104};
  assert.ok(trendPullbackDecision(extended).reasons.includes('OUTSIDE_PULLBACK_ZONE'));
});
