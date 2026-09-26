import test from 'node:test';
import assert from 'node:assert/strict';
import {VOL_COMPRESSION_EXPANSION_V1,runVolCompressionExpansionV1} from '../vol-compression-expansion-v1.js';

const H4=4*3600000,DAY=86400000;
const cfg={atrPeriod:2,rangeBars:3,percentileLookback:5,compressionPercentile:.5,compressionStreak:2,boxBars:3,armedBars:3,
  expansionAtrMultiple:1,stopAtrMultiple:1,targetR:1.5,breakEvenTriggerR:.5,maxHoldMs:3*H4,roundTripCostRate:.001};

function sample(){
  const rows=[];let t=0,p=100;
  const push=(o,h,l,c)=>{rows.push({t,o,h,l,c});t+=H4;p=c;};
  // Higher-volatility history.
  push(100,102,98,101);push(101,103,99,100);push(100,102,97,99);push(99,101,96,98);
  push(98,101,97,100);push(100,102,98,101);push(101,103,99,100);push(100,102,98,99);
  push(99,101,97,100);push(100,102,98,101);
  // Compression streak.
  push(101,101.25,100.85,101.05);push(101.05,101.20,100.90,101.00);push(101,101.18,100.92,101.04);
  // Expansion outside frozen box.
  push(101.04,102.60,101.00,102.40);
  // Next-bar entry and follow-through.
  push(102.45,104.20,102.30,103.80);push(103.80,104.40,103.20,104.00);push(104.00,104.10,103.00,103.20);
  return rows;
}

test('frozen V1 contract remains fixed',()=>{
  const c=VOL_COMPRESSION_EXPANSION_V1;
  assert.equal(c.atrPeriod,14);assert.equal(c.rangeBars,12);assert.equal(c.percentileLookback,126);
  assert.equal(c.compressionPercentile,.25);assert.equal(c.compressionStreak,3);assert.equal(c.boxBars,12);assert.equal(c.armedBars,6);
  assert.equal(c.expansionAtrMultiple,1.25);assert.equal(c.stopAtrMultiple,1.5);assert.equal(c.targetR,2.5);assert.equal(c.breakEvenTriggerR,1);
  assert.equal(c.maxHoldMs,7*DAY);assert.equal(c.roundTripCostRate,.0016);
  assert.deepEqual(c.symbols,['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']);
});

test('compression must arm before a later expansion signal and entry is next bar',()=>{
  const r=runVolCompressionExpansionV1(sample(),{symbol:'BTCUSDT',entryStart:0,entryEnd:Infinity},cfg);
  assert.ok(r.armedHistory.length>=1);
  assert.ok(r.signals.length>=1);
  const s=r.signals[0];
  assert.ok(s.signalAt>s.armedAt);
  const trade=[...r.closed,...r.open].find(x=>x.signalAt===s.signalAt);
  assert.ok(trade);
  assert.equal(trade.openedAt,s.signalAt);
});

test('round-trip cost is charged in R units',()=>{
  const r=runVolCompressionExpansionV1(sample(),{symbol:'ETHUSDT',entryStart:0,entryEnd:Infinity},cfg);
  assert.ok(r.closed.length>=1);
  const t=r.closed[0];
  assert.ok(t.costR>0);
  assert.ok(t.netR<t.grossR);
});

test('entry window rejects signals outside the frozen evaluation period',()=>{
  const rows=sample(),start=rows.at(-2).t,end=rows.at(-1).t;
  const r=runVolCompressionExpansionV1(rows,{symbol:'SOLUSDT',entryStart:start,entryEnd:end},cfg);
  assert.equal(r.closed.length+r.open.length,0);
});

test('engine is research-only and exposes no execution hook',()=>{
  const r=runVolCompressionExpansionV1(sample(),{symbol:'ADAUSDT'},cfg);
  assert.equal(r.researchOnly,true);assert.equal(r.executionImpact,false);
  assert.equal('placeOrder' in r,false);assert.equal('submitOrder' in r,false);
});
