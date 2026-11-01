import {normalizeHypotheticalQuote} from "../memecoin-paper-execution-evidence/normalize.mjs";

const ORDER_URL = "https://api.jup.ag/swap/v2/order";
const SCHEMA_VERSION = "2.0.0";
const MAX_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 2_048;
const MAX_AMOUNT_DIGITS = 40;
const MAX_ROUTE_STEPS = 32;
const MAX_QUOTE_AGE_MS = 15_000;
const KEYLESS_INTERVAL_MS = 2_000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTEGER = /^(0|[1-9]\d*)$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const RESPONSE_KEYS = new Set([
  "mode", "inputMint", "outputMint", "inAmount", "outAmount", "inUsdValue",
  "outUsdValue", "priceImpact", "swapUsdValue", "otherAmountThreshold",
  "swapMode", "slippageBps", "priceImpactPct", "routePlan", "referralAccount",
  "feeMint", "feeBps", "platformFee", "signatureFeeLamports",
  "signatureFeePayer", "prioritizationFeeLamports", "prioritizationFeePayer",
  "rentFeeLamports", "rentFeePayer", "swapType", "router",
  "transactionVersion", "transaction", "lastValidBlockHeight", "gasless",
  "requestId", "totalTime", "taker", "quoteId", "maker", "expireAt",
  "errorCode", "errorMessage", "error"
]);
const ROUTERS = new Set(["metis", "jupiterz", "dflow", "okx"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function validAmount(value, {positive = false} = {}) {
  return typeof value === "string" && value.length <= MAX_AMOUNT_DIGITS &&
    INTEGER.test(value) && (!positive || BigInt(value) > 0n);
}

function invalid(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateIdentity(identity) {
  return isRecord(identity) && !Reflect.ownKeys(identity).some(key =>
    !["chainId", "mint", "pool", "quote", "decimals"].includes(key)) &&
    identity.chainId === "solana" &&
    BASE58.test(identity.mint ?? "") && BASE58.test(identity.pool ?? "") &&
    BASE58.test(identity.quote ?? "") &&
    Number.isInteger(identity.decimals) && identity.decimals >= 0 && identity.decimals <= 18;
}

function validateRequest(request) {
  if (!isRecord(request) || Reflect.ownKeys(request).some(key =>
    !["identity", "inputMint", "outputMint", "inputDecimals", "outputDecimals",
      "amount", "slippageBps", "candidateSampledAt", "authorizedAt"].includes(key))) {
    throw invalid("REQUEST_SCHEMA_INVALID");
  }
  const {identity} = request;
  if (!validateIdentity(identity)) throw invalid("REQUEST_IDENTITY_INVALID");
  if (![request.inputMint, request.outputMint].every(mint => BASE58.test(mint ?? "")) ||
      request.inputMint === request.outputMint ||
      ![identity.mint, identity.quote].includes(request.inputMint) ||
      ![identity.mint, identity.quote].includes(request.outputMint)) {
    throw invalid("REQUEST_MINT_BINDING_INVALID");
  }
  for (const [mint, decimals] of [
    [request.inputMint, request.inputDecimals],
    [request.outputMint, request.outputDecimals]
  ]) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 ||
        (mint === identity.mint && decimals !== identity.decimals)) {
      throw invalid("REQUEST_DECIMALS_INVALID");
    }
  }
  if (!validAmount(request.amount, {positive: true})) throw invalid("REQUEST_AMOUNT_INVALID");
  if (!Number.isInteger(request.slippageBps) ||
      request.slippageBps < 0 || request.slippageBps > 10_000) {
    throw invalid("REQUEST_SLIPPAGE_INVALID");
  }
  if (!validTime(request.candidateSampledAt) || !validTime(request.authorizedAt)) {
    throw invalid("REQUEST_CHRONOLOGY_INVALID");
  }
}

function parseResponseJson(bytes) {
  if (bytes.length === 0) throw invalid("RESPONSE_BODY_EMPTY");
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw invalid("RESPONSE_JSON_INVALID");
  }
}

async function readBoundedBody(response) {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/.test(contentLength)) throw invalid("CONTENT_LENGTH_INVALID");
    if (Number(contentLength) > MAX_RESPONSE_BYTES) throw invalid("RESPONSE_TOO_LARGE");
  }
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw invalid("CONTENT_TYPE_INVALID");
  }
  if (!response.body?.getReader) throw invalid("RESPONSE_BODY_MISSING");

  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw invalid("RESPONSE_BODY_INVALID");
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw invalid("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseResponseJson(bytes);
}

function checkOptionalNumber(value, key, {integer = false, min = 0, max = Number.MAX_SAFE_INTEGER} = {}) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) {
    throw invalid(`RESPONSE_FIELD_INVALID:${key}`);
  }
}

function checkOptionalString(value, key, {address = false, nullable = false} = {}) {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== "string" || value.length < 1 || value.length > 256 ||
      (address && !BASE58.test(value))) {
    throw invalid(`RESPONSE_FIELD_INVALID:${key}`);
  }
}

function validateRoutePlan(routePlan) {
  if (!Array.isArray(routePlan) || routePlan.length > MAX_ROUTE_STEPS) {
    throw invalid("RESPONSE_ROUTE_PLAN_INVALID");
  }
  return routePlan.map((step, index) => {
    if (!isRecord(step) || Reflect.ownKeys(step).some(key =>
      !["swapInfo", "percent", "bps", "usdValue"].includes(key)) ||
        !Object.hasOwn(step, "percent") || !Object.hasOwn(step, "bps") ||
        !isRecord(step.swapInfo) ||
        Reflect.ownKeys(step.swapInfo).some(key =>
          !["ammKey", "label", "inputMint", "outputMint", "inAmount", "outAmount"].includes(key))) {
      throw invalid(`RESPONSE_ROUTE_STEP_INVALID:${index}`);
    }
    const info = step.swapInfo;
    if (!BASE58.test(info.ammKey ?? "") ||
        typeof info.label !== "string" || info.label.length > 120 ||
        !BASE58.test(info.inputMint ?? "") || !BASE58.test(info.outputMint ?? "") ||
        !validAmount(info.inAmount, {positive: true}) ||
        !validAmount(info.outAmount, {positive: true})) {
      throw invalid(`RESPONSE_ROUTE_STEP_INVALID:${index}`);
    }
    checkOptionalNumber(step.percent, `routePlan.${index}.percent`, {max: 100});
    checkOptionalNumber(step.bps, `routePlan.${index}.bps`, {max: 10_000});
    checkOptionalNumber(step.usdValue, `routePlan.${index}.usdValue`);
    return {
      swapInfo: {
        ammKey: info.ammKey,
        label: info.label ?? null,
        inputMint: info.inputMint,
        outputMint: info.outputMint,
        inAmount: info.inAmount,
        outAmount: info.outAmount
      },
      percent: step.percent ?? null,
      bps: step.bps ?? null,
      usdValue: step.usdValue ?? null
    };
  });
}

function parseProviderExpiry(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{10}$/.test(value)) {
    throw invalid("RESPONSE_EXPIRY_INVALID");
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) throw invalid("RESPONSE_EXPIRY_INVALID");
  const expiry = seconds * 1_000;
  if (!validTime(expiry)) throw invalid("RESPONSE_EXPIRY_INVALID");
  return expiry;
}

function validateResponse(body, request) {
  if (!isRecord(body) || Reflect.ownKeys(body).some(key =>
    typeof key !== "string" || !RESPONSE_KEYS.has(key))) {
    throw invalid("RESPONSE_SCHEMA_INVALID");
  }
  for (const key of ["inputMint", "outputMint", "inAmount", "outAmount",
    "otherAmountThreshold", "swapMode", "slippageBps", "router", "routePlan"]) {
    if (!Object.hasOwn(body, key)) throw invalid(`RESPONSE_FIELD_MISSING:${key}`);
  }
  if (body.inputMint !== request.inputMint || body.outputMint !== request.outputMint) {
    throw invalid("RESPONSE_MINT_MISMATCH");
  }
  if (!validAmount(body.inAmount, {positive: true}) || body.inAmount !== request.amount ||
      !validAmount(body.outAmount, {positive: true}) ||
      !validAmount(body.otherAmountThreshold, {positive: true}) ||
      BigInt(body.otherAmountThreshold) > BigInt(body.outAmount)) {
    throw invalid("RESPONSE_AMOUNT_INVALID");
  }
  if (body.swapMode !== "ExactIn" || body.slippageBps !== request.slippageBps) {
    throw invalid("RESPONSE_SLIPPAGE_BINDING_INVALID");
  }
  if (typeof body.router !== "string" || !ROUTERS.has(body.router)) {
    throw invalid("RESPONSE_ROUTER_INVALID");
  }
  if (body.transaction !== null || (body.taker !== undefined && body.taker !== null)) {
    throw invalid("RESPONSE_TRANSACTION_NOT_NULL");
  }
  if (body.error !== undefined || body.errorCode !== undefined || body.errorMessage !== undefined) {
    throw invalid("RESPONSE_CONTAINS_ERROR");
  }
  if (body.mode !== undefined && !["ultra", "manual"].includes(body.mode)) {
    throw invalid("RESPONSE_FIELD_INVALID:mode");
  }
  for (const key of ["referralAccount", "signatureFeePayer", "prioritizationFeePayer",
    "rentFeePayer", "maker", "quoteId", "requestId", "lastValidBlockHeight"]) {
    checkOptionalString(body[key], key, {address: [
      "referralAccount", "signatureFeePayer", "prioritizationFeePayer", "rentFeePayer", "maker"
    ].includes(key), nullable: [
      "signatureFeePayer", "prioritizationFeePayer", "rentFeePayer"
    ].includes(key)});
  }
  if (body.requestId !== undefined && !/^[A-Za-z0-9._:-]{1,120}$/.test(body.requestId)) {
    throw invalid("RESPONSE_FIELD_INVALID:requestId");
  }
  if (body.feeMint !== undefined && !BASE58.test(body.feeMint)) {
    throw invalid("RESPONSE_FIELD_INVALID:feeMint");
  }
  for (const key of ["feeBps", "slippageBps"]) {
    checkOptionalNumber(body[key], key, {integer: true, max: 10_000});
  }
  for (const key of ["inUsdValue", "outUsdValue", "swapUsdValue", "signatureFeeLamports",
    "prioritizationFeeLamports", "rentFeeLamports", "totalTime"]) {
    checkOptionalNumber(body[key], key);
  }
  for (const key of ["transactionVersion", "errorCode"]) {
    checkOptionalNumber(body[key], key, {integer: true});
  }
  if (body.transactionVersion !== undefined && ![0, 1].includes(body.transactionVersion)) {
    throw invalid("RESPONSE_FIELD_INVALID:transactionVersion");
  }
  if (body.gasless !== undefined && typeof body.gasless !== "boolean") {
    throw invalid("RESPONSE_FIELD_INVALID:gasless");
  }
  if (body.swapType !== undefined &&
      !["aggregator", "rfq", "aggregator+rfq", "dflow", "okx"].includes(body.swapType)) {
    throw invalid("RESPONSE_FIELD_INVALID:swapType");
  }
  if (body.priceImpact !== undefined) {
    checkOptionalNumber(body.priceImpact, "priceImpact", {min: -100, max: 100});
  }
  if (body.priceImpactPct !== undefined &&
      (typeof body.priceImpactPct !== "string" || body.priceImpactPct.length > 64 ||
       !DECIMAL.test(body.priceImpactPct) || !Number.isFinite(Number(body.priceImpactPct)))) {
    throw invalid("RESPONSE_FIELD_INVALID:priceImpactPct");
  }
  if (body.priceImpact === undefined && body.priceImpactPct === undefined) {
    throw invalid("RESPONSE_PRICE_IMPACT_MISSING");
  }
  let platformFee = null;
  if (body.platformFee !== undefined) {
    if (!isRecord(body.platformFee) ||
        Reflect.ownKeys(body.platformFee).some(key => !["amount", "feeBps", "feeMint"].includes(key)) ||
        (body.platformFee.amount !== undefined && !validAmount(body.platformFee.amount)) ||
        (body.platformFee.feeMint !== undefined && !BASE58.test(body.platformFee.feeMint))) {
      throw invalid("RESPONSE_PLATFORM_FEE_INVALID");
    }
    checkOptionalNumber(body.platformFee.feeBps, "platformFee.feeBps", {integer: true, max: 10_000});
    platformFee = {
      amount: body.platformFee.amount ?? null,
      feeBps: body.platformFee.feeBps ?? null,
      feeMint: body.platformFee.feeMint ?? null
    };
  }
  const routePlan = validateRoutePlan(body.routePlan);
  const providerExpiresAt = parseProviderExpiry(body.expireAt);
  return {
    router: body.router,
    inputMint: body.inputMint,
    outputMint: body.outputMint,
    inAmount: body.inAmount,
    outAmount: body.outAmount,
    minOutAmount: body.otherAmountThreshold,
    swapMode: body.swapMode,
    slippageBps: body.slippageBps,
    priceImpact: body.priceImpact === undefined
      ? {field: "priceImpactPct", value: body.priceImpactPct, deprecated: true}
      : {field: "priceImpact", value: body.priceImpact, unit: "percentage_points"},
    feeBps: body.feeBps ?? null,
    feeMint: body.feeMint ?? null,
    platformFee,
    reportedNetworkFeesLamports: {
      signature: body.signatureFeeLamports ?? null,
      prioritization: body.prioritizationFeeLamports ?? null,
      rent: body.rentFeeLamports ?? null
    },
    routePlan,
    providerExpiresAt,
    requestId: body.requestId ?? null
  };
}

function routeBinding(route, identity, request) {
  if (route.routePlan.length !== 1) {
    return {
      status: route.routePlan.length === 0 ? "UNAVAILABLE" : "MULTI_LEG_UNBOUND",
      selectedPool: identity.pool,
      observedPools: route.routePlan.map(step => step.swapInfo.ammKey)
    };
  }
  const leg = route.routePlan[0];
  const exactLeg = leg.swapInfo.ammKey === identity.pool &&
    leg.swapInfo.inputMint === request.inputMint &&
    leg.swapInfo.outputMint === request.outputMint &&
    leg.swapInfo.inAmount === request.amount &&
    leg.swapInfo.outAmount === route.outAmount &&
    (leg.percent === null || leg.percent === 100) &&
    (leg.bps === null || leg.bps === 10_000);
  return {
    status: exactLeg ? "SINGLE_POOL_MATCH" : "SELECTED_POOL_MISMATCH",
    selectedPool: identity.pool,
    observedPools: [leg.swapInfo.ammKey]
  };
}

function unknownCostEvidence() {
  const components = {};
  for (const component of ["fee", "spread", "slippage", "priceImpact", "network"]) {
    components[component] = {
      status: "UNKNOWN",
      amount: null,
      denomination: null,
      reason: "EXACT_NONOVERLAPPING_USD_COST_NOT_SOURCE_VERIFIED"
    };
  }
  return {
    status: "UNAVAILABLE",
    components,
    doubleCountingPolicy: "Do not add quote output, min-out, feeBps, priceImpact, or lamport estimates as separate USD costs."
  };
}

function normalizeUnavailable(identity, sampleAt, authorizedAt, now) {
  return normalizeHypotheticalQuote(null, {
    identity,
    candidateSampledAt: sampleAt,
    authorizedAt,
    now
  });
}

function normalizeObservedRoute(request, route) {
  return normalizeHypotheticalQuote({
    provider: "Jupiter Swap API",
    schemaVersion: SCHEMA_VERSION,
    source: "Jupiter Swap API V2 /order",
    eventId: route.requestId ?? `jupiter-order-${route.observedAt}`,
    chainId: request.identity.chainId,
    mint: request.identity.mint,
    pool: request.identity.pool,
    quote: request.identity.quote,
    decimals: request.identity.decimals,
    observedAt: route.observedAt,
    priceMicros: null,
    mode: "HYPOTHETICAL",
    executable: false,
    costs: null
  }, {
    identity: request.identity,
    candidateSampledAt: request.candidateSampledAt,
    authorizedAt: request.authorizedAt,
    now: route.observedAt
  });
}

function resultBase(reasons, request, now) {
  return {
    status: "UNAVAILABLE",
    reasons: [...new Set(reasons)],
    provider: "Jupiter Swap API",
    schemaVersion: SCHEMA_VERSION,
    sourceProvenance: "INJECTED_TRANSPORT_NOT_AUTHENTICATED",
    request: request ? {
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      inputDecimals: request.inputDecimals,
      outputDecimals: request.outputDecimals,
      amount: request.amount,
      selectedPool: request.identity?.pool ?? null,
      slippageBps: request.slippageBps
    } : null,
    route: null,
    routeBinding: null,
    costEvidence: unknownCostEvidence(),
    normalization: normalizeUnavailable(
      request?.identity, request?.candidateSampledAt, request?.authorizedAt, now
    ),
    authorizationEligible: false
  };
}

function buildUrl(request) {
  const url = new URL(ORDER_URL);
  url.searchParams.set("inputMint", request.inputMint);
  url.searchParams.set("outputMint", request.outputMint);
  url.searchParams.set("amount", request.amount);
  url.searchParams.set("swapMode", "ExactIn");
  url.searchParams.set("slippageBps", String(request.slippageBps));
  const serialized = url.toString();
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
    throw invalid("REQUEST_TOO_LARGE");
  }
  return serialized;
}

function isRedirected(response, requestUrl) {
  if (response.redirected === true) return true;
  if (!response.url) return false;
  try {
    const actual = new URL(response.url);
    const expected = new URL(requestUrl);
    return actual.href !== expected.href || actual.username !== "" || actual.password !== "";
  } catch {
    return true;
  }
}

export function createJupiterV2QuoteAdapter({
  enabled = false,
  transport,
  clock = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (enabled !== true) {
    return Object.freeze({
      async getQuote() {
        return {
          status: "DISABLED",
          reasons: ["ADAPTER_DISABLED"],
          route: null,
          costEvidence: unknownCostEvidence(),
          authorizationEligible: false
        };
      }
    });
  }
  if (typeof transport !== "function" || typeof clock !== "function" ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError("enabled adapter requires an injected transport, clock, and bounded timeout");
  }

  let lastRequestAt = null;
  return Object.freeze({
    async getQuote(request) {
      let beforeRequest;
      try {
        validateRequest(request);
        beforeRequest = clock();
        if (!validTime(beforeRequest) || beforeRequest <= request.candidateSampledAt ||
            beforeRequest <= request.authorizedAt) {
          throw invalid("REQUEST_CHRONOLOGY_INVALID");
        }
        if (lastRequestAt !== null) {
          if (beforeRequest < lastRequestAt) throw invalid("CLOCK_REGRESSION");
          if (beforeRequest - lastRequestAt < KEYLESS_INTERVAL_MS) {
            throw invalid("KEYLESS_RATE_LIMIT");
          }
        }
      } catch (error) {
        const code = error?.code ?? "REQUEST_INVALID";
        return resultBase([code], request, beforeRequest ?? 0);
      }

      let requestUrl;
      try {
        requestUrl = buildUrl(request);
      } catch (error) {
        return resultBase([error?.code ?? "REQUEST_INVALID"], request, beforeRequest);
      }

      lastRequestAt = beforeRequest;
      const controller = new AbortController();
      let timeoutExpired = false;
      let timeoutHandle;
      const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timeoutExpired = true;
          controller.abort();
          reject(invalid("REQUEST_TIMEOUT"));
        }, timeoutMs);
      });
      const operation = (async () => {
        let response;
        try {
          response = await transport(requestUrl, {
            method: "GET",
            headers: Object.freeze({accept: "application/json"}),
            redirect: "error",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            cache: "no-store",
            signal: controller.signal
          });
        } catch {
          throw invalid("TRANSPORT_ERROR");
        }
        if (!response || !Number.isInteger(response.status)) throw invalid("TRANSPORT_RESPONSE_INVALID");
        if (isRedirected(response, requestUrl) || (response.status >= 300 && response.status < 400)) {
          throw invalid("REDIRECT_REJECTED");
        }
        if (response.status === 401 || response.status === 403) throw invalid("AUTH_DENIED");
        if (response.status === 429) throw invalid("RATE_LIMITED");
        if (response.status !== 200) throw invalid("HTTP_ERROR");
        const body = await readBoundedBody(response);
        const route = validateResponse(body, request);
        const observedAt = clock();
        if (!validTime(observedAt) || observedAt < beforeRequest) throw invalid("CLOCK_INVALID");
        if (observedAt <= request.candidateSampledAt || observedAt <= request.authorizedAt) {
          throw invalid("QUOTE_CHRONOLOGY_INVALID");
        }
        const providerExpiresAt = route.providerExpiresAt;
        if (providerExpiresAt !== null && providerExpiresAt <= observedAt) {
          throw invalid("PROVIDER_QUOTE_EXPIRED");
        }
        const localExpiresAt = observedAt + MAX_QUOTE_AGE_MS;
        const expiresAt = providerExpiresAt === null
          ? localExpiresAt : Math.min(localExpiresAt, providerExpiresAt);
        return {
          route: {
            ...route,
            observedAt,
            expiresAt,
            expirySource: providerExpiresAt === null
              ? "LOCAL_POLICY_ONLY"
              : providerExpiresAt <= localExpiresAt
                ? "PROVIDER_RFQ_AND_LOCAL_POLICY"
                : "PROVIDER_RFQ_BOUNDED_BY_LOCAL_POLICY"
          },
          binding: routeBinding(route, request.identity, request),
          now: observedAt
        };
      })();
      try {
        const observed = await Promise.race([operation, timeout]);
        const result = resultBase([
          "QUOTE_SOURCE_UNVERIFIED",
          "QUOTE_SEMANTICS_UNVERIFIED",
          "COST_EVIDENCE_UNAVAILABLE",
          ...(observed.binding.status === "MULTI_LEG_UNBOUND" ? ["MULTI_LEG_ROUTE_NOT_FIXED_POOL"] : []),
          ...(observed.binding.status === "SELECTED_POOL_MISMATCH" ? ["SELECTED_POOL_NOT_BOUND"] : []),
          ...(observed.binding.status === "UNAVAILABLE" ? ["ROUTE_PLAN_UNAVAILABLE"] : [])
        ], request, observed.now);
        result.route = observed.route;
        result.routeBinding = observed.binding;
        result.normalization = normalizeObservedRoute(request, observed.route);
        return result;
      } catch (error) {
        const code = timeoutExpired ? "REQUEST_TIMEOUT" : error?.code ?? "TRANSPORT_ERROR";
        const failed = resultBase([code], request, beforeRequest);
        failed.normalization = normalizeUnavailable(
          request.identity, request.candidateSampledAt, request.authorizedAt, beforeRequest
        );
        return failed;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
  });
}
