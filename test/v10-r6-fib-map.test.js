import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectSwing,buildFibLevels,adjacentFibLevels,fibDistancePct,fibPlotPosition} from '../v10/fib-core.js';

test('r6 detects swing direction from 4h extrema chronology',()=>{
  const rows=[
    {openTime:1,high:90,low:82},
    {openTime:2,high:92,low:80},
    {openTime:3,high:96,low:85},
    {openTime:4,high:100,low:88},
  ];
  const s=detectSwing(rows,4);
  assert.equal(s.low,80);
  assert.equal(s.high,100);
  assert.equal(s.direction,'UP');
  assert.equal(s.bars,4);
});

test('r6 bullish Fib retracement and extensions use standard swing orientation',()=>{
  const levels=buildFibLevels(80,100,'UP');
  const by=x=>levels.find(l=>Math.abs(l.ratio-x)<1e-9)?.price;
  assert.equal(by(0),100);
  assert.equal(by(.236),95.28);
  assert.equal(by(.382),92.36);
  assert.equal(by(.5),90);
  assert.equal(by(.618),87.64);
  assert.equal(by(1),80);
  assert.equal(by(1.272),105.44);
  assert.equal(by(1.618),112.36);
});

test('r6 bearish Fib mirrors retracement and continuation extensions',()=>{
  const levels=buildFibLevels(80,100,'DOWN');
  const by=x=>levels.find(l=>Math.abs(l.ratio-x)<1e-9)?.price;
  assert.equal(by(0),80);
  assert.equal(by(.236),84.72);
  assert.equal(by(.618),92.36);
  assert.equal(by(1),100);
  assert.equal(by(1.272),74.56);
  assert.equal(by(1.618),67.64);
});

test('r6 identifies next Fib levels above and below current price',()=>{
  const levels=buildFibLevels(80,100,'UP');
  const next=adjacentFibLevels(levels,93);
  assert.equal(next.above.label,'0.236');
  assert.equal(next.above.price,95.28);
  assert.equal(next.below.label,'0.382');
  assert.equal(next.below.price,92.36);
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

test('r6 Market integration exposes auto 4h and manual Fib controls without execution',()=>{
  const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
  const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
  assert.match(js,/REGIME \+ FIB MAP \+ ASSET TAPE/);
  assert.match(js,/SWING-FENSTER/);
  assert.match(js,/30 × 4h/);
  assert.match(js,/180 × 4h/);
  assert.match(js,/NEXT ↑/);
  assert.match(js,/NEXT ↓/);
  assert.match(js,/MANUAL/);
  assert.match(engine,/signalTone,marketKlines/);
  assert.match(css,/\.fib-ladder/);
  assert.match(css,/\.fib-next-up/);
  assert.match(css,/\.fib-next-down/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});
