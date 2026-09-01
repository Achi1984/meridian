import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRegime,regimeDecision,REGIME_V1_RULESET} from '../regime-v1.js';

const sig=(o={})=>({symbol:'SOLUSDT',side:'SHORT',technical:78,candidate:82,status:'READY',entry:100,distanceAtr:.4,frames:{
  '15m':{price:100,ema20:99.6,ema50:98,rsi:55,atr:1,adx:24,volumeRatio:1.1,macd:{hist:.2}},
  '1h':{price:100,ema20:98,ema50:96,rsi:58,atr:2,adx:28,volumeRatio:1.1,macd:{hist:.4}},
  '4h':{price:100,ema20:95,ema50:90,rsi:60,atr:4,adx:30,volumeRatio:1,macd:{hist:.7}}
},...o});

test('trend regime can adapt side independently from baseline candidate',()=>{
  const s=sig();
  assert.equal(classifyRegime(s),'TREND_UP');
  const d=regimeDecision(s);
  assert.equal(d.side,'LONG');
  assert.ok(d.reasons.includes('SIDE_ADAPTED_TO_REGIME'));
  assert.equal(d.ruleset,REGIME_V1_RULESET);
  assert.equal(d.executionImpact,false);
});

test('range regime uses mean-reversion bias and reduced risk',()=>{
  const s=sig({side:'SHORT',frames:{
    '15m':{price:100,ema20:99.2,ema50:99,rsi:39,atr:1,adx:14,volumeRatio:.9,macd:{hist:-.1}},
    '1h':{price:100,ema20:99.5,ema50:99.4,rsi:45,atr:2,adx:16,volumeRatio:.9,macd:{hist:-.1}},
    '4h':{price:100,ema20:100,ema50:99.8,rsi:49,atr:4,adx:15,volumeRatio:1,macd:{hist:0}}
  }});
  assert.equal(classifyRegime(s),'RANGE');
  const d=regimeDecision(s,{tradeScore:0});
  assert.equal(d.side,'LONG');
  assert.ok(d.riskPct<=.65);
  assert.equal(d.tp1R,1);
});

test('expansion gets wider stop and asymmetric targets',()=>{
  const s=sig({distanceAtr:.8,frames:{
    '15m':{price:100,ema20:99.2,ema50:98,rsi:60,atr:1,adx:30,volumeRatio:1.6,macd:{hist:.3}},
    '1h':{price:100,ema20:98,ema50:96,rsi:62,atr:2,adx:26,volumeRatio:1.3,macd:{hist:.5}},
    '4h':{price:100,ema20:95,ema50:90,rsi:65,atr:4,adx:31,volumeRatio:1,macd:{hist:.8}}
  }});
  assert.equal(classifyRegime(s),'EXPANSION');
  const d=regimeDecision(s,{tradeScore:0});
  assert.equal(d.stopMult,1.8);
  assert.equal(d.tp2R,2.8);
  assert.ok(d.riskPct<=.8);
});

test('chop is soft-penalized rather than hard blocked',()=>{
  const s=sig({technical:95,candidate:95,frames:{
    '15m':{price:100,ema20:100,ema50:99.9,rsi:52,atr:1,adx:19,volumeRatio:1,macd:{hist:.05}},
    '1h':{price:100,ema20:100.1,ema50:100,rsi:51,atr:2,adx:23,volumeRatio:1,macd:{hist:.02}},
    '4h':{price:100,ema20:100,ema50:100.2,rsi:50,atr:4,adx:19,volumeRatio:1,macd:{hist:0}}
  }});
  assert.equal(classifyRegime(s),'CHOP');
  const d=regimeDecision(s,{tradeScore:0});
  assert.notEqual(d.decision,'SKIP');
  assert.ok(d.riskPct<=.35);
});
