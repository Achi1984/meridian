import test from 'node:test';
import assert from 'node:assert/strict';
import {CROSS_ASSET_FUNDING_CARRY_ROTATION_V1 as C,selectFundingCarryAsset} from '../cross-asset-funding-carry-rotation-v1.js';

test('frozen cross-asset carry contract stays fixed',()=>{
  assert.deepEqual(C.symbols,['BTCUSDT','ETHUSDT','SOLUSDT']);
  assert.equal(C.fundingWarmupStart,'2020-12-01T00:00:00.000Z');
  assert.equal(C.evaluationStart,'2021-01-01T00:00:00.000Z');
  assert.equal(C.splitAt,'2023-07-01T00:00:00.000Z');
  assert.equal(C.evaluationEnd,'2026-06-01T00:00:00.000Z');
  assert.equal(C.cooldownMs,24*3600000);
  assert.equal(C.extraStressUsdPerCycle,8);
});

test('selector takes highest exact-V2 cost coverage among eligible assets',()=>{
  const x=selectFundingCarryAsset([
    {symbol:'BTCUSDT',eligibility:{eligible:true,grossCostCoverage:2.4}},
    {symbol:'ETHUSDT',eligibility:{eligible:true,grossCostCoverage:3.1}},
    {symbol:'SOLUSDT',eligibility:{eligible:false,grossCostCoverage:5.0}}
  ]);
  assert.equal(x.symbol,'ETHUSDT');
});

test('selector tie-break is BTC then ETH then SOL and ineligible assets never win',()=>{
  const x=selectFundingCarryAsset([
    {symbol:'SOLUSDT',eligibility:{eligible:true,grossCostCoverage:2.5}},
    {symbol:'ETHUSDT',eligibility:{eligible:true,grossCostCoverage:2.5}},
    {symbol:'BTCUSDT',eligibility:{eligible:true,grossCostCoverage:2.5}}
  ]);
  assert.equal(x.symbol,'BTCUSDT');
  assert.equal(selectFundingCarryAsset([{symbol:'BTCUSDT',eligibility:{eligible:false,grossCostCoverage:9}}]),null);
});
