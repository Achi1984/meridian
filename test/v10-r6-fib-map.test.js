import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

test('v10 r6 exposes an interactive Fib Map in MARKET',()=>{
  assert.match(html,/10\.0-r6/);
  assert.match(js,/FIB MAP/);
  assert.match(js,/RETRACEMENT \+ EXTENSIONS/);
  assert.match(js,/AUTO 4H/);
  assert.match(js,/MANUAL/);
  assert.match(js,/NEXT ABOVE/);
  assert.match(js,/NEXT BELOW/);
  assert.match(js,/REGIME \+ FIB MAP \+ ASSET TAPE/);
});

test('Fib model uses 90x4h swing anchors and supports bullish and bearish continuation extensions',()=>{
  assert.match(engine,/rows4\.slice\(-90\)/);
  assert.match(engine,/swingDirection=loIdx<=hiIdx\?'BULL':'BEAR'/);
  assert.match(engine,/swingLo,swingHi,swingDirection/);
  assert.match(js,/\[0,\.236,\.382,\.5,\.618,\.786,1\]/);
  assert.match(js,/\[1\.272,1\.414,1\.618\]/);
  assert.match(js,/dir==='BULL'\?hi-span\*r:lo\+span\*r/);
  assert.match(js,/dir==='BULL'\?hi\+span\*\(r-1\):lo-span\*\(r-1\)/);
});

test('Fib manual mode accepts custom high low and direction without order execution',()=>{
  assert.match(js,/id="fib-high"/);
  assert.match(js,/id="fib-low"/);
  assert.match(js,/id="fib-direction"/);
  assert.match(js,/id="fib-apply"/);
  assert.match(js,/fibParse/);
  assert.match(js,/No trading logic lives here/);
});

test('Fib ladder renders proportional level positions and a current-price marker',()=>{
  assert.match(js,/class="fib-level/);
  assert.match(js,/class="fib-current"/);
  assert.match(js,/\(m\.max-level\.price\)\/m\.range\*100/);
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
