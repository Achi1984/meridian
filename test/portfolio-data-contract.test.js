import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPortfolioSnapshot, alignSeriesToSnapshot, portfolioConsistency, oneDayPerformance } from '../portfolio-data-contract.js';

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
