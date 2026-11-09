import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  createUnknownSpotPaperPairedDashboard,
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA,
  SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA,
  SPOT_PAPER_PAIRED_ROLES
} from './contract.mjs';

export const SPOT_PAPER_PAIRED_REPORT_SCHEMA = 'SPOT_PAPER_PAIRED_REPORT_V1';
export const SPOT_PAPER_PAIRED_JOURNAL_SCHEMA = 'SPOT_PAPER_PILOT_JOURNAL_V1';
export const SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES = 16 * 1024 * 1024;
export const SPOT_PAPER_PAIRED_MAX_IDENTITY_BYTES = 16 * 1024;

const MAX_DURATION_MS = 28_800_000;
const MAX_CYCLES = 480;
const MAX_REQUESTS = 960;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_QUOTE_AGE_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isRecord = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);
const isInteger = Number.isSafeInteger;
const exactKeys = (value, keys) => isRecord(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function reportInput(input, expectedIdentity, suppliedJournal) {
  if (!isRecord(input)) return {report: input, journal: suppliedJournal};
  if (input.schemaVersion === 'SPOT_PAPER_PAIRED_HOST_EXPORT_V1') {
    if (input.runId !== expectedIdentity?.runId ||
        !['TERMINAL_JOURNAL_VERIFIED', 'WRITER_LOCK_PRESENT',
          'INCOMPLETE_UNKNOWN', 'NOT_FOUND'].includes(input.status) ||
        input.report !== null && !isRecord(input.report) ||
        input.journal !== null && !isRecord(input.journal)) {
      return {invalid: true};
    }
    return {
      report: input.report,
      journal: input.journal,
      hostStatus: input.status,
      hostReconciliationStatus: input.reconciliationStatus
    };
  }
  return {report: input, journal: suppliedJournal};
}

function fail(reasonCode) {
  return createUnknownSpotPaperPairedDashboard(reasonCode);
}

function validExpectedIdentity(expected) {
  if (!exactKeys(expected, [
        'schemaVersion', 'runId', 'pair', 'sourceSha256', 'configSha256',
        'researchSourceSha256', 'feedSourceId', 'comparisonEngineId', 'models'
      ]) ||
      expected.schemaVersion !== SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA ||
      !RUN_ID.test(expected.runId ?? '') || expected.pair !== 'BTC/EUR' ||
      !HASH.test(expected.sourceSha256 ?? '') ||
      !HASH.test(expected.configSha256 ?? '') ||
      !HASH.test(expected.researchSourceSha256 ?? '') ||
      typeof expected.feedSourceId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(expected.feedSourceId) ||
      typeof expected.comparisonEngineId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(expected.comparisonEngineId) ||
      !Array.isArray(expected.models) || expected.models.length !== 3) return false;
  return expected.models.every((model, index) =>
    exactKeys(model, ['role', 'modelId', 'accountId']) &&
    model.role === SPOT_PAPER_PAIRED_ROLES[index] &&
    MODEL_ID.test(model.modelId ?? '') &&
    typeof model.accountId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(model.accountId));
}

function expectedPublicIdentity(expected) {
  return {
    runId: expected.runId,
    pair: 'BTC/EUR',
    sourceSha256: expected.sourceSha256,
    configSha256: expected.configSha256,
    researchSourceSha256: expected.researchSourceSha256,
    models: expected.models.map(({role, modelId}) => ({role, modelId}))
  };
}

function exactModels(actual, expected) {
  return Array.isArray(actual) && actual.length === 3 &&
    actual.every((model, index) => isRecord(model) &&
      model.role === expected.models[index].role &&
      model.modelId === expected.models[index].modelId &&
      model.accountId === expected.models[index].accountId);
}

function validFeeAssumptions(assumptions) {
  if (!isRecord(assumptions) || assumptions.slippageBpsPerSide !== 10 ||
      assumptions.ratesVerified !== false) return false;
  if (assumptions.feeBpsPerSide === 50) {
    return !Object.hasOwn(assumptions, 'accountContractId') &&
      !Object.hasOwn(assumptions, 'accountContractVersion');
  }
  return assumptions.feeBpsPerSide === 20 &&
    assumptions.accountContractId === 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2' &&
    assumptions.accountContractVersion === 2 &&
    assumptions.feeBasis === 'EEA_SPOT_ONLY_TAKER_ASSUMPTION' &&
    assumptions.feeSource ===
      'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea' &&
    assumptions.feeAsOf === '2026-11-09' &&
    assumptions.accountTier === 'UNKNOWN' &&
    assumptions.accountingEngine === 'PAIRED_FEE_SCENARIO_LEDGER_V1';
}

function getJournalPayload(journal) {
  if (!isRecord(journal)) return null;
  if (isRecord(journal.payload)) {
    if (typeof journal.sha256 !== 'string' || !HASH.test(journal.sha256) ||
        createHash('sha256').update(JSON.stringify(journal.payload)).digest('hex') !==
          journal.sha256) return null;
    return {
      payload: journal.payload,
      reconciliationStatus: journal.reconciliationStatus ?? 'UNKNOWN',
      snapshotStatus: journal.snapshotStatus ?? null
    };
  }
  if (journal.schemaVersion === SPOT_PAPER_PAIRED_JOURNAL_SCHEMA &&
      typeof journal.reconciliationStatus === 'string') {
    return {
      payload: journal,
      reconciliationStatus: journal.reconciliationStatus,
      snapshotStatus: journal.snapshotStatus ?? null
    };
  }
  return null;
}

function identityMatches(report, payload, expected) {
  const manifest = payload.manifest;
  const limits = manifest?.limits;
  return report.runId === expected.runId &&
    report.pair === expected.pair &&
    report.sourceSha256 === expected.sourceSha256 &&
    report.configSha256 === expected.configSha256 &&
    report.researchSourceSha256 === expected.researchSourceSha256 &&
    report.feedSourceId === expected.feedSourceId &&
    report.comparisonEngineId === expected.comparisonEngineId &&
    exactModels(report.models, expected) &&
    manifest?.schemaVersion === 'SPOT_PAPER_PAIRED_MANIFEST_V1' &&
    manifest.runId === expected.runId && manifest.mode === 'paper' &&
    manifest.pair === expected.pair &&
    manifest.sourceSha256 === expected.sourceSha256 &&
    manifest.configSha256 === expected.configSha256 &&
    manifest.researchSourceSha256 === expected.researchSourceSha256 &&
    manifest.feedSourceId === expected.feedSourceId &&
    manifest.comparisonEngineId === expected.comparisonEngineId &&
    exactModels(manifest.models, expected) &&
    stableJson(manifest.assumptions) === stableJson(report.assumptions) &&
    validFeeAssumptions(manifest.assumptions) &&
    isRecord(limits) &&
    isInteger(limits.maxCycles) && limits.maxCycles > 0 &&
      limits.maxCycles <= MAX_CYCLES && report.cycles <= limits.maxCycles &&
    isInteger(limits.maxRequests) && limits.maxRequests > 0 &&
      limits.maxRequests <= MAX_REQUESTS && report.requests <= limits.maxRequests &&
    isInteger(limits.maxBytes) && limits.maxBytes > 0 &&
      limits.maxBytes <= MAX_BYTES && report.deliveredBytes <= limits.maxBytes &&
    isInteger(limits.maxResponseBytes) && limits.maxResponseBytes > 0 &&
      limits.maxResponseBytes <= MAX_RESPONSE_BYTES &&
    isInteger(limits.maxDurationMs) && limits.maxDurationMs > 0 &&
      limits.maxDurationMs <= MAX_DURATION_MS &&
      report.elapsedMs <= limits.maxDurationMs + 5_000 &&
      report.fullEightHourCompletion ===
        (report.stopReason === 'DURATION_LIMIT' &&
          report.elapsedMs >= MAX_DURATION_MS) &&
      report.coverage === (report.elapsedMs >= limits.maxDurationMs ?
        'CONFIGURED_DURATION_REACHED' : 'PARTIAL') &&
    isInteger(limits.requestTimeoutMs) && limits.requestTimeoutMs > 0 &&
      limits.requestTimeoutMs <= 5_000 &&
    isInteger(limits.pollIntervalMs) && limits.pollIntervalMs >= 60_000;
}

function reportIsValid(report, expected) {
  if (!isRecord(report) ||
      report.schemaVersion !== SPOT_PAPER_PAIRED_REPORT_SCHEMA) return 'UNKNOWN_REPORT_SCHEMA';
  if (!isInteger(report.startedAt) || !isInteger(report.endedAt) ||
      report.startedAt < 0 || report.endedAt < report.startedAt ||
      typeof report.elapsedMs !== 'number' || !Number.isFinite(report.elapsedMs) ||
      report.elapsedMs < 0 ||
      report.elapsedMs > MAX_DURATION_MS + 5_000 ||
      report.wallClockElapsedMs !== report.endedAt - report.startedAt ||
      report.endedAt - report.startedAt > MAX_DURATION_MS + 5_000 ||
      !isInteger(report.cycles) || report.cycles < 0 || report.cycles > MAX_CYCLES ||
      !isInteger(report.requests) || report.requests < 0 ||
      report.requests > MAX_REQUESTS ||
      !isInteger(report.deliveredBytes) || report.deliveredBytes < 0 ||
      report.deliveredBytes > MAX_BYTES ||
      !['CYCLE_LIMIT', 'DURATION_LIMIT', 'OPERATOR_STOP',
        'REQUEST_LIMIT', 'SHARED_FEED_FAILURE'].includes(report.stopReason) ||
      !['COMPLETED_BOUNDED', 'INTERRUPTED_OR_STOPPED'].includes(report.outcome) ||
      report.outcome === 'COMPLETED_BOUNDED' &&
        !['CYCLE_LIMIT', 'DURATION_LIMIT'].includes(report.stopReason) ||
      report.outcome === 'INTERRUPTED_OR_STOPPED' &&
        ['CYCLE_LIMIT', 'DURATION_LIMIT'].includes(report.stopReason) ||
      report.liveTrading !== false || report.executionImpact !== false ||
      report.autoPromotion !== false ||
      typeof report.testOnly !== 'boolean' ||
      report.testOnly !== (report.feedSourceId === 'SYNTHETIC_TEST_ONLY') ||
      !validFeeAssumptions(report.assumptions) ||
      !isRecord(report.commonHorizon) ||
      typeof report.commonHorizon.available !== 'boolean' ||
      !Array.isArray(report.arms) || report.arms.length !== 3) {
    return 'INVALID_REPORT_FIELDS';
  }
  if (report.runId !== expected.runId || report.pair !== expected.pair ||
      report.sourceSha256 !== expected.sourceSha256 ||
      report.configSha256 !== expected.configSha256 ||
      report.researchSourceSha256 !== expected.researchSourceSha256 ||
      report.feedSourceId !== expected.feedSourceId ||
      report.comparisonEngineId !== expected.comparisonEngineId ||
      !exactModels(report.models, expected)) {
    return 'IDENTITY_MISMATCH';
  }
  if (report.commonHorizon.available) {
    if (!isInteger(report.commonHorizon.effectAt) ||
        !isInteger(report.commonHorizon.quoteReceivedAt) ||
        report.commonHorizon.effectAt < report.startedAt ||
        report.commonHorizon.effectAt > report.endedAt ||
        report.commonHorizon.quoteReceivedAt > report.commonHorizon.effectAt ||
        report.commonHorizon.effectAt -
          report.commonHorizon.quoteReceivedAt > MAX_QUOTE_AGE_MS) {
      return 'INVALID_COMMON_HORIZON';
    }
  } else if (report.commonHorizon.effectAt !== null &&
      !isInteger(report.commonHorizon.effectAt)) {
    return 'INVALID_COMMON_HORIZON';
  }
  const horizon = report.commonHorizon;
  const horizonMetadata = [
    'reason', 'quoteAgeAtEffectMs', 'terminalQuoteAgeMs',
    'quoteFreshAtShutdown'
  ];
  const hasHorizonMetadata = horizonMetadata.some(key =>
    Object.hasOwn(horizon, key));
  if (hasHorizonMetadata) {
    if (!horizonMetadata.every(key => Object.hasOwn(horizon, key)) ||
        horizon.available && horizon.reason !== null ||
        !horizon.available && horizon.reason !== 'NO_VALID_COMMON_OBSERVATION' ||
        horizon.quoteAgeAtEffectMs !== null &&
          (!isInteger(horizon.quoteAgeAtEffectMs) ||
            horizon.effectAt === null ||
            horizon.quoteAgeAtEffectMs !==
              horizon.effectAt - (horizon.quoteReceivedAt ?? 0)) ||
        horizon.terminalQuoteAgeMs !== null &&
          (!isInteger(horizon.terminalQuoteAgeMs) ||
            horizon.quoteReceivedAt === null ||
            horizon.terminalQuoteAgeMs !== report.endedAt - horizon.quoteReceivedAt) ||
        typeof horizon.quoteFreshAtShutdown !== 'boolean' ||
        horizon.quoteFreshAtShutdown !==
          (horizon.terminalQuoteAgeMs !== null &&
            horizon.terminalQuoteAgeMs >= 0 &&
            horizon.terminalQuoteAgeMs <= MAX_QUOTE_AGE_MS) ||
        horizon.available &&
          (horizon.quoteAgeAtEffectMs === null ||
            horizon.quoteAgeAtEffectMs < 0 ||
            horizon.quoteAgeAtEffectMs > MAX_QUOTE_AGE_MS)) {
      return 'INVALID_COMMON_HORIZON';
    }
  }
  for (let index = 0; index < SPOT_PAPER_PAIRED_ROLES.length; index++) {
    const role = SPOT_PAPER_PAIRED_ROLES[index];
    const arm = report.arms[index];
    if (!isRecord(arm) || arm.role !== role ||
        arm.modelId !== expected.models[index].modelId ||
        arm.accountId !== expected.models[index].accountId ||
        !['ACTIVE', 'STOPPED'].includes(arm.tradingStatus) ||
        arm.stoppedAt !== null &&
          (!isInteger(arm.stoppedAt) || arm.stoppedAt < report.startedAt ||
            arm.stoppedAt > report.endedAt) ||
        arm.tradingStatus === 'STOPPED' &&
          (arm.stoppedAt === null || typeof arm.stopReason !== 'string') ||
        !Array.isArray(arm.fills) || !isRecord(arm.valuation)) {
      return 'INVALID_ARM_REPORT';
    }
  }
  return null;
}

function validateTerminalJournal(journal, report, expected) {
  const journalInfo = getJournalPayload(journal);
  if (!journalInfo) return {error: 'INVALID_JOURNAL'};
  const {payload, reconciliationStatus} = journalInfo;
  if (payload.schemaVersion !== SPOT_PAPER_PAIRED_JOURNAL_SCHEMA ||
      payload.runId !== expected.runId || !isInteger(payload.sequence) ||
      !Array.isArray(payload.events) || payload.sequence !== payload.events.length ||
      payload.sequence > MAX_CYCLES + 4 || !isRecord(payload.manifest) ||
      !isRecord(payload.checkpoint) || !isInteger(payload.checkpoint.cycle) ||
      !Array.isArray(payload.events) ||
      new Set(payload.events.map(event => event?.id)).size !== payload.events.length) {
    return {error: 'INVALID_JOURNAL'};
  }
  if (!report || reconciliationStatus !== 'READ_ONLY_VERIFIED') {
    return {error: 'JOURNAL_NOT_READ_ONLY_VERIFIED'};
  }
  const terminal = payload.events.at(-1);
  const observations = payload.events.filter(event =>
    event?.type === 'shared_observation');
  const failures = payload.events.filter(event =>
    event?.type === 'shared_feed_failure');
  const failureIndex = payload.events.findIndex(event =>
    event?.type === 'shared_feed_failure');
  const validResponseRef = response => isRecord(response) &&
    typeof response.path === 'string' &&
    /^responses\/[a-f0-9]{64}\.json$/.test(response.path) &&
    response.path === `responses/${response.sha256}.json` &&
    isInteger(response.bytes) && response.bytes > 0 &&
    isInteger(response.requestStartedAt) &&
    isInteger(response.receivedAt) &&
    response.receivedAt >= response.requestStartedAt;
  const eventRoles = (items, roleField = 'role') =>
    Array.isArray(items) && items.length === 3 &&
    items.every((item, index) => item?.[roleField] === SPOT_PAPER_PAIRED_ROLES[index]);
  let priorEffectAt = report.startedAt;
  const observationStreamValid = observations.every((event, index) => {
    const valid = event?.cycle === index + 1 &&
      isInteger(event.decisionAt) && isInteger(event.effectAt) &&
      event.decisionAt <= event.effectAt && event.observedAt === event.effectAt &&
      (priorEffectAt === null || event.effectAt > priorEffectAt) &&
      validResponseRef(event.ohlc) && validResponseRef(event.ticker) &&
      event.ohlc.requestStartedAt >= priorEffectAt &&
      event.ohlc.receivedAt <= event.decisionAt &&
      event.decisionAt <= event.ticker.requestStartedAt &&
      event.ticker.receivedAt <= event.effectAt &&
      event.effectAt - event.ticker.receivedAt <= MAX_QUOTE_AGE_MS &&
      event.id === `shared:${index + 1}:${event.ticker.sha256}` &&
      eventRoles(event.decisions) && eventRoles(event.fills) &&
      eventRoles(event.riskStates) && eventRoles(event.valuations) &&
      event.decisionAt === Math.max(...event.decisions.map(item => item.decidedAt)) &&
      event.decisions.every(item => isInteger(item.decidedAt) &&
        Object.hasOwn(item, 'decision') &&
        (item.skippedReason === null || typeof item.skippedReason === 'string') &&
        (item.metadata === null || isRecord(item.metadata)) &&
        event.ohlc.receivedAt <= item.decidedAt &&
        item.decidedAt <= event.ticker.requestStartedAt &&
        item.decidedAt <= event.effectAt) &&
      event.fills.every(item => Array.isArray(item.fills)) &&
      event.riskStates.every(item => isRecord(item.state) &&
        (item.stopReason === null || typeof item.stopReason === 'string') &&
        (item.stoppedAt === null || isInteger(item.stoppedAt)));
    if (valid) priorEffectAt = event.effectAt;
    return valid;
  });
  const reportArmsReconcile = report.arms.every(arm =>
    Array.isArray(arm.decisions) && arm.decisions.length === observations.length &&
    Array.isArray(arm.riskStates) && arm.riskStates.length === observations.length);
  const normalizeDecision = decision => Object.fromEntries(
    Object.entries(decision ?? {}).filter(([key, value]) =>
      key !== 'state' && key !== 'role' && value !== null && value !== undefined));
  const decisionsReconcile = SPOT_PAPER_PAIRED_ROLES.every((role, roleIndex) =>
    stableJson(report.arms[roleIndex].decisions.map(normalizeDecision)) ===
    stableJson(observations.map(event => normalizeDecision(
      event.decisions.find(item => item.role === role)))));
  const fillsReconcile = SPOT_PAPER_PAIRED_ROLES.every((role, roleIndex) => {
    const journalFills = observations.flatMap(event => {
      const group = event.fills.find(item => item.role === role);
      return group.fills.map(fill => ({...fill, executionAt: event.effectAt}));
    });
    return stableJson(report.arms[roleIndex].fills) === stableJson(journalFills);
  });
  const riskStatesReconcile = SPOT_PAPER_PAIRED_ROLES.every((role, roleIndex) => {
    const journalRiskStates = observations.map(event => {
      const item = event.riskStates.find(value => value.role === role);
      return {
        ...item.state,
        ...(item.stopReason !== null ? {stopReason: item.stopReason} : {}),
        ...(item.stoppedAt !== null ? {stoppedAt: item.stoppedAt} : {})
      };
    });
    return stableJson(report.arms[roleIndex].riskStates) ===
      stableJson(journalRiskStates);
  });
  const terminalArmStatesReconcile = SPOT_PAPER_PAIRED_ROLES.every(
    (role, roleIndex) => {
      const arm = report.arms[roleIndex];
      const finalRisk = observations.at(-1)?.riskStates.find(item =>
        item.role === role);
      const stopped = typeof finalRisk?.stopReason === 'string';
      return (!finalRisk?.state?.stopped || stopped) &&
        arm.tradingStatus === (stopped ? 'STOPPED' : 'ACTIVE') &&
        arm.stopReason === (stopped ? finalRisk.stopReason : null) &&
        arm.stoppedAt === (stopped ? finalRisk.stoppedAt : null);
    });
  const fillCountsReconcile = SPOT_PAPER_PAIRED_ROLES.every((role, index) =>
    report.arms[index].fills.length === observations.reduce((sum, event) => {
      const group = Array.isArray(event.fills) ?
        event.fills.find(item => item?.role === role) : null;
      return sum + (Array.isArray(group?.fills) ? group.fills.length : 0);
    }, 0));
  if (terminal?.type !== 'terminal' || terminal.id !== 'paired-terminal' ||
      terminal.at !== report.endedAt ||
      stableJson(terminal.report) !== stableJson(report) ||
      payload.checkpoint.cycle !== report.cycles ||
      payload.checkpoint.stopReason !== report.stopReason ||
      payload.checkpoint.counters?.requests !== report.requests ||
      payload.checkpoint.counters?.bytes !== report.deliveredBytes ||
      observations.length > report.cycles ||
      report.cycles - observations.length > 1 ||
      failures.length > 1 ||
      failures.length === 1 &&
        (failureIndex !== observations.length + 1 ||
          failures[0].cycle !== observations.length + 1 ||
          failures[0].cycle !== report.cycles ||
          failures[0].id !==
            `shared-failure:${report.cycles}:${report.stopReason}`) ||
      observations.length < report.cycles &&
        failures.length === 0 &&
        !['OPERATOR_STOP', 'DURATION_LIMIT'].includes(report.stopReason) ||
      observations.length === report.cycles && failures.length !== 0 ||
      payload.events[0]?.type !== 'start' ||
      payload.events[0]?.id !== 'paired-start' ||
      payload.events.length !== observations.length + failures.length + 2 ||
      failures.length === 1 &&
        payload.events.at(-2)?.type !== 'shared_feed_failure' ||
      !observationStreamValid ||
      observations.length > 0 &&
        (priorEffectAt !== report.commonHorizon.effectAt ||
          observations.at(-1).ticker.receivedAt !==
            report.commonHorizon.quoteReceivedAt) ||
      observations.length === 0 &&
        (report.commonHorizon.effectAt !== null ||
          report.commonHorizon.quoteReceivedAt !== null) ||
      !reportArmsReconcile || !decisionsReconcile || !fillsReconcile ||
      !riskStatesReconcile || !terminalArmStatesReconcile ||
      !fillCountsReconcile ||
      !identityMatches(report, payload, expected)) {
    return {error: 'JOURNAL_REPORT_MISMATCH'};
  }
  return {
    status: 'TERMINAL_RECONCILED',
    payload,
    reconciliationStatus,
    attemptedCycles: report.cycles,
    completedCycles: observations.length
  };
}

function safeNumber(value) {
  return isInteger(value) ? value : null;
}

function safeDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
      value >= 0 && value <= MAX_DURATION_MS + 5_000 ? value : null;
}

function validateAccounting(report) {
  for (const arm of report.arms) {
    const valuation = arm.valuation;
    if (!isRecord(valuation) ||
        !Array.isArray(valuation.openPositions) ||
        !Number.isSafeInteger(valuation.startingCapitalCents) ||
        valuation.startingCapitalCents !== 100_000 ||
        !isInteger(valuation.feesCents) || valuation.feesCents < 0 ||
        !isInteger(valuation.turnoverCents) || valuation.turnoverCents < 0 ||
        !isInteger(valuation.exposureCents) || valuation.exposureCents < 0 ||
        !isInteger(valuation.unresolvedObservations) ||
        valuation.unresolvedObservations < 0 ||
        !isInteger(valuation.sampledDrawdownCents) ||
        valuation.sampledDrawdownCents < 0 ||
        valuation.slippageCents !== null &&
          (!isInteger(valuation.slippageCents) || valuation.slippageCents < 0) ||
        valuation.netEquityCents !== null &&
          (!isInteger(valuation.netEquityCents) ||
            valuation.markedEquityCents !== valuation.netEquityCents) ||
        valuation.netEquityCents === null &&
          valuation.markedEquityCents !== null) return 'INVALID_ARM_ACCOUNTING';
    const feeTotal = arm.fills.reduce((sum, fill) =>
      isInteger(fill?.feeCents) ? sum + fill.feeCents : NaN, 0);
    const turnoverTotal = arm.fills.reduce((sum, fill) =>
      isInteger(fill?.grossCents) ? sum + fill.grossCents : NaN, 0);
    if (!Number.isSafeInteger(feeTotal) || !Number.isSafeInteger(turnoverTotal) ||
        arm.fills.some(fill => !isRecord(fill) ||
          !['BUY', 'SELL'].includes(fill.side) ||
          !isInteger(fill.feeCents) || fill.feeCents < 0 ||
          !isInteger(fill.grossCents) || fill.grossCents < 0) ||
        feeTotal !== valuation.feesCents ||
        turnoverTotal !== valuation.turnoverCents ||
        valuation.modeledCostsCents !== undefined &&
          valuation.modeledCostsCents !==
            valuation.feesCents + (valuation.slippageCents ?? 0)) {
      return 'NON_RECONCILING_ACCOUNTING';
    }
  }
  return null;
}

function metricReason(value, absentReason = 'NOT_REPORTED') {
  return value === null ? absentReason : null;
}

function compareForwardAndResearch(report, expected, horizon) {
  const comparison = report.comparison;
  if (!isRecord(comparison) || comparison.schemaVersion !==
      'SPOT_PAPER_SMA_COMPARISON_V1' ||
      comparison.status !== 'COMPARISON_AVAILABLE' ||
      comparison.commonHorizonAt !== horizon || !isRecord(comparison.arms)) {
    return false;
  }
  const comparisonRoles = {
    baseline: expected.models[0].modelId,
    challenger: expected.models[1].modelId,
    cash: 'CASH_NO_TRADE'
  };
  return SPOT_PAPER_PAIRED_ROLES.every((role, index) => {
    const compared = comparison.arms[role];
    const forwarded = report.arms[index];
    const valuation = forwarded.valuation;
    return isRecord(compared) &&
      compared.strategyId === comparisonRoles[role] &&
      compared.valuationAt === horizon &&
      safeNumber(compared.finalNetEquityCents) ===
        safeNumber(valuation.netEquityCents) &&
      compared.fillCount === forwarded.fills.length &&
      compared.feesCents === valuation.feesCents &&
      compared.grossTurnoverCents === valuation.turnoverCents;
  });
}

function armDto(arm, role, expected, report, commonComparisonVerified) {
  const valuation = arm.valuation;
  const fills = arm.fills;
  const fillCount = fills.length;
  const feeTotal = fills.reduce((sum, fill) =>
    isInteger(fill?.feeCents) ? sum + fill.feeCents : NaN, 0);
  const turnoverTotal = fills.reduce((sum, fill) =>
    isInteger(fill?.grossCents) ? sum + fill.grossCents : NaN, 0);
  if (!Number.isSafeInteger(feeTotal) || !Number.isSafeInteger(turnoverTotal) ||
      fills.some(fill => !isRecord(fill) ||
        !['BUY', 'SELL'].includes(fill.side) ||
        !isInteger(fill.feeCents) || fill.feeCents < 0 ||
        !isInteger(fill.grossCents) || fill.grossCents < 0)) return null;
  const fees = safeNumber(valuation.feesCents);
  const turnover = safeNumber(valuation.turnoverCents);
  const slippage = safeNumber(valuation.slippageCents);
  const equity = safeNumber(valuation.netEquityCents);
  const markedEquity = safeNumber(valuation.markedEquityCents);
  const openPositions = Array.isArray(valuation.openPositions) ?
    valuation.openPositions : null;
  const openCount = openPositions?.length ?? null;
  const initialCash = safeNumber(valuation.startingCapitalCents);
  const markAge = safeNumber(valuation.markAgeMs);
  const horizonAvailable = report.commonHorizon.available &&
    isInteger(report.commonHorizon.effectAt);
  let usableEquity = equity;
  let equityReason = null;
  if (openCount !== null && openCount > 0 &&
      (!horizonAvailable || markAge === null || markAge < 0 ||
       markAge > MAX_QUOTE_AGE_MS)) {
    usableEquity = null;
    equityReason = 'COMMON_HORIZON_MARK_UNAVAILABLE';
  } else if (equity === null) {
    equityReason = 'VALUATION_NOT_REPORTED';
  } else if (markedEquity !== equity) {
    usableEquity = null;
    equityReason = 'EQUITY_RECONCILIATION_MISMATCH';
  } else if (openCount === null) {
    usableEquity = null;
    equityReason = 'INVENTORY_STATUS_NOT_REPORTED';
  }
  if (fees !== feeTotal || turnover !== turnoverTotal) return null;
  const pnl = usableEquity === null || initialCash === null ? null :
    usableEquity - initialCash;
  if (pnl !== null && !Number.isSafeInteger(pnl)) return null;
  const cash = role === 'cash' && usableEquity !== null &&
      fillCount === 0 && fees === 0 && turnover === 0 &&
      (slippage === 0 || slippage === null) && openCount === 0 &&
      usableEquity === initialCash ? usableEquity : null;
  const drawdown = safeNumber(valuation.sampledDrawdownCents);
  const exposure = safeNumber(valuation.exposureCents);
  const unresolved = safeNumber(valuation.unresolvedObservations);
  const inventoryStatus = openCount === null ? 'UNKNOWN' :
    openCount === 0 ? 'FLAT' : 'OPEN';
  const metricReasons = {
    cashCents: cash === null ? (role === 'cash' ?
      'CASH_CONTROL_NOT_RECONCILED' : 'NOT_REPORTED_BY_REPORT_SCHEMA') : null,
    netEquityCents: metricReason(usableEquity, equityReason ?? 'NOT_REPORTED'),
    netPnlCents: metricReason(pnl, 'NET_EQUITY_UNAVAILABLE'),
    bookedFeesCents: metricReason(fees),
    modeledSlippageCents: metricReason(slippage),
    hypotheticalExitFeeCents: 'NOT_REPORTED_BY_REPORT_SCHEMA',
    hypotheticalExitSlippageCents: 'NOT_REPORTED_BY_REPORT_SCHEMA',
    turnoverCents: metricReason(turnover),
    fillCount: null,
    exposureCents: metricReason(exposure),
    sampledDrawdownCents: metricReason(drawdown),
    relativeDrawdownBps: 'NOT_REPORTED_BY_REPORT_SCHEMA',
    unresolvedObservations: metricReason(unresolved),
    ...(commonComparisonVerified ? {} : {})
  };
  return {
    role,
    modelId: expected.models[SPOT_PAPER_PAIRED_ROLES.indexOf(role)].modelId,
    tradingStoppedAt: safeNumber(arm.stoppedAt),
    stopReason: arm.stopReason ?? null,
    inventoryStatus,
    cashCents: cash,
    netEquityCents: usableEquity,
    netPnlCents: pnl,
    bookedFeesCents: fees,
    modeledSlippageCents: slippage,
    hypotheticalExitFeeCents: null,
    hypotheticalExitSlippageCents: null,
    turnoverCents: turnover,
    fillCount,
    exposureCents: exposure,
    sampledDrawdownCents: drawdown,
    relativeDrawdownBps: null,
    unresolvedObservations: unresolved,
    metricReasons
  };
}

function unavailableDelta(reason) {
  return {status: 'UNAVAILABLE', reason, netEquityCents: null, netPnlCents: null};
}

function delta(left, right) {
  if (left.netEquityCents === null || right.netEquityCents === null ||
      left.netPnlCents === null || right.netPnlCents === null) return null;
  return {
    status: 'AVAILABLE',
    reason: null,
    netEquityCents: left.netEquityCents - right.netEquityCents,
    netPnlCents: left.netPnlCents - right.netPnlCents
  };
}

function buildDto(report, expected, status, reasonCode, reportValid = true) {
  const horizon = report?.commonHorizon?.effectAt;
  const comparisonVerified = reportValid && report.commonHorizon?.available === true &&
    compareForwardAndResearch(report, expected, horizon);
  const arms = {};
  for (const [index, role] of SPOT_PAPER_PAIRED_ROLES.entries()) {
    arms[role] = reportValid ?
      armDto(report.arms[index], role, expected, report, comparisonVerified) : null;
    if (!arms[role]) {
      arms[role] = {
        role,
        modelId: expected.models[index].modelId,
        tradingStoppedAt: null, stopReason: null, inventoryStatus: 'UNKNOWN',
        cashCents: null, netEquityCents: null, netPnlCents: null,
        bookedFeesCents: null, modeledSlippageCents: null,
        hypotheticalExitFeeCents: null, hypotheticalExitSlippageCents: null,
        turnoverCents: null, fillCount: null, exposureCents: null,
        sampledDrawdownCents: null, relativeDrawdownBps: null,
        unresolvedObservations: null, metricReasons: {
          netEquityCents: 'REPORT_METRICS_UNAVAILABLE'
        }
      };
    }
  }
  let deltas;
  if (!comparisonVerified) {
    const reason = reportValid && report.commonHorizon?.available === true ?
      'COMPARISON_NOT_RECONCILED' : 'COMMON_HORIZON_UNAVAILABLE';
    deltas = {
      status: 'UNAVAILABLE',
      reason,
      challengerMinusBaseline: unavailableDelta(reason),
      baselineMinusCash: unavailableDelta(reason),
      challengerMinusCash: unavailableDelta(reason)
    };
  } else {
    const candidate = {
      challengerMinusBaseline: delta(arms.challenger, arms.baseline),
      baselineMinusCash: delta(arms.baseline, arms.cash),
      challengerMinusCash: delta(arms.challenger, arms.cash)
    };
    if (Object.values(candidate).some(item => item === null)) {
      deltas = {
        status: 'UNAVAILABLE',
        reason: 'ARM_VALUATION_UNAVAILABLE',
        challengerMinusBaseline: candidate.challengerMinusBaseline ??
          unavailableDelta('ARM_VALUATION_UNAVAILABLE'),
        baselineMinusCash: candidate.baselineMinusCash ??
          unavailableDelta('ARM_VALUATION_UNAVAILABLE'),
        challengerMinusCash: candidate.challengerMinusCash ??
          unavailableDelta('ARM_VALUATION_UNAVAILABLE')
      };
    } else {
      deltas = {status: 'AVAILABLE', reason: null, ...candidate};
    }
  }
  const elapsed = safeDuration(report?.elapsedMs);
  const coverage = isInteger(report?.startedAt) && isInteger(horizon) ?
    horizon - report.startedAt : null;
  const legacyQuoteAgeAtValuation = isInteger(horizon) &&
      isInteger(report?.commonHorizon?.quoteReceivedAt) ?
    horizon - report.commonHorizon.quoteReceivedAt : null;
  const legacyTerminalQuoteAge = isInteger(report?.endedAt) &&
      isInteger(report?.commonHorizon?.quoteReceivedAt) ?
    report.endedAt - report.commonHorizon.quoteReceivedAt : null;
  const dto = {
    schemaVersion: SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA,
    evidenceStatus: status,
    evidenceQualification:
      'STRUCTURALLY_RECONCILED_NOT_INDEPENDENTLY_AUTHENTICATED',
    reasonCode,
    syntheticFixture: report?.testOnly === true,
    identity: expectedPublicIdentity(expected),
    timing: {
      requestedDurationMs: MAX_DURATION_MS,
      observedCoverageMs: coverage !== null && coverage >= 0 ? coverage : null,
      actualElapsedMs: elapsed,
      runStoppedAt: safeNumber(report?.endedAt),
      valuationAt: safeNumber(horizon),
      quoteAgeAtValuationMs: safeNumber(
        report?.commonHorizon?.quoteAgeAtEffectMs ?? legacyQuoteAgeAtValuation),
      terminalQuoteAgeMs: safeNumber(
        report?.commonHorizon?.terminalQuoteAgeMs ?? legacyTerminalQuoteAge),
      quoteFreshAtShutdown:
        typeof report?.commonHorizon?.quoteFreshAtShutdown === 'boolean' ?
          report.commonHorizon.quoteFreshAtShutdown :
          legacyTerminalQuoteAge !== null &&
            legacyTerminalQuoteAge >= 0 &&
            legacyTerminalQuoteAge <= MAX_QUOTE_AGE_MS,
      commonHorizonAvailable: report?.commonHorizon?.available === true,
      commonHorizonReason: report?.commonHorizon?.reason ??
        (report?.commonHorizon?.available === true ? null :
          'COMMON_HORIZON_UNAVAILABLE'),
      requestedCycles: MAX_CYCLES,
      attemptedCycles: safeNumber(report?.cycles),
      completedCycles: safeNumber(reportValid ? report._completedCycles : null),
      stopReason: report?.stopReason ?? 'UNKNOWN'
    },
    assumptions: {feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false},
    arms,
    deltas
  };
  return projectSpotPaperPairedDashboard(dto) ??
    createUnknownSpotPaperPairedDashboard('DTO_PROJECTION_FAILED');
}

function nonFinalSnapshotDto(journal, expected, reason) {
  const result = createUnknownSpotPaperPairedDashboard(reason);
  result.identity = expectedPublicIdentity(expected);
  for (const model of expected.models) {
    result.arms[model.role].modelId = model.modelId;
  }
  const payload = getJournalPayload(journal)?.payload;
  result.timing.attemptedCycles = null;
  const observations = Array.isArray(payload?.events) ?
    payload.events.filter(event => event?.type === 'shared_observation').length : null;
  result.timing.completedCycles = isInteger(observations) &&
      observations <= MAX_CYCLES && payload?.runId === expected.runId &&
      payload.sequence === payload.events.length ? observations : null;
  return projectSpotPaperPairedDashboard(result) ??
    createUnknownSpotPaperPairedDashboard('DTO_PROJECTION_FAILED');
}

export function evaluatePairedPaperEvidence({
  expectedIdentity, report: rawReport, journal: suppliedJournal
} = {}) {
  if (!validExpectedIdentity(expectedIdentity)) return fail('EXPECTED_IDENTITY_INVALID');
  const normalizedReport = reportInput(rawReport, expectedIdentity, suppliedJournal);
  if (normalizedReport.invalid) return fail('REPORT_WRAPPER_INVALID');
  const report = normalizedReport.report;
  const journal = normalizedReport.journal;
  if (normalizedReport.hostStatus &&
      normalizedReport.hostStatus !== 'TERMINAL_JOURNAL_VERIFIED') {
    const reason = normalizedReport.hostStatus === 'WRITER_LOCK_PRESENT' ?
      'UNKNOWN_WRITER_OR_INTERRUPTED' :
      normalizedReport.hostStatus === 'INCOMPLETE_UNKNOWN' ?
        'INCOMPLETE_OR_UNKNOWN' : 'HOST_REPORT_NOT_FOUND';
    return nonFinalSnapshotDto(journal, expectedIdentity, reason);
  }
  if (normalizedReport.hostStatus === 'TERMINAL_JOURNAL_VERIFIED' &&
      normalizedReport.hostReconciliationStatus !== undefined &&
      normalizedReport.hostReconciliationStatus !== 'READ_ONLY_VERIFIED') {
    return fail('HOST_EXPORT_RECONCILIATION_MISMATCH');
  }
  if (report !== null && report !== undefined &&
      (!isRecord(report) || report.schemaVersion !== SPOT_PAPER_PAIRED_REPORT_SCHEMA)) {
    return fail('UNKNOWN_REPORT_SCHEMA');
  }
  if (report === null || report === undefined) {
    const journalInfo = getJournalPayload(journal);
    if (journalInfo && Array.isArray(journalInfo.payload.events)) {
      return nonFinalSnapshotDto(journal, expectedIdentity,
        journalInfo.payload.snapshotStatus ? 'UNVERIFIED_SNAPSHOT_STATUS' :
          'TERMINAL_REPORT_NOT_YET_AVAILABLE');
    }
    return fail('TERMINAL_REPORT_MISSING');
  }
  const journalInfo = getJournalPayload(journal);
  if (!journalInfo) return fail('INVALID_JOURNAL');
  const reportError = reportIsValid(report, expectedIdentity);
  if (reportError) return fail(reportError);
  const accountingError = validateAccounting(report);
  if (accountingError) return fail(accountingError);
  const terminal = validateTerminalJournal(journal, report, expectedIdentity);
  if (terminal.error) return fail(terminal.error);
  const status = report.outcome === 'COMPLETED_BOUNDED' ?
    'VERIFIED_COMPLETE' : 'INTERRUPTED';
  const reason = status === 'VERIFIED_COMPLETE' ?
    'TERMINAL_REPORT_RECONCILED' : 'INTERRUPTED_TERMINAL_RECONCILED';
  return buildDto({...report, _completedCycles: terminal.completedCycles},
    expectedIdentity, status, reason);
}

export async function readBoundedJsonFile(path, maxBytes) {
  if (typeof path !== 'string' || !path.startsWith('/') ||
      !isInteger(maxBytes) || maxBytes < 1) throw new Error('INVALID_INPUT_PATH');
  let handle;
  try {
    handle = await open(resolve(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('INPUT_FILE_LIMIT');
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new Error('INPUT_FILE_LIMIT');
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    await handle?.close();
  }
}

export async function evaluatePairedPaperFiles({
  expectedIdentityPath, reportPath
} = {}) {
  let expectedIdentity;
  try {
    expectedIdentity = await readBoundedJsonFile(expectedIdentityPath,
      SPOT_PAPER_PAIRED_MAX_IDENTITY_BYTES);
  } catch {
    return fail('EXPECTED_IDENTITY_FILE_INVALID');
  }
  let report;
  try {
    report = await readBoundedJsonFile(reportPath,
      SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES);
  } catch {
    return fail('HOST_EXPORT_FILE_INVALID_OR_OVERSIZED');
  }
  return evaluatePairedPaperEvidence({expectedIdentity, report});
}
