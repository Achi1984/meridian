import test from 'node:test';
import assert from 'node:assert/strict';
import {composeX1Input} from '../docs/strategy-lab/x1-input-composition.mjs';
import {evaluateCrossMarketTrend} from '../docs/strategy-lab/cross-market-trend.mjs';

const UNIVERSE = [
  ['EQUITY', 'IE00B4L5Y983'],
  ['BONDS', 'IE00B4WXJJ64'],
  ['GOLD', 'IE00B4ND3602'],
  ['COMMODITIES', 'IE00BDFL4P12']
];
const DECISION_AT = '2024-03-01T00:00:00.000Z';
const AS_OF_MONTH = '2024-03';
const SNAPSHOT_AT = DECISION_AT;
const monthAt = offset => {
  const date = new Date(Date.UTC(2024, 2 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

function makeInput() {
  return {
    decisionAt:DECISION_AT,
    asOfMonth:AS_OF_MONTH,
    snapshotAt:SNAPSHOT_AT,
    assets:UNIVERSE.map(([symbol, isin], assetIndex) => ({
      symbol,
      isin,
      observations:Array.from({length:13}, (_, observationIndex) => ({
        month:monthAt(observationIndex - 13),
        totalReturnIndex:100 + observationIndex * (assetIndex === 0 ? 1 : 0),
        final:true,
        publishedAt:DECISION_AT,
        availability:{
          kind:'MEASURED_RECEIPT',
          receivedAt:DECISION_AT
        }
      }))
    }))
  };
}

function coreInput(input) {
  return {
    asOfMonth:input.asOfMonth,
    assets:input.assets.map(asset => ({
      symbol:asset.symbol,
      months:asset.observations.map(observation => observation.month),
      totalReturnIndex:asset.observations.map(observation => observation.totalReturnIndex)
    }))
  };
}

test('accepts the exact thirteen-month sequence across year and leap-month boundaries', () => {
  const input = makeInput();
  assert.deepEqual(input.assets[0].observations.map(observation => observation.month), [
    '2023-02', '2023-03', '2023-04', '2023-05', '2023-06', '2023-07',
    '2023-08', '2023-09', '2023-10', '2023-11', '2023-12', '2024-01', '2024-02'
  ]);
  assert.equal(composeX1Input(input).valid, true);
  input.decisionAt = '2024-02-29T23:59:59.999Z';
  const beforeBoundary = composeX1Input(input);
  assert.equal(beforeBoundary.valid, false);
  assert.ok(beforeBoundary.errors.includes('AS_OF_MONTH_MUST_MATCH_DECISION_MONTH'));
});

test('requires thirteen observations and rejects any incomplete history as a whole', () => {
  const input = makeInput();
  input.assets[2].observations.pop();
  const result = composeX1Input(input);
  assert.equal(result.valid, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.cashWeight, 1);
  assert.ok(result.errors.includes('ASSET_2:REQUIRES_THIRTEEN_OBSERVATIONS'));
});

test('preserves the baseline positive-only fixed-sleeve signal including equality and losses', () => {
  const input = makeInput();
  input.assets[1].observations[12].totalReturnIndex = 100;
  input.assets[2].observations[12].totalReturnIndex = 99;
  const result = composeX1Input(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.signals.map(asset => asset.decision), ['LONG', 'CASH', 'CASH', 'CASH']);
  assert.deepEqual(result.signals.map(asset => asset.weight), [0.25, 0, 0, 0]);
  assert.equal(result.cashWeight, 0.75);
});

test('requires all four exact symbol and ISIN identities without inferring products', () => {
  for (const mutate of [
    input => { input.assets[0].isin = 'IE00B4WXJJ64'; },
    input => { input.assets[0].symbol = 'UNKNOWN'; },
    input => { input.assets[0].isin = ''; }
  ]) {
    const input = makeInput();
    mutate(input);
    const result = composeX1Input(input);
    assert.equal(result.valid, false);
    assert.deepEqual(result.signals, []);
  }

  const duplicate = makeInput();
  duplicate.assets[3] = structuredClone(duplicate.assets[2]);
  assert.ok(composeX1Input(duplicate).errors.some(error => error.includes('DUPLICATE')));

  const extra = makeInput();
  extra.assets.push(structuredClone(extra.assets[0]));
  assert.ok(composeX1Input(extra).errors.includes('REQUIRES_FIXED_FOUR_ASSETS'));

  const missing = makeInput();
  missing.assets.pop();
  const missingResult = composeX1Input(missing);
  assert.ok(missingResult.errors.includes('REQUIRES_FIXED_FOUR_ASSETS'));
  assert.ok(missingResult.errors.includes('MISSING_REQUIRED_ASSET:COMMODITIES'));
});

test('rejects duplicate, gapped, nonfinal, and nonfinite observations', () => {
  const changes = [
    input => { input.assets[0].observations[3].month = input.assets[0].observations[2].month; },
    input => { input.assets[1].observations[4].month = '2024-04'; },
    input => { input.assets[2].observations[5].final = false; },
    input => { input.assets[3].observations[6].totalReturnIndex = Infinity; }
  ];
  const expected = [
    'INVALID_MONTH_SEQUENCE',
    'INVALID_MONTH_SEQUENCE',
    'NONFINAL_MONTH',
    'INVALID_TOTAL_RETURN_INDEX'
  ];
  changes.forEach((mutate, index) => {
    const input = makeInput();
    mutate(input);
    const result = composeX1Input(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes(expected[index])));
    assert.deepEqual(result.signals, []);
  });
});

test('rejects publication or availability before an observation month is complete', () => {
  const beforeMonthEnd = '2024-02-29T23:59:59.999Z';
  const unpublished = makeInput();
  unpublished.assets[0].observations[12].publishedAt = beforeMonthEnd;
  assert.ok(composeX1Input(unpublished).errors.includes(
    'ASSET_0:OBSERVATION_12:PUBLICATION_PRECEDES_MONTH_COMPLETION'));

  const unreceived = makeInput();
  unreceived.assets[1].observations[12].availability.receivedAt = beforeMonthEnd;
  assert.ok(composeX1Input(unreceived).errors.includes(
    'ASSET_1:OBSERVATION_12:AVAILABILITY_PRECEDES_MONTH_COMPLETION'));
});

test('rejects an entirely invalid basket without selecting a surviving subset', () => {
  const input = makeInput();
  for (const asset of input.assets) {
    for (const observation of asset.observations) {
      observation.final = false;
    }
  }
  const result = composeX1Input(input);
  assert.equal(result.valid, false);
  assert.deepEqual(result.signals, []);
  assert.equal(result.cashWeight, 1);
  assert.equal(result.selectionActionable, false);
  assert.equal(result.errors.filter(error => error.endsWith(':NONFINAL_MONTH')).length, 52);
});

test('rejects future publication, receipt, and snapshot timestamps', () => {
  const cases = [
    [input => { input.assets[0].observations[0].publishedAt = '2024-03-01T00:00:00.001Z'; },
      'FUTURE_PUBLICATION'],
    [input => { input.assets[1].observations[1].availability.receivedAt =
      '2024-03-01T00:00:00.001Z'; }, 'FUTURE_RECEIPT'],
    [input => { input.snapshotAt = '2024-03-01T00:00:00.001Z'; }, 'FUTURE_SNAPSHOT']
  ];
  for (const [mutate, expected] of cases) {
    const input = makeInput();
    mutate(input);
    const result = composeX1Input(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes(expected)));
  }
});

test('labels historical availability assumptions without upgrading them to measured receipts', () => {
  const input = makeInput();
  for (const asset of input.assets) {
    for (const observation of asset.observations) {
      observation.availability = {
        kind:'HISTORICAL_ASSUMPTION',
        assumedAvailableAt:DECISION_AT
      };
    }
  }
  const result = composeX1Input(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.provenance.receiptEvidence, ['EXPLICIT_HISTORICAL_ASSUMPTION']);
  assert.equal(result.provenance.independentlyVerified, false);

  input.assets[0].observations[0].availability = {
    kind:'HISTORICAL_ASSUMPTION',
    assumedAvailableAt:'2024-03-01T00:00:00.001Z'
  };
  assert.ok(composeX1Input(input).errors.includes(
    'ASSET_0:OBSERVATION_0:FUTURE_ASSUMED_AVAILABILITY'));
});

test('rejects malformed chronology and snapshot timestamps', () => {
  const input = makeInput();
  input.assets[0].observations[0].availability.receivedAt = '2024-01-31T23:59:59.000Z';
  input.snapshotAt = '2024-01-31T23:59:58.000Z';
  const result = composeX1Input(input);
  assert.ok(result.errors.includes('ASSET_0:OBSERVATION_0:AVAILABILITY_PRECEDES_PUBLICATION'));
  assert.ok(result.errors.includes('ASSET_0:OBSERVATION_0:SNAPSHOT_PRECEDES_AVAILABILITY'));

  const invalidTime = makeInput();
  invalidTime.snapshotAt = '2024-02-30T00:00:00.000Z';
  assert.ok(composeX1Input(invalidTime).errors.includes('INVALID_SNAPSHOT_TIME'));
});

test('does not mutate caller data and returns deterministic detached results', () => {
  const input = makeInput();
  const before = structuredClone(input);
  const first = composeX1Input(input);
  const second = composeX1Input(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  input.assets[0].observations[12].totalReturnIndex = 100000;
  assert.ok(Math.abs(first.signals[0].twelveMonthReturn - 0.12) < 1e-12);
  first.signals[0].decision = 'MUTATED';
  assert.deepEqual(second, composeX1Input(before));
});

test('matches unchanged evaluator output and never grants execution or empirical authority', () => {
  const input = makeInput();
  const result = composeX1Input(input);
  const baseline = evaluateCrossMarketTrend(coreInput(input));
  assert.deepEqual(result.signals, baseline.signals);
  assert.equal(result.cashWeight, baseline.cashWeight);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.selectionActionable, false);
  assert.equal(result.empiricalAuthorization, false);
  assert.equal(result.campaignRegistrationInferred, false);
  assert.equal(result.remainingTrialBudgetInferred, false);
  assert.equal(result.provenance.independentlyVerified, false);
  assert.ok(result.provenance.limitations.length > 0);

  const invalid = makeInput();
  invalid.assets[0].observations[0].totalReturnIndex = NaN;
  const rejected = composeX1Input(invalid);
  assert.deepEqual(rejected.signals, []);
  assert.equal(rejected.executionAuthorized, false);
  assert.equal(rejected.empiricalAuthorization, false);
});
