import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  evaluatePairedPaperEvidence,
  evaluatePairedPaperFiles,
  readBoundedJsonFile,
  SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES
} from '../scripts/spot-paper-paired-report/evaluate.mjs';
import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA
} from '../scripts/spot-paper-paired-report/contract.mjs';

const models = [
  {role: 'baseline', modelId: 'BTC_EUR_SMA5_SMA20_V1', accountId: 'base-account'},
  {role: 'challenger', modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1',
    accountId: 'challenger-account'},
  {role: 'cash', modelId: 'CASH_CONTROL_V1', accountId: 'cash-account'}
];
const identity = () => ({
  schemaVersion: SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_SCHEMA,
  runId: 'paired-synthetic-001',
  pair: 'BTC/EUR',
  sourceSha256: '1'.repeat(64),
  configSha256: '2'.repeat(64),
  researchSourceSha256: '3'.repeat(64),
  feedSourceId: 'SYNTHETIC_TEST_ONLY',
  comparisonEngineId: 'SPOT_PAPER_SMA_COMPARISON_V1',
  models: structuredClone(models)
});

function arm(role, {fills = [], equity = 100_000, fees = 0, slippage = 0,
  turnover = 0, exposure = 0, drawdown = 0, openPositions = [],
  markAgeMs = null, stoppedAt = null, stopReason = null} = {}) {
  return {
    role,
    modelId: models.find(model => model.role === role).modelId,
    accountId: models.find(model => model.role === role).accountId,
    tradingStatus: stoppedAt === null ? 'ACTIVE' : 'STOPPED',
    stoppedAt,
    stopReason,
    decisions: Array.from({length: 480}, (_, index) => ({
      decision: null, decidedAt: 1_000 + (index + 1) * 60_000 - 2
    })),
    riskStates: Array.from({length: 480}, (_, index) =>
      stoppedAt !== null && index === 479 ? {stopReason, stoppedAt} : {}),
    fills,
    valuation: {
      startingCapitalCents: 100_000,
      netEquityCents: equity,
      markedEquityCents: equity,
      feesCents: fees,
      slippageCents: slippage,
      modeledCostsCents: fees + slippage,
      turnoverCents: turnover,
      exposureCents: exposure,
      sampledDrawdownCents: drawdown,
      unresolvedObservations: 0,
      openPositions,
      markAgeMs
    }
  };
}

function fixture() {
  const expectedIdentity = identity();
  const reportArms = [
    arm('baseline', {
      fills: [
        {side: 'BUY', grossCents: 10_000, feeCents: 50, executionAt: 61_000},
        {side: 'SELL', grossCents: 10_000, feeCents: 50, executionAt: 61_000}
      ],
      equity: 99_900, fees: 100, slippage: 20, turnover: 20_000,
      drawdown: 200, stoppedAt: 28_750_000, stopReason: 'SESSION_LOSS_LIMIT'
    }),
    arm('challenger', {equity: 99_500, drawdown: 500}),
    arm('cash', {})
  ];
  const report = {
    schemaVersion: 'SPOT_PAPER_PAIRED_REPORT_V1',
    runId: expectedIdentity.runId,
    pair: expectedIdentity.pair,
    models: structuredClone(models),
    comparisonEngineId: expectedIdentity.comparisonEngineId,
    feedSourceId: expectedIdentity.feedSourceId,
    sourceSha256: expectedIdentity.sourceSha256,
    configSha256: expectedIdentity.configSha256,
    researchSourceSha256: expectedIdentity.researchSourceSha256,
    integrationStatus: 'SYNTHETIC_ONLY',
    outcome: 'COMPLETED_BOUNDED',
    stopReason: 'CYCLE_LIMIT',
    startedAt: 1_000,
    endedAt: 28_801_000,
    elapsedMs: 28_800_000,
    wallClockElapsedMs: 28_800_000,
    failureReason: null,
    fullEightHourCompletion: false,
    coverage: 'CONFIGURED_DURATION_REACHED',
    cycles: 480,
    requests: 960,
    deliveredBytes: 1_000,
    commonHorizon: {
      available: true, quoteReceivedAt: 28_801_000, effectAt: 28_801_000
    },
    assumptions: {feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false},
    arms: reportArms,
    comparison: {
      schemaVersion: 'SPOT_PAPER_SMA_COMPARISON_V1',
      status: 'COMPARISON_AVAILABLE',
      commonHorizonAt: 28_801_000,
      arms: {
        baseline: {
          strategyId: models[0].modelId, valuationAt: 28_801_000,
          finalNetEquityCents: 99_900, fillCount: 2, feesCents: 100,
          grossTurnoverCents: 20_000
        },
        challenger: {
          strategyId: models[1].modelId, valuationAt: 28_801_000,
          finalNetEquityCents: 99_500, fillCount: 0, feesCents: 0,
          grossTurnoverCents: 0
        },
        cash: {
          strategyId: 'CASH_NO_TRADE', valuationAt: 28_801_000,
          finalNetEquityCents: 100_000, fillCount: 0, feesCents: 0,
          grossTurnoverCents: 0
        }
      }
    },
    testOnly: true,
    liveTrading: false,
    executionImpact: false,
    autoPromotion: false
  };
  const manifest = {
    schemaVersion: 'SPOT_PAPER_PAIRED_MANIFEST_V1',
    runId: expectedIdentity.runId,
    startedAt: report.startedAt,
    mode: 'paper',
    pair: expectedIdentity.pair,
    feedSourceId: expectedIdentity.feedSourceId,
    sourceSha256: expectedIdentity.sourceSha256,
    configSha256: expectedIdentity.configSha256,
    researchSourceSha256: expectedIdentity.researchSourceSha256,
    models: structuredClone(models),
    comparisonEngineId: expectedIdentity.comparisonEngineId,
    assumptions: structuredClone(report.assumptions),
    limits: {
      maxCycles: 480, maxRequests: 960,
      maxBytes: 64 * 1024 * 1024, maxResponseBytes: 256 * 1024,
      maxDurationMs: 28_800_000, requestTimeoutMs: 5_000,
      pollIntervalMs: 60_000
    }
  };
  const events = [
    {id: 'paired-start', type: 'start', at: report.startedAt},
    ...Array.from({length: report.cycles}, (_, index) => ({
      id: `shared:${index + 1}:${'b'.repeat(64)}`,
      type: 'shared_observation',
      cycle: index + 1,
      decisionAt: report.startedAt + (index + 1) * 60_000 - 2,
      effectAt: report.startedAt + (index + 1) * 60_000,
      observedAt: report.startedAt + (index + 1) * 60_000,
      ohlc: {
        path: `responses/${'a'.repeat(64)}.json`, sha256: 'a'.repeat(64),
        bytes: 100,
        requestStartedAt: report.startedAt + (index + 1) * 60_000 - 4,
        receivedAt: report.startedAt + (index + 1) * 60_000 - 3
      },
      ticker: {
        path: `responses/${'b'.repeat(64)}.json`, sha256: 'b'.repeat(64),
        bytes: 100,
        requestStartedAt: report.startedAt + (index + 1) * 60_000 - 1,
        receivedAt: report.startedAt + (index + 1) * 60_000
      },
      decisions: models.map(model => ({
        role: model.role,
        decidedAt: report.startedAt + (index + 1) * 60_000 - 2,
        decision: null, skippedReason: null, metadata: null
      })),
      fills: models.map((model, roleIndex) => ({
        role: model.role,
        fills: index === 0 ? structuredClone(reportArms[roleIndex].fills.map(
          ({executionAt, ...fill}) => fill)) : []
      })),
      riskStates: models.map((model, roleIndex) => {
        const state = reportArms[roleIndex].riskStates[index];
        return {
          role: model.role, state: {},
          stopReason: state.stopReason ?? null,
          stoppedAt: state.stoppedAt ?? null, skipped: false
        };
      }),
      valuations: models.map(model => ({role: model.role}))
    })),
    {id: 'paired-terminal', type: 'terminal', at: report.endedAt,
      report: structuredClone(report)}
  ];
  const journal = {
    schemaVersion: 'SPOT_PAPER_PILOT_JOURNAL_V1',
    runId: expectedIdentity.runId,
    manifest,
    createdAt: report.startedAt,
    sequence: events.length,
    checkpoint: {
      cycle: report.cycles,
      stopReason: report.stopReason,
      counters: {requests: report.requests, bytes: report.deliveredBytes}
    },
    events,
    reconciliationStatus: 'READ_ONLY_VERIFIED'
  };
  return {expectedIdentity, report, journal};
}

test('projects a compatible synthetic terminal run without winner or cost double-counting', () => {
  const output = evaluatePairedPaperEvidence(fixture());
  assert.equal(output.evidenceStatus, 'VERIFIED_COMPLETE');
  assert.equal(output.syntheticFixture, true);
  assert.equal(output.independentAuthentication, 'NOT_ESTABLISHED');
  assert.equal(output.identity.models[0].role, 'baseline');
  assert.equal(output.identity.models[0].accountId, undefined);
  assert.equal(output.arms.baseline.netPnlCents, -100);
  assert.equal(output.arms.baseline.bookedFeesCents, 100);
  assert.equal(output.arms.baseline.modeledSlippageCents, 20);
  assert.equal(output.arms.baseline.hypotheticalExitFeeCents, null);
  assert.equal(output.arms.baseline.metricReasons.hypotheticalExitFeeCents,
    'NOT_REPORTED_BY_REPORT_SCHEMA');
  assert.equal(output.arms.baseline.cashCents, null);
  assert.equal(output.arms.challenger.fillCount, 0);
  assert.equal(output.arms.challenger.netPnlCents, -500);
  assert.equal(output.arms.cash.cashCents, 100_000);
  assert.equal(output.deltas.challengerMinusBaseline.netPnlCents, -400);
  assert.equal(output.deltas.challengerMinusCash.netPnlCents, -500);
  assert.equal(output.timing.requestedDurationMs, 28_800_000);
  assert.equal(output.timing.requestedCycles, 480);
  assert.equal(output.timing.attemptedCycles, 480);
  assert.equal(output.timing.completedCycles, 480);
  assert.equal(output.timing.observedCoverageMs, 28_800_000);
  assert.equal(output.timing.runStoppedAt, 28_801_000);
  assert.equal(output.timing.valuationAt, 28_801_000);
  assert.equal(output.timing.commonHorizonAvailable, true);
  assert.equal(output.timing.quoteAgeAtValuationMs, 0);
  assert.equal(output.timing.terminalQuoteAgeMs, 0);
  assert.equal(output.timing.quoteFreshAtShutdown, true);
  assert.equal(output.arms.baseline.tradingStoppedAt, 28_750_000);
  assert.equal(output.decision, 'NO_WINNER_OR_PROMOTION');
  assert.deepEqual(Object.keys(output), [
    'schemaVersion', 'evidenceStatus', 'evidenceQualification', 'reasonCode',
    'syntheticFixture', 'independentAuthentication', 'identity', 'timing',
    'assumptions', 'arms', 'deltas', 'decision'
  ]);
  assert.equal(JSON.stringify(output).includes('accountId'), false);
  assert.equal(JSON.stringify(output).includes('failureReason'), false);
});

test('preserves fractional performance-clock milliseconds without threshold rounding', () => {
  for (const [elapsedMs, completed, coverage] of [
    [28_800_000 - 0.25, false, 'PARTIAL'],
    [28_800_000 + 0.25, true, 'CONFIGURED_DURATION_REACHED']
  ]) {
    const input = fixture();
    input.report.stopReason = 'DURATION_LIMIT';
    input.report.elapsedMs = elapsedMs;
    input.report.fullEightHourCompletion = completed;
    input.report.coverage = coverage;
    input.journal.checkpoint.stopReason = input.report.stopReason;
    input.journal.events.at(-1).report = structuredClone(input.report);
    const output = evaluatePairedPaperEvidence(input);
    assert.equal(output.evidenceStatus, 'VERIFIED_COMPLETE');
    assert.equal(output.timing.actualElapsedMs, elapsedMs);
    assert.equal(output.reasonCode, 'TERMINAL_REPORT_RECONCILED');
  }
});

test('accepts a historically fresh common horizon with a stale terminal quote', () => {
  const input = fixture();
  const horizon = input.report.endedAt - 32_712;
  const observation = input.journal.events.at(-2);
  observation.decisionAt = horizon - 2;
  observation.decisions.forEach((item, index) => {
    item.decidedAt = horizon - 2;
    input.report.arms[index].decisions.at(-1).decidedAt = horizon - 2;
  });
  observation.effectAt = horizon;
  observation.observedAt = horizon;
  observation.ohlc.receivedAt = horizon - 3;
  observation.ohlc.requestStartedAt = horizon - 4;
  observation.ticker.requestStartedAt = horizon - 1;
  observation.ticker.receivedAt = horizon;
  input.report.commonHorizon = {
    available: true, reason: null,
    quoteReceivedAt: horizon, effectAt: horizon,
    quoteAgeAtEffectMs: 0, terminalQuoteAgeMs: 32_712,
    quoteFreshAtShutdown: false
  };
  input.report.comparison.commonHorizonAt = horizon;
  for (const arm of Object.values(input.report.comparison.arms)) {
    arm.valuationAt = horizon;
  }
  input.journal.events.at(-1).report = structuredClone(input.report);

  const output = evaluatePairedPaperEvidence(input);
  assert.equal(output.evidenceStatus, 'VERIFIED_COMPLETE');
  assert.equal(output.timing.valuationAt, horizon);
  assert.equal(output.timing.quoteAgeAtValuationMs, 0);
  assert.equal(output.timing.terminalQuoteAgeMs, 32_712);
  assert.equal(output.timing.quoteFreshAtShutdown, false);
  assert.equal(output.timing.commonHorizonAvailable, true);
});

test('dashboard projection allowlists legacy and V2 fee assumptions', () => {
  const legacy = evaluatePairedPaperEvidence(fixture());
  legacy.assumptions.privateMetadata = {nested: {secret: 'not-for-browser'}};
  legacy.assumptions.unrecognized = 'drop';
  const safeLegacy = projectSpotPaperPairedDashboard(legacy);
  assert.deepEqual(safeLegacy.assumptions, {
    feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false
  });

  const v2 = structuredClone(legacy);
  v2.identity.modelPairId = 'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1';
  v2.identity.models = [
    {role: 'baseline', modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1'},
    {role: 'challenger',
      modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1'},
    {role: 'cash', modelId: 'CASH_CONTROL_V1'}
  ];
  for (const role of ['baseline', 'challenger', 'cash']) {
    const model = v2.identity.models.find(item => item.role === role);
    v2.arms[role].modelId = model.modelId;
  }
  v2.trendActivityDiagnostic = {
    schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
    status: 'PARTIAL_COVERAGE',
    completedRoundTripCount: 0,
    requiredCompletedRoundTrips: 5,
    observedCoverageMs: 28_800_000,
    requiredCoverageMs: 86_400_000,
    completeWindow: false,
    forcedTrades: false,
    deadlineExtensionAllowed: false,
    profitability: 'NOT_ASSESSED'
  };
  v2.assumptions = {
    feeBpsPerSide: 20,
    slippageBpsPerSide: 10,
    ratesVerified: false,
    accountContractId: 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2',
    accountContractVersion: 2,
    feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION',
    feeSource: 'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea',
    feeAsOf: '2026-11-09',
    accountTier: 'UNKNOWN',
    accountingEngine: 'PAIRED_FEE_SCENARIO_LEDGER_V1',
    privateMetadata: {nested: {secret: 'not-for-browser'}}
  };
  const safeV2 = projectSpotPaperPairedDashboard(v2);
  assert.deepEqual(safeV2.assumptions, {
    feeBpsPerSide: 20,
    slippageBpsPerSide: 10,
    ratesVerified: false,
    accountContractId: 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2',
    accountContractVersion: 2,
    feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION',
    feeSource: 'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea',
    feeAsOf: '2026-11-09',
    accountTier: 'UNKNOWN',
    accountingEngine: 'PAIRED_FEE_SCENARIO_LEDGER_V1'
  });
  assert.equal(safeV2.identity.modelPairId,
    'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1');
  assert.deepEqual(safeV2.identity.models, v2.identity.models);
  assert.equal(safeV2.trendActivityDiagnostic.status, 'PARTIAL_COVERAGE');
  assert.equal(projectSpotPaperPairedDashboard({
    ...v2,
    identity: {...v2.identity, modelPairId: 'UNRECOGNIZED'}
  }), null);
  assert.equal(projectSpotPaperPairedDashboard({
    ...v2,
    assumptions: {...v2.assumptions, accountingEngine: 'UNRECOGNIZED'}
  }), null);
});

test('historical V1 report identity cannot be relabeled as the next-run model pair', () => {
  const input = fixture();
  input.expectedIdentity.modelPairId =
    'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1';
  input.expectedIdentity.models = [
    {...input.expectedIdentity.models[0],
      modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1'},
    {...input.expectedIdentity.models[1],
      modelId: 'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1'},
    input.expectedIdentity.models[2]
  ];
  input.report.trendActivityDiagnostic = {
    schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
    status: 'PARTIAL_COVERAGE',
    completedRoundTripCount: 0,
    requiredCompletedRoundTrips: 5,
    observedCoverageMs: Math.floor(input.report.elapsedMs),
    requiredCoverageMs: 86_400_000,
    completeWindow: false,
    forcedTrades: false,
    deadlineExtensionAllowed: false,
    profitability: 'NOT_ASSESSED'
  };
  input.journal.events.at(-1).report =
    structuredClone(input.report);
  const result = evaluatePairedPaperEvidence(input);
  assert.equal(result.evidenceStatus, 'CORRUPT_UNKNOWN');
  assert.equal(result.reasonCode, 'IDENTITY_MISMATCH');
});

test('trend activity round trips reconcile to verified challenger sell fills', () => {
  const input = fixture();
  const nextRunModels = [
    'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1',
    'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1',
    'CASH_CONTROL_V1'
  ];
  input.expectedIdentity.modelPairId =
    'BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1';
  input.expectedIdentity.models = input.expectedIdentity.models.map((model, index) => ({
    ...model, modelId: nextRunModels[index]
  }));
  input.report.modelPairId = input.expectedIdentity.modelPairId;
  input.report.models = structuredClone(input.expectedIdentity.models);
  input.report.arms.forEach((arm, index) => {
    arm.modelId = nextRunModels[index];
    input.report.comparison.arms[arm.role].strategyId = nextRunModels[index];
  });
  input.report.assumptions = {
    feeBpsPerSide: 20,
    slippageBpsPerSide: 10,
    ratesVerified: false,
    accountContractId: 'BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2',
    accountContractVersion: 2,
    feeBasis: 'EEA_SPOT_ONLY_TAKER_ASSUMPTION',
    feeSource: 'https://www.okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea',
    feeAsOf: '2026-11-09',
    accountTier: 'UNKNOWN',
    accountingEngine: 'PAIRED_FEE_SCENARIO_LEDGER_V1'
  };
  input.report.trendActivityDiagnostic = {
    schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
    status: 'PARTIAL_COVERAGE',
    completedRoundTripCount: 0,
    requiredCompletedRoundTrips: 5,
    observedCoverageMs: Math.floor(input.report.elapsedMs),
    requiredCoverageMs: 86_400_000,
    completeWindow: false,
    forcedTrades: false,
    deadlineExtensionAllowed: false,
    profitability: 'NOT_ASSESSED'
  };
  input.journal.manifest.modelPairId = input.expectedIdentity.modelPairId;
  input.journal.manifest.models = structuredClone(input.expectedIdentity.models);
  input.journal.manifest.assumptions = structuredClone(input.report.assumptions);
  input.journal.events.at(-1).report = structuredClone(input.report);
  assert.equal(evaluatePairedPaperEvidence(input).evidenceStatus,
    'VERIFIED_COMPLETE');

  input.report.trendActivityDiagnostic.completedRoundTripCount = 1;
  input.journal.events.at(-1).report = structuredClone(input.report);
  const tampered = evaluatePairedPaperEvidence(input);
  assert.equal(tampered.evidenceStatus, 'CORRUPT_UNKNOWN');
  assert.equal(tampered.reasonCode, 'INVALID_TREND_ACTIVITY_DIAGNOSTIC');
});

test('rejects shared observations whose common decision time is not the latest arm decision', () => {
  const input = fixture();
  input.journal.events[1].decisions[0].decidedAt++;
  assert.equal(evaluatePairedPaperEvidence(input).reasonCode,
    'JOURNAL_REPORT_MISMATCH');
});

test('rejects stale intermediate quotes and report/journal content mismatches', () => {
  const stale = fixture();
  for (let index = 1; index < stale.journal.events.length - 1; index++) {
    const event = stale.journal.events[index];
    event.effectAt += 10_001;
    event.observedAt = event.effectAt;
    if (index > 1) {
      event.ticker.requestStartedAt += 10_001;
      event.ticker.receivedAt += 10_001;
    }
  }
  stale.report.startedAt += 10_001;
  stale.report.endedAt += 10_001;
  stale.report.commonHorizon.effectAt += 10_001;
  stale.report.commonHorizon.quoteReceivedAt += 10_001;
  stale.report.comparison.commonHorizonAt += 10_001;
  for (const arm of Object.values(stale.report.comparison.arms)) {
    arm.valuationAt += 10_001;
  }
  stale.journal.manifest.startedAt = stale.report.startedAt;
  stale.journal.createdAt = stale.report.startedAt;
  stale.journal.events[0].at = stale.report.startedAt;
  stale.journal.events.at(-1).at = stale.report.endedAt;
  stale.journal.events.at(-1).report = structuredClone(stale.report);
  assert.equal(evaluatePairedPaperEvidence(stale).reasonCode,
    'JOURNAL_REPORT_MISMATCH');

  for (const mutate of [
    input => { input.journal.events[1].decisions[0].decision = {direction: 'ENTRY'}; },
    input => { input.journal.events[1].fills[0].fills[0].grossCents++; },
    input => { input.journal.events[1].riskStates[0].state.lossLimitReached = true; },
    input => { input.journal.events[1].ohlc.requestStartedAt =
      input.report.startedAt - 1; },
    input => { input.journal.events[2].ohlc.requestStartedAt =
      input.journal.events[1].effectAt - 1; }
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(evaluatePairedPaperEvidence(input).reasonCode,
      'JOURNAL_REPORT_MISMATCH');
  }

  const mismatchedStop = fixture();
  mismatchedStop.report.arms[0].tradingStatus = 'ACTIVE';
  mismatchedStop.report.arms[0].stopReason = null;
  mismatchedStop.report.arms[0].stoppedAt = null;
  mismatchedStop.journal.events.at(-1).report =
    structuredClone(mismatchedStop.report);
  assert.equal(evaluatePairedPaperEvidence(mismatchedStop).reasonCode,
    'JOURNAL_REPORT_MISMATCH');
});

test('accepts combined host exports and keeps lock-only snapshots unknown', () => {
  const input = fixture();
  input.report = {
    schemaVersion: 'SPOT_PAPER_PAIRED_HOST_EXPORT_V1',
    runId: input.expectedIdentity.runId,
    status: 'TERMINAL_JOURNAL_VERIFIED',
    verifiedTerminal: true,
    reconciliationStatus: 'READ_ONLY_VERIFIED',
    report: input.report,
    journal: input.journal
  };
  assert.equal(evaluatePairedPaperEvidence({
    expectedIdentity: input.expectedIdentity, report: input.report
  }).evidenceStatus,
    'VERIFIED_COMPLETE');
  const mismatchedExport = structuredClone(input.report);
  mismatchedExport.reconciliationStatus = 'UNKNOWN_WRITER_OR_INTERRUPTED';
  assert.equal(evaluatePairedPaperEvidence({
    expectedIdentity: input.expectedIdentity, report: mismatchedExport
  }).reasonCode, 'HOST_EXPORT_RECONCILIATION_MISMATCH');

  const killedWriter = fixture();
  killedWriter.journal.events.pop();
  killedWriter.journal.sequence = killedWriter.journal.events.length;
  killedWriter.journal.reconciliationStatus = 'UNKNOWN_WRITER_OR_INTERRUPTED';
  killedWriter.report = {
    schemaVersion: 'SPOT_PAPER_PAIRED_HOST_EXPORT_V1',
    runId: killedWriter.expectedIdentity.runId,
    status: 'WRITER_LOCK_PRESENT',
    verifiedTerminal: false,
    reconciliationStatus: 'UNKNOWN_WRITER_OR_INTERRUPTED',
    report: null,
    journal: killedWriter.journal
  };
  const unknown = evaluatePairedPaperEvidence({
    expectedIdentity: killedWriter.expectedIdentity,
    report: killedWriter.report
  });
  assert.equal(unknown.evidenceStatus, 'CORRUPT_UNKNOWN');
  assert.equal(unknown.reasonCode, 'UNKNOWN_WRITER_OR_INTERRUPTED');
  assert.equal(unknown.timing.completedCycles, 480);
  assert.equal(unknown.arms.baseline.netEquityCents, null);
  assert.equal(unknown.timing.runStoppedAt, null);
});

test('retains a verified interrupted report and keeps stop time separate from valuation time', () => {
  const input = fixture();
  input.report.outcome = 'INTERRUPTED_OR_STOPPED';
  input.report.stopReason = 'OPERATOR_STOP';
  input.report.arms[0].stopReason = 'SESSION_LOSS_LIMIT';
  input.journal.checkpoint.stopReason = input.report.stopReason;
  input.journal.events.at(-1).report = structuredClone(input.report);
  const output = evaluatePairedPaperEvidence(input);
  assert.equal(output.evidenceStatus, 'INTERRUPTED');
  assert.equal(output.timing.stopReason, 'OPERATOR_STOP');
  assert.equal(output.arms.baseline.tradingStoppedAt, 28_750_000);
  assert.equal(output.timing.valuationAt, 28_801_000);
});

test('separates attempted from completed cycles when a shared-feed cycle fails', () => {
  const input = fixture();
  const {report, journal} = input;
  const lastObservation = journal.events[1];
  report.outcome = 'INTERRUPTED_OR_STOPPED';
  report.stopReason = 'SHARED_FEED_FAILURE';
  report.cycles = 2;
  report.requests = 3;
  report.endedAt = 62_000;
  report.elapsedMs = 61_000;
  report.wallClockElapsedMs = 61_000;
  report.fullEightHourCompletion = false;
  report.coverage = 'PARTIAL';
  report.commonHorizon = {available: true, quoteReceivedAt: 61_000, effectAt: 61_000};
  report.comparison.status = 'UNAVAILABLE';
  for (const item of report.arms) {
    item.decisions = item.decisions.slice(0, 1);
    item.riskStates = item.riskStates.slice(0, 1);
  }
  report.arms[0].tradingStatus = 'ACTIVE';
  report.arms[0].stopReason = null;
  report.arms[0].stoppedAt = null;
  journal.events = [
    journal.events[0],
    lastObservation,
    {
      id: 'shared-failure:2:SHARED_FEED_FAILURE',
      type: 'shared_feed_failure',
      cycle: 2,
      reason: 'synthetic provider failure'
    },
    {
      id: 'paired-terminal',
      type: 'terminal',
      at: report.endedAt,
      report: structuredClone(report)
    }
  ];
  journal.sequence = journal.events.length;
  journal.checkpoint.cycle = 2;
  journal.checkpoint.stopReason = report.stopReason;
  journal.checkpoint.counters = {requests: 3, bytes: report.deliveredBytes};
  const output = evaluatePairedPaperEvidence(input);
  assert.equal(output.evidenceStatus, 'INTERRUPTED');
  assert.equal(output.timing.attemptedCycles, 2);
  assert.equal(output.timing.completedCycles, 1);
  assert.equal(output.timing.valuationAt, 61_000);

  const reordered = structuredClone(input);
  reordered.journal.events = [
    reordered.journal.events[0],
    reordered.journal.events[2],
    reordered.journal.events[1],
    reordered.journal.events[3]
  ];
  assert.equal(evaluatePairedPaperEvidence(reordered).reasonCode,
    'JOURNAL_REPORT_MISMATCH');
});

test('does not trust a self-declared running snapshot without fresh liveness evidence', () => {
  const input = fixture();
  input.report = null;
  input.journal.snapshotStatus = 'RUNNING_SNAPSHOT';
  input.journal.events.pop();
  input.journal.sequence = input.journal.events.length;
  const output = evaluatePairedPaperEvidence(input);
  assert.equal(output.evidenceStatus, 'CORRUPT_UNKNOWN');
  assert.equal(output.reasonCode, 'UNVERIFIED_SNAPSHOT_STATUS');
  assert.equal(output.arms.baseline.netEquityCents, null);
  assert.equal(output.timing.attemptedCycles, null);
  assert.equal(output.timing.completedCycles, 480);
});

test('rejects forged or mismatched run/source identity and terminal report copies', () => {
  const forged = fixture();
  forged.report.runId = 'another-run';
  assert.equal(evaluatePairedPaperEvidence(forged).evidenceStatus, 'CORRUPT_UNKNOWN');

  const mismatchedJournal = fixture();
  mismatchedJournal.journal.events.at(-1).report.runId = 'another-run';
  assert.equal(evaluatePairedPaperEvidence(mismatchedJournal).reasonCode,
    'JOURNAL_REPORT_MISMATCH');

  const wrongExpected = fixture();
  wrongExpected.expectedIdentity.configSha256 = 'f'.repeat(64);
  assert.equal(evaluatePairedPaperEvidence(wrongExpected).reasonCode,
    'IDENTITY_MISMATCH');
});

test('keeps unknown report versions unknown', () => {
  const input = fixture();
  input.report.schemaVersion = 'SPOT_PAPER_PAIRED_REPORT_V2';
  assert.equal(evaluatePairedPaperEvidence(input).reasonCode, 'UNKNOWN_REPORT_SCHEMA');
});

test('rejects non-reconciling fees, turnover, and modeled cost totals', () => {
  for (const mutate of [
    report => { report.arms[0].valuation.feesCents++; },
    report => { report.arms[0].valuation.turnoverCents++; },
    report => { report.arms[0].valuation.modeledCostsCents++; }
  ]) {
    const input = fixture();
    mutate(input.report);
    input.journal.events.at(-1).report = structuredClone(input.report);
    assert.equal(evaluatePairedPaperEvidence(input).reasonCode,
      'NON_RECONCILING_ACCOUNTING');
  }
});

test('does not compare stale or missing common-horizon marks for open inventory', () => {
  for (const markAgeMs of [null, 20_000]) {
    const input = fixture();
    input.report.arms[0].valuation.openPositions = [{quantitySat: 100}];
    input.report.arms[0].valuation.markAgeMs = markAgeMs;
    input.report.comparison.status = 'UNAVAILABLE';
    input.journal.events.at(-1).report = structuredClone(input.report);
    const output = evaluatePairedPaperEvidence(input);
    assert.equal(output.evidenceStatus, 'VERIFIED_COMPLETE');
    assert.equal(output.arms.baseline.inventoryStatus, 'OPEN');
    assert.equal(output.arms.baseline.netEquityCents, null);
    assert.equal(output.arms.baseline.metricReasons.netEquityCents,
      'COMMON_HORIZON_MARK_UNAVAILABLE');
    assert.equal(output.deltas.status, 'UNAVAILABLE');
  }
});

test('keeps missing horizon marks and zero-trade outcomes unknown rather than coercing them', () => {
  const missingMark = fixture();
  missingMark.report.commonHorizon.available = false;
  missingMark.report.arms[0].valuation.openPositions = [{quantitySat: 100}];
  missingMark.report.arms[0].valuation.markAgeMs = null;
  missingMark.report.arms[0].valuation.netEquityCents = null;
  missingMark.report.arms[0].valuation.markedEquityCents = null;
  missingMark.report.comparison.status = 'UNAVAILABLE';
  missingMark.journal.events.at(-1).report = structuredClone(missingMark.report);
  const missingOutput = evaluatePairedPaperEvidence(missingMark);
  assert.equal(missingOutput.arms.baseline.netEquityCents, null);
  assert.equal(missingOutput.arms.baseline.metricReasons.netEquityCents,
    'COMMON_HORIZON_MARK_UNAVAILABLE');

  const zeroTrades = fixture();
  for (const reportArm of zeroTrades.report.arms) {
    reportArm.fills = [];
    reportArm.valuation.feesCents = 0;
    reportArm.valuation.slippageCents = 0;
    reportArm.valuation.modeledCostsCents = 0;
    reportArm.valuation.turnoverCents = 0;
  }
  for (const event of zeroTrades.journal.events) {
    if (event.type === 'shared_observation') {
      event.fills = models.map(model => ({role: model.role, fills: []}));
    }
  }
  zeroTrades.report.arms[0].valuation.netEquityCents = 100_000;
  zeroTrades.report.arms[0].valuation.markedEquityCents = 100_000;
  zeroTrades.report.arms[0].valuation.sampledDrawdownCents = 0;
  zeroTrades.report.comparison.arms.baseline.finalNetEquityCents = 100_000;
  zeroTrades.report.comparison.arms.baseline.fillCount = 0;
  zeroTrades.report.comparison.arms.baseline.feesCents = 0;
  zeroTrades.report.comparison.arms.baseline.grossTurnoverCents = 0;
  zeroTrades.journal.events.at(-1).report = structuredClone(zeroTrades.report);
  const zeroOutput = evaluatePairedPaperEvidence(zeroTrades);
  assert.equal(zeroOutput.evidenceStatus, 'VERIFIED_COMPLETE');
  assert.equal(zeroOutput.arms.baseline.fillCount, 0);
  assert.equal(zeroOutput.arms.baseline.netPnlCents, 0);
});

test('checks journal checksums and enforces bounded, regular, read-only input files', async () => {
  const input = fixture();
  const payload = structuredClone(input.journal);
  delete payload.reconciliationStatus;
  const envelope = {
    payload,
    sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    reconciliationStatus: 'READ_ONLY_VERIFIED'
  };
  const checked = evaluatePairedPaperEvidence({
    ...input, journal: envelope
  });

  assert.equal(checked.evidenceStatus, 'VERIFIED_COMPLETE');

  const corrupt = structuredClone(envelope);
  corrupt.sha256 = '0'.repeat(64);
  assert.equal(evaluatePairedPaperEvidence({...input, journal: corrupt}).reasonCode,
    'INVALID_JOURNAL');

  const directory = await mkdtemp(join(tmpdir(), 'spot-paired-report-'));
  try {
    const expectedIdentityPath = join(directory, 'expected.json');
    const exportPath = join(directory, 'host-export.json');
    await writeFile(expectedIdentityPath, JSON.stringify(input.expectedIdentity));
    await writeFile(exportPath, JSON.stringify({
      schemaVersion: 'SPOT_PAPER_PAIRED_HOST_EXPORT_V1',
      runId: input.expectedIdentity.runId,
      status: 'TERMINAL_JOURNAL_VERIFIED',
      verifiedTerminal: true,
      reconciliationStatus: 'READ_ONLY_VERIFIED',
      report: input.report,
      journal: input.journal
    }));
    const cli = spawnSync(process.execPath, [
      'scripts/spot-paper-paired-report/cli.mjs',
      expectedIdentityPath, exportPath
    ], {encoding: 'utf8'});
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).evidenceStatus, 'VERIFIED_COMPLETE');
    const fileOutput = await evaluatePairedPaperFiles({
      expectedIdentityPath, reportPath: exportPath
    });
    assert.equal(fileOutput.evidenceStatus, 'VERIFIED_COMPLETE');

    await truncate(exportPath, SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES + 1);
    await assert.rejects(readBoundedJsonFile(exportPath,
      SPOT_PAPER_PAIRED_MAX_HOST_EXPORT_BYTES), /INPUT_FILE_LIMIT/);
    assert.equal((await evaluatePairedPaperFiles({
      expectedIdentityPath, reportPath: exportPath
    })).reasonCode, 'HOST_EXPORT_FILE_INVALID_OR_OVERSIZED');

    await writeFile(exportPath, '{invalid');
    assert.equal((await evaluatePairedPaperFiles({
      expectedIdentityPath, reportPath: exportPath
    })).reasonCode, 'HOST_EXPORT_FILE_INVALID_OR_OVERSIZED');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('evaluates the canonical combined host export from bounded files via the CLI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spot-paired-host-export-'));
  try {
    const input = fixture();
    const expectedIdentityPath = join(directory, 'expected-identity.json');
    const exportPath = join(directory, 'host-export.json');
    await writeFile(expectedIdentityPath, JSON.stringify(input.expectedIdentity));
    await writeFile(exportPath, JSON.stringify({
      schemaVersion: 'SPOT_PAPER_PAIRED_HOST_EXPORT_V1',
      runId: input.expectedIdentity.runId,
      status: 'TERMINAL_JOURNAL_VERIFIED',
      verifiedTerminal: true,
      reconciliationStatus: 'READ_ONLY_VERIFIED',
      report: input.report,
      journal: input.journal
    }));

    const cli = spawnSync(process.execPath, [
      'scripts/spot-paper-paired-report/cli.mjs',
      expectedIdentityPath, exportPath
    ], {encoding: 'utf8'});
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).evidenceStatus, 'VERIFIED_COMPLETE');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
