import test from 'node:test';
import assert from 'node:assert/strict';
import { replayExitCohort, replayExitLabForLedgers } from '../exit-lab-replay.js';

const trade={symbol:'BTCUSDT',side:'LONG',entry:100,sl:90,tp1:114,tp2:122,openedAt:1000,regime:'BULL'};
const market={BTCUSDT:{'15m':[
  {openTime:1001,closeTime:2000,open:100,high:115,low:99,close:114},
  {openTime:2001,closeTime:3000,open:114,high:123,low:113,close:122}
]}};

test('historical cohort replays same entry across all exit policies',()=>{
  const r=replayExitCohort([trade],market,{end:4000,feeBps:0,slippageBps:0});
  assert.equal(r.method,'FIXED_ENTRY_15M_EXIT_COHORT_REPLAY');
  assert.equal(r.replayedTrades,1);
  assert.equal(r.aggregate.models.A_CURRENT.totalR,1.4);
  assert.equal(r.aggregate.models.B_PROTECTED.totalR,1.8);
  assert.equal(r.aggregate.models.B_CONFIRM_CLOSE.trades,1);
});

test('ledger replay ranks exit policies independently for each bot cohort',()=>{
  const r=replayExitLabForLedgers({ledgers:{baseline:[trade],challenger:[trade]},market,end:4000,opts:{feeBps:0,slippageBps:0}});
  assert.equal(r.researchOnly,true);assert.equal(r.executionImpact,false);
  assert.equal(r.ledgers.baseline.replayedTrades,1);
  assert.ok(r.ranked.baseline[0].totalR>=r.ranked.baseline.at(-1).totalR);
});
