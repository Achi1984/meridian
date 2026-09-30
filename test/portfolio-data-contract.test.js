import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPortfolioSnapshot, alignSeriesToSnapshot, portfolioConsistency, oneDayPerformance, pionexEquitySnapshot, authoritativePionexEquitySnapshot, holdingUsd, latestPortfolioHistorySnapshot, portfolioPriceCoverage, sourceTimestampAge } from '../portfolio-data-contract.js';

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


test('latest canonical history point must be fresh, internally consistent, and provenance-complete',()=>{
  const now=2_000_000,authority={spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1'};
  const fresh=latestPortfolioHistorySnapshot({source:'POSTGRES_CANONICAL_HISTORY',points:[
    {timestamp:1_000_000,spotUsd:100,tradingUsd:20,totalUsd:120,sourceStatus:{...authority,tradingUpdatedAt:950_000,tradingSource:'PIONEX_WALLET_READ_API'}},
    {timestamp:1_950_000,spotUsd:110,tradingUsd:25,totalUsd:135,sourceStatus:{...authority,tradingUpdatedAt:1_900_000,tradingSource:'PIONEX_WALLET_READ_API'}}
  ]},now,100_000);
  assert.equal(fresh.found,true);
  assert.equal(fresh.fresh,true);
  assert.equal(fresh.totalUsd,135);
  const stale=latestPortfolioHistorySnapshot({points:[{timestamp:1_000_000,spotUsd:100,tradingUsd:20,totalUsd:120,sourceStatus:{...authority,tradingUpdatedAt:950_000,tradingSource:'PIONEX_WALLET_READ_API'}}]},now,100_000);
  assert.equal(stale.fresh,false);
  const incompleteLegacy=latestPortfolioHistorySnapshot({points:[{timestamp:1_950_000,spotUsd:100,tradingUsd:20,totalUsd:120,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY'}}]},now,100_000);
  assert.equal(incompleteLegacy.found,false);
  const inconsistent=latestPortfolioHistorySnapshot({points:[{timestamp:1_950_000,spotUsd:100,tradingUsd:20,totalUsd:999,sourceStatus:{...authority,tradingUpdatedAt:1_900_000,tradingSource:'PIONEX_WALLET_READ_API'}}]},now,100_000);
  assert.equal(inconsistent.consistent,false);
  assert.equal(inconsistent.fresh,false);
});


test('portfolio price coverage distinguishes complete, partial and fallback valuation',()=>{
  const base={portfolio:{holdings:[
    {symbol:'BTC',venue:'Ledger',quantity:1},
    {symbol:'USDC',venue:'OKX',quantity:100}
  ]}};
  const complete=portfolioPriceCoverage({...base,livePriceMeta:{fresh:true,requestedCount:2,resolvedCount:2}});
  assert.deepEqual({complete:complete.complete,partial:complete.partial,requested:complete.requested,resolved:complete.resolved},{complete:true,partial:false,requested:2,resolved:2});
  const partial=portfolioPriceCoverage({...base,livePriceMeta:{fresh:true,requestedCount:2,resolvedCount:1}});
  assert.equal(partial.complete,false);
  assert.equal(partial.partial,true);
  const fallback=portfolioPriceCoverage({...base,livePriceMeta:{fresh:false,requestedCount:2,resolvedCount:0}});
  assert.equal(fallback.complete,false);
  assert.equal(fallback.partial,false);
});

test('canonical snapshot exposes valuation provenance without changing Spot + Pionex math',()=>{
  const d={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}],pionexEquityUsd:50,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT'},livePrices:{BTC:{price:100}},livePriceMeta:{fresh:true,requestedCount:1,resolvedCount:1}};
  const snap=canonicalPortfolioSnapshot(d,123);
  assert.equal(snap.totalUsd,150);
  assert.equal(snap.priceCoverage.complete,true);
  assert.equal(snap.sourceDetail.spot,'LIVE_PRICE_COMPLETE');
  assert.equal(snap.sourceDetail.trading,'PRIVATE_PORTFOLIO_SNAPSHOT');
});


test('source timestamp age is explicit, missing-aware and future-aware',()=>{
  const now=Date.parse('2026-09-27T21:00:00Z');
  const known=sourceTimestampAge('2026-09-27T20:00:00Z',now);
  assert.equal(known.known,true);
  assert.equal(known.future,false);
  assert.equal(known.ageMs,60*60*1000);
  const missing=sourceTimestampAge(null,now);
  assert.deepEqual(missing,{known:false,future:false,timestampMs:null,ageMs:null});
  const future=sourceTimestampAge('2026-09-27T21:02:00Z',now);
  assert.equal(future.known,true);
  assert.equal(future.future,true);
});

test('Pionex equity snapshot never borrows generic privateUpdatedAt as its own timestamp',()=>{
  const direct=pionexEquitySnapshot({privateUpdatedAt:'2026-09-27T21:00:00Z',portfolio:{pionexEquityUsd:1234,pionexEquitySource:'PORTFOLIO_EQUITY'}});
  assert.equal(direct.found,true);
  assert.equal(direct.updatedAt,null);
  const venue=pionexEquitySnapshot({privateUpdatedAt:'2026-09-27T21:00:00Z',portfolio:{manualVenueBalances:[{venue:'Pionex',valueUsd:1234,updatedAt:'2026-09-20T00:00:00Z'}]}});
  assert.equal(venue.updatedAt,'2026-09-20T00:00:00Z');
});


test('authoritative Pionex equity prefers fresh wallet API over stale or zero portfolio seed',()=>{
  const now=Date.parse('2026-09-30T21:00:00Z');
  const d={
    portfolio:{pionexEquityUsd:0,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:'2026-09-30T20:20:00Z'},
    pionexAccountSync:{status:'OK'},
    pionexAccount:{walletStatus:'OK',updatedAt:'2026-09-30T20:59:00Z',wallet:{totalInUsdt:34402.17}}
  };
  const out=authoritativePionexEquitySnapshot(d,now);
  assert.equal(out.found,true);
  assert.equal(out.fresh,true);
  assert.equal(out.value,34402.17);
  assert.equal(out.source,'PIONEX_WALLET_READ_API');
});

test('authoritative Pionex equity fails closed on untimed or stale private values',()=>{
  const now=Date.parse('2026-09-30T21:00:00Z');
  const untimed=authoritativePionexEquitySnapshot({portfolio:{pionexEquityUsd:34402.17,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT'}},now);
  assert.equal(untimed.found,false);
  const stale=authoritativePionexEquitySnapshot({portfolio:{pionexEquityUsd:34402.17,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:'2026-09-30T20:30:00Z'}},now);
  assert.equal(stale.found,false);
});

test('authoritative Pionex equity accepts a fresh timestamped private authority when wallet read is unavailable',()=>{
  const now=Date.parse('2026-09-30T21:00:00Z');
  const out=authoritativePionexEquitySnapshot({portfolio:{pionexEquityUsd:1234.5,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:'2026-09-30T20:58:00Z'}},now);
  assert.equal(out.found,true);
  assert.equal(out.fresh,true);
  assert.equal(out.value,1234.5);
  assert.equal(out.source,'PRIVATE_PORTFOLIO_SNAPSHOT');
});
