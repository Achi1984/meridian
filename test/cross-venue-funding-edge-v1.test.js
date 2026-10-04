import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_EDGE_V1_CONFIG as cfg,
  roundTripCosts,fundingSpread,conservativeProjection,entryDecision,
  exitDecision,fundingCashflow,basisPnl,directionLegs
} from '../research/cross-venue-funding-edge-v1.js';

test('frozen cross-venue costs are exact and conservative',()=>{
  const c=roundTripCosts();
  assert.equal(c.baseBps,38);
  assert.equal(c.stressBps,50);
  assert.equal(c.baseUsd,38);
  assert.equal(c.stressUsd,50);
  assert.equal(c.entryHurdleUsd,57);
  assert.equal(c.closeBps,16.5);
  assert.equal(c.closeHurdleUsd,24.75);
});

test('funding spread direction is Bybit minus Binance',()=>{
  assert.ok(Math.abs(fundingSpread(.0001,.0003)-.0002)<1e-15);
  assert.deepEqual(directionLegs(1),{binance:'LONG',bybit:'SHORT'});
  assert.deepEqual(directionLegs(-1),{binance:'SHORT',bybit:'LONG'});
});

test('projection uses only three persistent completed spreads and minimum magnitude',()=>{
  const p=conservativeProjection([.001,.002,.0015]);
  assert.equal(p.valid,true);
  assert.equal(p.direction,1);
  assert.equal(p.conservative8hSpread,.001);
  assert.equal(p.projectedSpread,.003);
  assert.equal(p.projectedFundingUsd,30);
  assert.equal(conservativeProjection([.001,-.002,.001]).reason,'SPREAD_NOT_PERSISTENT');
  assert.equal(conservativeProjection([.001,.002]).reason,'INSUFFICIENT_SPREAD_HISTORY');
});

test('entry hurdle is strict at 1.5 times baseline round-trip cost',()=>{
  assert.equal(entryDecision([.0019,.0019,.0019]).active,false);
  assert.equal(entryDecision([.00191,.00191,.00191]).active,true);
  assert.equal(entryDecision([-.00191,-.002,-.0021]).projection.direction,-1);
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
  assert.equal(basisPnl({binanceSide:'LONG',binanceQty:1,binanceEntry:100,binanceMark:110,bybitSide:'SHORT',bybitQty:1,bybitEntry:101,bybitMark:108}),3);
});

test('frozen config remains BTC-only with no leverage credit',()=>{
  assert.equal(cfg.symbol,'BTCUSDT');
  assert.equal(cfg.notionalPerLeg,10000);
  assert.equal(cfg.reservedCapital,20000);
  assert.equal(cfg.maxHoldingHours,24);
});
