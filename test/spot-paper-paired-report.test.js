import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  evaluatePairedPaperEvidence,
  evaluatePairedPaperFiles,
  readBoundedJsonFile,
  SPOT_PAPER_PAIRED_MAX_JOURNAL_BYTES
} from '../scripts/spot-paper-paired-report/evaluate.mjs';
import {
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
        {side: 'BUY', grossCents: 10_000, feeCents: 50},
        {side: 'SELL', grossCents: 10_000, feeCents: 50}
      ],
      equity: 99_900, fees: 100, slippage: 20, turnover: 20_000,
      drawdown: 200, stoppedAt: 50_000, stopReason: 'SESSION_LOSS_LIMIT'
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
    endedAt: 61_000,
    elapsedMs: 60_000,
    wallClockElapsedMs: 60_000,
    failureReason: null,
    fullEightHourCompletion: false,
    coverage: 'PARTIAL',
    cycles: 2,
    requests: 4,
    deliveredBytes: 1_000,
    commonHorizon: {available: true, quoteReceivedAt: 59_999, effectAt: 60_000},
    assumptions: {feeBpsPerSide: 50, slippageBpsPerSide: 10, ratesVerified: false},
    arms: reportArms,
    comparison: {
      schemaVersion: 'SPOT_PAPER_SMA_COMPARISON_V1',
      status: 'COMPARISON_AVAILABLE',
      commonHorizonAt: 60_000,
      arms: {
        baseline: {
          strategyId: models[0].modelId, valuationAt: 60_000,
          finalNetEquityCents: 99_900, fillCount: 2, feesCents: 100,
          grossTurnoverCents: 20_000
        },
        challenger: {
          strategyId: models[1].modelId, valuationAt: 60_000,
          finalNetEquityCents: 99_500, fillCount: 0, feesCents: 0,
          grossTurnoverCents: 0
        },
        cash: {
          strategyId: 'CASH_NO_TRADE', valuationAt: 60_000,
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
    limits: {maxCycles: 480, maxRequests: 960, maxDurationMs: 28_800_000}
  };
  const events = [
    {id: 'paired-start', type: 'start', at: report.startedAt},
    {id: 'shared:1', type: 'shared_observation'},
    {id: 'shared:2', type: 'shared_observation'},
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
  assert.equal(output.arms.baseline.cashCents, null);
  assert.equal(output.arms.challenger.fillCount, 0);
  assert.equal(output.arms.challenger.netPnlCents, -500);
  assert.equal(output.arms.cash.cashCents, 100_000);
  assert.equal(output.deltas.challengerMinusBaseline.netPnlCents, -400);
  assert.equal(output.deltas.challengerMinusCash.netPnlCents, -500);
  assert.equal(output.timing.requestedDurationMs, 28_800_000);
  assert.equal(output.timing.observedCoverageMs, 59_000);
  assert.equal(output.timing.runStoppedAt, 61_000);
  assert.equal(output.timing.valuationAt, 60_000);
  assert.equal(output.arms.baseline.tradingStoppedAt, 50_000);
  assert.equal(output.decision, 'NO_WINNER_OR_PROMOTION');
  assert.deepEqual(Object.keys(output), [
    'schemaVersion', 'evidenceStatus', 'evidenceQualification', 'reasonCode',
    'syntheticFixture', 'independentAuthentication', 'identity', 'timing',
    'assumptions', 'arms', 'deltas', 'decision'
  ]);
  assert.equal(JSON.stringify(output).includes('accountId'), false);
  assert.equal(JSON.stringify(output).includes('failureReason'), false);
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
  assert.equal(output.arms.baseline.tradingStoppedAt, 50_000);
  assert.equal(output.timing.valuationAt, 60_000);
});

test('labels a reported running snapshot as provisional and not final evidence', () => {
  const input = fixture();
  input.report = null;
  input.journal.snapshotStatus = 'RUNNING_SNAPSHOT';
  input.journal.events.pop();
  input.journal.sequence = input.journal.events.length;
  const output = evaluatePairedPaperEvidence(input);
  assert.equal(output.evidenceStatus, 'RUNNING_SNAPSHOT');
  assert.equal(output.reasonCode, 'TERMINAL_REPORT_NOT_YET_AVAILABLE');
  assert.equal(output.arms.baseline.netEquityCents, null);
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
  missingMark.report.commonHorizon.effectAt = null;
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
    const reportPath = join(directory, 'report.json');
    const journalPath = join(directory, 'journal.json');
    await writeFile(expectedIdentityPath, JSON.stringify(input.expectedIdentity));
    await writeFile(reportPath, JSON.stringify(input.report));
    await writeFile(journalPath, JSON.stringify(input.journal));
    const fileOutput = await evaluatePairedPaperFiles({
      expectedIdentityPath, reportPath, journalPath
    });
    assert.equal(fileOutput.evidenceStatus, 'VERIFIED_COMPLETE');

    await writeFile(journalPath, 'x'.repeat(SPOT_PAPER_PAIRED_MAX_JOURNAL_BYTES + 1));
    await assert.rejects(readBoundedJsonFile(journalPath,
      SPOT_PAPER_PAIRED_MAX_JOURNAL_BYTES), /INPUT_FILE_LIMIT/);
    assert.equal((await evaluatePairedPaperFiles({
      expectedIdentityPath, reportPath, journalPath
    })).reasonCode, 'JOURNAL_FILE_INVALID_OR_OVERSIZED');

    await writeFile(reportPath, '{invalid');
    assert.equal((await evaluatePairedPaperFiles({
      expectedIdentityPath, reportPath, journalPath
    })).reasonCode, 'REPORT_FILE_INVALID_OR_OVERSIZED');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
