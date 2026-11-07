import {createHash} from "node:crypto";

const INITIAL_CAPITAL_CENTS = 100_000n;
const MAX_ENTRY_CENTS = 8_000n;
const MAX_POSITIONS = 3;
const MAX_EVENTS = 10_000;
const DAILY_LOSS_LIMIT_CENTS = 3_000n;
const BPS = 10_000n;
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const VIENNA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function asBigInt(value, label, {positive = false} = {}) {
  let result;
  if (typeof value === "bigint" && value.toString().length <= 40) result = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) result = BigInt(value);
  else if (typeof value === "string" && value.length <= 40 && /^\d+$/.test(value)) result = BigInt(value);
  else throw new TypeError(`${label} must be an integer`);
  if (result < 0n || (positive && result === 0n)) throw new RangeError(`${label} is outside allowed range`);
  return result;
}

function time(value) {
  const parsed = typeof value === "number" ? value
    : (typeof value === "string" && value.length <= 64 ? Date.parse(value) : NaN);
  return Number.isSafeInteger(parsed) && Number.isFinite(new Date(parsed).getTime()) ? parsed : null;
}

function moneyCents(value, label) {
  return asBigInt(value, label);
}

function decimalScale(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError("token decimals must be an integer from 0 to 18");
  }
  return 10n ** BigInt(decimals);
}

function sumCosts(costs, label) {
  if (!costs || typeof costs !== "object") throw new TypeError(`${label} cost breakdown is required`);
  const keys = ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"];
  const values = {};
  for (const key of keys) values[key] = moneyCents(costs[key], `${label}.${key}`);
  return {values, total: Object.values(values).reduce((sum, value) => sum + value, 0n)};
}

function quoteIdentityValid(quote, identity) {
  return quote && BASE58.test(quote.mint ?? "") && BASE58.test(quote.pool ?? "") &&
    BASE58.test(quote.quote ?? "") && quote.mint === identity.mint && quote.chainId === identity.chainId &&
    quote.pool === identity.pool && quote.quote === identity.quote &&
    typeof quote.source === "string" && quote.source.trim().length > 0 && quote.source.length <= 256;
}

function decisionBoundToCandidate(decision, candidate) {
  const identity = decision?.identity;
  return Boolean(identity && identity.chainId === candidate?.chainId &&
    identity.mint === candidate?.mint && identity.pool === candidate?.pool &&
    identity.quote === candidate?.quote && identity.source === candidate?.source &&
    time(identity.sampledAt) !== null &&
    time(identity.sampledAt) === time(candidate?.sampledAt));
}

function digest(fields) {
  return JSON.stringify(fields, (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

const MODELED_SCHEMA = "PAPER_MODELED_QUOTE_V1";
const MODELED_MODEL_ID = "MERIDIAN_PAPER_QUOTED_NET_V1";
const EXPLICIT_NET_SCHEMA = "PAPER_MODELED_QUOTE_V2";
const EXPLICIT_NET_MODEL_ID = "MERIDIAN_PAPER_EXPLICIT_NET_V1";
const MODELED_KEYS = Object.freeze([
  "schema", "provenance", "actualCostCoverage", "executionRealistic", "runId",
  "runStartedAt", "runEndAt", "sourcePolicySha256", "modelId", "modelVersion",
  "modelDigest", "scenarioConfigSha256", "usdAssumption", "side", "baseAtoms",
  "sourceCapBaseAtoms", "adverseAdjustmentBps", "networkReserveCents",
  "responseSha256", "expiresAt", "sourceObservedAt", "digest"
]);
const COST_KEYS = Object.freeze(["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"]);
const INTEGER_TEXT = /^(0|[1-9]\d{0,39})$/;
const SHA256_TEXT = /^[a-f0-9]{64}$/;
const EXPLICIT_NET_COST_KEYS = Object.freeze([
  "feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"
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
  fee: ["NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS", "ADDITIONAL_MODELED_FEE_PENALTY_NOT_OBSERVED"],
  spread: ["NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS", "ADDITIONAL_MODELED_SPREAD_PENALTY_NOT_OBSERVED"],
  slippage: ["NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS", "ADDITIONAL_MODELED_ADVERSE_ADJUSTMENT_ROUNDED_UP"],
  priceImpact: ["NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS", "ADDITIONAL_MODELED_IMPACT_PENALTY_NOT_OBSERVED"],
  network: ["NO_INCREMENTAL_CHARGE_UNDER_SCENARIO_BASIS", "ADDITIONAL_MODELED_NETWORK_RESERVE_NOT_SETTLED_COST"]
});

function exactRecord(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonicalText(value)).digest("hex");
}

function explicitNetScenarioConfigHash(config) {
  const assumptions = config.explicitAssumptions;
  const normalizedAssumptions = {
    feeCents: assumptions.feeCents,
    spreadCents: assumptions.spreadCents,
    priceImpactCents: assumptions.priceImpactCents,
    networkCents: assumptions.networkCents,
    equityCents: assumptions.equityCents,
    availableCashCents: assumptions.availableCashCents,
    slippageBps: assumptions.slippageBps,
    units: Object.fromEntries(Object.keys(EXPLICIT_NET_UNITS)
      .map(key => [key, assumptions.units[key]])),
    rationales: Object.fromEntries(Object.keys(EXPLICIT_NET_UNITS)
      .map(key => [key, assumptions.rationales[key]])),
    zeroCostAssumptions: Object.fromEntries(["fee", "spread", "slippage", "priceImpact", "network"]
      .filter(component => Object.hasOwn(assumptions.zeroCostAssumptions, component))
      .map(component => [component, assumptions.zeroCostAssumptions[component]])),
    dispositions: Object.fromEntries(["fee", "spread", "slippage", "priceImpact", "network"]
      .map(component => [component, assumptions.dispositions[component]]))
  };
  return createHash("sha256").update(JSON.stringify({
    optIn: config.optIn,
    scenarioId: config.scenarioId,
    scenarioVersion: config.scenarioVersion,
    scenario: config.scenario,
    identity: {
      chainId: config.identity.chainId,
      mint: config.identity.mint,
      pool: config.identity.pool,
      quote: config.identity.quote,
      decimals: config.identity.decimals
    },
    quoteBasis: config.quoteBasis,
    explicitAssumptions: normalizedAssumptions,
    quoteUsdConversion: {
      mint: config.quoteUsdConversion.mint,
      decimals: config.quoteUsdConversion.decimals,
      microUsdPerWholeToken: config.quoteUsdConversion.microUsdPerWholeToken,
      observedAt: config.quoteUsdConversion.observedAt,
      method: config.quoteUsdConversion.method,
      evidenceSha256: config.quoteUsdConversion.evidenceSha256
    }
  })).digest("hex");
}

function explicitNetMethodology(binding) {
  const config = binding.scenarioConfiguration;
  const assumptions = config.explicitAssumptions;
  return {
    modelId: EXPLICIT_NET_MODEL_ID,
    modelVersion: "1",
    scenarioId: config.scenarioId,
    scenarioVersion: config.scenarioVersion,
    scenario: config.scenario,
    identity: config.identity,
    quoteBasis: config.quoteBasis,
    explicitAssumptions: {
      feeCents: assumptions.feeCents,
      spreadCents: assumptions.spreadCents,
      slippageBps: assumptions.slippageBps,
      priceImpactCents: assumptions.priceImpactCents,
      networkCents: assumptions.networkCents,
      units: assumptions.units,
      rationales: assumptions.rationales,
      zeroCostAssumptions: assumptions.zeroCostAssumptions,
      dispositions: assumptions.dispositions
    }
  };
}

function ceilDivide(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

function explicitNetGross(baseAtoms, priceMicros, decimals, side) {
  const numerator = BigInt(baseAtoms) * BigInt(priceMicros);
  const denominator = decimalScale(decimals) * 10_000n;
  return side === "ENTRY" ? ceilDivide(numerator, denominator) : numerator / denominator;
}

function explicitNetCosts(grossCents, assumptions) {
  const costs = {
    feeCents: BigInt(assumptions.feeCents),
    spreadCents: BigInt(assumptions.spreadCents),
    slippageCents: ceilDivide(grossCents * BigInt(assumptions.slippageBps), BPS),
    priceImpactCents: BigInt(assumptions.priceImpactCents),
    networkCents: BigInt(assumptions.networkCents)
  };
  return {costs, total: Object.values(costs).reduce((sum, amount) => sum + amount, 0n)};
}

function verifyExplicitNetModeledQuote(quote, {runId, side, now, decimals}) {
  const fail = reason => ({ok: false, reason});
  try {
    const facts = quote?.modeled;
    const keys = [
      "schema", "provenance", "actualCostCoverage", "executionRealistic", "runId",
      "runStartedAt", "runEndAt", "sourcePolicySha256", "modelId", "modelVersion",
      "modelDigest", "methodologyDigest", "scenarioConfigSha256", "side", "baseAtoms",
      "sourceCapBaseAtoms", "responseSha256", "expiresAt", "sourceObservedAt",
      "scenarioBinding", "digest"
    ];
    if (!exactRecord(facts, keys) ||
        facts.schema !== EXPLICIT_NET_SCHEMA || facts.provenance !== "MODELED" ||
        facts.actualCostCoverage !== "UNKNOWN" || facts.executionRealistic !== false ||
        facts.modelId !== EXPLICIT_NET_MODEL_ID || facts.modelVersion !== "1" ||
        facts.runId !== runId || facts.side !== side) {
      return fail("modeled facts do not match this run, model, or side");
    }
    for (const key of ["sourcePolicySha256", "modelDigest", "methodologyDigest",
      "scenarioConfigSha256", "responseSha256", "digest"]) {
      if (typeof facts[key] !== "string" || !SHA256_TEXT.test(facts[key])) {
        return fail("modeled digest field is invalid");
      }
    }
    for (const key of ["runStartedAt", "runEndAt", "expiresAt", "sourceObservedAt"]) {
      if (!Number.isSafeInteger(facts[key]) || facts[key] < 0) return fail("modeled time field is invalid");
    }
    if (typeof facts.baseAtoms !== "string" || !INTEGER_TEXT.test(facts.baseAtoms) ||
        typeof facts.sourceCapBaseAtoms !== "string" || !INTEGER_TEXT.test(facts.sourceCapBaseAtoms)) {
      return fail("modeled amount field is invalid");
    }

    const binding = facts.scenarioBinding;
    if (!exactRecord(binding, [
      "modelId", "modelVersion", "status", "provenance", "scenarioConfigSha256",
      "scenarioConfiguration", "reviewEvidenceRecord", "candidateIdentity", "side",
      "request", "sourceQuote", "quoteUsdConversion", "quoteBasis", "result"
    ]) || binding.modelId !== EXPLICIT_NET_MODEL_ID || binding.modelVersion !== "1" ||
        binding.status !== "REVIEW_ONLY" || binding.provenance !== "MODELED" ||
        binding.side !== side || binding.scenarioConfigSha256 !== facts.scenarioConfigSha256 ||
        sha256Canonical(binding) !== facts.modelDigest) {
      return fail("explicit net scenario binding is invalid");
    }
    const config = binding.scenarioConfiguration;
    const configKeys = [
      "optIn", "scenarioId", "scenarioVersion", "scenario", "identity",
      "quoteBasis", "explicitAssumptions", "quoteUsdConversion"
    ];
    if (!exactRecord(config, configKeys) || config.optIn !== true ||
        config.scenarioId !== EXPLICIT_NET_MODEL_ID || config.scenarioVersion !== "1" ||
        config.scenario !== "EXPLICIT_NET_V1" ||
        config.quoteBasis !== "QUOTED_ROUTE_AMOUNTS_AS_MODELED_NET_SWAP_BASIS" ||
        binding.quoteBasis !== config.quoteBasis ||
        explicitNetScenarioConfigHash(config) !== facts.scenarioConfigSha256) {
      return fail("explicit net scenario configuration is invalid");
    }
    const identity = config.identity;
    const identityKeys = ["chainId", "mint", "pool", "quote", "decimals"];
    if (!exactRecord(identity, identityKeys) || identity.chainId !== "solana" ||
        !quoteIdentityValid(quote, identity) || !exactRecord(binding.candidateIdentity, identityKeys) ||
        canonicalText(binding.candidateIdentity) !== canonicalText(identity) ||
        !exactRecord(binding.request?.identity, identityKeys) ||
        canonicalText(binding.request.identity) !== canonicalText(identity) ||
        !Number.isInteger(identity.decimals) || identity.decimals !== decimals ||
        quote.mode !== "HYPOTHETICAL" || quote.executable !== true) {
      return fail("explicit net quote identity is invalid");
    }

    const assumptions = config.explicitAssumptions;
    const assumptionKeys = [
      "feeCents", "spreadCents", "slippageBps", "priceImpactCents", "networkCents",
      "equityCents", "availableCashCents", "units", "rationales",
      "zeroCostAssumptions", "dispositions"
    ];
    const assumptionStringKeys = [
      "feeCents", "spreadCents", "slippageBps", "priceImpactCents", "networkCents",
      "equityCents", "availableCashCents"
    ];
    if (!exactRecord(assumptions, assumptionKeys) ||
        assumptionStringKeys.some(key => typeof assumptions[key] !== "string" ||
          !INTEGER_TEXT.test(assumptions[key])) ||
        BigInt(assumptions.equityCents) <= 0n || BigInt(assumptions.slippageBps) > BPS ||
        !exactRecord(assumptions.units, Object.keys(EXPLICIT_NET_UNITS)) ||
        !exactRecord(assumptions.rationales, Object.keys(EXPLICIT_NET_UNITS)) ||
        !exactRecord(assumptions.dispositions, ["fee", "spread", "slippage", "priceImpact", "network"]) ||
        Object.entries(EXPLICIT_NET_UNITS).some(([key, unit]) => assumptions.units[key] !== unit) ||
        Object.values(assumptions.rationales).some(value =>
          typeof value !== "string" || value.trim().length < 8 || value.length > 256)) {
      return fail("explicit net assumptions, units, or rationales are invalid");
    }
    const components = ["fee", "spread", "slippage", "priceImpact", "network"];
    const costValue = component => component === "slippage" ? assumptions.slippageBps :
      component === "priceImpact" ? assumptions.priceImpactCents :
        component === "network" ? assumptions.networkCents : assumptions[`${component}Cents`];
    const zeroComponents = components.filter(component => costValue(component) === "0");
    if (!exactRecord(assumptions.zeroCostAssumptions, zeroComponents) ||
        components.some(component => {
          const disposition = costValue(component) === "0"
            ? EXPLICIT_NET_DISPOSITIONS[component][0]
            : EXPLICIT_NET_DISPOSITIONS[component][1];
          return assumptions.dispositions[component] !== disposition ||
            (costValue(component) === "0" &&
              (typeof assumptions.zeroCostAssumptions[component] !== "string" ||
                assumptions.zeroCostAssumptions[component].trim().length < 8 ||
                assumptions.zeroCostAssumptions[component].length > 256));
        })) {
      return fail("explicit net cost dispositions are invalid");
    }
    const method = explicitNetMethodology(binding);
    if (sha256Canonical(method) !== facts.methodologyDigest) {
      return fail("explicit net methodology digest does not match");
    }

    const request = binding.request;
    const requestKeys = [
      "identity", "side", "amountAtoms", "quoteDecimals", "candidateSampledAt",
      "causalAt", "slippageBps", "sha256"
    ];
    if (!exactRecord(request, requestKeys) || request.side !== side ||
        typeof request.amountAtoms !== "string" || !INTEGER_TEXT.test(request.amountAtoms) ||
        BigInt(request.amountAtoms) <= 0n ||
        !Number.isInteger(request.quoteDecimals) || request.quoteDecimals < 0 ||
        request.quoteDecimals > 18 || !Number.isSafeInteger(request.candidateSampledAt) ||
        !Number.isSafeInteger(request.causalAt) || !Number.isInteger(request.slippageBps) ||
        request.slippageBps < 0 || request.slippageBps > 10_000) {
      return fail("explicit net request binding is invalid");
    }
    const requestWithoutDigest = {
      identity: request.identity, side: request.side, amountAtoms: request.amountAtoms,
      quoteDecimals: request.quoteDecimals, candidateSampledAt: request.candidateSampledAt,
      causalAt: request.causalAt, slippageBps: request.slippageBps
    };
    if (sha256Canonical(requestWithoutDigest) !== request.sha256) {
      return fail("explicit net request digest does not match");
    }

    const sourceQuote = binding.sourceQuote;
    const sourceQuoteKeys = [
      "source", "requestId", "observedAt", "expiresAt", "inAmount", "outAmount",
      "responseSha256", "responseByteLength"
    ];
    const conversion = binding.quoteUsdConversion;
    const conversionKeys = [
      "mint", "decimals", "microUsdPerWholeToken", "observedAt", "method", "evidenceSha256"
    ];
    if (!exactRecord(sourceQuote, sourceQuoteKeys) ||
        sourceQuote.source !== "Jupiter Swap API V2 /order" ||
        !(sourceQuote.requestId === null ||
          (typeof sourceQuote.requestId === "string" && SAFE_ID.test(sourceQuote.requestId))) ||
        !Number.isSafeInteger(sourceQuote.observedAt) ||
        !Number.isSafeInteger(sourceQuote.expiresAt) ||
        sourceQuote.expiresAt <= sourceQuote.observedAt ||
        sourceQuote.inAmount !== request.amountAtoms ||
        typeof sourceQuote.outAmount !== "string" || !INTEGER_TEXT.test(sourceQuote.outAmount) ||
        BigInt(sourceQuote.outAmount) <= 0n ||
        !Number.isSafeInteger(sourceQuote.responseByteLength) || sourceQuote.responseByteLength <= 0 ||
        sourceQuote.responseSha256 !== facts.responseSha256 ||
        !exactRecord(conversion, conversionKeys) ||
        canonicalText(conversion) !== canonicalText(config.quoteUsdConversion) ||
        conversion.mint !== identity.quote || conversion.decimals !== request.quoteDecimals ||
        typeof conversion.microUsdPerWholeToken !== "string" ||
        !INTEGER_TEXT.test(conversion.microUsdPerWholeToken) ||
        BigInt(conversion.microUsdPerWholeToken) <= 0n ||
        conversion.method !== "MEASURED_SOURCE_RECEIPT" ||
        typeof conversion.evidenceSha256 !== "string" || !SHA256_TEXT.test(conversion.evidenceSha256) ||
        !Number.isSafeInteger(conversion.observedAt) ||
        conversion.observedAt > sourceQuote.observedAt ||
        sourceQuote.observedAt - conversion.observedAt > MAX_QUOTE_AGE_MS ||
        sourceQuote.observedAt <= request.candidateSampledAt ||
        sourceQuote.observedAt <= request.causalAt ||
        sourceQuote.observedAt - request.candidateSampledAt > MAX_QUOTE_AGE_MS ||
        (side === "ENTRY" &&
          sourceQuote.observedAt - request.causalAt > MAX_QUOTE_AGE_MS) ||
        sourceQuote.observedAt !== facts.sourceObservedAt ||
        sourceQuote.expiresAt !== facts.expiresAt) {
      return fail("explicit net source quote or causal FX receipt is invalid");
    }
    const reviewEvidence = binding.reviewEvidenceRecord;
    if (!exactRecord(reviewEvidence, [
      "evidenceId", "evidenceSha256", "scenarioConfigSha256", "identity",
      "reviewerRef", "purpose", "decision", "recordedAt"
    ]) || typeof reviewEvidence.evidenceId !== "string" || !SAFE_ID.test(reviewEvidence.evidenceId) ||
        typeof reviewEvidence.evidenceSha256 !== "string" || !SHA256_TEXT.test(reviewEvidence.evidenceSha256) ||
        reviewEvidence.scenarioConfigSha256 !== facts.scenarioConfigSha256 ||
        !exactRecord(reviewEvidence.identity, ["chainId", "mint", "pool", "quote", "decimals"]) ||
        canonicalText(reviewEvidence.identity) !== canonicalText(identity) ||
        typeof reviewEvidence.reviewerRef !== "string" || !SAFE_ID.test(reviewEvidence.reviewerRef) ||
        reviewEvidence.purpose !== "OFFLINE_SCENARIO_REVIEW_ONLY" ||
        reviewEvidence.decision !== "APPROVE_SCENARIO_REVIEW_ONLY" ||
        !Number.isSafeInteger(reviewEvidence.recordedAt) ||
        reviewEvidence.recordedAt > sourceQuote.observedAt) {
      return fail("explicit net review evidence binding is invalid");
    }
    if (facts.runStartedAt > facts.runEndAt ||
        sourceQuote.observedAt < facts.runStartedAt ||
        sourceQuote.observedAt > facts.runEndAt ||
        !Number.isSafeInteger(now) || now < sourceQuote.observedAt ||
        now > facts.runEndAt || now > sourceQuote.expiresAt ||
        quote.observedAt !== sourceQuote.observedAt) {
      return fail("modeled quote is outside its run window or expired");
    }

    const entry = side === "ENTRY";
    const sourceBaseAtoms = BigInt(entry ? sourceQuote.outAmount : sourceQuote.inAmount);
    const sourceQuoteAtoms = BigInt(entry ? sourceQuote.inAmount : sourceQuote.outAmount);
    const priceNumerator = sourceQuoteAtoms * BigInt(conversion.microUsdPerWholeToken) *
      decimalScale(identity.decimals);
    const priceDenominator = sourceBaseAtoms * 10n ** BigInt(request.quoteDecimals);
    const expectedPrice = entry
      ? ceilDivide(priceNumerator, priceDenominator) : priceNumerator / priceDenominator;
    if (expectedPrice <= 0n || expectedPrice > BigInt(Number.MAX_SAFE_INTEGER) ||
        BigInt(quote.priceMicros) !== expectedPrice ||
        facts.baseAtoms !== (binding.result?.modeledBaseAtoms ?? "") ||
        facts.sourceCapBaseAtoms !== sourceBaseAtoms.toString() ||
        BigInt(facts.baseAtoms) <= 0n || BigInt(facts.baseAtoms) > sourceBaseAtoms) {
      return fail("explicit net price or modeled quantity does not recompute");
    }
    const budget = [
      BigInt(PAPER_LEDGER_POLICY.maxEntryCents),
      BigInt(assumptions.equityCents) * 8n / 100n,
      BigInt(assumptions.availableCashCents)
    ].reduce((minimum, amount) => amount < minimum ? amount : minimum);
    let expectedBase = entry ? sourceBaseAtoms : BigInt(request.amountAtoms);
    if (entry) {
      let low = 0n;
      let high = sourceBaseAtoms;
      while (low < high) {
        const middle = (low + high + 1n) / 2n;
        const gross = explicitNetGross(middle, expectedPrice, identity.decimals, "ENTRY");
        const {total} = explicitNetCosts(gross, assumptions);
        if (gross + total <= budget) low = middle;
        else high = middle - 1n;
      }
      expectedBase = low;
    }
    if (expectedBase <= 0n || expectedBase !== BigInt(facts.baseAtoms) ||
        (!entry && expectedBase !== sourceBaseAtoms)) {
      return fail("explicit net modeled quantity does not match its projection budget or source cap");
    }
    const expectedQuoteAtoms = entry
      ? ceilDivide(sourceQuoteAtoms * expectedBase, sourceBaseAtoms) : sourceQuoteAtoms;
    const gross = explicitNetGross(expectedBase, expectedPrice, identity.decimals, side);
    const {costs, total} = explicitNetCosts(gross, assumptions);
    if ((!entry && total > gross) || (entry && gross + total > budget) ||
        quote.costs === undefined ||
        EXPLICIT_NET_COST_KEYS.some(key => BigInt(quote.costs[key]) !== costs[key])) {
      return fail("explicit net costs do not recompute from the carried assumptions");
    }
    const result = {
      priceMicros: expectedPrice.toString(),
      quotedNetBasisCents: gross.toString(),
      costsCents: Object.fromEntries(Object.entries(costs)
        .map(([key, amount]) => [key, amount.toString()])),
      totalCostsCents: total.toString(),
      afterCents: (entry ? gross + total : gross - total).toString(),
      effectiveEntryBudgetCents: budget.toString(),
      modeledBaseAtoms: expectedBase.toString(),
      modeledInputAtoms: (entry ? expectedQuoteAtoms : expectedBase).toString(),
      sourceQuotedBaseAtoms: sourceBaseAtoms.toString(),
      sourceQuotedInputAtoms: sourceQuote.inAmount,
      sizeDisposition: entry && expectedBase !== sourceBaseAtoms
        ? "SMALLER_SIZE_MODELED_NOT_A_FRESH_EXECUTABLE_QUOTE" : "QUOTED_AMOUNT"
    };
    if (canonicalText(binding.result) !== canonicalText(result) ||
        canonicalText(quote.costs) !== canonicalText(result.costsCents) ||
        !Number.isSafeInteger(quote.priceMicros) || quote.decimals !== identity.decimals ||
        !quoteIdentityValid(quote, identity) ||
        facts.digest !== paperModeledQuoteDigest(facts, quote, decimals)) {
      return fail("explicit net modeled quote digest or result does not match");
    }
    return {ok: true, baseAtoms: expectedBase, capAtoms: sourceBaseAtoms, digest: facts.digest};
  } catch {
    return fail("explicit net modeled facts could not be verified");
  }
}

function canonicalText(value, depth = 0) {
  if (depth > 8) throw new RangeError("canonical value is too deep");
  if (Array.isArray(value)) return `[${value.map(item => canonicalText(item, depth + 1)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalText(value[key], depth + 1)}`).join(",")}}`;
  }
  return typeof value === "bigint" ? JSON.stringify(value.toString()) : JSON.stringify(value ?? null);
}

function safeCanonical(value) {
  try {
    return canonicalText(value);
  } catch {
    return "UNSERIALIZABLE";
  }
}

export function paperModeledQuoteDigest(facts, quote, decimals) {
  const {digest: _ignored, ...rest} = facts;
  const economics = {
    mint: quote.mint, chainId: quote.chainId, pool: quote.pool, quote: quote.quote, decimals,
    observedAt: quote.observedAt, priceMicros: quote.priceMicros, source: quote.source,
    costs: Object.fromEntries(COST_KEYS.map(key => [key, String(quote.costs?.[key])]))
  };
  return createHash("sha256").update(canonicalText({facts: rest, economics})).digest("hex");
}

// Pure arithmetic and binding check; issuer provenance is confirmed separately by the step.
export function verifyPaperModeledQuote(quote, {runId, side, now, decimals}) {
  const fail = reason => ({ok: false, reason});
  if (quote?.modeled?.schema === EXPLICIT_NET_SCHEMA) {
    return verifyExplicitNetModeledQuote(quote, {runId, side, now, decimals});
  }
  try {
    const facts = quote?.modeled;
    if (!facts || typeof facts !== "object" || Array.isArray(facts) ||
        Object.keys(facts).sort().join(",") !== [...MODELED_KEYS].sort().join(",")) {
      return fail("modeled facts are missing or malformed");
    }
    if (facts.schema !== MODELED_SCHEMA || facts.provenance !== "MODELED" ||
        facts.actualCostCoverage !== "UNKNOWN" || facts.executionRealistic !== false ||
        facts.modelId !== MODELED_MODEL_ID || facts.modelVersion !== "1" ||
        facts.runId !== runId || facts.side !== side) {
      return fail("modeled facts do not match this run, model, or side");
    }
    for (const key of ["sourcePolicySha256", "modelDigest", "scenarioConfigSha256", "responseSha256", "digest"]) {
      if (typeof facts[key] !== "string" || !SHA256_TEXT.test(facts[key])) return fail("modeled digest field is invalid");
    }
    if (typeof facts.usdAssumption !== "string" || facts.usdAssumption.length === 0 ||
        facts.usdAssumption.length > 256) {
      return fail("modeled currency assumption is invalid");
    }
    for (const key of ["runStartedAt", "runEndAt", "expiresAt", "sourceObservedAt"]) {
      if (!Number.isSafeInteger(facts[key]) || facts[key] < 0) return fail("modeled time field is invalid");
    }
    for (const key of ["baseAtoms", "sourceCapBaseAtoms", "networkReserveCents"]) {
      if (typeof facts[key] !== "string" || !INTEGER_TEXT.test(facts[key])) return fail("modeled amount field is invalid");
    }
    if (!Number.isInteger(facts.adverseAdjustmentBps) || facts.adverseAdjustmentBps < 0 ||
        facts.adverseAdjustmentBps > 10_000) {
      return fail("modeled adjustment is invalid");
    }
    const base = BigInt(facts.baseAtoms);
    if (base <= 0n || base > BigInt(facts.sourceCapBaseAtoms)) {
      return fail("modeled quantity exceeds the source quote cap");
    }
    if (!Number.isSafeInteger(quote.observedAt) || quote.observedAt !== facts.sourceObservedAt ||
        !Number.isSafeInteger(now) || facts.runStartedAt > facts.sourceObservedAt ||
        facts.sourceObservedAt > facts.runEndAt || facts.sourceObservedAt > now ||
        now > facts.runEndAt || now > facts.expiresAt) {
      return fail("modeled quote is outside its run window or expired");
    }
    if (!Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) return fail("modeled price is invalid");
    const scale = decimalScale(decimals);
    const price = BigInt(quote.priceMicros);
    const numerator = base * price;
    const denominator = scale * 10_000n;
    const gross = side === "ENTRY" ? (numerator + denominator - 1n) / denominator : numerator / denominator;
    const adjustment = BigInt(facts.adverseAdjustmentBps);
    const slippage = (gross * adjustment + BPS - 1n) / BPS;
    const expected = {
      feeCents: 0n, spreadCents: 0n, slippageCents: slippage,
      priceImpactCents: 0n, networkCents: BigInt(facts.networkReserveCents)
    };
    const carried = sumCosts(quote.costs, "modeled").values;
    if (COST_KEYS.some(key => carried[key] !== expected[key])) {
      return fail("modeled costs do not recompute from the carried facts");
    }
    if (facts.digest !== paperModeledQuoteDigest(facts, quote, decimals)) {
      return fail("modeled digest does not match the quote");
    }
    return {ok: true, baseAtoms: base, capAtoms: BigInt(facts.sourceCapBaseAtoms), digest: facts.digest};
  } catch {
    return fail("modeled facts could not be verified");
  }
}

function modeledPayload(quote) {
  return quote?.modeled === undefined ? {} : {modeled: safeCanonical(quote.modeled)};
}

function exitPayloadDigest(eventId, quote) {
  return digest({
    eventId,
    mint: quote?.mint,
    chainId: quote?.chainId,
    pool: quote?.pool,
    quote: quote?.quote,
    observedAt: quote?.observedAt,
    priceMicros: quote?.priceMicros,
    costs: quote?.costs,
    source: quote?.source,
    mode: quote?.mode,
    executable: quote?.executable,
    ...modeledPayload(quote)
  });
}

// Runs before any high-water, trailing-stop, or observation-time mutation.
function positionQuoteGate(position, quote, now, runId) {
  if (!position.modeled) {
    return quote?.modeled === undefined ? null : "modeled quote cannot value a legacy position";
  }
  const verified = verifyPaperModeledQuote(quote, {runId, side: "EXIT", now, decimals: position.decimals});
  if (!verified.ok) return verified.reason;
  if (verified.baseAtoms !== position.tokenAtoms) {
    return "modeled exit quote does not cover the exact full position quantity";
  }
  return null;
}

function viennaDay(value) {
  const parsed = time(value);
  if (parsed === null) return null;
  const parts = VIENNA_DAY.formatToParts(new Date(parsed));
  const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function computeMark(position, mark, now, runId) {
  if (!quoteIdentityValid(mark, position) || !Number.isSafeInteger(mark.priceMicros) ||
      mark.priceMicros <= 0 || !Number.isSafeInteger(time(mark.observedAt)) ||
      now - time(mark.observedAt) < 0 || now - time(mark.observedAt) > MAX_QUOTE_AGE_MS) {
    return {status: "VALUATION_UNAVAILABLE", reason: "mark is missing, stale, future-dated, or identity-mismatched"};
  }
  const modeledFailure = positionQuoteGate(position, mark, now, runId);
  if (modeledFailure) return {status: "VALUATION_UNAVAILABLE", reason: modeledFailure};
  let costs;
  try {
    costs = sumCosts(mark.costs, "exit").total;
  } catch {
    return {status: "VALUATION_UNAVAILABLE", reason: "complete exit-cost assumptions are required"};
  }
  const grossCents = position.tokenAtoms * BigInt(mark.priceMicros) /
    (position.scale * 10_000n);
  if (costs > grossCents) {
    return {status: "VALUATION_UNAVAILABLE", reason: "exit costs exceed marked proceeds"};
  }
  return {
    status: "PASS",
    grossCents,
    exitCostsCents: costs,
    netProceedsCents: grossCents - costs,
    observedAt: mark.observedAt,
    priceMicros: BigInt(mark.priceMicros)
  };
}

export class PaperLedger {
  #latestCommandTime;
  #runFinished;
  constructor({initialCapitalCents = INITIAL_CAPITAL_CENTS, now = Date.now(), runId = "synthetic-only"} = {}) {
    this.initialCapitalCents = moneyCents(initialCapitalCents, "initialCapitalCents");
    if (this.initialCapitalCents !== INITIAL_CAPITAL_CENTS) {
      throw new RangeError("this prototype is fixed to USD 1,000 initial virtual capital");
    }
    this.cashCents = this.initialCapitalCents;
    this.realizedGrossPnlCents = 0n;
    this.realizedPnlCents = 0n;
    this.positions = new Map();
    this.reservations = new Map();
    this.authorizationDigests = new Map();
    this.authorizationResults = new Map();
    this.eventDigests = new Map();
    this.results = new Map();
    this.entriesByTickMint = new Set();
    this.events = [];
    this.auditTruncated = false;
    this.costTotals = {
      entry: {feeCents: 0n, spreadCents: 0n, slippageCents: 0n, priceImpactCents: 0n, networkCents: 0n},
      exit: {feeCents: 0n, spreadCents: 0n, slippageCents: 0n, priceImpactCents: 0n, networkCents: 0n}
    };
    this.lastEquitySnapshot = null;
    this.#latestCommandTime = time(now);
    this.day = viennaDay(now);
    if (!this.day) throw new TypeError("valid initialization time is required");
    this.dailyOpeningEquityCents = this.initialCapitalCents;
    this.dailyLossTripped = false;
    this.#runFinished = false;
    if (typeof runId !== "string" || !SAFE_ID.test(runId)) throw new TypeError("runId must be a bounded safe identifier");
    this.runId = runId;
    this.newWorkAllowed = true;
  }

  static restartDisposition() {
    return {
      status: "UNRECOVERABLE_FAIL_CLOSED",
      entriesAllowed: false,
      reason: "No durable journal or atomic restart recovery is implemented; do not resume an interrupted run."
    };
  }

  // Exact identity replays return stored results before this admission boundary.
  // Every newly admitted timestamp advances the fence, even if later evidence rejects.
  #admitTime(now) {
    const current = time(now);
    if (current === null || current < this.#latestCommandTime) {
      return {status: "REJECT", reason: "NON_MONOTONIC_TIME", entriesAllowed: false};
    }
    this.#latestCommandTime = current;
    return null;
  }

  #record(event) {
    if (this.events.length >= MAX_EVENTS) {
      this.newWorkAllowed = false;
      this.auditTruncated = true;
      return false;
    }
    this.events.push(Object.freeze(event));
    return true;
  }

  #canRecord(count = 1) {
    if (this.events.length + count > MAX_EVENTS) {
      this.newWorkAllowed = false;
      this.auditTruncated = true;
      return false;
    }
    return true;
  }

  #releaseReservation(authorizationId, status, reason) {
    const authorization = this.reservations.get(authorizationId);
    if (!authorization) return this.authorizationResults.get(authorizationId) ?? null;
    this.reservations.delete(authorizationId);
    const result = Object.freeze({status, reason, authorizationId, mint: authorization.mint});
    this.authorizationResults.set(authorizationId, result);
    this.#record({type: "RISK_RESERVATION_RELEASED", authorizationId, mint: authorization.mint, reason});
    return result;
  }

  #revokeReservations(reason) {
    for (const authorizationId of this.reservations.keys()) {
      this.#releaseReservation(authorizationId, "REVOKED", reason);
    }
  }

  #expireReservations(now, localDay) {
    for (const [authorizationId, authorization] of this.reservations) {
      const authorizedAt = time(authorization.authorizedAt);
      if (authorization.authorizedDay !== localDay) {
        this.#releaseReservation(authorizationId, "REVOKED", "authorization cannot cross a Vienna calendar day");
      } else if (authorizedAt === null || now < authorizedAt ||
          now - authorizedAt > MAX_QUOTE_AGE_MS) {
        this.#releaseReservation(authorizationId, "EXPIRED", "risk authorization exceeded five-minute validity");
      }
    }
  }

  #snapshotEquity({now, marks}) {
    const parsedNow = time(now);
    if (parsedNow === null || !Array.isArray(marks)) {
      return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: "timestamp and complete marks are required"};
    }
    const marksByMint = new Map(marks.map(mark => [mark?.mint, mark]));
    if (marksByMint.size !== marks.length) {
      return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: "duplicate marks are ambiguous"};
    }
    let equity = this.cashCents;
    let grossOpenValueCents = 0n;
    let estimatedExitCostsCents = 0n;
    let grossUnrealizedPnlCents = 0n;
    let netUnrealizedPnlCents = 0n;
    for (const [mint, position] of this.positions) {
      const mark = marksByMint.get(mint);
      if (!mark) return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: `missing mark for ${mint}`};
      const valuation = computeMark(position, mark, parsedNow, this.runId);
      if (valuation.status !== "PASS") {
        return {status: "VALUATION_UNAVAILABLE", equityCents: null, reason: valuation.reason};
      }
      equity += valuation.netProceedsCents;
      grossOpenValueCents += valuation.grossCents;
      estimatedExitCostsCents += valuation.exitCostsCents;
      grossUnrealizedPnlCents += valuation.grossCents - position.entryNotionalCents;
      netUnrealizedPnlCents += valuation.netProceedsCents - position.entryCostCents;
    }
    return {
      status: "PASS",
      equityCents: equity,
      cashCents: this.cashCents,
      grossOpenValueCents,
      estimatedExitCostsCents,
      grossUnrealizedPnlCents,
      netUnrealizedPnlCents,
      marksByMint
    };
  }

  #updateDailyGate({now, marks = []}) {
    const parsedNow = time(now);
    const localDay = viennaDay(parsedNow);
    if (parsedNow === null || localDay === null) {
      return {status: "EQUITY_UNKNOWN", entriesAllowed: false, reason: "valid current time required"};
    }
    const clockFailure = this.#admitTime(parsedNow);
    if (clockFailure || localDay < this.day) {
      return clockFailure ?? {status: "REJECT", reason: "NON_MONOTONIC_TIME", entriesAllowed: false};
    }
    this.#expireReservations(parsedNow, localDay);
    if (localDay !== this.day) {
      this.#revokeReservations("local calendar day changed; old risk authority cannot roll over");
    }
    const snapshot = this.#snapshotEquity({now: parsedNow, marks});
    if (snapshot.status !== "PASS") {
      return {status: "EQUITY_UNKNOWN", entriesAllowed: false, equityCents: null, reason: snapshot.reason};
    }
    this.lastEquitySnapshot = snapshot;
    if (localDay !== this.day) {
      this.day = localDay;
      this.dailyOpeningEquityCents = snapshot.equityCents;
      this.dailyLossTripped = false;
      this.#record({type: "LOCAL_DAY_OPEN", day: localDay, openingEquityCents: snapshot.equityCents.toString()});
    }
    const loss = this.dailyOpeningEquityCents - snapshot.equityCents;
    const threshold = DAILY_LOSS_LIMIT_CENTS;
    if (loss >= threshold) this.dailyLossTripped = true;
    return {
      status: this.dailyLossTripped ? "DAILY_LOSS_LIMIT" : "PASS",
      entriesAllowed: !this.dailyLossTripped && this.newWorkAllowed,
      equityCents: snapshot.equityCents,
      cashAtMarkCents: snapshot.cashCents,
      grossOpenValueCents: snapshot.grossOpenValueCents,
      estimatedExitCostsCents: snapshot.estimatedExitCostsCents,
      grossUnrealizedPnlCents: snapshot.grossUnrealizedPnlCents,
      netUnrealizedPnlCents: snapshot.netUnrealizedPnlCents,
      dailyOpeningEquityCents: this.dailyOpeningEquityCents,
      lossCents: loss > 0n ? loss : 0n,
      limitCents: threshold,
      marksByMint: snapshot.marksByMint
    };
  }

  authorizeEntry({
    authorizationId,
    candidate,
    filterResult,
    scoreResult,
    tickId,
    now,
    marks = []
  }) {
    const request = {
      authorizationId,
      mint: candidate?.mint,
      chainId: candidate?.chainId,
      pool: candidate?.pool,
      quote: candidate?.quote,
      decimals: candidate?.decimals,
      tickId,
      sampledAt: candidate?.sampledAt
    };
    const requestDigest = digest(request);
    if (typeof authorizationId !== "string" || !SAFE_ID.test(authorizationId) ||
        typeof candidate?.mint !== "string" || !BASE58.test(candidate.mint) ||
        typeof tickId !== "string" || !SAFE_ID.test(tickId)) {
      return {status: "REJECT", reason: "authorization, candidate, and tick identities are required"};
    }
    if (this.authorizationDigests.has(authorizationId)) {
      if (this.authorizationDigests.get(authorizationId) !== requestDigest) {
        return {status: "REJECT", reason: "authorization identity reused with different request"};
      }
      return this.reservations.get(authorizationId) ?? this.authorizationResults.get(authorizationId) ??
        {status: "DUPLICATE", reason: "authorization already consumed"};
    }
    const clockFailure = this.#admitTime(now);
    if (clockFailure) return clockFailure;
    if (!this.newWorkAllowed) return {status: "REJECT", reason: "session is stopped"};
    if (!this.#canRecord()) return {status: "REJECT", reason: "audit capacity reached"};
    if (filterResult?.status !== "PASS" || !filterResult.accepted) {
      return {status: "REJECT", reason: "all hard evidence gates must PASS"};
    }
    if (!decisionBoundToCandidate(filterResult, candidate)) {
      return {status: "REJECT", reason: "hard-filter decision is not bound to this candidate sample"};
    }
    if (scoreResult?.status !== "PASS") {
      return {status: "REJECT", reason: "proposed analyst score must be at least 70"};
    }
    if (!Number.isInteger(scoreResult.score) || scoreResult.score < 0 || scoreResult.score > 100) {
      return {status: "REJECT", reason: "analyst score must be a finite integer from 0 to 100"};
    }
    if (scoreResult.score < 70) return {status: "REJECT", reason: "proposed analyst score must be at least 70"};
    if (!decisionBoundToCandidate(scoreResult, candidate)) {
      return {status: "REJECT", reason: "analyst decision is not bound to this candidate sample"};
    }
    if (candidate.chainId !== "solana" || !BASE58.test(candidate.pool ?? "") ||
        !BASE58.test(candidate.quote ?? "") ||
        !Number.isInteger(candidate.decimals) || candidate.decimals < 0 || candidate.decimals > 18) {
      return {status: "REJECT", reason: "Solana mint, selected pool, and quote identity are required"};
    }
    const candidateSample = time(candidate.sampledAt);
    const currentTime = time(now);
    if (candidateSample === null || currentTime === null || candidateSample > currentTime ||
        currentTime - candidateSample > MAX_QUOTE_AGE_MS) {
      return {status: "REJECT", reason: "fresh candidate sample time is required"};
    }
    const gate = this.#updateDailyGate({now, marks});
    if (!gate.entriesAllowed) {
      if (gate.status === "DAILY_LOSS_LIMIT") this.#revokeReservations("daily loss limit tripped");
      const exitRequests = this.#requestDailyLossExits(gate, now);
      return {
        status: "REJECT",
        reason: gate.status,
        equityCents: gate.equityCents?.toString() ?? null,
        exitRequests
      };
    }
    const reservedMints = new Set([...this.reservations.values()].map(item => item.mint));
    const distinctMints = new Set([...this.positions.keys(), ...reservedMints]);
    if (distinctMints.size >= MAX_POSITIONS) {
      return {status: "REJECT", reason: "maximum of three distinct open or reserved positions reached"};
    }
    const tickMint = `${tickId}:${candidate.mint}`;
    if (this.entriesByTickMint.has(tickMint) || this.positions.has(candidate.mint) ||
        reservedMints.has(candidate.mint)) {
      return {status: "REJECT", reason: "same-tick re-entry or pyramiding is not allowed"};
    }
    const reserved = [...this.reservations.values()]
      .reduce((sum, item) => sum + item.maxSpendCents, 0n);
    const available = this.cashCents - reserved;
    const equityLimit = gate.equityCents * 8n / 100n;
    const maxSpend = [MAX_ENTRY_CENTS, equityLimit, available].reduce((minimum, amount) =>
      amount < minimum ? amount : minimum);
    if (maxSpend <= 0n) return {status: "REJECT", reason: "no unreserved cash available"};
    const authorization = Object.freeze({
      status: "AUTHORIZED",
      authorizationId,
      mint: candidate.mint,
      chainId: candidate.chainId,
      pool: candidate.pool,
      quote: candidate.quote,
      decimals: candidate.decimals,
      tickId,
      sampledAt: new Date(candidateSample).toISOString(),
      authorizedAt: new Date(currentTime).toISOString(),
      authorizedDay: viennaDay(currentTime),
      maxSpendCents: maxSpend,
      stopLossBps: 600,
      trailingActivationBps: 1200,
      trailingDistanceBps: 600,
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false
    });
    this.authorizationDigests.set(authorizationId, requestDigest);
    this.reservations.set(authorizationId, authorization);
    this.entriesByTickMint.add(tickMint);
    this.#record({type: "RISK_AUTHORIZED", authorizationId, mint: candidate.mint,
      maxSpendCents: maxSpend.toString(), tickId, observedAt: new Date(currentTime).toISOString()});
    return authorization;
  }

  executeEntry(authorization, quote, {now = Date.now(), marks = []} = {}) {
    const eventId = quote?.eventId;
    if (typeof eventId !== "string" || !SAFE_ID.test(eventId)) {
      return {status: "REJECT", reason: "stable bounded entry event identity required"};
    }
    const eventPayload = {
      eventId, authorizationId: authorization?.authorizationId, mint: authorization?.mint,
      chainId: authorization?.chainId, pool: authorization?.pool, quote: authorization?.quote,
      quoteIdentity: {
        mint: quote.mint, chainId: quote.chainId, pool: quote.pool, quote: quote.quote
      },
      observedAt: quote.observedAt, priceMicros: quote.priceMicros,
      decimals: quote.decimals, costs: quote.costs, source: quote.source,
      executable: quote.executable, mode: quote.mode,
      ...modeledPayload(quote)
    };
    const eventDigest = digest(eventPayload);
    if (this.eventDigests.has(eventId)) {
      if (this.eventDigests.get(eventId) !== eventDigest) {
        return {status: "REJECT", reason: "event identity reused with different payload"};
      }
      return this.results.get(eventId);
    }
    const clockFailure = this.#admitTime(now);
    if (clockFailure) return clockFailure;
    const auth = this.reservations.get(authorization?.authorizationId);
    if (!auth || auth !== authorization) return {status: "REJECT", reason: "live risk reservation required"};
    const currentTime = time(now);
    const authorizedTime = time(auth.authorizedAt);
    const localDay = currentTime === null ? null : viennaDay(currentTime);
    if (currentTime === null) return {status: "UNFILLED", reason: "valid execution time is required"};
    if (auth.authorizedDay !== localDay) {
      this.#releaseReservation(auth.authorizationId, "REVOKED", "authorization cannot cross a Vienna calendar day");
      return {status: "REJECT", reason: "authorization expired at Vienna calendar-day boundary"};
    }
    if (authorizedTime === null || currentTime < authorizedTime ||
        currentTime - authorizedTime > MAX_QUOTE_AGE_MS) {
      this.#releaseReservation(auth.authorizationId, "EXPIRED", "risk authorization exceeded five-minute validity");
      return {status: "REJECT", reason: "risk authorization is expired"};
    }
    if (this.dailyLossTripped) {
      this.#revokeReservations("daily loss limit already tripped");
      return {status: "REJECT", reason: "daily loss limit already tripped"};
    }
    const identity = {mint: auth.mint, chainId: auth.chainId, pool: auth.pool, quote: auth.quote};
    const fillTime = time(quote.observedAt);
    const authTime = time(auth.sampledAt);
    if (!quoteIdentityValid(quote, identity) || quote.mode !== "HYPOTHETICAL" ||
        quote.executable !== true || fillTime === null || authTime === null ||
        fillTime <= authTime || fillTime <= authorizedTime ||
        fillTime > currentTime || currentTime - fillTime > MAX_QUOTE_AGE_MS ||
        quote.decimals !== auth.decimals ||
        !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) {
      return {status: "UNFILLED", reason: "later identity-bound hypothetical executable quote is unavailable"};
    }
    let modeledEntry = null;
    if (quote.modeled !== undefined) {
      modeledEntry = verifyPaperModeledQuote(quote, {
        runId: this.runId, side: "ENTRY", now: currentTime, decimals: auth.decimals
      });
      if (!modeledEntry.ok) {
        return {status: "UNFILLED", reason: `modeled entry quote refused: ${modeledEntry.reason}`};
      }
    }
    const gate = this.#updateDailyGate({now: currentTime, marks});
    if (gate.status === "EQUITY_UNKNOWN") {
      return {status: "UNFILLED", reason: "fresh complete marks/equity are required; reservation retained"};
    }
    if (gate.status === "DAILY_LOSS_LIMIT") {
      this.#revokeReservations("daily loss limit tripped before entry fill");
      this.#requestDailyLossExits(gate, currentTime);
      return {status: "REJECT", reason: "daily loss limit tripped before entry fill"};
    }
    if (!gate.entriesAllowed || this.reservations.get(auth.authorizationId) !== auth) {
      return {status: "REJECT", reason: "risk reservation was stopped or revoked"};
    }
    let costs;
    let scale;
    try {
      costs = sumCosts(quote.costs, "entry");
      scale = decimalScale(quote.decimals);
    } catch (error) {
      return {status: "UNFILLED", reason: error.message};
    }
    const otherReservations = [...this.reservations.values()]
      .filter(item => item.authorizationId !== auth.authorizationId)
      .reduce((sum, item) => sum + item.maxSpendCents, 0n);
    const available = this.cashCents - otherReservations;
    const currentLimit = [auth.maxSpendCents, MAX_ENTRY_CENTS, gate.equityCents * 8n / 100n, available]
      .reduce((minimum, amount) => amount < minimum ? amount : minimum);
    const maxNotional = currentLimit - costs.total;
    if (maxNotional <= 0n) return {status: "UNFILLED", reason: "entry costs exceed current risk budget"};
    const notionalDenominator = scale * 10_000n;
    const tokenAtoms = modeledEntry
      ? modeledEntry.baseAtoms
      : maxNotional * notionalDenominator / BigInt(quote.priceMicros);
    const rawNotional = tokenAtoms * BigInt(quote.priceMicros);
    const notional = (rawNotional + notionalDenominator - 1n) / notionalDenominator;
    const allIn = notional + costs.total;
    if (modeledEntry && allIn > currentLimit) {
      return {status: "UNFILLED", reason: "modeled quantity exceeds the current risk budget; it is never resized"};
    }
    if (tokenAtoms <= 0n || allIn > currentLimit || allIn > this.cashCents) {
      return {status: "UNFILLED", reason: "conservative base-unit rounding leaves no affordable fill"};
    }
    const pendingMints = new Set([...this.reservations.values()]
      .filter(item => item.authorizationId !== auth.authorizationId).map(item => item.mint));
    const commitDistinctMints = new Set([...this.positions.keys(), ...pendingMints]);
    const commitReservedOther = [...this.reservations.values()]
      .filter(item => item.authorizationId !== auth.authorizationId)
      .reduce((sum, item) => sum + item.maxSpendCents, 0n);
    const commitLimit = [
      auth.maxSpendCents,
      MAX_ENTRY_CENTS,
      gate.equityCents * 8n / 100n,
      this.cashCents - commitReservedOther
    ].reduce((minimum, amount) => amount < minimum ? amount : minimum);
    if (!this.newWorkAllowed || this.dailyLossTripped ||
        this.reservations.get(auth.authorizationId) !== auth ||
        this.positions.has(auth.mint) || pendingMints.has(auth.mint) ||
        commitDistinctMints.size >= MAX_POSITIONS ||
        allIn > commitLimit || !this.#canRecord(2)) {
      return {status: "UNFILLED", reason: "session stopped or audit capacity unavailable"};
    }
    const stopPriceMicros = BigInt(quote.priceMicros) * 9_400n / BPS;
    if (stopPriceMicros <= 0n) return {status: "UNFILLED", reason: "modeled initial stop is invalid"};

    const position = {
      mint: auth.mint,
      chainId: auth.chainId,
      pool: auth.pool,
      quote: auth.quote,
      decimals: quote.decimals,
      scale,
      tokenAtoms,
      entryPriceMicros: BigInt(quote.priceMicros),
      stopPriceMicros,
      highWaterPriceMicros: BigInt(quote.priceMicros),
      trailingActive: false,
      entryNotionalCents: notional,
      entryCostCents: allIn,
      entryCosts: costs.values,
      entryObservedAt: new Date(fillTime).toISOString(),
      lastObservedAt: new Date(fillTime).toISOString(),
      executionRealistic: false,
      ...(modeledEntry ? {modeled: true, modeledDigest: modeledEntry.digest} : {})
    };
    const result = Object.freeze({
      status: "FILLED_PAPER",
      eventId,
      mint: auth.mint,
      tokenAtoms: tokenAtoms.toString(),
      decimals: quote.decimals,
      notionalCents: notional.toString(),
      entryCostsCents: costs.total.toString(),
      allInCents: allIn.toString(),
      entryPriceMicros: String(quote.priceMicros),
      initialStopPriceMicros: stopPriceMicros.toString(),
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false,
      ...(modeledEntry ? {
        provenance: "MODELED", actualCostCoverage: "UNKNOWN", modeledDigest: modeledEntry.digest
      } : {})
    });
    this.cashCents -= allIn;
    this.positions.set(auth.mint, position);
    this.lastEquitySnapshot = null;
    this.reservations.delete(auth.authorizationId);
    this.authorizationResults.set(auth.authorizationId, Object.freeze({
      status: "CONSUMED", authorizationId: auth.authorizationId, eventId, mint: auth.mint
    }));
    for (const [key, value] of Object.entries(costs.values)) this.costTotals.entry[key] += value;
    this.eventDigests.set(eventId, eventDigest);
    this.results.set(eventId, result);
    this.#record({type: "STOP_ARMED", eventId, mint: auth.mint,
      stopPriceMicros: stopPriceMicros.toString(),       observedAt: new Date(fillTime).toISOString()});
    this.#record({type: "PAPER_FILL", ...result});
    return result;
  }

  #closeAtQuote(position, quote, eventId, {reason, gapThroughStop = false} = {}) {
    if (typeof eventId !== "string" || !SAFE_ID.test(eventId)) {
      return {status: "UNFILLED", reason: "stable exit event identity is missing"};
    }
    const payloadDigest = exitPayloadDigest(eventId, quote);
    if (this.eventDigests.has(eventId)) {
      if (this.eventDigests.get(eventId) !== payloadDigest) {
        return {status: "REJECT", reason: "exit event identity reused with different payload"};
      }
      return this.results.get(eventId);
    }
    if (quote.mode !== "HYPOTHETICAL" || quote.executable !== true) {
      return {status: "UNFILLED", reason: "no supported hypothetical executable exit quote"};
    }
    let costs;
    try {
      costs = sumCosts(quote.costs, "exit");
    } catch (error) {
      return {status: "UNFILLED", reason: error.message};
    }
    const price = BigInt(quote.priceMicros);
    const grossCents = position.tokenAtoms * price / (position.scale * 10_000n);
    if (costs.total > grossCents) {
      return {status: "UNFILLED", reason: "exit costs exceed proceeds; position remains open"};
    }
    const proceeds = grossCents - costs.total;
    const pnl = proceeds - position.entryCostCents;
    const grossPnl = grossCents - position.entryNotionalCents;
    if (!this.#canRecord()) return {status: "UNFILLED", reason: "audit capacity unavailable; position remains open"};
    const result = Object.freeze({
      status: "CLOSED_PAPER",
      eventId,
      mint: position.mint,
      fillPriceMicros: price.toString(),
      stopPriceMicros: position.stopPriceMicros.toString(),
      grossProceedsCents: grossCents.toString(),
      exitCostsCents: costs.total.toString(),
      realizedGrossPnlCents: grossPnl.toString(),
      realizedNetPnlCents: pnl.toString(),
      reason,
      executionMode: "SIMULATED_ONLY",
      executionRealistic: false,
      gapThroughStop,
      ...(position.modeled ? {provenance: "MODELED", actualCostCoverage: "UNKNOWN", modeledDigest: quote.modeled.digest} : {})
    });
    this.cashCents += proceeds;
    this.realizedGrossPnlCents += grossPnl;
    this.realizedPnlCents += pnl;
    for (const [key, value] of Object.entries(costs.values)) this.costTotals.exit[key] += value;
    this.positions.delete(position.mint);
    this.lastEquitySnapshot = null;
    this.eventDigests.set(eventId, payloadDigest);
    this.results.set(eventId, result);
    this.#record({type: "PAPER_EXIT", ...result});
    return result;
  }

  #requestDailyLossExits(gate, now) {
    if (gate.status !== "DAILY_LOSS_LIMIT") return [];
    const nowTime = time(now);
    const requests = [];
    for (const [mint, position] of this.positions) {
      const quote = gate.marksByMint?.get(mint);
      const observed = time(quote?.observedAt);
      if (!quote || !quoteIdentityValid(quote, position) || observed === null ||
          observed <= time(position.lastObservedAt) || observed > nowTime ||
          nowTime - observed > MAX_QUOTE_AGE_MS ||
          !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0 ||
          positionQuoteGate(position, quote, nowTime, this.runId)) {
        requests.push({mint, status: "UNFILLED", reason: "risk-reducing quote unavailable; position remains open"});
        continue;
      }
      if (!this.#canRecord()) {
        requests.push({mint, status: "UNFILLED", reason: "audit capacity reached; position remains unchanged"});
        continue;
      }
      const price = BigInt(quote.priceMicros);
      if (price > position.highWaterPriceMicros) position.highWaterPriceMicros = price;
      if (price * BPS >= position.entryPriceMicros * 11_200n) position.trailingActive = true;
      if (position.trailingActive) {
        const trailingStop = position.highWaterPriceMicros * 9_400n / BPS;
        if (trailingStop > position.stopPriceMicros) position.stopPriceMicros = trailingStop;
      }
      position.lastObservedAt = new Date(observed).toISOString();
      const eventId = typeof quote.eventId === "string" && SAFE_ID.test(quote.eventId)
        ? quote.eventId
        : `daily-loss:${this.runId}:${mint}:${new Date(observed).toISOString()}`;
      const exit = this.#closeAtQuote(position, quote, eventId, {
        reason: "DAILY_LOSS_LIMIT",
        gapThroughStop: price < position.stopPriceMicros
      });
      requests.push({mint, ...exit});
    }
    return requests;
  }

  observeExitQuote(quote, {now = quote?.observedAt, eventId = quote?.eventId} = {}) {
    if (typeof eventId === "string" && SAFE_ID.test(eventId) && this.eventDigests.has(eventId)) {
      if (this.eventDigests.get(eventId) !== exitPayloadDigest(eventId, quote)) {
        return {status: "REJECT", reason: "exit event identity reused with different payload"};
      }
      return this.results.get(eventId);
    }
    const clockFailure = this.#admitTime(now);
    if (clockFailure) return clockFailure;
    const position = this.positions.get(quote?.mint);
    if (!position) return {status: "UNKNOWN", reason: "no open position for mint"};
    const observed = time(quote.observedAt);
    const current = time(now);
    if (!quoteIdentityValid(quote, position) || observed === null || current === null ||
        observed <= time(position.lastObservedAt) || observed > current ||
        current - observed > MAX_QUOTE_AGE_MS ||
        !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0) {
      return {status: "VALUATION_UNAVAILABLE", reason: "exit quote is stale, non-monotonic, or identity-mismatched"};
    }
    const modeledFailure = positionQuoteGate(position, quote, current, this.runId);
    if (modeledFailure) {
      return {status: "VALUATION_UNAVAILABLE", reason: `exit quote refused: ${modeledFailure}`};
    }
    const price = BigInt(quote.priceMicros);
    const highWater = price > position.highWaterPriceMicros ? price : position.highWaterPriceMicros;
    const trailingActive = position.trailingActive || price * BPS >= position.entryPriceMicros * 11_200n;
    const trailingStop = trailingActive ? highWater * 9_400n / BPS : position.stopPriceMicros;
    const nextStop = trailingStop > position.stopPriceMicros ? trailingStop : position.stopPriceMicros;
    const triggered = price <= nextStop;
    if (!this.#canRecord(triggered ? 2 : 1)) {
      return {status: "VALUATION_UNAVAILABLE", reason: "audit capacity reached; position remains unchanged"};
    }
    position.highWaterPriceMicros = highWater;
    position.trailingActive = trailingActive;
    position.stopPriceMicros = nextStop;
    position.lastObservedAt = new Date(observed).toISOString();
    this.#record({type: "RISK_MARK", mint: position.mint, observedAt: new Date(observed).toISOString(),
      priceMicros: price.toString(), highWaterPriceMicros: position.highWaterPriceMicros.toString(),
      stopPriceMicros: position.stopPriceMicros.toString(), trailingActive: position.trailingActive});
    if (!triggered) return {status: "MARKED", stopPriceMicros: position.stopPriceMicros.toString()};
    return this.#closeAtQuote(position, quote, eventId, {
      reason: "STOP",
      gapThroughStop: price < position.stopPriceMicros
    });
  }

  riskSnapshot({now, marks = []}) {
    const gate = this.#updateDailyGate({now, marks});
    if (gate.status === "DAILY_LOSS_LIMIT") this.#revokeReservations("daily loss limit tripped");
    const exitRequests = this.#requestDailyLossExits(gate, now);
    return {
      ...gate,
      entriesAllowed: gate.entriesAllowed && this.newWorkAllowed,
      cashCents: this.cashCents,
      realizedGrossPnlCents: this.realizedGrossPnlCents,
      realizedPnlCents: this.realizedPnlCents,
      openPositions: this.positions.size,
      reservedPositions: this.reservations.size,
      exitRequests
    };
  }

  finishRun({startedAt, now, marks = []}) {
    const start = time(startedAt);
    const end = time(now);
    if (start === null || end === null || end < start) {
      return {status: "INVALID_RUN_WINDOW", entriesAllowed: false};
    }
    const clockFailure = this.#admitTime(end);
    if (clockFailure) return clockFailure;
    if (this.#runFinished) {
      return {status: "REJECT", reason: "run already finished", entriesAllowed: false};
    }
    this.newWorkAllowed = false;
    const valued = this.#snapshotEquity({now: end, marks});
    const remaining = [...this.positions.keys()];
    this.#runFinished = true;
    this.#record({type: "RUN_FINISHED", observedAt: new Date(end).toISOString(), openMints: remaining});
    return {
      status: "FINISHED",
      entriesAllowed: false,
      elapsedMs: end - start,
      openPositions: remaining.map(mint => ({
        mint,
        markStatus: valued.status === "PASS" ? "MARKED" : "VALUATION_UNAVAILABLE"
      })),
      equityCents: valued.status === "PASS" ? valued.equityCents.toString() : null,
      auditTruncated: this.auditTruncated,
      accounting: valued.status === "PASS" ? {
        cashCents: valued.cashCents.toString(),
        grossOpenValueCents: valued.grossOpenValueCents.toString(),
        estimatedExitCostsCents: valued.estimatedExitCostsCents.toString(),
        grossUnrealizedPnlCents: valued.grossUnrealizedPnlCents.toString(),
        netUnrealizedPnlCents: valued.netUnrealizedPnlCents.toString(),
        realizedGrossPnlCents: this.realizedGrossPnlCents.toString(),
        realizedNetPnlCents: this.realizedPnlCents.toString(),
        reconciliation: "equity = cash + gross open value - estimated exit costs"
      } : null,
      note: "Open positions are not liquidated at run end; no end-of-run fill is invented."
    };
  }

  auditEvents() {
    return this.events.map(event => ({...event}));
  }

  summary() {
    return {
      runId: this.runId,
      initialCapitalCents: this.initialCapitalCents.toString(),
      cashCents: this.cashCents.toString(),
      pnl: {
        realizedGrossCents: this.realizedGrossPnlCents.toString(),
        realizedNetCents: this.realizedPnlCents.toString(),
        unrealizedGrossCents: this.lastEquitySnapshot?.grossUnrealizedPnlCents.toString() ?? null,
        unrealizedNetCents: this.lastEquitySnapshot?.netUnrealizedPnlCents.toString() ?? null
      },
      costs: Object.fromEntries(Object.entries(this.costTotals).map(([kind, values]) =>
        [kind, Object.fromEntries(Object.entries(values).map(([key, amount]) => [key, amount.toString()]))])),
      lastKnownEquityCents: this.lastEquitySnapshot?.equityCents.toString() ?? null,
      openPositions: [...this.positions.values()].map(position => ({
        mint: position.mint,
        tokenAtoms: position.tokenAtoms.toString(),
        decimals: position.decimals,
        entryCostCents: position.entryCostCents.toString(),
        entryNotionalCents: position.entryNotionalCents.toString(),
        entryCostsCents: Object.fromEntries(Object.entries(position.entryCosts)
          .map(([key, amount]) => [key, amount.toString()])),
        stopPriceMicros: position.stopPriceMicros.toString(),
        trailingActive: position.trailingActive,
        highWaterPriceMicros: position.highWaterPriceMicros.toString(),
        ...(position.modeled ? {modeled: true} : {})
      })),
      eventCount: this.events.length,
      auditTruncated: this.auditTruncated,
      restartDisposition: PaperLedger.restartDisposition(),
      executionRealistic: false
    };
  }
}

export const PAPER_LEDGER_POLICY = Object.freeze({
  initialCapitalCents: INITIAL_CAPITAL_CENTS.toString(),
  maxEntryCents: MAX_ENTRY_CENTS.toString(),
  maxOpenPositions: MAX_POSITIONS,
  initialStopBps: 600,
  trailingActivationBps: 1200,
  trailingDistanceBps: 600,
  dailyLossLimitCents: DAILY_LOSS_LIMIT_CENTS.toString(),
  timezone: "Europe/Vienna",
  clockPolicy: "NONDECREASING_CALLER_TIME_V1",
  restartPolicy: "UNRECOVERABLE_FAIL_CLOSED",
  executionMode: "SIMULATED_ONLY"
});
