import test from 'node:test';
import assert from 'node:assert/strict';
import {CROSS_ASSET_FUNDING_CARRY_RISK_BUDGET_V1 as C,cyclicAdmissionOrder,nextAdmissionPointer} from '../cross-asset-funding-carry-risk-budget-v1.js';

test('frozen risk-budget contract stays fixed',()=>{
  assert.deepEqual(C.symbols,['BTCUSDT','ETHUSDT','SOLUSDT']);
  assert.equal(C.maxConcurrent,2);
  assert.equal(C.portfolioReferenceCapital,60000);
  assert.equal(C.sleeveCapital,20000);
  assert.equal(C.initialPointer,'BTCUSDT');
});
test('admission pointer is deterministic round robin',()=>{
  assert.deepEqual(cyclicAdmissionOrder('ETHUSDT'),['ETHUSDT','SOLUSDT','BTCUSDT']);
  assert.equal(nextAdmissionPointer('BTCUSDT'),'ETHUSDT');
  assert.equal(nextAdmissionPointer('ETHUSDT'),'SOLUSDT');
  assert.equal(nextAdmissionPointer('SOLUSDT'),'BTCUSDT');
});
