export const SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA =
  'SPOT_PAPER_PAIRED_DASHBOARD_V1';
export const SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA =
  'SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1';
export const SPOT_PAPER_PAIRED_ROLES = Object.freeze([
  'baseline', 'challenger', 'cash'
]);
export const SPOT_PAPER_PAIRED_EVIDENCE_STATUSES = Object.freeze([
  'VERIFIED_COMPLETE',
  'INTERRUPTED',
  'RUNNING_SNAPSHOT',
  'CORRUPT_UNKNOWN'
]);
export const SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR =
  'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1';
export const SPOT_PAPER_PAIRED_NEXT_RUN_MODELS = Object.freeze([
  'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1',
  'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1',
  'CASH_CONTROL_V1'
]);

const HASH = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ARM_STOP_REASONS = new Set([
  'SAMPLED_2PCT_BID_STOP', 'SESSION_LOSS_LIMIT'
]);
const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);
const isInteger = Number.isSafeInteger;
const finiteDuration = value => value === null ||
  typeof value === 'number' && Number.isFinite(value);

const nullableInteger = value => value === null || isInteger(value);
const safeCode = value => typeof value === 'string' && REASON_CODE.test(value) ?
  value : 'UNKNOWN';

function safeIdentity(identity) {
  if (!isRecord(identity) || !RUN_ID.test(identity.runId ?? '') ||
      identity.pair !== 'BTC/EUR' || !HASH.test(identity.sourceSha256 ?? '') ||
      !HASH.test(identity.configSha256 ?? '') ||
      !HASH.test(identity.researchSourceSha256 ?? '') ||
      identity.modelPairId !== undefined &&
        identity.modelPairId !== SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR ||
      !Array.isArray(identity.models) || identity.models.length !== 3) return null;
  const models = identity.models.map((model, index) => {
    if (!isRecord(model) || model.role !== SPOT_PAPER_PAIRED_ROLES[index] ||
        !MODEL_ID.test(model.modelId ?? '')) return null;
    return {role: model.role, modelId: model.modelId};
  });
  if (models.some(model => model === null)) return null;
  const usesTrendModel = models.some(model =>
    model.modelId === SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[1]);
  if (usesTrendModel && !identity.modelPairId) return null;
  if (identity.modelPairId &&
      models.some((model, index) =>
        model.modelId !== SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[index])) return null;
  return {
    runId: identity.runId,
    pair: 'BTC/EUR',
    sourceSha256: identity.sourceSha256,
    configSha256: identity.configSha256,
    researchSourceSha256: identity.researchSourceSha256,
    ...(identity.modelPairId ? {modelPairId: identity.modelPairId} : {}),
    models
  };
}

function safeTrendActivityDiagnostic(value) {
  const keys = [
    'schemaVersion', 'status', 'completedRoundTripCount',
    'requiredCompletedRoundTrips', 'observedCoverageMs', 'requiredCoverageMs',
    'completeWindow', 'forcedTrades', 'deadlineExtensionAllowed', 'profitability'
  ];
  if (!isRecord(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',') ||
      value.schemaVersion !== 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1' ||
      value.status !== 'PARTIAL_COVERAGE' ||
      !isInteger(value.completedRoundTripCount) ||
      value.completedRoundTripCount < 0 ||
      value.requiredCompletedRoundTrips !== 5 ||
      !isInteger(value.observedCoverageMs) ||
      value.observedCoverageMs < 0 ||
      value.observedCoverageMs >= 86_400_000 ||
      value.requiredCoverageMs !== 86_400_000 ||
      value.completeWindow !== false || value.forcedTrades !== false ||
      value.deadlineExtensionAllowed !== false ||
      value.profitability !== 'NOT_ASSESSED') return null;
  return {
    schemaVersion: value.schemaVersion,
    status: value.status,
    completedRoundTripCount: value.completedRoundTripCount,
    requiredCompletedRoundTrips: value.requiredCompletedRoundTrips,
    observedCoverageMs: value.observedCoverageMs,
    requiredCoverageMs: value.requiredCoverageMs,
    completeWindow: value.completeWindow,
    forcedTrades: value.forcedTrades,
    deadlineExtensionAllowed: value.deadlineExtensionAllowed,
    profitability: value.profitability
  };
}

function safeMetric(value, reason) {
  if (!nullableInteger(value)) return {value: null, reason: 'INVALID_METRIC'};
  if (value !== null) return {value, reason: null};
  return {value: null, reason: safeCode(reason)};
}

function safeArm(arm, role, identityModel) {
  if (!isRecord(arm) || arm.role !== role || arm.modelId !== identityModel ||
      !isRecord(arm.metricReasons) ||
      !['FLAT', 'OPEN', 'UNKNOWN'].includes(arm.inventoryStatus)) return null;
  const metricNames = [
    'cashCents', 'netEquityCents', 'netPnlCents', 'bookedFeesCents',
    'modeledSlippageCents', 'hypotheticalExitFeeCents',
    'hypotheticalExitSlippageCents', 'turnoverCents', 'fillCount',
    'exposureCents', 'sampledDrawdownCents', 'relativeDrawdownBps',
    'unresolvedObservations'
  ];
  const metrics = {};
  const reasons = {};
  for (const name of metricNames) {
    const metric = safeMetric(arm[name], arm.metricReasons[name]);
    metrics[name] = metric.value;
    if (metric.reason) reasons[name] = metric.reason;
  }
  for (const name of [
    'bookedFeesCents', 'modeledSlippageCents', 'hypotheticalExitFeeCents',
    'hypotheticalExitSlippageCents', 'turnoverCents', 'fillCount',
    'exposureCents', 'sampledDrawdownCents', 'relativeDrawdownBps',
    'unresolvedObservations'
  ]) {
    if (metrics[name] !== null && metrics[name] < 0) return null;
  }
  if (arm.stopReason !== null && !ARM_STOP_REASONS.has(arm.stopReason)) return null;
  const stopReason = arm.stopReason;
  if (!nullableInteger(arm.tradingStoppedAt)) return null;
  return {
    role,
    modelId: identityModel,
    tradingStoppedAt: arm.tradingStoppedAt,
    stopReason,
    inventoryStatus: arm.inventoryStatus,
    ...metrics,
    metricReasons: reasons
  };
}

function safeDelta(delta) {
  if (!isRecord(delta) ||
      !['AVAILABLE', 'UNAVAILABLE'].includes(delta.status)) return null;
  const values = {};
  for (const key of ['netEquityCents', 'netPnlCents']) {
    if (!nullableInteger(delta[key])) return null;
    values[key] = delta[key];
  }
  const reason = delta.status === 'UNAVAILABLE' ? safeCode(delta.reason) : null;
  if (delta.status === 'AVAILABLE' &&
      (values.netEquityCents === null || values.netPnlCents === null)) return null;
  if (delta.status === 'UNAVAILABLE' &&
      (values.netEquityCents !== null || values.netPnlCents !== null)) return null;
  return {status: delta.status, reason, ...values};
}

export function sanitizeSpotPaperPairedDashboardDto(input) {
  if (!isRecord(input) ||
      input.schemaVersion !== SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA ||
      !SPOT_PAPER_PAIRED_EVIDENCE_STATUSES.includes(input.evidenceStatus) ||
      input.evidenceQualification !==
        'STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED' ||
      !isRecord(input.identity) || !isRecord(input.timing) ||
      !isRecord(input.assumptions) || !isRecord(input.arms) ||
      !isRecord(input.deltas)) return null;
  const identity = safeIdentity(input.identity);
  if (!identity) return null;
  const hasTrendDiagnostic = Object.hasOwn(input, 'trendActivityDiagnostic');
  if ((identity.modelPairId &&
       ['VERIFIED_COMPLETE', 'INTERRUPTED'].includes(input.evidenceStatus) &&
       !hasTrendDiagnostic) ||
      (!identity.modelPairId && hasTrendDiagnostic)) return null;
  const trendActivityDiagnostic = hasTrendDiagnostic ?
    safeTrendActivityDiagnostic(input.trendActivityDiagnostic) : null;
  if (hasTrendDiagnostic && !trendActivityDiagnostic) return null;

  const timingKeys = [
    'requestedDurationMs', 'observedCoverageMs', 'actualElapsedMs',
    'runStoppedAt', 'valuationAt', 'requestedCycles', 'attemptedCycles',
    'completedCycles'
  ];
  const timing = {};
  for (const key of timingKeys) {
    if (key === 'actualElapsedMs' ?
      !finiteDuration(input.timing[key]) : !nullableInteger(input.timing[key])) return null;
    timing[key] = input.timing[key];
  }
  if (timing.requestedDurationMs !== 28_800_000 ||
      timing.requestedCycles !== 480 ||
      timing.observedCoverageMs !== null && timing.observedCoverageMs < 0 ||
      timing.actualElapsedMs !== null &&
        (timing.actualElapsedMs < 0 ||
          timing.actualElapsedMs > 28_805_000) ||
      timing.attemptedCycles !== null &&
        (timing.attemptedCycles < 0 || timing.attemptedCycles > 480) ||
      timing.completedCycles !== null &&
        (timing.completedCycles < 0 || timing.completedCycles > 480 ||
          timing.attemptedCycles !== null &&
            timing.completedCycles > timing.attemptedCycles)) return null;
  if (!['CYCLE_LIMIT', 'DURATION_LIMIT', 'OPERATOR_STOP',
    'REQUEST_LIMIT', 'SHARED_FEED_FAILURE', 'UNKNOWN'].includes(
    input.timing.stopReason)) return null;
  const horizonTimingKeys = [
    'quoteAgeAtValuationMs', 'terminalQuoteAgeMs',
    'quoteFreshAtShutdown', 'commonHorizonAvailable', 'commonHorizonReason'
  ];
  const hasHorizonTiming = horizonTimingKeys.some(key =>
    Object.hasOwn(input.timing, key));
  if (hasHorizonTiming) {
    if (!horizonTimingKeys.every(key => Object.hasOwn(input.timing, key)) ||
        !nullableInteger(input.timing.quoteAgeAtValuationMs) ||
        input.timing.quoteAgeAtValuationMs !== null &&
          input.timing.quoteAgeAtValuationMs < 0 ||
        !nullableInteger(input.timing.terminalQuoteAgeMs) ||
        input.timing.terminalQuoteAgeMs !== null &&
          input.timing.terminalQuoteAgeMs < 0 ||
        typeof input.timing.quoteFreshAtShutdown !== 'boolean' ||
        typeof input.timing.commonHorizonAvailable !== 'boolean' ||
        input.timing.commonHorizonReason !== null &&
          !REASON_CODE.test(input.timing.commonHorizonReason)) return null;
    for (const key of horizonTimingKeys) timing[key] = input.timing[key];
  }
  const timingResult = {...timing, stopReason: input.timing.stopReason};
  if (trendActivityDiagnostic &&
      (timing.actualElapsedMs === null ||
       trendActivityDiagnostic.observedCoverageMs !== Math.floor(timing.actualElapsedMs))) {
    return null;
  }

  const assumptions = input.assumptions;
  const legacyFees = assumptions.feeBpsPerSide === 50 &&
    !Object.hasOwn(assumptions, 'accountContractId') &&
    !Object.hasOwn(assumptions, 'accountContractVersion');
  const nextRunFees = assumptions.feeBpsPerSide === 20 &&
    assumptions.accountContractId === 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2' &&
    assumptions.accountContractVersion === 2 &&
    assumptions.feeBasis === 'EEA_SPOT_ONLY_TAKER_ASSUMPTION' &&
    assumptions.feeSource ===
      'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea' &&
    assumptions.feeAsOf === '2026-11-09' &&
    assumptions.accountTier === 'UNKNOWN' &&
    assumptions.accountingEngine === 'PAIRED_FEE_SCENARIO_LEDGER_V1';
  if ((!legacyFees && !nextRunFees) ||
      assumptions.slippageBpsPerSide !== 10 ||
      assumptions.ratesVerified !== false) return null;
  const assumptionsResult = legacyFees ? {
    feeBpsPerSide: assumptions.feeBpsPerSide,
    slippageBpsPerSide: assumptions.slippageBpsPerSide,
    ratesVerified: assumptions.ratesVerified
  } : {
    feeBpsPerSide: assumptions.feeBpsPerSide,
    slippageBpsPerSide: assumptions.slippageBpsPerSide,
    ratesVerified: assumptions.ratesVerified,
    accountContractId: assumptions.accountContractId,
    accountContractVersion: assumptions.accountContractVersion,
    feeBasis: assumptions.feeBasis,
    feeSource: assumptions.feeSource,
    feeAsOf: assumptions.feeAsOf,
    accountTier: assumptions.accountTier,
    accountingEngine: assumptions.accountingEngine
  };
  const arms = {};
  for (const role of SPOT_PAPER_PAIRED_ROLES) {
    arms[role] = safeArm(input.arms[role], role,
      identity.models.find(model => model.role === role).modelId);
    if (!arms[role]) return null;
  }
  const deltas = {
    status: input.deltas.status,
    reason: input.deltas.status === 'UNAVAILABLE' ?
      safeCode(input.deltas.reason) : null,
    challengerMinusBaseline: safeDelta(input.deltas.challengerMinusBaseline),
    baselineMinusCash: safeDelta(input.deltas.baselineMinusCash),
    challengerMinusCash: safeDelta(input.deltas.challengerMinusCash)
  };
  const deltaValues = [
    deltas.challengerMinusBaseline,
    deltas.baselineMinusCash,
    deltas.challengerMinusCash
  ];
  if (!['AVAILABLE', 'UNAVAILABLE'].includes(deltas.status) ||
      deltaValues.some(value => value === null) ||
      deltas.status === 'AVAILABLE' &&
        (deltas.reason !== null ||
          deltaValues.some(value => value.status !== 'AVAILABLE')) ||
      deltas.status === 'UNAVAILABLE' &&
        deltaValues.some(value => value.status !== 'UNAVAILABLE')) return null;

  return {
    schemaVersion: SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA,
    evidenceStatus: input.evidenceStatus,
    evidenceQualification: input.evidenceQualification,
    reasonCode: safeCode(input.reasonCode),
    syntheticFixture: input.syntheticFixture === true,
    independentAuthentication: 'NOT_ESTABLISHED',
    identity,
    timing: timingResult,
    assumptions: assumptionsResult,
    ...(trendActivityDiagnostic ? {trendActivityDiagnostic} : {}),
    arms,
    deltas,
    decision: 'NO_WINNER_OR_PROMOTION'
  };
}

export function projectSpotPaperPairedDashboard(input) {
  return sanitizeSpotPaperPairedDashboardDto(input);
}

export function createUnknownSpotPaperPairedDashboard(reasonCode = 'UNKNOWN') {
  const emptyDelta = () => ({
    status: 'UNAVAILABLE',
    reason: safeCode(reasonCode),
    netEquityCents: null,
    netPnlCents: null
  });
  const emptyArm = role => ({
    role,
    modelId: role === 'baseline' ? 'UNKNOWN_BASELINE' :
      role === 'challenger' ? 'UNKNOWN_CHALLENGER' : 'UNKNOWN_CASH',
    tradingStoppedAt: null,
    stopReason: null,
    inventoryStatus: 'UNKNOWN',
    cashCents: null,
    netEquityCents: null,
    netPnlCents: null,
    bookedFeesCents: null,
    modeledSlippageCents: null,
    hypotheticalExitFeeCents: null,
    hypotheticalExitSlippageCents: null,
    turnoverCents: null,
    fillCount: null,
    exposureCents: null,
    sampledDrawdownCents: null,
    relativeDrawdownBps: null,
    unresolvedObservations: null,
    metricReasons: {}
  });
  return {
    schemaVersion: SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA,
    evidenceStatus: 'CORRUPT_UNKNOWN',
    evidenceQualification:
      'STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED',
    reasonCode: safeCode(reasonCode),
    syntheticFixture: false,
    independentAuthentication: 'NOT_ESTABLISHED',
    identity: {
      runId: 'unknown',
      pair: 'BTC/EUR',
      sourceSha256: '0'.repeat(64),
      configSha256: '0'.repeat(64),
      researchSourceSha256: '0'.repeat(64),
      models: [
        {role: 'baseline', modelId: 'UNKNOWN_BASELINE'},
        {role: 'challenger', modelId: 'UNKNOWN_CHALLENGER'},
        {role: 'cash', modelId: 'UNKNOWN_CASH'}
      ]
    },
    timing: {
      requestedDurationMs: 28_800_000,
      observedCoverageMs: null,
      actualElapsedMs: null,
      runStoppedAt: null,
      valuationAt: null,
      requestedCycles: 480,
      attemptedCycles: null,
      completedCycles: null,
      stopReason: 'UNKNOWN'
    },
    assumptions: {feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false},
    arms: {
      baseline: emptyArm('baseline'),
      challenger: emptyArm('challenger'),
      cash: emptyArm('cash')
    },
    deltas: {
      status: 'UNAVAILABLE',
      reason: safeCode(reasonCode),
      challengerMinusBaseline: emptyDelta(),
      baselineMinusCash: emptyDelta(),
      challengerMinusCash: emptyDelta()
    },
    decision: 'NO_WINNER_OR_PROMOTION'
  };
}
