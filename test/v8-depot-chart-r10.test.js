import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v8-clean/depot-chart-r10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/depot-chart-r10.css',import.meta.url),'utf8');

test('R10 depot chart exposes 4H 1T 1W and high low metrics',()=>{
  assert.match(html,/depot-chart-r10\.js\?v=8\.0-r10/);
  assert.match(html,/depot-chart-r10\.css\?v=8\.0-r10/);
  assert.match(js,/RANGE_MS=\{"4h":4\*60\*60\*1000,"1d":24\*60\*60\*1000,"1w":7\*24\*60\*60\*1000\}/);
  assert.match(js,/RANGE_LABEL=\{"4h":"4H","1d":"1T","1w":"1W"\}/);
  assert.match(js,/HIGH \$\{usd\(s\.hi\)\}/);
  assert.match(js,/LOW \$\{usd\(s\.lo\)\}/);
  assert.match(js,/class="depot-r10-point high"/);
  assert.match(js,/class="depot-r10-point low"/);
});

test('R10 uses canonical protected history and slices 4H client-side from 1D',()=>{
  assert.match(js,/backendRange=range==='1w'\?'1w':'1d'/);
  assert.match(js,/\/api\/private\/portfolio-history\?range=\$\{backendRange\}/);
  assert.match(js,/authorization:`Bearer \$\{t\}`/);
  assert.match(js,/p\.t>=cut/);
  assert.doesNotMatch(js,/same-origin|legacy|querySelector\([^\n]*(portfolio|holding|totalUsd)/i);
});

test('R10 remains presentation-only',()=>{
  const all=js+css;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|liveTrading\s*=\s*true/i);
  assert.match(css,/\.depot-r10-toolbar/);
  assert.match(css,/@media\(max-width:520px\)/);
});
