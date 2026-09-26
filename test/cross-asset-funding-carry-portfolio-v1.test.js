import test from 'node:test';
import assert from 'node:assert/strict';
import {CROSS_ASSET_FUNDING_CARRY_PORTFOLIO_V1 as C} from '../cross-asset-funding-carry-portfolio-v1.js';

test('frozen portfolio carry contract stays fixed',()=>{
  assert.deepEqual(C.symbols,['BTCUSDT','ETHUSDT','SOLUSDT']);
  assert.equal(C.fundingWarmupStart,'2020-12-01T00:00:00.000Z');
  assert.equal(C.evaluationStart,'2021-01-01T00:00:00.000Z');
  assert.equal(C.splitAt,'2023-07-01T00:00:00.000Z');
  assert.equal(C.evaluationEnd,'2026-06-01T00:00:00.000Z');
  assert.equal(C.cooldownMs,24*3600000);
  assert.equal(C.sleeveCapital,20000);
  assert.equal(C.portfolioReferenceCapital,60000);
  assert.equal(C.extraStressUsdPerCycle,8);
});
