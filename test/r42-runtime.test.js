import test from 'node:test';
import assert from 'node:assert/strict';
import {newLedger,stepLedger,ledgerSummary} from '../research/r42-ledger.js';
import {fundingHistory,dailyHistory,betaToBtc,collectMarket,UNIVERSE} from '../research/r42-market.js';
import {createResearchRuntime} from '../research/r42-runtime.js';
const now=40*86400000;
test('R42 preserves funding and books when an unrelated daily history request fails',async()=>{
  const calls=[];
  const rows=Array.from({length:90},(_,i)=>({fundingTime:now-30*86400000+(i+1)*8*3600000,fundingRate:.001,markPrice:100}));
  const get=async url=>{calls.push(url);if(url.includes('klines'))throw new DOMException('timed out','AbortError');if(url.includes('fundingRate'))return rows;if(url.includes('24hr'))return {quoteVolume:3e7};return UNIVERSE.map(symbol=>({symbol,bidPrice:'100',askPrice:'101',time:now}));};
  const m=await collectMarket(get,'https://spot.invalid','https://perp.invalid',now,now,()=>now);
  assert.ok(m.funding.BTCUSDT.complete);assert.equal(m.books['spot:BTCUSDT'].bid,100);
  assert.equal(m.errors[0].endpoint,'klines');assert.equal(m.errors[0].reason,'TIMEOUT');
  assert.equal(calls.filter(u=>u.includes('bookTicker')).length,2);
  assert.ok(calls.slice(-2).every(u=>u.includes('bookTicker')));
});
test('R42 future exchange timestamps remain invalid instead of being clamped',async()=>{
  const get=async url=>url.includes('bookTicker')?UNIVERSE.map(symbol=>({symbol,bidPrice:'100',askPrice:'101',time:now+60000})):url.includes('24hr')?{quoteVolume:3e7}:[];
  const m=await collectMarket(get,'https://spot.invalid','https://perp.invalid',now,now,()=>now);
  assert.equal(m.books['perp:BTCUSDT'].at,now+60000);assert.ok(m.dataErrors.some(e=>e.symbol==='BTCUSDT'&&e.reason==='INVALID_OR_STALE_BOOK'));
});
function market(){return {books:{'spot:BTCUSDT':{bid:100,ask:100,at:now},'perp:BTCUSDT':{bid:100,ask:100,at:now}},funding:{BTCUSDT:{complete:true,rows:[]}},carry:[{symbol:'BTCUSDT',asOf:now,completeFundingHistory:true,executableQuotes:true,basisWithinBand:true,liquidityPassed:true,conservativeFundingUsd:50,allInRoundTripCostsUsd:10}]};}
test('R42 equal carry quantities, fees exactly once, restart-safe funding and realized accounting',()=>{
  let s=stepLedger(newLedger('carry'),market(),now);assert.equal(s.lifecycle,'IN_TRADE');assert.equal(s.basket.legs[0].quantity,s.basket.legs[1].quantity);
  const m=market();Object.values(m.books).forEach(b=>b.at=now+1000);m.funding.BTCUSDT.rows=[{fundingTime:now+500,markPrice:100,fundingRate:.001}];
  s=stepLedger(JSON.parse(JSON.stringify(s)),m,now+1000);const funding=s.basket.funding,cash=s.cash;
  s=stepLedger(s,m,now+1000);assert.equal(s.basket.funding,funding);assert.equal(s.cash,cash);
  s.basket.closeAt=now+1000;s=stepLedger(s,m,now+1000);assert.equal(s.trades.length,1);assert.equal(s.basket,null);assert.ok(Math.abs(s.cash-10000-s.trades[0].realized)<1e-8);
  assert.equal(ledgerSummary(s).recentClosed.length,1);
});
test('R42 stale quotes preserve positions and never invent closures',()=>{
  const s=stepLedger(newLedger('carry'),market(),now),out=stepLedger(s,{books:{},funding:{}},now+60001);
  assert.equal(out.lifecycle,'DATA_STALE');assert.ok(out.basket);assert.equal(out.cash,s.cash);assert.equal(out.trades.length,0);
});
test('R42 risk limit closes a losing basket; sealed ledger cannot restart',()=>{
  const s=stepLedger(newLedger('carry'),market(),now),m=market();m.books['perp:BTCUSDT']={bid:120,ask:120,at:now};
  const out=stepLedger(s,m,now);assert.equal(out.trades[0].exitReason,'LOSS_LIMIT');
  out.lifecycle='SEALED';assert.equal(stepLedger(out,market(),now).basket,null);
});
test('R42 incomplete specialist evidence remains blocked',()=>{
  for(const id of ['pairs','squeeze']){const s=stepLedger(newLedger(id),market(),now);assert.equal(s.lifecycle,'WAITING_DATA');assert.equal(s.basket,null);}
});
test('R42 history rejects incomplete candles, gaps and truncated funding',()=>{
  assert.equal(dailyHistory([],now),null);assert.equal(betaToBtc(null,null),null);
  const rows=Array.from({length:90},(_,i)=>({fundingTime:now-30*86400000+(i+1)*8*3600000,fundingRate:.001,markPrice:100}));
  assert.equal(fundingHistory(rows,now,now-30*86400000).complete,true);
  assert.equal(fundingHistory(rows.slice(3),now,now-30*86400000).complete,false);
});
test('R42 network failure persists four explicit waiting states without touching existing keys',async()=>{
  const db=new Map();const runtime=createResearchRuntime({getState:async(k,f)=>db.get(k)||f,setState:async(k,v)=>db.set(k,v),fetchJson:async()=>{throw Error('offline');},spotBase:'https://spot.invalid',perpBase:'https://perp.invalid',clock:()=>now});
  await Promise.all([runtime.tick(),runtime.tick()]);assert.deepEqual([...db.keys()],['r42_momentum','r42_pairs','r42_squeeze','r42_carry']);
  const result=await runtime.summary();assert.equal(result.length,4);assert.ok(result.every(x=>x.openTrades===0));assert.ok(result.every(x=>!('legs' in x)));
});
