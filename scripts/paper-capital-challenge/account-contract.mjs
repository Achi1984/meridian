import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from "./policy.mjs";

export const USD_MODELED_COSTS = Object.freeze({
  version: "BTC_USD_TAKER20_ADVERSE10_V1",
  provenance: "ASSUMED_COUNTERFACTUAL",
  venueAccountApplicability: "NOT_VERIFIED",
  feeBpsPerSide: 20,
  adverseSlippageBpsPerSide: 10,
  maxEntryCents: 10_000,
  feeRounding: "CEIL_EXACT_NOTIONAL_TO_INTEGER_USD_CENT",
  buyNotionalRounding: "CEIL",
  sellNotionalRounding: "FLOOR"
});

export const SCALE = 100_000_000n;
export const BPS = 10_000n;
export const NOTIONAL_DIVISOR = SCALE * SCALE / 100n;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const QUOTE_KEYS = [
  "schemaVersion", "id", "marketPair", "baseCurrency", "quoteCurrency",
  "sourceId", "nativeInstrument", "evidenceKind", "bid", "ask",
  "quotedAtMs", "receivedAtMs", "maxAgeMs"
];

export function record(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== keys.length ||
      keys.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor?.enumerable || !Object.hasOwn(descriptor, "value");
      })) throw new Error(`INVALID_${name}`);
  return value;
}

export function integer(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`INVALID_${name}`);
  return value;
}

export function cents(value, name) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`UNSAFE_${name}`);
  }
  return Number(value);
}

export function identifier(value, name) {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`INVALID_${name}`);
  return value;
}

export function decimalAtoms(value, name, { positive = true } = {}) {
  if (typeof value !== "string" || value.length > 25 ||
      !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const atoms = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  if (atoms > BigInt(Number.MAX_SAFE_INTEGER) || (positive && atoms <= 0n)) {
    throw new Error(`INVALID_${name}`);
  }
  return atoms;
}

export function ceilDivide(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

export function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizeBinding(input) {
  record(input, ["campaignId", "currency", "strategyVersion", "costVersion"], "BINDING");
  if (input.campaignId !== POLICY.campaignId) throw new Error("CAMPAIGN_ID_MISMATCH");
  if (input.currency !== POLICY.currency) throw new Error("CURRENCY_MISMATCH");
  if (input.costVersion !== USD_MODELED_COSTS.version) throw new Error("COST_VERSION_MISMATCH");
  identifier(input.strategyVersion, "STRATEGY_VERSION");
  return { ...input };
}

export function validateUsdQuote(input, observedAtMs) {
  record(input, QUOTE_KEYS, "QUOTE");
  integer(observedAtMs, "OBSERVATION_TIME");
  if (input.schemaVersion !== "NATIVE_BTC_USD_QUOTE_V1") throw new Error("INVALID_QUOTE_SCHEMA");
  if (input.marketPair !== "BTC/USD" || input.baseCurrency !== "BTC" ||
      input.quoteCurrency !== "USD" || input.nativeInstrument !== "BTC/USD") {
    throw new Error("NATIVE_USD_INSTRUMENT_REQUIRED");
  }
  if (!["SYNTHETIC_FIXTURE", "OFFLINE_CALLER_ASSERTION"].includes(input.evidenceKind)) {
    throw new Error("UNSUPPORTED_QUOTE_EVIDENCE");
  }
  identifier(input.id, "QUOTE_ID");
  identifier(input.sourceId, "QUOTE_SOURCE_ID");
  const bid = decimalAtoms(input.bid, "BID");
  const ask = decimalAtoms(input.ask, "ASK");
  if (bid > ask) throw new Error("CROSSED_QUOTE");
  integer(input.quotedAtMs, "QUOTE_TIME");
  integer(input.receivedAtMs, "QUOTE_RECEIPT_TIME");
  integer(input.maxAgeMs, "QUOTE_MAX_AGE", 1);
  if (input.maxAgeMs > POLICY.maxValuationAgeMs ||
      input.quotedAtMs > input.receivedAtMs || input.receivedAtMs > observedAtMs ||
      observedAtMs - input.quotedAtMs > input.maxAgeMs) {
    throw new Error("STALE_OR_FUTURE_QUOTE");
  }
  return { ...input };
}

export function modeledExecution(quantityAtoms, quote, side) {
  if (side !== "BUY" && side !== "SELL") throw new Error("INVALID_SIDE");
  const price = decimalAtoms(side === "BUY" ? quote.ask : quote.bid, "PRICE");
  const adjustment = BPS + (side === "BUY" ? 1n : -1n) *
    BigInt(USD_MODELED_COSTS.adverseSlippageBpsPerSide);
  const numerator = quantityAtoms * price * adjustment;
  const denominator = NOTIONAL_DIVISOR * BPS;
  const gross = side === "BUY" ? ceilDivide(numerator, denominator) : numerator / denominator;
  const fee = ceilDivide(numerator * BigInt(USD_MODELED_COSTS.feeBpsPerSide),
    denominator * BPS);
  const raw = quantityAtoms * price;
  return {
    notionalCents: cents(gross, "NOTIONAL"),
    feeCents: cents(fee, "FEE"),
    slippageCents: cents(ceilDivide(raw *
      BigInt(USD_MODELED_COSTS.adverseSlippageBpsPerSide), NOTIONAL_DIVISOR * BPS), "SLIPPAGE"),
    priceNumerator: String(price * adjustment),
    priceDenominator: String(SCALE * BPS)
  };
}
