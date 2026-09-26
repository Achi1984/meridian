import test from 'node:test';
import assert from 'node:assert/strict';
import {RANGE_REVERSION_V1,runRangeReversionV1} from '../range-reversion-v1.js';

const H4=4*3600000,DAY=86400000;
function meanReversionBars(){
  const out=[];let prev=100;
  for(let i=0;i<30;i++){
    const o=prev,c=100+(i%2?0.1:-0.1),h=Math.max(o,c)+.15,l=Math.min(o,c)-.15;
    out.push({t:i*H4,o,h,l,c});prev=c;
  }
  out.push({t:30*H4,o:100,c:95,h:100.1,l:94.8});
  out.push({t:31*H4,o:95.2,c:99.5,h:100.5,l:95.0});
  for(let i=32;i<45;i++){const o=99.8,c=100+(i%2?.1:-.1);out.push({t:i*H4,o,h:100.3,l:99.5,c});}
  return out;
}
const fast={meanBars:5,zEntry:1.5,adxPeriod:3,maxAdx:100,atrPeriod:3,atrMultiple:2,maxHoldMs:3*H4,roundTripCostRate:.0016};

test('predeclared Range Reversion V1 contract remains fixed',()=>{
  assert.equal(RANGE_REVERSION_V1.meanBars,20);
  assert.equal(RANGE_REVERSION_V1.zEntry,2);
  assert.equal(RANGE_REVERSION_V1.adxPeriod,14);
  assert.equal(RANGE_REVERSION_V1.maxAdx,20);
  assert.equal(RANGE_REVERSION_V1.atrPeriod,14);
  assert.equal(RANGE_REVERSION_V1.atrMultiple,2);
  assert.equal(RANGE_REVERSION_V1.maxHoldMs,7*DAY);
  assert.equal(RANGE_REVERSION_V1.roundTripCostRate,.0016);
});

test('extreme completed bar signals and fills only on next bar',()=>{
  const r=runRangeReversionV1(meanReversionBars(),{symbol:'BTCUSDT',entryStart:0,entryEnd:Infinity},fast);
  assert.ok(r.signals.length>0);
  assert.ok(r.closed.length>0);
  const t=r.closed[0];
  assert.equal(t.openedAt,t.signalAt);
  assert.ok(t.costR>0);
  assert.ok(t.netR<t.grossR);
  assert.ok(['MEAN_TARGET','STOP','GAP_STOP','MAX_HOLD'].includes(t.exitReason));
});

test('entry period is enforced',()=>{
  const bars=meanReversionBars(),start=30*H4,end=31*H4;
  const r=runRangeReversionV1(bars,{symbol:'ETHUSDT',entryStart:start,entryEnd:end},fast);
  assert.ok(r.closed.every(x=>x.openedAt>=start&&x.openedAt<end));
  assert.ok(r.open.every(x=>x.openedAt>=start&&x.openedAt<end));
});

test('engine is isolated research only',()=>{
  const r=runRangeReversionV1(meanReversionBars(),{symbol:'SOLUSDT'},fast);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal('placeOrder' in r,false);
  assert.equal('submitOrder' in r,false);
});
