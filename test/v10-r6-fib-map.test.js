import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  detectSwing,detectOpposingChildSwing,buildFibLevels,adjacentFibLevels,
  fibDistancePct,fibPlotPosition,skLongShortZones,skTargetZone,zoneOverlap,skDoubleAdvantage
} from '../v10/fib-core.js';

test('r6 detects swing direction from 4h extrema chronology',()=>{
  const rows=[
    {openTime:1,high:90,low:82},
    {openTime:2,high:92,low:80},
    {openTime:3,high:96,low:85},
    {openTime:4,high:100,low:88},
    {openTime:5,high:98,low:87},
    {openTime:6,high:95,low:84},
    {openTime:7,high:93,low:82},
    {openTime:8,high:92,low:81},
    {openTime:9,high:91,low:80.5},
    {openTime:10,high:90.5,low:80.2},
  ];
  const s=detectSwing(rows,10);
  assert.equal(s.low,80);
  assert.equal(s.high,100);
  assert.equal(s.direction,'UP');
  assert.equal(s.bars,10);
});

test('r6 bullish Fib includes SK correction and target ratios',()=>{
  const levels=buildFibLevels(80,100,'UP');
  const by=x=>levels.find(l=>Math.abs(l.ratio-x)<1e-9)?.price;
  assert.ok(Math.abs(by(.5)-90)<1e-9);
  assert.ok(Math.abs(by(.559)-88.82)<1e-9);
  assert.ok(Math.abs(by(.618)-87.64)<1e-9);
  assert.ok(Math.abs(by(.667)-86.66)<1e-9);
  assert.ok(Math.abs(by(1.618)-112.36)<1e-9);
  assert.ok(Math.abs(by(1.809)-116.18)<1e-9);
  assert.ok(Math.abs(by(2)-120)<1e-9);
});

test('r6 bearish Fib mirrors SK correction and target zones',()=>{
  const levels=buildFibLevels(80,100,'DOWN');
  const by=x=>levels.find(l=>Math.abs(l.ratio-x)<1e-9)?.price;
  assert.ok(Math.abs(by(.5)-90)<1e-9);
  assert.ok(Math.abs(by(.667)-93.34)<1e-9);
  assert.ok(Math.abs(by(1.618)-67.64)<1e-9);
  assert.ok(Math.abs(by(1.809)-63.82)<1e-9);
  assert.ok(Math.abs(by(2)-60)<1e-9);
});

test('r6 creates simultaneous bullish long and bearish short trend-reversal areas',()=>{
  const zones=skLongShortZones(80,100);
  assert.equal(zones.long.side,'LONG');
  assert.equal(zones.long.label,'BULLISH TRENDWENDE');
  assert.ok(Math.abs(zones.long.low-86.66)<1e-9);
  assert.ok(Math.abs(zones.long.high-90)<1e-9);
  assert.equal(zones.short.side,'SHORT');
  assert.equal(zones.short.label,'BEARISH TRENDWENDE');
  assert.ok(Math.abs(zones.short.low-90)<1e-9);
  assert.ok(Math.abs(zones.short.high-93.34)<1e-9);
});

test('r6 SK target zone spans 1.618 through 2.000',()=>{
  const z=skTargetZone(80,100,'UP');
  assert.ok(Math.abs(z.low-112.36)<1e-9);
  assert.ok(Math.abs(z.high-120)<1e-9);
  assert.equal(z.side,'LONG');
});

test('r6 double advantage candidate requires opposing target overlap with parent correction area',()=>{
  const parent={low:80,high:100,direction:'UP'};
  const child={low:94,high:100,direction:'DOWN'};
  const d=skDoubleAdvantage(parent,child);
  assert.equal(d.candidate,true);
  assert.equal(d.side,'LONG');
  assert.ok(d.overlap);
  assert.ok(d.overlap.low<=d.overlap.high);

  const no=skDoubleAdvantage(parent,{low:70,high:80,direction:'DOWN'});
  assert.equal(no.candidate,false);
});

test('r6 detects an opposing child swing only after the parent endpoint',()=>{
  const rows=[
    {high:90,low:82},{high:92,low:80},{high:95,low:84},{high:100,low:90},
    {high:99,low:95},{high:98,low:94},{high:97,low:92},{high:96,low:91},
    {high:95,low:90},{high:94,low:89}
  ];
  const parent=detectSwing(rows,10);
  assert.equal(parent.direction,'UP');
  const child=detectOpposingChildSwing(rows,parent,10);
  assert.ok(child);
  assert.equal(child.direction,'DOWN');
});

test('r6 identifies next Fib levels above and below current price',()=>{
  const levels=buildFibLevels(80,100,'UP');
  const next=adjacentFibLevels(levels,93);
  assert.ok(next.above.price>93);
  assert.ok(next.below.price<93);
  assert.ok(fibDistancePct(next.above,93)>0);
  assert.ok(fibDistancePct(next.below,93)<0);
});

test('r6 graphical Fib positions stay inside ladder bounds',()=>{
  const levels=buildFibLevels(80,100,'UP');
  for(const level of levels){
    const p=fibPlotPosition(level.price,levels,93);
    assert.ok(p>=0&&p<=100);
  }
  assert.ok(fibPlotPosition(93,levels,93)>=0);
});

test('r6 Market integration exposes graphical SK Fib zones without execution',()=>{
  const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
  const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
  assert.match(js,/REGIME \+ FIB MAP \+ ASSET TAPE/);
  assert.match(js,/SWING-FENSTER/);
  assert.match(js,/30 × 4h/);
  assert.match(js,/180 × 4h/);
  assert.match(js,/LONG TRENDWENDE/);
  assert.match(js,/SHORT TRENDWENDE/);
  assert.match(js,/DOPPELTER VORTEIL/);
  assert.match(js,/Gegen-Ziel ∩ GKL/);
  assert.match(js,/0\.500–0\.667/);
  assert.match(js,/1\.618–2\.000/);
  assert.match(engine,/signalTone,marketKlines/);
  assert.match(css,/\.fib-zone-long/);
  assert.match(css,/\.fib-zone-short/);
  assert.match(css,/\.fib-zone-double/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});

test('r6 zone overlap is strict geometry, not a proximity guess',()=>{
  const a={low:90,high:95},b={low:94,high:98},c={low:96,high:98};
  assert.deepEqual(zoneOverlap(a,b),{low:94,high:95,width:1,overlapPct:25});
  assert.equal(zoneOverlap(a,c),null);
});


test('SK turn zones use 50 55.9 61.8 66.7 correction levels and 1.618 to 2.0 targets',()=>{
  const levels=buildFibLevels(100,200,'UP');
  for(const ratio of [.5,.559,.618,.667,1.618,2]){
    assert.ok(levels.some(x=>Math.abs(x.ratio-ratio)<1e-12),'missing SK ratio '+ratio);
  }
  const up=buildSkZones(100,200,'UP');
  assert.equal(up.bullTurn.low,200-100*.667);
  assert.equal(up.bullTurn.high,200-100*.5);
  assert.equal(up.activeTurn.key,'BULL_TURN');
  assert.equal(up.activeTarget.key,'BULL_TARGET');
  const down=buildSkZones(100,200,'DOWN');
  assert.equal(down.activeTurn.key,'BEAR_TURN');
  assert.equal(down.activeTarget.key,'BEAR_TARGET');
});

test('Double Advantage requires overlap from a distinct second Fib structure',()=>{
  const primary={low:100,high:200,direction:'UP',window:90};
  const same={low:100,high:200,direction:'UP',window:60};
  assert.equal(buildSkConfluences(primary,[same]).length,0,'identical swing is not independent confluence');
  const shifted={low:110,high:210,direction:'UP',window:60};
  const conf=buildSkConfluences(primary,[shifted]);
  assert.ok(conf.length>0,'expected overlapping independent structure');
  assert.ok(conf.some(x=>x.side==='BULL'));
  assert.ok(conf.every(x=>x.coverage>=.15));
  const ov=zoneOverlap({low:140,high:160},{low:150,high:170});
  assert.deepEqual({low:ov.low,high:ov.high},{low:150,high:160});
});

test('Fib UI labels SK bull bear turn areas and double advantage as decision support only',()=>{
  assert.match(js,/FIB MAP · SK OVERLAY/);
  assert.match(js,/BULL TURN · LONG/);
  assert.match(js,/BEAR TURN · SHORT/);
  assert.match(js,/DOUBLE ADVANTAGE · /);
  assert.match(js,/Reaktion beobachten, nicht automatisch handeln/);
  assert.match(js,/keine Orders/i);
  assert.match(css,/\.fib-zone-bull/);
  assert.match(css,/\.fib-zone-bear/);
  assert.match(css,/\.fib-zone-double/);
});
