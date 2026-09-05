import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v8-clean/depot-chart-r10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/depot-chart-r10.css',import.meta.url),'utf8');

test('depot chart exposes 4H 1T 1W and high low metrics',()=>{
  assert.match(html,/depot-chart-r10\.js\?v=8\.0-r11/);
  assert.match(html,/depot-chart-r10\.css\?v=8\.0-r11/);
  assert.match(js,/RANGE_MS=\{"4h":4\*60\*60\*1000,"1d":24\*60\*60\*1000,"1w":7\*24\*60\*60\*1000\}/);
  assert.match(js,/RANGE_LABEL=\{"4h":"4H","1d":"1T","1w":"1W"\}/);
  assert.match(js,/HIGH <b>\$\{usd\(s\.hi\)\}/);
  assert.match(js,/LOW <b>\$\{usd\(s\.lo\)\}/);
  assert.match(js,/class="depot-r10-point high"/);
  assert.match(js,/class="depot-r10-point low"/);
});

test('depot chart uses canonical protected history and slices 4H client-side from 1D',()=>{
  assert.match(js,/backendRange=range==='1w'\?'1w':'1d'/);
  assert.match(js,/\/api\/private\/portfolio-history\?range=\$\{backendRange\}/);
  assert.match(js,/authorization:`Bearer \$\{t\}`/);
  assert.match(js,/p\.t>=cut/);
  assert.doesNotMatch(js,/same-origin|legacy|querySelector\([^\n]*(portfolio|holding|totalUsd)/i);
});

test('R11 mobile polish gives chart more width and extrema more breathing room',()=>{
  assert.match(css,/grid-template-columns:minmax\(108px,\.58fr\) minmax\(0,2fr\)/);
  assert.match(css,/\.depot-r10-label\{font:700 8\.5px/);
  assert.match(css,/\.depot-r10-label\{font-size:7\.5px/);
  assert.match(js,/highLabelY=Math\.max\(11,hp\.y-14\)/);
  assert.match(js,/lowLabelY=Math\.min\(h-6,lp\.y\+21\)/);
});

test('depot chart remains presentation-only',()=>{
  const all=js+css;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|liveTrading\s*=\s*true/i);
  assert.match(css,/\.depot-r10-toolbar/);
  assert.match(css,/@media\(max-width:520px\)/);
});
