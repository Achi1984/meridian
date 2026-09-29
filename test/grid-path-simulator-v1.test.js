import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_PATH_SIMULATOR_V1_RULESET,
  buildGridLevels,
  crossSegment,
  traceGridCrossings,
  tracePathEnvelope,
  validateMinuteBars
} from '../research/grid-path-simulator-v1.js';

const bar=(t,o,h,l,c)=>({openTime:t,closeTime:t+59999,open:o,high:h,low:l,close:c});

test('geometric and arithmetic grids are explicit and monotonic',()=>{
  const g=buildGridLevels({center:100,stepPct:.1,halfLevels:2,mode:'GEOMETRIC'});
  assert.equal(g.length,5);
  assert.ok(Math.abs(g[2]-100)<1e-12);
  assert.ok(Math.abs(g[3]-110)<1e-12);
  assert.ok(Math.abs(g[1]-100/1.1)<1e-12);
  const a=buildGridLevels({center:100,stepPct:.1,halfLevels:2,mode:'ARITHMETIC'});
  assert.deepEqual(a,[80,90,100,110,120]);
});

test('upward segment emits every crossed level once in ascending order',()=>{
  const levels=[80,90,100,110,120],r=crossSegment({start:100,end:125,levels,currentIndex:2});
  assert.deepEqual(r.events.map(x=>[x.side,x.price]),[['SELL',110],['SELL',120]]);
  assert.equal(r.currentIndex,4);
});

test('downward segment emits every crossed level once in descending order',()=>{
  const levels=[80,90,100,110,120],r=crossSegment({start:100,end:75,levels,currentIndex:2});
  assert.deepEqual(r.events.map(x=>[x.side,x.price]),[['BUY',90],['BUY',80]]);
  assert.equal(r.currentIndex,0);
});

test('shared segment endpoints do not double-count a grid crossing',()=>{
  const levels=[80,90,100,110,120];
  const a=crossSegment({start:100,end:110,levels,currentIndex:2});
  const b=crossSegment({start:110,end:120,levels,currentIndex:a.currentIndex});
  assert.deepEqual([...a.events,...b.events].map(x=>x.price),[110,120]);
});

test('the two allowed intrabar paths expose ordering sensitivity deterministically',()=>{
  const levels=[80,90,100,110,120],bars=[bar(0,100,120,80,100)];
  const e=tracePathEnvelope({bars,levels,currentIndex:2});
  assert.equal(e.PAPER_OLHC.ruleset,GRID_PATH_SIMULATOR_V1_RULESET);
  assert.notDeepEqual(e.PAPER_OLHC.events.map(x=>x.side+':'+x.price),e.ALT_OHLC.events.map(x=>x.side+':'+x.price));
  assert.deepEqual(e.PAPER_OLHC.events.map(x=>x.side+':'+x.price),['BUY:90','BUY:80','SELL:90','SELL:100','SELL:110','SELL:120','BUY:110','BUY:100']);
  assert.deepEqual(e.ALT_OHLC.events.map(x=>x.side+':'+x.price),['SELL:110','SELL:120','BUY:110','BUY:100','BUY:90','BUY:80','SELL:90','SELL:100']);
});

test('minute gaps and invalid OHLC fail closed',()=>{
  assert.throws(()=>validateMinuteBars([bar(0,100,101,99,100),bar(180000,100,101,99,100)]),/gap/);
  assert.throws(()=>validateMinuteBars([{openTime:0,closeTime:59999,open:100,high:99,low:98,close:100}]),/inconsistent/);
});

test('crossing replay remains research-only and has no wallet/PnL side effects',()=>{
  const r=traceGridCrossings({bars:[bar(0,100,111,99,109)],levels:[80,90,100,110,120],currentIndex:2});
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal('pnl' in r,false);
  assert.equal('cash' in r,false);
});
