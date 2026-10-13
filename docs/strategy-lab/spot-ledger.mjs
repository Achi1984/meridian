// Pure offline EUR spot bookkeeping; no I/O, market access, orders, or PnL.
// Callers must supply the complete replay-ID history and trustworthy timestamps.
// Price is EUR micros per whole lot. Lot definitions, FX conversion, provenance,
// and fee authorization are upstream responsibilities, not inferred here.

// Explicit end-of-input assertion: JavaScript "$" also matches before a final
// newline, which would admit noncanonical integer strings or oversized IDs.
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}(?![\s\S])/;
const INTEGER = /^(?:0|[1-9][0-9]{0,29})(?![\s\S])/;
const ID = /^[\x00-\x7f]{1,64}(?![\s\S])/;
const LIMIT = 10n ** 30n - 1n;
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, names) => record(value) && Object.keys(value).length === names.length &&
  names.every(name => Object.hasOwn(value, name));
const integer = value => typeof value === 'string' && INTEGER.test(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const symbol = value => typeof value === 'string' && SYMBOL.test(value);
const id = value => typeof value === 'string' && ID.test(value);
const reject = errors => ({valid:false, errors, account:null,
  executionAuthorized:false, researchOnly:true});

/** Apply one synthetic fill without modifying input. Zero-lot positions drop. */
export function applySpotFill(input) {
  if (!keys(input, ['account', 'fill', 'maxQuoteAgeMs'])) return reject(['INVALID_INPUT_SCHEMA']);
  const {account, fill, maxQuoteAgeMs} = input;
  if (!keys(account, ['currency', 'cashMicros', 'positions', 'processedFillIds'])) {
    return reject(['INVALID_ACCOUNT_SCHEMA']);
  }
  if (!keys(fill, ['id', 'symbol', 'side', 'lots', 'priceMicrosPerLot', 'feeMicros',
    'signalAvailableAtMs', 'quoteAtMs', 'quoteReceivedAtMs', 'fillAtMs'])) {
    return reject(['INVALID_FILL_SCHEMA']);
  }
  const errors = [];
  if (account.currency !== 'EUR') errors.push('ACCOUNT_CURRENCY_MUST_BE_EUR');
  if (!integer(account.cashMicros)) errors.push('INVALID_CASH_MICROS');
  if (!timestamp(maxQuoteAgeMs)) errors.push('INVALID_MAX_QUOTE_AGE');

  const holdings = new Map();
  if (!Array.isArray(account.positions) || account.positions.length > 50) {
    errors.push('INVALID_POSITIONS');
  } else {
    for (const position of account.positions) {
      if (!keys(position, ['symbol', 'lots']) || !symbol(position.symbol) || !integer(position.lots)) {
        errors.push('INVALID_POSITION');
        continue;
      }
      if (holdings.has(position.symbol)) errors.push('DUPLICATE_POSITION_SYMBOL');
      holdings.set(position.symbol, BigInt(position.lots));
    }
  }

  const seen = new Set();
  if (!Array.isArray(account.processedFillIds) || account.processedFillIds.length > 10000) {
    errors.push('INVALID_PROCESSED_FILL_IDS');
  } else {
    for (const processedId of account.processedFillIds) {
      if (!id(processedId)) errors.push('INVALID_PROCESSED_FILL_ID');
      if (seen.has(processedId)) errors.push('DUPLICATE_PROCESSED_FILL_ID');
      seen.add(processedId);
    }
  }
  if (!id(fill.id)) errors.push('INVALID_FILL_ID');
  if (seen.has(fill.id)) errors.push('FILL_ALREADY_PROCESSED');
  if (!symbol(fill.symbol)) errors.push('INVALID_FILL_SYMBOL');
  if (!['BUY', 'SELL'].includes(fill.side)) errors.push('INVALID_FILL_SIDE');
  if (!integer(fill.lots) || fill.lots === '0') errors.push('INVALID_FILL_LOTS');
  if (!integer(fill.priceMicrosPerLot) || fill.priceMicrosPerLot === '0') errors.push('INVALID_PRICE_MICROS_PER_LOT');
  if (!integer(fill.feeMicros)) errors.push('INVALID_FEE_MICROS');

  const times = [fill.signalAvailableAtMs, fill.quoteAtMs, fill.quoteReceivedAtMs, fill.fillAtMs];
  if (!times.every(timestamp)) {
    errors.push('INVALID_FILL_TIMESTAMPS');
  } else {
    if (fill.quoteAtMs <= fill.signalAvailableAtMs) errors.push('QUOTE_NOT_AFTER_SIGNAL');
    if (fill.quoteAtMs > fill.quoteReceivedAtMs || fill.quoteReceivedAtMs > fill.fillAtMs) {
      errors.push('INVALID_EVENT_ORDER');
    }
    if (timestamp(maxQuoteAgeMs) && fill.fillAtMs - fill.quoteAtMs > maxQuoteAgeMs) {
      errors.push('STALE_QUOTE');
    }
  }
  if (errors.length) return reject(errors);
  // Keeping the entire replay history is part of the input contract; never
  // truncate IDs to fit the cap, which could make an old fill replayable.
  if (seen.size === 10000) return reject(['PROCESSED_FILL_ID_CAPACITY']);

  const lots = BigInt(fill.lots), price = BigInt(fill.priceMicrosPerLot), fee = BigInt(fill.feeMicros);
  const cash = BigInt(account.cashMicros), held = holdings.get(fill.symbol) ?? 0n;
  const cost = lots * price;
  let nextCash, nextLots;
  if (fill.side === 'BUY') {
    if (cash < cost + fee) return reject(['INSUFFICIENT_CASH']);
    nextCash = cash - cost - fee;
    nextLots = held + lots;
  } else {
    if (held < lots) return reject(['INSUFFICIENT_POSITION']);
    nextCash = cash + cost - fee;
    nextLots = held - lots;
    if (nextCash < 0n) return reject(['INSUFFICIENT_CASH_FOR_FEE']);
  }
  if (nextCash > LIMIT || nextLots > LIMIT) return reject(['RESULT_AMOUNT_EXCEEDS_30_DIGITS']);
  holdings.set(fill.symbol, nextLots);
  const positions = [...holdings.entries()].filter(([, amount]) => amount > 0n)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([assetSymbol, amount]) => ({symbol:assetSymbol, lots:amount.toString()}));
  if (positions.length > 50) return reject(['RESULT_POSITION_CAPACITY']);
  return {valid:true, errors:[], account:{currency:'EUR', cashMicros:nextCash.toString(),
    positions, processedFillIds:[...account.processedFillIds, fill.id]},
    executionAuthorized:false, researchOnly:true};
}
