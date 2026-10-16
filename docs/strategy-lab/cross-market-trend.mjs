// Pure offline research baseline. Caller must supply historically available,
// comparable total-return indices with verified provenance; this module cannot
// establish when a vendor published/revised an observation. No execution path.

const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const plainObject = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plainObject(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const positiveFinite = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function monthNumber(value) {
  if (typeof value !== 'string') return null;
  const match = MONTH.exec(value);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}

function rejected(errors) {
  return {valid:false, errors, signals:[], cashWeight:1,
    executionAuthorized:false, researchOnly:true};
}

/**
 * Equal, fixed sleeves across the complete supplied universe. A positive
 * last/first - 1 over thirteen consecutive monthly closes receives LONG 1/N;
 * otherwise that sleeve remains cash. This is a signal, not an execution,
 * profitability, net-CRV, liquidity, or risk-validation decision.
 */
export function evaluateCrossMarketTrend(input) {
  if (!exactKeys(input, ['asOfMonth', 'assets'])) return rejected(['INVALID_INPUT_SCHEMA']);
  const asOf = monthNumber(input.asOfMonth);
  if (asOf === null) return rejected(['INVALID_AS_OF_MONTH']);
  if (!Array.isArray(input.assets) || input.assets.length < 1 || input.assets.length > 20) {
    return rejected(['INVALID_ASSET_COUNT']);
  }

  const errors = [], symbols = new Set(), observations = [];
  for (let index = 0; index < input.assets.length; index++) {
    const asset = input.assets[index], prefix = `ASSET_${index}`;
    if (!exactKeys(asset, ['symbol', 'months', 'totalReturnIndex'])) {
      errors.push(`${prefix}:INVALID_SCHEMA`);
      continue;
    }
    if (typeof asset.symbol !== 'string' || !SYMBOL.test(asset.symbol)) {
      errors.push(`${prefix}:INVALID_SYMBOL`);
    } else if (symbols.has(asset.symbol)) {
      errors.push(`${prefix}:DUPLICATE_SYMBOL`);
    } else {
      symbols.add(asset.symbol);
    }
    if (!Array.isArray(asset.months) || asset.months.length !== 13 ||
        !Array.isArray(asset.totalReturnIndex) || asset.totalReturnIndex.length !== 13) {
      errors.push(`${prefix}:REQUIRES_THIRTEEN_MONTHLY_CLOSES`);
      continue;
    }

    let validHistory = true;
    for (let offset = 0; offset < 13; offset++) {
      const month = monthNumber(asset.months[offset]);
      // Requiring each exact calendar month also rejects gaps, duplicates,
      // reversed histories, stale endpoints, and current/future observations.
      if (month === null || month !== asOf - 13 + offset) {
        errors.push(`${prefix}:INVALID_MONTH_SEQUENCE`);
        validHistory = false;
        break;
      }
    }
    for (let offset = 0; offset < 13; offset++) {
      if (!positiveFinite(asset.totalReturnIndex[offset])) {
        errors.push(`${prefix}:INVALID_TOTAL_RETURN_INDEX`);
        validHistory = false;
        break;
      }
    }
    if (!validHistory) continue;
    const ratio = asset.totalReturnIndex[12] / asset.totalReturnIndex[0];
    const twelveMonthReturn = ratio - 1;
    if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(twelveMonthReturn)) {
      errors.push(`${prefix}:UNREPRESENTABLE_RETURN`);
      continue;
    }
    observations.push({symbol:asset.symbol, lookbackStartMonth:asset.months[0],
      lookbackEndMonth:asset.months[12], twelveMonthReturn});
  }
  if (errors.length) return rejected(errors);

  const sleeveCount = observations.length;
  const positiveCount = observations.filter(asset => asset.twelveMonthReturn > 0).length;
  const signals = observations.map(asset => ({...asset,
    decision:asset.twelveMonthReturn > 0 ? 'LONG' : 'CASH',
    weight:asset.twelveMonthReturn > 0 ? 1 / sleeveCount : 0}));
  // Count-based cash avoids accumulating binary floating-point weight error;
  // the exact allocation is positiveCount/N long plus (N-positiveCount)/N cash.
  return {valid:true, errors:[], signals, cashWeight:(sleeveCount-positiveCount)/sleeveCount,
    executionAuthorized:false, researchOnly:true};
}
