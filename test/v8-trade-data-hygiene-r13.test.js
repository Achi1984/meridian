import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v8-clean/trade-details-r12.js',import.meta.url),'utf8');

test('R13 cache tag is wired',()=>{
  assert.match(html,/trade-details-r12\.js\?v=8\.0-r13/);
});

test('R13 suppresses zero placeholders for break-even and investment',()=>{
  assert.match(js,/function positive\(v\)/);
  assert.match(js,/be:positive\(b\?\.breakEvenPrice\)/);
  assert.match(js,/investment:positive\(b\?\.investmentUsd\)/);
  assert.match(js,/price\(b\.be\)/);
  assert.match(js,/usd\(b\.investment,0\)/);
});

test('R13 only accepts zero pnl when a concrete pnl field is actually present',()=>{
  assert.match(js,/function explicitNumber\(obj,keys\)/);
  assert.match(js,/pnl:explicitNumber\(b,\['pnlUsd','unrealizedPnlUsd','pnl'\]\)/);
});

test('R13 remains read-only',()=>{
  assert.doesNotMatch(js,/placeOrder|createOrder|submitOrder|dashboard-update|x-meridian-write-token|method\s*:\s*['\"]POST/i);
});
