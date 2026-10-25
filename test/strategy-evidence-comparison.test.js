import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  COMPARISON_LIMITS,
  USAGE,
  compareStrategyEvidence
} from '../scripts/research/compare-strategy-evidence.mjs';

const cliPath = fileURLToPath(new URL('../scripts/research/compare-strategy-evidence.mjs', import.meta.url));

function evidence() {
  return {
    strategy: {id: 'alpha', version: 'v1'},
    rules: {id: 'rules-1', version: 1},
    data: {id: 'data-1', digest: 'digest-1'},
    window: {start: '2025-01-01', end: '2025-01-31'},
    costReference: {id: 'cost-1', revision: 1},
    criteriaReference: {id: 'criteria-1', revision: 1},
    lifecycleReceipts: [
      {id: 'receipt-a', stage: 'BACKTEST', status: 'ASSERTED'},
      {id: 'receipt-b', stage: 'HOLDOUT', status: 'ASSERTED'}
    ],
    metrics: [
      {name: 'expectancy', value: 0, unit: 'currency', denominator: {value: 10, unit: 'trades'}, applicability: 'APPLICABLE'},
      {name: 'sharpe', value: 1.2, unit: 'ratio', denominator: {value: 10, unit: 'trades'}, applicability: 'APPLICABLE'}
    ],
    failures: [{id: 'f-1', status: 'FAILED'}],
    unknowns: [{id: 'u-1', status: 'UNKNOWN'}],
    holdoutUseClaims: [{id: 'h-1', use: 'FIRST_EXPOSURE'}],
    syntheticFixture: true
  };
}

function cli(input, extraArgs = []) {
  return spawnSync(process.execPath, [cliPath, ...extraArgs], {
    input,
    encoding: 'utf8',
    timeout: 3000
  });
}

test('identical metadata and reordered equivalent receipts compare deterministically without mutation', () => {
  const earlier = evidence();
  const later = structuredClone(earlier);
  later.lifecycleReceipts.reverse();
  const earlierBefore = structuredClone(earlier);
  const laterBefore = structuredClone(later);

  const first = compareStrategyEvidence(earlier, later);
  const second = compareStrategyEvidence(earlier, later);

  assert.deepEqual(first, second);
  assert.equal(first.comparison.declaredComparability, 'DECLARED_COMPARABLE');
  assert.deepEqual(first.lifecycleReceipts, {added: [], removed: [], changed: []});
  assert.equal(first.comparison.metadataEqualityIsAuthenticatedEquivalence, false);
  assert.deepEqual(earlier, earlierBefore);
  assert.deepEqual(later, laterBefore);
  assert.equal(first.executionAuthorized, false);
  assert.equal(first.autoPromotion, false);
  assert.equal(first.provenanceVerified, false);
  assert.equal(Object.hasOwn(first, 'winner'), false);
});

test('missing metadata is not treated as a declaration of comparability', () => {
  const result = compareStrategyEvidence({}, {});
  assert.equal(result.comparison.declaredComparability, 'COMPARABILITY_UNDECLARED');
  assert.deepEqual(result.comparison.undeclaredMetadataFields, [
    'strategy', 'rules', 'data', 'window', 'costReference', 'criteriaReference'
  ]);
  assert.deepEqual(result.comparison.incompatibilityReasons, []);
});

test('identity, rules, data, window, cost, and criteria changes are explicit incompatibilities', () => {
  const earlier = evidence();
  const later = evidence();
  later.strategy.version = 'v2';
  later.rules.version = 2;
  later.data.digest = 'digest-2';
  later.window.end = '2025-02-28';
  later.costReference.revision = 2;
  later.criteriaReference.revision = 2;

  const result = compareStrategyEvidence(earlier, later);
  assert.equal(result.comparison.declaredComparability, 'DECLARED_INCOMPATIBLE');
  assert.deepEqual(result.comparison.incompatibilityReasons, [
    'COST_REFERENCE_CHANGED',
    'CRITERIA_REFERENCE_CHANGED',
    'DATA_IDENTITY_CHANGED',
    'RULES_IDENTITY_CHANGED',
    'STRATEGY_IDENTITY_CHANGED',
    'WINDOW_CHANGED'
  ]);
  assert.equal(result.identity.data.changed, true);
  assert.deepEqual(result.costAndCriteriaReferences.cost.earlier.value, {id: 'cost-1', revision: 1});
  assert.deepEqual(result.costAndCriteriaReferences.criteria.later.value, {id: 'criteria-1', revision: 2});
});

test('same metric value with a different denominator is incompatible and retained side by side', () => {
  const earlier = evidence();
  const later = evidence();
  later.metrics[0].denominator = {value: 20, unit: 'trades'};

  const result = compareStrategyEvidence(earlier, later);
  assert.ok(result.comparison.incompatibilityReasons.includes('METRIC_SEMANTICS_CHANGED:expectancy'));
  const metric = result.metrics.find(item => item.name === 'expectancy');
  assert.equal(metric.value.earlier.value, 0);
  assert.equal(metric.value.later.value, 0);
  assert.deepEqual(metric.denominator.earlier.value, {value: 10, unit: 'trades'});
  assert.deepEqual(metric.denominator.later.value, {value: 20, unit: 'trades'});
});

test('zero, absent, undefined, and null metric values remain distinct', () => {
  const earlier = evidence();
  const later = evidence();
  earlier.metrics = [
    {name: 'zero', value: 0},
    {name: 'absent'},
    {name: 'undefined', value: undefined},
    {name: 'null', value: null}
  ];
  later.metrics = [
    {name: 'zero'},
    {name: 'absent', value: 0},
    {name: 'undefined', value: null},
    {name: 'null', value: undefined}
  ];

  const metrics = compareStrategyEvidence(earlier, later).metrics;
  const valueState = name => metrics.find(metric => metric.name === name).value;
  assert.deepEqual(valueState('zero'), {
    earlier: {state: 'PRESENT', value: 0},
    later: {state: 'ABSENT'}
  });
  assert.deepEqual(valueState('absent'), {
    earlier: {state: 'ABSENT'},
    later: {state: 'PRESENT', value: 0}
  });
  assert.deepEqual(valueState('undefined'), {
    earlier: {state: 'UNDEFINED'},
    later: {state: 'NULL', value: null}
  });
  assert.deepEqual(valueState('null'), {
    earlier: {state: 'NULL', value: null},
    later: {state: 'UNDEFINED'}
  });
});

test('added, removed, and changed failures, unknowns, and holdout-use claims remain visible', () => {
  const earlier = evidence();
  const later = evidence();
  earlier.failures = [{id: 'removed-failure', status: 'FAILED'}, {id: 'changed-failure', status: 'FAILED'}];
  later.failures = [{id: 'added-failure', status: 'FAILED'}, {id: 'changed-failure', status: 'ACKNOWLEDGED'}];
  earlier.unknowns = [
    {id: 'removed-unknown', status: 'UNKNOWN'},
    {id: 'changed-unknown', status: 'UNKNOWN'}
  ];
  later.unknowns = [
    {id: 'added-unknown', status: 'UNKNOWN'},
    {id: 'changed-unknown', status: 'RESOLVED'}
  ];
  earlier.holdoutUseClaims = [
    {id: 'consumed-holdout', use: 'REUSED_FOR_NEW_HYPOTHESIS'},
    {id: 'removed-use', use: 'SELECTION_OR_TUNING'},
    {id: 'changed-use', use: 'FIRST_EXPOSURE'}
  ];
  later.holdoutUseClaims = [
    {id: 'consumed-holdout', use: 'REUSED_FOR_NEW_HYPOTHESIS'},
    {id: 'added-use', use: 'AUDIT'},
    {id: 'changed-use', use: 'REUSED_FOR_NEW_HYPOTHESIS'}
  ];

  const result = compareStrategyEvidence(earlier, later);
  assert.deepEqual(result.failures.added.map(item => item.id), ['added-failure']);
  assert.deepEqual(result.failures.removed.map(item => item.id), ['removed-failure']);
  assert.deepEqual(result.failures.changed.map(item => item.id), ['changed-failure']);
  assert.deepEqual(result.unknowns.added.map(item => item.id), ['added-unknown']);
  assert.deepEqual(result.unknowns.removed.map(item => item.id), ['removed-unknown']);
  assert.deepEqual(result.unknowns.changed.map(item => item.id), ['changed-unknown']);
  assert.deepEqual(result.holdoutUseClaims.added.map(item => item.id), ['added-use']);
  assert.deepEqual(result.holdoutUseClaims.removed.map(item => item.id), ['removed-use']);
  assert.deepEqual(result.holdoutUseClaims.changed.map(item => item.id), ['changed-use']);
  assert.equal(result.holdoutUseClaims.earlierClaimsRemainVisible.length, 3);
  assert.equal(result.holdoutUseClaims.callerClaimedUseInEitherInput, true);
});

test('synthetic and non-synthetic labels are preserved as claims without authenticating either', () => {
  const earlier = evidence();
  const later = evidence();
  later.syntheticFixture = false;

  const result = compareStrategyEvidence(earlier, later);
  assert.deepEqual(result.syntheticFixtureClaims, {
    earlier: {state: 'PRESENT', value: true},
    later: {state: 'PRESENT', value: false}
  });
  assert.equal(result.provenanceVerified, false);
});

test('accessors are rejected without invocation and malformed or oversized objects fail closed', () => {
  let called = false;
  const accessor = evidence();
  Object.defineProperty(accessor, 'strategy', {
    enumerable: true,
    get() {
      called = true;
      throw new Error('must not execute');
    }
  });
  assert.throws(() => compareStrategyEvidence(accessor, evidence()), error => error.code === 'ACCESSOR_OR_HIDDEN_PROPERTY');
  assert.equal(called, false);
  assert.throws(() => compareStrategyEvidence({...evidence(), surprise: true}, evidence()), error => error.code === 'UNKNOWN_EVIDENCE_FIELD');
  assert.throws(() => compareStrategyEvidence({...evidence(), metrics: Array.from({length: COMPARISON_LIMITS.maxArrayItems + 1}, (_, index) => ({name: String(index)}))}, evidence()),
    error => error.code === 'ARRAY_LIMIT_EXCEEDED');

  const tooManyValues = evidence();
  tooManyValues.metrics = Array.from({length: COMPARISON_LIMITS.maxArrayItems}, (_, index) => ({
    name: `metric-${index}`, value: 1, unit: 'ratio',
    denominator: {value: index, unit: 'trades'}, applicability: 'APPLICABLE'
  }));
  assert.throws(() => compareStrategyEvidence(tooManyValues, evidence()), error => error.code === 'OBJECT_LIMIT_EXCEEDED');

  const tooDeep = evidence();
  let nested = {};
  tooDeep.strategy = nested;
  for (let index = 0; index <= COMPARISON_LIMITS.maxDepth; index += 1) {
    nested.child = {};
    nested = nested.child;
  }
  assert.throws(() => compareStrategyEvidence(tooDeep, evidence()), error => error.code === 'DEPTH_LIMIT_EXCEEDED');
});

test('CLI documents usage, accepts exactly two objects, and never echoes invalid input', () => {
  const help = cli('', ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /exactly two evidence objects/);
  assert.equal(help.stderr, '');
  assert.match(USAGE, /offline/);

  const valid = cli(JSON.stringify({earlier: evidence(), later: evidence()}));
  assert.equal(valid.status, 0);
  assert.equal(JSON.parse(valid.stdout).executionAuthorized, false);

  const secretLike = 'caller-private-marker';
  const invalid = cli(JSON.stringify({earlier: secretLike, later: {}}));
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
  assert.doesNotMatch(invalid.stderr, new RegExp(secretLike));
  assert.equal(cli(JSON.stringify({earlier: {}, later: {}, extra: {}})).status, 1);
  assert.equal(cli('{}', ['--unknown']).status, 2);
});

test('CLI enforces exact byte boundary and deterministic serialized output', () => {
  const minimal = '{"earlier":{},"later":{}}';
  const atLimit = minimal + ' '.repeat(COMPARISON_LIMITS.inputBytes - Buffer.byteLength(minimal));
  const accepted = cli(atLimit);
  assert.equal(accepted.status, 0);
  assert.equal(cli(`${atLimit} `).status, 1);

  const input = JSON.stringify({earlier: evidence(), later: evidence()});
  assert.equal(cli(input).stdout, cli(input).stdout);
});
