import {createJupiterV2QuoteAdapter} from "../memecoin-paper-route-quotes/jupiter-v2.mjs";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTEGER = /^(0|[1-9]\d{0,39})$/;
const MAX_TIMEOUT_MS = 5_000;
const MAX_CAUSAL_AGE_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 100;
const COSTS = Object.freeze(["fee", "spread", "slippage", "priceImpact", "network"]);
const SOURCE = "Jupiter Swap API V2 /order";

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

function emptyResult(status, reasons, request = null) {
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
    authorizationEligible: false
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
    async getPaperQuote(value, {signal} = {}) {
      if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function")) {
        return emptyResult("UNAVAILABLE", ["ABORT_SIGNAL_INVALID"]);
      }
      let request;
      try {
        request = copyRequest(value);
      } catch {
        return emptyResult("UNAVAILABLE", ["REQUEST_INVALID"]);
      }
      if (signal?.aborted) return emptyResult("UNAVAILABLE", ["REQUEST_CANCELLED"], request);
      if (inFlight) return emptyResult("UNAVAILABLE", ["REQUEST_ALREADY_IN_FLIGHT"], request);
      if (requestsStarted >= maxRequests) {
        return emptyResult("UNAVAILABLE", ["REQUEST_BUDGET_EXHAUSTED"], request);
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
          return emptyResult("UNAVAILABLE", ["REQUEST_CANCELLED"], request);
        }
        if (!observed.route) {
          return emptyResult("UNAVAILABLE", observed.reasons, request);
        }
        const {candidate, reasons} = buildCandidate(request, observed);
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
          authorizationEligible: false
        };
      } catch {
        return emptyResult("UNAVAILABLE", ["QUOTE_ADAPTER_ERROR"], request);
      } finally {
        inFlight = false;
        externalSignal = null;
      }
    }
  });
}
