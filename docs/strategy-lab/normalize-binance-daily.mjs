// Pure normalizer for explicitly supplied Binance spot daily archive rows.
// No CSV parsing, I/O, FX conversion, strategy evaluation, or execution.
// Publication availability is caller evidence (for example actual retrieval
// time), never inferred from bar close. Unconsumed cells 7..11 remain opaque.

const DAY_MS = 86400000n;
const MICROSECOND_REGIME_MS = 1735689600000n; // 2025-01-01T00:00:00Z.
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const TIMESTAMP = /^(?:0|[1-9][0-9]*)(?![\s\S])/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?![\s\S])/;
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, names) => record(value) && Object.keys(value).length === names.length &&
  names.every(name => Object.hasOwn(value, name));
const safeTime = value => Number.isSafeInteger(value) && value >= 0;
const rejected = errors => ({valid:false, errors, bars:[], executionAuthorized:false, researchOnly:true});

function decimal(value, positive) {
  if (!DECIMAL.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0)) return null;
  return number;
}

export function normalizeBinanceDaily(input) {
  if (!exactKeys(input, ['rows', 'timestampUnit', 'availableAtMs', 'asOfMs'])) {
    return rejected(['INVALID_INPUT_SCHEMA']);
  }
  const {rows, timestampUnit, availableAtMs, asOfMs} = input;
  if (timestampUnit !== 'ms' && timestampUnit !== 'us') return rejected(['INVALID_TIMESTAMP_UNIT']);
  if (!safeTime(asOfMs)) return rejected(['INVALID_AS_OF_TIME']);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10000) return rejected(['INVALID_ROW_COUNT']);
  if (!Array.isArray(availableAtMs) || availableAtMs.length !== rows.length) {
    return rejected(['INVALID_AVAILABILITY_COUNT']);
  }

  const scale = timestampUnit === 'us' ? 1000n : 1n;
  const bars = [], errors = [];
  let previousOpen = null, previousAvailable = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], prefix = `ROW_${index}`;
    if (!Array.isArray(row) || row.length !== 12) {
      errors.push(`${prefix}:INVALID_COLUMN_COUNT`);
      continue;
    }
    let validCells = true;
    for (let column = 0; column < 12; column++) {
      if (typeof row[column] !== 'string' || row[column].length > 128) {
        validCells = false;
        break;
      }
    }
    if (!validCells) {
      errors.push(`${prefix}:INVALID_CELL_TYPE_OR_LENGTH`);
      continue;
    }
    if (!TIMESTAMP.test(row[0]) || !TIMESTAMP.test(row[6])) {
      errors.push(`${prefix}:INVALID_TIMESTAMP_STRING`);
      continue;
    }
    const rawOpen = BigInt(row[0]), rawClose = BigInt(row[6]);
    if (rawOpen % scale !== 0n) {
      errors.push(`${prefix}:INEXACT_OPEN_TIMESTAMP`);
      continue;
    }
    const open = rawOpen / scale, exclusiveClose = open + DAY_MS;
    if (open > MAX_SAFE || exclusiveClose > MAX_SAFE || open % DAY_MS !== 0n) {
      errors.push(`${prefix}:INVALID_DAILY_OPEN`);
      continue;
    }
    if (rawClose !== rawOpen + DAY_MS * scale - 1n) {
      errors.push(`${prefix}:INVALID_INCLUSIVE_CLOSE`);
      continue;
    }
    if ((open >= MICROSECOND_REGIME_MS ? 'us' : 'ms') !== timestampUnit) {
      errors.push(`${prefix}:TIMESTAMP_UNIT_REGIME_MISMATCH`);
      continue;
    }
    if (previousOpen !== null && open !== previousOpen + DAY_MS) errors.push(`${prefix}:NONCONTIGUOUS_DAILY_ROWS`);
    previousOpen = open;

    const available = availableAtMs[index];
    if (!safeTime(available) || available < Number(exclusiveClose) || available > asOfMs) {
      errors.push(`${prefix}:INVALID_AVAILABILITY_TIME`);
    }
    if (safeTime(available)) {
      if (previousAvailable !== null && available < previousAvailable) errors.push(`${prefix}:DECREASING_AVAILABILITY`);
      previousAvailable = available;
    }

    const priceOpen = decimal(row[1], true), high = decimal(row[2], true);
    const low = decimal(row[3], true), close = decimal(row[4], true), volume = decimal(row[5], false);
    if ([priceOpen, high, low, close, volume].some(value => value === null)) {
      errors.push(`${prefix}:INVALID_OHLCV_DECIMAL`);
      continue;
    }
    if (high < Math.max(priceOpen, low, close) || low > Math.min(priceOpen, high, close)) {
      errors.push(`${prefix}:INCONSISTENT_OHLC`);
      continue;
    }
    bars.push({openTimeMs:Number(open), closeTimeMs:Number(exclusiveClose),
      open:priceOpen, high, low, close, volume, availableAtMs:available});
  }
  if (errors.length) return rejected(errors);
  return {valid:true, errors:[], bars, executionAuthorized:false, researchOnly:true};
}
