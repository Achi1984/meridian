import test from 'node:test';
import assert from 'node:assert/strict';
import {auditHolderReport} from '../v11/holder-comparison.js';

function audit(evidence, counts, openBuy = false) {
  const account = {policy:'fixed', cashUsdc:1000, realizedUsdc:0, closedTrades:0, openPositions:[]};
  const fills = openBuy ? ['C','H'].map(account => ({
    account, positionId:'open', qty:100, usdcRaw:20_000_000, side:'buy'
  })) : [];
  if (openBuy) {
    account.cashUsdc = 979.95;
    account.openPositions.push({positionId:'open', qty:100});
  }
  const status = {
    ledgerVerified:true, startedAt:1, updatedAt:3, lastEvent:'handoff', accounts:{C:account, H:account},
    holderComparison:{reference:'C', filtered:'H', thresholdBps:2000, entryStates:counts,
      skippedReferenceEntries:0, realizedDeltaUsdc:0}
  };
  const journal = ['start','entry','handoff'].map((event, i) => JSON.stringify({
    event, eventId:String(i), at:i+1, arm:'wave', fills:event === 'entry' ? fills : [], holderEvidence:evidence
  })).join('\n');
  return auditHolderReport(status, journal);
}

test('measured holder states match the inclusive threshold and journal counts', () => {
  const evidence = {state:'high', largestOwnerBps:2000, sampledSupplyBps:6000};
  assert.equal(audit(evidence, {high:1}).unknown, 0);
  assert.throws(() => audit({...evidence, largestOwnerBps:1999}, {high:1}), /measurement/);
  assert.throws(() => audit({...evidence, sampledSupplyBps:1999}, {high:1}), /measurement/);
  assert.throws(() => audit(evidence, {belowThreshold:1}), /comparison/);
  assert.equal(audit({...evidence, state:'belowThreshold', largestOwnerBps:1999}, {belowThreshold:1}).unknown, 0);
});

test('stale measurements count only as unknown', () => {
  const report = audit({state:'unknown', reason:'staleOrLate', largestOwnerBps:9000}, {unknown:1});
  assert.equal(report.unknown, 1);
  assert.equal(report.measured, 0);
  assert.equal(report.maxOwnerBps, null);
});

test('measured zero and open purchase cost survive journal reconciliation', () => {
  const report = audit({state:'belowThreshold', largestOwnerBps:0, sampledSupplyBps:100},
    {belowThreshold:1}, true);
  assert.equal(report.measured, 1);
  assert.equal(report.maxOwnerBps, 0);
  for (const row of report.rows) assert.deepEqual(row, {net:0, open:1, closed:0, openCost:20.05});
});
