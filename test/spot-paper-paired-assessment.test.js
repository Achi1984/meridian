import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {
  createSpotPaperPairedAssessmentSummary,
  formatSpotPaperPairedAssessment
} from '../scripts/spot-paper-paired-assessment/format.mjs';
import {
  syntheticExpectedPairedIdentity,
  syntheticPairedDashboard
} from './helpers/spot-paper-paired-dashboard-fixture.mjs';

function assessmentInput({
  status = 'VERIFIED_COMPLETE',
  modelPair = false,
  reasonCode = 'SYNTHETIC_TEST_ONLY'
} = {}) {
  const input = syntheticPairedDashboard(
    syntheticExpectedPairedIdentity({modelPair})
  );
  input.evidenceStatus = status;
  input.reasonCode = reasonCode;
  input.timing = {
    ...input.timing,
    actualElapsedMs: 28_800_000,
    observedCoverageMs: 28_800_000,
    attemptedCycles: 480,
    completedCycles: 480,
    stopReason: 'CYCLE_LIMIT',
    commonHorizonAvailable: false,
    commonHorizonReason: 'COMMON_HORIZON_UNAVAILABLE',
    quoteAgeAtValuationMs: null,
    terminalQuoteAgeMs: null,
    quoteFreshAtShutdown: false
  };
  input.deltas = {
    status: 'UNAVAILABLE',
    reason: 'COMMON_HORIZON_UNAVAILABLE',
    challengerMinusBaseline: {
      status: 'UNAVAILABLE',
      reason: 'COMMON_HORIZON_UNAVAILABLE',
      netEquityCents: null,
      netPnlCents: null
    },
    baselineMinusCash: {
      status: 'UNAVAILABLE',
      reason: 'COMMON_HORIZON_UNAVAILABLE',
      netEquityCents: null,
      netPnlCents: null
    },
    challengerMinusCash: {
      status: 'UNAVAILABLE',
      reason: 'COMMON_HORIZON_UNAVAILABLE',
      netEquityCents: null,
      netPnlCents: null
    }
  };
  Object.assign(input.arms.baseline, {
    netPnlCents: 1_234,
    bookedFeesCents: 100,
    modeledSlippageCents: 20,
    sampledDrawdownCents: 300,
    relativeDrawdownBps: 30,
    fillCount: 2,
    exposureCents: 5_000,
    inventoryStatus: 'FLAT'
  });
  Object.assign(input.arms.challenger, {
    netPnlCents: -250,
    bookedFeesCents: 0,
    modeledSlippageCents: 0,
    sampledDrawdownCents: 250,
    relativeDrawdownBps: null,
    fillCount: 0,
    exposureCents: 0,
    inventoryStatus: 'FLAT'
  });
  if (modelPair) input.arms.challenger.fillCount = 2;
  Object.assign(input.arms.cash, {
    netPnlCents: 0,
    bookedFeesCents: null,
    modeledSlippageCents: null,
    sampledDrawdownCents: null,
    fillCount: 0,
    exposureCents: null,
    inventoryStatus: 'UNKNOWN'
  });
  input.arms.cash.metricReasons = {
    bookedFeesCents: 'NOT_REPORTED',
    modeledSlippageCents: 'NOT_REPORTED',
    sampledDrawdownCents: 'NOT_REPORTED',
    exposureCents: 'NOT_REPORTED'
  };
  if (modelPair) {
    input.trendActivityDiagnostic = {
      schemaVersion: 'BTC_EUR_5M_TREND_ACTIVITY_DIAGNOSTIC_V1',
      status: 'PARTIAL_COVERAGE',
      completedRoundTripCount: 1,
      requiredCompletedRoundTrips: 5,
      observedCoverageMs: 28_800_000,
      requiredCoverageMs: 86_400_000,
      completeWindow: false,
      forcedTrades: false,
      deadlineExtensionAllowed: false,
      profitability: 'NOT_ASSESSED'
    };
  }
  return input;
}

test('formats sanitized metrics in German without deriving roundtrips or abstention reasons', () => {
  const output = formatSpotPaperPairedAssessment(assessmentInput());
  assert.match(output, /12,34 EUR/);
  assert.match(output, /−2,50 EUR/);
  assert.match(output, /\| cash \| 0,00 EUR/);
  assert.match(output, /1,00 EUR/);
  assert.match(output, /0,20 EUR/);
  assert.match(output, /30 bp/);
  assert.match(output, /unbekannt \(NOT_REPORTED_BY_REPORT_SCHEMA\)/);
  assert.match(output, /Fills sind keine Roundtrips/);
  assert.match(output, /synthetisch: ja/);
  assert.match(output, /Gebühren oder Slippage werden nicht erneut abgezogen/);
  assert.match(output, /COMMON_HORIZON_UNAVAILABLE/);
  assert.doesNotMatch(output, /Gewinner:|profitabel|handelt nicht, weil/i);
});

test('JSON preserves unknown metrics and exposes diagnostic roundtrips separately', () => {
  const input = assessmentInput({modelPair: true});
  const summary = createSpotPaperPairedAssessmentSummary(input);
  assert.equal(summary.evidence.status, 'VERIFIED_COMPLETE');
  assert.equal(summary.activityDiagnostic.completedRoundTripCount, 1);
  assert.deepEqual(summary.arms.challenger.roundTripCount, {
    value: null,
    reason: 'NOT_REPORTED_BY_REPORT_SCHEMA'
  });
  assert.equal(summary.arms.challenger.fillCount.value, 2);
  assert.equal(summary.arms.baseline.relativeDrawdownBps.value, 30);
  assert.equal(summary.arms.cash.sampledDrawdownCents.value, null);
  assert.equal(summary.arms.cash.sampledDrawdownCents.reason, 'NOT_REPORTED');
  assert.equal(summary.arms.challenger.netPnlCents.value, -250);
  assert.equal(summary.comparison.status, 'UNAVAILABLE');
  assert.equal(summary.comparison.decision, 'NO_WINNER_OR_PROMOTION');
  assert.match(formatSpotPaperPairedAssessment(input, 'json'), /"completedRoundTripCount": 1/);
});

test('preserves interrupted and corrupt identity evidence without converting it into a result', () => {
  const interrupted = assessmentInput({status: 'INTERRUPTED'});
  const summary = createSpotPaperPairedAssessmentSummary(interrupted);
  assert.equal(summary.evidence.status, 'INTERRUPTED');
  assert.equal(summary.timing.stopReason, 'CYCLE_LIMIT');

  const corrupt = assessmentInput({
    status: 'CORRUPT_UNKNOWN',
    reasonCode: 'IDENTITY_MISMATCH'
  });
  assert.equal(createSpotPaperPairedAssessmentSummary(corrupt).evidence.reasonCode,
    'IDENTITY_MISMATCH');
});

test('rejects malformed DTOs, invalid metrics, and unsupported output formats', () => {
  assert.throws(() => createSpotPaperPairedAssessmentSummary({}), {
    message: 'PAIRED_DASHBOARD_INVALID'
  });
  const invalidMetric = assessmentInput();
  invalidMetric.arms.baseline.fillCount = -1;
  assert.throws(() => formatSpotPaperPairedAssessment(invalidMetric), {
    message: 'PAIRED_DASHBOARD_INVALID'
  });
  assert.throws(() => formatSpotPaperPairedAssessment(assessmentInput(), 'html'), {
    message: 'ASSESSMENT_FORMAT_INVALID'
  });
});

test('offline CLI reads one bounded sanitized file and writes only the assessment to stdout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paired-assessment-'));
  const inputPath = join(directory, 'dashboard.json');
  try {
    await writeFile(inputPath, JSON.stringify(assessmentInput()));
    const result = spawnSync(process.execPath, [
      resolve('scripts/spot-paper-paired-assessment/cli.mjs'),
      '--format', 'json', inputPath
    ], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).evidence.syntheticFixture, true);
    assert.deepEqual(await readdir(directory), ['dashboard.json']);

    const malformedPath = join(directory, 'malformed.json');
    await writeFile(malformedPath, '{"sensitive":"not echoed"');
    const malformed = spawnSync(process.execPath, [
      resolve('scripts/spot-paper-paired-assessment/cli.mjs'), malformedPath
    ], {encoding: 'utf8'});
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, '');
    assert.equal(malformed.stderr, 'INPUT_INVALID_OR_OVERSIZED\n');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
