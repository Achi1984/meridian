import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_EDGE_V1_CONFIG as cfg,
  roundTripCosts,fundingSpread,conservativeProjection,entryDecision,
  exitDecision,fundingCashflow,basisPnl,directionLegs
} from '../research/cross-venue-funding-edge-v1.js';

test('frozen Binance/OKX costs are exact and conservative',()=>{
  const c=roundTripCosts();
  assert.equal(c.baseBps,37);
  assert.equal(c.stressBps,49);
  assert.equal(c.baseUsd,37);
  assert.equal(c.stressUsd,49);
  assert.equal(c.entryHurdleUsd,55.5);
  assert.equal(c.closeBps,16);
  assert.equal(c.closeHurdleUsd,24);
});

test('funding spread direction is OKX minus Binance',()=>{
  assert.ok(Math.abs(fundingSpread(.0001,.0003)-.0002)<1e-15);
  assert.deepEqual(directionLegs(1),{binance:'LONG',okx:'SHORT'});
  assert.deepEqual(directionLegs(-1),{binance:'SHORT',okx:'LONG'});
});

test('projection uses only three persistent completed spreads and minimum magnitude',()=>{
  const p=conservativeProjection([.001,.002,.0015]);
  assert.equal(p.valid,true);
  assert.equal(p.direction,1);
  assert.equal(p.directionLabel,'LONG_BINANCE_SHORT_OKX');
  assert.equal(p.conservative8hSpread,.001);
  assert.equal(p.projectedSpread,.003);
  assert.equal(p.projectedFundingUsd,30);
  assert.equal(conservativeProjection([.001,-.002,.001]).reason,'SPREAD_NOT_PERSISTENT');
  assert.equal(conservativeProjection([.001,.002]).reason,'INSUFFICIENT_SPREAD_HISTORY');
});

test('entry hurdle is strict at 1.5 times baseline round-trip cost',()=>{
  assert.equal(entryDecision([.00185,.00185,.00185]).active,false);
  assert.equal(entryDecision([.00186,.00186,.00186]).active,true);
  assert.equal(entryDecision([-.00186,-.002,-.0021]).projection.direction,-1);
});

test('exit rules fail closed and enforce basis, reversal, economics and horizon',()=>{
  assert.equal(exitDecision({heldDirection:1,spreads:[.003,.003,.003],remainingHours:16,basisPnlUsd:-101}).reason,'BASIS_RISK_LIMIT');
  assert.equal(exitDecision({heldDirection:1,spreads:[-.003,-.003,-.003],remainingHours:16,basisPnlUsd:0}).reason,'SPREAD_REVERSAL');
  assert.equal(exitDecision({heldDirection:1,spreads:[.0001,.0001,.0001],remainingHours:16,basisPnlUsd:0}).reason,'REMAINING_FUNDING_BELOW_EXIT_HURDLE');
  assert.equal(exitDecision({heldDirection:1,spreads:[.003,.003,.003],remainingHours:0,basisPnlUsd:0}).reason,'MAX_HOLDING_HORIZON');
  assert.equal(exitDecision({heldDirection:1,spreads:[.003,.003,.003],remainingHours:16,basisPnlUsd:0,integrityOk:false}).inconclusive,true);
  assert.equal(exitDecision({heldDirection:1,spreads:[.003,.003,.003],remainingHours:16,basisPnlUsd:0}).exit,false);
});

test('funding and basis accounting preserve venue-side sign',()=>{
  assert.equal(fundingCashflow({side:'LONG',qty:1,mark:10000,rate:.001}),-10);
  assert.equal(fundingCashflow({side:'SHORT',qty:1,mark:10000,rate:.001}),10);
  assert.equal(basisPnl({binanceSide:'LONG',binanceQty:1,binanceEntry:100,binanceMark:110,okxSide:'SHORT',okxQty:1,okxEntry:101,okxMark:108}),3);
});

test('frozen config remains BTC-only with no leverage credit',()=>{
  assert.equal(cfg.symbol,'BTCUSDT');
  assert.equal(cfg.venues.binance,'BINANCE_USDM');
  assert.equal(cfg.venues.okx,'OKX_USDT_SWAP');
  assert.equal(cfg.notionalPerLeg,10000);
  assert.equal(cfg.reservedCapital,20000);
  assert.equal(cfg.maxHoldingHours,24);
});
