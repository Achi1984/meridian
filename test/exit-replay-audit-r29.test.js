import test from 'node:test';
import assert from 'node:assert/strict';
import {replayExitCohort,replayExitLabForLedgers} from '../exit-lab-replay.js';
import {simulateExitModel} from '../exit-lab.js';
const t={symbol:'BTCUSDT',side:'LONG',entry:100,sl:90,tp1:110,tp2:120,openedAt:1500};
const zero={feeBps:0,slippageBps:0};
test('entry candle cannot supply extrema that preceded an intrabar entry',()=>{
 const market={BTCUSDT:{'15m':[{openTime:1000,closeTime:1999,open:100,high:120,low:80,close:100},{openTime:2000,closeTime:2999,open:100,high:111,low:99,close:110}]}};
 const x=replayExitCohort([t],market,{...zero,end:3000});assert.equal(x.replayedTrades,0);assert.equal(x.excludedEntryBars,1);
});
test('unknown opening timestamp fails closed instead of implying causal coverage',()=>{
 const x=replayExitCohort([t],{BTCUSDT:{'15m':[{closeTime:2000,high:111,low:99,close:110}]}},{end:3000});assert.equal(x.noCandles,1);assert.equal(x.replayedTrades,0);
});
test('no market coverage produces no ranked exit policy',()=>{
 const x=replayExitLabForLedgers({ledgers:{challenger:[t]},market:{},end:3000});
 assert.deepEqual(x.ranked.challenger,[]);
});
test('gap through stop fills at worse open for LONG and SHORT',()=>{
 const long=simulateExitModel(t,[{open:85,high:88,low:84,close:87}],'A_CURRENT',zero);assert.equal(long.realizedR,-1.5);assert.equal(long.runnerExit,85);assert.equal(long.gapStops,1);
 const short=simulateExitModel({...t,side:'SHORT',sl:110,tp1:90,tp2:80},[{open:115,high:116,low:112,close:113}],'A_CURRENT',zero);assert.equal(short.realizedR,-1.5);assert.equal(short.runnerExit,115);
});
test('same-bar stop and target remains explicitly ambiguous with stop-first convention',()=>{
 const x=simulateExitModel(t,[{open:100,high:112,low:89,close:110}],'A_CURRENT',zero);assert.equal(x.realizedR,-1);assert.equal(x.ambiguousBars,1);
});
