import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePostStop, buildSuccessorPlan, POST_STOP_POLICY } from '../post-stop-learning.js';

const trade=(i,pnl,extra={})=>({
  status:'CLOSED',symbol:'BTCUSDT',side:'LONG',entry:100,sl:99,qty:100,
  openedAt:`2026-09-${String(i).padStart(2,'0')}T00:00:00Z`,closedAt:`2026-09-${String(i).padStart(2,'0')}T01:00:00Z`,
  exitReason:pnl<0?'SL':'TP1',realized:pnl,...extra
});
const stopped=()=>{
  const trades=Array.from({length:20},(_,i)=>trade((i%9)+1,i%2?110:-130,{symbol:i%3?'BTCUSDT':'ETHUSDT'}));
  trades[0]={...trades[0],symbol:'BTCUSDT',side:'LONG',openedAt:'2026-09-01T00:00:00Z',closedAt:'2026-09-01T01:00:00Z',exitReason:'SL'};
  trades[1]={...trades[1],symbol:'BTCUSDT',side:'LONG',openedAt:'2026-09-01T01:30:00Z',closedAt:'2026-09-01T02:30:00Z'};
  trades[2]={...trades[2],symbol:'ETHUSDT',side:'LONG',openedAt:'2026-09-01T01:30:00Z',closedAt:'2026-09-01T02:30:00Z'};
  return {account:{startEquity:10000,equity:9200,peakEquity:10000},trades};
};

test('post-stop analysis is read-only and identifies actionable causes',()=>{
  const state=stopped(),before=structuredClone(state);
  const out=analyzePostStop(state,{maxDrawdownPct:8});
  assert.equal(out.triggered,true);
  assert.equal(out.adequate,true);
  assert.equal(out.maximumDrawdownPct,8);
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.ok(out.causes.includes('MATERIAL_STOP_LOSSES'));
  assert.deepEqual(state,before);
});

test('successor is not created before both drawdown and sample gates pass',()=>{
  const healthy=stopped();healthy.account.equity=9900;
  assert.equal(buildSuccessorPlan(healthy,{maxDrawdownPct:8}).eligible,false);
  const small=stopped();small.trades=small.trades.slice(0,19);
  assert.equal(buildSuccessorPlan(small,{maxDrawdownPct:8}).eligible,false);
  const stillOpen=stopped();stillOpen.positions=[{status:'OPEN'}];
  assert.equal(buildSuccessorPlan(stillOpen,{maxDrawdownPct:8}).eligible,false);
});

test('eligible successor receives one frozen conservative parameter snapshot',()=>{
  const out=buildSuccessorPlan(stopped(),{
    maxDrawdownPct:8,maxDailyLossPct:3,maxPortfolioRiskPct:3,maxTradesPerDay:8,cooldownMinutes:30,riskPerTradePct:1
  },{tradeScore:72,cautionScore:62,fullRiskPct:1});
  assert.equal(out.eligible,true);
  assert.equal(out.parameters.frozen,true);
  assert.equal(out.parameters.fullRiskPct,.5);
  assert.equal(out.parameters.cautionRiskPct,.25);
  assert.equal(out.parameters.tradeScore,74);
  assert.equal(out.parameters.cautionScore,66);
  assert.equal(out.parameters.cooldownMinutes,180);
  assert.equal(out.parameters.postStopReentryMinutes,720);
  assert.equal(out.parameters.maxOpenPositions,1);
  assert.equal(out.parameters.maxDrawdownPct,8);
  assert.equal(out.parameters.assetFilter,null);
  assert.equal(out.parameters.sideFilter,null);
  assert.equal(POST_STOP_POLICY.minimumClosedTrades,20);
});
