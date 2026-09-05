import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v8-clean/trade-details-r12.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/trade-details-r12.css',import.meta.url),'utf8');

test('R12 TRADE loads detail module and styles',()=>{
  assert.match(html,/trade-details-r12\.css\?v=8\.0-r12/);
  assert.match(html,/trade-details-r12\.js\?v=8\.0-r1[23]/);
});

test('R12 reads private dashboard and exposes bot detail fields',()=>{
  assert.match(js,/getJson\('\/api\/private\/dashboard'\)/);
  for(const field of ['CURRENT','BREAK-EVEN','LIQ PRICE','PNL','INVEST','BUFFER'])assert.match(js,new RegExp(field));
  assert.match(js,/livePrices/);
  assert.match(js,/breakEvenPrice/);
  assert.match(js,/liquidationPrice/);
  assert.match(js,/pnlUsd/);
});

test('R12 has fixed DANGER WATCH SAFE ladder and SAFE path',()=>{
  assert.match(js,/DANGER &lt;8%/);
  assert.match(js,/WATCH 8–12%/);
  assert.match(js,/SAFE ≥12%/);
  assert.match(js,/Noch \$\{missing\.toLocaleString/);
  assert.match(js,/SAFE-PFAD/);
  assert.match(css,/trade-r12-ladder/);
});

test('R12 uses details disclosure and preserves compact card on read failure',()=>{
  assert.match(js,/<details class="trade-r12-bot/);
  assert.match(js,/compact\.innerHTML=/);
  assert.match(js,/keep canonical compact TRADE card intact on read failure/);
  assert.match(css,/trade-r12-bot summary/);
});

test('R12 remains presentation/read-only',()=>{
  const all=js+css;
  assert.doesNotMatch(all,/placeOrder|createOrder|submitOrder|dashboard-update|holdings-sync|x-meridian-write-token|liveTrading\s*=\s*true|fetch\([^\n]*method\s*:\s*['\"]POST/i);
  assert.doesNotMatch(all,/server\.js/);
});
