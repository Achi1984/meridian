import {evaluateCrossMarketTrend} from './cross-market-trend.mjs';

const UNIVERSE = Object.freeze([
  Object.freeze({symbol:'EQUITY', isin:'IE00B4L5Y983'}),
  Object.freeze({symbol:'BONDS', isin:'IE00B4WXJJ64'}),
  Object.freeze({symbol:'GOLD', isin:'IE00B4ND3602'}),
  Object.freeze({symbol:'COMMODITIES', isin:'IE00BDFL4P12'})
]);
const BY_SYMBOL = new Map(UNIVERSE.map(asset => [asset.symbol, asset]));
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const PROVENANCE_LIMITATIONS = Object.freeze([
  'Caller-supplied identities, values, finality, timestamps, and evidence labels are not independently verified.',
  'Feed and venue, revision history, product adjustments, FX, distributions, fills, costs, and portfolio accounting remain unresolved.'
]);

const plainObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plainObject(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const monthNumber = value => {
  if (typeof value !== 'string') return null;
  const match = MONTH.exec(value);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
};

function monthCompletionTime(value) {
  const match = typeof value === 'string' ? MONTH.exec(value) : null;
  if (!match) return null;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]), 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  const expectedMilliseconds = Number((match[7] ?? '').padEnd(3, '0') || 0);
  if (date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() + 1 !== Number(match[2]) ||
      date.getUTCDate() !== Number(match[3]) ||
      date.getUTCHours() !== Number(match[4]) ||
      date.getUTCMinutes() !== Number(match[5]) ||
      date.getUTCSeconds() !== Number(match[6]) ||
      date.getUTCMilliseconds() !== expectedMilliseconds) return null;
  return milliseconds;
}

function result({valid, errors, signals = [], cashWeight = 1, decisionAt = null,
  snapshotAt = null, receiptEvidence = []}) {
  return {
    valid,
    errors,
    signals,
    cashWeight,
    decisionAt,
    snapshotAt,
    provenance: {
      receiptEvidence: [...new Set(receiptEvidence)].sort(),
      independentlyVerified: false,
      limitations: [...PROVENANCE_LIMITATIONS]
    },
    executionAuthorized: false,
    selectionActionable: false,
    researchOnly: true,
    campaignRegistrationInferred: false,
    remainingTrialBudgetInferred: false,
    empiricalAuthorization: false
  };
}

function reject(errors, receiptEvidence = []) {
  return result({valid:false, errors:[...new Set(errors)], receiptEvidence});
}

export function composeX1Input(input) {
  if (!exactKeys(input, ['decisionAt', 'asOfMonth', 'snapshotAt', 'assets'])) {
    return reject(['INVALID_INPUT_SCHEMA']);
  }

  const errors = [];
  const decisionTime = timestamp(input.decisionAt);
  const decisionMonth = decisionTime === null ? null : monthNumber(input.decisionAt.slice(0, 7));
  const asOfMonth = monthNumber(input.asOfMonth);
  if (decisionTime === null) errors.push('INVALID_DECISION_TIME');
  if (asOfMonth === null) errors.push('INVALID_AS_OF_MONTH');
  else if (decisionMonth !== null && asOfMonth !== decisionMonth) {
    errors.push('AS_OF_MONTH_MUST_MATCH_DECISION_MONTH');
  }

  const snapshotTime = timestamp(input.snapshotAt);
  if (snapshotTime === null) errors.push('INVALID_SNAPSHOT_TIME');
  else if (decisionTime !== null && snapshotTime > decisionTime) {
    errors.push('FUTURE_SNAPSHOT');
  }

  if (!Array.isArray(input.assets)) return reject([...errors, 'INVALID_ASSET_LIST']);
  if (input.assets.length !== UNIVERSE.length) errors.push('REQUIRES_FIXED_FOUR_ASSETS');

  const seenSymbols = new Set();
  const seenIsins = new Set();
  const receiptEvidence = new Set();
  const coreAssets = [];

  for (let assetIndex = 0; assetIndex < input.assets.length; assetIndex++) {
    const asset = input.assets[assetIndex];
    const prefix = `ASSET_${assetIndex}`;
    if (!exactKeys(asset, ['symbol', 'isin', 'observations'])) {
      errors.push(`${prefix}:INVALID_SCHEMA`);
      continue;
    }

    if (typeof asset.symbol !== 'string' || !BY_SYMBOL.has(asset.symbol)) {
      errors.push(`${prefix}:UNEXPECTED_SYMBOL`);
    } else if (seenSymbols.has(asset.symbol)) {
      errors.push(`${prefix}:DUPLICATE_SYMBOL`);
    } else {
      seenSymbols.add(asset.symbol);
      if (asset.isin !== BY_SYMBOL.get(asset.symbol).isin) {
        errors.push(`${prefix}:IDENTITY_MISMATCH`);
      }
    }
    if (typeof asset.isin === 'string') {
      if (seenIsins.has(asset.isin)) errors.push(`${prefix}:DUPLICATE_ISIN`);
      seenIsins.add(asset.isin);
    } else {
      errors.push(`${prefix}:INVALID_ISIN`);
    }

    if (!Array.isArray(asset.observations) || asset.observations.length !== 13) {
      errors.push(`${prefix}:REQUIRES_THIRTEEN_OBSERVATIONS`);
      continue;
    }

    const months = [];
    const totalReturnIndex = [];
    for (let observationIndex = 0; observationIndex < asset.observations.length; observationIndex++) {
      const observation = asset.observations[observationIndex];
      const observationPrefix = `${prefix}:OBSERVATION_${observationIndex}`;
      if (!exactKeys(observation,
        ['month', 'totalReturnIndex', 'final', 'publishedAt', 'availability'])) {
        errors.push(`${observationPrefix}:INVALID_SCHEMA`);
        continue;
      }

      const observedMonth = monthNumber(observation.month);
      const monthCompletedAt = monthCompletionTime(observation.month);
      if (observedMonth === null) {
        errors.push(`${observationPrefix}:INVALID_MONTH`);
      } else if (asOfMonth !== null && observedMonth !== asOfMonth - 13 + observationIndex) {
        errors.push(`${observationPrefix}:INVALID_MONTH_SEQUENCE`);
      }
      if (observation.final !== true) errors.push(`${observationPrefix}:NONFINAL_MONTH`);
      if (typeof observation.totalReturnIndex !== 'number' ||
          !Number.isFinite(observation.totalReturnIndex) || observation.totalReturnIndex <= 0) {
        errors.push(`${observationPrefix}:INVALID_TOTAL_RETURN_INDEX`);
      }

      const publishedTime = timestamp(observation.publishedAt);
      if (publishedTime === null) errors.push(`${observationPrefix}:INVALID_PUBLICATION_TIME`);
      else if (decisionTime !== null && publishedTime > decisionTime) {
        errors.push(`${observationPrefix}:FUTURE_PUBLICATION`);
      }
      if (publishedTime !== null && monthCompletedAt !== null &&
          publishedTime < monthCompletedAt) {
        errors.push(`${observationPrefix}:PUBLICATION_PRECEDES_MONTH_COMPLETION`);
      }

      let availableTime = null;
      const availability = observation.availability;
      if (plainObject(availability) && availability.kind === 'MEASURED_RECEIPT' &&
          exactKeys(availability, ['kind', 'receivedAt'])) {
        receiptEvidence.add('CALLER_ASSERTED_MEASURED_RECEIPT');
        availableTime = timestamp(availability.receivedAt);
        if (availableTime === null) {
          errors.push(`${observationPrefix}:INVALID_RECEIPT_TIME`);
        } else if (decisionTime !== null && availableTime > decisionTime) {
          errors.push(`${observationPrefix}:FUTURE_RECEIPT`);
        }
      } else if (plainObject(availability) && availability.kind === 'HISTORICAL_ASSUMPTION' &&
          exactKeys(availability, ['kind', 'assumedAvailableAt'])) {
        receiptEvidence.add('EXPLICIT_HISTORICAL_ASSUMPTION');
        availableTime = timestamp(availability.assumedAvailableAt);
        if (availableTime === null) {
          errors.push(`${observationPrefix}:INVALID_ASSUMED_AVAILABILITY_TIME`);
        } else if (decisionTime !== null && availableTime > decisionTime) {
          errors.push(`${observationPrefix}:FUTURE_ASSUMED_AVAILABILITY`);
        }
      } else {
        errors.push(`${observationPrefix}:INVALID_AVAILABILITY_EVIDENCE`);
      }

      if (publishedTime !== null && availableTime !== null && availableTime < publishedTime) {
        errors.push(`${observationPrefix}:AVAILABILITY_PRECEDES_PUBLICATION`);
      }
      if (availableTime !== null && monthCompletedAt !== null &&
          availableTime < monthCompletedAt) {
        errors.push(`${observationPrefix}:AVAILABILITY_PRECEDES_MONTH_COMPLETION`);
      }
      if (snapshotTime !== null && availableTime !== null && availableTime > snapshotTime) {
        errors.push(`${observationPrefix}:SNAPSHOT_PRECEDES_AVAILABILITY`);
      }

      months.push(observation.month);
      totalReturnIndex.push(observation.totalReturnIndex);
    }
    coreAssets.push({symbol:asset.symbol, months, totalReturnIndex});
  }

  for (const expected of UNIVERSE) {
    if (!seenSymbols.has(expected.symbol)) errors.push(`MISSING_REQUIRED_ASSET:${expected.symbol}`);
  }
  if (errors.length) return reject(errors, [...receiptEvidence]);

  const signal = evaluateCrossMarketTrend({asOfMonth:input.asOfMonth, assets:coreAssets});
  if (!signal.valid) {
    return reject(signal.errors.map(error => `SIGNAL_VALIDATION_FAILED:${error}`),
      [...receiptEvidence]);
  }

  return result({
    valid:true,
    errors:[],
    signals:signal.signals.map(asset => ({...asset})),
    cashWeight:signal.cashWeight,
    decisionAt:input.decisionAt,
    snapshotAt:input.snapshotAt,
    receiptEvidence:[...receiptEvidence]
  });
}
