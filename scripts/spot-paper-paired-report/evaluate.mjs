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
export const SPOT_PAPER_PAIRED_MAX_REPORT_BYTES = 1024 * 1024;
export const SPOT_PAPER_PAIRED_MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
export const SPOT_PAPER_PAIRED_MAX_IDENTITY_BYTES = 16 * 1024;

const MAX_DURATION_MS = 28_800_000;
const MAX_CYCLES = 480;
const MAX_REQUESTS = 960;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_QUOTE_AGE_MS = 10_000;
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
    manifest.assumptions?.feeBpsPerSide === 50 &&
    manifest.assumptions?.slippageBpsPerSide === 10 &&
    manifest.assumptions?.ratesVerified === false &&
    manifest.limits?.maxCycles === MAX_CYCLES &&
    manifest.limits?.maxRequests === MAX_REQUESTS &&
    manifest.limits?.maxDurationMs === MAX_DURATION_MS;
}

function reportIsValid(report, expected) {
  if (!isRecord(report) ||
      report.schemaVersion !== SPOT_PAPER_PAIRED_REPORT_SCHEMA) return 'UNKNOWN_REPORT_SCHEMA';
  if (!isInteger(report.startedAt) || !isInteger(report.endedAt) ||
      report.startedAt < 0 || report.endedAt < report.startedAt ||
      !isInteger(report.elapsedMs) || report.elapsedMs < 0 ||
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
      !isRecord(report.assumptions) ||
      report.assumptions.feeBpsPerSide !== 50 ||
      report.assumptions.slippageBpsPerSide !== 10 ||
      report.assumptions.ratesVerified !== false ||
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
        report.endedAt - report.commonHorizon.quoteReceivedAt > MAX_QUOTE_AGE_MS) {
      return 'INVALID_COMMON_HORIZON';
    }
  } else if (report.commonHorizon.effectAt !== null &&
      !isInteger(report.commonHorizon.effectAt)) {
    return 'INVALID_COMMON_HORIZON';
  }
  for (let index = 0; index < SPOT_PAPER_PAIRED_ROLES.length; index++) {
    const role = SPOT_PAPER_PAIRED_ROLES[index];
    const arm = report.arms[index];
    if (!isRecord(arm) || arm.role !== role ||
        arm.modelId !== expected.models[index].modelId ||
        arm.accountId !== expected.models[index].accountId ||
        !['ACTIVE', 'STOPPED'].includes(arm.tradingStatus) ||
        !Array.isArray(arm.fills) || !isRecord(arm.valuation)) {
      return 'INVALID_ARM_REPORT';
    }
  }
  return null;
}

function validateTerminalJournal(journal, report, expected) {
  const journalInfo = getJournalPayload(journal);
  if (!journalInfo) return {error: 'INVALID_JOURNAL'};
  const {payload, reconciliationStatus, snapshotStatus} = journalInfo;
  if (payload.schemaVersion !== SPOT_PAPER_PAIRED_JOURNAL_SCHEMA ||
      payload.runId !== expected.runId || !isInteger(payload.sequence) ||
      !Array.isArray(payload.events) || payload.sequence !== payload.events.length ||
      payload.sequence > MAX_CYCLES + 4 || !isRecord(payload.manifest) ||
      !isRecord(payload.checkpoint) || !isInteger(payload.checkpoint.cycle) ||
      !Array.isArray(payload.events) ||
      new Set(payload.events.map(event => event?.id)).size !== payload.events.length) {
    return {error: 'INVALID_JOURNAL'};
  }
  if (snapshotStatus === 'RUNNING_SNAPSHOT' &&
      !payload.events.some(event => event?.type === 'terminal')) {
    return {status: 'RUNNING_SNAPSHOT', payload, reconciliationStatus};
  }
  if (snapshotStatus === 'INTERRUPTED' &&
      !payload.events.some(event => event?.type === 'terminal')) {
    return {status: 'INTERRUPTED', payload, reconciliationStatus};
  }
  if (!report || reconciliationStatus !== 'READ_ONLY_VERIFIED') {
    return {error: 'JOURNAL_NOT_READ_ONLY_VERIFIED'};
  }
  const terminal = payload.events.at(-1);
  const observations = payload.events.filter(event =>
    event?.type === 'shared_observation');
  const validResponseRef = response => isRecord(response) &&
    typeof response.path === 'string' &&
    /^responses\/[a-f0-9]{64}\.json$/.test(response.path) &&
    response.path === `responses/${response.sha256}.json` &&
    isInteger(response.bytes) && response.bytes > 0;
  const eventRoles = (items, roleField = 'role') =>
    Array.isArray(items) && items.length === 3 &&
    items.every((item, index) => item?.[roleField] === SPOT_PAPER_PAIRED_ROLES[index]);
  let priorEffectAt = null;
  const observationStreamValid = observations.every((event, index) => {
    const valid = event?.cycle === index + 1 &&
      event.id === `shared:${index + 1}` &&
      isInteger(event.decisionAt) && isInteger(event.effectAt) &&
      event.decisionAt <= event.effectAt && event.observedAt === event.effectAt &&
      (priorEffectAt === null || event.effectAt > priorEffectAt) &&
      validResponseRef(event.ohlc) && validResponseRef(event.ticker) &&
      eventRoles(event.decisions) && eventRoles(event.fills) &&
      eventRoles(event.riskStates) && eventRoles(event.valuations) &&
      event.fills.every(item => Array.isArray(item.fills));
    if (valid) priorEffectAt = event.effectAt;
    return valid;
  });
  const reportArmsReconcile = report.arms.every(arm =>
    Array.isArray(arm.decisions) && arm.decisions.length === report.cycles &&
    Array.isArray(arm.riskStates) && arm.riskStates.length === report.cycles);
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
      observations.length !== report.cycles ||
      payload.events[0]?.type !== 'start' ||
      payload.events[0]?.id !== 'paired-start' ||
      !observationStreamValid ||
      report.cycles > 0 &&
        priorEffectAt !== report.commonHorizon.effectAt ||
      report.cycles === 0 && report.commonHorizon.effectAt !== null ||
      !reportArmsReconcile || !fillCountsReconcile ||
      !identityMatches(report, payload, expected)) {
    return {error: 'JOURNAL_REPORT_MISMATCH'};
  }
  return {status: 'TERMINAL_RECONCILED', payload, reconciliationStatus};
}

function safeNumber(value) {
  return isInteger(value) ? value : null;
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
  const elapsed = safeNumber(report?.elapsedMs);
  const coverage = isInteger(report?.startedAt) && isInteger(horizon) ?
    horizon - report.startedAt : null;
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
      requestedCycles: MAX_CYCLES,
      completedCycles: safeNumber(report?.cycles),
      stopReason: report?.stopReason ?? 'UNKNOWN'
    },
    assumptions: {feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false},
    arms,
    deltas
  };
  return projectSpotPaperPairedDashboard(dto) ??
    createUnknownSpotPaperPairedDashboard('DTO_PROJECTION_FAILED');
}

function runningSnapshotDto(journal, expected, status, reason) {
  const result = createUnknownSpotPaperPairedDashboard(reason);
  result.evidenceStatus = status;
  result.identity = expectedPublicIdentity(expected);
  for (const model of expected.models) {
    result.arms[model.role].modelId = model.modelId;
  }
  const payload = getJournalPayload(journal)?.payload;
  if (isInteger(payload?.manifest?.startedAt)) {
    result.timing.runStoppedAt = null;
  }
  return projectSpotPaperPairedDashboard(result) ??
    createUnknownSpotPaperPairedDashboard('DTO_PROJECTION_FAILED');
}

export function evaluatePairedPaperEvidence({expectedIdentity, report, journal} = {}) {
  if (!validExpectedIdentity(expectedIdentity)) return fail('EXPECTED_IDENTITY_INVALID');
  if (report !== null && report !== undefined &&
      (!isRecord(report) || report.schemaVersion !== SPOT_PAPER_PAIRED_REPORT_SCHEMA)) {
    return fail('UNKNOWN_REPORT_SCHEMA');
  }
  if (report === null || report === undefined) {
    const journalInfo = getJournalPayload(journal);
    if (journalInfo?.snapshotStatus === 'RUNNING_SNAPSHOT') {
      return runningSnapshotDto(journal, expectedIdentity, 'RUNNING_SNAPSHOT',
        'TERMINAL_REPORT_NOT_YET_AVAILABLE');
    }
    if (journalInfo?.snapshotStatus === 'INTERRUPTED') {
      return runningSnapshotDto(journal, expectedIdentity, 'INTERRUPTED',
        'INTERRUPTED_WITHOUT_TERMINAL_REPORT');
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
  if (terminal.status === 'RUNNING_SNAPSHOT') {
    return runningSnapshotDto(journal, expectedIdentity, 'RUNNING_SNAPSHOT',
      'RUNNING_SNAPSHOT_NOT_FINAL_EVIDENCE');
  }
  if (terminal.error) return fail(terminal.error);
  const status = report.outcome === 'COMPLETED_BOUNDED' ?
    'VERIFIED_COMPLETE' : 'INTERRUPTED';
  const reason = status === 'VERIFIED_COMPLETE' ?
    'TERMINAL_REPORT_RECONCILED' : 'INTERRUPTED_TERMINAL_RECONCILED';
  return buildDto(report, expectedIdentity, status, reason);
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
  expectedIdentityPath, reportPath, journalPath
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
      SPOT_PAPER_PAIRED_MAX_REPORT_BYTES);
  } catch {
    return fail('REPORT_FILE_INVALID_OR_OVERSIZED');
  }
  let journal;
  try {
    journal = await readBoundedJsonFile(journalPath,
      SPOT_PAPER_PAIRED_MAX_JOURNAL_BYTES);
  } catch {
    return fail('JOURNAL_FILE_INVALID_OR_OVERSIZED');
  }
  return evaluatePairedPaperEvidence({expectedIdentity, report, journal});
}
