import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {main as createDtoFile} from '../scripts/spot-paper-report-bridge/create-dto.mjs';
import {getPaperEvidenceProfile, getSignalReplayProfile} from
  '../scripts/spot-paper-pilot/evidence-profiles.mjs';
import {
  createSpotPaperDashboardDto,
  getAcceptedSpotPaperIdentity,
  SPOT_PAPER_REPORT_REGISTRY,
  isSpotPaperDashboardDto,
  isSpotPaperReportEnvelope,
  SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
  verifySpotPaperDispatchIdentity
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
  const expectedDispatch = {
    repository: 'Achi1984/meridian',
    workflowPath: '.github/workflows/spot-paper-pilot-paper-once.yml',
    ref: 'refs/heads/main',
    workflowSha: 'ddae14f01583196dfc9e9da906dcd03d41d58369',
    workflowRunId: '42395522899',
    workflowRunNumber: 1,
    workflowRunAttempt: 1
  };
  return {readback, provenance, assessment, signalReplay, expectedDispatch};
}

// Synthetic terminal evidence only; not an observation of the authorized worker.
function fourHourFixture(full = false) {
  const evidence = evidenceFixture();
  const identity = getAcceptedSpotPaperIdentity('spot-paper-42404743386-1');
  const report = evidence.readback.report;
  Object.assign(report, {
    runId: identity.runId,
    observations: 240,
    requests: 480,
    endedAt: report.startedAt + (full ? 14_400_000 : 14_342_902),
    stopReason: full ? 'DURATION_LIMIT' : 'CYCLE_LIMIT'
  });
  Object.assign(evidence.expectedDispatch, {
    workflowPath: SPOT_PAPER_REPORT_REGISTRY[identity.runId].workflowPath,
    workflowSha: identity.workflowSha,
    workflowRunId: identity.workflowRunId
  });
  Object.assign(evidence.provenance, evidence.expectedDispatch, {
    runId: identity.runId, profileId: identity.profileId,
    maxDurationMs: identity.maxDurationMs,
    maxCycles: identity.maxCycles, maxRequests: identity.maxRequests
  });
  Object.assign(evidence.readback, {
    runId: identity.runId,
    eventCount: 242,
    events: [
      {id: 'run-start', type: 'start'},
      ...Array.from({length: 240}, (_, index) =>
        ({id: `observation-${index + 1}`, type: 'observation'})),
      {id: 'run-terminal', type: 'terminal', at: report.endedAt, report: structuredClone(report)}
    ]
  });
  Object.assign(evidence.readback.manifest.limits, {
    maxDurationMs: identity.maxDurationMs,
    maxCycles: identity.maxCycles, maxRequests: identity.maxRequests
  });
  Object.assign(evidence.readback.checkpoint, {cycle: 240, stopReason: report.stopReason});
  evidence.readback.checkpoint.counters.requests = report.requests;
  Object.assign(evidence.assessment, {
    runId: identity.runId, profileId: identity.profileId,
    endedAt: report.endedAt, elapsedMs: report.endedAt - report.startedAt,
    observations: 240, acceptedObservations: 240,
    requests: 480, cycleCount: 240, stopReason: report.stopReason,
    durationCoverage: (report.endedAt - report.startedAt) / identity.maxDurationMs,
    signals: report.signals,
    runClassification: full ? 'COMPLETED_FOUR_HOURS' : 'PARTIAL_BOUNDED_RUN',
    durationStatus: full ? 'FULL_REQUESTED_DURATION' : 'PARTIAL_BOUNDED_DURATION'
  });
  evidence.assessment.validationCriteria.fullRequestedDuration = full;
  evidence.signalReplay.profileId = identity.replayProfileId;
  return evidence;
}

const canonical = value => value === null || typeof value !== 'object' ?
  JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` :
    `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

test('two-entry registry is immutable and first-hour canonical DTO digest is stable', () => {
  assert.deepEqual(Object.keys(SPOT_PAPER_REPORT_REGISTRY),
    ['spot-paper-42395522899-1', 'spot-paper-42404743386-1']);
  assert.ok(Object.isFrozen(SPOT_PAPER_REPORT_REGISTRY));
  for (const entry of Object.values(SPOT_PAPER_REPORT_REGISTRY)) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.identity));
    const assessmentProfile = getPaperEvidenceProfile(entry.identity.profileId);
    const replayProfile = getSignalReplayProfile(entry.identity.replayProfileId);
    for (const key of ['maxDurationMs', 'maxCycles', 'maxRequests', 'model', 'pair', 'initialCashCents']) {
      assert.equal(entry.identity[key], assessmentProfile[key]);
      assert.equal(entry.identity[key], replayProfile[key]);
    }
  }
  for (const runId of ['other', 'toString', '__proto__', null, {}, []]) {
    assert.equal(getAcceptedSpotPaperIdentity(runId), null);
  }
  const dto = createSpotPaperDashboardDto(evidenceFixture());
  assert.equal(createHash('sha256').update(canonical(dto)).digest('hex'),
    '32a0c1e0066ae4aae7c64cc645768edb8267a35faa67ccf7a7991b5f7bd64da7');
});

test('exact four-hour synthetic terminal evidence supports partial and full durations', () => {
  for (const full of [false, true]) {
    const evidence = fourHourFixture(full);
    const dto = createSpotPaperDashboardDto(evidence);
    assert.ok(isSpotPaperDashboardDto(dto));
    assert.equal(dto.identity.workflowRunId, '42404743386');
    assert.equal(dto.identity.profileId, 'BTC_EUR_PAPER_4H_V1');
    assert.equal(dto.duration.requestedMs, 14_400_000);
    assert.equal(dto.coverage.requests, 480);
    assert.ok(isSpotPaperReportEnvelope({
      schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA, runId: dto.identity.runId, report: dto
    }));
    assert.equal(isSpotPaperReportEnvelope({
      schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA, runId: 'spot-paper-42395522899-1', report: dto
    }), false);
  }
});

test('both runs preserve assessment-accepted early duration-limit termination', () => {
  for (const make of [evidenceFixture, fourHourFixture]) {
    const evidence = make();
    const report = evidence.readback.report;
    report.stopReason = 'DURATION_LIMIT';
    evidence.readback.checkpoint.stopReason = report.stopReason;
    evidence.readback.events.at(-1).report.stopReason = report.stopReason;
    evidence.assessment.stopReason = report.stopReason;
    const dto = createSpotPaperDashboardDto(evidence);
    assert.ok(isSpotPaperDashboardDto(dto));
    assert.equal(dto.duration.status, 'PARTIAL_BOUNDED_DURATION');
  }
});

test('both identities reject cross-run manifest, readback, assessment, replay and dispatch swaps', () => {
  for (const [make, other] of [[evidenceFixture, fourHourFixture], [fourHourFixture, evidenceFixture]]) {
    for (const key of ['provenance', 'readback', 'assessment', 'signalReplay', 'expectedDispatch']) {
      const evidence = make();
      evidence[key] = other()[key];
      assert.equal(createSpotPaperDashboardDto(evidence), null, key);
    }
    const evidence = make();
    evidence.readback.manifest = other().readback.manifest;
    assert.equal(createSpotPaperDashboardDto(evidence), null);
  }
});

test('both identities fail closed for wrong trusted tuples, profiles, bounds and active evidence', () => {
  const mutations = [
    e => { delete e.expectedDispatch; },
    e => { e.expectedDispatch.repository = 'other/meridian'; },
    e => { e.expectedDispatch.workflowPath = '.github/workflows/other.yml'; },
    e => { e.expectedDispatch.ref = 'refs/heads/other'; },
    e => { e.expectedDispatch.workflowSha = 'a'.repeat(40); },
    e => { e.expectedDispatch.workflowRunId = '42404743387'; },
    e => { e.expectedDispatch.workflowRunNumber = 2; },
    e => { e.expectedDispatch.workflowRunAttempt = 2; },
    e => { e.provenance.acceptedSourceSha = 'a'.repeat(40); },
    e => { e.provenance.workflowRunAttempt = 2; },
    e => { e.provenance.profileId = 'other'; },
    e => { e.provenance.workflowPath = '.github/workflows/other.yml'; },
    e => { e.provenance.ref = 'refs/heads/other'; },
    e => { e.assessment.profileId = 'other'; },
    e => { e.assessment.requests = -1; },
    e => { e.assessment.cycleCount = -1; },
    e => { e.assessment.stopReason = 'UNKNOWN'; },
    e => { e.assessment.signals = []; },
    e => { e.assessment.durationCoverage = 0; },
    e => { e.signalReplay.profileId = 'other'; },
    e => { e.signalReplay.startupCutoff = 'UNKNOWN'; },
    e => { e.readback.reconciliation = 'ACTIVE_NO_TERMINAL_REPORT'; },
    e => { delete e.readback.report; },
    e => { e.readback.events.pop(); },
    e => { e.readback.checkpoint.cycle++; },
    e => { e.readback.manifest.limits.maxDurationMs++; },
    e => { e.readback.report.operationalStatus = 'IN_PROGRESS'; },
    e => { e.readback.report.requests = e.provenance.maxRequests + 1; },
    e => { e.readback.report.observations = e.provenance.maxCycles + 1; },
    e => { e.readback.report.deliveredBytes = e.provenance.maxBytes + 1; },
    e => { e.readback.report.endedAt = e.readback.report.startedAt + e.provenance.maxDurationMs + 5_001; },
    e => { e.assessment.durationStatus = 'FULL_REQUESTED_DURATION'; },
    e => { e.assessment.validationCriteria.fullRequestedDuration = true; }
  ];
  for (const make of [evidenceFixture, fourHourFixture]) {
    for (const mutate of mutations) {
      const evidence = make();
      mutate(evidence);
      assert.equal(createSpotPaperDashboardDto(evidence), null, String(mutate));
    }
  }
  for (const key of ['repository', 'workflowPath', 'ref', 'profileId']) {
    const evidence = fourHourFixture();
    delete evidence.provenance[key];
    assert.equal(createSpotPaperDashboardDto(evidence), null, key);
  }
});

test('DTO validation independently rejects mixed identity, budget and duration fields', () => {
  for (const make of [evidenceFixture, fourHourFixture]) {
    const report = createSpotPaperDashboardDto(make());
    for (const mutate of [
      d => { d.identity.workflowRunAttempt = 2; },
      d => { d.identity.sourceSha = 'a'.repeat(40); },
      d => { d.identity.profileId = 'other'; },
      d => { d.duration.requestedMs++; },
      d => { d.duration.elapsedMs = d.duration.requestedMs + 5_001; },
      d => { d.coverage.requests++; },
      d => { d.coverage.observations++; },
      d => { d.coverage.acceptedObservations = 0; },
      d => { d.snapshot.status = 'IN_PROGRESS'; }
    ]) {
      const dto = structuredClone(report);
      mutate(dto);
      assert.equal(isSpotPaperDashboardDto(dto), false, String(mutate));
    }
  }
});

test('consistent terminal evidence still rejects counter, byte and duration budget violations', () => {
  for (const make of [evidenceFixture, fourHourFixture]) {
    for (const mutate of [
      (r, p) => { r.requests = p.maxRequests + 1; },
      (r, p) => { r.deliveredBytes = p.maxBytes + 1; },
      r => { r.deliveredBytes = -1; },
      (r, p) => { r.endedAt = r.startedAt + p.maxDurationMs + 5_001; },
      (r, p) => { r.observations = p.maxCycles + 1; }
    ]) {
      const evidence = make();
      const {readback, assessment, provenance} = evidence;
      const report = readback.report;
      mutate(report, provenance);
      readback.events = [
        {id: 'run-start', type: 'start'},
        ...Array.from({length: report.observations}, (_, index) =>
          ({id: `observation-${index + 1}`, type: 'observation'})),
        {id: 'run-terminal', type: 'terminal', at: report.endedAt, report: structuredClone(report)}
      ];
      readback.eventCount = readback.events.length;
      readback.checkpoint.cycle = report.observations;
      Object.assign(readback.checkpoint.counters, {
        requests: report.requests, bytes: report.deliveredBytes
      });
      const full = report.endedAt - report.startedAt >= provenance.maxDurationMs;
      Object.assign(assessment, {
        requests: report.requests, deliveredBytes: report.deliveredBytes,
        observations: report.observations, acceptedObservations: report.observations,
        cycleCount: report.observations, endedAt: report.endedAt,
        elapsedMs: report.endedAt - report.startedAt,
        durationCoverage: (report.endedAt - report.startedAt) / provenance.maxDurationMs,
        durationStatus: full ? 'FULL_REQUESTED_DURATION' : 'PARTIAL_BOUNDED_DURATION'
      });
      assessment.validationCriteria.fullRequestedDuration = full;
      assert.equal(createSpotPaperDashboardDto(evidence), null, String(mutate));
    }
  }
});

test('offline DTO creator requires trusted dispatch, writes private files, and never overwrites', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'spot-paper-dto-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const make of [evidenceFixture, fourHourFixture]) {
    const evidence = make();
    const paths = await Promise.all(
      ['readback', 'provenance', 'assessment', 'signalReplay', 'expectedDispatch'].map(async key => {
        const path = join(directory, `${key}.json`);
        await writeFile(path, JSON.stringify(evidence[key]));
        return path;
      }));
    const output = join(directory, `${evidence.provenance.runId}.json`);
    await createDtoFile([...paths, output]);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), createSpotPaperDashboardDto(evidence));
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    await assert.rejects(createDtoFile([...paths, output]), {code: 'EEXIST'});
    await writeFile(paths[4], 'null');
    await assert.rejects(createDtoFile([...paths, join(directory, 'rejected.json')]), /rejected/);
  }
});

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

  const missingDispatch = evidenceFixture();
  delete missingDispatch.expectedDispatch;
  assert.equal(createSpotPaperDashboardDto(missingDispatch), null);

  const untrustedDispatch = evidenceFixture();
  untrustedDispatch.expectedDispatch.workflowRunId = '42404743386';
  assert.equal(createSpotPaperDashboardDto(untrustedDispatch), null);
});

test('spot-paper dispatch verification requires independent accepted Actions identity', () => {
  const evidence = evidenceFixture();
  assert.equal(verifySpotPaperDispatchIdentity(
    evidence.expectedDispatch, evidence.provenance), 'PASS');
  assert.equal(verifySpotPaperDispatchIdentity(null, evidence.provenance), 'UNKNOWN');
  assert.equal(verifySpotPaperDispatchIdentity({
    ...evidence.expectedDispatch, workflowPath: '.github/workflows/spot-paper-pilot-four-hour-once.yml'
  }, evidence.provenance), 'FAILED');
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
