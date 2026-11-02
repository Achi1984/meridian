import {createHash} from "node:crypto";
import {PAPER_LEDGER_POLICY} from "./ledger.mjs";
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
  "zeroChargeDisposition", "reviewEvidence"
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
  })
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

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function scenarioConfig(value) {
  const raw = copyPlainRecord(value, SCENARIO_CONFIG_KEYS, "review scenario");
  const requiredKeys = SCENARIO_CONFIG_KEYS.filter(key => key !== "reviewEvidence");
  if (requiredKeys.some(key => !Object.hasOwn(raw, key))) {
    throw new TypeError("review scenario requires every explicit configuration field");
  }
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
  if (raw.optIn !== true || !scenario || raw.scenarioId !== scenario.scenarioId ||
      raw.scenarioVersion !== SCENARIO_VERSION ||
      raw.identity.chainId !== "solana" ||
      typeof raw.identity.mint !== "string" || !BASE58.test(raw.identity.mint) ||
      typeof raw.identity.pool !== "string" || !BASE58.test(raw.identity.pool) ||
      raw.identity.quote !== SOLANA_USDC_MINT ||
      !Number.isInteger(raw.identity.decimals) || raw.identity.decimals < 0 ||
      raw.identity.decimals > 18 || raw.usdcMint !== SOLANA_USDC_MINT ||
      raw.usdcDecimals !== 6 || raw.usdcUsdMicrosPerToken !== "1000000" ||
      raw.quoteBasis !== QUOTED_NET_BASIS ||
      raw.adverseAdjustmentBps !== scenario.adverseAdjustmentBps ||
      raw.networkReserveCents !== scenario.networkReserveCents ||
      raw.feeCents !== "0" || raw.spreadCents !== "0" ||
      raw.priceImpactCents !== "0" ||
      raw.zeroChargeDisposition !== NO_INCREMENTAL_CHARGE) {
    throw new TypeError("review scenario configuration is unsupported or inconsistent");
  }
  const canonical = {
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

function projectReviewScenario(request, observation, candidateReasons, parsedScenario) {
  if (parsedScenario?.error) {
    return blockedScenarioProjection(["SCENARIO_CONFIGURATION_INVALID"]);
  }
  const parsed = parsedScenario?.parsed;
  if (!parsed) return null;
  const {config} = parsed;
  if (!sameIdentity(config.identity, request.identity) ||
      config.usdcDecimals !== request.quoteDecimals) {
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
    authorizationEligible: false,
    executionRealistic: false,
    integrationEligible: false,
    integrationBoundary: "Independent review evidence verification, size-cap enforcement, and unchanged Paper hard/risk gates are required."
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

function abortableTransport(transport, getExternalSignal) {
  return async (url, init) => {
    const external = getExternalSignal();
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
      if (!response?.body?.getReader || signals.length === 0) return response;
      const reader = response.body.getReader();
      let done = false;
      const cleanup = () => {
        done = true;
        for (const signal of signals) signal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        if (!done) void reader.cancel().catch(() => {});
      };
      for (const signal of signals) signal.addEventListener("abort", cancel, {once: true});
      const body = new ReadableStream({
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              cleanup();
              stream.close();
            } else {
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

export function createMarketQuoteAdapter({
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
  const source = createJupiterV2QuoteAdapter({
    enabled: true,
    clock,
    timeoutMs,
    transport: abortableTransport(transport, () => externalSignal)
  });

  return Object.freeze({
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
        const scenarioProjection = projectReviewScenario(
          request, observed, reasons, parsedScenario
        );
        return {
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
      } catch {
        return emptyResult("UNAVAILABLE", ["QUOTE_ADAPTER_ERROR"], request,
          unavailableScenario(parsedScenario, "SCENARIO_QUOTE_ADAPTER_ERROR"));
      } finally {
        inFlight = false;
        externalSignal = null;
      }
    }
  });
}
