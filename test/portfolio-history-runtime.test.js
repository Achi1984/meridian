import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePortfolioHistoryOnce, mergeRuntimePrices } from '../portfolio-history-runtime.js';
import { SPOT_PRICE_AUTHORITY_MAX_AGE_MS } from '../portfolio-data-contract.js';
import { canonicalHistoryPointComplete } from '../portfolio-history-store.js';

const NOW=Date.parse('2026-10-28T04:00:00Z');
function dataFor(symbols=['BTC']){
  return{
    livePrices:Object.fromEntries(symbols.map(symbol=>[symbol,{price:100}])),
    livePriceMeta:{fresh:true,updatedAt:NOW},
    portfolio:{
      ledgerAuthorityAt:NOW-1000,
      holdings:symbols.map(symbol=>({symbol,quantity:1,venue:'Ledger',updatedAt:NOW-1000})),
      manualVenueBalances:[{venue:'OKX',valueUsd:20,updatedAt:NOW-1000}],
      pionexEquityUsd:30,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:NOW-1000
    }
  };
}
function fakeDb(existing=[]){
  const calls=[];let insertArgs=null;
  return{calls,get insertArgs(){return insertArgs},query:async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT captured_at'))return{rows:existing};if(sql.startsWith('INSERT INTO'))insertArgs=args;return{rows:[]}}};
}

test('runtime prices normalize wrapped assets and attach fetch rather than observation provenance',()=>{
  const data={livePrices:{},portfolio:{holdings:[{symbol:'OKSOL',quantity:3,venue:'OKX'},{symbol:'BETH',quantity:2,venue:'OKX'},{symbol:'BTC',quantity:1,venue:'Ledger'}]}};
  const out=mergeRuntimePrices(data,{SOL:20,ETH:30,BTC:100},{fetchedAt:123,attemptAt:124});
  assert.equal(out.livePrices.OKSOL.price,20);
  assert.equal(out.livePrices.BETH.price,30);
  assert.equal(out.livePrices.BTC.price,100);
  assert.equal(out.livePrices.OKSOL.ts,123);
  assert.equal(out.livePriceMeta.perSymbol.OKSOL.providerObservedAt,null);
  assert.equal(out.livePriceMeta.fresh,true);
  assert.equal(data.livePrices.OKSOL,undefined);
});

test('a failed price fetch cannot freshen retained positive legacy prices or admit a complete point',async()=>{
  const data=dataFor(),before=structuredClone(data.livePrices),db=fakeDb();
  const merged=mergeRuntimePrices(data,{}, {attemptAt:NOW,fetchSucceeded:false,fetchReason:'feed_unavailable'});
  assert.equal(merged.livePriceMeta.fresh,false);
  assert.equal(merged.livePriceMeta.updatedAt,NOW);
  assert.deepEqual(merged.livePrices,before);
  assert.equal(merged.livePriceMeta.perSymbol?.BTC,undefined);
  const out=await capturePortfolioHistoryOnce({db,data,fetchPrices:async()=>{throw new Error('feed_unavailable')},now:()=>NOW,timestamp:NOW});
  assert.equal(out.ok,false);
  assert.equal(out.reason,'PORTFOLIO_AUTHORITY_INCOMPLETE');
  assert.equal(out.priceStatus,'STORED_PRICE_FALLBACK');
  assert.equal(out.priceReason,'PRICE_FETCH_FAILED');
  assert.deepEqual(out.snapshot.sourceStatus.spotPriceProvenance.requiredSymbols,['BTC']);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.status,'INCOMPLETE');
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.fetchReason,'PRICE_FETCH_FAILED');
  assert.deepEqual(data.livePrices,before);
  assert.equal(data.livePriceMeta.updatedAt,NOW);
  assert.equal(data.livePriceMeta.fresh,true);
  assert.equal(data.livePriceMeta.perSymbol?.BTC,undefined);
  assert.equal(db.calls.some(sql=>sql.startsWith('INSERT INTO')),false);
});

test('a partial symbol response retains the missing mark and refuses a complete point',async()=>{
  const data=dataFor(['BTC','ETH']),db=fakeDb();
  data.livePrices.ETH={price:200,source:'OLD_FEED'};
  const out=await capturePortfolioHistoryOnce({db,data,prices:{BTC:110},now:()=>NOW,timestamp:NOW});
  assert.equal(out.ok,false);
  assert.equal(out.priceStatus,'PARTIAL');
  assert.equal(out.snapshot.spotAuthorityComplete,false);
  assert.equal(data.livePrices.BTC.price,100);
  assert.equal(data.livePrices.ETH.price,200);
  assert.equal(data.livePrices.ETH.source,'OLD_FEED');
  assert.equal(data.livePriceMeta.perSymbol?.BTC,undefined);
  assert.equal(data.livePriceMeta.fetchStatus,undefined);
  assert.equal(data.livePriceMeta.fresh,true);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.price,110);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.fetchStatus,'PARTIAL');
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.valid,true);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.ETH.reason,'PROVENANCE_MISSING_OR_UNSUPPORTED');
  assert.equal(db.calls.some(sql=>sql.startsWith('INSERT INTO')),false);
});

test('capture rejects future and expired per-symbol fetch times before store admission',async()=>{
  const futureData=dataFor(),futureDb=fakeDb();
  const future=await capturePortfolioHistoryOnce({db:futureDb,data:futureData,prices:{BTC:110},now:()=>NOW,timestamp:NOW-1});
  assert.equal(future.ok,false);
  assert.equal(future.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.reason,'FETCH_TIME_FUTURE');
  assert.equal(futureDb.calls.some(sql=>sql.startsWith('INSERT INTO')),false);

  const expiredData=dataFor(),expiredDb=fakeDb();
  const expiredAt=NOW-SPOT_PRICE_AUTHORITY_MAX_AGE_MS-1;
  expiredData.livePrices.BTC={price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:expiredAt,providerObservedAt:null};
  expiredData.livePriceMeta.perSymbol={BTC:{price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:expiredAt,providerObservedAt:null}};
  const expired=await capturePortfolioHistoryOnce({db:expiredDb,data:expiredData,fetchPrices:async()=>{throw new Error('feed_unavailable')},now:()=>NOW,timestamp:NOW});
  assert.equal(expired.ok,false);
  assert.equal(expired.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.reason,'FETCH_TIME_EXPIRED');
  assert.equal(expiredDb.calls.some(sql=>sql.startsWith('INSERT INTO')),false);
});

test('provider failure preserves a retained mark inside the freshness bound and rejects one just beyond it',async()=>{
  const makeData=fetchedAt=>{
    const data=dataFor(),quote={price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt,providerObservedAt:null};
    data.livePrices.BTC={...quote};
    data.livePriceMeta={fresh:true,fetchedAt,updatedAt:fetchedAt,perSymbol:{BTC:{...quote}}};
    return data;
  };
  const retainedAt=NOW-5*60*1000,data=makeData(retainedAt),db=fakeDb();
  const out=await capturePortfolioHistoryOnce({db,data,fetchPrices:async()=>{throw new Error('feed_unavailable')},now:()=>NOW,timestamp:NOW});
  assert.equal(out.ok,true);
  assert.equal(out.inserted,true);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.status,'COMPLETE');
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.fetchStatus,'FAILED');
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.fetchReason,'PRICE_FETCH_FAILED');
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.fetchedAt,retainedAt);
  assert.equal(data.livePriceMeta.fetchedAt,retainedAt);
  assert.equal(data.livePrices.BTC.fetchedAt,retainedAt);
  assert.equal(data.livePriceMeta.perSymbol.BTC.fetchedAt,retainedAt);
  const storedSourceStatus=JSON.parse(db.insertArgs[7]);
  assert.equal(storedSourceStatus.spotPriceProvenance.fetchStatus,'FAILED');
  assert.equal(storedSourceStatus.spotPriceProvenance.fetchReason,'PRICE_FETCH_FAILED');
  assert.equal(storedSourceStatus.spotPriceProvenance.symbols.BTC.fetchedAt,retainedAt);
  assert.equal(canonicalHistoryPointComplete({timestamp:NOW,spotUsd:out.snapshot.spotUsd,tradingUsd:out.snapshot.tradingUsd,totalUsd:out.snapshot.totalUsd,sourceStatus:storedSourceStatus}),true);

  const expiredAt=NOW-SPOT_PRICE_AUTHORITY_MAX_AGE_MS-1,expiredData=makeData(expiredAt),expiredDb=fakeDb();
  const expired=await capturePortfolioHistoryOnce({db:expiredDb,data:expiredData,fetchPrices:async()=>{throw new Error('feed_unavailable')},now:()=>NOW,timestamp:NOW});
  assert.equal(expired.ok,false);
  assert.equal(expired.snapshot.sourceStatus.spotPriceProvenance.status,'INCOMPLETE');
  assert.equal(expired.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.reason,'FETCH_TIME_EXPIRED');
  assert.equal(expired.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.fetchedAt,expiredAt);
  assert.equal(expiredData.livePriceMeta.fetchedAt,expiredAt);
  assert.equal(expiredDb.calls.some(sql=>sql.startsWith('INSERT INTO')),false);
});

test('capture never admits whitespace or trim-colliding holding symbols',async()=>{
  for(const [label,symbols,expectedSpotUsd] of [
    ['whitespace symbol',[' BTC '],11],
    ['trim collision',['BTC',' BTC '],121]
  ]){
    const data=dataFor(symbols),db=fakeDb();
    data.portfolio.manualVenueBalances[0].valueUsd=10;
    for(const holding of data.portfolio.holdings)holding.price=1;
    const quote={price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:NOW-10,providerObservedAt:null};
    data.livePrices={BTC:{...quote}};
    data.livePriceMeta={fresh:true,perSymbol:{BTC:{...quote}}};
    const originalSymbols=data.portfolio.holdings.map(h=>h.symbol);
    const out=await capturePortfolioHistoryOnce({db,data,prices:{BTC:110},now:()=>NOW,timestamp:NOW});
    assert.equal(out.ok,false,label);
    assert.equal(out.snapshot.spotUsd,expectedSpotUsd,label);
    assert.equal(out.snapshot.spotAuthorityComplete,false,label);
    assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.status,'INCOMPLETE',label);
    if(symbols.includes('BTC')){
      assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.valid,true,label);
      assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.price,110,label);
    }else assert.deepEqual(out.snapshot.sourceStatus.spotPriceProvenance.symbols,{},label);
    assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols[' BTC '],undefined,label);
    assert.deepEqual(data.portfolio.holdings.map(h=>h.symbol),originalSymbols,label);
    assert.equal(db.calls.some(sql=>sql.startsWith('INSERT INTO')),false,label);
  }
});

test('capture rejects malformed, unsupported, or mismatched per-symbol provenance',async()=>{
  const baseline={price:100,source:'BINANCE_PUBLIC_HISTORY_CAPTURE',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:NOW-10,providerObservedAt:null};
  const cases=[
    ['missing source',record=>{delete record.source}],
    ['null source',record=>{record.source=null}],
    ['undefined source',record=>{record.source=undefined}],
    ['wrong source type',record=>{record.source=42}],
    ['missing quality',record=>{delete record.sourceQuality}],
    ['null quality',record=>{record.sourceQuality=null}],
    ['undefined quality',record=>{record.sourceQuality=undefined}],
    ['wrong quality type',record=>{record.sourceQuality=42}],
    ['unsupported stale quality',record=>{record.sourceQuality='STALE'}],
    ['unsupported fallback label',record=>{record.sourceQuality='FALLBACK'}],
    ['policy assumption',record=>{record.source='STABLE_VALUE_POLICY';record.sourceQuality='POLICY_ASSUMPTION'}],
    ['missing fetch time',record=>{delete record.fetchedAt}],
    ['null fetch time',record=>{record.fetchedAt=null}],
    ['undefined fetch time',record=>{record.fetchedAt=undefined}],
    ['wrong fetch time type',record=>{record.fetchedAt=String(NOW-10)}],
    ['wrong observation time type',record=>{record.providerObservedAt='unknown'}],
    ['mismatched price',record=>{record.price=101}]
  ];
  for(const [label,mutate] of cases){
    const data=dataFor(),db=fakeDb(),record={...baseline};
    mutate(record);
    data.livePrices.BTC={...baseline};
    data.livePriceMeta.perSymbol={BTC:record};
    const out=await capturePortfolioHistoryOnce({db,data,prices:{},now:()=>NOW,timestamp:NOW});
    assert.equal(out.ok,false,label);
    assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.valid,false,label);
    assert.equal(db.calls.some(sql=>sql.startsWith('INSERT INTO')),false,label);
  }
});

test('fetch failure diagnostics never expose raw provider exception content',async()=>{
  const data=dataFor(),db=fakeDb(),sentinel='secret://provider/<payload> DO_NOT_PERSIST';
  const original=console.error,logs=[];
  console.error=(...args)=>logs.push(args.join(' '));
  try{
    const out=await capturePortfolioHistoryOnce({db,data,fetchPrices:async()=>{throw new Error(sentinel)},now:()=>NOW,timestamp:NOW});
    assert.equal(out.priceReason,'PRICE_FETCH_FAILED');
    assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.fetchReason,'PRICE_FETCH_FAILED');
    assert.doesNotMatch(JSON.stringify(out),/secret:\/\/provider|DO_NOT_PERSIST|<payload>/);
    assert.doesNotMatch(logs.join(' '),/secret:\/\/provider|DO_NOT_PERSIST|<payload>/);
  }finally{console.error=original}
});

test('complete fetched prices insert with source and fetch times while preserving authoritative equity',async()=>{
  const data=dataFor(['BTC','ETH']),db=fakeDb();
  let tick=NOW-1;
  const out=await capturePortfolioHistoryOnce({db,data,prices:{BTC:110,ETH:210},now:()=>tick++,timestamp:NOW});
  assert.equal(out.ok,true);
  assert.equal(out.inserted,true);
  assert.equal(out.snapshot.spotUsd,340);
  assert.equal(out.snapshot.tradingUsd,30);
  assert.equal(out.snapshot.totalUsd,370);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.status,'COMPLETE');
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.providerObservedAt,null);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.symbols.BTC.fetchedAt,NOW-1);
  assert.equal(db.calls.some(sql=>sql.startsWith('INSERT INTO')),true);
  const storedSourceStatus=JSON.parse(db.insertArgs[7]);
  assert.deepEqual(storedSourceStatus.spotPriceProvenance,out.snapshot.sourceStatus.spotPriceProvenance);
  assert.equal(canonicalHistoryPointComplete({timestamp:NOW,spotUsd:out.snapshot.spotUsd,tradingUsd:out.snapshot.tradingUsd,totalUsd:out.snapshot.totalUsd,sourceStatus:storedSourceStatus}),true);
});

test('no required spot holdings preserve complete independent venue and trading authorities',async()=>{
  const data=dataFor([]);
  data.portfolio.manualVenueBalances.push({venue:'Ledger',valueUsd:100,updatedAt:NOW-1000});
  const db=fakeDb(),out=await capturePortfolioHistoryOnce({db,data,prices:{},now:()=>NOW,timestamp:NOW});
  assert.equal(out.ok,true);
  assert.equal(out.inserted,true);
  assert.equal(out.snapshot.spotUsd,120);
  assert.equal(out.snapshot.tradingUsd,30);
  assert.equal(out.snapshot.authorityComplete,true);
  assert.equal(out.snapshot.sourceStatus.spotPriceProvenance.status,'NO_REQUIRED_SYMBOLS');
});
