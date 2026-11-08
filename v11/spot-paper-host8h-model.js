export const SPOT_PAPER_HOST8H_INPUT_SCHEMA = 'SPOT_PAPER_HOST8H_PANEL_INPUT_V1';
export const SPOT_PAPER_HOST8H_MAX_INPUT_BYTES = 256 * 1024;
export const SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS = 28_800_000;

const ACCEPTED_IDENTITY = Object.freeze({
  runId: 'btc-eur-paper-host-8h-001',
  profileId: 'BTC_EUR_PAPER_HOST_8H_V1',
  sourceSha: '1e0204c8ac2c611940bdebbf61ae396a0282eb7d31cc52be7e51ef4036a961fd',
  model: 'BTC_EUR_SMA5_SMA20_V1',
  pair: 'BTC/EUR',
  currency: 'EUR',
  leverage: 1,
  positionMode: 'LONG_ONLY'
});
const MAX_CYCLES = 480;
const MAX_REQUESTS = 960;
const MAX_ELAPSED_MS = SPOT_PAPER_HOST8H_REQUESTED_DURATION_MS + 5_000;
const HOST_STATUSES = new Set([
  'DISABLED', 'RUNNING_OBSERVED', 'VERIFIED_TERMINAL', 'INCOMPLETE_UNKNOWN'
]);
const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);
const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const finiteRatio = value => typeof value === 'number' && Number.isFinite(value) &&
  value >= 0 && value <= 1.001 ? value : null;
const boundedCount = (value, maximum) => safeCount(value) !== null && value <= maximum ?
  value : null;
const safeText = (value, limit = 160) => typeof value === 'string' &&
  value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : null;

function boundedClone(input) {
  try {
    const serialized = JSON.stringify(input);
    if (typeof serialized !== 'string' ||
        new TextEncoder().encode(serialized).byteLength > SPOT_PAPER_HOST8H_MAX_INPUT_BYTES) {
      return null;
    }
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

function freshness(observedAt, now, staleAfterMs, previousObservedAt) {
  const timestamp = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
  const previous = typeof previousObservedAt === 'string' ?
    Date.parse(previousObservedAt) : NaN;
  if (Number.isFinite(timestamp) && Number.isFinite(previous) && timestamp < previous) {
    return {status: 'OUT_OF_ORDER', ageMs: null};
  }
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) {
    return {status: 'UNKNOWN', ageMs: null};
  }
  if (timestamp > now) return {status: 'UNKNOWN', ageMs: null};
  const ageMs = now - timestamp;
  return {status: ageMs > staleAfterMs ? 'STALE' : 'WITHIN_DISPLAY_POLICY', ageMs};
}

function cents(value, signed = false) {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) return null;
  const negative = value < 0;
  const absolute = BigInt(Math.abs(value)).toString().padStart(3, '0');
  const whole = absolute.slice(0, -2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const label = `${grouped},${absolute.slice(-2)} €`;
  return {
    label: signed && value !== 0 ? `${negative ? '−' : '+'}${label}` : label,
    tone: !signed || value === 0 ? 'tone-muted' :
      negative ? 'tone-danger' : 'tone-safe'
  };
}

function verifiedAssessment(assessment, identity, sourceEvidence) {
  if (!isRecord(assessment) ||
      assessment.schemaVersion !== 'SPOT_PAPER_HOST_OFFLINE_ASSESSMENT_V1' ||
      !isRecord(assessment.assessment)) return null;
  const result = assessment.assessment;
  if (result.terminalVerified !== true || result.runId !== identity.runId ||
      result.profileId !== identity.profileId || result.sourceSha !== identity.sourceSha ||
      typeof result.boundedTermination !== 'boolean' ||
      !['COMPLETED', 'FAILED', 'UNKNOWN'].includes(result.outcome) ||
      result.outcome !== assessment.outcome ||
      sourceEvidence !== undefined &&
        sourceEvidence?.assessmentOutcome !== result.outcome) {
    return null;
  }
  return result;
}

function summaryMetrics(source, identity, provisional, stale, legacyAssessment = null) {
  if (!isRecord(source)) return null;
  const inventoryStatus = [
    'FLAT', 'OPEN_PROVISIONAL', 'OPEN_UNRESOLVED_AT_TERMINAL', 'UNKNOWN'
  ].includes(source.openInventory?.status) ? source.openInventory.status :
    legacyAssessment ? inventory(legacyAssessment.position,
      legacyAssessment.positionStatus).status : 'UNKNOWN';
  const quantitySat = typeof source.openInventory?.quantitySat === 'string' &&
    /^(?:0|[1-9]\d{0,30})$/.test(source.openInventory.quantitySat) ?
    source.openInventory.quantitySat :
    legacyAssessment ? inventory(legacyAssessment.position,
      legacyAssessment.positionStatus).quantitySat : null;
  const amount = (key, signed = false) => cents(source[key], signed);
  return {
    provisional,
    elapsedMs: boundedCount(source.elapsedMs, MAX_ELAPSED_MS),
    durationCoverage: finiteRatio(source.durationCoverage),
    durationStatus: safeText(source.durationStatus, 48),
    cycleCount: boundedCount(source.cycleCount, MAX_CYCLES),
    cycleCoverage: finiteRatio(source.cycleCoverage),
    acceptedObservations: boundedCount(source.acceptedObservations ??
      legacyAssessment?.acceptedObservations, MAX_CYCLES),
    acceptedObservationCoverage: finiteRatio(source.acceptedObservationCoverage ??
      legacyAssessment?.acceptedObservationCoverage),
    observations: boundedCount(source.observations ??
      legacyAssessment?.observations, MAX_CYCLES),
    dataGaps: boundedCount(source.dataGaps ??
      legacyAssessment?.dataGaps, MAX_CYCLES),
    requests: boundedCount(source.requests ??
      legacyAssessment?.requests, MAX_REQUESTS),
    fees: amount(source.bookedFeesCents === undefined ?
      'feesCents' : 'bookedFeesCents'),
    estimatedExitFee: amount('estimatedExitFeeCents'),
    estimatedExitSlippage: amount('estimatedExitSlippageCents'),
    cash: amount(source.cashCents === undefined ? 'cashCents' : 'cashCents'),
    equity: amount('equityCents'),
    realizedPnl: amount('realizedPnlCents', true),
    unrealizedPnl: amount('unrealizedPnlCents', true),
    totalPnl: amount('totalPnlCents', true),
    fills: boundedCount(source.fillCount, MAX_CYCLES),
    closedTrades: boundedCount(source.closedTradeCount, MAX_CYCLES),
    inventory: {status: inventoryStatus, quantitySat},
    identity,
    stale
  };
}

function inventory(position, status) {
  const quantitySat = typeof position?.quantitySat === 'string' &&
    /^(?:0|[1-9]\d{0,30})$/.test(position.quantitySat) ?
    position.quantitySat : null;
  const inventoryStatus = ['FLAT', 'OPEN_UNRESOLVED_AT_TERMINAL']
    .includes(status) ? status : 'UNKNOWN';
  return {
    status: inventoryStatus,
    quantitySat: inventoryStatus === 'OPEN_UNRESOLVED_AT_TERMINAL' ? quantitySat : null
  };
}

export function presentSpotPaperHost8h(input, {
  now = null, staleAfterMs = null, previousObservedAt = null
} = {}) {
  const value = boundedClone(input);
  if (!isRecord(value) || value.schemaVersion !== SPOT_PAPER_HOST8H_INPUT_SCHEMA ||
      !isRecord(value.identity) || !isRecord(value.snapshot) ||
      !HOST_STATUSES.has(value.snapshot.status)) {
    return {available: false, status: 'UNAVAILABLE'};
  }
  const identity = {
    runId: safeText(value.identity.runId, 120),
    profileId: safeText(value.identity.profileId, 80),
    sourceSha: safeText(value.identity.sourceSha, 80),
    model: safeText(value.identity.model, 80),
    pair: safeText(value.identity.pair, 32),
    currency: safeText(value.identity.currency, 8),
    leverage: value.identity.leverage,
    positionMode: safeText(value.identity.positionMode, 32)
  };
  if (Object.entries(ACCEPTED_IDENTITY).some(([key, expected]) =>
      identity[key] !== expected) ||
      value.snapshot.runId !== identity.runId ||
      (isRecord(value.snapshot.report) &&
        value.snapshot.report.runId !== identity.runId)) {
    return {available: false, status: 'IDENTITY_MISMATCH'};
  }
  const observedAt = safeText(value.observedAt, 48);
  const age = freshness(observedAt, now, staleAfterMs, previousObservedAt);
  if (age.status === 'OUT_OF_ORDER') {
    return {
      available: true, status: 'OUT_OF_ORDER', hostStatus: value.snapshot.status, identity,
      source: safeText(value.source), observedAt, freshness: age,
      authenticated: false, metrics: null
    };
  }

  const snapshot = value.snapshot;
  const assessment = verifiedAssessment(value.assessment, identity, value.sourceEvidence);
  let status = snapshot.status;
  if (status === 'DISABLED') status = 'UNAVAILABLE';
  if (status === 'VERIFIED_TERMINAL' && snapshot.verifiedTerminal !== true) {
    status = 'INCOMPLETE_UNKNOWN';
  }
  if (status === 'INCOMPLETE_UNKNOWN' && value.assessment?.outcome === 'FAILED') {
    status = 'FAILED';
  }
  const assessmentOutcome = ['COMPLETED', 'FAILED', 'UNKNOWN'].includes(value.assessment?.outcome) ?
    value.assessment.outcome : 'UNKNOWN';
  const report = isRecord(snapshot.report) ? snapshot.report : {};
  const metrics = status === 'RUNNING_OBSERVED' ?
    summaryMetrics(value.metrics, identity, true, age.status === 'STALE') :
      status === 'VERIFIED_TERMINAL' && assessment ?
        summaryMetrics(value.metrics ?? {
          feesCents: assessment.feesCents,
          cashCents: assessment.cashCents,
          equityCents: assessment.equityCents,
          realizedPnlCents: assessment.realizedPnlCents,
          unrealizedPnlCents: assessment.unrealizedPnlCents,
          totalPnlCents: assessment.totalPnlCents,
          elapsedMs: assessment.elapsedMs,
          durationCoverage: assessment.durationCoverage,
          durationStatus: assessment.durationStatus,
          cycleCount: assessment.cycleCount,
          cycleCoverage: assessment.cycleCoverage,
          acceptedObservations: assessment.acceptedObservations,
          acceptedObservationCoverage: assessment.acceptedObservationCoverage,
          observations: assessment.observations,
          dataGaps: assessment.dataGaps,
          requests: assessment.requests,
          equityCents: assessment.equityCents
        }, identity, false, age.status === 'STALE', assessment) : null;
  const completed = status === 'VERIFIED_TERMINAL' &&
    assessmentOutcome === 'COMPLETED' && assessment?.boundedTermination === true;
  const hostStatus = status === 'VERIFIED_TERMINAL' && assessmentOutcome === 'FAILED' ?
    'FAILED' : status;
  const displayStatus = age.status === 'STALE' ? 'STALE' : hostStatus;
  return {
    available: true,
    status: displayStatus,
    hostStatus: status,
    statusTone: hostStatus === 'FAILED' ? 'tone-danger' :
      completed && age.status !== 'STALE' ? 'tone-safe' : 'tone-muted',
    completed,
    identity,
    source: safeText(value.source),
    observedAt,
    freshness: age,
    authenticated: false,
    reportStopReason: safeText(report.stopReason, 80),
    assessmentOutcome,
    metrics
  };
}

export function createSpotPaperHost8hAdapter({readSnapshot} = {}) {
  if (readSnapshot !== undefined && typeof readSnapshot !== 'function') {
    throw new TypeError('readSnapshot must be an injected read-only function');
  }
  let latestObservedAt = null;
  return Object.freeze({
    async read(options = {}) {
      if (!readSnapshot) return {available: false, status: 'UNAVAILABLE'};
      try {
        const input = await readSnapshot();
        const model = presentSpotPaperHost8h(input, {
          ...options, previousObservedAt: latestObservedAt
        });
        const observed = typeof model.observedAt === 'string' ?
          Date.parse(model.observedAt) : NaN;
        const latest = typeof latestObservedAt === 'string' ?
          Date.parse(latestObservedAt) : NaN;
        if (Number.isFinite(observed) && (!Number.isFinite(latest) || observed > latest)) {
          latestObservedAt = model.observedAt;
        }
        return model;
      } catch {
        return {available: false, status: 'UNAVAILABLE'};
      }
    }
  });
}
