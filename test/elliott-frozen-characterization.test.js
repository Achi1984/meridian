// Synthetic characterization only: assertions preserve known frozen behavior,
// including defects. Passing these tests is NOT a strategy validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runElliottWaveV1 as wave3} from '../docs/strategy-lab/fixtures/elliott-frozen-v1.mjs';
import {runElliottWave5V1 as wave5} from '../docs/strategy-lab/fixtures/elliott-frozen-wave5.mjs';
const H4=14400000,DAY=86400000;
const bar=(i,price)=>({t:i*H4,o:price,h:price,l:price,c:price});
function series(points,end) {
  let j=0;
  return Array.from({length:end+1},(_,i)=>{
    while(j+1<points.length&&points[j+1][0]<i)j++;
    const [a,x]=points[j],[b,y]=points[Math.min(j+1,points.length-1)];
    return bar(i,a===b?x:x+(y-x)*(i-a)/(b-a));
  });
}
const three=()=>series([[0,110],[8,100],[16,120],[24,110],[27,113],[28,121]],28);
const five=()=>series([[0,110],[8,100],[16,110],[24,105],[32,135],[40,120],[43,123],[44,136]],44);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} versus ${b}`);
function sanity(bars){
  for(let i=0;i<bars.length;i++){
    const b=bars[i];assert.equal(b.t,i*H4);
    assert.ok([b.o,b.h,b.l,b.c].every(x=>Number.isFinite(x)&&x>0));
    assert.ok(b.h>=Math.max(b.o,b.c,b.l)&&b.l<=Math.min(b.o,b.c,b.h));
  }
}
test('frozen fixture modules are exact original Git blobs, with no patched source',()=>{
  for(const [name,sha] of [['elliott-frozen-v1.mjs','aa2eefd3dc9e2169a184c1ac625207c44102f8ca'],['elliott-frozen-wave5.mjs','a5923b65ef439caf1a8766b6982ac46c2013e33b']]){
    const bytes=readFileSync(new URL(`../docs/strategy-lab/fixtures/${name}`,import.meta.url));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),sha);
  }
});
test('KD1: later confirmation-day bars alter already-created daily-context annotation',()=>{
  const bars=series([[0,120],[24,100],[48,140],[58,124],[61,128],[65,131],[72,130]],72);
  sanity(bars);const prefix=bars.slice(0,62),before=structuredClone(bars);
  const causal=wave3(prefix),full=wave3(bars);
  assert.equal(causal.setups.length,1);assert.equal(full.setups.length,1);
  const a=causal.setups[0],b=full.setups[0];
  assert.equal(a.createdIndex,61);assert.equal(a.createdAt,62*H4);
  assert.equal(b.createdAt,a.createdAt);assert.equal(a.dailyStructure,'UNKNOWN');assert.equal(b.dailyStructure,'LONG');
  assert.ok(a.createdAt<11*DAY); // confirmation day 10 has not closed at the decision
  for(const key of ['side','entryTrigger','stop','target1','target2'])assert.equal(a[key],b[key]);
  assert.deepEqual(bars,before); // annotation contamination, not proof of changed strategy fills
});
test('KD2: Wave5 targets behind a positive long entry produce phantom positive target R',()=>{
  const bars=five();sanity(bars);const r=wave5(bars);
  assert.equal(r.closed.length,1);const t=r.closed[0];
  assert.deepEqual([t.w0.price,t.w1.price,t.w2.price,t.w3.price,t.w4.price],[100,110,105,135,120]);
  assert.equal(t.entryAt,136);assert.equal(t.stop,120);assert.equal(t.entryIndex,44);assert.equal(t.closedIndex,44);
  near(t.target1,126.18);assert.equal(t.target2,130);
  assert.ok(t.target1<t.entryAt&&t.target2<t.entryAt);assert.equal(t.exit,'TARGET_1.000');
  near(t.grossR,0.494375);near(t.netR,0.444375);
  // Conditional signed accounting if both lower-price exits actually occurred.
  // This does NOT assert fills occurred; the only entry candle is flat at 136.
  const signed=.5*(t.target1-t.entryAt)/(t.entryAt-t.stop)+.5*(t.target2-t.entryAt)/(t.entryAt-t.stop);
  near(signed,-0.494375);assert.ok(signed<0&&t.grossR>0);
  assert.equal(r.researchOnly,true);assert.equal(r.executionImpact,false);
});
test('KD3: Wave3 gap below initial stop is capped at minus one gross R by frozen model',()=>{
  const bars=three();bars.push(bar(29,90));sanity(bars);
  const r=wave3(bars);assert.equal(r.closed.length,1);const t=r.closed[0];
  assert.equal(t.entryAt,121);assert.equal(t.stop,110);assert.equal(t.exit,'STOP');
  assert.equal(t.grossR,-1);near(t.netR,-1.05);
  const atSyntheticOpening=(90-t.entryAt)/(t.entryAt-t.stop);
  near(atSyntheticOpening,-31/11);assert.ok(atSyntheticOpening<t.grossR);
});
test('KD4: Wave3 original-stop-after-TP1 omits the remaining half-position loss',()=>{
  const bars=three();bars.push(bar(29,131),bar(30,110));sanity(bars);
  const r=wave3(bars);assert.equal(r.closed.length,1);const t=r.closed[0];
  assert.equal(t.target1,130);assert.equal(t.stop,110);assert.equal(t.entryAt,121);
  assert.equal(t.exit,'BREAKEVEN_AFTER_TP1');near(t.grossR,.5*9/11);
  const declaredHalfTargetHalfOriginalStop=.5*9/11-.5;
  near(t.grossR-declaredHalfTargetHalfOriginalStop,.5);
  assert.ok(declaredHalfTargetHalfOriginalStop<0&&t.grossR>0);
});
test('KD5: Wave3 does not actually close its remaining half at entry after TP1',()=>{
  const bars=three();bars.push(bar(29,131),bar(30,120));sanity(bars);
  const r=wave3(bars);assert.equal(r.closed.length,0);assert.equal(r.open.length,1);
  const t=r.open[0];assert.equal(t.tp1Done,true);assert.ok(120<t.entryAt&&120>t.stop);
  assert.equal(t.stop,110); // fixed original stop, not a relocated entry stop
});
test('KD6: Wave3 candidate waits for all three right bars and enters only later',()=>{
  const bars=three();sanity(bars);
  assert.equal(wave3(bars.slice(0,27)).setups.length,0);
  const confirmation=wave3(bars.slice(0,28));assert.equal(confirmation.setups.length,1);
  assert.equal(confirmation.open.length,0);assert.equal(confirmation.pending.length,1);
  const r=wave3(bars);assert.equal(r.open.length,1);const t=r.open[0];
  assert.equal(t.w2.index,24);assert.equal(t.w2.confirmedIndex,27);assert.equal(t.createdAt,28*H4);
  assert.equal(t.entryIndex,28);assert.ok(t.entryIndex>t.createdIndex);
});
test('KD7: equal-low plateau uses earliest qualifying pivot under asymmetric ties',()=>{
  const right=three();right[9]=bar(9,100);sanity(right);
  assert.equal(wave3(right).setups[0].w0.index,8);
  const left=three();left[7]=bar(7,100);sanity(left);
  assert.equal(wave3(left).setups[0].w0.index,7);
});
