import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../app-v8.0-navigation.js',import.meta.url),'utf8');

test('v8 customer navigation contains exactly the five intended top-level items',()=>{
  for(const label of ['CENTER','DEPOT','TRADE','PAPER','MORE']) assert.match(src,new RegExp(`label:'${label}'`));
  assert.match(src,/grid-template-columns:repeat\(5/);
});

test('v8 navigation is presentation-only and delegates existing routes',()=>{
  assert.match(src,/executionImpact:false/);
  assert.match(src,/legacy\.click\(\)/);
  assert.doesNotMatch(src,/placeOrder|createOrder|submitOrder|liveTrading\s*=\s*true|fetch\([^\n]*(order|trade)/i);
});

test('legacy bottom navigation is hidden only after v8 nav is ready',()=>{
  assert.match(src,/v8-legacy-bottom-hidden/);
  assert.match(src,/v8-nav-ready/);
  assert.match(src,/safe-area-inset-bottom/);
});
