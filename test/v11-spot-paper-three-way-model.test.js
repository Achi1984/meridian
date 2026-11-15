import test from 'node:test';
import assert from 'node:assert/strict';
import {ARM_IDS, SPOT_PAPER_THREE_WAY_REPORT_SCHEMA, threeWayDashboardEnvelope, isSpotPaperThreeWayDashboardEnvelope} from '../scripts/spot-paper-research/three-way-dashboard-contract.mjs';
import {presentSpotPaperThreeWayReport, createSpotPaperThreeWayAdapter} from '../v11/spot-paper-three-way-model.js';
const NOW = Date.parse('2026-11-15T12:00:00.000Z');
function report() {
  const arm = strategyId => ({strategyId, valuationAt: NOW - 60_000, valuationStatus: 'MARKED_AT_COMMON_HORIZON', positionStatus: 'FLAT', finalNetEquityCents: 100_000, realizedPnlCents: 0, unrealizedPnlCents: 0, feesCents: 0, grossTurnoverCents: 0, fillCount: 0, completedRoundTripCount: 0, dataGaps: 0, maxSampledEquityDrawdownCents: 0, maxSampledEquityRelativeDrawdownBps: 0, fills: [], roundTrips: []});
  return {schemaVersion: SPOT_PAPER_THREE_WAY_REPORT_SCHEMA, status: 'COMPARISON_AVAILABLE', commonHorizonAt: NOW - 60_000, researchOnly: true, profitability: 'NOT_ASSESSED', executionImpact: false, automaticPromotion: false, input: {}, arms: {baseline: arm(ARM_IDS.baseline), challenger: arm(ARM_IDS.challenger), rangePullback: arm(ARM_IDS.rangePullback), cash: arm(ARM_IDS.cash)}};
}
test('validates and presents a read-only four-arm report', () => {
  const envelope = threeWayDashboardEnvelope(report(), '2026-11-15T11:59:30.000Z');
  assert.ok(envelope && isSpotPaperThreeWayDashboardEnvelope(envelope));
  const model = presentSpotPaperThreeWayReport(envelope, {now: NOW, staleAfterMs: 120_000});
  assert.equal(model.status, 'COMPARISON_AVAILABLE');
  assert.deepEqual(Object.keys(model.arms), ['baseline', 'challenger', 'rangePullback', 'cash']);
  assert.equal(model.arms.baseline.finalNetEquityCents.value, 100_000);
  assert.equal(model.researchOnly, true);
});
test('exposes metric units and copies report input defensively', () => {
  const source = report();
  source.input = {nested: {label: 'offline'}};
  const envelope = threeWayDashboardEnvelope(source, '2026-11-15T11:59:30.000Z');
  const model = presentSpotPaperThreeWayReport(envelope, {now: NOW, staleAfterMs: 120_000});
  assert.equal(model.arms.baseline.finalNetEquityCents.unit, 'cents');
  assert.equal(model.arms.baseline.fillCount.unit, 'count');
  assert.equal(model.arms.baseline.maxSampledEquityRelativeDrawdownBps.unit, 'bps');
  assert.notStrictEqual(model.input, source.input);
  model.input.nested.label = 'changed';
  assert.equal(source.input.nested.label, 'offline');
});
test('rejects malformed or unavailable reports and never invents zeroes', () => {
  const envelope = threeWayDashboardEnvelope(report(), '2026-11-15T11:59:30.000Z');
  envelope.report.arms.cash.strategyId = 'WRONG';
  assert.equal(presentSpotPaperThreeWayReport(envelope).available, false);
  assert.equal(presentSpotPaperThreeWayReport({}).status, 'UNKNOWN');
});
test('marks stale and missing freshness explicitly', () => {
  const envelope = threeWayDashboardEnvelope(report(), '2026-11-15T11:50:00.000Z');
  assert.equal(presentSpotPaperThreeWayReport(envelope, {now: NOW, staleAfterMs: 120_000}).status, 'STALE');
  const unknown = presentSpotPaperThreeWayReport(envelope);
  assert.equal(unknown.freshness.status, 'UNKNOWN');
  assert.equal(unknown.available, false);
  assert.equal(unknown.status, 'UNKNOWN');
  const future = threeWayDashboardEnvelope(report(), '2026-11-15T12:01:00.000Z');
  assert.equal(presentSpotPaperThreeWayReport(future, {now: NOW, staleAfterMs: 120_000}).available, false);
});
test('adapter is read-only and fails closed on reader errors', async () => {
  const adapter = createSpotPaperThreeWayAdapter({readReport: async () => { throw new Error('offline'); }});
  assert.equal((await adapter.read()).status, 'UNKNOWN');
  assert.throws(() => createSpotPaperThreeWayAdapter({readReport: 'provider'}), /injected read-only/);
});
