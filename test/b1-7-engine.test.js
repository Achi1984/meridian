import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  acceptsTarget, buildSchedule, canonicalJson, createBudgetTracker, deriveControlExposures,
  deriveFeatures, runBatch, sha256
} from '../scripts/research/b1-7/engine.mjs';
import {
  ASSETS, BUDGET, IMPLEMENTATION_ID, INPUT, PROTOCOL_ID, PROTOCOL_SHA256, SCENARIOS,
  SEGMENTS, VARIANTS, validateSeries, validateSourceIdentity
} from '../scripts/research/b1-7/validate.mjs';
import {createSyntheticSeries} from './fixtures/b1-7/synthetic-series.mjs';

const protocolPath = new URL('../research/protocols/b1-7-20261018/protocol.json', import.meta.url);
const enginePath = new URL('../scripts/research/b1-7/engine.mjs', import.meta.url);
const validatorPath = new URL('../scripts/research/b1-7/validate.mjs', import.meta.url);
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const implementationSha256 = sha256(canonicalJson({
  engineSha256: hashFile(enginePath),
  validatorSha256: hashFile(validatorPath)
}));
const syntheticSource = {kind: 'SYNTHETIC_FIXTURE'};

function makeRun(seriesByAsset = createSyntheticSeries()) {
  return runBatch({seriesByAsset, source: syntheticSource, implementationSha256});
}

function getPath(output, variantId, scenarioId, segmentId) {
  return output.paths.find(path => path.variantId === variantId &&
    path.scenarioId === scenarioId && path.segmentId === segmentId);
}

test('protocol constants, exact universe, costs, path count, and raw freeze hash agree', () => {
  assert.equal(protocol.schema, 'MERIDIAN_B1_7_PROTOCOL_R2');
  assert.equal(protocol.protocolId, PROTOCOL_ID);
  assert.equal(hashFile(protocolPath), PROTOCOL_SHA256);
  assert.deepEqual(protocol.universe.assets, ASSETS);
  assert.deepEqual(protocol.variants, VARIANTS);
  assert.deepEqual(protocol.scenarios, SCENARIOS.map(({id, costRate, delayDays}) => ({
    id, costRate, delayDays, perSideCostBp: costRate * 10000
  })));
  assert.equal(BUDGET.paths, 44);
  assert.equal(protocol.pathManifest.pathCount, 44);
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
  assert.equal(acceptsTarget(0.35, 0.25), false);
  assert.equal(acceptsTarget(0.3500000000000001, 0.25), true);
  assert.equal(acceptsTarget(0.15, 0.25), true);
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
  const horizonSchedule = buildSchedule(fixture.XBTUSD, features, truncated, 1);
  assert.equal(horizonSchedule.cancelled.some(fill => fill.decisionIndex === sunday), true);
  assert.equal(horizonSchedule.fills.every(fill => fill.fillIndex <= sunday), true);
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
  assert.equal(first.evidence.holdoutClaim, false);
  assert.equal(first.evidence.trialLedger, 'UNKNOWN');
  assert.equal(first.evidence.crv.status, 'UNDEFINED_NO_FINITE_STOP');
  assert.equal(first.screen.status, 'SYNTHETIC_ONLY_NOT_ASSESSED');
  assert.equal(first.screen.interpretation, 'SYNTHETIC_FIXTURE_RULE_CHECKS_ONLY');
  assert.equal(first.protocolReview.r2ResponseStatus, 'PENDING');
  assert.equal(first.paths.length, 44);
  assert.equal(Buffer.byteLength(JSON.stringify(first), 'utf8') <= BUDGET.outputBytes, true);
  assert.deepEqual(first, second);
  assert.equal(first.executionId, second.executionId);

  const expectedPrefix = [
    ['primary-n30-f25', 'base-85bp', 'development'],
    ['primary-n30-f25', 'base-85bp', 'diagnostic'],
    ['primary-n30-f25', 'stress-160bp', 'development'],
    ['primary-n30-f25', 'stress-160bp', 'diagnostic']
  ];
  assert.deepEqual(first.paths.slice(0, 4).map(path =>
    [path.variantId, path.scenarioId, path.segmentId]), expectedPrefix);
  assert.equal(first.paths.filter(path => path.kind === 'CANDIDATE').length, 30);
  assert.equal(first.paths.filter(path => path.kind === 'FULL_BASKET').length, 6);
  assert.equal(first.paths.filter(path => path.kind === 'FIXED_CONTROL').length, 6);
  assert.equal(first.paths.filter(path => path.kind === 'CASH').length, 2);

  for (const path of first.paths) {
    assert.equal(path.status, 'COMPLETED');
    assert.equal(path.attempts, 1);
    assert.equal(path.dailyReturnCount, path.segmentId === 'development' ? 180 : 365);
    assert.equal(path.dailyReturns.length, path.dailyReturnCount);
    assert.equal(path.dailyHeldTarget.length, path.dailyReturnCount);
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

test('initial delayed path stays in cash and both segments include terminal costs', () => {
  const output = makeRun();
  const regular = getPath(output, 'primary-n30-f25', 'base-85bp', 'development');
  const delayed = getPath(output, 'primary-n30-f25', 'stress-160bp-delay-1d', 'development');
  assert.equal(10000 * (1 + delayed.dailyReturns[0]), 10000);
  assert.equal(delayed.dailyReturns[0], 0);
  assert.equal(delayed.dailyHeldTarget[0], 0);
  assert.equal(regular.fillCosts[0].kind, 'REBALANCE');
  assert.equal(regular.fillCosts[0].date, SEGMENTS.development.firstTimestamp);
  assert.equal(regular.fillCosts[0].cost > 0, true);
  for (const segmentId of Object.keys(SEGMENTS)) {
    const path = getPath(output, 'primary-n30-f25', 'base-85bp', segmentId);
    assert.equal(path.fillCosts.at(-1).date, SEGMENTS[segmentId].lastTimestamp);
    assert.equal(path.fillCosts.at(-1).kind, 'TERMINAL_LIQUIDATION');
  }
});

test('development controls freeze once and are not refit across diagnostic scenarios', () => {
  const output = makeRun();
  assert.equal(output.controlDefinitions.status, 'FROZEN_DEVELOPMENT_ONLY');
  assert.equal(output.controlDefinitions.calibration, 'DEVELOPMENT_85BP_DAILY_NET_RETURNS_AND_HELD_TARGETS');
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

test('source hash is a deterministic bundle identity, not a filesystem-loaded data identity', () => {
  assert.match(implementationSha256, /^[a-f0-9]{64}$/);
  assert.equal(protocol.identity.implementationSha256, 'BOUND_IN_EXECUTION_REQUEST');
  assert.equal(protocol.input.mode, 'CALLER_SUPPLIED_IN_MEMORY_OHLC_ONLY');
  assert.equal(protocol.input.csvLoader, false);
  assert.equal(protocol.input.filesystemDiscovery, false);
});
