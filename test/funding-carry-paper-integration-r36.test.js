import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../v8-clean/app.js',import.meta.url),'utf8');

test('R36 isolates the carry ledger and exposes it through the existing fast status request',()=>{
  assert.match(server,/FUNDING_CARRY_STATE_KEY="funding_carry_v1"/);
  assert.match(server,/fundingCarry:await fundingCarryStatus\(\)/);
  assert.match(server,/u\.pathname==="\/api\/funding-carry-v1"/);
  assert.match(gateway,/"\/api\/funding-carry-v1"/);
  assert.match(data,/fundingCarry:status\?\.fundingCarry\|\|null/);
  assert.match(app,/BTC FUNDING CARRY V1/);
});

test('R36 remains paper-only and has no venue execution path',()=>{
  const module=fs.readFileSync(new URL('../funding-carry-paper-v1.js',import.meta.url),'utf8');
  assert.match(module,/executionImpact:false/);assert.match(module,/autoPromotion:false/);
  assert.doesNotMatch(module,/placeOrder|createOrder|submitOrder|Pionex|apiKey|secret/i);
});
