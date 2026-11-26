import test from 'node:test';
import assert from 'node:assert/strict';
import {auditHolderReport} from '../v11/holder-comparison.js';

function audit(evidence, counts) {
  const account = {policy:'fixed', cashUsdc:1000, realizedUsdc:0, closedTrades:0, openPositions:[]};
  const status = {
    ledgerVerified:true, startedAt:1, updatedAt:3, lastEvent:'handoff', accounts:{C:account, H:account},
    holderComparison:{reference:'C', filtered:'H', thresholdBps:2000, entryStates:counts,
      skippedReferenceEntries:0, realizedDeltaUsdc:0}
  };
  const journal = ['start','entry','handoff'].map((event, i) => JSON.stringify({
    event, eventId:String(i), at:i+1, arm:'wave', fills:[], holderEvidence:evidence
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
  assert.equal(audit({state:'unknown', reason:'staleOrLate', largestOwnerBps:9000}, {unknown:1}).unknown, 1);
});
