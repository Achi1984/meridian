import {isSpotPaperThreeWayDashboardEnvelope, ARM_IDS} from '../scripts/spot-paper-research/three-way-dashboard-contract.mjs';
function freshness(observedAt, now, staleAfterMs) {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(now) || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0 || timestamp > now) return {status: 'UNKNOWN', ageMs: null};
  const ageMs = now - timestamp;
  return {status: ageMs > staleAfterMs ? 'STALE' : 'WITHIN_DISPLAY_POLICY', ageMs};
}
function value(value, reason = 'METRIC_MISSING') { return Number.isSafeInteger(value) ? {value, reason: null} : {value: null, reason}; }
function armView(arm) {
  return {strategyId: arm.strategyId, valuationAt: arm.valuationAt, positionStatus: arm.positionStatus,
    finalNetEquityCents: value(arm.finalNetEquityCents), realizedPnlCents: value(arm.realizedPnlCents),
    unrealizedPnlCents: value(arm.unrealizedPnlCents), feesCents: value(arm.feesCents),
    grossTurnoverCents: value(arm.grossTurnoverCents), fillCount: value(arm.fillCount),
    completedRoundTripCount: value(arm.completedRoundTripCount), dataGaps: value(arm.dataGaps),
    maxSampledEquityDrawdownCents: value(arm.maxSampledEquityDrawdownCents),
    maxSampledEquityRelativeDrawdownBps: value(arm.maxSampledEquityRelativeDrawdownBps)};
}
export function presentSpotPaperThreeWayReport(input, {now = null, staleAfterMs = null} = {}) {
  const unavailable = {available: false, status: 'UNKNOWN', freshness: {status: 'UNKNOWN', ageMs: null}};
  if (!isSpotPaperThreeWayDashboardEnvelope(input)) return unavailable;
  const report = input.report;
  const age = freshness(input.observedAt, now, staleAfterMs);
  if (age.status === 'UNKNOWN') return unavailable;
  const arms = Object.fromEntries(Object.keys(ARM_IDS).map(name => [name, armView(report.arms[name])]));
  return {available: true, status: age.status === 'STALE' ? 'STALE' : 'COMPARISON_AVAILABLE', researchOnly: true,
    profitability: 'NOT_ASSESSED', executionImpact: false, automaticPromotion: false, observedAt: input.observedAt,
    commonHorizonAt: report.commonHorizonAt, freshness: age, input: report.input, arms};
}
export function createSpotPaperThreeWayAdapter({readReport} = {}) {
  if (readReport !== undefined && typeof readReport !== 'function') throw new TypeError('readReport must be an injected read-only function');
  return Object.freeze({async read(options = {}) { if (!readReport) return presentSpotPaperThreeWayReport(null, options); try { return presentSpotPaperThreeWayReport(await readReport(), options); } catch { return presentSpotPaperThreeWayReport(null, options); } }});
}
