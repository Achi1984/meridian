import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../funding-carry-paper-v1.js',import.meta.url),'utf8');

test('R38 shows break-even and funding settlement timing without another request',()=>{
  assert.match(core,/breakEvenRemaining/);assert.match(core,/nextFundingTime/);assert.match(core,/lastSettlement/);
  assert.match(app,/Bis Break-even/);assert.match(app,/nächste Funding-Abrechnung/);assert.match(app,/Letzte Gutschrift/);
  assert.doesNotMatch(app,/getJson\('\/api\/funding-carry-v1'/);
});

test('R38 telemetry remains read-only presentation',()=>{
  assert.doesNotMatch(app+core,/placeOrder|createOrder|submitOrder|method\s*:\s*['"]POST/i);
});
