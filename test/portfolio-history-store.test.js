import test from 'node:test';
import assert from 'node:assert/strict';
import { historySnapshot, appendPortfolioHistory, readPortfolioHistory, normalizeHistoryRows } from '../portfolio-history-store.js';

function sample(){return{privateRevision:7,livePrices:{BTC:{price:100},SOL:{price:20}},portfolio:{holdings:[{symbol:'BTC',quantity:2,venue:'Ledger'},{symbol:'SOL',quantity:3,venue:'Pionex'}],pionexEquityUsd:50,cumulativeCashflowUsd:25}}}

test('history snapshot persists canonical Spot + Pionex basis',()=>{
  const s=historySnapshot(sample(),{timestamp:1000});
  assert.equal(s.spotUsd,200);
  assert.equal(s.tradingUsd,50);
  assert.equal(s.totalUsd,250);
  assert.equal(s.cashflowAdjustedTotalUsd,225);
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
  const db={query:async()=>({rows:[{captured_at:'2026-09-04T20:00:00.000Z',spot_usd:'200',trading_usd:'50',total_usd:'250',cashflow_adjusted_total_usd:null,cumulative_cashflow_usd:null,source_revision:8,source_status:{spot:'LIVE'}}]})};
  const out=await readPortfolioHistory(db,{now:Date.parse('2026-09-04T21:00:00Z'),rangeMs:3600000});
  assert.equal(out.points.length,1);assert.equal(out.points[0].totalUsd,250);assert.equal(out.points[0].cashflowAdjustedTotalUsd,null);
});

test('row normalization preserves timestamp and components',()=>{
  const x=normalizeHistoryRows([{captured_at:'2026-09-04T20:00:00Z',spot_usd:10,trading_usd:2,total_usd:12,cashflow_adjusted_total_usd:11,cumulative_cashflow_usd:1,source_revision:3,source_status:{}}]);
  assert.equal(x[0].spotUsd,10);assert.equal(x[0].totalUsd,12);assert.equal(x[0].sourceRevision,3);
});
