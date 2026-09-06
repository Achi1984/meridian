import test from 'node:test';
import assert from 'node:assert/strict';
import { paperBotDeepDive } from '../research-analytics.js';

const t=(pnl,side,symbol,regime,closedAt)=>({status:'CLOSED',realized:pnl,side,symbol,regime,challengerRegime:regime,openedAt:closedAt,closedAt});

function state(trades,counterfactuals=[]){return {trades,counterfactuals,account:{startEquity:10000,equity:10000}}}

test('v7.87 compares baseline and challenger by side, regime and symbol inside common window',()=>{
  const baseline=state([
    t(-100,'LONG','BTCUSDT','BULL','2026-09-01T00:00:00Z'),
    t(50,'SHORT','ETHUSDT','BEAR','2026-09-02T00:00:00Z'),
    t(999,'LONG','SOLUSDT','BULL','2026-08-01T00:00:00Z')
  ]);
  const challenger=state([
    t(100,'LONG','BTCUSDT','BULL','2026-09-01T12:00:00Z'),
    t(-25,'SHORT','ETHUSDT','BEAR','2026-09-02T12:00:00Z')
  ],[
    {status:'CLOSED',outcomeR:1.2,reason:'WAIT_ENTRY_ZONE',regime:'BULL'},
    {status:'CLOSED',outcomeR:-1,reason:'CONFIDENCE_LT_CAUTION',regime:'BEAR'}
  ]);
  const x=paperBotDeepDive({baseline,challenger},{start:'2026-09-01T00:00:00Z',end:'2026-09-03T00:00:00Z'});
  assert.equal(x.researchOnly,true);
  assert.equal(x.executionImpact,false);
  assert.equal(x.summary.baseline.trades,2);
  assert.equal(x.summary.challenger.trades,2);
  assert.equal(x.bySide.LONG.baseline.pnl,-100);
  assert.equal(x.bySide.LONG.challenger.pnl,100);
  assert.equal(x.byRegime.BULL.delta.pnl,200);
  assert.equal(x.bySymbol.BTCUSDT.delta.pnl,200);
  assert.equal(x.opportunityCost.netCounterfactualR,.2);
});

test('v7.87 marks small cohorts inadequate and returns descriptive temporal slices',()=>{
  const baseline=state([t(10,'LONG','BTCUSDT','BULL','2026-09-01T06:00:00Z')]);
  const challenger=state([t(20,'LONG','BTCUSDT','BULL','2026-09-01T18:00:00Z')]);
  const x=paperBotDeepDive({baseline,challenger},{start:'2026-09-01T00:00:00Z',end:'2026-09-04T00:00:00Z'});
  assert.equal(x.bySide.LONG.baseline.adequate,false);
  assert.equal(x.temporalSlices.length,3);
  assert.match(x.caveats.join(' '),/not a retrained-model OOS test/);
});
