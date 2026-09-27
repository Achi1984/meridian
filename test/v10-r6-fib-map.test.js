import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectSwing,buildFibLevels,adjacentFibLevels,fibPlotPosition} from '../v10/fib-core.js';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

test('v10 r6 exposes an interactive Fib Map in MARKET',()=>{
  assert.match(html,/10\.0-r6/);
  assert.match(js,/FIB MAP/);
  assert.match(js,/RETRACEMENT \+ EXTENSIONS/);
  assert.match(js,/SWING-FENSTER/);
  assert.match(js,/AUTO/);
  assert.match(js,/MANUAL/);
  assert.match(js,/NEXT ↑/);
  assert.match(js,/NEXT ↓/);
  assert.match(js,/REGIME \+ FIB MAP \+ ASSET TAPE/);
});

test('Fib core detects swing order and supports retracements plus 1.272 1.414 1.618 extensions',()=>{
  const rows=[
    {low:100,high:110,openTime:1},
    {low:90,high:105,openTime:2},
    {low:95,high:130,openTime:3},
  ];
  const sw=detectSwing(rows,90);
  assert.equal(sw.low,90);
  assert.equal(sw.high,130);
  assert.equal(sw.direction,'UP');
  const levels=buildFibLevels(90,130,'UP');
  for(const ratio of [0,.236,.382,.5,.618,.786,1,1.272,1.414,1.618]){
    assert.ok(levels.some(x=>Math.abs(x.ratio-ratio)<1e-12),'missing '+ratio);
  }
  assert.equal(buildFibLevels(90,130,'DOWN').find(x=>x.ratio===.618).price,90+40*.618);
});

test('Fib manual mode accepts custom high low and direction without order execution',()=>{
  assert.match(js,/id="fib-high"/);
  assert.match(js,/id="fib-low"/);
  assert.match(js,/id="fib-direction"/);
  assert.match(js,/id="fib-apply"/);
  assert.match(js,/fibParse/);
  assert.match(js,/No trading logic lives here/);
});

test('Fib ladder identifies adjacent levels and proportional positions',()=>{
  const levels=buildFibLevels(100,200,'UP');
  const next=adjacentFibLevels(levels,160);
  assert.ok(next.above&&next.below);
  const y=fibPlotPosition(160,levels,160);
  assert.ok(y>=0&&y<=100);
  assert.match(js,/class="fib-level/);
  assert.match(js,/class="fib-current"/);
  assert.match(css,/\.fib-ladder\{position:relative;height:390px/);
  assert.match(css,/\.fib-extension/);
  assert.match(css,/\.fib-retracement/);
  assert.match(css,/\.fib-current/);
});

test('Fib map remains mobile-first',()=>{
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/\.fib-ladder\{height:360px\}/);
  assert.match(css,/@media\(max-width:390px\)/);
  assert.match(css,/\.fib-ladder\{height:340px\}/);
});
