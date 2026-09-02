import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateExitModel, compareExitModels, aggregateExitLab, EXIT_LAB_VERSION } from '../exit-lab.js';

const trade={side:'LONG',entry:100,sl:90,tp1:114,tp2:122,atr:6,regimeType:'TREND_UP'};

test('model A closes full position at TP1',()=>{
  const r=simulateExitModel(trade,[{ts:1,open:100,high:115,low:99,close:114}], 'A_CURRENT',{feeBps:0,slippageBps:0});
  assert.equal(r.tp1Hit,true);
  assert.equal(r.runnerReason,'TP1_FULL');
  assert.equal(r.realizedR,1.4);
});

test('model B takes half at TP1 and protects remainder at BE plus costs',()=>{
  const r=simulateExitModel(trade,[
    {ts:1,open:100,high:115,low:99,close:114},
    {ts:2,open:114,high:116,low:100.5,close:101}
  ],'B_PROTECTED',{feeBps:0,slippageBps:0});
  assert.equal(r.tp1Hit,true);
  assert.equal(r.bePrice,100);
  assert.equal(r.runnerReason,'BE_OR_TRAIL');
  assert.equal(r.tp1ThenBe,true);
  assert.equal(r.realizedR,.7);
});

test('model B keeps runner to TP2 when trend continues',()=>{
  const r=simulateExitModel(trade,[
    {ts:1,open:100,high:115,low:99,close:114},
    {ts:2,open:114,high:123,low:113,close:122}
  ],'B_PROTECTED',{feeBps:0,slippageBps:0});
  assert.equal(r.runnerReason,'TP2');
  assert.equal(r.realizedR,1.8);
});

test('BE includes fee and slippage buffer',()=>{
  const r=simulateExitModel(trade,[{ts:1,open:100,high:115,low:99,close:114}], 'B_PROTECTED',{feeBps:5,slippageBps:3});
  assert.ok(r.bePrice>100);
  assert.ok(r.costBufferR>0);
});

test('adaptive model takes less at TP1 in trend than in range',()=>{
  const candles=[{ts:1,open:100,high:115,low:99,close:114},{ts:2,open:114,high:122,low:111,close:120,atr:6}];
  const trend=simulateExitModel({...trade,regimeType:'TREND_UP'},candles,'D_ADAPTIVE',{feeBps:0,slippageBps:0});
  const range=simulateExitModel({...trade,regimeType:'RANGE'},candles,'D_ADAPTIVE',{feeBps:0,slippageBps:0});
  assert.notEqual(trend.realizedR,range.realizedR);
});

test('comparison and aggregate are research-only',()=>{
  const c=compareExitModels(trade,[{ts:1,open:100,high:115,low:99,close:114},{ts:2,open:114,high:123,low:113,close:122}],{feeBps:0,slippageBps:0});
  assert.equal(c.version,EXIT_LAB_VERSION);
  assert.equal(c.researchOnly,true);
  assert.equal(c.executionImpact,false);
  const a=aggregateExitLab([c,c]);
  assert.equal(a.models.B_PROTECTED.trades,2);
  assert.ok(Number.isFinite(a.models.B_PROTECTED.avgR));
});
