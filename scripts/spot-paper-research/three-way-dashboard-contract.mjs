// Read-only bridge for the offline three-way research report.
export const SPOT_PAPER_THREE_WAY_DASHBOARD_SCHEMA = "SPOT_PAPER_THREE_WAY_DASHBOARD_V1";
export const SPOT_PAPER_THREE_WAY_REPORT_SCHEMA = "SPOT_PAPER_THREE_WAY_COMPARISON_V1";
const ARM_IDS = Object.freeze({baseline: "BTC_EUR_SMA5_SMA20_V1", challenger: "BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1", rangePullback: "BTC_EUR_RANGE_PULLBACK_ATR_RSI_V1", cash: "CASH_NO_TRADE"});
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function validArm(arm, id, horizon) {
  return record(arm) && arm.strategyId === id && integer(arm.valuationAt) && arm.valuationAt >= 0 && arm.valuationAt === horizon && arm.valuationStatus === "MARKED_AT_COMMON_HORIZON" && ["FLAT", "OPEN_UNRESOLVED_AT_HORIZON"].includes(arm.positionStatus) && ["finalNetEquityCents", "realizedPnlCents", "unrealizedPnlCents", "feesCents", "grossTurnoverCents", "fillCount", "completedRoundTripCount", "dataGaps", "maxSampledEquityDrawdownCents", "maxSampledEquityRelativeDrawdownBps"].every(key => arm[key] === null || integer(arm[key])) && ["fills", "roundTrips"].every(key => Array.isArray(arm[key]));
}
export function isSpotPaperThreeWayDashboardEnvelope(envelope) {
  if (!exactKeys(envelope, ["schemaVersion", "observedAt", "report"]) || envelope.schemaVersion !== SPOT_PAPER_THREE_WAY_DASHBOARD_SCHEMA || !iso(envelope.observedAt) || !record(envelope.report)) return false;
  const report = envelope.report;
  if (!exactKeys(report, ["schemaVersion", "status", "commonHorizonAt", "researchOnly", "profitability", "executionImpact", "automaticPromotion", "input", "arms"]) || report.schemaVersion !== SPOT_PAPER_THREE_WAY_REPORT_SCHEMA || report.status !== "COMPARISON_AVAILABLE" || report.researchOnly !== true || report.profitability !== "NOT_ASSESSED" || report.executionImpact !== false || report.automaticPromotion !== false || !integer(report.commonHorizonAt) || report.commonHorizonAt < 0 || !record(report.arms) || !exactKeys(report.arms, Object.keys(ARM_IDS))) return false;
  return Object.entries(ARM_IDS).every(([name, id]) => validArm(report.arms[name], id, report.commonHorizonAt));
}
export function threeWayDashboardEnvelope(report, observedAt) {
  const envelope = {schemaVersion: SPOT_PAPER_THREE_WAY_DASHBOARD_SCHEMA, observedAt, report};
  return isSpotPaperThreeWayDashboardEnvelope(envelope) ? envelope : null;
}
export {ARM_IDS};
