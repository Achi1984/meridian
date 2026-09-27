import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPortfolioSnapshot, alignSeriesToSnapshot, portfolioConsistency, oneDayPerformance, pionexEquitySnapshot, holdingUsd } from '../portfolio-data-contract.js';

test('canonical snapshot sums live spot holdings plus Pionex equity once',()=>{
  const data={livePrices:{SOL:{price:100},BTC:{price:50000}},portfolio:{holdings:[{symbol:'SOL',quantity:2,venue:'Bitpanda'},{symbol:'BTC',quantity:.01,venue:'OKX'},{symbol:'USDT',quantity:999,price:1,venue:'Pionex'}],pionexEquityUsd:900}};
  const s=canonicalPortfolioSnapshot(data,123);
  assert.equal(s.spotUsd,700);
  assert.equal(s.tradingUsd,900);
  assert.equal(s.totalUsd,1600);
});

test('chart endpoint is replaced by canonical current total when timestamp is near',()=>{
  const s={timestamp:1_000_000,totalUsd:27783};
  const xs=alignSeriesToSnapshot([[100,27000],[900_000,28165]],s,{replaceWithinMs:200_000});
  assert.equal(xs.length,2);
  assert.equal(xs.at(-1)[1],27783);
  assert.equal(portfolioConsistency(xs,s).status,'OK');
});

test('chart endpoint is appended when history is stale',()=>{
  const s={timestamp:2_000_000,totalUsd:27783};
  const xs=alignSeriesToSnapshot([[100,27000],[900_000,28165]],s,{replaceWithinMs:60_000});
  assert.equal(xs.length,3);
  assert.equal(xs.at(-1)[0],2_000_000);
  assert.equal(xs.at(-1)[1],27783);
});

test('mismatch is explicit instead of silently accepted',()=>{
  const c=portfolioConsistency([[1,28165]],{totalUsd:27783},1);
  assert.equal(c.ok,false);
  assert.equal(c.deltaUsd,382);
  assert.equal(c.status,'PORTFOLIO_DATA_MISMATCH');
});

test('1d performance is derived from same adjusted basis',()=>{
  const p=oneDayPerformance(27783,28314);
  assert.equal(p.deltaUsd,-531);
  assert.equal(p.pct,-1.88);
});


test('Pionex equity snapshot preserves canonical private provenance',()=>{
  const direct=pionexEquitySnapshot({portfolio:{pionexEquityUsd:3123.45,pionexEquitySource:'KNOWN_SEED',pionexEquityUpdatedAt:'2026-09-27T20:00:00Z'}});
  assert.deepEqual(direct,{found:true,value:3123.45,source:'KNOWN_SEED',updatedAt:'2026-09-27T20:00:00Z'});
  const row=pionexEquitySnapshot({portfolio:{manualVenueBalances:[{venue:'Pionex',valueUsd:2999,source:'MANUAL_SNAPSHOT',updatedAt:'2026-09-26T10:00:00Z'}]}});
  assert.deepEqual(row,{found:true,value:2999,source:'MANUAL_SNAPSHOT',updatedAt:'2026-09-26T10:00:00Z'});
  assert.deepEqual(pionexEquitySnapshot({}),{found:false,value:0,source:'MISSING',updatedAt:null});
});


test('missing holding quantity never coerces to zero over a stored USD value',()=>{
  assert.equal(holdingUsd({livePrices:{BTC:{price:80000}}},{symbol:'BTC',quantity:null,valueUsd:1234.56}),1234.56);
  assert.equal(holdingUsd({livePrices:{BTC:{price:80000}}},{symbol:'BTC',quantity:'',value:'',usdValue:987.65}),987.65);
  assert.equal(holdingUsd({livePrices:{BTC:{price:80000}}},{symbol:'BTC',quantity:0,valueUsd:1234.56}),0);
});
