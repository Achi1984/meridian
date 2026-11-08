export const SPOT_PAPER_HOST8H_RUN_ID = 'btc-eur-paper-host-8h-001';
export const SPOT_PAPER_HOST8H_PROFILE_ID = 'BTC_EUR_PAPER_HOST_8H_V1';
export const SPOT_PAPER_HOST8H_SOURCE_SHA =
  '1e0204c8ac2c611940bdebbf61ae396a0282eb7d31cc52be7e51ef4036a961fd';
export const SPOT_PAPER_HOST8H_MODEL = 'BTC_EUR_SMA5_SMA20_V1';
export const SPOT_PAPER_HOST8H_PAIR = 'BTC/EUR';
export const SPOT_PAPER_HOST8H_CURRENCY = 'EUR';
export const SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS = 28_800_000;
export const SPOT_PAPER_HOST8H_REPORT_SCHEMA = 'BTC_EUR_SPOT_PAPER_HOST8H_REPORT_V1';
export const SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA =
  'BTC_EUR_SPOT_PAPER_HOST8H_REPORT_ENVELOPE_V1';
export const SPOT_PAPER_HOST8H_TRANSFER_SCHEMA =
  'BTC_EUR_SPOT_PAPER_HOST8H_REPORT_TRANSFER_V1';
export const SPOT_PAPER_HOST8H_PANEL_INPUT_SCHEMA = 'SPOT_PAPER_HOST8H_PANEL_INPUT_V1';
export const SPOT_PAPER_HOST8H_MAX_BYTES = 256 * 1024;

const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);
const safeInteger = value => Number.isSafeInteger(value);
const identity = Object.freeze({
  runId: SPOT_PAPER_HOST8H_RUN_ID,
  profileId: SPOT_PAPER_HOST8H_PROFILE_ID,
  sourceSha: SPOT_PAPER_HOST8H_SOURCE_SHA,
  model: SPOT_PAPER_HOST8H_MODEL,
  pair: SPOT_PAPER_HOST8H_PAIR,
  currency: SPOT_PAPER_HOST8H_CURRENCY,
  leverage: 1,
  positionMode: 'LONG_ONLY'
});

export function getSpotPaperHost8hIdentity() {
  return identity;
}

function exactKeys(value, expected) {
  return isRecord(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function validMetrics(metrics, {provisional}) {
  const keys = [
    'initialCashCents', 'cashCents', 'equityCents', 'realizedPnlCents',
    'unrealizedPnlCents', 'totalPnlCents', 'bookedFeesCents',
    'estimatedExitFeeCents', 'estimatedExitSlippageCents', 'fillCount',
    'closedTradeCount', 'openInventory', 'cycleCount', 'cycleCoverage',
    'acceptedObservations', 'acceptedObservationCoverage', 'observations',
    'dataGaps', 'requests', 'elapsedMs', 'durationCoverage', 'durationStatus'
  ];
  if (!exactKeys(metrics, keys) || typeof metrics.openInventory !== 'object' ||
      !exactKeys(metrics.openInventory, ['status', 'quantitySat'])) return false;
  for (const key of keys.filter(key => key.endsWith('Cents'))) {
    const value = metrics[key];
    if (value !== null && !safeInteger(value)) return false;
    if (['bookedFeesCents', 'estimatedExitFeeCents',
      'estimatedExitSlippageCents'].includes(key) && value !== null && value < 0) return false;
  }
  for (const key of [
    'fillCount', 'closedTradeCount', 'cycleCount', 'observations', 'dataGaps',
    'requests', 'elapsedMs'
  ]) {
    if (metrics[key] !== null && (!safeInteger(metrics[key]) || metrics[key] < 0)) {
      return false;
    }
  }
  if ((metrics.fillCount !== null && metrics.fillCount > 960) ||
      (metrics.closedTradeCount !== null &&
        (metrics.closedTradeCount > 480 ||
          metrics.fillCount !== null && metrics.closedTradeCount > metrics.fillCount)) ||
      (metrics.cycleCount !== null && metrics.cycleCount > 480) ||
      (metrics.observations !== null && metrics.observations > 480) ||
      (metrics.dataGaps !== null && metrics.dataGaps > 480) ||
      (metrics.requests !== null && metrics.requests > 960) ||
      (metrics.elapsedMs !== null && metrics.elapsedMs > 28_805_000)) return false;
  if (metrics.initialCashCents !== 100_000 ||
      metrics.openInventory.status !== 'FLAT' &&
        metrics.openInventory.status !== 'OPEN_UNRESOLVED_AT_TERMINAL' &&
        metrics.openInventory.status !== 'OPEN_PROVISIONAL' &&
        metrics.openInventory.status !== 'UNKNOWN' ||
      metrics.openInventory.quantitySat !== null &&
        (typeof metrics.openInventory.quantitySat !== 'string' ||
          !/^(?:0|[1-9]\d{0,30})$/.test(metrics.openInventory.quantitySat))) {
    return false;
  }
  if (provisional && !['FLAT', 'OPEN_PROVISIONAL', 'UNKNOWN']
    .includes(metrics.openInventory.status)) return false;
  for (const key of [
    'cycleCoverage', 'acceptedObservationCoverage', 'durationCoverage'
  ]) {
    if (metrics[key] !== null &&
        (typeof metrics[key] !== 'number' || !Number.isFinite(metrics[key]) ||
          metrics[key] < 0 || metrics[key] > 1.001)) return false;
  }
  if (metrics.durationStatus !== null &&
      !['FULL_REQUESTED_DURATION', 'PARTIAL_BOUNDED_DURATION', 'UNKNOWN']
        .includes(metrics.durationStatus)) return false;
  return true;
}

export function normalizeSpotPaperHost8hReport(input, {now = Date.now()} = {}) {
  let report;
  try {
    const text = JSON.stringify(input);
    if (typeof text !== 'string' ||
        new TextEncoder().encode(text).byteLength > SPOT_PAPER_HOST8H_MAX_BYTES) return null;
    report = JSON.parse(text);
  } catch {
    return null;
  }
  if (!exactKeys(report, [
        'schemaVersion', 'source', 'observedAt', 'identity', 'snapshot',
        'sourceEvidence', 'metrics', 'assessment'
      ]) || report.schemaVersion !== SPOT_PAPER_HOST8H_PANEL_INPUT_SCHEMA ||
      report.source !==
        'Read-only host summary exporter; transport authentication is separate' ||
      !exactKeys(report.identity, Object.keys(identity)) ||
      Object.entries(identity).some(([key, value]) => report.identity[key] !== value) ||
      !exactKeys(report.snapshot, ['status', 'runId', 'verifiedTerminal', 'report']) ||
      !['RUNNING_OBSERVED', 'VERIFIED_TERMINAL', 'INCOMPLETE_UNKNOWN'].includes(
        report.snapshot.status) ||
      report.snapshot.runId !== identity.runId ||
      typeof report.observedAt !== 'string' ||
      !Number.isSafeInteger(Date.parse(report.observedAt)) ||
      Date.parse(report.observedAt) > now ||
      !exactKeys(report.sourceEvidence, [
        'journalStatus', 'journalSequence', 'cycleCount', 'observationCount',
        'dataGapCount', 'assessmentOutcome'
      ]) ||
      !['UNKNOWN_WRITER_OR_INTERRUPTED', 'READ_ONLY_VERIFIED'].includes(
        report.sourceEvidence.journalStatus) ||
      !safeInteger(report.sourceEvidence.journalSequence) ||
      report.sourceEvidence.journalSequence < 0 ||
        report.sourceEvidence.journalSequence > 482 ||
      !safeInteger(report.sourceEvidence.cycleCount) ||
      report.sourceEvidence.cycleCount < 0 ||
      report.sourceEvidence.cycleCount > 480 ||
      !safeInteger(report.sourceEvidence.observationCount) ||
      report.sourceEvidence.observationCount < 0 ||
      report.sourceEvidence.observationCount > 480 ||
      !safeInteger(report.sourceEvidence.dataGapCount) ||
      report.sourceEvidence.dataGapCount < 0 ||
      report.sourceEvidence.dataGapCount > 480 ||
      report.sourceEvidence.cycleCount !== report.sourceEvidence.observationCount +
        report.sourceEvidence.dataGapCount ||
      !['COMPLETED', 'FAILED', 'UNKNOWN', 'NOT_RUN'].includes(
        report.sourceEvidence.assessmentOutcome)) return null;
  const terminal = report.snapshot.status === 'VERIFIED_TERMINAL';
  const provisional = report.snapshot.status === 'RUNNING_OBSERVED';
  if (terminal) {
    if (report.snapshot.verifiedTerminal !== true ||
        !exactKeys(report.snapshot.report, ['stopReason', 'runId']) ||
        report.snapshot.report.runId !== identity.runId ||
        (report.snapshot.report.stopReason !== null &&
          (typeof report.snapshot.report.stopReason !== 'string' ||
            report.snapshot.report.stopReason.length > 128)) ||
        report.sourceEvidence.journalStatus !== 'READ_ONLY_VERIFIED' ||
        !isRecord(report.assessment) ||
        !exactKeys(report.assessment, ['schemaVersion', 'outcome', 'assessment']) ||
        report.assessment.schemaVersion !== 'SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1' ||
        !exactKeys(report.assessment.assessment, [
          'terminalVerified', 'boundedTermination', 'runId', 'profileId', 'sourceSha',
          'outcome', 'totalPnlCents'
        ]) ||
        report.assessment.assessment.terminalVerified !== true ||
        report.assessment.assessment.runId !== identity.runId ||
        report.assessment.assessment.profileId !== identity.profileId ||
        report.assessment.assessment.sourceSha !== identity.sourceSha ||
        report.assessment.assessment.outcome !== report.sourceEvidence.assessmentOutcome ||
        report.assessment.assessment.outcome === 'NOT_RUN' ||
        !validMetrics(report.metrics, {provisional: false})) return null;
  } else if (provisional) {
    if (report.snapshot.verifiedTerminal !== false ||
        report.snapshot.report !== null || report.assessment !== null ||
        report.sourceEvidence.journalStatus !== 'UNKNOWN_WRITER_OR_INTERRUPTED' ||
        report.sourceEvidence.assessmentOutcome !== 'NOT_RUN' ||
        !validMetrics(report.metrics, {provisional: true})) return null;
  } else if (report.snapshot.verifiedTerminal !== false ||
      report.snapshot.report !== null ||
      report.metrics !== null || report.assessment !== null) {
    return null;
  }
  if (terminal && report.assessment.assessment.totalPnlCents !==
      report.metrics.totalPnlCents) return null;
  if (report.metrics && (
      report.metrics.totalPnlCents !== null &&
        (report.metrics.realizedPnlCents === null ||
          report.metrics.unrealizedPnlCents === null ||
          report.metrics.totalPnlCents !== report.metrics.realizedPnlCents +
            report.metrics.unrealizedPnlCents) ||
      report.metrics.realizedPnlCents !== null &&
        report.metrics.unrealizedPnlCents !== null &&
        (report.metrics.totalPnlCents === null ||
          report.metrics.totalPnlCents !== report.metrics.realizedPnlCents +
            report.metrics.unrealizedPnlCents) ||
      report.metrics.equityCents !== null &&
        report.metrics.realizedPnlCents !== null &&
        report.metrics.unrealizedPnlCents !== null &&
        report.metrics.equityCents - report.metrics.initialCashCents !==
          report.metrics.realizedPnlCents + report.metrics.unrealizedPnlCents ||
      report.metrics.closedTradeCount !== null && report.metrics.fillCount !== null &&
        report.metrics.closedTradeCount > report.metrics.fillCount ||
      report.metrics.cycleCount !== null &&
        report.metrics.cycleCount !== report.metrics.observations + report.metrics.dataGaps ||
      report.metrics.cycleCount !== null &&
        report.metrics.cycleCount !== report.sourceEvidence.cycleCount ||
      report.metrics.observations !== null &&
        report.metrics.observations !== report.sourceEvidence.observationCount ||
      report.metrics.dataGaps !== null &&
        report.metrics.dataGaps !== report.sourceEvidence.dataGapCount)) return null;
  return report;
}

export function isSpotPaperHost8hReport(report, options) {
  return normalizeSpotPaperHost8hReport(report, options) !== null;
}

export function isSpotPaperHost8hEnvelope(envelope, options) {
  return isRecord(envelope) &&
    Object.keys(envelope).sort().join(',') === 'report,runId,schema' &&
    envelope.schema === SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA &&
    envelope.runId === SPOT_PAPER_HOST8H_RUN_ID &&
    isSpotPaperHost8hReport(envelope.report, options);
}
