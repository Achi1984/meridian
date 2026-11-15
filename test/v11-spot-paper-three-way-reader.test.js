import test from 'node:test';
import assert from 'node:assert/strict';
import {ARM_IDS, SPOT_PAPER_THREE_WAY_REPORT_SCHEMA, threeWayDashboardEnvelope} from '../scripts/spot-paper-research/three-way-dashboard-contract.mjs';
import {createOfflineThreeWayReportReader} from '../v11/spot-paper-three-way-reader.js';
const HORIZON = Date.parse('2026-11-15T12:00:00.000Z');
function envelope() {
  const arm = strategyId => ({strategyId, valuationAt: HORIZON, valuationStatus: 'MARKED_AT_COMMON_HORIZON', positionStatus: 'FLAT', finalNetEquityCents: 100000, realizedPnlCents: 0, unrealizedPnlCents: 0, feesCents: 0, grossTurnoverCents: 0, fillCount: 0, completedRoundTripCount: 0, dataGaps: 0, maxSampledEquityDrawdownCents: 0, maxSampledEquityRelativeDrawdownBps: 0, fills: [], roundTrips: []});
  const report = {schemaVersion: SPOT_PAPER_THREE_WAY_REPORT_SCHEMA, status: 'COMPARISON_AVAILABLE', commonHorizonAt: HORIZON, researchOnly: true, profitability: 'NOT_ASSESSED', executionImpact: false, automaticPromotion: false, input: {}, arms: {baseline: arm(ARM_IDS.baseline), challenger: arm(ARM_IDS.challenger), rangePullback: arm(ARM_IDS.rangePullback), cash: arm(ARM_IDS.cash)}};
  return threeWayDashboardEnvelope(report, '2026-11-15T12:01:00.000Z');
}
test('reads a valid local envelope through the injected reader only', async () => {
  const source = JSON.stringify(envelope());
  const reader = createOfflineThreeWayReportReader({readText: async () => source});
  assert.deepEqual(await reader.readReport(), JSON.parse(source));
});
test('rejects missing, malformed, invalid and future-less envelopes fail closed', async () => {
  for (const raw of ['', '{', JSON.stringify({}), JSON.stringify({...envelope(), observedAt: null})]) {
    const reader = createOfflineThreeWayReportReader({readText: async () => raw});
    assert.equal(await reader.readReport(), null);
  }
});
test('rejects oversized local input before parsing', async () => {
  const reader = createOfflineThreeWayReportReader({readText: async () => 'x'.repeat(100), maxBytes: 10});
  assert.equal(await reader.readReport(), null);
});
test('never reaches network or provider code and fails closed on reader error', async () => {
  let called = 0;
  const reader = createOfflineThreeWayReportReader({readText: async () => { called++; throw new Error('offline'); }});
  assert.equal(await reader.readReport(), null);
  assert.equal(called, 1);
  assert.throws(() => createOfflineThreeWayReportReader({readText: 'fetch'}), /injected local reader/);
});
