import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const trade=fs.readFileSync(new URL('../v8-clean/trade-details-r12.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const label=fs.readFileSync(new URL('../v8-clean/layout-r17.js',import.meta.url),'utf8');

test('R17 TRADE formatters do not coerce missing values to zero',()=>{
  assert.match(trade,/function present\(v\)/);
  assert.match(trade,/v!==null&&v!==undefined&&v!==''/);
  assert.match(trade,/function usd\(v,d=0\)\{return present\(v\)/);
  assert.match(trade,/function price\(v\)\{\n  if\(!present\(v\)\)return '—'/);
});

test('R17 preserves explicit zero PnL but rejects absent price and investment placeholders',()=>{
  assert.match(trade,/pnl:explicitNumber\(b,\['pnlUsd','unrealizedPnlUsd','pnl'\]\)/);
  assert.match(trade,/investment:positive\(b\?\.investmentUsd\)/);
  assert.match(trade,/be:positive\(b\?\.breakEvenPrice\)/);
});

test('R17 DEPOT presents canonical history without backend identifier noise',()=>{
  assert.match(label,/POSTGRES_\[A-Z0-9_\]\+/);
  assert.match(label,/Canonical History/);
  assert.match(index,/layout-r17\.js\?v=8\.0-r17/);
  assert.match(index,/trade-details-r12\.js\?v=8\.0-r17/);
});
