import test from 'node:test';
import assert from 'node:assert/strict';
import {REGIME_TREND_BREAKOUT_V1} from '../research/paper-profit-regime-trend-breakout-v1-preregistration.js';

test('Regime Trend Breakout V1 is fully frozen before results',()=>{
  const x=REGIME_TREND_BREAKOUT_V1;
  assert.equal(x.ruleset,'PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1');
  assert.deepEqual(x.universe,['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
  assert.equal(x.regime.adxPeriod,14);
  assert.equal(x.regime.minAdx,25);
  assert.equal(x.regime.smaPeriod,200);
  assert.equal(x.breakout.entryChannelDays,55);
  assert.equal(x.breakout.exitChannelDays,20);
  assert.equal(x.sizing.realizedVolDays,60);
  assert.equal(x.sizing.targetVolAnnual,0.10);
  assert.equal(x.sizing.maxLeverage,2);
  assert.equal(x.costs.baselineBps,8);
  assert.equal(x.costs.stressBps,16);
  assert.equal(x.split.discoveryFraction,0.70);
  assert.equal(x.split.holdoutFraction,0.30);
  assert.equal(x.split.holdoutBlockedUntilDiscoveryPass,true);
  assert.equal(x.gate.maxDrawdownPct,20);
  assert.equal(x.gate.minProfitFactor,1.15);
  assert.equal(x.executionImpact,false);
  assert.equal(x.autoPromotion,false);
});

test('TSMOM V2 frozen result keeps holdout untouched after discovery fail',async()=>{
  const fs=await import('node:fs');
  const doc=fs.readFileSync('research/PAPERBOT-PROFIT-TSMOM-V2-RESULT.md','utf8');
  assert.ok(doc.includes('TSMOM_V2_DISCOVERY_FAIL'));
  assert.ok(doc.includes('Holdout returns were **not evaluated**'));
  assert.ok(doc.includes('Artifact: **11113377407**'));
});
