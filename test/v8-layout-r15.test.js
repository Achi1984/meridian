import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v8-clean/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v8-clean/layout-r15.css',import.meta.url),'utf8');

test('R15 loads isolated mobile spacing polish',()=>{
  assert.match(html,/layout-r15\.css\?v=8\.0-r15/);
  assert.match(css,/@media \(max-width:520px\)/);
  assert.match(css,/\.views\{padding-top:12px\}/);
});

test('R15 tightens CENTER hierarchy without changing behavior',()=>{
  assert.match(css,/#view-center \.hero/);
  assert.match(css,/#view-center \.hero-value/);
  assert.match(css,/#view-center \.metric/);
  assert.match(css,/#view-center \.action/);
  assert.doesNotMatch(css,/display\s*:\s*none[^}]*#view-|pointer-events\s*:\s*none|position\s*:\s*fixed[^}]*#view-/i);
});

test('R15 remains presentation-only',()=>{
  assert.doesNotMatch(css,/fetch\(|authorization|MERIDIAN_READ_TOKEN|placeOrder|createOrder|submitOrder|liveTrading/i);
});
