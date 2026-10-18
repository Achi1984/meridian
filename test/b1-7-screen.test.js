import test from 'node:test';
import assert from 'node:assert/strict';
import {screenResults} from '../scripts/research/b1-7/engine.mjs';
import {VARIANTS} from '../scripts/research/b1-7/validate.mjs';

// Crafted summary records only: no prices, historical runs, or strategy evidence.
const frozen = {status: 'FROZEN_DEVELOPMENT_ONLY'};
const primary = 'primary-n30-f25';
const base = 'base-15bp';
const stress = 'stress-30bp';
const delay = 'stress-30bp-delay-1d';
function fixture() {
  const paths = [];
  const add = (variantId, scenarioId, netReturn = 0.2, sampledDrawdown = 0.25) =>
    paths.push({variantId, scenarioId, segmentId: 'diagnostic', status: 'COMPLETED',
      netReturn, sampledDrawdown});
  add(primary, base);
  add(primary, stress);
  add(primary, delay);
  add('full-basket-weekly', base, 0.3, 0.3125);
  add('frozen-mean-exposure', base);
  add('frozen-risk-exposure', base);
  for (const variant of VARIANTS.slice(1)) {
    add(variant.id, base);
    add(variant.id, stress);
    add(variant.id, delay, -1); // delayed neighbours are deliberately report-only
  }
  return paths;
}
const find = (paths, id = primary, scenario = base) =>
  paths.find(path => path.variantId === id && path.scenarioId === scenario &&
    path.segmentId === 'diagnostic');

test('crafted screen passes inclusive drawdown, relative reduction and control boundaries', () => {
  const paths = fixture();
  const original = structuredClone(paths);
  const result = screenResults(paths, frozen);
  assert.equal(result.status, 'PASS');
  assert.equal(result.relativeDrawdownReduction, 0.20);
  assert.equal(Object.values(result.checks).every(Boolean), true);
  assert.equal(result.interpretation, 'HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT');
  assert.deepEqual(paths, original);
});

const failingCases = [
  ['primary net zero', p => { find(p).netReturn = 0; }, 'primaryDiagnosticNetPositive'],
  ['drawdown above 25%', p => { find(p).sampledDrawdown = 0.25 + Number.EPSILON; }, 'primaryDiagnosticDrawdownAtMost25Percent'],
  ['relative reduction below 20%', p => { find(p, 'full-basket-weekly').sampledDrawdown = 0.3125 - Number.EPSILON; }, 'relativeDrawdownReductionAtLeast20Percent'],
  ['return below mean control', p => { find(p, 'frozen-mean-exposure').netReturn = 0.2 + Number.EPSILON; }, 'primaryReturnAtLeastBothFrozenControls'],
  ['return below risk control', p => { find(p, 'frozen-risk-exposure').netReturn = 0.2 + Number.EPSILON; }, 'primaryReturnAtLeastBothFrozenControls'],
  ['drawdown worse than mean control', p => { find(p, 'frozen-mean-exposure').sampledDrawdown = 0.25 - Number.EPSILON; }, 'primaryDrawdownAtMostBothFrozenControls'],
  ['drawdown worse than risk control', p => { find(p, 'frozen-risk-exposure').sampledDrawdown = 0.25 - Number.EPSILON; }, 'primaryDrawdownAtMostBothFrozenControls'],
  ['non-delayed primary stress zero', p => { find(p, primary, stress).netReturn = 0; }, 'primaryNetPositiveAt30bpNonDelayed'],
  ['delayed primary stress zero', p => { find(p, primary, delay).netReturn = 0; }, 'primaryNetPositiveAt30bpPlusDelay']
];
for (const [name, mutate, check] of failingCases) {
  test(`crafted screen returns NO_EDGE: ${name}`, () => {
    const paths = fixture();
    mutate(paths);
    const result = screenResults(paths, frozen);
    assert.equal(result.status, 'NO_EDGE');
    assert.equal(result.checks[check], false);
  });
}

test('primary positivity is strict zero boundary without an epsilon', () => {
  const paths = fixture();
  find(paths).netReturn = Number.MIN_VALUE;
  for (const id of ['frozen-mean-exposure', 'frozen-risk-exposure']) find(paths, id).netReturn = 0;
  assert.equal(screenResults(paths, frozen).status, 'PASS');
});

test('full-basket drawdown at zero or denominator cutoff is insufficient evidence', () => {
  for (const value of [0, 1e-12]) {
    const paths = fixture();
    find(paths, 'full-basket-weekly').sampledDrawdown = value;
    const result = screenResults(paths, frozen);
    assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.relativeDrawdownReduction, null);
    assert.equal(result.checks.fullBasketDrawdownDenominator, false);
  }
  const paths = fixture();
  find(paths).sampledDrawdown = 0;
  find(paths, 'full-basket-weekly').sampledDrawdown = 1e-12 + Number.EPSILON;
  assert.equal(screenResults(paths, frozen).status, 'PASS');
});

test('neighbour counts require three independently at 15bp and non-delayed 30bp', () => {
  const paths = fixture();
  find(paths, VARIANTS[1].id, base).netReturn = 0;
  find(paths, VARIANTS[2].id, stress).netReturn = -0.1;
  const pass = screenResults(paths, frozen);
  assert.equal(pass.status, 'PASS');
  assert.deepEqual(pass.neighbourPositiveCounts, {base15bp: 3, stress30bp: 3});
  for (const scenario of [base, stress]) {
    const changed = structuredClone(paths);
    find(changed, VARIANTS[3].id, scenario).netReturn = 0;
    const result = screenResults(changed, frozen);
    assert.equal(result.status, 'NO_EDGE');
    assert.equal(result.checks.atLeastThreeOfFourNeighboursPositiveAt15bp, scenario !== base);
    assert.equal(result.checks.atLeastThreeOfFourNeighboursPositiveAt30bpNonDelayed, scenario !== stress);
  }
});

test('development summaries and delayed neighbour outcomes cannot substitute for diagnostic evidence', () => {
  const paths = fixture();
  paths.unshift(...structuredClone(paths).map(path => ({...path,
    segmentId: 'development', netReturn: -100, sampledDrawdown: 1})));
  assert.equal(screenResults(paths, frozen).status, 'PASS');
  const withoutDelayedNeighbours = paths.filter(path =>
    !(path.scenarioId === delay && path.variantId !== primary));
  assert.equal(screenResults(withoutDelayedNeighbours, frozen).status, 'PASS');
});

test('every required missing, unfinished or nonfinite diagnostic path fails closed', () => {
  const paths = fixture();
  const required = paths.filter(path => !(path.scenarioId === delay && path.variantId !== primary));
  for (const target of required) {
    for (const mutation of ['missing', 'unfinished', 'nonfinite-return', 'nonfinite-drawdown']) {
      const changed = structuredClone(paths);
      const index = changed.findIndex(path => path.variantId === target.variantId && path.scenarioId === target.scenarioId);
      if (mutation === 'missing') changed.splice(index, 1);
      else if (mutation === 'unfinished') changed[index].status = 'INCOMPLETE_BATCH_ABORT';
      else if (mutation === 'nonfinite-return') changed[index].netReturn = NaN;
      else changed[index].sampledDrawdown = Infinity;
      assert.equal(screenResults(changed, frozen).status, 'INSUFFICIENT_EVIDENCE',
        `${target.variantId}/${target.scenarioId}/${mutation}`);
    }
  }
  for (const controls of [null, {}, {status: 'NOT_CALIBRATED'}]) {
    assert.equal(screenResults(paths, controls).status, 'INSUFFICIENT_EVIDENCE');
  }
});
