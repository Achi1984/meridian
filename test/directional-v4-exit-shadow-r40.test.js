import test from 'node:test';
import assert from 'node:assert/strict';
import {newDirectionalV4State,pairDirectionalV4Position,cycleDirectionalV4,recordDirectionalV3Close,directionalV4Status} from '../directional-v4-exit-shadow.js';

const parent={id:'p1',symbol:'BTCUSDT',side:'LONG',entry:100,sl:90,tp1:114,tp2:122,qty:10,feeOpen:.5,riskPct:.5,plannedRiskBudgetUsd:100,openedAt:'2026-09-13T00:00:00Z'};

test('V4 creates one exact immutable pair per V3 position',()=>{
  let s=newDirectionalV4State(0,{feeBps:5,slippageBps:3});s=pairDirectionalV4Position(s,parent,1);s=pairDirectionalV4Position(s,parent,2);
  assert.equal(s.positions.length,1);const p=s.positions[0];for(const k of['symbol','side','entry','sl','tp1','tp2','qty','riskPct','plannedRiskBudgetUsd'])assert.equal(p[k],parent[k]);
});

test('V4 takes half at TP1 then protects runner and closes at TP2',()=>{
  let s=pairDirectionalV4Position(newDirectionalV4State(0,{feeBps:5,slippageBps:3}),parent,1);
  s=cycleDirectionalV4(s,{BTCUSDT:{price:114}},2);assert.equal(s.positions[0].remainingQty,5);assert.equal(s.positions[0].tp1Filled,true);assert.ok(s.positions[0].sl>100);
  const cashAfterTp1=s.account.cash;s=cycleDirectionalV4(s,{BTCUSDT:{price:114}},3);assert.equal(s.account.cash,cashAfterTp1);
  s=cycleDirectionalV4(s,{BTCUSDT:{price:122}},4);assert.equal(s.positions.length,0);assert.equal(s.trades[0].exitReason,'TP2');assert.ok(s.trades[0].realized>0);
});

test('V4 records a matched comparison only when both twins are closed',()=>{
  let s=pairDirectionalV4Position(newDirectionalV4State(),parent);s=recordDirectionalV3Close(s,{...parent,realized:50,closedAt:'2026-09-13T01:00:00Z'});assert.equal(s.pairs.length,0);
  s=cycleDirectionalV4(s,{BTCUSDT:{price:80}});s=recordDirectionalV3Close(s,{...parent,realized:-100,closedAt:'2026-09-13T01:00:00Z'});s=recordDirectionalV3Close(s,{...parent,realized:-100});
  assert.equal(s.pairs.length,1);assert.equal(directionalV4Status(s).closedCount,1);
});

