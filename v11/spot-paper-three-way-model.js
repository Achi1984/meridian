import {isSpotPaperThreeWayDashboardEnvelope, ARM_IDS} from '../scripts/spot-paper-research/three-way-dashboard-contract.mjs?v=B19-M11';
function freshness(observedAt, now, staleAfterMs) {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(now) || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0 || timestamp > now) return {status: 'UNKNOWN', ageMs: null};
  const ageMs = now - timestamp;
  return {status: ageMs > staleAfterMs ? 'STALE' : 'WITHIN_DISPLAY_POLICY', ageMs};
}
function value(value, unit, reason = 'METRIC_MISSING') {
  return Number.isSafeInteger(value) ? {value, unit, reason: null} : {value: null, unit, reason};
}
function armView(arm) {
  return {strategyId: arm.strategyId, valuationAt: arm.valuationAt, positionStatus: arm.positionStatus,
    finalNetEquityCents: value(arm.finalNetEquityCents, 'cents'), realizedPnlCents: value(arm.realizedPnlCents, 'cents'),
    unrealizedPnlCents: value(arm.unrealizedPnlCents, 'cents'), feesCents: value(arm.feesCents, 'cents'),
    grossTurnoverCents: value(arm.grossTurnoverCents, 'cents'), fillCount: value(arm.fillCount, 'count'),
    completedRoundTripCount: value(arm.completedRoundTripCount, 'count'), dataGaps: value(arm.dataGaps, 'count'),
    maxSampledEquityDrawdownCents: value(arm.maxSampledEquityDrawdownCents, 'cents'),
    maxSampledEquityRelativeDrawdownBps: value(arm.maxSampledEquityRelativeDrawdownBps, 'bps')};
}
function cloneInput(input) {
  try { return structuredClone(input); } catch { return null; }
}
export function presentSpotPaperThreeWayReport(input, {now = null, staleAfterMs = null} = {}) {
  const unavailable = {available: false, status: 'UNKNOWN', freshness: {status: 'UNKNOWN', ageMs: null}};
  if (!isSpotPaperThreeWayDashboardEnvelope(input)) return unavailable;
  const report = input.report;
  const age = freshness(input.observedAt, now, staleAfterMs);
  if (age.status === 'UNKNOWN') return unavailable;
  const inputCopy = cloneInput(report.input);
  if (inputCopy === null) return unavailable;
  const arms = Object.fromEntries(Object.keys(ARM_IDS).map(name => [name, armView(report.arms[name])]));
  return {available: true, status: age.status === 'STALE' ? 'STALE' : 'COMPARISON_AVAILABLE', researchOnly: true,
    profitability: 'NOT_ASSESSED', executionImpact: false, automaticPromotion: false, observedAt: input.observedAt,
    commonHorizonAt: report.commonHorizonAt, freshness: age, input: inputCopy, arms};
}
export function createSpotPaperThreeWayAdapter({readReport} = {}) {
  if (readReport !== undefined && typeof readReport !== 'function') throw new TypeError('readReport must be an injected read-only function');
  return Object.freeze({async read(options = {}) { if (!readReport) return presentSpotPaperThreeWayReport(null, options); try { return presentSpotPaperThreeWayReport(await readReport(), options); } catch { return presentSpotPaperThreeWayReport(null, options); } }});
}
