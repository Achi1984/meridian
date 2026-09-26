import test from 'node:test';
import assert from 'node:assert/strict';
import {MTF_PULLBACK_CONTINUATION_V1,runMtfPullbackContinuationV1} from '../mtf-pullback-continuation-v1.js';

const H4=4*3600000,DAY=86400000;
const cfg={dailyFast:2,dailySlow:3,h4Fast:2,h4Slow:5,atrPeriod:2,validBars:4,stopAtrMultiple:1,targetR:1.5,breakEvenTriggerR:.5,maxHoldMs:3*H4,roundTripCostRate:.001};

function sample(){
  const rows=[];let t=0,p=100;
  const push=(o,h,l,c)=>{rows.push({t,o,h,l,c});t+=H4;p=c;};
  for(let i=0;i<42;i++){const o=p,c=p+.20;push(o,c+.08,o-.08,c);}
  const peak=p;
  push(p,p+.05,p-.30,p-.20);
  push(p,p+.95,p-.05,peak+.45);
  push(p,p+.90,p-.10,p+.60);
  push(p,p+.40,p-.50,p-.20);
  return rows;
}

test('frozen V1 contract remains fixed',()=>{
  const c=MTF_PULLBACK_CONTINUATION_V1;
  assert.equal(c.dailyFast,50);assert.equal(c.dailySlow,200);assert.equal(c.h4Fast,20);assert.equal(c.h4Slow,50);
  assert.equal(c.atrPeriod,14);assert.equal(c.validBars,6);assert.equal(c.stopAtrMultiple,1.5);assert.equal(c.targetR,2.5);
  assert.equal(c.breakEvenTriggerR,1);assert.equal(c.maxHoldMs,10*DAY);assert.equal(c.roundTripCostRate,.0016);
  assert.deepEqual(c.symbols,['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']);
});

test('pullback arms before confirmation and entry occurs on next 4h bar',()=>{
  const r=runMtfPullbackContinuationV1(sample(),{symbol:'BTCUSDT',entryStart:0,entryEnd:Infinity},cfg);
  assert.ok(r.armedHistory.length>=1);
  assert.ok(r.signals.length>=1);
  const s=r.signals[0],trade=[...r.closed,...r.open].find(x=>x.signalAt===s.signalAt);
  assert.ok(s.signalAt>s.armedAt);assert.ok(trade);assert.equal(trade.openedAt,s.signalAt);
});

test('round-trip cost is charged in R units',()=>{
  const r=runMtfPullbackContinuationV1(sample(),{symbol:'ETHUSDT',entryStart:0,entryEnd:Infinity},cfg);
  assert.ok(r.closed.length>=1);
  const t=r.closed[0];assert.ok(t.costR>0);assert.ok(t.netR<t.grossR);
});

test('future evaluation window cannot admit historical signal',()=>{
  const rows=sample(),start=rows.at(-1).t+10*H4,end=start+H4;
  const r=runMtfPullbackContinuationV1(rows,{symbol:'SOLUSDT',entryStart:start,entryEnd:end},cfg);
  assert.equal(r.signals.length,0);assert.equal(r.closed.length+r.open.length,0);
});

test('engine is research-only and exposes no execution hook',()=>{
  const r=runMtfPullbackContinuationV1(sample(),{symbol:'ADAUSDT'},cfg);
  assert.equal(r.researchOnly,true);assert.equal(r.executionImpact,false);
  assert.equal('placeOrder' in r,false);assert.equal('submitOrder' in r,false);
});
