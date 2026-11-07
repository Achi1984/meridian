export const SPOT_PAPER_DASHBOARD_SCHEMA = 'BTC_EUR_SPOT_PAPER_DASHBOARD_V1';
export const SPOT_PAPER_REPORT_ENVELOPE_SCHEMA = 'BTC_EUR_SPOT_PAPER_REPORT_ENVELOPE_V1';
export const SPOT_PAPER_REPORT_TRANSFER_SCHEMA = 'BTC_EUR_SPOT_PAPER_REPORT_TRANSFER_V1';
export const SPOT_PAPER_REPORT_MAX_BYTES = 2 * 1024 * 1024;
export const SPOT_PAPER_REPORT_TIMEOUT_MS = 5_000;

const ACCEPTED = Object.freeze({
  runId: 'spot-paper-42395522899-1',
  sourceSha: '81edf0b5dc3d455c2c1e1906791d56c731bea0c9',
  workflowSha: 'ddae14f01583196dfc9e9da906dcd03d41d58369',
  workflowRunId: '42395522899',
  workflowRunNumber: 1,
  workflowRunAttempt: 1,
  profileId: 'BTC_EUR_PAPER_1H_V1',
  replayProfileId: 'BTC_EUR_RUN_42395522899_V1',
  model: 'BTC_EUR_SMA5_SMA20_V1',
  pair: 'BTC/EUR',
  initialCashCents: 100_000,
  maxDurationMs: 3_600_000,
  maxCycles: 60,
  maxRequests: 120
});

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const cents = value => integer(value) ? String(value) : null;
const timestamp = value => {
  if (!integer(value) || value < 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

function isAcceptedIdentity(provenance, runId) {
  return record(provenance) &&
    provenance.schemaVersion === 'SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1' &&
    provenance.acceptedSourceSha === ACCEPTED.sourceSha &&
    provenance.workflowSha === ACCEPTED.workflowSha &&
    String(provenance.workflowRunId) === ACCEPTED.workflowRunId &&
    provenance.workflowRunNumber === ACCEPTED.workflowRunNumber &&
    provenance.workflowRunAttempt === ACCEPTED.workflowRunAttempt &&
    provenance.runId === ACCEPTED.runId && runId === ACCEPTED.runId &&
    provenance.model === ACCEPTED.model && provenance.mode === 'paper' &&
    provenance.pair === ACCEPTED.pair &&
    provenance.initialCashCents === ACCEPTED.initialCashCents &&
    provenance.maxDurationMs === ACCEPTED.maxDurationMs &&
    provenance.maxCycles === ACCEPTED.maxCycles &&
    provenance.maxRequests === ACCEPTED.maxRequests &&
    provenance.pollIntervalMs === 60_000 &&
    provenance.warmupCandles === 21 &&
    provenance.maxBytes === 67_108_864 &&
    provenance.maxResponseBytes === 262_144 &&
    provenance.requestTimeoutMs === 5_000 &&
    provenance.maxOpenPositions === 1 &&
    provenance.maxQuoteAgeMs === 10_000 &&
    provenance.maxCandleAgeMs === 120_000 &&
    provenance.maxExposureCents === 10_000 &&
    provenance.maxSessionLossCents === 2_000 &&
    provenance.stopLossBps === 200 &&
    provenance.maxEntrySpreadBps === 50 &&
    provenance.feeBpsPerSide === 50 &&
    provenance.slippageBpsPerSide === 10 &&
    provenance.smaFast === 5 && provenance.smaSlow === 20;
}

function terminalReadbackMatches(readback, report) {
  if (!record(readback) || readback.reconciliation !== 'TERMINAL_REPORT_AVAILABLE' ||
      readback.resumed !== false || readback.executionImpact !== false ||
      readback.runId !== report.runId || !Array.isArray(readback.events) ||
      readback.eventCount !== readback.events.length ||
      readback.events.length !== report.observations + report.dataGaps + 2 ||
      !record(readback.checkpoint) ||
      readback.checkpoint.cycle !== report.observations + report.dataGaps ||
      readback.checkpoint.stopReason !== report.stopReason ||
      readback.checkpoint.counters?.requests !== report.requests ||
      readback.checkpoint.counters?.bytes !== report.deliveredBytes ||
      readback.manifest?.limits?.maxCycles !== ACCEPTED.maxCycles ||
      readback.manifest?.limits?.maxRequests !== ACCEPTED.maxRequests ||
      readback.manifest?.limits?.pollIntervalMs !== 60_000 ||
      readback.manifest?.limits?.requestTimeoutMs !== 5_000 ||
      readback.manifest?.limits?.maxBytes !== 67_108_864 ||
      readback.manifest?.limits?.maxResponseBytes !== 262_144) return false;
  const first = readback.events[0];
  const terminal = readback.events.at(-1);
  const cycles = readback.events.slice(1, -1);
  return record(first) && first.id === 'run-start' && first.type === 'start' &&
    record(terminal) && terminal.id === 'run-terminal' && terminal.type === 'terminal' &&
    cycles.filter(event => event?.type === 'observation').length === report.observations &&
    cycles.filter(event => event?.type === 'data_gap').length === report.dataGaps &&
    terminal.at === report.endedAt && same(terminal.report, report) &&
    readback.manifest?.schemaVersion === 'SPOT_PAPER_PILOT_MANIFEST_V1' &&
    readback.manifest.model === ACCEPTED.model &&
    readback.manifest.mode === 'paper' && readback.manifest.pair === ACCEPTED.pair &&
    readback.manifest.startedAt === report.startedAt &&
    readback.manifest.limits?.maxDurationMs === ACCEPTED.maxDurationMs;
}

function assessmentMatches(assessment, report, readback, provenance) {
  return record(assessment) &&
    assessment.outcome === 'COMPLETED' &&
    assessment.profileId === ACCEPTED.profileId &&
    assessment.runClassification === 'PARTIAL_BOUNDED_RUN' &&
    assessment.dispatchIdentity === 'PASS' &&
    assessment.terminalVerified === true &&
    assessment.boundedTermination === true &&
    assessment.executionImpact === false &&
    assessment.dataAcceptance === 'DATA_ACCEPTED' &&
    assessment.quoteAccountingReconciled === true &&
    assessment.profitability === 'NOT_ASSESSED' &&
    assessment.signalReplay === 'NOT_PERFORMED' &&
    assessment.validationCriteria?.pinnedSourceAndFreshRun === true &&
    assessment.validationCriteria?.requestedModeAndBounds === true &&
    assessment.validationCriteria?.retainedEvidenceAndAccounting === true &&
    assessment.validationCriteria?.acceptedPublicObservations === true &&
    assessment.validationCriteria?.fullRequestedDuration === false &&
    assessment.validationCriteria?.strategyPerformance === 'NOT_ASSESSED' &&
    assessment.runId === report.runId &&
    assessment.sourceSha === provenance.acceptedSourceSha &&
    assessment.startedAt === report.startedAt &&
    assessment.endedAt === report.endedAt &&
    assessment.elapsedMs === report.endedAt - report.startedAt &&
    assessment.observations === report.observations &&
    assessment.dataGaps === report.dataGaps &&
    assessment.deliveredBytes === report.deliveredBytes &&
    assessment.feesCents === report.feesCents &&
    assessment.cashCents === report.cashCents &&
    assessment.equityCents === report.equityCents &&
    assessment.realizedPnlCents === report.realizedPnlCents &&
    assessment.unrealizedPnlCents === report.unrealizedPnlCents &&
    same(assessment.fills, report.fills) &&
    same(assessment.position, report.position);
}

function replayMatches(replay, report) {
  return record(replay) &&
    replay.profileId === ACCEPTED.replayProfileId &&
    replay.outcome === 'PASS' &&
    replay.identity === 'PASS' &&
    replay.signalReplay === 'PASS' &&
    replay.fillCausality === 'PASS' &&
    replay.startupCutoff === 'PASS' &&
    integer(replay.replayedSignals) && replay.replayedSignals === report.signals?.length &&
    Array.isArray(replay.discrepancies) && replay.discrepancies.length === 0;
}

export function createSpotPaperDashboardDto({
  readback,
  provenance,
  assessment,
  signalReplay
} = {}) {
  const report = readback?.report;
  if (!record(report) || report.schemaVersion !== 'SPOT_PAPER_PILOT_REPORT_V1' ||
      !isAcceptedIdentity(provenance, readback?.runId) ||
      !terminalReadbackMatches(readback, report) ||
      !assessmentMatches(assessment, report, readback, provenance) ||
      !replayMatches(signalReplay, report) ||
      report.model !== ACCEPTED.model || report.mode !== 'paper' ||
      report.pair !== ACCEPTED.pair || report.executionImpact !== false ||
      report.liveTrading !== false || report.autoPromotion !== false ||
      report.profitability !== 'NOT_ASSESSED' ||
      report.operationalStatus !== 'COMPLETED_BOUNDED' ||
      !integer(report.startedAt) || !integer(report.endedAt) ||
      report.endedAt < report.startedAt || !integer(report.dataGaps) ||
      !integer(report.observations) || !integer(report.requests) ||
      !integer(report.deliveredBytes) ||
      !Array.isArray(report.fills) || !Array.isArray(report.signals) ||
      report.requests > ACCEPTED.maxRequests ||
      report.observations + report.dataGaps > ACCEPTED.maxCycles ||
      !integer(assessment.acceptedObservations) || assessment.acceptedObservations < 1 ||
      assessment.acceptedObservations > report.observations ||
      (report.position ? report.positionStatus !== 'OPEN_UNRESOLVED_AT_TERMINAL' :
        report.positionStatus !== 'FLAT')) {
    return null;
  }
  const buys = report.fills.filter(fill => fill?.side === 'BUY').length;
  const sells = report.fills.filter(fill => fill?.side === 'SELL').length;
  if (buys + sells !== report.fills.length ||
      ![report.feesCents, report.cashCents, report.equityCents,
        report.realizedPnlCents, report.unrealizedPnlCents]
        .every(value => value === null || integer(value))) return null;

  const position = report.position;
  if (position && (!integer(position.quantitySat) || position.quantitySat <= 0)) return null;
  const durationMs = report.endedAt - report.startedAt;
  const dto = {
    schemaVersion: SPOT_PAPER_DASHBOARD_SCHEMA,
    identity: {
      runId: report.runId,
      sourceSha: provenance.acceptedSourceSha,
      workflowSha: provenance.workflowSha,
      workflowRunId: String(provenance.workflowRunId),
      workflowRunNumber: provenance.workflowRunNumber,
      workflowRunAttempt: provenance.workflowRunAttempt,
      profileId: assessment.profileId,
      model: report.model,
      pair: report.pair
    },
    acceptedDispatchContext: {
      status: 'PASS',
      workflowRunId: String(provenance.workflowRunId),
      workflowRunNumber: provenance.workflowRunNumber,
      workflowRunAttempt: provenance.workflowRunAttempt
    },
    snapshot: {
      status: report.operationalStatus,
      completedAt: timestamp(report.endedAt),
      stopReason: typeof report.stopReason === 'string' ? report.stopReason : null
    },
    startingBalanceCents: String(provenance.initialCashCents),
    cashCents: cents(report.cashCents),
    equityCents: cents(report.equityCents),
    realizedPnlCents: cents(report.realizedPnlCents),
    unrealizedPnlCents: cents(report.unrealizedPnlCents),
    feesCents: cents(report.feesCents),
    buyCount: buys,
    sellCount: sells,
    fillCount: report.fills.length,
    openInventory: position ? {
      status: 'OPEN_UNRESOLVED_AT_TERMINAL',
      quantitySat: String(position.quantitySat)
    } : {status: 'FLAT', quantitySat: null},
    duration: {
      elapsedMs: durationMs,
      requestedMs: provenance.maxDurationMs,
      coverage: durationMs / provenance.maxDurationMs,
      status: assessment.durationStatus
    },
    coverage: {
      observations: report.observations,
      acceptedObservations: assessment.acceptedObservations,
      dataGaps: report.dataGaps,
      requests: report.requests
    },
    verification: {
      terminalReadback: 'PASS',
      assessment: assessment.outcome,
      assessmentSignalReplay: assessment.signalReplay,
      signalReplay: signalReplay.outcome,
      profitability: assessment.profitability
    }
  };
  return isSpotPaperDashboardDto(dto) ? dto : null;
}

const DTO_KEYS = [
  'schemaVersion', 'identity', 'acceptedDispatchContext', 'snapshot',
  'startingBalanceCents', 'cashCents', 'equityCents', 'realizedPnlCents',
  'unrealizedPnlCents', 'feesCents', 'buyCount', 'sellCount', 'fillCount',
  'openInventory', 'duration', 'coverage', 'verification'
];

export function isSpotPaperDashboardDto(dto) {
  const exact = (value, keys) => record(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (!record(dto)) return false;
  if (Object.keys(dto).sort().join(',') !== [...DTO_KEYS].sort().join(',') ||
      dto.schemaVersion !== SPOT_PAPER_DASHBOARD_SCHEMA ||
      !exact(dto.identity, ['runId', 'sourceSha', 'workflowSha', 'workflowRunId',
        'workflowRunNumber', 'workflowRunAttempt', 'profileId', 'model', 'pair']) ||
      !exact(dto.acceptedDispatchContext, ['status', 'workflowRunId',
        'workflowRunNumber', 'workflowRunAttempt']) ||
      !exact(dto.snapshot, ['status', 'completedAt', 'stopReason']) ||
      !exact(dto.duration, ['elapsedMs', 'requestedMs', 'coverage', 'status']) ||
      !exact(dto.coverage, ['observations', 'acceptedObservations', 'dataGaps', 'requests']) ||
      !exact(dto.verification, ['terminalReadback', 'assessment', 'assessmentSignalReplay',
        'signalReplay', 'profitability']) || !record(dto.openInventory)) return false;
  const identity = dto.identity;
  const completedAt = Date.parse(dto.snapshot.completedAt);
  const inventoryValid = dto.openInventory.status === 'OPEN_UNRESOLVED_AT_TERMINAL' ?
    Object.keys(dto.openInventory).sort().join(',') === 'quantitySat,status' &&
      typeof dto.openInventory.quantitySat === 'string' &&
      /^[1-9]\d*$/.test(dto.openInventory.quantitySat) :
    dto.openInventory.status === 'FLAT' &&
      Object.keys(dto.openInventory).sort().join(',') === 'quantitySat,status' &&
      dto.openInventory.quantitySat === null;
  return identity.runId === ACCEPTED.runId &&
    identity.sourceSha === ACCEPTED.sourceSha &&
    identity.workflowSha === ACCEPTED.workflowSha &&
    identity.workflowRunId === ACCEPTED.workflowRunId &&
    identity.workflowRunNumber === ACCEPTED.workflowRunNumber &&
    identity.workflowRunAttempt === ACCEPTED.workflowRunAttempt &&
    identity.profileId === ACCEPTED.profileId &&
    identity.model === ACCEPTED.model && identity.pair === ACCEPTED.pair &&
    dto.acceptedDispatchContext.status === 'PASS' &&
    dto.acceptedDispatchContext.workflowRunId === identity.workflowRunId &&
    dto.acceptedDispatchContext.workflowRunNumber === identity.workflowRunNumber &&
    dto.acceptedDispatchContext.workflowRunAttempt === identity.workflowRunAttempt &&
    dto.snapshot.status === 'COMPLETED_BOUNDED' &&
    Number.isFinite(completedAt) && new Date(completedAt).toISOString() === dto.snapshot.completedAt &&
    ['CYCLE_LIMIT', 'DURATION_LIMIT'].includes(dto.snapshot.stopReason) &&
    [dto.startingBalanceCents, dto.cashCents, dto.equityCents, dto.realizedPnlCents,
      dto.unrealizedPnlCents, dto.feesCents].every(value =>
      value === null || typeof value === 'string' &&
        /^-?(?:0|[1-9]\d*)$/.test(value) && value !== '-0') &&
    dto.startingBalanceCents === String(ACCEPTED.initialCashCents) &&
    [dto.cashCents, dto.equityCents, dto.feesCents].every(value =>
      value === null || !value.startsWith('-')) &&
    [dto.buyCount, dto.sellCount, dto.fillCount, dto.duration.elapsedMs,
      dto.duration.requestedMs, dto.coverage.observations, dto.coverage.acceptedObservations,
      dto.coverage.dataGaps, dto.coverage.requests].every(value => integer(value) && value >= 0) &&
    dto.fillCount === dto.buyCount + dto.sellCount &&
    dto.fillCount <= ACCEPTED.maxCycles &&
    dto.duration.elapsedMs <= dto.duration.requestedMs + 5_000 &&
    dto.duration.requestedMs === ACCEPTED.maxDurationMs &&
    typeof dto.duration.coverage === 'number' && Number.isFinite(dto.duration.coverage) &&
    dto.duration.coverage === dto.duration.elapsedMs / dto.duration.requestedMs &&
    ['PARTIAL_BOUNDED_DURATION', 'FULL_REQUESTED_DURATION'].includes(dto.duration.status) &&
    dto.coverage.acceptedObservations <= dto.coverage.observations &&
    dto.coverage.observations + dto.coverage.dataGaps <= ACCEPTED.maxCycles &&
    dto.coverage.requests <= ACCEPTED.maxRequests &&
    dto.verification.terminalReadback === 'PASS' &&
    dto.verification.assessment === 'COMPLETED' &&
    dto.verification.assessmentSignalReplay === 'NOT_PERFORMED' &&
    dto.verification.signalReplay === 'PASS' &&
    dto.verification.profitability === 'NOT_ASSESSED' &&
    inventoryValid;
}

export function isSpotPaperReportEnvelope(envelope) {
  return record(envelope) &&
    Object.keys(envelope).sort().join(',') === 'report,runId,schema' &&
    envelope.schema === SPOT_PAPER_REPORT_ENVELOPE_SCHEMA &&
    envelope.runId === ACCEPTED.runId &&
    isSpotPaperDashboardDto(envelope.report);
}

export function getAcceptedSpotPaperIdentity() {
  return ACCEPTED;
}

export async function readBoundedSpotPaperResponse(response, signal) {
  const body = response?.body;
  let reader;
  let cancelPending;
  const cancel = () => {
    if (cancelPending) return cancelPending;
    try {
      cancelPending = Promise.resolve(reader?.cancel()).catch(() => {});
    } catch {
      cancelPending = Promise.resolve();
    }
    return cancelPending;
  };
  let abort;
  const chunks = [];
  let size = 0;
  try {
    if (signal?.aborted) throw new Error('request_aborted');
    if (response?.status === 401 || response?.status === 403) {
      const error = new Error('auth_required');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    if (response?.status !== 200 || response?.ok !== true) {
      throw new Error('source_unavailable');
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.('content-type') ?? '')) {
      throw new Error('invalid_content_type');
    }
    const length = response.headers?.get?.('content-length');
    if (length !== null && length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) > SPOT_PAPER_REPORT_MAX_BYTES)) {
      throw new Error('response_too_large');
    }
    try {
      reader = body?.getReader?.();
    } catch {
      throw new Error('invalid_response_body');
    }
    if (!reader) throw new Error('invalid_response_body');
    abort = () => { void cancel(); };
    signal?.addEventListener('abort', abort, {once: true});
    while (true) {
      if (signal?.aborted) throw new Error('request_aborted');
      const {done, value} = await reader.read();
      if (signal?.aborted) throw new Error('request_aborted');
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('invalid_response_body');
      size += value.byteLength;
      if (size > SPOT_PAPER_REPORT_MAX_BYTES) throw new Error('response_too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    await cancel();
    try { reader?.releaseLock(); } catch {}
  }
}
