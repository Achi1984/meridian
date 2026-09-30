import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  detectSwing,detectOpposingChildSwing,buildFibLevels,adjacentFibLevels,
  fibDistancePct,fibPlotPosition,skLongShortZones,skTargetZone,zoneOverlap,skDoubleAdvantage
} from '../v10/fib-core.js';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

test('r6 detects 4h swing direction from extrema chronology',()=>{
  const rows=[
    {openTime:1,high:90,low:82},{openTime:2,high:92,low:80},
    {openTime:3,high:96,low:85},{openTime:4,high:100,low:88},
    {openTime:5,high:98,low:87},{openTime:6,high:95,low:84},
    {openTime:7,high:93,low:82},{openTime:8,high:92,low:81},
    {openTime:9,high:91,low:80.5},{openTime:10,high:90.5,low:80.2}
  ];
  const swing=detectSwing(rows,10);
  assert.equal(swing.low,80);
  assert.equal(swing.high,100);
  assert.equal(swing.direction,'UP');
  assert.equal(swing.bars,10);
});

test('r6 Fib ladder includes SK correction and target ratios in both directions',()=>{
  const up=buildFibLevels(80,100,'UP');
  const down=buildFibLevels(80,100,'DOWN');
  const upBy=r=>up.find(x=>Math.abs(x.ratio-r)<1e-9)?.price;
  const downBy=r=>down.find(x=>Math.abs(x.ratio-r)<1e-9)?.price;
  for(const ratio of [.5,.559,.618,.667,1.618,1.809,2]){
    assert.ok(up.some(x=>Math.abs(x.ratio-ratio)<1e-9),'UP missing '+ratio);
    assert.ok(down.some(x=>Math.abs(x.ratio-ratio)<1e-9),'DOWN missing '+ratio);
  }
  assert.ok(Math.abs(upBy(.559)-88.82)<1e-9);
  assert.ok(Math.abs(upBy(1.809)-116.18)<1e-9);
  assert.ok(Math.abs(downBy(.667)-93.34)<1e-9);
  assert.ok(Math.abs(downBy(1.809)-63.82)<1e-9);
});

test('r6 exposes simultaneous bullish long and bearish short trend-reversal areas',()=>{
  const z=skLongShortZones(80,100);
  assert.deepEqual({side:z.long.side,label:z.long.label},{side:'LONG',label:'BULLISH TRENDWENDE'});
  assert.ok(Math.abs(z.long.low-86.66)<1e-9);
  assert.ok(Math.abs(z.long.high-90)<1e-9);
  assert.deepEqual({side:z.short.side,label:z.short.label},{side:'SHORT',label:'BEARISH TRENDWENDE'});
  assert.ok(Math.abs(z.short.low-90)<1e-9);
  assert.ok(Math.abs(z.short.high-93.34)<1e-9);
});

test('r6 SK target area spans 1.618 through 2.000',()=>{
  const up=skTargetZone(80,100,'UP'),down=skTargetZone(80,100,'DOWN');
  assert.ok(Math.abs(up.low-112.36)<1e-9);
  assert.ok(Math.abs(up.high-120)<1e-9);
  assert.equal(up.side,'LONG');
  assert.ok(Math.abs(down.low-60)<1e-9);
  assert.ok(Math.abs(down.high-67.64)<1e-9);
  assert.equal(down.side,'SHORT');
});

test('r6 opposing child swing is detected only after the parent endpoint',()=>{
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
  assert.ok(child.highIndex>parent.highIndex);
});

test('r6 Double Advantage requires strict opposing target overlap with parent GKL',()=>{
  const parent={low:80,high:100,direction:'UP'};
  const child={low:94,high:100,direction:'DOWN'};
  const yes=skDoubleAdvantage(parent,child);
  assert.equal(yes.candidate,true);
  assert.equal(yes.side,'LONG');
  assert.equal(yes.type,'Gegen-Ziel ∩ GKL');
  assert.ok(yes.overlap?.overlapPct>0);

  const no=skDoubleAdvantage(parent,{low:70,high:80,direction:'DOWN'});
  assert.equal(no.candidate,false);
  assert.equal(no.overlap,null);
});

test('r6 overlap is strict geometry, not a proximity guess',()=>{
  const a={low:90,high:95},b={low:94,high:98},c={low:96,high:98};
  assert.deepEqual(zoneOverlap(a,b),{low:94,high:95,width:1,overlapPct:25});
  assert.equal(zoneOverlap(a,c),null);
});

test('r6 identifies nearest Fib levels and graphical positions safely',()=>{
  const levels=buildFibLevels(80,100,'UP'),next=adjacentFibLevels(levels,93);
  assert.ok(next.above.price>93);
  assert.ok(next.below.price<93);
  assert.ok(fibDistancePct(next.above,93)>0);
  assert.ok(fibDistancePct(next.below,93)<0);
  for(const level of levels){
    const y=fibPlotPosition(level.price,levels,93);
    assert.ok(y>=0&&y<=100);
  }
});

test('r6 Market integrates graphical SK Fib zones without execution',()=>{
  assert.match(html,/10\.0-r\d+/);
  assert.match(js,/REGIME \+ OPPORTUNITY CONTEXT \+ FIB MAP/);
  assert.match(js,/FIB MAP · SK OVERLAY/);
  assert.match(js,/SWING-FENSTER/);
  assert.match(js,/30 × 4h/);
  assert.match(js,/180 × 4h/);
  assert.match(js,/LONG TRENDWENDE/);
  assert.match(js,/SHORT TRENDWENDE/);
  assert.match(js,/DOPPELTER VORTEIL/);
  assert.match(js,/Gegen-Ziel ∩ GKL/);
  assert.match(js,/1\.618 \/ 1\.809 \/ 2\.000/);
  assert.match(engine,/signalTone,marketKlines/);
  assert.match(css,/\.fib-zone-bull,\.fib-zone-long/);
  assert.match(css,/\.fib-zone-bear,\.fib-zone-short/);
  assert.match(css,/\.fib-zone-double/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});

test('r6 supports manual Fib high low direction while remaining decision support only',()=>{
  assert.match(js,/id="fib-high"/);
  assert.match(js,/id="fib-low"/);
  assert.match(js,/id="fib-direction"/);
  assert.match(js,/id="fib-apply"/);
  assert.match(js,/Reaktion beobachten, nicht automatisch handeln/);
  assert.match(js,/keine Orders/i);
});

test('r6 Fib map stays mobile-first',()=>{
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/\.fib-ladder\{height:360px\}/);
  assert.match(css,/@media\(max-width:390px\)/);
  assert.match(css,/\.fib-ladder\{height:340px\}/);
});
