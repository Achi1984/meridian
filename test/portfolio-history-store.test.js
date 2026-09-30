import test from 'node:test';
import assert from 'node:assert/strict';
import { historySnapshot, appendPortfolioHistory, readPortfolioHistory, normalizeHistoryRows, canonicalHistoryPointComplete } from '../portfolio-history-store.js';

function sample(){return{privateRevision:7,livePrices:{BTC:{price:100},SOL:{price:20}},portfolio:{
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
  const db={query:async()=>({rows:[{captured_at:'2026-09-04T20:00:00.000Z',spot_usd:'200',trading_usd:'50',total_usd:'250',cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:8,source_status:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:'2026-09-04T19:59:00.000Z'}}]})};
  const out=await readPortfolioHistory(db,{now:Date.parse('2026-09-04T21:00:00Z'),rangeMs:3600000});
  assert.equal(out.points.length,1);assert.equal(out.points[0].totalUsd,250);assert.equal(out.points[0].cashflowAdjustedTotalUsd,null);
});

test('row normalization preserves timestamp and components',()=>{
  const x=normalizeHistoryRows([{captured_at:'2026-09-04T20:00:00Z',spot_usd:10,trading_usd:2,total_usd:12,cashflow_adjusted_total_usd:11,cumulative_cashflow_usd:1,source_revision:3,source_status:{}}]);
  assert.equal(x[0].spotUsd,10);assert.equal(x[0].totalUsd,12);assert.equal(x[0].sourceRevision,3);
});


test('history capture fails closed when Pionex equity is missing even with complete Spot authority',async()=>{
  const calls=[];
  const data={privateRevision:8,livePrices:{BTC:{price:100}},livePriceMeta:{fresh:true},portfolio:{
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
    {captured_at:'2026-09-04T20:05:00.000Z',spot_usd:'914.68',trading_usd:'34456.92',total_usd:'35371.6',cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:8,source_status:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:'2026-09-04T20:04:00.000Z'}}
  ];
  const db={query:async()=>({rows})};
  const out=await readPortfolioHistory(db,{now:Date.parse('2026-09-04T21:00:00Z'),rangeMs:3600000});
  assert.equal(out.rawPointCount,2);
  assert.equal(out.excludedIncompletePoints,1);
  assert.equal(out.points.length,1);
  assert.equal(out.points[0].totalUsd,35371.6);
});

test('canonical history completeness requires both authority components and arithmetic consistency',()=>{
  const base={timestamp:1000,spotUsd:100,tradingUsd:50,totalUsd:150,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:900}};
  assert.equal(canonicalHistoryPointComplete(base),true);
  assert.equal(canonicalHistoryPointComplete({...base,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'MISSING'}}),false);
  assert.equal(canonicalHistoryPointComplete({...base,totalUsd:148}),false);
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
  const data={privateRevision:9,livePrices:{BTC:{price:100}},livePriceMeta:{fresh:true,requestedCount:1,resolvedCount:1},portfolio:{
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
