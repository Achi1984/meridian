import test from 'node:test';
import assert from 'node:assert/strict';
import { historySnapshot, appendPortfolioHistory, readPortfolioHistory, normalizeHistoryRows, canonicalHistoryPointComplete } from '../portfolio-history-store.js';

function spotProvenance(captureAt,fetchedAt){return{version:'SPOT_PRICE_PROVENANCE_V1',captureAt,status:'COMPLETE',fetchStatus:'COMPLETE',fetchReason:null,requiredSymbols:['BTC'],symbols:{BTC:{price:100,source:'BINANCE_SPOT',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt,providerObservedAt:null,valid:true,reason:'FRESH'}}}}
function sample(){return{privateRevision:7,livePrices:{BTC:{price:100,source:'BINANCE_SPOT',ts:950},SOL:{price:20}},livePriceMeta:{source:'BINANCE_SPOT',fetchedAt:950},portfolio:{
  holdings:[{symbol:'BTC',quantity:2,venue:'Ledger',updatedAt:900},{symbol:'SOL',quantity:3,venue:'Pionex'}],
  manualVenueBalances:[{venue:'Ledger',valueUsd:200,updatedAt:900},{venue:'OKX',valueUsd:0,updatedAt:900}],
  pionexEquityUsd:50,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:900,cumulativeCashflowUsd:25
}}}

test('history snapshot persists canonical Spot + Pionex basis',()=>{
  const s=historySnapshot(sample(),{timestamp:1000});
  assert.equal(s.spotUsd,200);
  assert.equal(s.tradingUsd,50);
  assert.equal(s.totalUsd,250);
  assert.equal(s.cashflowAdjustedTotalUsd,225);
  assert.equal(s.spotAuthorityComplete,true);
  assert.equal(s.tradingAuthorityComplete,true);
  assert.equal(s.authorityComplete,true);
  assert.equal(s.sourceStatus.spot,'STRICT_AUTHORITY');
  assert.equal(s.sourceStatus.trading,'PIONEX_EQUITY');
  assert.equal(s.sourceStatus.tradingFresh,true);
  assert.equal(s.sourceStatus.tradingAuthorityVersion,'PIONEX_FRESH_V1');
  assert.equal(s.sourceStatus.tradingSource,'PRIVATE_PORTFOLIO_SNAPSHOT');
  assert.equal(s.sourceRevision,7);
});

test('unchanged value inside dedupe window does not create duplicate point',async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push([sql,args]);if(sql.startsWith('SELECT captured_at'))return{rows:[{captured_at:new Date(1000).toISOString(),spot_usd:200,trading_usd:50,total_usd:250,cashflow_adjusted_total_usd:225}]};return{rows:[]}}};
  const out=await appendPortfolioHistory(db,sample(),{timestamp:2000,dedupeMs:5000});
  assert.equal(out.ok,true);assert.equal(out.inserted,false);
  assert.equal(calls.length,1);
});

test('changed value inserts a canonical history point',async()=>{
  const calls=[];
  const db={query:async(sql,args)=>{calls.push([sql,args]);if(sql.startsWith('SELECT captured_at'))return{rows:[]};return{rows:[]}}};
  const out=await appendPortfolioHistory(db,sample(),{timestamp:2000});
  assert.equal(out.inserted,true);
  assert.equal(calls.length,2);
  assert.match(calls[1][0],/INSERT INTO meridian_portfolio_history/);
  assert.equal(calls[1][1][3],250);
});

test('history reader returns one basis with nullable adjusted value',async()=>{
  const timestamp=Date.parse('2026-09-04T20:00:00.000Z'),db={query:async()=>({rows:[{captured_at:'2026-09-04T20:00:00.000Z',spot_usd:'200',trading_usd:'50',total_usd:'250',cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:8,source_status:{spot:'STRICT_AUTHORITY',spotPriceProvenance:spotProvenance(timestamp,timestamp-60000),trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:'2026-09-04T19:59:00.000Z'}}]})};
  const out=await readPortfolioHistory(db,{now:Date.parse('2026-09-04T21:00:00Z'),rangeMs:3600000});
  assert.equal(out.points.length,1);assert.equal(out.points[0].totalUsd,250);assert.equal(out.points[0].cashflowAdjustedTotalUsd,null);
});

test('row normalization preserves timestamp and components',()=>{
  const x=normalizeHistoryRows([{captured_at:'2026-09-04T20:00:00Z',spot_usd:10,trading_usd:2,total_usd:12,cashflow_adjusted_total_usd:11,cumulative_cashflow_usd:1,source_revision:3,source_status:{}}]);
  assert.equal(x[0].spotUsd,10);assert.equal(x[0].totalUsd,12);assert.equal(x[0].sourceRevision,3);
});


test('history capture fails closed when Pionex equity is missing even with complete Spot authority',async()=>{
  const calls=[];
  const data={privateRevision:8,livePrices:{BTC:{price:100,source:'BINANCE_SPOT',ts:950}},livePriceMeta:{fresh:true,source:'BINANCE_SPOT',fetchedAt:950},portfolio:{
    ledgerAuthorityAt:'1970-01-01T00:00:00.900Z',
    holdings:[{symbol:'BTC',quantity:2,venue:'Ledger',updatedAt:900}],
    manualVenueBalances:[{venue:'OKX',valueUsd:10,updatedAt:900}]
  }};
  const db={query:async(sql,args)=>{calls.push([sql,args]);return{rows:[]}}};
  const out=await appendPortfolioHistory(db,data,{timestamp:1000});
  assert.equal(out.ok,false);
  assert.equal(out.reason,'PORTFOLIO_AUTHORITY_INCOMPLETE');
  assert.equal(out.snapshot.spotAuthorityComplete,true);
  assert.equal(out.snapshot.tradingAuthorityComplete,false);
  assert.deepEqual(out.incompleteComponents,{spot:false,trading:true});
  assert.equal(calls.length,0);
});

test('history reader excludes legacy rows with missing trading authority without deleting audit evidence',async()=>{
  const rows=[
    {captured_at:'2026-09-04T20:00:00.000Z',spot_usd:'1798.71',trading_usd:'0',total_usd:'1798.71',cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:7,source_status:{spot:'STRICT_AUTHORITY',trading:'MISSING'}},
    {captured_at:'2026-09-04T20:05:00.000Z',spot_usd:'914.68',trading_usd:'34456.92',total_usd:'35371.6',cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:8,source_status:{spot:'STRICT_AUTHORITY',spotPriceProvenance:spotProvenance(Date.parse('2026-09-04T20:05:00Z'),Date.parse('2026-09-04T20:04:00Z')),trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:'2026-09-04T20:04:00.000Z'}}
  ];
  const db={query:async()=>({rows})};
  const out=await readPortfolioHistory(db,{now:Date.parse('2026-09-04T21:00:00Z'),rangeMs:3600000});
  assert.equal(out.rawPointCount,2);
  assert.equal(out.excludedIncompletePoints,1);
  assert.equal(out.unknownSpotPriceProvenancePoints,1);
  assert.equal(out.points.length,1);
  assert.equal(out.points[0].totalUsd,35371.6);
});

test('canonical history completeness requires both authority components and arithmetic consistency',()=>{
  const base={timestamp:1000,spotUsd:100,tradingUsd:50,totalUsd:150,sourceStatus:{spot:'STRICT_AUTHORITY',spotPriceProvenance:spotProvenance(1000,900),trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:900}};
  assert.equal(canonicalHistoryPointComplete(base),true);
  assert.equal(canonicalHistoryPointComplete({...base,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'MISSING'}}),false);
  assert.equal(canonicalHistoryPointComplete({...base,totalUsd:148}),false);
  assert.equal(canonicalHistoryPointComplete({...base,sourceStatus:{...base.sourceStatus,spotPriceProvenance:undefined}}),false);
  assert.equal(canonicalHistoryPointComplete({...base,sourceStatus:{...base.sourceStatus,spotPriceProvenance:spotProvenance(1000,1001)}}),false);
  assert.equal(canonicalHistoryPointComplete({...base,sourceStatus:{...base.sourceStatus,spotPriceProvenance:spotProvenance(1000,1000-15*60*1000-1)}}),false);
  const row=base.sourceStatus.spotPriceProvenance.symbols.BTC;
  for(const [label,mutate] of [
    ['missing source',x=>delete x.source],['null source',x=>{x.source=null}],['undefined source',x=>{x.source=undefined}],['wrong source type',x=>{x.source=42}],
    ['missing quality',x=>delete x.sourceQuality],['null quality',x=>{x.sourceQuality=null}],['undefined quality',x=>{x.sourceQuality=undefined}],['wrong quality type',x=>{x.sourceQuality=42}],
    ['unsupported quality',x=>{x.sourceQuality='STALE'}],['policy assumption',x=>{x.source='STABLE_VALUE_POLICY';x.sourceQuality='POLICY_ASSUMPTION'}],
    ['wrong price type',x=>{x.price='100'}],['wrong time type',x=>{x.fetchedAt='900'}],['valid flag',x=>{x.valid=1}]
  ]){
    const invalid={...row};mutate(invalid);
    const point={...base,sourceStatus:{...base.sourceStatus,spotPriceProvenance:{...base.sourceStatus.spotPriceProvenance,symbols:{BTC:invalid}}}};
    assert.equal(canonicalHistoryPointComplete(point),false,label);
  }
  for(const symbols of [[' BTC '],['BTC',' BTC ']]){
    const invalid={...base,sourceStatus:{...base.sourceStatus,spotPriceProvenance:{...base.sourceStatus.spotPriceProvenance,status:'COMPLETE',requiredSymbols:symbols,symbols:Object.fromEntries(symbols.map(symbol=>[symbol,{...row}]))}}};
    assert.equal(canonicalHistoryPointComplete(invalid),false,`noncanonical required symbols: ${symbols.join(',')}`);
  }
  for(const symbol of [null,42,false,{}]){
    const key=String(symbol),invalid={...base,sourceStatus:{...base.sourceStatus,spotPriceProvenance:{...base.sourceStatus.spotPriceProvenance,status:'COMPLETE',requiredSymbols:[symbol],symbols:{[key]:{...row}}}}};
    assert.equal(canonicalHistoryPointComplete(invalid),false,`malformed required symbol: ${key}`);
  }
});

test('history reader excludes malformed persisted symbols while retaining canonical rows',async()=>{
  const timestamp=1_000_000,validStatus={spot:'STRICT_AUTHORITY',spotPriceProvenance:spotProvenance(timestamp,timestamp-100),trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:timestamp-100};
  const malformedStatus={...validStatus,spotPriceProvenance:{...validStatus.spotPriceProvenance,requiredSymbols:[null],symbols:{null:{price:100,source:'BINANCE_SPOT',sourceQuality:'PUBLIC_LIVE_FETCH',fetchedAt:timestamp-100,providerObservedAt:null,valid:true,reason:'FRESH'}}}};
  const rows=[malformedStatus,validStatus].map((source_status,index)=>({captured_at:new Date(timestamp+index).toISOString(),spot_usd:100,trading_usd:50,total_usd:150,cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:null,source_status}));
  const out=await readPortfolioHistory({query:async()=>({rows})},{now:timestamp+10,rangeMs:3600000});
  assert.equal(out.rawPointCount,2);
  assert.equal(out.excludedIncompletePoints,1);
  assert.equal(out.points.length,1);
  assert.deepEqual(out.points[0].sourceStatus.spotPriceProvenance.requiredSymbols,['BTC']);
});


test('history capture fails closed when expected external venue authority is incomplete',async()=>{
  const calls=[];
  const data={portfolio:{holdings:[{symbol:'BTC',quantity:2,venue:'Ledger',updatedAt:900}],manualVenueBalances:[{venue:'Ledger',valueUsd:200,updatedAt:900}],pionexEquityUsd:50,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:1900}};
  const db={query:async(sql,args)=>{calls.push([sql,args]);return{rows:[]}}};
  const out=await appendPortfolioHistory(db,data,{timestamp:2000});
  assert.equal(out.ok,false);
  assert.equal(out.reason,'PORTFOLIO_AUTHORITY_INCOMPLETE');
  assert.equal(out.snapshot.authorityComplete,false);
  assert.equal(calls.length,0);
});


test('history capture uses fresh wallet API equity instead of stale zero portfolio seed',()=>{
  const data={privateRevision:9,livePrices:{BTC:{price:100,source:'BINANCE_SPOT',ts:950}},livePriceMeta:{fresh:true,source:'BINANCE_SPOT',fetchedAt:950,requestedCount:1,resolvedCount:1},portfolio:{
    ledgerAuthorityAt:900,
    holdings:[{symbol:'BTC',quantity:2,venue:'Ledger',updatedAt:900}],
    manualVenueBalances:[{venue:'OKX',valueUsd:10,updatedAt:900}],
    pionexEquityUsd:0,pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT',pionexEquityUpdatedAt:-2_000_000
  },pionexAccountSync:{status:'OK'},pionexAccount:{walletStatus:'OK',updatedAt:950,wallet:{totalInUsdt:34402.17}}};
  const s=historySnapshot(data,{timestamp:1000});
  assert.equal(s.spotAuthorityComplete,true);
  assert.equal(s.tradingAuthorityComplete,true);
  assert.equal(s.tradingUsd,34402.17);
  assert.equal(s.totalUsd,34612.17);
  assert.equal(s.sourceStatus.tradingSource,'PIONEX_WALLET_READ_API');
  assert.equal(s.sourceStatus.tradingFresh,true);
});

test('r104-style PIONEX_EQUITY label without freshness provenance is rejected',()=>{
  const legacy={timestamp:1000,spotUsd:1798.71,tradingUsd:0,totalUsd:1798.71,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY'}};
  assert.equal(canonicalHistoryPointComplete(legacy),false);
});
