import test from 'node:test';
import assert from 'node:assert/strict';
import {runFibLevelBot,FIB_LEVEL_BOT_V1} from '../fib-level-bot-v1.js';

const bar=(t,o,h,l,c)=>({t:t*60_000,o,h,l,c});

test('V1 constants are locked and research-only',()=>{
  assert.deepEqual(FIB_LEVEL_BOT_V1.ratios,[.382,.5,.618,.786]);
  assert.equal(FIB_LEVEL_BOT_V1.pivotBars,3);
  assert.equal(FIB_LEVEL_BOT_V1.minLegAtr,1.5);
  const r=runFibLevelBot([]);
  assert.equal(r.researchOnly,true);assert.equal(r.executionImpact,false);
});

test('pivot cannot create a setup before three right bars close',()=>{
  const xs=[];for(let i=0;i<20;i++)xs.push(bar(i,100,101,99,100));
  xs[8]=bar(8,100,101,90,95);xs[12]=bar(12,108,112,107,111);
  const before=runFibLevelBot(xs.slice(0,15),{symbol:'T',timeframe:'1h'});
  const after=runFibLevelBot(xs.slice(0,16),{symbol:'T',timeframe:'1h'});
  assert.equal(before.opportunity.setups,0);
  assert.equal(after.opportunity.setups,1);
});

test('same-candle FIB fill and stop resolves at stop',()=>{
  const xs=[];for(let i=0;i<20;i++)xs.push(bar(i,100,101,99,100));
  xs[8]=bar(8,100,101,90,95);xs[12]=bar(12,108,112,107,111);
  xs[16]=bar(16,105,106,89,90);
  const r=runFibLevelBot(xs,{symbol:'T',timeframe:'1h'});
  assert.equal(r.closed.length,1);
  assert.equal(r.closed[0].exit,'STOP_1.000');
  assert.ok(r.closed[0].netR<0);
});

test('each FIB level fills at most once inside one basket',()=>{
  const xs=[];for(let i=0;i<24;i++)xs.push(bar(i,100,101,99,100));
  xs[8]=bar(8,100,101,90,95);xs[12]=bar(12,108,112,107,111);
  xs[16]=bar(16,108,109,103,104);xs[17]=bar(17,104,108,103,107);xs[18]=bar(18,107,108,103,104);
  const r=runFibLevelBot(xs,{symbol:'T',timeframe:'1h'});
  const basket=r.open[0]||r.closed[0];
  assert.ok(basket);
  assert.equal(new Set(basket.fills.map(x=>x.ratio)).size,basket.fills.length);
});

test('LONG and SHORT maps are generated symmetrically',()=>{
  const up=[];for(let i=0;i<20;i++)up.push(bar(i,100,101,99,100));up[8]=bar(8,100,101,90,95);up[12]=bar(12,108,112,107,111);
  const down=up.map(x=>({t:x.t,o:202-x.o,h:202-x.l,l:202-x.h,c:202-x.c}));
  const a=runFibLevelBot(up,{symbol:'T',timeframe:'1h'}),b=runFibLevelBot(down,{symbol:'T',timeframe:'1h'});
  assert.equal((a.pending[0]||a.open[0])?.side,'LONG');assert.equal((b.pending[0]||b.open[0])?.side,'SHORT');
});
