import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  createSpotPaperDashboardDto,
  isSpotPaperDashboardDto,
  isSpotPaperReportEnvelope,
  SPOT_PAPER_REPORT_ENVELOPE_SCHEMA
} from '../scripts/spot-paper-report-bridge/contract.mjs';

const reportFixture = () => ({
  schemaVersion: 'SPOT_PAPER_PILOT_REPORT_V1',
  runId: 'spot-paper-42395522899-1',
  model: 'BTC_EUR_SMA5_SMA20_V1',
  mode: 'paper',
  pair: 'BTC/EUR',
  operationalStatus: 'COMPLETED_BOUNDED',
  profitability: 'NOT_ASSESSED',
  executionImpact: false,
  liveTrading: false,
  autoPromotion: false,
  startedAt: 1794071825679,
  endedAt: 1794075368581,
  stopReason: 'CYCLE_LIMIT',
  observations: 60,
  dataGaps: 0,
  requests: 120,
  deliveredBytes: 1200,
  signals: Array.from({length: 8}, (_, index) => ({id: `signal-${index + 1}`})),
  fills: [{side: 'BUY'}, {side: 'SELL'}],
  feesCents: 350,
  cashCents: 89643,
  equityCents: 99525,
  realizedPnlCents: -357,
  unrealizedPnlCents: -118,
  positionStatus: 'OPEN_UNRESOLVED_AT_TERMINAL',
  position: {quantitySat: 146122}
});

function evidenceFixture() {
  const report = reportFixture();
  const readback = {
    reconciliation: 'TERMINAL_REPORT_AVAILABLE',
    runId: report.runId,
    eventCount: 62,
    resumed: false,
    executionImpact: false,
    manifest: {
      schemaVersion: 'SPOT_PAPER_PILOT_MANIFEST_V1',
      model: report.model,
      mode: report.mode,
      pair: report.pair,
      startedAt: report.startedAt,
      limits: {
        maxCycles: 60, maxRequests: 120, maxDurationMs: 3_600_000, pollIntervalMs: 60_000,
        requestTimeoutMs: 5_000, maxBytes: 67_108_864, maxResponseBytes: 262_144
      }
    },
    checkpoint: {
      cycle: 60, stopReason: 'CYCLE_LIMIT',
      counters: {requests: report.requests, bytes: report.deliveredBytes}
    },
    events: [
      {id: 'run-start', type: 'start'},
      ...Array.from({length: 60}, (_, index) => ({id: `observation-${index + 1}`, type: 'observation'})),
      {id: 'run-terminal', type: 'terminal', at: report.endedAt, report: structuredClone(report)}
    ],
    report
  };
  const provenance = {
    schemaVersion: 'SPOT_PAPER_PILOT_DISPATCH_MANIFEST_V1',
    acceptedSourceSha: '81edf0b5dc3d455c2c1e1906791d56c731bea0c9',
    workflowSha: 'ddae14f01583196dfc9e9da906dcd03d41d58369',
    workflowRunId: '42395522899',
    workflowRunNumber: 1,
    workflowRunAttempt: 1,
    runId: report.runId,
    model: report.model,
    mode: report.mode,
    pair: report.pair,
    initialCashCents: 100_000,
    maxDurationMs: 3_600_000,
    maxCycles: 60,
    maxRequests: 120,
    pollIntervalMs: 60_000,
    warmupCandles: 21,
    maxBytes: 67_108_864,
    maxResponseBytes: 262_144,
    requestTimeoutMs: 5_000,
    maxOpenPositions: 1,
    maxQuoteAgeMs: 10_000,
    maxCandleAgeMs: 120_000,
    maxExposureCents: 10_000,
    maxSessionLossCents: 2_000,
    stopLossBps: 200,
    maxEntrySpreadBps: 50,
    feeBpsPerSide: 50,
    slippageBpsPerSide: 10,
    smaFast: 5,
    smaSlow: 20
  };
  const assessment = {
    outcome: 'COMPLETED',
    profileId: 'BTC_EUR_PAPER_1H_V1',
    runClassification: 'PARTIAL_BOUNDED_RUN',
    dispatchIdentity: 'PASS',
    terminalVerified: true,
    boundedTermination: true,
    executionImpact: false,
    dataAcceptance: 'DATA_ACCEPTED',
    quoteAccountingReconciled: true,
    profitability: 'NOT_ASSESSED',
    signalReplay: 'NOT_PERFORMED',
    runId: report.runId,
    sourceSha: provenance.acceptedSourceSha,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    elapsedMs: report.endedAt - report.startedAt,
    durationStatus: 'PARTIAL_BOUNDED_DURATION',
    acceptedObservations: 60,
    observations: report.observations,
    dataGaps: report.dataGaps,
    deliveredBytes: report.deliveredBytes,
    feesCents: report.feesCents,
    cashCents: report.cashCents,
    equityCents: report.equityCents,
    realizedPnlCents: report.realizedPnlCents,
    unrealizedPnlCents: report.unrealizedPnlCents,
    fills: report.fills,
    position: report.position,
    validationCriteria: {
      pinnedSourceAndFreshRun: true,
      requestedModeAndBounds: true,
      retainedEvidenceAndAccounting: true,
      acceptedPublicObservations: true,
      fullRequestedDuration: false,
      strategyPerformance: 'NOT_ASSESSED'
    }
  };
  const signalReplay = {
    profileId: 'BTC_EUR_RUN_42395522899_V1',
    outcome: 'PASS',
    identity: 'PASS',
    signalReplay: 'PASS',
    fillCausality: 'PASS',
    startupCutoff: 'PASS',
    replayedSignals: 8,
    discrepancies: []
  };
  return {readback, provenance, assessment, signalReplay};
}

test('spot-paper DTO binds terminal report, assessment, replay, and accepted dispatch identity', () => {
  const dto = createSpotPaperDashboardDto(evidenceFixture());
  assert.ok(isSpotPaperDashboardDto(dto));
  assert.equal(dto.identity.runId, 'spot-paper-42395522899-1');
  assert.equal(dto.acceptedDispatchContext.status, 'PASS');
  assert.equal(dto.snapshot.completedAt, new Date(1794075368581).toISOString());
  assert.equal(dto.startingBalanceCents, '100000');
  assert.equal(dto.cashCents, '89643');
  assert.equal(dto.realizedPnlCents, '-357');
  assert.equal(dto.buyCount, 1);
  assert.equal(dto.sellCount, 1);
  assert.deepEqual(dto.openInventory, {
    status: 'OPEN_UNRESOLVED_AT_TERMINAL',
    quantitySat: '146122'
  });
  assert.equal(dto.duration.elapsedMs, 3_542_902);
  assert.equal(dto.coverage.dataGaps, 0);
  assert.equal(dto.verification.assessmentSignalReplay, 'NOT_PERFORMED');
  assert.equal(dto.verification.signalReplay, 'PASS');
});

test('spot-paper DTO rejects unaccepted source/workflow identity and mismatched terminal readback', () => {
  const identityMismatch = evidenceFixture();
  identityMismatch.provenance.workflowSha = 'a'.repeat(40);
  assert.equal(createSpotPaperDashboardDto(identityMismatch), null);

  const readbackMismatch = evidenceFixture();
  readbackMismatch.readback.events.at(-1).report.cashCents++;
  assert.equal(createSpotPaperDashboardDto(readbackMismatch), null);

  const assessmentMismatch = evidenceFixture();
  assessmentMismatch.assessment.dispatchIdentity = 'UNKNOWN';
  assert.equal(createSpotPaperDashboardDto(assessmentMismatch), null);

  const replayMismatch = evidenceFixture();
  replayMismatch.signalReplay.outcome = 'UNKNOWN';
  assert.equal(createSpotPaperDashboardDto(replayMismatch), null);
});

test('spot-paper DTO preserves missing amounts as unavailable and rejects malformed cents', () => {
  const evidence = evidenceFixture();
  evidence.readback.report.cashCents = null;
  evidence.readback.events.at(-1).report.cashCents = null;
  evidence.assessment.cashCents = null;
  const dto = createSpotPaperDashboardDto(evidence);
  assert.equal(dto.cashCents, null);
  assert.ok(isSpotPaperDashboardDto(dto));

  const malformed = structuredClone(dto);
  malformed.cashCents = '0.00';
  assert.equal(isSpotPaperDashboardDto(malformed), false);
});

test('spot-paper report envelope has a separate fixed versioned contract', () => {
  const report = createSpotPaperDashboardDto(evidenceFixture());
  assert.ok(isSpotPaperReportEnvelope({
    schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
    runId: report.identity.runId,
    report
  }));
  assert.equal(isSpotPaperReportEnvelope({
    schema: 'MEMECOIN_PAPER_REPORT_BRIDGE_ENVELOPE_V1',
    runId: report.identity.runId,
    report
  }), false);
});
