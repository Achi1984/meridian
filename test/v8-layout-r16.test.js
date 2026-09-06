import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/layout-r16.css',import.meta.url),'utf8');

test('R16 loads isolated cross-view density stylesheet',()=>{
  assert.match(html,/layout-r16\.css\?v=8\.0-r16/);
  assert.match(css,/#view-depot \.depot-performance/);
  assert.match(css,/#view-trade \.trade-r12-detail/);
  assert.match(css,/#view-paper \.research-row/);
  assert.match(css,/#view-more \.card/);
});

test('R16 keeps presentation changes mobile-scoped',()=>{
  assert.match(css,/@media \(max-width:520px\)/);
  assert.match(css,/grid-template-columns:minmax\(92px,.52fr\) minmax\(0,1.78fr\)/);
  assert.match(css,/#view-paper \.paper-oc\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('R16 remains read-only and does not alter execution',()=>{
  assert.doesNotMatch(css,/fetch\(|authorization|MERIDIAN_READ_TOKEN|placeOrder|createOrder|submitOrder|liveTrading|server\.js/i);
});
