import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync(new URL('../scripts/hybrid-alpha-v790-evidence.mjs',import.meta.url),'utf8');

test('evidence runner stays research-only and public-data based',()=>{
  assert.match(src,/researchOnly:true/);
  assert.match(src,/executionImpact:false/);
  assert.match(src,/fapi\.binance\.com/);
  assert.doesNotMatch(src,/order|placeOrder|server\.js|pionex/i);
});

test('forward outcomes are non-overlapping and use decision-time ATR normalization',()=>{
  assert.match(src,/i\+=horizonBars/);
  assert.match(src,/forwardR=fwd\/atrPct/);
});

test('trend contains 15m 1h and 4h decision-time evidence',()=>{
  assert.match(src,/trend15m:trend15/);
  assert.match(src,/trend1h/);
  assert.match(src,/trend4h/);
  assert.match(src,/closedBucketEma/);
});

test('missing carry is documented rather than fabricated',()=>{
  assert.match(src,/No funding\/carry input/);
  assert.doesNotMatch(src,/carry:/);
});
