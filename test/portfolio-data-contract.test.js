import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { canonicalPortfolioSnapshot, alignSeriesToSnapshot, portfolioConsistency, oneDayPerformance, pionexEquitySnapshot, authoritativePionexEquitySnapshot, holdingUsd, latestPortfolioHistorySnapshot, portfolioPriceCoverage, sourceTimestampAge, SPOT_PRICE_AUTHORITY_MAX_AGE_MS } from '../portfolio-data-contract.js';

function historySpotProvenance(captureAt,fetchedAt){
  return{version:'SPOT_PRICE_PROVENANCE_V1',captureAt,status:'COMPLETE',requiredSymbols:['BTC'],symbols:{BTC:{price:100,source:'BINANCE_SPOT',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt,providerObservedAt:null,valid:true}}};
}

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
    {timestamp:1_000_000,spotUsd:100,tradingUsd:20,totalUsd:120,sourceStatus:{...authority,tradingUpdatedAt:950_000,tradingSource:'PIONEX_WALLET_READ_API',spotPriceProvenance:historySpotProvenance(1_000_000,950_000)}},
    {timestamp:1_950_000,spotUsd:110,tradingUsd:25,totalUsd:135,sourceStatus:{...authority,tradingUpdatedAt:1_900_000,tradingSource:'PIONEX_WALLET_READ_API',spotPriceProvenance:historySpotProvenance(1_950_000,1_900_000)}}
  ]},now,100_000);
  assert.equal(fresh.found,true);
  assert.equal(fresh.fresh,true);
  assert.equal(fresh.totalUsd,135);
  const stale=latestPortfolioHistorySnapshot({points:[{timestamp:1_000_000,spotUsd:100,tradingUsd:20,totalUsd:120,sourceStatus:{...authority,tradingUpdatedAt:950_000,tradingSource:'PIONEX_WALLET_READ_API',spotPriceProvenance:historySpotProvenance(1_000_000,950_000)}}]},now,100_000);
  assert.equal(stale.fresh,false);
  const incompleteLegacy=latestPortfolioHistorySnapshot({points:[{timestamp:1_950_000,spotUsd:100,tradingUsd:20,totalUsd:120,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY'}}]},now,100_000);
  assert.equal(incompleteLegacy.found,false);
  const inconsistent=latestPortfolioHistorySnapshot({points:[{timestamp:1_950_000,spotUsd:100,tradingUsd:20,totalUsd:999,sourceStatus:{...authority,tradingUpdatedAt:1_900_000,tradingSource:'PIONEX_WALLET_READ_API',spotPriceProvenance:historySpotProvenance(1_950_000,1_900_000)}}]},now,100_000);
  assert.equal(inconsistent.consistent,false);
  assert.equal(inconsistent.fresh,false);
});


test('portfolio price coverage distinguishes complete, partial and fallback valuation',()=>{
  const base={portfolio:{holdings:[
    {symbol:'BTC',venue:'Ledger',quantity:1},
    {symbol:'USDC',venue:'OKX',quantity:100}
  ]}};
  const complete=portfolioPriceCoverage({...base,livePrices:{BTC:{price:100,source:'BINANCE_SPOT',ts:1900},USDC:{price:1,source:'BINANCE_SPOT',ts:1900}},livePriceMeta:{fresh:true,requestedCount:2,resolvedCount:2}},2000);
  assert.deepEqual({complete:complete.complete,partial:complete.partial,requested:complete.requested,resolved:complete.resolved},{complete:true,partial:false,requested:2,resolved:2});
  const partial=portfolioPriceCoverage({...base,livePrices:{BTC:{price:100,source:'BINANCE_SPOT',ts:1900}},livePriceMeta:{fresh:true,requestedCount:2,resolvedCount:1}},2000);
  assert.equal(partial.complete,false);
  assert.equal(partial.partial,true);
  const fallback=portfolioPriceCoverage({...base,livePrices:{BTC:{price:100},USDC:{price:1}},livePriceMeta:{fresh:true,requestedCount:2,resolvedCount:2}},2000);
  assert.equal(fallback.complete,false);
  assert.equal(fallback.partial,false);
});

test('spot price coverage rejects missing, future, and expired per-symbol fetch provenance',()=>{
  const base={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]}};
  const check=fetchedAt=>portfolioPriceCoverage({...base,livePrices:{BTC:{price:100,source:'BINANCE_SPOT',...(fetchedAt===undefined?{}:{ts:fetchedAt})}},livePriceMeta:{fresh:true}},1_000_000);
  assert.equal(check(999_999).complete,true);
  assert.equal(check(undefined).complete,false);
  assert.equal(check(1_000_001).missingSymbols[0].reason,'FETCH_TIME_FUTURE');
  assert.equal(check(1_000_000-SPOT_PRICE_AUTHORITY_MAX_AGE_MS-1).missingSymbols[0].reason,'FETCH_TIME_EXPIRED');
  const zero=portfolioPriceCoverage({...base,livePrices:{BTC:{price:0,source:'BINANCE_SPOT',ts:999}},livePriceMeta:{fresh:true}},1_000_000);
  assert.equal(zero.missingSymbols[0].reason,'PRICE_MISSING_OR_INVALID');
});

test('canonical snapshots reject whitespace symbols and trim-collisions without changing holding values',()=>{
  const quote={price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:999_999,providerObservedAt:null};
  const make=holdings=>({livePrices:{BTC:quote},livePriceMeta:{perSymbol:{BTC:{...quote}}},portfolio:{
    authorityMode:'STRICT_VENUE_SNAPSHOT',externalVenueSnapshotComplete:true,externalVenueExpectedVenues:['OKX'],requiredHoldingVenues:['Ledger'],
    holdings,manualVenueBalances:[{venue:'OKX',valueUsd:10,updatedAt:999_999}]
  }});
  for(const [label,holdings,expectedSpotUsd] of [
    ['whitespace symbol',[{symbol:' BTC ',quantity:1,price:1,venue:'Ledger',updatedAt:999_999}],11],
    ['trim collision',[{symbol:'BTC',quantity:1,price:1,venue:'Ledger',updatedAt:999_999},{symbol:' BTC ',quantity:1,price:1,venue:'Ledger',updatedAt:999_999}],111]
  ]){
    const data=make(holdings),original=structuredClone(data.portfolio.holdings),snapshot=canonicalPortfolioSnapshot(data,1_000_000);
    assert.equal(snapshot.spotUsd,expectedSpotUsd,label);
    assert.equal(snapshot.priceCoverage.complete,false,label);
    assert.equal(snapshot.spotAuthority.holdingsPricingComplete,false,label);
    assert.equal(snapshot.spotAuthority.complete,false,label);
    assert.deepEqual(data.portfolio.holdings,original,label);
    assert.equal(snapshot.priceCoverage.missingSymbols.some(x=>x.reason==='REQUIRED_SYMBOL_NONCANONICAL'),true,label);
  }
});

test('legacy R18 compatibility cannot launder explicit malformed price metadata',()=>{
  const base={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]},livePriceMeta:{fresh:true}};
  const coverage=entry=>portfolioPriceCoverage({...base,livePrices:{BTC:entry}},1_000_000);
  const original={price:100,source:'BINANCE_SPOT',ts:999_999};
  assert.equal(coverage(original).complete,true);
  for(const [label,fields] of [
    ['stale quality',{sourceQuality:'STALE'}],
    ['policy quality',{sourceQuality:'POLICY_ASSUMPTION'}],
    ['undefined quality',{sourceQuality:undefined}],
    ['null quality',{sourceQuality:null}],
    ['expired observation',{providerObservedAt:1_000_000-24*60*60*1000}],
    ['future observation',{providerObservedAt:1_000_001}],
    ['undefined observation',{providerObservedAt:undefined}],
    ['null observation',{providerObservedAt:null}]
  ])assert.equal(coverage({...original,...fields}).complete,false,label);
});

test('current app quotes identify local fetch time without claiming provider observation time',()=>{
  const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  assert.match(app,/updatedAt:ts,fetchedAt:ts,providerObservedAt:null,sourceQuality/);
  const d={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]},livePriceMeta:{fresh:false},livePrices:{BTC:{price:100,source:'Binance REST',status:'LIVE',updatedAt:999,fetchedAt:999,providerObservedAt:null,sourceQuality:'PUBLIC_LIVE_FETCH'}}};
  assert.equal(portfolioPriceCoverage(d,1000).complete,true);
  const legacy={...d,livePriceMeta:{fresh:true},livePrices:{BTC:{price:100,source:'Binance REST',status:'LIVE',updatedAt:999}}};
  assert.equal(portfolioPriceCoverage(legacy,1000).complete,false);
  const fallback={...d,livePrices:{BTC:{price:100,source:'CoinGecko REST',status:'FALLBACK',updatedAt:999,fetchedAt:999,providerObservedAt:null,sourceQuality:'PUBLIC_FALLBACK_FETCH'}}};
  assert.equal(portfolioPriceCoverage(fallback,1000).complete,true);
});

test('provider observation time is validated independently from local fetch time',()=>{
  const entry={price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:999,providerObservedAt:1001};
  const data={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]},livePriceMeta:{perSymbol:{BTC:{...entry}}},livePrices:{BTC:{...entry}}};
  const coverage=portfolioPriceCoverage(data,1000);
  assert.equal(coverage.complete,false);
  assert.equal(coverage.missingSymbols[0].reason,'OBSERVATION_TIME_INVALID_OR_STALE');
});

test('spot provenance requires typed closed metadata bound to the exact accepted mark',()=>{
  const data={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}]},livePriceMeta:{fresh:true},livePrices:{BTC:{price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:999,providerObservedAt:null}}};
  const withRecord=(mutate,entry=data.livePrices.BTC)=>{
    const record={price:entry.price,source:entry.source,sourceQuality:entry.sourceQuality,fetchedAt:entry.fetchedAt,providerObservedAt:entry.providerObservedAt};
    mutate(record);
    return{...data,livePrices:{BTC:entry},livePriceMeta:{fresh:true,perSymbol:{BTC:record}}};
  };
  assert.equal(portfolioPriceCoverage(withRecord(()=>{}),1000).complete,true);
  for(const [label,mutate] of [
    ['missing source',x=>delete x.source],
    ['null source',x=>{x.source=null}],
    ['undefined source',x=>{x.source=undefined}],
    ['wrong source type',x=>{x.source=42}],
    ['missing quality',x=>delete x.sourceQuality],
    ['null quality',x=>{x.sourceQuality=null}],
    ['undefined quality',x=>{x.sourceQuality=undefined}],
    ['wrong quality type',x=>{x.sourceQuality=42}],
    ['unsupported quality',x=>{x.sourceQuality='STALE'}],
    ['policy quality',x=>{x.source='STABLE_VALUE_POLICY';x.sourceQuality='POLICY_ASSUMPTION'}],
    ['missing fetched time',x=>delete x.fetchedAt],
    ['null fetched time',x=>{x.fetchedAt=null}],
    ['undefined fetched time',x=>{x.fetchedAt=undefined}],
    ['wrong fetched time type',x=>{x.fetchedAt='999'}],
    ['mismatched value',x=>{x.price=101}]
  ])assert.equal(portfolioPriceCoverage(withRecord(mutate),1000).complete,false,label);
  const mismatch={...data,livePriceMeta:{perSymbol:{BTC:{price:101,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:999,providerObservedAt:null}}}};
  assert.equal(portfolioPriceCoverage(mismatch,1000).complete,false);
});

test('canonical snapshot exposes valuation provenance without changing Spot + Pionex math',()=>{
  const d={portfolio:{holdings:[{symbol:'BTC',venue:'Ledger',quantity:1}],pionexEquityUsd:50,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT'},livePrices:{BTC:{price:100,source:'BINANCE_SPOT',ts:100}},livePriceMeta:{fresh:true,requestedCount:1,resolvedCount:1}};
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
