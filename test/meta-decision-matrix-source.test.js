import test from 'node:test';
import assert from 'node:assert/strict';
import { matrixForSignal, __test } from '../meta-decision-matrix-source.js';
import { decisionMatrixEvidence } from '../meta-decision-matrix-evidence.js';

const sig={symbol:'BTCUSDT',side:'LONG',status:'READY',technical:80,candidate:78,regime:'BULL',distanceAtr:.3,entry:100,sl:98,tp1:102.8,tp2:104.4,frames:{'15m':{price:100,ema20:99,ema50:98,rsi:60,macd:{hist:1},atr:1,adx:24,volumeRatio:1.2},'1h':{price:100,ema20:99,ema50:98,rsi:60,macd:{hist:1},atr:2,adx:25,volumeRatio:1.1},'4h':{price:100,ema20:98,ema50:96,rsi:58,macd:{hist:1},atr:4,adx:26,volumeRatio:1}}};

test('adapter emits four research-only opinions',()=>{
  const m=matrixForSignal(sig,123,{realizedR:1});
  assert.equal(m.opinions.length,4);
  assert.equal(m.researchOnly,true);
  assert.equal(m.executionImpact,false);
  assert.equal(m.outcome.realizedR,1);
});

test('shadow and challenger parity rules behave on a strong bull READY signal',()=>{
  assert.equal(__test.shadowOpinion(sig).decision,'TRADE');
  assert.ok(['TRADE','CAUTION'].includes(__test.challengerOpinion(sig).decision));
});

test('evidence groups support and conflicts',()=>{
  const a=matrixForSignal(sig,1,{realizedR:1});
  const b=matrixForSignal({...sig,regime:'TRANSITION'},2,{realizedR:-1});
  const e=decisionMatrixEvidence([a,b]);
  assert.equal(e.all.n,2);
  assert.ok(e.bySupport.length>0);
  assert.equal(e.promotion.allowed,false);
});
