import test from 'node:test';
import assert from 'node:assert/strict';
import {BREAKOUT_TREND_V1,runBreakoutTrendV1} from '../breakout-trend-v1.js';

const H4=4*3600000,DAY=86400000;
function trendBars(days=8,start=100,step=.5){
  const out=[];let p=start;
  for(let i=0;i<days*6;i++){
    const t=i*H4,o=p,c=p+step,h=Math.max(o,c)+.2,l=Math.min(o,c)-.2;
    out.push({t,o,h,l,c});p=c;
  }
  return out;
}
const fast={dailyFast:2,dailySlow:3,breakoutBars:3,atrPeriod:2,atrMultiple:2,trailingBars:2,maxHoldMs:3*H4,roundTripCostRate:.0016};

test('predeclared V1 contract remains fixed',()=>{
  assert.equal(BREAKOUT_TREND_V1.dailyFast,50);
  assert.equal(BREAKOUT_TREND_V1.dailySlow,200);
  assert.equal(BREAKOUT_TREND_V1.breakoutBars,20);
  assert.equal(BREAKOUT_TREND_V1.atrPeriod,14);
  assert.equal(BREAKOUT_TREND_V1.atrMultiple,2);
  assert.equal(BREAKOUT_TREND_V1.trailingBars,10);
  assert.equal(BREAKOUT_TREND_V1.maxHoldMs,60*DAY);
  assert.equal(BREAKOUT_TREND_V1.roundTripCostRate,.0016);
  assert.deepEqual(BREAKOUT_TREND_V1.symbols,['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','AVAXUSDT','LINKUSDT']);
});

test('signal fills only on the next 4h bar and charges costs',()=>{
  const bars=trendBars();
  const r=runBreakoutTrendV1(bars,{symbol:'BTCUSDT',entryStart:0,entryEnd:Infinity},fast);
  assert.ok(r.signals.length>0);
  assert.ok(r.closed.length>0);
  const t=r.closed[0],s=r.signals.find(x=>x.signalAt===t.signalAt);
  assert.ok(s);
  assert.equal(t.openedAt,t.signalAt);
  assert.ok(t.costR>0);
  assert.ok(t.netR<t.grossR);
  assert.ok(['TRAIL_STOP','GAP_STOP','MAX_HOLD'].includes(t.exitReason));
});

test('entry window blocks new positions outside the declared period',()=>{
  const bars=trendBars();
  const cutoff=4*DAY;
  const r=runBreakoutTrendV1(bars,{symbol:'ETHUSDT',entryStart:cutoff,entryEnd:cutoff+H4},fast);
  assert.ok(r.closed.every(x=>x.openedAt>=cutoff&&x.openedAt<cutoff+H4));
  assert.ok(r.open.every(x=>x.openedAt>=cutoff&&x.openedAt<cutoff+H4));
});

test('engine is research-only and does not expose execution hooks',()=>{
  const r=runBreakoutTrendV1(trendBars(),{symbol:'SOLUSDT'},fast);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal('placeOrder' in r,false);
  assert.equal('submitOrder' in r,false);
});
