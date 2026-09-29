import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIME_GATED_GRID_V2_RULESET,
  REGIME_GATED_GRID_V2_CONFIG,
  evaluateRangeRegime,
  validateDailyContinuity,
  monthStartMs
} from '../research/regime-gated-grid-v2.js';

const DAY=86400000;
function choppyBars(n=260,{amp=1,highPad=4,lowPad=4,recentAmp=null}={}){
  const out=[];
  for(let i=0;i<n;i++){
    const a=recentAmp!=null&&i>=n-30?recentAmp:amp;
    const close=100+(i%2===0?a:-a);
    const open=i?out[i-1].close:100;
    out.push({
      openTime:i*DAY,
      closeTime:(i+1)*DAY-1,
      open,
      high:Math.max(open,close)+highPad,
      low:Math.min(open,close)-lowPad,
      close
    });
  }
  return out;
}
function trendingBars(n=260){
  const out=[];
  for(let i=0;i<n;i++){
    const close=100+i*.5,open=i?out[i-1].close:100;
    out.push({openTime:i*DAY,closeTime:(i+1)*DAY-1,open,high:close+.5,low:open-.5,close});
  }
  return out;
}

test('V2 regime gate remains frozen research-only configuration',()=>{
  assert.equal(REGIME_GATED_GRID_V2_RULESET,'REGIME-GATED-GRID-V2-FROZEN');
  assert.equal(REGIME_GATED_GRID_V2_CONFIG.maxEfficiencyRatio,.30);
  assert.equal(REGIME_GATED_GRID_V2_CONFIG.minRangePosition,.20);
  assert.equal(REGIME_GATED_GRID_V2_CONFIG.maxRangePosition,.80);
  assert.equal(REGIME_GATED_GRID_V2_CONFIG.minVolRatio,.60);
  assert.equal(REGIME_GATED_GRID_V2_CONFIG.maxVolRatio,1.05);
});

test('choppy moderate-volatility history is eligible',()=>{
  const bars=choppyBars();
  const r=evaluateRangeRegime(bars,260*DAY);
  assert.equal(r.eligible,true,r.reasons.join(','));
  assert.ok(r.efficiencyRatio<=.30);
  assert.ok(r.rangePosition>=.20&&r.rangePosition<=.80);
  assert.ok(r.volRatio>=.60&&r.volRatio<=1.05);
});

test('persistent directional trend is rejected by efficiency ratio',()=>{
  const r=evaluateRangeRegime(trendingBars(),260*DAY);
  assert.equal(r.eligible,false);
  assert.ok(r.reasons.includes('EFFICIENCY_RATIO_HIGH'));
});

test('range-edge start is rejected independently of trend efficiency',()=>{
  const bars=choppyBars();
  for(let i=bars.length-30;i<bars.length;i++){
    bars[i].high=102;
    bars[i].low=98;
    bars[i].close=i===bars.length-1?102:100+(i%2===0?.5:-.5);
  }
  const r=evaluateRangeRegime(bars,260*DAY);
  assert.equal(r.eligible,false);
  assert.ok(r.reasons.includes('RANGE_EDGE'));
});

test('recent volatility expansion is rejected against trailing history',()=>{
  const r=evaluateRangeRegime(choppyBars(260,{amp:.5,recentAmp:4}),260*DAY);
  assert.equal(r.eligible,false);
  assert.ok(r.reasons.includes('VOL_RATIO_OUTSIDE_BAND'));
});

test('insufficient daily history fails closed',()=>{
  const r=evaluateRangeRegime(choppyBars(100),100*DAY);
  assert.equal(r.eligible,false);
  assert.ok(r.reasons.includes('INSUFFICIENT_HISTORY'));
});

test('daily continuity rejects material gaps',()=>{
  const bars=choppyBars(220);
  bars[100].openTime+=3*DAY;
  bars[100].closeTime+=3*DAY;
  assert.throws(()=>validateDailyContinuity(bars),/daily data gap|strictly increasing/);
});

test('month key conversion is deterministic UTC',()=>{
  assert.equal(monthStartMs('2026-08'),Date.UTC(2026,7,1));
});
