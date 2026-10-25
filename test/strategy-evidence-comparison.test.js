import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateEvidenceContract} from '../docs/strategy-lab/validate-evidence-contract.mjs';
import {
  COMPARISON_LIMITS,
  USAGE,
  compareStrategyEvidence
} from '../scripts/research/compare-strategy-evidence.mjs';

const cliPath = fileURLToPath(new URL('../scripts/research/compare-strategy-evidence.mjs', import.meta.url));
const stages = [
  'IDEA', 'RESEARCH', 'BACKTEST', 'OUT_OF_SAMPLE_HOLDOUT',
  'PAPER_BOT', 'FORWARD_VALIDATION', 'ROBUSTNESS_REVIEW'
];
const names = [
  'NET_EXPECTANCY', 'PROFIT_FACTOR', 'DRAWDOWN', 'SHARPE', 'SORTINO',
  'TAIL_RISK', 'COST_SENSITIVITY', 'REGIME_STABILITY', 'TIME_STABILITY',
  'ASSET_STABILITY', 'UNCERTAINTY', 'SAMPLE_DEPENDENCE', 'SELECTION_RISK'
];
const flags = [
  'canonicalExecutionAuthorized', 'strategyPnlAuthorized', 'discoveryAuthorized',
  'validationAuthorized', 'holdoutAuthorized', 'paperAuthorized', 'liveAuthorized'
];
const hash = char => char.repeat(64);
const rulesRef = {id: 'rules-alpha-v1', sha256: hash('a')};
const time = (day, hour = '00') => `2025-01-${String(day).padStart(2, '0')}T${hour}:00:00Z`;

function metrics() {
  return names.map(name => ({
    name,
    applicability: 'APPLICABLE',
    value: name === 'DRAWDOWN' ? 5 : 1.2,
    unit: name === 'DRAWDOWN' ? 'percent' : 'ratio',
    denominator: {value: 50, unit: 'trades'},
    reason: null,
    threshold: null
  }));
}

function reference(stage, index, disjointFrom = []) {
  return {
    id: `data-ref-${stage.toLowerCase()}`,
    datasetId: `dataset-${stage.toLowerCase()}`,
    sha256: hash(String(index + 1)),
    role: {
      BACKTEST: 'DEVELOPMENT',
      OUT_OF_SAMPLE_HOLDOUT: 'HOLDOUT',
      FORWARD_VALIDATION: 'FORWARD',
      ROBUSTNESS_REVIEW: 'ROBUSTNESS'
    }[stage],
    disjointFrom,
    asKnownAt: time([12, 22, 34, 44][index] ?? 50)
  };
}

function outcome(stage, index, {
  windowStart, windowEnd, availableAt, recordedAt, disjointFrom = []
} = {}) {
  const dataRef = reference(stage, index, disjointFrom);
  if (availableAt) dataRef.asKnownAt = availableAt;
  return {
    stage,
    kind: 'OUTCOME',
    status: 'PRESENT_ASSERTED',
    receiptRef: `receipt-${stage.toLowerCase()}`,
    recordedAt: recordedAt ?? time([12, 22, 34, 44][index] ?? 50, '12'),
    strategyId: 'hypothesis-alpha',
    strategyVersion: 'v1',
    rulesRef: structuredClone(rulesRef),
    dataRef,
    dataWindow: {
      start: windowStart ?? time([2, 13, 25, 35][index] ?? 40),
      end: windowEnd ?? time([10, 20, 30, 40][index] ?? 45),
      availableAt: availableAt ?? time([11, 21, 31, 41][index] ?? 46)
    },
    plannedWindow: null,
    preregistration: {
      id: `predeclared-${stage.toLowerCase()}`,
      sha256: hash(String(index + 5)),
      declaredAt: time(1, '01'),
      declaredBy: 'synthetic fixture author',
      source: 'synthetic preregistration'
    },
    sample: {
      n: 50,
      unit: 'trades',
      dependenceApproach: 'Chronological blocks declared.',
      uncertaintyApproach: 'Uncertainty method declared; not computed.'
    },
    metrics: metrics(),
    holdoutAccess: null,
    resultReason: 'Synthetic evidence assertion only.'
  };
}

function setupReceipt() {
  return {
    stage: 'PAPER_BOT',
    kind: 'PAPER_SETUP',
    status: 'SETUP_RECORDED',
    receiptRef: 'receipt-paper-setup',
    recordedAt: '2025-01-23T12:00:00Z',
    strategyId: 'hypothesis-alpha',
    strategyVersion: 'v1',
    rulesRef: structuredClone(rulesRef),
    dataRef: null,
    dataWindow: null,
    plannedWindow: {start: '2025-02-01T00:00:00Z', end: '2025-03-01T00:00:00Z'},
    preregistration: null,
    sample: null,
    metrics: null,
    holdoutAccess: null,
    resultReason: 'Paper setup claim only; observation is planned, not completed.'
  };
}

function packet() {
  const receipts = [
    {
      stage: 'IDEA', kind: 'DESIGN', status: 'PRESENT_ASSERTED', receiptRef: 'receipt-idea',
      recordedAt: '2024-12-01T00:00:00Z', strategyId: 'hypothesis-alpha', strategyVersion: 'v1',
      rulesRef: structuredClone(rulesRef), dataRef: null, dataWindow: null, plannedWindow: null,
      preregistration: null, sample: null, metrics: null, holdoutAccess: null, resultReason: 'Synthetic idea.'
    },
    {
      stage: 'RESEARCH', kind: 'DESIGN', status: 'PRESENT_ASSERTED', receiptRef: 'receipt-research',
      recordedAt: '2024-12-15T00:00:00Z', strategyId: 'hypothesis-alpha', strategyVersion: 'v1',
      rulesRef: structuredClone(rulesRef), dataRef: null, dataWindow: null, plannedWindow: null,
      preregistration: null, sample: null, metrics: null, holdoutAccess: null, resultReason: 'Synthetic research.'
    },
    outcome('BACKTEST', 0, {
      windowStart: time(2), windowEnd: time(10), availableAt: time(11), recordedAt: time(12, '12')
    }),
    outcome('OUT_OF_SAMPLE_HOLDOUT', 1, {
      windowStart: time(13), windowEnd: time(20), availableAt: time(21),
      recordedAt: time(22, '12'), disjointFrom: ['dataset-backtest']
    }),
    setupReceipt(),
    outcome('FORWARD_VALIDATION', 2, {
      windowStart: '2025-02-01T00:00:00Z', windowEnd: '2025-02-28T00:00:00Z',
      availableAt: '2025-03-01T00:00:00Z', recordedAt: '2025-03-02T12:00:00Z',
      disjointFrom: ['dataset-out_of_sample_holdout']
    }),
    outcome('ROBUSTNESS_REVIEW', 3, {
      windowStart: '2025-03-03T00:00:00Z', windowEnd: '2025-03-10T00:00:00Z',
      availableAt: '2025-03-11T00:00:00Z', recordedAt: '2025-03-12T12:00:00Z'
    })
  ];
  receipts[3].holdoutAccess = {
    history: 'KNOWN',
    exposures: [{
      role: 'FIRST_EXPOSURE',
      at: '2025-01-22T12:00:00Z',
      purpose: 'First declared holdout inspection.'
    }]
  };
  return {
    schemaVersion: 'MERIDIAN_PAPER_FIRST_EVIDENCE_V2',
    asOf: '2026-10-14T21:00:00Z',
    syntheticFixture: true,
    checkpoint: {
      id: 'MERIDIAN_LIVE_CHECKPOINT',
      mainSha: 'efec133f4ff8a809722b79fa7c5fe8007667c1ea',
      stage: 'SOURCE_AUDIT',
      sourceOnly: true,
      flags: Object.fromEntries(flags.map(flag => [flag, false]))
    },
    strategy: {
      id: 'hypothesis-alpha',
      version: 'v1',
      hypothesis: 'Synthetic hypothesis used only to exercise the evidence schema.',
      entry: 'Declared synthetic entry.',
      exit: 'Declared synthetic exit.',
      riskPolicy: {
        type: 'STOP_BASED',
        policy: 'Declared bounded risk policy.',
        stopDefinition: 'Declared stop rule.',
        justification: 'Synthetic fixture.',
        maxLossBound: 'Declared in the strategy policy.',
        source: 'Synthetic risk policy.'
      },
      positionSizing: {
        method: 'Declared method', unit: 'account risk', policy: 'Declared sizing', source: 'Synthetic policy.'
      },
      costAssumptions: Object.fromEntries(['fee', 'spread', 'slippage', 'funding', 'borrow'].map(key => [
        key, {status: 'ASSUMED', value: 0.01, unit: 'percent', source: 'Synthetic assumption.', reason: null}
      ])),
      marketConditions: ['Synthetic market conditions.'],
      telemetry: ['Entry, exit, risk, costs and data version.'],
      invalidationConditions: ['Declared thesis invalidation.'],
      frozenAt: '2025-01-01T00:00:00Z',
      disposition: 'NEW_HYPOTHESIS',
      rulesRef: structuredClone(rulesRef),
      tradePlanPolicy: {
        policyId: 'PLANNED_NET_CRV_MIN_3_V1',
        source: 'docs/strategy-lab/TRADE_PLAN_CRV.md',
        applicability: 'APPLICABLE_FINITE_TRADE_PAYOFF',
        status: 'ASSERTED_UNVERIFIED',
        reason: null
      }
    },
    lifecycle: {currentStage: 'ROBUSTNESS_REVIEW', receipts},
    trialLedger: {declaredTrials: 4, reportedTrials: 4, source: 'Synthetic ledger fixture.'},
    edgeHealth: {
      classification: 'EXPERIMENTAL',
      source: 'Synthetic edge classification.',
      measuredAt: '2025-03-12T12:00:00Z',
      metricRef: 'synthetic-ref'
    }
  };
}

function cli(input, extraArgs = []) {
  return spawnSync(process.execPath, [cliPath, ...extraArgs], {
    input,
    encoding: 'utf8',
    timeout: 3000
  });
}

function metric(packetInput, name) {
  return packetInput.lifecycle.receipts[2].metrics.find(item => item.name === name);
}

test('compares the existing validated contract and treats reordered metric/exposure records deterministically', () => {
  const earlier = packet();
  const later = structuredClone(earlier);
  later.lifecycle.receipts[2].metrics.reverse();
  earlier.lifecycle.receipts[3].holdoutAccess.exposures.push({
    role: 'AUDIT', at: '2025-01-22T13:00:00Z', purpose: 'Synthetic audit claim.'
  });
  later.lifecycle.receipts[3].holdoutAccess.exposures.push({
    role: 'AUDIT', at: '2025-01-22T13:00:00Z', purpose: 'Synthetic audit claim.'
  });
  later.lifecycle.receipts[3].holdoutAccess.exposures.reverse();
  const earlierBefore = structuredClone(earlier);
  const laterBefore = structuredClone(later);

  const earlierValidation = validateEvidenceContract(earlier);
  assert.equal(earlierValidation.evidenceCompleteness.status, 'ASSERTED_WELL_FORMED');
  const result = compareStrategyEvidence(earlier, later);

  assert.equal(result.validation.earlier.evidenceCompleteness.status, 'ASSERTED_WELL_FORMED');
  assert.equal(result.validation.later.evidenceCompleteness.status, 'ASSERTED_WELL_FORMED');
  assert.equal(result.comparison.declaredComparability, 'DECLARED_COMPARABLE');
  assert.deepEqual(result.lifecycleReceipts, {added: [], removed: [], changed: []});
  assert.deepEqual(result.metrics, {added: [], removed: [], changed: []});
  assert.deepEqual(result.holdoutUseClaims, {
    added: [], removed: [], changed: [],
    earlierClaimsRemainVisible: result.holdoutUseClaims.earlierClaimsRemainVisible,
    callerClaimedUseInEitherInput: true
  });
  assert.equal(result.comparison.metadataEqualityIsAuthenticatedEquivalence, false);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.autoPromotion, false);
  assert.equal(result.provenanceVerified, false);
  assert.deepEqual(earlier, earlierBefore);
  assert.deepEqual(later, laterBefore);
});

test('strategy, rules, data, window, cost, and preregistration/threshold changes are identified', () => {
  const earlier = packet();
  const later = packet();
  later.strategy.version = 'v2';
  later.strategy.rulesRef.sha256 = hash('b');
  later.lifecycle.receipts[2].dataRef.sha256 = hash('c');
  later.lifecycle.receipts[2].dataWindow.end = time(9);
  later.strategy.costAssumptions.fee.value = 0.02;
  later.lifecycle.receipts[2].preregistration.id = 'predeclared-revised';
  metric(later, 'NET_EXPECTANCY').threshold = {
    operator: 'GT', value: 1, unit: 'ratio', declaredAt: time(1, '01'),
    declaredBy: 'synthetic fixture author', source: 'synthetic threshold'
  };

  const result = compareStrategyEvidence(earlier, later);
  assert.equal(result.comparison.declaredComparability, 'NOT_COMPARABLE_INCOMPLETE_OR_INVALID');
  assert.equal(result.validation.later.evidenceCompleteness.status, 'INVALID');
  for (const reason of [
    'STRATEGY_CHANGED', 'RULES_CHANGED', 'DATA_CHANGED', 'WINDOWS_CHANGED',
    'COSTASSUMPTIONS_CHANGED', 'CRITERIA_CHANGED'
  ]) assert.ok(result.comparison.incompatibilityReasons.includes(reason), reason);
  const expectancy = result.metrics.changed.find(item => item.id.includes('NET_EXPECTANCY'));
  assert.equal(expectancy.later.threshold.state, 'PRESENT');
  assert.equal(expectancy.later.threshold.value.value, 1);
});

test('missing identities, incomplete evidence, and invalid metric values cannot qualify as comparable', () => {
  const empty = compareStrategyEvidence({}, {});
  assert.equal(empty.comparison.declaredComparability, 'NOT_COMPARABLE_INCOMPLETE_OR_INVALID');
  assert.equal(empty.validation.earlier.evidenceCompleteness.status, 'INVALID');

  const incomplete = packet();
  delete incomplete.trialLedger;
  const incompleteResult = compareStrategyEvidence(incomplete, packet());
  assert.equal(incompleteResult.validation.earlier.evidenceCompleteness.status, 'NOT_ASSESSED');
  assert.equal(incompleteResult.comparison.declaredComparability, 'NOT_COMPARABLE_INCOMPLETE_OR_INVALID');

  const invalidMetric = packet();
  metric(invalidMetric, 'NET_EXPECTANCY').value = null;
  const invalidResult = compareStrategyEvidence(invalidMetric, packet());
  assert.equal(invalidResult.validation.earlier.evidenceCompleteness.status, 'INVALID');
  assert.equal(invalidResult.comparison.declaredComparability, 'NOT_COMPARABLE_INCOMPLETE_OR_INVALID');
  assert.ok(invalidResult.validation.earlier.evidenceCompleteness.issues.some(issue =>
    issue.reason === 'FINITE_ASSERTED_METRIC_REQUIRED'));

  const zero = packet();
  const absent = packet();
  metric(zero, 'NET_EXPECTANCY').value = 0;
  delete metric(absent, 'NET_EXPECTANCY').value;
  const absentMetric = compareStrategyEvidence(zero, absent).metrics.changed.find(item =>
    item.id.includes('NET_EXPECTANCY'));
  assert.deepEqual(absentMetric.earlier.value, {state: 'PRESENT', value: 0});
  assert.deepEqual(absentMetric.later.value, {state: 'ABSENT'});

  const undefinedValue = packet();
  metric(undefinedValue, 'NET_EXPECTANCY').value = undefined;
  const undefinedMetric = compareStrategyEvidence(zero, undefinedValue).metrics.changed.find(item =>
    item.id.includes('NET_EXPECTANCY'));
  assert.deepEqual(undefinedMetric.later.value, {state: 'UNDEFINED'});
});

test('metric values, semantics, reasons, thresholds, and stage associations remain visible', () => {
  const earlier = packet();
  const later = packet();
  metric(earlier, 'NET_EXPECTANCY').value = 0;
  metric(later, 'NET_EXPECTANCY').denominator.value = 25;
  metric(earlier, 'SHARPE').applicability = 'NOT_APPLICABLE';
  metric(earlier, 'SHARPE').value = null;
  metric(earlier, 'SHARPE').unit = null;
  metric(earlier, 'SHARPE').denominator = null;
  metric(earlier, 'SHARPE').reason = 'Not assessed in this synthetic receipt.';
  metric(later, 'SHARPE').applicability = 'NOT_APPLICABLE';
  metric(later, 'SHARPE').value = null;
  metric(later, 'SHARPE').unit = null;
  metric(later, 'SHARPE').denominator = null;
  metric(later, 'SHARPE').reason = 'Synthetic reason changed.';

  const result = compareStrategyEvidence(earlier, later);
  const zero = result.metrics.changed.find(item => item.id.includes('NET_EXPECTANCY'));
  assert.equal(zero.earlier.value.value, 0);
  assert.equal(zero.earlier.stage, 'BACKTEST');
  assert.deepEqual(zero.earlier.denominator.value, {value: 50, unit: 'trades'});
  assert.deepEqual(zero.later.denominator.value, {value: 25, unit: 'trades'});
  assert.ok(result.comparison.incompatibilityReasons.some(reason => reason.includes('METRIC_SEMANTICS_CHANGED')));

  const sharpe = result.metrics.changed.find(item => item.id.includes('SHARPE'));
  assert.equal(sharpe.earlier.reason.value, 'Not assessed in this synthetic receipt.');
  assert.equal(sharpe.later.reason.value, 'Synthetic reason changed.');
  assert.equal(sharpe.earlier.threshold.state, 'NULL');
});

test('removed failure and holdout-use claims remain in earlier issues and diffs', () => {
  const earlier = packet();
  const later = packet();
  earlier.lifecycle.receipts[3].holdoutAccess.exposures.push({
    role: 'REUSED_FOR_NEW_HYPOTHESIS',
    at: '2025-01-22T13:00:00Z',
    purpose: 'Synthetic reuse claim.'
  });
  later.lifecycle.receipts[3].holdoutAccess.exposures = later.lifecycle.receipts[3].holdoutAccess.exposures
    .filter(item => item.role !== 'REUSED_FOR_NEW_HYPOTHESIS');

  const result = compareStrategyEvidence(earlier, later);
  assert.ok(result.failures.earlier.some(issue => issue.reason === 'HOLDOUT_NOT_INDEPENDENT_FOR_CONFIRMATION'));
  assert.ok(result.failures.removed.some(item =>
    item.earlier.reason === 'HOLDOUT_NOT_INDEPENDENT_FOR_CONFIRMATION'));
  assert.ok(result.holdoutUseClaims.removed.some(item => item.earlier.role === 'REUSED_FOR_NEW_HYPOTHESIS'));
  assert.equal(result.holdoutUseClaims.callerClaimedUseInEitherInput, true);
});

test('synthetic versus non-synthetic caller claims are incompatible and remain unauthenticated', () => {
  const earlier = packet();
  const later = packet();
  later.syntheticFixture = false;
  const result = compareStrategyEvidence(earlier, later);

  assert.ok(result.comparison.incompatibilityReasons.includes('SYNTHETIC_CLASS_MISMATCH'));
  assert.equal(result.comparison.declaredComparability, 'DECLARED_INCOMPATIBLE');
  assert.deepEqual(result.syntheticFixtureClaims, {
    earlier: {state: 'PRESENT', value: true},
    later: {state: 'PRESENT', value: false}
  });
  assert.equal(result.provenanceVerified, false);
});

test('an undeclared synthetic class cannot become comparable to an explicit claim', () => {
  const earlier = packet();
  const later = packet();
  delete later.syntheticFixture;
  const result = compareStrategyEvidence(earlier, later);

  assert.equal(result.comparison.declaredComparability, 'NOT_COMPARABLE_INCOMPLETE_OR_INVALID');
  assert.ok(result.comparison.missingIdentityFields.includes('syntheticFixtureClass'));
  assert.deepEqual(result.syntheticFixtureClaims, {
    earlier: {state: 'PRESENT', value: true},
    later: {state: 'ABSENT'}
  });
});

test('direct function bounds aggregate copies and rejects accessors without invoking them', () => {
  const oversized = () => Object.fromEntries(['a', 'b', 'c', 'd'].map(key => [key, 'x'.repeat(8192)]));
  assert.throws(() => compareStrategyEvidence(oversized(), oversized()),
    error => error.code === 'INPUT_BYTE_LIMIT_EXCEEDED');

  let invoked = false;
  const accessor = packet();
  Object.defineProperty(accessor, 'strategy', {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error('must not execute');
    }
  });
  assert.throws(() => compareStrategyEvidence(accessor, packet()), error =>
    error.code === 'ACCESSOR_OR_HIDDEN_PROPERTY');
  assert.equal(invoked, false);
});

test('CLI uses the contract, bounds serialized bytes, and rejects invalid input without echoing it', () => {
  const help = cli('', ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /MERIDIAN_PAPER_FIRST_EVIDENCE_V2/);
  assert.match(USAGE, /PAPER_FIRST_EVIDENCE_CONTRACT/);

  const valid = cli(JSON.stringify({earlier: packet(), later: packet()}));
  assert.equal(valid.status, 0);
  assert.equal(JSON.parse(valid.stdout).validation.earlier.evidenceCompleteness.status, 'ASSERTED_WELL_FORMED');

  const marker = 'sensitive caller evidence marker';
  const invalid = cli(JSON.stringify({earlier: {marker}, later: {}}));
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
  assert.doesNotMatch(invalid.stderr, new RegExp(marker));
  assert.notEqual(cli('{"earlier":{},"later":{},"extra":true}').status, 0);

  const oversized = ' '.repeat(COMPARISON_LIMITS.inputBytes + 1);
  const tooLarge = cli(oversized);
  assert.notEqual(tooLarge.status, 0);
  assert.equal(tooLarge.stdout, '');
});
