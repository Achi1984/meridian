// Pure exact arithmetic only: no market access, orders, sizing defaults or PnL.
const INTEGER = /^(?:0|[1-9][0-9]{0,29})(?![\s\S])/;
const LIMIT = 10n ** 30n - 1n;
const AMOUNTS = ['cashMicros', 'riskBudgetMicros', 'remainingExposureMicros',
  'entryPriceMicrosPerLot', 'stressedExitPriceMicrosPerLot'];
const FIELDS = ['currency', ...AMOUNTS, 'feeBps'];
const flags = {executionAuthorized:false, researchOnly:true};
const reject = error => ({valid:false, candidate:false, errors:[error], sizing:null, ...flags});
const fee = (notional, bps) => (notional * bps + 9999n) / 10000n;

/** Largest whole-lot long-spot entry satisfying all three explicit budgets. */
export function sizeSpotEntry(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.keys(input).length !== FIELDS.length || !FIELDS.every(k => Object.hasOwn(input, k)))
    return reject('INVALID_INPUT_SCHEMA');
  if (input.currency !== 'EUR') return reject('CURRENCY_MUST_BE_EUR');
  if (!AMOUNTS.every(k => typeof input[k] === 'string' && INTEGER.test(input[k])))
    return reject('INVALID_AMOUNT');
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 10000)
    return reject('INVALID_FEE_BPS');
  const cash = BigInt(input.cashMicros), risk = BigInt(input.riskBudgetMicros);
  const exposure = BigInt(input.remainingExposureMicros);
  const entry = BigInt(input.entryPriceMicrosPerLot);
  const stressedExit = BigInt(input.stressedExitPriceMicrosPerLot);
  if (entry === 0n || stressedExit === 0n || stressedExit >= entry)
    return reject('INVALID_PRICE_ORIENTATION');
  const bps = BigInt(input.feeBps);
  const amounts = lots => {
    const entryNotionalMicros = lots * entry;
    const entryFeeMicros = fee(entryNotionalMicros, bps);
    const entryDebitMicros = entryNotionalMicros + entryFeeMicros;
    const stressedExitNotionalMicros = lots * stressedExit;
    const stressedExitFeeMicros = fee(stressedExitNotionalMicros, bps);
    const stressedExitCreditMicros = stressedExitNotionalMicros - stressedExitFeeMicros;
    return {lots, entryNotionalMicros, entryFeeMicros, entryDebitMicros,
      stressedExitNotionalMicros, stressedExitFeeMicros, stressedExitCreditMicros,
      modeledRiskMicros:entryDebitMicros - stressedExitCreditMicros};
  };
  const feasible = a => a.entryDebitMicros <= cash &&
    a.entryNotionalMicros <= exposure && a.modeledRiskMicros <= risk;
  let low = 0n, high = (cash < exposure ? cash : exposure) / entry;
  // At most 100 iterations: high <= 10^30-1; integer midpoint rounds upward.
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (feasible(amounts(mid))) low = mid;
    else high = mid - 1n;
  }
  const result = {...amounts(low), cashRemainingMicros:cash - amounts(low).entryDebitMicros};
  // Feasibility bounds every returned amount; guard the serialization contract too.
  if (Object.values(result).some(n => n < 0n || n > LIMIT))
    return reject('RESULT_AMOUNT_EXCEEDS_30_DIGITS');
  return {valid:true, candidate:low > 0n, errors:[],
    sizing:Object.fromEntries(Object.entries(result).map(([k,v]) => [k,v.toString()])), ...flags};
}
