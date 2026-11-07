import {createHash} from "node:crypto";
import {PAPER_LEDGER_POLICY, paperModeledQuoteDigest} from "./ledger.mjs";
import {normalizeExactCosts} from "../memecoin-paper-execution-evidence/normalize.mjs";
import {createJupiterV2QuoteAdapter} from "../memecoin-paper-route-quotes/jupiter-v2.mjs";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTEGER = /^(0|[1-9]\d{0,39})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_TIMEOUT_MS = 5_000;
const MAX_CAUSAL_AGE_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 100;
const COSTS = Object.freeze(["fee", "spread", "slippage", "priceImpact", "network"]);
const SOURCE = "Jupiter Swap API V2 /order";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SCENARIO_VERSION = "1";
const QUOTED_NET_BASIS = "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS";
const NO_INCREMENTAL_CHARGE = "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS";
const SCENARIO_CONFIG_KEYS = Object.freeze([
  "optIn", "scenarioId", "scenarioVersion", "scenario", "identity", "usdcMint",
  "usdcDecimals", "usdcUsdMicrosPerToken", "quoteBasis", "adverseAdjustmentBps",
  "networkReserveCents", "feeCents", "spreadCents", "priceImpactCents",
  "zeroChargeDisposition", "reviewEvidence", "explicitAssumptions", "quoteUsdConversion"
]);
const SCENARIO_CASES = Object.freeze({
  BASELINE: Object.freeze({
    scenarioId: "MEMECOIN_PAPER_QUOTE_ADVERSE_V1_BASELINE",
    adverseAdjustmentBps: 100,
    networkReserveCents: "10"
  }),
  STRESS: Object.freeze({
    scenarioId: "MEMECOIN_PAPER_QUOTE_ADVERSE_V1_STRESS",
    adverseAdjustmentBps: 300,
    networkReserveCents: "50"
  }),
  QUOTED_NET_V1: Object.freeze({
    scenarioId: "MERIDIAN_PAPER_QUOTED_NET_V1",
    adverseAdjustmentBps: 300,
    networkReserveCents: "50"
  }),
  EXPLICIT_NET_V1: Object.freeze({
    scenarioId: "MERIDIAN_PAPER_EXPLICIT_NET_V1"
  })
});
const QUOTED_NET_CASE = "QUOTED_NET_V1";
const EXPLICIT_NET_CASE = "EXPLICIT_NET_V1";
const EXPLICIT_NET_MODEL = Object.freeze({
  id: "MERIDIAN_PAPER_EXPLICIT_NET_V1",
  version: "1",
  status: "REVIEW_ONLY",
  provenance: "MODELED"
});
const EXPLICIT_NET_ASSUMPTION_KEYS = Object.freeze([
  "feeCents", "spreadCents", "slippageBps", "priceImpactCents", "networkCents",
  "equityCents", "availableCashCents", "units", "rationales", "zeroCostAssumptions",
  "dispositions"
]);
const EXPLICIT_NET_UNITS = Object.freeze({
  feeCents: "US_CENTS_PER_SIDE",
  spreadCents: "US_CENTS_PER_SIDE",
  slippageBps: "BASIS_POINTS_OF_QUOTED_NET_USD_VALUE",
  priceImpactCents: "US_CENTS_PER_SIDE",
  networkCents: "US_CENTS_PER_SIDE",
  equityCents: "US_CENTS",
  availableCashCents: "US_CENTS"
});
const EXPLICIT_NET_DISPOSITIONS = Object.freeze({
  fee: Object.freeze({zero: NO_INCREMENTAL_CHARGE, nonzero: "ADDITIONAL_MODELED_FEE_PENALTY_NOT_OBSERVED"}),
  spread: Object.freeze({zero: NO_INCREMENTAL_CHARGE, nonzero: "ADDITIONAL_MODELED_SPREAD_PENALTY_NOT_OBSERVED"}),
  slippage: Object.freeze({zero: NO_INCREMENTAL_CHARGE, nonzero: "ADDITIONAL_MODELED_ADVERSE_ADJUSTMENT_ROUNDED_UP"}),
  priceImpact: Object.freeze({zero: NO_INCREMENTAL_CHARGE, nonzero: "ADDITIONAL_MODELED_IMPACT_PENALTY_NOT_OBSERVED"}),
  network: Object.freeze({zero: NO_INCREMENTAL_CHARGE, nonzero: "ADDITIONAL_MODELED_NETWORK_RESERVE_NOT_SETTLED_COST"})
});
const EXPLICIT_NET_ASSUMPTIONS = Object.freeze([
  "All numeric inputs and units are caller-supplied modeled assumptions; no numeric preset is adopted.",
  "Jupiter route amounts use the existing modeled net-swap basis; they are not proven gross amounts.",
  "Nonzero category amounts are additional modeled penalties, not provider-reported costs or settled charges.",
  "Zero incremental charges under this basis are not assertions of economically zero execution costs.",
  "USD conversion requires a causal measured-source receipt; no stablecoin parity is inferred.",
  "A smaller entry size is modeled, not a fresh executable quote."
]);
const EXPLICIT_NET_RESULT_CONTRACT = Object.freeze({
  provenance: "MODELED",
  actualCostCoverage: "UNKNOWN",
  executionRealistic: false,
  authority: "NONE_REVIEW_PROJECTION_ONLY"
});
const QUOTED_NET_MODEL = Object.freeze({
  id: "MERIDIAN_PAPER_QUOTED_NET_V1",
  version: "1",
  status: "PROPOSED_FOR_INDEPENDENT_REVIEW",
  provenance: "MODELED",
  formula: "additionalModeledCents = ceil(ledgerGrossCents * adverseAdjustmentBps / 10000) + networkReserveCents",
  currencyAssumption: "1_USDC_EQUALS_1_MODELED_USD_UNSUPPORTED_BY_MARKET_ACCOUNTING_ASSUMPTION; NOT_OBSERVED_FX; NOT_DEPEG_PROTECTION",
  parameterStatus: "PROPOSED_UNCALIBRATED_NOT_GUARANTEED_WORST_CASE_REAL_COST",
  dispositions: Object.freeze({
    feeCents: "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS",
    spreadCents: "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS",
    slippageCents: "MODELED_ADVERSE_ADJUSTMENT_ROUNDED_UP",
    priceImpactCents: "NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS",
    networkCents: "MODELED_FIXED_USD_RESERVE_PER_SIDE"
  })
});
const QUOTED_NET_ASSUMPTIONS = Object.freeze([
  "Numeric parameters are proposed, uncalibrated, and not guaranteed worst-case real costs.",
  "Fee, spread, and price impact add 0 under the explicit QUOTED_NET basis; actual zero or independently verified inclusion is not asserted.",
  "1 USDC = 1 MODELED_USD is an unsupported-by-market accounting assumption, not observed FX or depeg protection.",
  "Provider fee, platform fee, price impact, minimum output, slippage tolerance, and lamports are retained separately and never charged again.",
  "Smaller-size projections are modeled, not fresh executable quotes."
]);
const QUOTED_NET_RESULT_CONTRACT = Object.freeze({
  provenance: "MODELED",
  actualCostCoverage: "UNKNOWN",
  executionRealistic: false,
  authority: "NONE_POLICY_BOUND_ACCEPTANCE_REQUIRES_INDEPENDENT_RUN_POLICY_BINDING"
});
const PAPER_ENTRY_LIMIT_CENTS = BigInt(PAPER_LEDGER_POLICY.maxEntryCents);
const MICRO_USD_PER_CENT = 10_000n;
const BPS = 10_000n;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function copyRecord(value, keys, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a plain record`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !keys.includes(key) ||
        !Object.hasOwn(descriptors[key], "value")) {
      throw new TypeError(`${label} contains an unsupported field`);
    }
    Object.defineProperty(result, key, {
      value: descriptors[key].value, enumerable: true, writable: true, configurable: true
    });
  }
  return result;
}

function copyPlainRecord(value, keys, label) {
  if (!isRecord(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain record`);
  }
  return copyRecord(value, keys, label);
}

function sameIdentity(actual, expected) {
  return ["chainId", "mint", "pool", "quote", "decimals"]
    .every(key => actual?.[key] === expected?.[key]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function paperQuotedNetModelDigest(binding) {
  return createHash("sha256").update(canonicalJson(binding)).digest("hex");
}

export const paperExplicitNetModelDigest = paperQuotedNetModelDigest;

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function normalizeExplicitNetAssumptions(value) {
  const raw = copyPlainRecord(value, EXPLICIT_NET_ASSUMPTION_KEYS,
    "explicit net assumptions");
  if (Object.keys(raw).length !== EXPLICIT_NET_ASSUMPTION_KEYS.length ||
      EXPLICIT_NET_ASSUMPTION_KEYS.some(key => !Object.hasOwn(raw, key))) {
    throw new TypeError("explicit net assumptions require every value, unit, rationale, and disposition");
  }
  const units = copyPlainRecord(raw.units, Object.keys(EXPLICIT_NET_UNITS),
    "explicit net assumption units");
  const rationales = copyPlainRecord(raw.rationales, Object.keys(EXPLICIT_NET_UNITS),
    "explicit net assumption rationales");
  const zeroCostAssumptions = copyPlainRecord(raw.zeroCostAssumptions,
    COSTS, "explicit zero-cost assumptions");
  const dispositions = copyPlainRecord(raw.dispositions, COSTS,
    "explicit net category dispositions");
  if (Object.keys(units).length !== Object.keys(EXPLICIT_NET_UNITS).length ||
      Object.keys(rationales).length !== Object.keys(EXPLICIT_NET_UNITS).length ||
      Object.keys(dispositions).length !== COSTS.length ||
      Object.entries(EXPLICIT_NET_UNITS).some(([key, unit]) => units[key] !== unit) ||
      Object.values(rationales).some(value =>
        typeof value !== "string" || value.trim().length < 8 || value.length > 256)) {
    throw new TypeError("explicit net assumption units or rationales are incomplete");
  }
  const result = {};
  for (const key of ["feeCents", "spreadCents", "priceImpactCents",
    "networkCents", "equityCents", "availableCashCents"]) {
    if (typeof raw[key] !== "string" || !INTEGER.test(raw[key])) {
      throw new TypeError(`explicit net ${key} must be a non-negative integer string`);
    }
    result[key] = raw[key];
  }
  if (typeof raw.slippageBps !== "string" || !INTEGER.test(raw.slippageBps) ||
      BigInt(raw.slippageBps) > BPS ||
      BigInt(raw.equityCents) <= 0n) {
    throw new TypeError("explicit net slippage or equity is outside its supported range");
  }
  result.slippageBps = raw.slippageBps;
  for (const component of COSTS) {
    const key = component === "priceImpact" ? "priceImpactCents" :
      component === "network" ? "networkCents" : `${component}Cents`;
    const isZero = component === "slippage"
      ? raw.slippageBps === "0" : raw[key] === "0";
    if (isZero) {
      const rationale = zeroCostAssumptions[component];
      if (typeof rationale !== "string" || rationale.trim().length < 8 ||
          rationale.length > 256) {
        throw new TypeError(`zero ${component} cost requires a documented modeled assumption`);
      }
    } else if (Object.hasOwn(zeroCostAssumptions, component)) {
      throw new TypeError(`zero-cost assumption supplied for nonzero ${component}`);
    }
    const expectedDisposition = isZero
      ? EXPLICIT_NET_DISPOSITIONS[component].zero
      : EXPLICIT_NET_DISPOSITIONS[component].nonzero;
    if (dispositions[component] !== expectedDisposition) {
      throw new TypeError(`explicit ${component} disposition contradicts its modeled assumption`);
    }
  }
  if (Object.keys(zeroCostAssumptions).some(component => !COSTS.includes(component))) {
    throw new TypeError("explicit zero-cost assumptions contain an unsupported component");
  }
  if (COSTS.some(component => !Object.hasOwn(dispositions, component))) {
    throw new TypeError("explicit net category dispositions are incomplete");
  }
  result.equityCents = raw.equityCents;
  result.availableCashCents = raw.availableCashCents;
  result.units = Object.fromEntries(Object.keys(EXPLICIT_NET_UNITS)
    .map(key => [key, units[key]]));
  result.rationales = Object.fromEntries(Object.keys(EXPLICIT_NET_UNITS)
    .map(key => [key, rationales[key]]));
  result.zeroCostAssumptions = Object.fromEntries(COSTS
    .filter(component => Object.hasOwn(zeroCostAssumptions, component))
    .map(component => [component, zeroCostAssumptions[component]]));
  result.dispositions = Object.fromEntries(COSTS
    .map(component => [component, dispositions[component]]));
  return result;
}

function normalizeQuoteUsdConversion(value) {
  const conversion = copyPlainRecord(value, [
    "mint", "decimals", "microUsdPerWholeToken", "observedAt", "method", "evidenceSha256"
  ], "quote USD conversion");
  if (Object.keys(conversion).length !== 6) {
    throw new TypeError("quote USD conversion requires every measured field");
  }
  return conversion;
}

function scenarioConfig(value) {
  const raw = copyPlainRecord(value, SCENARIO_CONFIG_KEYS, "review scenario");
  raw.identity = copyPlainRecord(raw.identity,
    ["chainId", "mint", "pool", "quote", "decimals"], "scenario identity");
  if (Object.hasOwn(raw, "reviewEvidence")) {
    raw.reviewEvidence = copyPlainRecord(raw.reviewEvidence, [
      "evidenceId", "evidenceSha256", "scenarioConfigSha256", "identity",
      "reviewerRef", "purpose", "decision", "recordedAt"
    ], "review evidence");
    raw.reviewEvidence.identity = copyPlainRecord(raw.reviewEvidence.identity,
      ["chainId", "mint", "pool", "quote", "decimals"], "review evidence identity");
    const evidence = raw.reviewEvidence;
    const evidenceIdentity = evidence.identity;
    if (typeof evidence.evidenceId !== "string" || !SAFE_ID.test(evidence.evidenceId) ||
        typeof evidence.evidenceSha256 !== "string" || !SHA256.test(evidence.evidenceSha256) ||
        typeof evidence.scenarioConfigSha256 !== "string" ||
        !SHA256.test(evidence.scenarioConfigSha256) ||
        typeof evidence.reviewerRef !== "string" || !SAFE_ID.test(evidence.reviewerRef) ||
        typeof evidence.purpose !== "string" || evidence.purpose.length > 64 ||
        typeof evidence.decision !== "string" || evidence.decision.length > 64 ||
        !validTime(evidence.recordedAt) ||
        evidenceIdentity.chainId !== "solana" ||
        typeof evidenceIdentity.mint !== "string" || evidenceIdentity.mint.length > 44 ||
        typeof evidenceIdentity.pool !== "string" || evidenceIdentity.pool.length > 44 ||
        typeof evidenceIdentity.quote !== "string" || evidenceIdentity.quote.length > 44 ||
        !Number.isInteger(evidenceIdentity.decimals) ||
        evidenceIdentity.decimals < 0 || evidenceIdentity.decimals > 18) {
      throw new TypeError("review evidence fields exceed their bounded schema");
    }
  } else {
    raw.reviewEvidence = null;
  }
  const scenario = typeof raw.scenario === "string" &&
    Object.hasOwn(SCENARIO_CASES, raw.scenario) ? SCENARIO_CASES[raw.scenario] : null;
  if (raw.optIn !== true || !scenario ||
      raw.scenarioId !== scenario.scenarioId ||
      raw.scenarioVersion !== SCENARIO_VERSION ||
      raw.identity.chainId !== "solana" ||
      typeof raw.identity.mint !== "string" || !BASE58.test(raw.identity.mint) ||
      typeof raw.identity.pool !== "string" || !BASE58.test(raw.identity.pool) ||
      typeof raw.identity.quote !== "string" || !BASE58.test(raw.identity.quote) ||
      !Number.isInteger(raw.identity.decimals) || raw.identity.decimals < 0 ||
      raw.identity.decimals > 18) {
    throw new TypeError("review scenario configuration is unsupported or inconsistent");
  }
  let canonical;
  if (raw.scenario === EXPLICIT_NET_CASE) {
    const explicitKeys = [
      "optIn", "scenarioId", "scenarioVersion", "scenario", "identity", "quoteBasis",
      "explicitAssumptions", "quoteUsdConversion", "reviewEvidence"
    ];
    if (Object.keys(raw).some(key => !explicitKeys.includes(key)) ||
        explicitKeys.filter(key => key !== "reviewEvidence")
          .some(key => !Object.hasOwn(raw, key)) ||
        raw.quoteBasis !== QUOTED_NET_BASIS) {
      throw new TypeError("explicit net configuration is incomplete or contradicts the quoted-net basis");
    }
    canonical = {
      optIn: raw.optIn,
      scenarioId: raw.scenarioId,
      scenarioVersion: raw.scenarioVersion,
      scenario: raw.scenario,
      identity: {
        chainId: raw.identity.chainId,
        mint: raw.identity.mint,
        pool: raw.identity.pool,
        quote: raw.identity.quote,
        decimals: raw.identity.decimals
      },
      quoteBasis: raw.quoteBasis,
      explicitAssumptions: normalizeExplicitNetAssumptions(raw.explicitAssumptions),
      quoteUsdConversion: normalizeQuoteUsdConversion(raw.quoteUsdConversion)
    };
  } else {
    const requiredKeys = SCENARIO_CONFIG_KEYS.filter(key =>
      !["reviewEvidence", "explicitAssumptions", "quoteUsdConversion"].includes(key));
    if (requiredKeys.some(key => !Object.hasOwn(raw, key)) ||
        ["explicitAssumptions", "quoteUsdConversion"]
          .some(key => Object.hasOwn(raw, key)) ||
        raw.identity.quote !== SOLANA_USDC_MINT ||
        raw.usdcMint !== SOLANA_USDC_MINT || raw.usdcDecimals !== 6 ||
        raw.usdcUsdMicrosPerToken !== "1000000" ||
        raw.quoteBasis !== QUOTED_NET_BASIS ||
        raw.adverseAdjustmentBps !== scenario.adverseAdjustmentBps ||
        raw.networkReserveCents !== scenario.networkReserveCents ||
        raw.feeCents !== "0" || raw.spreadCents !== "0" ||
        raw.priceImpactCents !== "0" ||
        raw.zeroChargeDisposition !== NO_INCREMENTAL_CHARGE) {
      throw new TypeError("review scenario configuration is unsupported or inconsistent");
    }
    canonical = {
      optIn: raw.optIn,
      scenarioId: raw.scenarioId,
      scenarioVersion: raw.scenarioVersion,
      scenario: raw.scenario,
      identity: {
        chainId: raw.identity.chainId,
        mint: raw.identity.mint,
        pool: raw.identity.pool,
        quote: raw.identity.quote,
        decimals: raw.identity.decimals
      },
      usdcMint: raw.usdcMint,
      usdcDecimals: raw.usdcDecimals,
      usdcUsdMicrosPerToken: raw.usdcUsdMicrosPerToken,
      quoteBasis: raw.quoteBasis,
      adverseAdjustmentBps: raw.adverseAdjustmentBps,
      networkReserveCents: raw.networkReserveCents,
      feeCents: raw.feeCents,
      spreadCents: raw.spreadCents,
      priceImpactCents: raw.priceImpactCents,
      zeroChargeDisposition: raw.zeroChargeDisposition
    };
  }
  const encoded = JSON.stringify(canonical);
  if (Buffer.byteLength(encoded) > 8_192) {
    throw new RangeError("review scenario exceeds configuration capacity");
  }
  return {
    config: canonical,
    sha256: createHash("sha256").update(encoded).digest("hex"),
    reviewEvidence: raw.reviewEvidence
  };
}

export function reviewScenarioConfigSha256(value) {
  return scenarioConfig(value).sha256;
}

function validateReviewEvidence(value, config, observedAt) {
  try {
    const evidence = value;
    return typeof evidence?.evidenceId === "string" &&
      SAFE_ID.test(evidence.evidenceId) &&
      typeof evidence.reviewerRef === "string" &&
      SAFE_ID.test(evidence.reviewerRef) &&
      typeof evidence.evidenceSha256 === "string" &&
      SHA256.test(evidence.evidenceSha256) &&
      evidence.scenarioConfigSha256 === config.sha256 &&
      sameIdentity(evidence.identity, config.config.identity) &&
      evidence.purpose === "OFFLINE_SCENARIO_REVIEW_ONLY" &&
      evidence.decision === "APPROVE_SCENARIO_REVIEW_ONLY" &&
      validTime(evidence.recordedAt) && evidence.recordedAt <= observedAt
      ? {status: "ASSERTED_UNVERIFIED", evidenceId: evidence.evidenceId,
        evidenceSha256: evidence.evidenceSha256}
      : null;
  } catch {
    return null;
  }
}

function blockedScenarioProjection(reasons) {
  return {
    status: "BLOCKED",
    reasons: [...new Set(reasons)],
    actualCostCoverage: "UNKNOWN",
    scenarioCostCoverage: "BLOCKED",
    authorizationEligible: false,
    executionRealistic: false,
    integrationEligible: false
  };
}

function unavailableScenario(parsedScenario, reason) {
  if (!parsedScenario) return null;
  return blockedScenarioProjection([
    parsedScenario.error ? "SCENARIO_CONFIGURATION_INVALID" : reason
  ]);
}

function grossCentsAtPrice(baseAtoms, priceMicros, baseScale, side) {
  const numerator = baseAtoms * priceMicros;
  const denominator = baseScale * MICRO_USD_PER_CENT;
  return side === "ENTRY"
    ? ceilDiv(numerator, denominator)
    : numerator / denominator;
}

function slippageCentsAtGross(grossCents, adjustmentBps) {
  return ceilDiv(grossCents * BigInt(adjustmentBps), BPS);
}

function maximumEntryBaseAtoms(routeBaseAtoms, priceMicros, baseScale, adjustmentBps, reserve) {
  const allInAt = atoms => {
    const gross = grossCentsAtPrice(atoms, priceMicros, baseScale, "ENTRY");
    return gross + slippageCentsAtGross(gross, adjustmentBps) + reserve;
  };
  let low = 0n;
  let high = routeBaseAtoms;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (allInAt(middle) <= PAPER_ENTRY_LIMIT_CENTS) low = middle;
    else high = middle - 1n;
  }
  return low;
}

function projectReviewScenario(request, observation, candidateReasons, parsedScenario, sourceResponse) {
  if (parsedScenario?.error) {
    return blockedScenarioProjection(["SCENARIO_CONFIGURATION_INVALID"]);
  }
  const parsed = parsedScenario?.parsed;
  if (!parsed) return null;
  const {config} = parsed;
  if (!sameIdentity(config.identity, request.identity) ||
      (config.scenario !== EXPLICIT_NET_CASE &&
       config.usdcDecimals !== request.quoteDecimals)) {
    return blockedScenarioProjection(["SCENARIO_IDENTITY_OR_DECIMALS_MISMATCH"]);
  }
  const route = observation.route;
  const receivedAt = route?.observedAt;
  const unsafeQuoteReasons = [
    "SELECTED_POOL_ROUTE_NOT_IDENTITY_BOUND",
    "POST_RESPONSE_CHRONOLOGY_INVALID",
    "CAUSAL_REFERENCE_STALE",
    "QUOTE_EXPIRED"
  ];
  if (!route || unsafeQuoteReasons.some(reason => candidateReasons.includes(reason))) {
    return blockedScenarioProjection(["SCENARIO_SOURCE_QUOTE_NOT_CAUSAL_AND_BOUND"]);
  }
  const reviewEvidence = validateReviewEvidence(parsed.reviewEvidence, parsed, receivedAt);
  if (!reviewEvidence) {
    return blockedScenarioProjection(["SCENARIO_REVIEW_EVIDENCE_MISSING_UNAPPROVED_OR_MISMATCHED"]);
  }
  if (config.scenario === EXPLICIT_NET_CASE) {
    return projectExplicitNetScenario(
      request, observation, parsedScenario.parsed,
      sourceResponse
    );
  }

  const baseAtoms = BigInt(request.side === "ENTRY" ? route.outAmount : route.inAmount);
  const quoteAtoms = BigInt(request.side === "ENTRY" ? route.inAmount : route.outAmount);
  const baseScale = 10n ** BigInt(request.identity.decimals);
  const quoteScale = 10n ** BigInt(config.usdcDecimals);
  const priceNumerator = quoteAtoms * BigInt(config.usdcUsdMicrosPerToken) * baseScale;
  const priceDenominator = baseAtoms * quoteScale;
  const priceMicros = request.side === "ENTRY"
    ? ceilDiv(priceNumerator, priceDenominator)
    : priceNumerator / priceDenominator;
  if (priceMicros <= 0n || priceMicros > BigInt(Number.MAX_SAFE_INTEGER)) {
    return blockedScenarioProjection(["SCENARIO_PRICE_MICROS_ZERO_OR_UNSAFE"]);
  }

  const adjustmentBps = BigInt(config.adverseAdjustmentBps);
  const reserveCents = BigInt(config.networkReserveCents);
  let modeledQuoteAtoms;
  let modeledBaseAtoms;
  let grossQuoteCents;
  let slippageCents;
  let totalScenarioCosts;
  let quoteValueAfterCostsCents;
  if (request.side === "ENTRY") {
    modeledBaseAtoms = maximumEntryBaseAtoms(
      baseAtoms, priceMicros, baseScale, adjustmentBps, reserveCents
    );
    if (modeledBaseAtoms <= 0n) {
      return blockedScenarioProjection(["SCENARIO_ENTRY_SIZE_BELOW_DUST_OR_COST_RESERVE"]);
    }
    modeledQuoteAtoms = ceilDiv(quoteAtoms * modeledBaseAtoms, baseAtoms);
    if (modeledQuoteAtoms > quoteAtoms) {
      return blockedScenarioProjection(["SCENARIO_SIZE_EXCEEDS_SOURCE_QUOTE"]);
    }
    grossQuoteCents = grossCentsAtPrice(
      modeledBaseAtoms, priceMicros, baseScale, "ENTRY"
    );
    slippageCents = slippageCentsAtGross(grossQuoteCents, adjustmentBps);
    totalScenarioCosts = slippageCents + reserveCents;
    quoteValueAfterCostsCents = grossQuoteCents + totalScenarioCosts;
  } else {
    modeledBaseAtoms = BigInt(request.amountAtoms);
    if (modeledBaseAtoms > baseAtoms) {
      return blockedScenarioProjection(["SCENARIO_SIZE_EXCEEDS_SOURCE_QUOTE"]);
    }
    grossQuoteCents = grossCentsAtPrice(
      modeledBaseAtoms, priceMicros, baseScale, "EXIT"
    );
    slippageCents = slippageCentsAtGross(grossQuoteCents, adjustmentBps);
    totalScenarioCosts = slippageCents + reserveCents;
    if (totalScenarioCosts > grossQuoteCents) {
      return blockedScenarioProjection(["SCENARIO_COSTS_EXCEED_ROUNDED_EXIT_CREDIT"]);
    }
    quoteValueAfterCostsCents = grossQuoteCents - totalScenarioCosts;
  }

  let model;
  if (config.scenario === QUOTED_NET_CASE) {
    if (!sourceResponse?.sha256 || route.inAmount !== request.amountAtoms) {
      return blockedScenarioProjection(["SCENARIO_QUOTED_AMOUNT_OR_RESPONSE_BINDING_MISSING"]);
    }
    const modeledInputAtoms = request.side === "ENTRY" ? modeledQuoteAtoms : modeledBaseAtoms;
    const binding = {
      modelId: QUOTED_NET_MODEL.id,
      modelVersion: QUOTED_NET_MODEL.version,
      status: QUOTED_NET_MODEL.status,
      provenance: QUOTED_NET_MODEL.provenance,
      parameterStatus: QUOTED_NET_MODEL.parameterStatus,
      formula: QUOTED_NET_MODEL.formula,
      scenarioConfigSha256: parsed.sha256,
      parameters: {
        adverseAdjustmentBps: {value: config.adverseAdjustmentBps, unit: "basis_points_of_ledger_gross_cents_ceil"},
        networkReserveCents: {value: config.networkReserveCents, unit: "us_cents_per_side"},
        feeCents: {value: config.feeCents, unit: "additional_us_cents"},
        spreadCents: {value: config.spreadCents, unit: "additional_us_cents"},
        priceImpactCents: {value: config.priceImpactCents, unit: "additional_us_cents"}
      },
      currency: {
        mint: config.usdcMint,
        decimals: config.usdcDecimals,
        microUsdPerToken: config.usdcUsdMicrosPerToken,
        assumption: QUOTED_NET_MODEL.currencyAssumption
      },
      quoteBasis: config.quoteBasis,
      dispositions: {...QUOTED_NET_MODEL.dispositions},
      candidateIdentity: {...request.identity},
      side: request.side,
      quantity: {
        modeledBaseAtoms: modeledBaseAtoms.toString(),
        modeledInputAtoms: modeledInputAtoms.toString(),
        sourceQuotedBaseAtoms: baseAtoms.toString(),
        sourceQuotedInputAtoms: route.inAmount,
        sizeDisposition: modeledBaseAtoms === baseAtoms
          ? "QUOTED_AMOUNT"
          : "SMALLER_SIZE_MODELED_NOT_A_FRESH_EXECUTABLE_QUOTE"
      },
      sourceQuote: {
        source: SOURCE,
        requestId: route.requestId ?? null,
        observedAt: receivedAt,
        expiresAt: route.expiresAt,
        inAmount: route.inAmount,
        outAmount: route.outAmount,
        responseSha256: sourceResponse.sha256,
        responseByteLength: sourceResponse.byteLength
      },
      result: {
        priceMicros: priceMicros.toString(),
        grossCents: grossQuoteCents.toString(),
        slippageCents: slippageCents.toString(),
        networkCents: config.networkReserveCents,
        totalExtraCents: totalScenarioCosts.toString(),
        afterCents: quoteValueAfterCostsCents.toString()
      }
    };
    model = {
      binding,
      digest: paperQuotedNetModelDigest(binding),
      assumptions: [...QUOTED_NET_ASSUMPTIONS],
      resultContract: {...QUOTED_NET_RESULT_CONTRACT}
    };
  }

  const costsCents = {
    feeCents: config.feeCents,
    spreadCents: config.spreadCents,
    slippageCents: slippageCents.toString(),
    priceImpactCents: config.priceImpactCents,
    networkCents: config.networkReserveCents
  };
  return {
    status: "REVIEW_PROJECTION_ONLY",
    scenarioCostCoverage: "COMPLETE",
    actualCostCoverage: "UNKNOWN",
    scenario: {
      id: config.scenarioId,
      version: config.scenarioVersion,
      case: config.scenario,
      configurationSha256: parsed.sha256,
      approvalPurpose: "OFFLINE_SCENARIO_REVIEW_ONLY",
      approvalEvidence: reviewEvidence,
      approvalEvidenceProvenance: "CALLER_ASSERTED_NOT_AUTHENTICATED",
      quoteBasis: config.quoteBasis,
      quoteUsdAssumption: {
        mint: config.usdcMint,
        decimals: config.usdcDecimals,
        microUsdPerToken: config.usdcUsdMicrosPerToken,
        assumption: "USDC_EQUALS_USD1_EXPERIMENTAL_NOT_MEASURED"
      },
      adverseAdjustmentBps: config.adverseAdjustmentBps,
      networkReserveCents: config.networkReserveCents,
      zeroChargeDisposition: config.zeroChargeDisposition
    },
    identity: {...request.identity},
    source: SOURCE,
    sourceProvenance: "INJECTED_TRANSPORT_NOT_AUTHENTICATED",
    side: request.side,
    receiptTime: receivedAt,
    receiptTimeProvenance: "INJECTED_LOCAL_CLOCK_AFTER_RESPONSE_BODY; NOT_AUTHENTICATED",
    priceMicros: Number(priceMicros),
    rawExactQuotePerBase: exactPriceRatio(request, route),
    priceRounding: request.side === "ENTRY"
      ? "ceil_exact_USD_per_token_microUSD"
      : "floor_exact_USD_per_token_microUSD",
    amountProjection: {
      basis: "ROUTE_CAP_WITH_MODELED_VALUE_AND_COSTS_FROM_PUBLISHED_ROUNDED_PRICE; NOT_AN_EXECUTABLE_EXACT_SIZE_ROUTE",
      sourceQuotedInputAtoms: route.inAmount,
      maximumModeledInputAtoms: (request.side === "ENTRY" ? modeledQuoteAtoms : modeledBaseAtoms).toString(),
      sourceQuotedBaseAtoms: baseAtoms.toString(),
      maximumModeledBaseAtoms: modeledBaseAtoms.toString(),
      entryAllInLimitCents: request.side === "ENTRY" ? PAPER_ENTRY_LIMIT_CENTS.toString() : null,
      dynamicRiskCaps: "NOT_EVALUATED; existing authorization, equity, cash, and hard evidence gates remain unchanged",
      modeledAllInCents: request.side === "ENTRY"
        ? quoteValueAfterCostsCents.toString() : null
    },
    costBasis: "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS",
    costsCents,
    costDisposition: {
      feeCents: NO_INCREMENTAL_CHARGE,
      spreadCents: NO_INCREMENTAL_CHARGE,
      slippageCents: "EXPERIMENTAL_ADVERSE_SCENARIO_ADJUSTMENT_ROUNDED_UP",
      priceImpactCents: NO_INCREMENTAL_CHARGE,
      networkCents: "EXPERIMENTAL_FIXED_USD_RESERVE_PER_SIDE"
    },
    quoteValue: {
      grossBeforeExtraScenarioCostsCents: grossQuoteCents.toString(),
      direction: request.side === "ENTRY" ? "DEBIT_ROUNDED_UP" : "CREDIT_ROUNDED_DOWN",
      totalExtraScenarioCostsCents: totalScenarioCosts.toString(),
      afterExtraScenarioCostsCents: quoteValueAfterCostsCents.toString(),
      label: "MODELED_SINGLE_SIDE_QUOTE_VALUE_NOT_PNL"
    },
    pnl: {
      status: "NOT_COMPUTED_SINGLE_SIDE_PROJECTION",
      beforeExtraScenarioCostsCents: null,
      afterExtraScenarioCostsCents: null,
      reason: "A paired entry, exit, identity-bound marks, and scenario configuration are required."
    },
    providerFieldsRetainedSeparately: {
      feeBps: route.feeBps,
      feeMint: route.feeMint,
      platformFee: route.platformFee,
      networkFeesLamports: route.reportedNetworkFeesLamports,
      priceImpact: route.priceImpact,
      slippageToleranceBps: route.slippageBps
    },
    ...(model ? {model, provenance: "MODELED"} : {}),
    authorizationEligible: false,
    executionRealistic: false,
    integrationEligible: false,
    integrationBoundary: "Independent review evidence verification, size-cap enforcement, and unchanged Paper hard/risk gates are required."
  };
}

function explicitNetRequestBinding(request) {
  return {
    identity: {...request.identity},
    side: request.side,
    amountAtoms: request.amountAtoms,
    quoteDecimals: request.quoteDecimals,
    candidateSampledAt: request.candidateSampledAt,
    causalAt: request.side === "ENTRY" ? request.authorizedAt : request.positionOpenedAt,
    slippageBps: request.slippageBps
  };
}

export function paperExplicitNetRequestDigest(value) {
  const request = copyRequest(value);
  return createHash("sha256")
    .update(canonicalJson(explicitNetRequestBinding(request))).digest("hex");
}

function modeledCostsAtNetBasis(netBasisCents, assumptions) {
  const costs = {
    feeCents: BigInt(assumptions.feeCents),
    spreadCents: BigInt(assumptions.spreadCents),
    slippageCents: ceilDiv(netBasisCents * BigInt(assumptions.slippageBps), BPS),
    priceImpactCents: BigInt(assumptions.priceImpactCents),
    networkCents: BigInt(assumptions.networkCents)
  };
  return {
    costs,
    total: Object.values(costs).reduce((sum, amount) => sum + amount, 0n)
  };
}

function deriveExplicitNetProjection(binding) {
  try {
    if (!isRecord(binding) || !exactKeys(binding, [
      "modelId", "modelVersion", "status", "provenance", "scenarioConfigSha256",
      "scenarioConfiguration", "reviewEvidenceRecord", "candidateIdentity", "side",
      "request", "sourceQuote", "quoteUsdConversion", "quoteBasis", "result"
    ]) || binding.modelId !== EXPLICIT_NET_MODEL.id ||
        binding.modelVersion !== EXPLICIT_NET_MODEL.version ||
        binding.status !== EXPLICIT_NET_MODEL.status ||
        binding.provenance !== EXPLICIT_NET_MODEL.provenance ||
        typeof binding.scenarioConfigSha256 !== "string" ||
        !SHA256.test(binding.scenarioConfigSha256)) {
      return null;
    }

    const parsed = scenarioConfig({
      ...binding.scenarioConfiguration,
      reviewEvidence: binding.reviewEvidenceRecord
    });
    if (parsed.sha256 !== binding.scenarioConfigSha256 ||
        canonicalJson(parsed.config) !== canonicalJson(binding.scenarioConfiguration) ||
        binding.quoteBasis !== QUOTED_NET_BASIS ||
        binding.quoteBasis !== parsed.config.quoteBasis ||
        canonicalJson(parsed.config.quoteUsdConversion) !== canonicalJson(binding.quoteUsdConversion)) {
      return null;
    }

    const requestBinding = copyPlainRecord(binding.request, [
      "identity", "side", "amountAtoms", "quoteDecimals", "candidateSampledAt",
      "causalAt", "slippageBps", "sha256"
    ], "explicit net request binding");
    const identity = copyPlainRecord(binding.candidateIdentity,
      ["chainId", "mint", "pool", "quote", "decimals"], "explicit net candidate identity");
    requestBinding.identity = copyPlainRecord(requestBinding.identity,
      ["chainId", "mint", "pool", "quote", "decimals"], "explicit net request identity");
    if (!exactKeys(requestBinding, [
      "identity", "side", "amountAtoms", "quoteDecimals", "candidateSampledAt",
      "causalAt", "slippageBps", "sha256"
    ]) || !sameIdentity(identity, requestBinding.identity) ||
        requestBinding.side !== binding.side || !["ENTRY", "EXIT"].includes(binding.side)) {
      return null;
    }
    const requestInput = {
      identity,
      side: binding.side,
      amountAtoms: requestBinding.amountAtoms,
      quoteDecimals: requestBinding.quoteDecimals,
      candidateSampledAt: requestBinding.candidateSampledAt,
      slippageBps: requestBinding.slippageBps,
      ...(binding.side === "ENTRY"
        ? {authorizedAt: requestBinding.causalAt}
        : {positionOpenedAt: requestBinding.causalAt})
    };
    const request = copyRequest(requestInput);
    const normalizedRequest = explicitNetRequestBinding(request);
    const requestSha256 = createHash("sha256")
      .update(canonicalJson(normalizedRequest)).digest("hex");
    if (requestBinding.sha256 !== requestSha256 ||
        !sameIdentity(identity, parsed.config.identity)) {
      return null;
    }

    const sourceQuote = copyPlainRecord(binding.sourceQuote, [
      "source", "requestId", "observedAt", "expiresAt", "inAmount", "outAmount",
      "responseSha256", "responseByteLength"
    ], "explicit net source quote");
    if (Object.keys(sourceQuote).length !== 8 || sourceQuote.source !== SOURCE ||
        !(sourceQuote.requestId === null ||
          (typeof sourceQuote.requestId === "string" && SAFE_ID.test(sourceQuote.requestId))) ||
        !validTime(sourceQuote.observedAt) || !validTime(sourceQuote.expiresAt) ||
        sourceQuote.expiresAt <= sourceQuote.observedAt ||
        typeof sourceQuote.inAmount !== "string" || !INTEGER.test(sourceQuote.inAmount) ||
        BigInt(sourceQuote.inAmount) <= 0n ||
        typeof sourceQuote.outAmount !== "string" || !INTEGER.test(sourceQuote.outAmount) ||
        BigInt(sourceQuote.outAmount) <= 0n ||
        typeof sourceQuote.responseSha256 !== "string" || !SHA256.test(sourceQuote.responseSha256) ||
        !Number.isSafeInteger(sourceQuote.responseByteLength) || sourceQuote.responseByteLength <= 0 ||
        sourceQuote.inAmount !== request.amountAtoms ||
        sourceQuote.observedAt <= request.candidateSampledAt ||
        sourceQuote.observedAt <= (binding.side === "ENTRY" ? request.authorizedAt : request.positionOpenedAt) ||
        sourceQuote.observedAt - request.candidateSampledAt > MAX_CAUSAL_AGE_MS ||
        sourceQuote.observedAt -
          (binding.side === "ENTRY" ? request.authorizedAt : request.positionOpenedAt) > MAX_CAUSAL_AGE_MS) {
      return null;
    }

    const conversionReasons = [];
    const conversion = validConversion(binding.quoteUsdConversion, {
      mint: identity.quote,
      decimals: request.quoteDecimals
    }, sourceQuote.observedAt, conversionReasons, "quote");
    if (!conversion || conversionReasons.length > 0) return null;
    const reviewEvidence = validateReviewEvidence(
      binding.reviewEvidenceRecord, parsed, sourceQuote.observedAt
    );
    if (!reviewEvidence) return null;

    const isEntry = binding.side === "ENTRY";
    const sourceBaseAtoms = BigInt(isEntry ? sourceQuote.outAmount : sourceQuote.inAmount);
    const sourceQuoteAtoms = BigInt(isEntry ? sourceQuote.inAmount : sourceQuote.outAmount);
    const baseScale = 10n ** BigInt(identity.decimals);
    const quoteScale = 10n ** BigInt(request.quoteDecimals);
    const priceNumerator = sourceQuoteAtoms *
      BigInt(conversion.microUsdPerWholeToken) * baseScale;
    const priceDenominator = sourceBaseAtoms * quoteScale;
    const priceMicros = isEntry
      ? ceilDiv(priceNumerator, priceDenominator)
      : priceNumerator / priceDenominator;
    if (priceMicros <= 0n || priceMicros > BigInt(Number.MAX_SAFE_INTEGER)) return null;

    const assumptions = parsed.config.explicitAssumptions;
    const equityCap = BigInt(assumptions.equityCents) * 8n / 100n;
    const availableCash = BigInt(assumptions.availableCashCents);
    const entryBudget = [PAPER_ENTRY_LIMIT_CENTS, equityCap, availableCash]
      .reduce((minimum, amount) => amount < minimum ? amount : minimum);
    let modeledBaseAtoms = isEntry ? sourceBaseAtoms : BigInt(request.amountAtoms);
    if (isEntry) {
      let low = 0n;
      let high = sourceBaseAtoms;
      while (low < high) {
        const middle = (low + high + 1n) / 2n;
        const gross = grossCentsAtPrice(middle, priceMicros, baseScale, "ENTRY");
        const {total} = modeledCostsAtNetBasis(gross, assumptions);
        if (gross + total <= entryBudget) low = middle;
        else high = middle - 1n;
      }
      modeledBaseAtoms = low;
      if (modeledBaseAtoms <= 0n) return null;
    }
    const modeledQuoteAtoms = isEntry
      ? ceilDiv(sourceQuoteAtoms * modeledBaseAtoms, sourceBaseAtoms)
      : sourceQuoteAtoms;
    if (modeledQuoteAtoms > sourceQuoteAtoms) return null;
    const grossCents = grossCentsAtPrice(
      modeledBaseAtoms, priceMicros, baseScale, binding.side
    );
    const {costs, total} = modeledCostsAtNetBasis(grossCents, assumptions);
    if (isEntry && grossCents + total > entryBudget) return null;
    if (!isEntry && total > grossCents) return null;
    const afterCents = isEntry ? grossCents + total : grossCents - total;
    const modeledInputAtoms = isEntry ? modeledQuoteAtoms : modeledBaseAtoms;
    const sizeDisposition = isEntry && modeledBaseAtoms !== sourceBaseAtoms
      ? "SMALLER_SIZE_MODELED_NOT_A_FRESH_EXECUTABLE_QUOTE" : "QUOTED_AMOUNT";
    const result = {
      priceMicros: priceMicros.toString(),
      quotedNetBasisCents: grossCents.toString(),
      costsCents: Object.fromEntries(Object.entries(costs)
        .map(([key, amount]) => [key, amount.toString()])),
      totalCostsCents: total.toString(),
      afterCents: afterCents.toString(),
      effectiveEntryBudgetCents: entryBudget.toString(),
      modeledBaseAtoms: modeledBaseAtoms.toString(),
      modeledInputAtoms: modeledInputAtoms.toString(),
      sourceQuotedBaseAtoms: sourceBaseAtoms.toString(),
      sourceQuotedInputAtoms: sourceQuote.inAmount,
      sizeDisposition
    };
    if (binding.result !== null &&
        canonicalJson(result) !== canonicalJson(binding.result)) return null;

    const modeledCosts = {
      feeCents: result.costsCents.feeCents,
      spreadCents: result.costsCents.spreadCents,
      slippageCents: result.costsCents.slippageCents,
      priceImpactCents: result.costsCents.priceImpactCents,
      networkCents: result.costsCents.networkCents
    };
    const projection = {
      status: "REVIEW_PROJECTION_ONLY",
      scenarioCostCoverage: "COMPLETE",
      actualCostCoverage: "UNKNOWN",
      scenario: {
        id: parsed.config.scenarioId,
        version: parsed.config.scenarioVersion,
        case: parsed.config.scenario,
        configurationSha256: parsed.sha256,
        approvalPurpose: "OFFLINE_SCENARIO_REVIEW_ONLY",
        approvalEvidence: reviewEvidence,
        approvalEvidenceProvenance: "CALLER_ASSERTED_NOT_AUTHENTICATED",
        quoteBasis: QUOTED_NET_BASIS,
        quoteUsdConversion: {
          mint: conversion.mint,
          decimals: conversion.decimals,
          microUsdPerWholeToken: conversion.microUsdPerWholeToken,
          observedAt: conversion.observedAt,
          method: conversion.method,
          evidenceSha256: conversion.evidenceSha256,
          provenance: "STRUCTURALLY_VALID_UNAUTHENTICATED"
        },
        assumptions
      },
      identity,
      source: SOURCE,
      sourceProvenance: "INJECTED_TRANSPORT_NOT_AUTHENTICATED",
      side: binding.side,
      receiptTime: sourceQuote.observedAt,
      receiptTimeProvenance: "INJECTED_LOCAL_CLOCK_AFTER_RESPONSE_BODY; NOT_AUTHENTICATED",
      priceMicros: Number(priceMicros),
      rawExactQuotePerBase: exactPriceRatio(request, {
        inAmount: sourceQuote.inAmount,
        outAmount: sourceQuote.outAmount
      }),
      priceRounding: isEntry
        ? "ceil_exact_USD_per_token_microUSD" : "floor_exact_USD_per_token_microUSD",
      amountProjection: {
        basis: "QUOTED_NET_ROUTE_AMOUNT_VALUE_WITH_ADDITIONAL_MODELED_COSTS; NOT_AN_EXECUTABLE_EXACT_SIZE_ROUTE",
        sourceQuotedInputAtoms: sourceQuote.inAmount,
        maximumModeledInputAtoms: result.modeledInputAtoms,
        sourceQuotedBaseAtoms: result.sourceQuotedBaseAtoms,
        maximumModeledBaseAtoms: result.modeledBaseAtoms,
        entryAllInLimitCents: isEntry ? PAPER_ENTRY_LIMIT_CENTS.toString() : null,
        equityLimitCents: isEntry ? equityCap.toString() : null,
        availableCashCents: isEntry ? availableCash.toString() : null,
        effectiveEntryBudgetCents: isEntry ? entryBudget.toString() : null,
        modeledAllInCents: isEntry ? result.afterCents : null,
        sizeDisposition: result.sizeDisposition
      },
      costBasis: QUOTED_NET_BASIS,
      costsCents: modeledCosts,
      costDisposition: {
        feeCents: assumptions.dispositions.fee,
        spreadCents: assumptions.dispositions.spread,
        slippageCents: assumptions.dispositions.slippage,
        priceImpactCents: assumptions.dispositions.priceImpact,
        networkCents: assumptions.dispositions.network
      },
      quoteValue: {
        quotedNetRouteAmountBasisCents: result.quotedNetBasisCents,
        direction: isEntry ? "DEBIT_ROUNDED_UP" : "CREDIT_ROUNDED_DOWN",
        totalAdditionalModeledCostsCents: result.totalCostsCents,
        afterAdditionalModeledCostsCents: result.afterCents,
        label: "MODELED_SINGLE_SIDE_QUOTE_VALUE_NOT_PNL"
      },
      pnl: {
        status: "NOT_COMPUTED_SINGLE_SIDE_PROJECTION",
        beforeExtraScenarioCostsCents: null,
        afterExtraScenarioCostsCents: null,
        reason: "A paired entry, exit, identity-bound marks, and scenario configuration are required."
      },
      provenance: "MODELED",
      authorizationEligible: false,
      executionRealistic: false,
      integrationEligible: false,
      integrationBoundary: "Independent evidence verification and unchanged Paper hard/risk gates are required."
    };
    return {result, projection};
  } catch {
    return null;
  }
}

function projectExplicitNetScenario(request, observation, parsed, sourceResponse) {
  const {config} = parsed;
  const route = observation.route;
  const observedAt = route?.observedAt;
  if (!route ||
      !sameIdentity(config.identity, request.identity) ||
      route.inAmount !== request.amountAtoms ||
      !sourceResponse?.sha256 || !SHA256.test(sourceResponse.sha256)) {
    return blockedScenarioProjection(["EXPLICIT_NET_QUOTE_BINDING_MISSING_OR_AMBIGUOUS"]);
  }

  const requestBinding = explicitNetRequestBinding(request);
  const requestSha256 = createHash("sha256")
    .update(canonicalJson(requestBinding)).digest("hex");

  const conversionReasons = [];
  const conversion = validConversion(config.quoteUsdConversion, {
    mint: request.identity.quote,
    decimals: request.quoteDecimals
  }, observedAt, conversionReasons, "quote");
  if (!conversion || conversionReasons.length > 0) {
    return blockedScenarioProjection(["EXPLICIT_NET_USD_CONVERSION_INVALID", ...conversionReasons]);
  }

  const binding = {
    modelId: EXPLICIT_NET_MODEL.id,
    modelVersion: EXPLICIT_NET_MODEL.version,
    status: EXPLICIT_NET_MODEL.status,
    provenance: EXPLICIT_NET_MODEL.provenance,
    scenarioConfigSha256: parsed.sha256,
    scenarioConfiguration: config,
    reviewEvidenceRecord: parsed.reviewEvidence,
    candidateIdentity: {...request.identity},
    side: request.side,
    request: {...requestBinding, sha256: requestSha256},
    sourceQuote: {
      source: SOURCE,
      requestId: route.requestId ?? null,
      observedAt,
      expiresAt: route.expiresAt,
      inAmount: route.inAmount,
      outAmount: route.outAmount,
      responseSha256: sourceResponse.sha256,
      responseByteLength: sourceResponse.byteLength
    },
    quoteBasis: QUOTED_NET_BASIS,
    quoteUsdConversion: conversion,
    result: null
  };
  const derived = deriveExplicitNetProjection(binding);
  if (!derived) return blockedScenarioProjection(["EXPLICIT_NET_PROJECTION_REVALIDATION_FAILED"]);
  binding.result = derived.result;
  const finalProjection = deriveExplicitNetProjection(binding);
  if (!finalProjection) return blockedScenarioProjection(["EXPLICIT_NET_PROJECTION_REVALIDATION_FAILED"]);
  return {
    ...finalProjection.projection,
    model: {
      binding,
      digest: paperExplicitNetModelDigest(binding),
      assumptions: [...EXPLICIT_NET_ASSUMPTIONS],
      resultContract: {...EXPLICIT_NET_RESULT_CONTRACT}
    }
  };
}

function copyRequest(value) {
  const request = copyRecord(value, [
    "identity", "side", "amountAtoms", "quoteDecimals", "candidateSampledAt",
    "authorizedAt", "positionOpenedAt", "slippageBps"
  ], "request");
  request.identity = copyRecord(request.identity,
    ["chainId", "mint", "pool", "quote", "decimals"], "identity");
  const identity = request.identity;
  if (identity.chainId !== "solana" || !BASE58.test(identity.mint ?? "") ||
      !BASE58.test(identity.pool ?? "") || !BASE58.test(identity.quote ?? "") ||
      !Number.isInteger(identity.decimals) || identity.decimals < 0 || identity.decimals > 18 ||
      !Number.isInteger(request.quoteDecimals) || request.quoteDecimals < 0 || request.quoteDecimals > 18) {
    throw new TypeError("Solana mint, selected pool, quote mint, and exact decimals are required");
  }
  if (!["ENTRY", "EXIT"].includes(request.side) ||
      typeof request.amountAtoms !== "string" || !INTEGER.test(request.amountAtoms) ||
      BigInt(request.amountAtoms) <= 0n) {
    throw new TypeError("side and positive raw input-token amount are required");
  }
  if (!validTime(request.candidateSampledAt) ||
      !Number.isInteger(request.slippageBps) ||
      request.slippageBps < 0 || request.slippageBps > 10_000) {
    throw new TypeError("candidate time and bounded slippage tolerance are required");
  }
  if (request.side === "ENTRY") {
    if (!validTime(request.authorizedAt) || Object.hasOwn(request, "positionOpenedAt")) {
      throw new TypeError("entry requires authorization time only");
    }
  } else if (!validTime(request.positionOpenedAt) || Object.hasOwn(request, "authorizedAt")) {
    throw new TypeError("exit requires position-open time only");
  }
  return request;
}

function unknownCosts(route = null) {
  const reported = route ? {
    totalFeeBps: route.feeBps,
    feeMint: route.feeMint,
    platformFee: route.platformFee,
    networkFeesLamports: route.reportedNetworkFeesLamports,
    priceImpact: route.priceImpact,
    slippageToleranceBps: route.slippageBps
  } : null;
  return {
    status: "UNKNOWN",
    components: Object.fromEntries(COSTS.map(component => [component, {
      status: "UNKNOWN",
      denomination: "USD cents",
      amount: null,
      reason: component === "spread"
        ? "SOURCE_DOES_NOT_REPORT_SPREAD_COST"
        : component === "slippage"
          ? "SLIPPAGE_TOLERANCE_IS_NOT_REALIZED_COST"
          : component === "priceImpact"
            ? "PERCENTAGE_REPORTED_WITHOUT_NONOVERLAPPING_USD_BENCHMARK"
            : component === "network"
              ? "LAMPORT_FEES_LACK_VERIFIED_USD_CONVERSION_AND_PAYER_SETTLEMENT"
              : "TOKEN_FEE_AMOUNT_LACKS_VERIFIED_USD_CONVERSION_AND_COMPLETE_FEE_SEMANTICS"
    }])),
    reported,
    conversionProvenance: {
      status: "MISSING",
      reason: "No same-quote, time-bound, source-verified USD conversions are available."
    },
    doubleCountingPolicy: "Never add feeBps, platformFee, priceImpact, slippage tolerance, min-out, or lamport amounts as independent USD costs."
  };
}

function emptyResult(status, reasons, request = null, scenarioProjection = null) {
  return {
    status,
    reasons: [...new Set(reasons)],
    provider: "Jupiter",
    source: SOURCE,
    sourceProvenance: "INJECTED_TRANSPORT_NOT_AUTHENTICATED",
    request: request ? {
      side: request.side,
      amountAtoms: request.amountAtoms,
      amountMint: request.side === "ENTRY" ? request.identity.quote : request.identity.mint,
      amountDecimals: request.side === "ENTRY" ? request.quoteDecimals : request.identity.decimals,
      identity: {...request.identity}
    } : null,
    quoteCandidate: null,
    costEvidence: unknownCosts(),
    authorizationEligible: false,
    scenarioProjection
  };
}

function gcd(left, right) {
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function exactPriceRatio(request, route) {
  const baseAtoms = BigInt(request.side === "ENTRY" ? route.outAmount : route.inAmount);
  const quoteAtoms = BigInt(request.side === "ENTRY" ? route.inAmount : route.outAmount);
  const numerator = quoteAtoms * 10n ** BigInt(request.identity.decimals);
  const denominator = baseAtoms * 10n ** BigInt(request.quoteDecimals);
  const divisor = gcd(numerator, denominator);
  return {
    numerator: (numerator / divisor).toString(),
    denominator: (denominator / divisor).toString(),
    unit: "quote-token per base-token",
    source: "exact raw inAmount/outAmount and caller-supplied decimals; not a USD price"
  };
}

function buildCandidate(request, observation) {
  const {route, routeBinding} = observation;
  const routeIsBound = routeBinding?.status === "SINGLE_POOL_MATCH";
  const receivedAt = route.observedAt;
  const causalAt = request.side === "ENTRY" ? request.authorizedAt : request.positionOpenedAt;
  const reasons = [
    "USD_PRICE_UNAVAILABLE",
    "COMPLETE_NONOVERLAPPING_COSTS_UNAVAILABLE",
    "SOURCE_AND_RECEIPT_CLOCKS_NOT_AUTHENTICATED",
    "QUOTE_IS_NOT_A_FILL_OR_EXECUTION_RECEIPT"
  ];
  if (!routeIsBound) reasons.push("SELECTED_POOL_ROUTE_NOT_IDENTITY_BOUND");
  if (!validTime(receivedAt) || receivedAt <= causalAt ||
      receivedAt <= request.candidateSampledAt) reasons.push("POST_RESPONSE_CHRONOLOGY_INVALID");
  if (validTime(receivedAt) &&
      (receivedAt - causalAt > MAX_CAUSAL_AGE_MS ||
       receivedAt - request.candidateSampledAt > MAX_CAUSAL_AGE_MS)) {
    reasons.push("CAUSAL_REFERENCE_STALE");
  }
  if (route.expiresAt <= receivedAt) reasons.push("QUOTE_EXPIRED");

  const candidate = {
    status: "UNAVAILABLE",
    mode: "HYPOTHETICAL",
    executable: false,
    identity: {...request.identity},
    side: request.side,
    amount: {
      unit: "raw token base units",
      atoms: request.amountAtoms,
      mint: request.side === "ENTRY" ? request.identity.quote : request.identity.mint,
      decimals: request.side === "ENTRY" ? request.quoteDecimals : request.identity.decimals
    },
    routeAmounts: {
      inputMint: route.inputMint,
      inputAtoms: route.inAmount,
      inputDecimals: request.side === "ENTRY" ? request.quoteDecimals : request.identity.decimals,
      outputMint: route.outputMint,
      outputAtoms: route.outAmount,
      outputDecimals: request.side === "ENTRY" ? request.identity.decimals : request.quoteDecimals
    },
    priceQuotePerBase: exactPriceRatio(request, route),
    priceMicros: null,
    source: SOURCE,
    sourceTime: {status: "NOT_PROVIDED_BY_DOCUMENTED_RESPONSE", value: null},
    receiptTime: {
      observedAt: receivedAt,
      provenance: "INJECTED_LOCAL_CLOCK_AFTER_RESPONSE_BODY; NOT_AUTHENTICATED"
    },
    causalTime: {side: request.side, observedAt: causalAt},
    route: {
      router: route.router,
      selectedPool: request.identity.pool,
      binding: routeBinding,
      requestId: route.requestId,
      providerExpiry: route.providerExpiresAt,
      expiresAt: route.expiresAt,
      expirySource: route.expirySource,
      priceImpact: route.priceImpact,
      slippageToleranceBps: route.slippageBps,
      minimumOutput: route.minOutAmount,
      minimumOutputConsistency: route.minimumOutputConsistency
    },
    costs: unknownCosts(route),
    eventId: route.requestId ?? `jupiter-order-${receivedAt}`
  };
  return {candidate, reasons};
}

const COST_RECEIPT_SCHEMA = "memecoin-paper-quote-cost-receipt-v1";
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000n;
const MICRO_USD_PER_USD = 1_000_000n;
const ROUTE_AMOUNT_BASIS = "GROSS_BEFORE_ALL_COSTS";
const INCLUSION_BASIS = Object.freeze({
  fee: "EXPLICIT_PROTOCOL_AND_PLATFORM_FEE_ONLY",
  spread: "BID_ASK_SPREAD_ONLY",
  slippage: "REALIZED_SHORTFALL_VS_QUOTED_PRICE_ONLY",
  priceImpact: "DEPTH_IMPACT_VS_MID_BENCHMARK_ONLY",
  network: "PAYER_SETTLED_LAMPORTS_ONLY"
});
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion", "evidenceLabel", "evidenceId", "source", "responseSha256",
  "responseByteLength", "quoteRequestId", "identity", "side", "quoteObservedAt",
  "observedAt", "amountUnit", "routeAmountBasis", "inclusion", "conversions",
  "network", "microUsd"
]);
const CONVERSION_KEYS = Object.freeze([
  "mint", "decimals", "microUsdPerWholeToken", "observedAt", "method", "evidenceSha256"
]);

function costRejection(reasons) {
  return {
    status: "REJECTED",
    reasons: [...new Set(reasons)],
    costsCents: null,
    totalCents: null,
    provenance: "CALLER_ASSERTED_NOT_SOURCE_VERIFIED",
    authorizationEligible: false
  };
}

function validConversion(value, expected, receiptTime, reasons, label) {
  let conversion;
  try {
    conversion = copyPlainRecord(value, CONVERSION_KEYS, label);
  } catch {
    reasons.push(`COST_CONVERSION_MISSING_OR_MALFORMED:${label}`);
    return null;
  }
  if (conversion.mint !== expected.mint || conversion.decimals !== expected.decimals) {
    reasons.push(`COST_CONVERSION_IDENTITY_MISMATCH:${label}`);
  }
  if (typeof conversion.microUsdPerWholeToken !== "string" ||
      !INTEGER.test(conversion.microUsdPerWholeToken) ||
      BigInt(conversion.microUsdPerWholeToken) <= 0n) {
    reasons.push(`COST_CONVERSION_UNITS_INVALID:${label}`);
  }
  if (conversion.method !== "MEASURED_SOURCE_RECEIPT" ||
      typeof conversion.evidenceSha256 !== "string" || !SHA256.test(conversion.evidenceSha256)) {
    reasons.push(`COST_CONVERSION_NOT_MEASURED_AND_DIGEST_BOUND:${label}`);
  }
  if (!validTime(conversion.observedAt) || conversion.observedAt > receiptTime) {
    reasons.push(`COST_CONVERSION_TIME_INVALID_OR_FUTURE:${label}`);
  } else if (receiptTime - conversion.observedAt > MAX_CAUSAL_AGE_MS) {
    reasons.push(`COST_CONVERSION_STALE:${label}`);
  }
  return conversion;
}

function validateCostReceipt(value, snapshot, now) {
  const reasons = [];
  let receipt;
  try {
    receipt = copyPlainRecord(value, RECEIPT_KEYS, "cost receipt");
  } catch {
    return costRejection(["COST_RECEIPT_MALFORMED_OR_UNSUPPORTED_FIELD"]);
  }
  if (RECEIPT_KEYS.some(key => !Object.hasOwn(receipt, key))) {
    return costRejection(["COST_RECEIPT_FIELD_MISSING"]);
  }
  const {request, route, observedAt, response, unsafeReasons} = snapshot;
  if (receipt.schemaVersion !== COST_RECEIPT_SCHEMA) reasons.push("COST_RECEIPT_SCHEMA_UNSUPPORTED");
  if (typeof receipt.evidenceId !== "string" || !SAFE_ID.test(receipt.evidenceId) ||
      typeof receipt.evidenceLabel !== "string" || !SAFE_ID.test(receipt.evidenceLabel)) {
    reasons.push("COST_RECEIPT_LABEL_OR_ID_INVALID");
  }
  if (receipt.source !== SOURCE) reasons.push("COST_SOURCE_MISMATCH");
  if (typeof receipt.responseSha256 !== "string" || !SHA256.test(receipt.responseSha256)) {
    reasons.push("COST_RESPONSE_DIGEST_MISSING_OR_MALFORMED");
  } else if (!response.complete || receipt.responseSha256 !== response.sha256 ||
             receipt.responseByteLength !== response.byteLength) {
    reasons.push("COST_RESPONSE_DIGEST_MISMATCH");
  }
  if (receipt.quoteRequestId !== route.requestId) reasons.push("COST_REQUEST_ID_MISMATCH");
  if (receipt.side !== request.side) reasons.push("COST_SIDE_MISMATCH");
  try {
    const identity = copyPlainRecord(receipt.identity,
      ["chainId", "mint", "pool", "quote", "decimals"], "identity");
    if (!sameIdentity(identity, request.identity)) reasons.push("COST_IDENTITY_MISMATCH");
  } catch {
    reasons.push("COST_IDENTITY_MISMATCH");
  }
  if (receipt.quoteObservedAt !== observedAt) reasons.push("COST_QUOTE_TIME_MISMATCH");
  if (receipt.observedAt !== observedAt) reasons.push("COST_TIME_NOT_BOUND_TO_QUOTE_RECEIPT");
  if (!validTime(now) || now < observedAt) reasons.push("COST_CLOCK_INVALID");
  else if (now >= route.expiresAt) reasons.push("COST_QUOTE_EXPIRED");
  if (unsafeReasons.length > 0) reasons.push("COST_QUOTE_NOT_CAUSAL_AND_IDENTITY_BOUND");
  if (receipt.amountUnit !== "MICRO_USD") reasons.push("COST_UNIT_UNSUPPORTED");
  if (receipt.routeAmountBasis !== ROUTE_AMOUNT_BASIS) reasons.push("COST_ROUTE_BASIS_OVERLAPS_COMPONENTS");
  try {
    const inclusion = copyPlainRecord(receipt.inclusion, COSTS, "inclusion");
    for (const component of COSTS) {
      if (inclusion[component] !== INCLUSION_BASIS[component]) {
        reasons.push(`COST_INCLUSION_BASIS_UNSUPPORTED:${component}`);
      }
    }
  } catch {
    reasons.push("COST_INCLUSION_BASIS_MISSING_OR_MALFORMED");
  }

  let conversions = null;
  try {
    conversions = copyPlainRecord(receipt.conversions, ["quote", "sol"], "conversions");
  } catch {
    reasons.push("COST_CONVERSIONS_MISSING_OR_MALFORMED");
  }
  const quoteConversion = conversions && validConversion(conversions.quote,
    {mint: request.identity.quote, decimals: request.quoteDecimals}, observedAt, reasons, "quote");
  const solConversion = conversions && validConversion(conversions.sol,
    {mint: WRAPPED_SOL_MINT, decimals: 9}, observedAt, reasons, "sol");

  let microUsd = null;
  try {
    microUsd = copyPlainRecord(receipt.microUsd, COSTS, "microUsd");
    for (const component of COSTS) {
      if (!Object.hasOwn(microUsd, component)) reasons.push(`COST_COMPONENT_MISSING:${component}`);
      else if (typeof microUsd[component] !== "string" || !INTEGER.test(microUsd[component])) {
        reasons.push(`COST_COMPONENT_NOT_EXACT_MICRO_USD_INTEGER_STRING:${component}`);
      }
    }
  } catch {
    reasons.push("COST_COMPONENTS_MISSING_OR_UNSUPPORTED");
  }

  let network = null;
  try {
    network = copyPlainRecord(receipt.network, ["lamports", "payerSettled"], "network");
  } catch {
    reasons.push("COST_NETWORK_BASIS_MISSING_OR_MALFORMED");
  }
  if (network && (typeof network.lamports !== "string" || !INTEGER.test(network.lamports) ||
      network.payerSettled !== true)) {
    reasons.push("COST_NETWORK_NOT_PAYER_SETTLED_LAMPORTS");
  } else if (network && microUsd && typeof microUsd.network === "string" &&
             INTEGER.test(microUsd.network) && solConversion &&
             typeof solConversion.microUsdPerWholeToken === "string" &&
             INTEGER.test(solConversion.microUsdPerWholeToken) &&
             BigInt(solConversion.microUsdPerWholeToken) > 0n &&
             ceilDiv(BigInt(network.lamports) * BigInt(solConversion.microUsdPerWholeToken),
               LAMPORTS_PER_SOL) !== BigInt(microUsd.network)) {
    reasons.push("COST_NETWORK_USD_CONVERSION_INCONSISTENT");
  }
  if (reasons.length > 0 || !quoteConversion) return costRejection(reasons);

  const normalized = normalizeExactCosts({
    source: receipt.source,
    binding: {...request.identity},
    observedAt: receipt.observedAt,
    microUsd
  }, {
    identity: request.identity,
    quoteSource: SOURCE,
    quoteObservedAt: observedAt,
    now
  });
  if (normalized.status !== "NORMALIZED_UNVERIFIED") return costRejection(normalized.reasons);
  return {
    status: "STRUCTURALLY_VALID_UNAUTHENTICATED",
    reasons: [],
    evidenceLabel: receipt.evidenceLabel,
    evidenceId: receipt.evidenceId,
    costsCents: normalized.costsCents,
    totalCents: normalized.totalCents,
    rounding: normalized.rounding,
    conversionProvenance: {
      quoteMint: quoteConversion.mint,
      quoteMicroUsdPerWholeToken: quoteConversion.microUsdPerWholeToken,
      quoteEvidenceSha256: quoteConversion.evidenceSha256,
      quoteObservedAt: quoteConversion.observedAt,
      solEvidenceSha256: solConversion.evidenceSha256,
      solObservedAt: solConversion.observedAt
    },
    responseSha256: receipt.responseSha256,
    provenance: "CALLER_ASSERTED_NOT_SOURCE_VERIFIED",
    authorizationEligible: false,
    executionRealistic: false
  };
}

function abortableTransport(transport, getExternalSignal, acquireDigest) {
  return async (url, init) => {
    const external = getExternalSignal();
    const digest = acquireDigest();
    const controller = new AbortController();
    const abort = () => controller.abort();
    const signals = [init.signal, external].filter(Boolean);
    for (const signal of signals) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, {once: true});
    }
    let response;
    try {
      response = await transport(url, {...init, signal: controller.signal});
      if (!response?.body?.getReader) return response;
      const reader = response.body.getReader();
      let done = false;
      const cleanup = () => {
        done = true;
        for (const signal of signals) signal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        if (done) return;
        try {
          void Promise.resolve(reader.cancel()).catch(() => {});
        } catch {
          return;
        }
      };
      for (const signal of signals) signal.addEventListener("abort", cancel, {once: true});
      const body = new ReadableStream({
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              if (!digest.fenced) digest.complete = true;
              cleanup();
              stream.close();
            } else {
              if (!digest.fenced) {
                if (chunk.value instanceof Uint8Array) {
                  digest.hash.update(chunk.value);
                  digest.byteLength += chunk.value.byteLength;
                } else {
                  digest.invalid = true;
                }
              }
              stream.enqueue(chunk.value);
            }
          } catch (error) {
            cleanup();
            stream.error(error);
          }
        },
        async cancel(reason) {
          cleanup();
          await reader.cancel(reason);
        }
      });
      return {
        status: response.status,
        redirected: response.redirected,
        url: response.url,
        headers: response.headers,
        body
      };
    } finally {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    }
  };
}

const genuineAdapters = new WeakSet();
const fixtureAdapters = new WeakSet();

export function isMarketQuoteAdapter(value) {
  return value !== null && typeof value === "object" && genuineAdapters.has(value);
}

export function isFixtureMarketQuoteAdapter(value) {
  return value !== null && typeof value === "object" && fixtureAdapters.has(value);
}

const MODELED_FIXTURE_SOURCE = "SYNTHETIC_FIXTURE_ONLY";
const POLICY_KEYS = Object.freeze([
  "runId", "runStartedAt", "runEndAt", "sourcePolicySha256", "modelVersion",
  "scenarioConfigSha256", "usdAssumption"
]);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function copyModeledPolicy(value) {
  const policy = copyPlainRecord(value, POLICY_KEYS, "modeled policy");
  if (POLICY_KEYS.some(key => !Object.hasOwn(policy, key)) ||
      typeof policy.runId !== "string" || !SAFE_ID.test(policy.runId) ||
      !validTime(policy.runStartedAt) || !validTime(policy.runEndAt) ||
      policy.runEndAt <= policy.runStartedAt ||
      typeof policy.sourcePolicySha256 !== "string" || !SHA256.test(policy.sourcePolicySha256) ||
      policy.modelVersion !== QUOTED_NET_MODEL.version ||
      typeof policy.scenarioConfigSha256 !== "string" || !SHA256.test(policy.scenarioConfigSha256) ||
      policy.usdAssumption !== QUOTED_NET_MODEL.currencyAssumption) {
    throw new TypeError("modeled policy is incomplete, mismatched, or outside the supported model");
  }
  return Object.freeze({...policy});
}

export function createMarketQuoteAdapter(options = {}) {
  const adapter = buildMarketQuoteAdapter(options);
  genuineAdapters.add(adapter);
  return adapter;
}

// Module-owned fixture authority: only this factory marks an adapter as fixture-capable.
export function createFixtureMarketQuoteAdapter(options = {}) {
  const adapter = buildMarketQuoteAdapter({...options, enabled: true});
  genuineAdapters.add(adapter);
  fixtureAdapters.add(adapter);
  return adapter;
}

function buildMarketQuoteAdapter({
  enabled = false,
  transport,
  clock = Date.now,
  timeoutMs = 1_500,
  maxRequests = MAX_REQUESTS
} = {}) {
  if (enabled !== true) {
    return Object.freeze({
      async getPaperQuote() {
        return emptyResult("DISABLED", ["ADAPTER_DISABLED"]);
      },
      validateCostReceipt() {
        return costRejection(["ADAPTER_DISABLED"]);
      },
      issueModeledQuote() {
        return Object.freeze({ok: false, reason: "ADAPTER_DISABLED"});
      },
      confirmModeledQuote() {
        return false;
      }
    });
  }
  if (typeof transport !== "function" || typeof clock !== "function" ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS ||
      !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUESTS) {
    throw new TypeError("enabled adapter requires injected transport, clock, and bounded request/time budgets");
  }

  let externalSignal = null;
  let inFlight = false;
  let requestsStarted = 0;
  let digest = null;
  const issued = new WeakMap();
  const handoffs = new Map();
  const source = createJupiterV2QuoteAdapter({
    enabled: true,
    clock,
    timeoutMs,
    transport: abortableTransport(transport, () => externalSignal,
      () => digest ?? {fenced: true})
  });

  const adapter = Object.freeze({
    issueModeledQuote(original, expected) {
      return issueModeled({
        adapter, issued, handoffs, clock, original, expected, maxRequests
      });
    },
    confirmModeledQuote(quote) {
      try {
        const stored = handoffs.get(quote?.modeled?.digest);
        const {eventId: _eventId, ...bare} = quote;
        return stored !== undefined && stored === canonicalJson(bare);
      } catch {
        return false;
      }
    },
    validateCostReceipt(quoteResult, receipt) {
      const snapshot = isRecord(quoteResult) ? issued.get(quoteResult) : undefined;
      if (!snapshot) return costRejection(["COST_QUOTE_RESULT_NOT_ISSUED_BY_THIS_ADAPTER"]);
      let now;
      try {
        now = clock();
      } catch {
        return costRejection(["COST_CLOCK_INVALID"]);
      }
      return validateCostReceipt(receipt, snapshot, now);
    },
    async getPaperQuote(value, {signal, reviewScenario} = {}) {
      if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function")) {
        return emptyResult("UNAVAILABLE", ["ABORT_SIGNAL_INVALID"]);
      }
      let parsedScenario = null;
      if (reviewScenario !== undefined) {
        try {
          parsedScenario = {parsed: scenarioConfig(reviewScenario)};
        } catch {
          parsedScenario = {error: true};
        }
      }
      let request;
      try {
        request = copyRequest(value);
      } catch {
        return emptyResult("UNAVAILABLE", ["REQUEST_INVALID"], null,
          unavailableScenario(parsedScenario, "SCENARIO_REQUEST_INVALID"));
      }
      if (signal?.aborted) {
        return emptyResult("UNAVAILABLE", ["REQUEST_CANCELLED"], request,
          unavailableScenario(parsedScenario, "SCENARIO_REQUEST_CANCELLED"));
      }
      if (inFlight) {
        return emptyResult("UNAVAILABLE", ["REQUEST_ALREADY_IN_FLIGHT"], request,
          unavailableScenario(parsedScenario, "SCENARIO_REQUEST_ALREADY_IN_FLIGHT"));
      }
      if (requestsStarted >= maxRequests) {
        return emptyResult("UNAVAILABLE", ["REQUEST_BUDGET_EXHAUSTED"], request,
          unavailableScenario(parsedScenario, "SCENARIO_REQUEST_BUDGET_EXHAUSTED"));
      }
      inFlight = true;
      requestsStarted += 1;
      externalSignal = signal ?? null;
      const requestDigest = {
        hash: createHash("sha256"), byteLength: 0, complete: false, invalid: false, fenced: false
      };
      digest = requestDigest;
      try {
        const amountMint = request.side === "ENTRY" ? request.identity.quote : request.identity.mint;
        const outputMint = request.side === "ENTRY" ? request.identity.mint : request.identity.quote;
        const observed = await source.getQuote({
          identity: request.identity,
          inputMint: amountMint,
          outputMint,
          inputDecimals: request.side === "ENTRY" ? request.quoteDecimals : request.identity.decimals,
          outputDecimals: request.side === "ENTRY" ? request.identity.decimals : request.quoteDecimals,
          amount: request.amountAtoms,
          slippageBps: request.slippageBps,
          candidateSampledAt: request.candidateSampledAt,
          authorizedAt: request.side === "ENTRY" ? request.authorizedAt : request.positionOpenedAt
        });
        if (signal?.aborted) {
          return emptyResult("UNAVAILABLE", ["REQUEST_CANCELLED"], request,
            unavailableScenario(parsedScenario, "SCENARIO_REQUEST_CANCELLED"));
        }
        if (!observed.route) {
          return emptyResult("UNAVAILABLE", observed.reasons, request,
            unavailableScenario(parsedScenario, "SCENARIO_SOURCE_QUOTE_NOT_CAUSAL_AND_BOUND"));
        }
        const {candidate, reasons} = buildCandidate(request, observed);
        const sourceResponse = requestDigest.complete && !requestDigest.invalid ? {
          status: "OBSERVED_RAW_BODY_DIGEST",
          sha256: requestDigest.hash.digest("hex"),
          byteLength: requestDigest.byteLength,
          provenance: "SHA256_OF_BYTES_READ_BY_ADAPTER; NOT_PROVIDER_AUTHENTICATED"
        } : {status: "UNAVAILABLE", sha256: null, byteLength: null};
        const scenarioProjection = projectReviewScenario(
          request, observed, reasons, parsedScenario, sourceResponse
        );
        candidate.sourceResponse = sourceResponse;
        const result = {
          status: "UNAVAILABLE",
          reasons: [...new Set([...observed.reasons, ...reasons])],
          provider: "Jupiter",
          source: SOURCE,
          sourceProvenance: observed.sourceProvenance,
          request: {
            side: request.side,
            amountAtoms: request.amountAtoms,
            amountMint,
            inputDecimals: request.side === "ENTRY" ? request.quoteDecimals : request.identity.decimals,
            outputDecimals: request.side === "ENTRY" ? request.identity.decimals : request.quoteDecimals,
            identity: {...request.identity}
          },
          quoteCandidate: candidate,
          costEvidence: candidate.costs,
          authorizationEligible: false,
          scenarioProjection
        };
        issued.set(result, {
          request,
          projection: scenarioProjection?.model ? deepFreeze(structuredClone(scenarioProjection)) : null,
          projectionCanonical: scenarioProjection?.model ? canonicalJson(scenarioProjection) : null,
          route: {requestId: observed.route.requestId ?? null, expiresAt: observed.route.expiresAt},
          observedAt: observed.route.observedAt,
          response: {
            complete: sourceResponse.sha256 !== null,
            sha256: sourceResponse.sha256,
            byteLength: sourceResponse.byteLength
          },
          unsafeReasons: reasons.filter(reason => [
            "SELECTED_POOL_ROUTE_NOT_IDENTITY_BOUND", "POST_RESPONSE_CHRONOLOGY_INVALID",
            "CAUSAL_REFERENCE_STALE", "QUOTE_EXPIRED"
          ].includes(reason))
        });
        return result;
      } catch {
        return emptyResult("UNAVAILABLE", ["QUOTE_ADAPTER_ERROR"], request,
          unavailableScenario(parsedScenario, "SCENARIO_QUOTE_ADAPTER_ERROR"));
      } finally {
        requestDigest.fenced = true;
        digest = null;
        inFlight = false;
        externalSignal = null;
      }
    }
  });
  return adapter;
}

function issueModeled({adapter, issued, handoffs, clock, original, expected, maxRequests}) {
  const refuse = reason => Object.freeze({ok: false, reason});
  try {
    if (!fixtureAdapters.has(adapter)) return refuse("ADAPTER_HAS_NO_FIXTURE_AUTHORITY");
    const snapshot = isRecord(original) ? issued.get(original) : undefined;
    if (!snapshot?.projection) return refuse("RESULT_NOT_ISSUED_BY_THIS_ADAPTER");
    if (canonicalJson(original.scenarioProjection) !== snapshot.projectionCanonical) {
      return refuse("RESULT_MUTATED_AFTER_ISSUANCE");
    }
    const policy = copyModeledPolicy(expected?.policy);
    const projection = snapshot.projection;
    const verified = verifyPaperQuotedNetProjection(projection);
    if (!verified.valid) return refuse("MODEL_PROJECTION_INVALID");
    const binding = projection.model.binding;
    const request = snapshot.request;
    const side = expected?.side;
    if ((side !== "ENTRY" && side !== "EXIT") || request.side !== side ||
        typeof expected.amountAtoms !== "string" || request.amountAtoms !== expected.amountAtoms ||
        !sameIdentity(request.identity, expected.identity) ||
        !sameIdentity(projection.identity, expected.identity) ||
        binding.scenarioConfigSha256 !== policy.scenarioConfigSha256 ||
        binding.modelVersion !== policy.modelVersion ||
        binding.currency.assumption !== policy.usdAssumption) {
      return refuse("RESULT_DOES_NOT_MATCH_EXPECTED_IDENTITY_SIDE_AMOUNT_OR_POLICY");
    }
    const observedAt = binding.sourceQuote.observedAt;
    const expiresAt = binding.sourceQuote.expiresAt;
    const now = clock();
    if (!validTime(now) || !validTime(observedAt) || !validTime(expiresAt) ||
        observedAt < policy.runStartedAt || observedAt > policy.runEndAt ||
        now < observedAt || now > expiresAt || now > policy.runEndAt) {
      return refuse("QUOTE_OUTSIDE_RUN_WINDOW_OR_EXPIRED");
    }
    if (handoffs.size >= maxRequests) return refuse("HANDOFF_BUDGET_EXHAUSTED");
    const costs = projection.costsCents;
    const facts = {
      schema: "PAPER_MODELED_QUOTE_V1",
      provenance: "MODELED",
      actualCostCoverage: "UNKNOWN",
      executionRealistic: false,
      runId: policy.runId,
      runStartedAt: policy.runStartedAt,
      runEndAt: policy.runEndAt,
      sourcePolicySha256: policy.sourcePolicySha256,
      modelId: binding.modelId,
      modelVersion: binding.modelVersion,
      modelDigest: projection.model.digest,
      scenarioConfigSha256: binding.scenarioConfigSha256,
      usdAssumption: binding.currency.assumption,
      side,
      baseAtoms: binding.quantity.modeledBaseAtoms,
      sourceCapBaseAtoms: binding.quantity.sourceQuotedBaseAtoms,
      adverseAdjustmentBps: projection.scenario.adverseAdjustmentBps,
      networkReserveCents: projection.scenario.networkReserveCents,
      responseSha256: binding.sourceQuote.responseSha256,
      expiresAt,
      sourceObservedAt: observedAt,
      digest: ""
    };
    const quote = {
      fixtureOnly: true,
      source: MODELED_FIXTURE_SOURCE,
      chainId: expected.identity.chainId,
      mint: expected.identity.mint,
      pool: expected.identity.pool,
      quote: expected.identity.quote,
      decimals: expected.identity.decimals,
      observedAt,
      priceMicros: projection.priceMicros,
      mode: "HYPOTHETICAL",
      executable: true,
      costs: {
        feeCents: costs.feeCents, spreadCents: costs.spreadCents,
        slippageCents: costs.slippageCents, priceImpactCents: costs.priceImpactCents,
        networkCents: costs.networkCents
      },
      modeled: facts
    };
    facts.digest = paperModeledQuoteDigest(facts, quote, expected.identity.decimals);
    deepFreeze(quote);
    handoffs.set(facts.digest, canonicalJson(quote));
    return Object.freeze({ok: true, quote});
  } catch {
    return refuse("MODELED_ISSUANCE_FAILED");
  }
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function recomputeQuotedNetBinding(b) {
  try {
    if (!isRecord(b) || !isRecord(b.candidateIdentity) || !isRecord(b.sourceQuote)) return null;
    const id = b.candidateIdentity;
    const sq = b.sourceQuote;
    const identity = {
      chainId: id.chainId, mint: id.mint, pool: id.pool, quote: id.quote, decimals: id.decimals
    };
    const side = b.side;
    if (!exactKeys(id, Object.keys(identity)) || identity.chainId !== "solana" ||
        typeof identity.mint !== "string" || !BASE58.test(identity.mint) ||
        typeof identity.pool !== "string" || !BASE58.test(identity.pool) ||
        identity.quote !== SOLANA_USDC_MINT ||
        !Number.isInteger(identity.decimals) || identity.decimals < 0 || identity.decimals > 18 ||
        !["ENTRY", "EXIT"].includes(side) ||
        !exactKeys(sq, ["source", "requestId", "observedAt", "expiresAt", "inAmount", "outAmount",
          "responseSha256", "responseByteLength"]) ||
        sq.source !== SOURCE ||
        !(sq.requestId === null || (typeof sq.requestId === "string" && sq.requestId.length <= 200)) ||
        !validTime(sq.observedAt) || !validTime(sq.expiresAt) ||
        typeof sq.inAmount !== "string" || !INTEGER.test(sq.inAmount) ||
        typeof sq.outAmount !== "string" || !INTEGER.test(sq.outAmount) ||
        typeof sq.responseSha256 !== "string" || !SHA256.test(sq.responseSha256) ||
        !Number.isSafeInteger(sq.responseByteLength) || sq.responseByteLength <= 0) {
      return null;
    }
    const config = scenarioConfig({
      optIn: true,
      scenarioId: SCENARIO_CASES[QUOTED_NET_CASE].scenarioId,
      scenarioVersion: SCENARIO_VERSION,
      scenario: QUOTED_NET_CASE,
      identity,
      usdcMint: SOLANA_USDC_MINT,
      usdcDecimals: 6,
      usdcUsdMicrosPerToken: "1000000",
      quoteBasis: QUOTED_NET_BASIS,
      adverseAdjustmentBps: 300,
      networkReserveCents: "50",
      feeCents: "0",
      spreadCents: "0",
      priceImpactCents: "0",
      zeroChargeDisposition: NO_INCREMENTAL_CHARGE
    });
    const entry = side === "ENTRY";
    const baseAtoms = BigInt(entry ? sq.outAmount : sq.inAmount);
    const quoteAtoms = BigInt(entry ? sq.inAmount : sq.outAmount);
    if (baseAtoms <= 0n) return null;
    const baseScale = 10n ** BigInt(identity.decimals);
    const priceNumerator = quoteAtoms * 1_000_000n * baseScale;
    const priceDenominator = baseAtoms * 1_000_000n;
    const priceMicros = entry
      ? ceilDiv(priceNumerator, priceDenominator) : priceNumerator / priceDenominator;
    if (priceMicros <= 0n || priceMicros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const reserve = 50n;
    let modeledBase;
    let modeledQuote;
    if (entry) {
      modeledBase = maximumEntryBaseAtoms(baseAtoms, priceMicros, baseScale, 300n, reserve);
      if (modeledBase <= 0n) return null;
      modeledQuote = ceilDiv(quoteAtoms * modeledBase, baseAtoms);
      if (modeledQuote > quoteAtoms) return null;
    } else {
      modeledBase = baseAtoms;
      modeledQuote = baseAtoms;
    }
    const gross = grossCentsAtPrice(modeledBase, priceMicros, baseScale, side);
    const slippage = slippageCentsAtGross(gross, 300n);
    const total = slippage + reserve;
    if (!entry && total > gross) return null;
    const after = entry ? gross + total : gross - total;
    const binding = {
      modelId: QUOTED_NET_MODEL.id,
      modelVersion: QUOTED_NET_MODEL.version,
      status: QUOTED_NET_MODEL.status,
      provenance: QUOTED_NET_MODEL.provenance,
      parameterStatus: QUOTED_NET_MODEL.parameterStatus,
      formula: QUOTED_NET_MODEL.formula,
      scenarioConfigSha256: config.sha256,
      parameters: {
        adverseAdjustmentBps: {value: 300, unit: "basis_points_of_ledger_gross_cents_ceil"},
        networkReserveCents: {value: "50", unit: "us_cents_per_side"},
        feeCents: {value: "0", unit: "additional_us_cents"},
        spreadCents: {value: "0", unit: "additional_us_cents"},
        priceImpactCents: {value: "0", unit: "additional_us_cents"}
      },
      currency: {
        mint: SOLANA_USDC_MINT,
        decimals: 6,
        microUsdPerToken: "1000000",
        assumption: QUOTED_NET_MODEL.currencyAssumption
      },
      quoteBasis: QUOTED_NET_BASIS,
      dispositions: {...QUOTED_NET_MODEL.dispositions},
      candidateIdentity: identity,
      side,
      quantity: {
        modeledBaseAtoms: modeledBase.toString(),
        modeledInputAtoms: (entry ? modeledQuote : modeledBase).toString(),
        sourceQuotedBaseAtoms: baseAtoms.toString(),
        sourceQuotedInputAtoms: sq.inAmount,
        sizeDisposition: modeledBase === baseAtoms
          ? "QUOTED_AMOUNT" : "SMALLER_SIZE_MODELED_NOT_A_FRESH_EXECUTABLE_QUOTE"
      },
      sourceQuote: {...sq},
      result: {
        priceMicros: priceMicros.toString(),
        grossCents: gross.toString(),
        slippageCents: slippage.toString(),
        networkCents: "50",
        totalExtraCents: total.toString(),
        afterCents: after.toString()
      }
    };
    const exposure = {
      status: "REVIEW_PROJECTION_ONLY",
      scenarioCostCoverage: "COMPLETE",
      actualCostCoverage: "UNKNOWN",
      identity,
      source: SOURCE,
      sourceProvenance: "INJECTED_TRANSPORT_NOT_AUTHENTICATED",
      side,
      receiptTime: sq.observedAt,
      receiptTimeProvenance: "INJECTED_LOCAL_CLOCK_AFTER_RESPONSE_BODY; NOT_AUTHENTICATED",
      priceMicros: Number(priceMicros),
      rawExactQuotePerBase: exactPriceRatio(
        {side, identity, quoteDecimals: 6}, {inAmount: sq.inAmount, outAmount: sq.outAmount}
      ),
      priceRounding: entry
        ? "ceil_exact_USD_per_token_microUSD" : "floor_exact_USD_per_token_microUSD",
      amountProjection: {
        basis: "ROUTE_CAP_WITH_MODELED_VALUE_AND_COSTS_FROM_PUBLISHED_ROUNDED_PRICE; NOT_AN_EXECUTABLE_EXACT_SIZE_ROUTE",
        sourceQuotedInputAtoms: sq.inAmount,
        maximumModeledInputAtoms: (entry ? modeledQuote : modeledBase).toString(),
        sourceQuotedBaseAtoms: baseAtoms.toString(),
        maximumModeledBaseAtoms: modeledBase.toString(),
        entryAllInLimitCents: entry ? PAPER_ENTRY_LIMIT_CENTS.toString() : null,
        dynamicRiskCaps: "NOT_EVALUATED; existing authorization, equity, cash, and hard evidence gates remain unchanged",
        modeledAllInCents: entry ? after.toString() : null
      },
      costBasis: QUOTED_NET_BASIS,
      costsCents: {
        feeCents: "0",
        spreadCents: "0",
        slippageCents: slippage.toString(),
        priceImpactCents: "0",
        networkCents: "50"
      },
      costDisposition: {
        feeCents: NO_INCREMENTAL_CHARGE,
        spreadCents: NO_INCREMENTAL_CHARGE,
        slippageCents: "EXPERIMENTAL_ADVERSE_SCENARIO_ADJUSTMENT_ROUNDED_UP",
        priceImpactCents: NO_INCREMENTAL_CHARGE,
        networkCents: "EXPERIMENTAL_FIXED_USD_RESERVE_PER_SIDE"
      },
      quoteValue: {
        grossBeforeExtraScenarioCostsCents: gross.toString(),
        direction: entry ? "DEBIT_ROUNDED_UP" : "CREDIT_ROUNDED_DOWN",
        totalExtraScenarioCostsCents: total.toString(),
        afterExtraScenarioCostsCents: after.toString(),
        label: "MODELED_SINGLE_SIDE_QUOTE_VALUE_NOT_PNL"
      },
      pnl: {
        status: "NOT_COMPUTED_SINGLE_SIDE_PROJECTION",
        beforeExtraScenarioCostsCents: null,
        afterExtraScenarioCostsCents: null,
        reason: "A paired entry, exit, identity-bound marks, and scenario configuration are required."
      },
      provenance: "MODELED",
      authorizationEligible: false,
      executionRealistic: false,
      integrationEligible: false,
      integrationBoundary: "Independent review evidence verification, size-cap enforcement, and unchanged Paper hard/risk gates are required."
    };
    const scenario = {
      id: SCENARIO_CASES[QUOTED_NET_CASE].scenarioId,
      version: SCENARIO_VERSION,
      case: QUOTED_NET_CASE,
      configurationSha256: config.sha256,
      approvalPurpose: "OFFLINE_SCENARIO_REVIEW_ONLY",
      approvalEvidenceProvenance: "CALLER_ASSERTED_NOT_AUTHENTICATED",
      quoteBasis: QUOTED_NET_BASIS,
      quoteUsdAssumption: {
        mint: SOLANA_USDC_MINT,
        decimals: 6,
        microUsdPerToken: "1000000",
        assumption: "USDC_EQUALS_USD1_EXPERIMENTAL_NOT_MEASURED"
      },
      adverseAdjustmentBps: 300,
      networkReserveCents: "50",
      zeroChargeDisposition: NO_INCREMENTAL_CHARGE
    };
    return {binding, exposure, scenario};
  } catch {
    return null;
  }
}

export function verifyPaperQuotedNetProjection(projection, {expectedDigest} = {}) {
  const reasons = [];
  const model = projection?.model;
  const binding = model?.binding;
  if (!isRecord(model) || !isRecord(binding) || projection.status !== "REVIEW_PROJECTION_ONLY") {
    return {valid: false, reasons: ["MODEL_MISSING"]};
  }
  const check = (ok, reason) => { if (!ok) reasons.push(reason); };
  let digestOk = false;
  try {
    digestOk = model.digest === paperQuotedNetModelDigest(binding);
  } catch {
    digestOk = false;
  }
  check(digestOk, "MODEL_DIGEST_MISMATCH");
  check(expectedDigest === undefined || model.digest === expectedDigest, "MODEL_DIGEST_NOT_THE_PINNED_DIGEST");
  check(binding.modelId === QUOTED_NET_MODEL.id && binding.modelVersion === QUOTED_NET_MODEL.version &&
    binding.status === QUOTED_NET_MODEL.status && binding.provenance === "MODELED",
  "MODEL_IDENTITY_MISMATCH");
  const expected = recomputeQuotedNetBinding(binding);
  check(expected !== null && canonicalJson(expected.binding) === canonicalJson(binding),
    "MODEL_BINDING_NOT_RECOMPUTED_FROM_QUOTE");
  check(exactKeys(model, ["binding", "digest", "assumptions", "resultContract"]) &&
    canonicalJson(model.assumptions) === canonicalJson(QUOTED_NET_ASSUMPTIONS) &&
    canonicalJson(model.resultContract) === canonicalJson(QUOTED_NET_RESULT_CONTRACT),
  "MODEL_ASSUMPTIONS_OR_RESULT_CONTRACT_ALTERED");
  if (expected) {
    for (const [key, value] of Object.entries(expected.exposure)) {
      check(canonicalJson(projection[key]) === canonicalJson(value), `MODEL_EXPOSED_FIELD_MISMATCH:${key}`);
    }
    const scenario = projection.scenario;
    const approval = scenario?.approvalEvidence;
    check(exactKeys(scenario, [...Object.keys(expected.scenario), "approvalEvidence"]) &&
      Object.entries(expected.scenario).every(([key, value]) =>
        canonicalJson(scenario[key]) === canonicalJson(value)) &&
      isRecord(approval) && approval.status === "ASSERTED_UNVERIFIED" &&
      Object.keys(approval).length === 3,
    "MODEL_EXPOSED_FIELD_MISMATCH:scenario");
    check(exactKeys(projection, [...Object.keys(expected.exposure), "scenario",
      "providerFieldsRetainedSeparately", "model"]),
    "MODEL_PROJECTION_FIELD_SET_MISMATCH");
    check(exactKeys(projection.providerFieldsRetainedSeparately, ["feeBps", "feeMint",
      "platformFee", "networkFeesLamports", "priceImpact", "slippageToleranceBps"]),
    "MODEL_PROVIDER_FIELDS_MISMATCH");
  }
  return {valid: reasons.length === 0, reasons};
}

export function verifyPaperExplicitNetProjection(projection, {expectedDigest} = {}) {
  const reasons = [];
  const model = projection?.model;
  const binding = model?.binding;
  if (!isRecord(model) || !isRecord(binding) ||
      projection.status !== "REVIEW_PROJECTION_ONLY") {
    return {valid: false, reasons: ["MODEL_MISSING"]};
  }
  const check = (ok, reason) => { if (!ok) reasons.push(reason); };
  let digestOk = false;
  try {
    digestOk = model.digest === paperExplicitNetModelDigest(binding);
  } catch {
    digestOk = false;
  }
  check(digestOk, "MODEL_DIGEST_MISMATCH");
  check(expectedDigest === undefined || model.digest === expectedDigest,
    "MODEL_DIGEST_NOT_THE_PINNED_DIGEST");
  check(binding.modelId === EXPLICIT_NET_MODEL.id &&
    binding.modelVersion === EXPLICIT_NET_MODEL.version &&
    binding.status === EXPLICIT_NET_MODEL.status &&
    binding.provenance === EXPLICIT_NET_MODEL.provenance,
  "MODEL_IDENTITY_MISMATCH");
  check(exactKeys(model, ["binding", "digest", "assumptions", "resultContract"]) &&
    canonicalJson(model.assumptions) === canonicalJson(EXPLICIT_NET_ASSUMPTIONS) &&
    canonicalJson(model.resultContract) === canonicalJson(EXPLICIT_NET_RESULT_CONTRACT),
  "MODEL_ASSUMPTIONS_OR_RESULT_CONTRACT_ALTERED");
  const expected = isRecord(binding.result) ? deriveExplicitNetProjection(binding) : null;
  check(expected !== null, "MODEL_BINDING_NOT_RECOMPUTED_FROM_QUOTE");
  if (expected) {
    const expectedModel = {
      binding,
      digest: paperExplicitNetModelDigest(binding),
      assumptions: [...EXPLICIT_NET_ASSUMPTIONS],
      resultContract: {...EXPLICIT_NET_RESULT_CONTRACT}
    };
    check(canonicalJson(projection) === canonicalJson({
      ...expected.projection,
      model: expectedModel
    }), "MODEL_EXPOSED_FIELDS_MISMATCH");
  }
  return {valid: reasons.length === 0, reasons};
}
