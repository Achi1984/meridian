import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  acceptsTarget, buildSchedule, calculateDrawdown, canonicalJson, createBudgetTracker,
  createExecution, deriveControlExposures, deriveFeatures, runBatch, sha256
} from '../scripts/research/b1-7/engine.mjs';
import {
  ASSETS, BUDGET, IMPLEMENTATION_ID, INPUT, PROTOCOL_ID, PROTOCOL_SHA256, SCENARIOS,
  SEGMENTS, VARIANTS, validateSeries, validateSourceIdentity
} from '../scripts/research/b1-7/validate.mjs';
import {
  createSyntheticSeries, createZeroVolatilityVariantSeries
} from './fixtures/b1-7/synthetic-series.mjs';

const protocolPath = new URL('../research/protocols/b1-7-20261018/protocol.json', import.meta.url);
const requestPath = new URL('../research/protocols/b1-7-20261018/EXECUTION_REQUEST.md', import.meta.url);
const enginePath = new URL('../scripts/research/b1-7/engine.mjs', import.meta.url);
const validatorPath = new URL('../scripts/research/b1-7/validate.mjs', import.meta.url);
const capturedInputPath = new URL('../scripts/research/b1-7/captured-input.mjs', import.meta.url);
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const implementationSha256 = sha256(canonicalJson({
  capturedInputSha256: hashFile(capturedInputPath),
  engineSha256: hashFile(enginePath),
  validatorSha256: hashFile(validatorPath)
}));
const syntheticSource = {kind: 'SYNTHETIC_FIXTURE'};

function makeRun(seriesByAsset = createSyntheticSeries(), syntheticClock) {
  const options = {seriesByAsset, source: syntheticSource, implementationSha256};
  if (syntheticClock) options.syntheticClock = syntheticClock;
  return runBatch(options);
}

function getPath(output, variantId, scenarioId, segmentId) {
  return output.paths.find(path => path.variantId === variantId &&
    path.scenarioId === scenarioId && path.segmentId === segmentId);
}

test('protocol constants, exact universe, costs, path count, and raw freeze hash agree', () => {
  assert.equal(protocol.schema, 'MERIDIAN_B1_7_PROTOCOL_R3');
  assert.equal(protocol.protocolId, PROTOCOL_ID);
  assert.equal(protocol.independentReview.r3Response, 'PENDING_INDEPENDENT_REVIEW');
  assert.equal(protocol.independentReview.r3ScopeUpdateComment, '6249518640');
  assert.equal(protocol.independentReview.r3CorrectionComment, '6250026939');
  assert.equal(protocol.independentReview.r2Response, 'GREEN_LIGHT_DESIGN_ONLY');
  assert.equal(protocol.budget.hardPreemption, false);
  assert.match(protocol.costAssumptions.base, /10bp spot taker reference plus 5bp assumed friction/);
  assert.match(protocol.costAssumptions.status, /NOT OKX execution evidence/);
  assert.equal(hashFile(protocolPath), PROTOCOL_SHA256);
  assert.equal(protocol.independentReview.r2ResponseComment, '6249482850');
  assert.equal(protocol.independentReview.r2Response, 'GREEN_LIGHT_DESIGN_ONLY');
  assert.deepEqual(protocol.universe.assets, ASSETS);
  assert.deepEqual(protocol.variants, VARIANTS);
  assert.deepEqual(protocol.scenarios, SCENARIOS.map(({id, costRate, delayDays}) => ({
    id, costRate, delayDays, perSideCostBp: costRate * 10000
  })));
  assert.deepEqual(SCENARIOS, [
    {id: 'base-15bp', costRate: 0.0015, delayDays: 0},
    {id: 'stress-30bp', costRate: 0.003, delayDays: 0},
    {id: 'stress-30bp-delay-1d', costRate: 0.003, delayDays: 1}
  ]);
  assert.equal(BUDGET.paths, 44);
  assert.equal(protocol.pathManifest.pathCount, 44);
  assert.equal(protocol.calendar.warmup.rows + protocol.calendar.development.rows +
    protocol.calendar.diagnostic.rows, INPUT.rowCount);
  assert.deepEqual(protocol.authority, {
    preparationOnly: true,
    executionAuthorized: false,
    strategyPnlAuthorized: false,
    discoveryAuthorized: false,
    validationAuthorized: false,
    holdoutAuthorized: false,
    paperAuthorized: false,
    liveAuthorized: false,
    ownerRealRunDecision: 'PENDING'
  });
});

test('synthetic 45-day feature begins on exactly the 410th close', () => {
  const fixture = createSyntheticSeries();
  assert.equal(validateSeries(fixture).ok, true);
  const features = deriveFeatures(fixture, VARIANTS[2]);
  assert.equal(features.findIndex(Boolean), 409);
  assert.equal(features[408], null);
  assert.equal(features[409].rawExposure >= 0.25 && features[409].rawExposure <= 1, true);
  for (const variant of VARIANTS) {
    assert.equal(deriveFeatures(fixture, variant).findIndex(Boolean), variant.window + 364);
  }
});

test('future close perturbations leave earlier synthetic decisions and fills unchanged', () => {
  const original = createSyntheticSeries();
  const changed = createSyntheticSeries();
  const asset = ASSETS[0];
  const changedRow = changed[asset][700];
  changedRow.close *= 1.25;
  changedRow.high = Math.max(changedRow.open, changedRow.close) * 1.004;
  changedRow.low = Math.min(changedRow.open, changedRow.close) * 0.996;

  const originalFeatures = deriveFeatures(original, VARIANTS[0]);
  const changedFeatures = deriveFeatures(changed, VARIANTS[0]);
  for (let index = 0; index < 700; index++) {
    assert.deepEqual(changedFeatures[index], originalFeatures[index]);
  }
  const segment = SEGMENTS.diagnostic;
  const originalSchedule = buildSchedule(original[asset], originalFeatures, segment);
  const changedSchedule = buildSchedule(changed[asset], changedFeatures, segment);
  const beforePerturbation = schedule => ({
    decisions: schedule.decisions.filter(item => item.decisionIndex < 700),
    fills: schedule.fills.filter(item => item.fillIndex <= 700)
  });
  assert.deepEqual(beforePerturbation(changedSchedule), beforePerturbation(originalSchedule));
});

test('binary64 band comparison uses exact >= 0.10 without epsilon', () => {
  assert.equal(0.300001 - 0.200001, 0.10);
  assert.equal(acceptsTarget(0.300001, 0.200001), true);
  assert.equal(acceptsTarget(0.35, 0.25), false);
  assert.equal(acceptsTarget(0.3500000000000001, 0.25), true);
  assert.equal(acceptsTarget(0.15, 0.25), true);
});

test('sampled drawdown includes starting equity and resets duration on a recovered peak', () => {
  const result = calculateDrawdown([9000, 9500, 10000, 9800, 11000]);
  assert.equal(Math.abs(result.sampledDrawdown - 0.1) < 1e-15, true);
  assert.equal(result.maxDrawdownDuration, 2);
});

test('delayed schedule preserves immutable decisions and defers first fill one day', () => {
  const fixture = createSyntheticSeries();
  const features = deriveFeatures(fixture, VARIANTS[0]);
  const regular = buildSchedule(fixture.XBTUSD, features, SEGMENTS.development, 0);
  const delayed = buildSchedule(fixture.XBTUSD, features, SEGMENTS.development, 1);
  assert.equal(regular.decisions.length, delayed.decisions.length);
  assert.deepEqual(
    delayed.decisions.map(({decisionIndex, rawExposure, acceptedExposure, accepted, target}) =>
      ({decisionIndex, rawExposure, acceptedExposure, accepted, target})),
    regular.decisions.map(({decisionIndex, rawExposure, acceptedExposure, accepted, target}) =>
      ({decisionIndex, rawExposure, acceptedExposure, accepted, target}))
  );
  assert.equal(regular.fills[0].fillIndex, SEGMENTS.development.startIndex);
  assert.equal(delayed.fills[0].fillIndex, SEGMENTS.development.startIndex + 1);

  const sunday = fixture.XBTUSD.findIndex((row, index) =>
    index >= SEGMENTS.development.startIndex && index <= SEGMENTS.development.endIndex &&
    new Date(row.timestamp).getUTCDay() === 0);
  const truncated = {...SEGMENTS.development, endIndex: sunday, rows: sunday - SEGMENTS.development.startIndex + 1};
  const mondayCancellation = buildSchedule(fixture.XBTUSD, features, truncated, 0);
  assert.equal(mondayCancellation.cancelled.some(fill =>
    fill.decisionIndex === sunday && fill.fillIndex === sunday + 1), true);
  const horizonSchedule = buildSchedule(fixture.XBTUSD, features, truncated, 1);
  assert.equal(horizonSchedule.cancelled.some(fill => fill.decisionIndex === sunday), true);
  assert.equal(horizonSchedule.fills.every(fill => fill.fillIndex <= sunday), true);

  const decisionFeatures = new Array(INPUT.rowCount).fill(null);
  decisionFeatures[SEGMENTS.development.startIndex - 1] = {rawExposure: 0.25};
  const sundays = [];
  for (let index = SEGMENTS.development.startIndex; index <= SEGMENTS.development.endIndex; index++) {
    if (new Date(fixture.XBTUSD[index].timestamp).getUTCDay() === 0) {
      sundays.push(index);
      decisionFeatures[index] = {rawExposure: 0.25};
    }
  }
  decisionFeatures[sundays[0]] = {rawExposure: 0.4};
  const frozenDecision = buildSchedule(fixture.XBTUSD, decisionFeatures, SEGMENTS.development, 1);
  const sundayDecision = frozenDecision.decisions.find(item => item.decisionIndex === sundays[0]);
  const delayedInstruction = frozenDecision.fills.find(item => item.decisionIndex === sundays[0]);
  assert.equal(sundayDecision.acceptedExposure, 0.4);
  assert.equal(delayedInstruction.target, 0.4);
  assert.equal(delayedInstruction.fillIndex, sundays[0] + 2);
});

test('full synthetic batch has 44 deterministic paths and complete accounting', () => {
  const first = makeRun();
  const second = makeRun();
  assert.equal(first.status, 'COMPLETED');
  assert.equal(first.completedPaths, 44);
  assert.equal(first.attemptedPaths, 44);
  assert.equal(first.computedPaths, 44);
  assert.equal(first.protocolId, PROTOCOL_ID);
  assert.equal(first.implementationId, IMPLEMENTATION_ID);
  assert.equal(first.identity.datasetKind, 'SYNTHETIC_FIXTURE');
  assert.equal(first.evidence.syntheticFixture, true);
  assert.equal(first.evidence.costModel, 'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE');
  assert.equal(first.evidence.executionEvidence, 'NOT_OKX_EXECUTION_EVIDENCE');
  assert.equal(first.evidence.holdoutClaim, false);
  assert.equal(first.evidence.survivorship, 'UNIVERSE_HISTORY_LIMITATION_HBAR_OMITTED_FOR_COVERAGE_ONLY');
  assert.equal(first.evidence.candidateInterpretation, 'HISTORICAL_CANDIDATE_ONLY_IF_PROPOSED_REAL_SCREEN_PASSES');
  assert.equal(first.evidence.trialLedger, 'UNKNOWN');
  assert.equal(first.evidence.crv.status, 'UNDEFINED_NO_FINITE_STOP');
  assert.equal(first.screen.status, 'SYNTHETIC_ONLY_NOT_ASSESSED');
  assert.equal(first.screen.interpretation, 'SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY');
  assert.equal(first.protocolReview.r2ResponseComment, '6249482850');
  assert.equal(first.protocolReview.r2Verdict, 'GREEN_LIGHT_DESIGN_ONLY');
  assert.equal(first.protocolReview.r3Review, 'PENDING');
  assert.equal(first.paths.length, 44);
  assert.equal(Buffer.byteLength(JSON.stringify(first), 'utf8') <= BUDGET.outputBytes, true);
  assert.deepEqual(first, second);
  assert.equal(first.executionId, second.executionId);
  assert.equal(first.executionId, sha256(canonicalJson({
    protocolId: first.protocolId,
    protocolSha256: first.protocolSha256,
    implementationId: first.implementationId,
    implementationSha256: first.implementationSha256,
    inputSha256: first.identity.inputSha256,
    pathIds: first.paths.map(path => path.pathId)
  })));

  const expectedPrefix = [
    ['primary-n30-f25', 'base-15bp', 'development'],
    ['primary-n30-f25', 'base-15bp', 'diagnostic'],
    ['primary-n30-f25', 'stress-30bp', 'development'],
    ['primary-n30-f25', 'stress-30bp', 'diagnostic']
  ];
  assert.deepEqual(first.paths.slice(0, 4).map(path =>
    [path.variantId, path.scenarioId, path.segmentId]), expectedPrefix);
  assert.equal(first.paths.filter(path => path.kind === 'CANDIDATE').length, 30);
  assert.equal(first.paths.filter(path => path.kind === 'FULL_BASKET').length, 6);
  assert.equal(first.paths.filter(path => path.kind === 'FIXED_CONTROL').length, 6);
  assert.equal(first.paths.filter(path => path.kind === 'CASH').length, 2);
  assert.equal(first.controlRealization.length, 6);

  for (const path of first.paths) {
    assert.equal(path.status, 'COMPLETED');
    assert.equal(path.attempts, 1);
    assert.equal(path.dailyReturnCount, path.segmentId === 'development' ? 180 : 365);
    assert.equal(path.dailyReturns.length, path.dailyReturnCount);
    assert.equal(path.dailyHeldTarget.length, path.dailyReturnCount);
    assert.equal(Number.isFinite(path.meanRealizedExposure), true);
    assert.equal(Number.isFinite(path.meanAbsoluteTargetMismatch), true);
    assert.equal(path.diagnosticRescaling, 'NONE');
    assert.equal(path.observationClass, 'HISTORICAL_DIAGNOSTIC_NOT_HOLDOUT');
    assert.equal(path.tradeCRV.status, 'UNDEFINED_NO_FINITE_STOP');
    assert.equal(path.pathId, sha256(canonicalJson({
      protocolId: first.protocolId,
      protocolSha256: first.protocolSha256,
      implementationId: first.implementationId,
      implementationSha256: first.implementationSha256,
      inputSha256: first.identity.inputSha256,
      canonicalSeriesSha256: first.identity.canonicalSeriesSha256,
      variantId: path.variantId,
      scenarioId: path.scenarioId,
      segmentId: path.segmentId
    })));
    if (path.kind === 'CASH') {
      assert.deepEqual(path.fillCosts, []);
      assert.equal(path.totalCosts, 0);
      assert.equal(path.dailyReturns.every(value => value === 0), true);
    } else {
      assert.equal(path.fillCosts.at(-1).kind, 'TERMINAL_LIQUIDATION');
      assert.equal(path.fillCosts.at(-1).cost > 0, true);
    }
    assert.equal(path.quarterlyReturns.length, path.segmentId === 'development' ? 2 : 4);
    assert.equal(path.fillCosts.every(fill => fill.cashAfterFees >= 0), true);
    assert.equal(path.dailyReturns.every(Number.isFinite), true);
    let priorCumulative = 0;
    for (const fill of path.fillCosts) {
      assert.equal(Math.abs(fill.conservationResidual) <= 1e-6, true);
      assert.equal(fill.cumulativeCost >= priorCumulative, true);
      priorCumulative = fill.cumulativeCost;
    }
    assert.equal(Math.abs(path.totalCosts - priorCumulative) <= 1e-9, true);
  }
  assert.equal(first.authority.executionAuthorized, false);
  assert.equal(first.authority.strategyPnlAuthorized, false);
  assert.equal(first.authority.discoveryAuthorized, false);
  assert.equal(first.authority.validationAuthorized, false);
  assert.equal(first.authority.holdoutAuthorized, false);
  assert.equal(first.authority.paperAuthorized, false);
  assert.equal(first.authority.liveAuthorized, false);
});

test('resumable session preserves manifest order, development calibration boundary, and direct parity', () => {
  const series = createSyntheticSeries();
  const direct = makeRun(series);
  const source = {kind: 'SYNTHETIC_FIXTURE'};
  const session = createExecution({
    seriesByAsset: series,
    source,
    implementationSha256
  });
  source.kind = 'FROZEN_RESEARCH_INPUT';
  const mutated = series.XBTUSD[700];
  mutated.close *= 1.25;
  mutated.high = Math.max(mutated.open, mutated.close) * 1.004;
  mutated.low = Math.min(mutated.open, mutated.close) * 0.996;
  assert.equal(session.status, 'READY');
  assert.equal(session.controlDefinitions, null);
  assert.equal(session.manifest.length, 44);
  assert.equal(session.computationOrder.length, 44);
  assert.deepEqual(session.computationOrder.slice(0, 19).map(path => path.segmentId),
    Array(19).fill('development'));
  assert.deepEqual(session.computationOrder.slice(19).map(path => path.segmentId),
    Array(25).fill('diagnostic'));
  assert.deepEqual(session.manifest.map(path => path.pathId), direct.paths.map(path => path.pathId));
  assert.deepEqual(session.computationOrder.slice(0, 4).map(path =>
    [path.variantId, path.scenarioId, path.segmentId]), [
    ['primary-n30-f25', 'base-15bp', 'development'],
    ['primary-n30-f25', 'stress-30bp', 'development'],
    ['primary-n30-f25', 'stress-30bp-delay-1d', 'development'],
    ['neighbour-n20-f25', 'base-15bp', 'development']
  ]);

  let advances = 0;
  while (session.status === 'READY') {
    const boundary = session.beforePathBoundary();
    assert.equal(boundary.status, 'READY');
    const outcome = session.advanceOne(boundary.pathId);
    assert.equal(['PATH_COMPLETED', 'COMPLETED'].includes(outcome.status), true);
    assert.equal(outcome.completedPath.pathId, boundary.pathId);
    assert.equal(outcome.completedPath.status, 'COMPLETED');
    if (advances === 0) outcome.completedPath.dailyReturns[0] = 123456;
    advances++;
    if (advances === 19) {
      const diagnosticBoundary = session.beforePathBoundary();
      assert.equal(diagnosticBoundary.phase, 'DIAGNOSTIC');
      assert.equal(diagnosticBoundary.ordinal, 20);
      assert.equal(session.completedResult, null);
      const controls = session.controlDefinitions;
      assert.equal(controls.status, 'FROZEN_DEVELOPMENT_ONLY');
      assert.deepEqual(controls, direct.controlDefinitions);
      assert.equal(controls.meanExposure, direct.controlDefinitions.meanExposure);
      assert.equal(controls.riskExposure, direct.controlDefinitions.riskExposure);
      controls.meanExposure = 999;
      assert.equal(session.controlDefinitions.meanExposure, direct.controlDefinitions.meanExposure);
    }
  }
  assert.equal(advances, 44);
  assert.equal(session.completedResult.status, 'COMPLETED');
  session.completedResult.paths[0].dailyReturns[0] = 123456;
  assert.deepEqual(session.finalResult(), direct);
});

test('execution sessions reject out-of-order, repeated, and interrupted advances', () => {
  const series = createSyntheticSeries();
  const makeSession = () => createExecution({
    seriesByAsset: series,
    source: syntheticSource,
    implementationSha256
  });

  const outOfOrder = makeSession();
  const wrongId = outOfOrder.computationOrder[1].pathId;
  assert.equal(outOfOrder.advanceOne(wrongId).status, 'FAILED');
  assert.equal(outOfOrder.finalResult().failure.code, 'OUT_OF_ORDER_PATH');
  assert.equal(outOfOrder.finalResult().attemptedPaths, 0);
  assert.equal(outOfOrder.completedResult, null);

  const interrupted = makeSession();
  interrupted.advanceOne();
  interrupted.advanceOne();
  assert.equal(interrupted.interrupt().status, 'FAILED');
  assert.equal(interrupted.finalResult().failure.code, 'SESSION_INTERRUPTED');
  assert.equal(interrupted.finalResult().attemptedPaths, 2);
  assert.equal(interrupted.finalResult().paths.filter(path =>
    path.status === 'INCOMPLETE_BATCH_ABORT').length, 2);
  assert.equal(interrupted.completedResult, null);

  const duplicate = makeSession();
  const firstPathId = duplicate.beforePathBoundary().pathId;
  duplicate.advanceOne(firstPathId);
  assert.equal(duplicate.advanceOne(firstPathId).status, 'FAILED');
  assert.equal(duplicate.finalResult().failure.code, 'OUT_OF_ORDER_PATH');
  assert.equal(duplicate.finalResult().attemptedPaths, 1);
  assert.equal(duplicate.completedResult, null);

  const repeated = makeSession();
  while (repeated.status === 'READY') repeated.advanceOne();
  assert.equal(repeated.completedResult.status, 'COMPLETED');
  assert.equal(repeated.advanceOne().status, 'FAILED');
  assert.equal(repeated.finalResult().status, 'INVALID');
  assert.equal(repeated.finalResult().failure.code, 'SESSION_NOT_ADVANCEABLE');
  assert.equal(repeated.finalResult().completedPaths, 0);
  assert.equal(repeated.completedResult, null);
});

test('insufficient development evidence is a failed session, never completed', () => {
  // Generated opposing asset moves preserve feature variance while the basket is flat.
  const series = createSyntheticSeries();
  for (let index = 410; index <= 589; index++) {
    for (let assetIndex = 0; assetIndex < ASSETS.length; assetIndex++) {
      const row = series[ASSETS[assetIndex]][index];
      const swing = 8 * Math.sin(index * 0.31);
      row.open = index === 410 ? 100 / 1.0015 : 100;
      row.close = (100 + (assetIndex === 0 ? swing : assetIndex === 1 ? -swing : 0)) /
        (index === 589 ? 0.9985 : 1);
      row.high = Math.max(row.open, row.close) * 1.01;
      row.low = Math.min(row.open, row.close) * 0.99;
    }
  }
  // Remove only numerical fill-solver residuals from this generated fixture.
  const reference = makeRun(series).paths.find(path => path.kind === 'FULL_BASKET' &&
    path.segmentId === 'development' && path.scenarioId === 'base-15bp');
  let relativeEquity = 1;
  for (let index = 410; index <= 589; index++) {
    const priorEquity = relativeEquity;
    relativeEquity *= 1 + reference.dailyReturns[index - 410];
    for (const asset of ASSETS) {
      series[asset][index].close /= relativeEquity;
      if (index > 410) series[asset][index].open /= priorEquity;
    }
  }
  const session = createExecution({seriesByAsset: series, source: syntheticSource, implementationSha256});
  let outcome;
  while (session.status === 'READY') outcome = session.advanceOne();
  assert.equal(outcome.status, 'FAILED');
  assert.equal(session.status, 'FAILED');
  assert.equal(session.finalResult().status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(session.finalResult().attemptedPaths, 19);
  assert.equal(session.completedResult, null);
});

test('session budgets include preparation, control calibration, and finalization', () => {
  const series = createSyntheticSeries();
  const executeAtPhase = phase => {
    const session = createExecution({
      seriesByAsset: series,
      source: syntheticSource,
      implementationSha256,
      syntheticClock: context => context.phase === phase ? BUDGET.totalMs + 1 : 0
    });
    while (session.status === 'READY') session.advanceOne();
    return session.finalResult();
  };
  const failedFirstPath = createExecution({
    seriesByAsset: series, source: syntheticSource, implementationSha256,
    syntheticClock: context => context.phase === 'path-start-check' ? BUDGET.totalMs + 1 : 0
  });
  assert.equal(failedFirstPath.advanceOne().status, 'FAILED');
  assert.equal(failedFirstPath.lastCompletedPath, null);
  assert.equal(failedFirstPath.finalResult().computedPaths, 0);

  const preparation = executeAtPhase('validate-asset');
  assert.equal(preparation.failure.code, 'BUDGET_EXCEEDED');
  assert.equal(preparation.attemptedPaths, 0);

  const calibration = executeAtPhase('control-calibration-start');
  assert.equal(calibration.failure.code, 'BUDGET_EXCEEDED');
  assert.equal(calibration.attemptedPaths, 19);
  assert.equal(calibration.paths.filter(path =>
    path.status === 'INCOMPLETE_BATCH_ABORT').length, 19);

  const finalization = executeAtPhase('result-object-complete');
  assert.equal(finalization.failure.code, 'BUDGET_EXCEEDED');
  assert.equal(finalization.attemptedPaths, 44);
  assert.equal(finalization.completedPaths, 0);
  assert.equal(finalization.paths.every(path =>
    path.status === 'INCOMPLETE_BATCH_ABORT'), true);
});

test('initial delayed path stays in cash and both segments include terminal costs', () => {
  const output = makeRun();
  const regular = getPath(output, 'primary-n30-f25', 'base-15bp', 'development');
  const delayed = getPath(output, 'primary-n30-f25', 'stress-30bp-delay-1d', 'development');
  assert.equal(10000 * (1 + delayed.dailyReturns[0]), 10000);
  assert.equal(delayed.dailyReturns[0], 0);
  assert.equal(delayed.dailyHeldTarget[0], 0);
  assert.equal(regular.fillCosts[0].kind, 'REBALANCE');
  assert.equal(regular.fillCosts[0].date, SEGMENTS.development.firstTimestamp);
  assert.equal(regular.fillCosts[0].cost > 0, true);
  for (const segmentId of Object.keys(SEGMENTS)) {
    const path = getPath(output, 'primary-n30-f25', 'base-15bp', segmentId);
    assert.equal(path.fillCosts.at(-1).date, SEGMENTS[segmentId].lastTimestamp);
    assert.equal(path.fillCosts.at(-1).kind, 'TERMINAL_LIQUIDATION');
  }
});

test('development controls freeze once and are not refit across diagnostic scenarios', () => {
  const output = makeRun();
  assert.equal(output.controlDefinitions.status, 'FROZEN_DEVELOPMENT_ONLY');
  assert.equal(output.controlDefinitions.calibration, 'DEVELOPMENT_15BP_DAILY_NET_RETURNS_AND_HELD_TARGETS');
  const baselinePrimary = getPath(output, 'primary-n30-f25', 'base-15bp', 'development');
  assert.equal(baselinePrimary.dailyHeldTarget[0] > 0, true);
  assert.equal(Math.abs(baselinePrimary.meanHeldTarget -
    baselinePrimary.dailyHeldTarget.reduce((sum, value) => sum + value, 0) / 180) < 1e-15, true);
  const controls = output.paths.filter(path => path.kind === 'FIXED_CONTROL');
  assert.equal(controls.length, 6);
  assert.equal(controls.every(path => path.segmentId === 'diagnostic'), true);
  for (const controlId of ['frozen-mean-exposure', 'frozen-risk-exposure']) {
    const paths = controls.filter(path => path.variantId === controlId);
    assert.equal(paths.length, 3);
    assert.equal(new Set(paths.map(path => path.targetExposure)).size, 1);
    assert.equal(paths[0].targetExposure,
      controlId === 'frozen-mean-exposure'
        ? output.controlDefinitions.meanExposure : output.controlDefinitions.riskExposure);
  }
  assert.equal(output.screen.status, 'SYNTHETIC_ONLY_NOT_ASSESSED');
  assert.equal(output.screen.comparisonSegment, 'diagnostic');
  assert.equal(output.screen.neighbourStressScenario, 'stress-30bp-non-delayed');
  assert.equal(output.screen.checks.primaryNetPositiveAt30bpNonDelayed !== undefined, true);
  assert.equal(output.screen.checks.atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed !== undefined, true);
  assert.equal(output.controlRealization.every(item =>
    item.segmentId === 'diagnostic' && item.diagnosticRescaling === 'NONE' &&
    Number.isFinite(item.frozenTargetExposure) &&
    Number.isFinite(item.meanRealizedExposure) &&
    Number.isFinite(item.meanAbsoluteTargetMismatch)), true);
});

test('risk-control denominator failures are explicit and zero primary risk maps to zero', () => {
  const missing = deriveControlExposures([0, 0, 0], [0, 0, 0], [0.25, 0.25, 0.25]);
  assert.equal(missing.status, 'INSUFFICIENT_EVIDENCE');
  const zeroPrimary = deriveControlExposures([0, 0, 0, 0], [0.1, -0.1, 0.2, -0.2], [0, 0, 0, 0]);
  assert.equal(zeroPrimary.ok, true);
  assert.equal(zeroPrimary.riskExposure, 0);
});

test('bad synthetic batches abort before any path and preserve all 44 incomplete entries', () => {
  const cases = [
    ['missing-asset', series => { delete series.SUIUSD; }],
    ['duplicate-date', series => { series.XBTUSD[100].timestamp = series.XBTUSD[99].timestamp; }],
    ['calendar-gap', series => { series.ETHUSD[100].timestamp = '2024-05-31T00:00:00Z'; }],
    ['malformed-row', series => { series.SOLUSD[100].close = 'not-a-number'; }]
  ];
  for (const [name, alter] of cases) {
    const series = createSyntheticSeries();
    alter(series);
    const output = makeRun(series);
    assert.equal(output.status, 'INVALID', name);
    assert.equal(output.completedPaths, 0, name);
    assert.equal(output.attemptedPaths, 0, name);
    assert.equal(output.computedPaths, 0, name);
    assert.equal(output.paths.length, 44, name);
    assert.equal(output.paths.every(path => path.status === 'NOT_RUN_INPUT_INVALID' && path.attempts === 0), true, name);
    assert.equal(output.screen.status, 'NOT_EVALUATED', name);
    assert.equal(output.authority.executionAuthorized, false, name);
  }
});

test('synthetic accounting failure halts the batch, retains prior paths as incomplete, and does not rank', () => {
  const series = createSyntheticSeries();
  const row = series.XBTUSD[SEGMENTS.diagnostic.startIndex];
  row.open = Number.MIN_VALUE;
  row.low = Number.MIN_VALUE;
  row.high = Math.max(row.close, row.open) * 1.004;
  const output = makeRun(series);
  assert.equal(output.status, 'INVALID');
  assert.equal(output.screen.status, 'NOT_EVALUATED');
  assert.equal(output.budget.automaticRetry, false);
  assert.equal(output.budget.status, 'FAILED_NO_RETRY');
  assert.equal(output.attemptedPaths, 20);
  assert.equal(output.completedPaths, 0);
  assert.equal(output.computedPaths, 19);
  assert.equal(output.paths.filter(path => path.status === 'INCOMPLETE_BATCH_ABORT').length, 19);
  assert.equal(output.paths.filter(path => path.status === 'INVALID').length, 1);
  assert.equal(output.paths.filter(path => path.status === 'NOT_RUN_BATCH_ABORT').length, 24);
  assert.equal(output.paths.find(path => path.status === 'INVALID').attempts, 1);
  assert.equal(output.paths.find(path => path.status === 'NOT_RUN_BATCH_ABORT').attempts, 0);
});

test('zero-volatility synthetic variant signal aborts after prior paths without ranking or retry', () => {
  const output = makeRun(createZeroVolatilityVariantSeries());
  const invalid = output.paths.find(path =>
    path.variantId === 'neighbour-n20-f25' &&
    path.scenarioId === 'base-15bp' && path.segmentId === 'development');
  assert.equal(output.status, 'INVALID');
  assert.equal(output.failure.code, 'INVALID_SIGNAL');
  assert.equal(output.screen.status, 'NOT_EVALUATED');
  assert.equal(output.budget.automaticRetry, false);
  assert.equal(output.budget.status, 'FAILED_NO_RETRY');
  assert.equal(output.attemptedPaths, 4);
  assert.equal(output.completedPaths, 0);
  assert.equal(output.computedPaths, 3);
  assert.equal(output.paths.filter(path => path.status === 'INCOMPLETE_BATCH_ABORT').length, 3);
  assert.equal(invalid.status, 'INVALID');
  assert.equal(invalid.failure.code, 'INVALID_SIGNAL');
  assert.equal(invalid.attempts, 1);
  assert.equal(output.paths.filter(path => path.status === 'NOT_RUN_BATCH_ABORT').length, 40);
});

test('cooperative timeout aborts the full synthetic batch and leaves remaining paths unstarted', () => {
  const syntheticClock = context =>
    context.pathOrdinal === 2 && context.phase === 'simulation-row'
      ? BUDGET.pathMs + 1 : 0;
  const output = makeRun(undefined, syntheticClock);
  assert.equal(output.status, 'INVALID');
  assert.equal(output.failure.code, 'BUDGET_EXCEEDED');
  assert.equal(output.failure.detail.status, 'INVALID_PATH_BUDGET');
  assert.equal(output.screen.status, 'NOT_EVALUATED');
  assert.equal(output.budget.automaticRetry, false);
  assert.equal(output.budget.status, 'FAILED_NO_RETRY');
  assert.equal(output.attemptedPaths, 2);
  assert.equal(output.completedPaths, 0);
  assert.equal(output.computedPaths, 1);
  assert.equal(output.paths.filter(path => path.status === 'INCOMPLETE_BATCH_ABORT').length, 1);
  assert.equal(output.paths.filter(path => path.status === 'INVALID_PATH_BUDGET').length, 1);
  assert.equal(output.paths.filter(path => path.status === 'NOT_RUN_BATCH_ABORT').length, 42);
});

test('frozen source identity rejects any changed file hash without reading source data', () => {
  const files = Object.fromEntries(ASSETS.map(asset => [asset, INPUT.normalizedHashes[asset]]));
  assert.equal(validateSourceIdentity({
    kind: 'FROZEN_RESEARCH_INPUT',
    commit: INPUT.sourceCommit,
    files
  }).ok, true);
  files.SUIUSD = '0'.repeat(64);
  assert.equal(validateSourceIdentity({
    kind: 'FROZEN_RESEARCH_INPUT',
    commit: INPUT.sourceCommit,
    files
  }).error.code, 'FROZEN_IDENTITY_MISMATCH');
  let sourceGetterCalls = 0;
  const unsafeSource = Object.defineProperty({}, 'kind', {
    enumerable: true,
    get() {
      sourceGetterCalls++;
      return 'SYNTHETIC_FIXTURE';
    }
  });
  assert.equal(validateSourceIdentity(unsafeSource).ok, false);
  assert.equal(sourceGetterCalls, 0);
});

test('malformed or accessor-backed batch envelopes fail closed without invoking getters', () => {
  let getterCalls = 0;
  const options = {
    source: syntheticSource,
    implementationSha256
  };
  Object.defineProperty(options, 'seriesByAsset', {
    enumerable: true,
    get() {
      getterCalls++;
      return createSyntheticSeries();
    }
  });
  assert.equal(runBatch(options).failure.code, 'BATCH_INPUT_INVALID');
  assert.equal(runBatch(null).failure.code, 'BATCH_INPUT_INVALID');
  assert.equal(getterCalls, 0);
});

test('a failed path budget executes once, stops later paths, and never retries', () => {
  const ticks = [0, 1, 2, 60003, 60004];
  const tracker = createBudgetTracker(() => ticks.shift());
  let attempts = 0;
  const first = tracker.run('synthetic-path-1', () => {
    attempts++;
    return 'synthetic-result';
  });
  const later = tracker.run('synthetic-path-2', () => {
    attempts++;
    return 'must-not-run';
  });
  assert.equal(first.status, 'INVALID_PATH_BUDGET');
  assert.equal(first.attempts, 1);
  assert.equal(later.status, 'NOT_RUN_BATCH_ABORT');
  assert.equal(later.attempts, 0);
  assert.equal(attempts, 1);
});

test('source hash is a deterministic three-file bundle identity, separate from data identity', () => {
  const executionRequest = readFileSync(requestPath, 'utf8');
  assert.match(implementationSha256, /^[a-f0-9]{64}$/);
  assert.match(executionRequest, new RegExp(`bundle SHA-256 \`${implementationSha256}\``));
  assert.equal(protocol.identity.implementationSha256, 'BOUND_IN_EXECUTION_REQUEST');
  assert.equal(protocol.input.mode, 'CALLER_SUPPLIED_IN_MEMORY_OHLC_ONLY');
  assert.equal(protocol.input.csvLoader, false);
  assert.equal(protocol.input.filesystemDiscovery, false);
  const engineSource = readFileSync(enginePath, 'utf8');
  const validatorSource = readFileSync(validatorPath, 'utf8');
  for (const source of [engineSource, validatorSource]) {
    assert.doesNotMatch(source, /node:(?:fs|http|https|net|tls)|\bfetch\s*\(|\bprocess\.env\b/);
  }
});
