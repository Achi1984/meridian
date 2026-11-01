const COST_COMPONENTS = Object.freeze([
  ["fee", "feeCents"],
  ["spread", "spreadCents"],
  ["slippage", "slippageCents"],
  ["priceImpact", "priceImpactCents"],
  ["network", "networkCents"]
]);
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;
const MAX_INTEGER_DIGITS = 40;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && value.length <= 64 ? Date.parse(value) : NaN;
  return Number.isSafeInteger(parsed) && Number.isFinite(new Date(parsed).getTime()) ? parsed : null;
}

function unsignedInteger(value) {
  if (typeof value === "bigint" && value >= 0n && value.toString().length <= MAX_INTEGER_DIGITS) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && value.length <= MAX_INTEGER_DIGITS && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function identityReasons(actual, expected, prefix) {
  const reasons = [];
  for (const key of ["chainId", "mint", "pool", "quote", "decimals"]) {
    if (actual?.[key] !== expected?.[key]) reasons.push(`${prefix}_IDENTITY_MISMATCH:${key}`);
  }
  return reasons;
}

function roundMicroUsdUpToCents(microUsd) {
  return (microUsd + 9_999n) / 10_000n;
}

export function normalizeExactCosts(evidence, {
  identity,
  quoteSource,
  quoteObservedAt,
  now,
  maxAgeMs = MAX_QUOTE_AGE_MS
} = {}) {
  const reasons = [];
  if (!isRecord(evidence)) {
    return {
      status: "UNAVAILABLE",
      reasons: ["COST_EVIDENCE_MISSING"],
      costsCents: null,
      totalCents: null,
      authorizationEligible: false
    };
  }

  if (!identity || identity.chainId !== "solana" || !BASE58.test(identity.mint ?? "") ||
      !BASE58.test(identity.pool ?? "") || !BASE58.test(identity.quote ?? "") ||
      !Number.isInteger(identity.decimals) || identity.decimals < 0 || identity.decimals > 18) {
    reasons.push("COST_EXPECTED_IDENTITY_INVALID");
  }
  if (typeof evidence.source !== "string" || !evidence.source.trim() || evidence.source.length > 256) {
    reasons.push("COST_SOURCE_MISSING");
  } else if (typeof quoteSource !== "string" || evidence.source !== quoteSource) {
    reasons.push("COST_SOURCE_MISMATCH");
  }
  if (!isRecord(evidence.binding)) reasons.push("COST_BINDING_MISSING");
  else if (identity) reasons.push(...identityReasons(evidence.binding, identity, "COST"));

  const costTime = timestamp(evidence.observedAt);
  const quoteTime = timestamp(quoteObservedAt);
  const currentTime = timestamp(now);
  if (costTime === null) reasons.push("COST_TIME_INVALID");
  if (quoteTime === null) reasons.push("COST_QUOTE_TIME_INVALID");
  if (costTime !== null && quoteTime !== null && costTime !== quoteTime) {
    reasons.push("COST_QUOTE_TIME_MISMATCH");
  }
  if (currentTime === null || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    reasons.push("COST_CLOCK_INVALID");
  } else if (costTime !== null && (costTime > currentTime || currentTime - costTime > maxAgeMs)) {
    reasons.push(costTime > currentTime ? "COST_FUTURE_DATED" : "COST_STALE");
  }

  if (!isRecord(evidence.microUsd)) {
    reasons.push("COST_COMPONENTS_MISSING");
    return {
      status: "UNAVAILABLE",
      reasons,
      costsCents: null,
      totalCents: null,
      authorizationEligible: false
    };
  }

  const allowedKeys = new Set(COST_COMPONENTS.map(([key]) => key));
  for (const key of Object.keys(evidence.microUsd)) {
    if (!allowedKeys.has(key)) reasons.push(`COST_COMPONENT_UNSUPPORTED:${key}`);
  }

  const costsCents = {};
  let total = 0n;
  for (const [component, ledgerField] of COST_COMPONENTS) {
    if (!Object.hasOwn(evidence.microUsd, component)) {
      reasons.push(`COST_COMPONENT_MISSING:${component}`);
      continue;
    }
    const microUsd = unsignedInteger(evidence.microUsd[component]);
    if (microUsd === null) {
      reasons.push(`COST_COMPONENT_NOT_NONNEGATIVE_INTEGER:${component}`);
      continue;
    }
    const cents = roundMicroUsdUpToCents(microUsd);
    costsCents[ledgerField] = cents.toString();
    total += cents;
  }

  if (reasons.length > 0) {
    return {
      status: "UNAVAILABLE",
      reasons,
      costsCents: null,
      totalCents: null,
      authorizationEligible: false
    };
  }
  return {
    status: "NORMALIZED_UNVERIFIED",
    reasons: [],
    costsCents,
    totalCents: total.toString(),
    rounding: "each nonnegative integer micro-USD component rounds upward to integer cents",
    provenance: "CALLER_ASSERTED_NOT_SOURCE_VERIFIED",
    authorizationEligible: false
  };
}

export function normalizeHypotheticalQuote(quote, {
  identity,
  candidateSampledAt,
  authorizedAt,
  now,
  maxAgeMs = MAX_QUOTE_AGE_MS
} = {}) {
  const reasons = [];
  if (!isRecord(quote)) {
    return {
      status: "UNAVAILABLE",
      reasons: [
        "QUOTE_RESPONSE_MISSING",
        "QUOTE_SOURCE_UNAVAILABLE",
        "QUOTE_SEMANTICS_UNVERIFIED"
      ],
      quote: null,
      costs: null,
      authorizationEligible: false
    };
  }

  if (!identity || identity.chainId !== "solana" || !BASE58.test(identity.mint ?? "") ||
      !BASE58.test(identity.pool ?? "") || !BASE58.test(identity.quote ?? "") ||
      !Number.isInteger(identity.decimals) || identity.decimals < 0 || identity.decimals > 18) {
    reasons.push("EXPECTED_IDENTITY_INVALID");
  }
  if (typeof quote.provider !== "string" || !quote.provider.trim() ||
      typeof quote.schemaVersion !== "string" || !quote.schemaVersion.trim() ||
      quote.provider.length > 120 || quote.schemaVersion.length > 120) {
    reasons.push("QUOTE_PROVIDER_SCHEMA_MISSING");
  }
  if (typeof quote.source !== "string" || !quote.source.trim() || quote.source.length > 256) {
    reasons.push("QUOTE_SOURCE_MISSING");
  }
  if (typeof quote.eventId !== "string" || !SAFE_ID.test(quote.eventId)) {
    reasons.push("QUOTE_EVENT_ID_INVALID");
  }
  if (quote.chainId !== "solana") reasons.push("QUOTE_CHAIN_INVALID");
  for (const key of ["mint", "pool", "quote"]) {
    if (!BASE58.test(quote[key] ?? "")) reasons.push(`QUOTE_ID_INVALID:${key}`);
  }
  if (identity) {
    for (const key of ["chainId", "mint", "pool", "quote"]) {
      if (quote[key] !== identity[key]) reasons.push(`QUOTE_IDENTITY_MISMATCH:${key}`);
    }
  }
  if (!Number.isInteger(quote.decimals) || quote.decimals < 0 || quote.decimals > 18) {
    reasons.push("QUOTE_DECIMALS_INVALID");
  } else if (identity && quote.decimals !== identity.decimals) {
    reasons.push("QUOTE_DECIMALS_MISMATCH");
  }

  const quoteTime = timestamp(quote.observedAt);
  const sampleTime = timestamp(candidateSampledAt);
  const authorizationTime = timestamp(authorizedAt);
  const currentTime = timestamp(now);
  if (quoteTime === null) reasons.push("QUOTE_TIME_INVALID");
  if (sampleTime === null) reasons.push("CANDIDATE_SAMPLE_TIME_INVALID");
  if (authorizationTime === null) reasons.push("AUTHORIZATION_TIME_INVALID");
  if (currentTime === null || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    reasons.push("QUOTE_CLOCK_INVALID");
  }
  if (quoteTime !== null && sampleTime !== null && quoteTime <= sampleTime) {
    reasons.push("QUOTE_NOT_LATER_THAN_CANDIDATE_SAMPLE");
  }
  if (quoteTime !== null && authorizationTime !== null && quoteTime <= authorizationTime) {
    reasons.push("QUOTE_NOT_LATER_THAN_AUTHORIZATION");
  }
  if (quoteTime !== null && currentTime !== null) {
    if (quoteTime > currentTime) reasons.push("QUOTE_FUTURE_DATED");
    else if (currentTime - quoteTime > maxAgeMs) reasons.push("QUOTE_STALE");
  }

  if (!Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) {
    reasons.push("QUOTE_PRICE_MICROS_INVALID");
  }
  if (quote.mode !== "HYPOTHETICAL") reasons.push("QUOTE_MODE_NOT_HYPOTHETICAL");
  if (quote.executable !== true) reasons.push("QUOTE_NOT_LITERAL_EXECUTABLE");

  const costs = normalizeExactCosts(quote.costs, {
    identity,
    quoteSource: quote.source,
    quoteObservedAt: quote.observedAt,
    now,
    maxAgeMs
  });
  if (costs.status !== "NORMALIZED_UNVERIFIED") reasons.push(...costs.reasons);

  reasons.push("QUOTE_SOURCE_UNAVAILABLE", "QUOTE_SEMANTICS_UNVERIFIED");
  return {
    status: "UNAVAILABLE",
    reasons: [...new Set(reasons)],
    quote: null,
    costs: costs.status === "NORMALIZED_UNVERIFIED" ? costs : null,
    authorizationEligible: false
  };
}
