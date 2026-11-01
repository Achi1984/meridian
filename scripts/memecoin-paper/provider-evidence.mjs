import {
  assertAllowedSolanaRpcMethod,
  parseDexScreenerPair,
  parseSolanaLargestAccounts
} from "./adapters.mjs";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DECIMAL_INTEGER = /^(?:0|[1-9]\d{0,39})$/;
const DECIMAL_AMOUNT = /^(?:0|[1-9]\d{0,39})(?:\.\d+)?$/;
const DEX_HOST = "api.dexscreener.com";
const RPC_HOST = "api.mainnet-beta.solana.com";
const DEX_SOURCE = "DexScreener public API";
const RPC_SOURCE = "Solana JSON-RPC";
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const FIXED_BUDGET_CEILINGS = Object.freeze({
  maxRequestsPerRun: 960,
  maxRequestsPerProvider: 480,
  maxBytesPerResponse: 1_048_576,
  maxBytesPerRun: 10_485_760,
  maxEvents: 10_000,
  maxCandidates: 300
});
const ALLOWED_OPTIONS = new Set([
  "manifest", "candidates", "enabled", "transport", "clock", "signal",
  "freshnessPolicy", "requestTimeoutMs"
]);
const FILTER_KEYS = Object.freeze([
  "pairCreatedAt", "marketCapUsd", "tokenDecimals", "mintAuthorityRevoked",
  "freezeAuthorityRevoked", "lpProtection", "liquidityUsd", "volume1hUsd",
  "top10OwnerPct", "devAssociatedPct", "crediblePriorRug", "bundledLaunchPct",
  "priceChange1hPct", "tokenExtensions"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

function assertAddress(value, label) {
  if (typeof value !== "string" || !BASE58.test(value)) {
    throw new TypeError(`${label} must be a validated Solana address`);
  }
  return value;
}

function assertPositiveInteger(value, label, ceiling) {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new TypeError(`${label} is outside the bounded manifest range`);
  }
  return value;
}

function enabledManifest(manifest, enabled) {
  if (enabled !== true || manifest?.enabled !== true) return false;
  const providers = manifest.providers;
  return manifest.mode === "READ_ONLY_PAPER" &&
    manifest.execution === "SIMULATED_ONLY" &&
    manifest.stopSwitch?.engaged === false &&
    Array.isArray(providers) && providers.length === 2 &&
    providers.some(item => item?.name === DEX_SOURCE && item.host === DEX_HOST && item.enabled === true) &&
    providers.some(item => item?.name === "Solana mainnet public JSON-RPC" &&
      item.host === RPC_HOST && item.enabled === true);
}

function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.http?.credentials !== false ||
      manifest.http?.redirects !== "error" || manifest.http?.arbitraryUrls !== false ||
      manifest.http?.tokenProvidedUrls !== false) {
    throw new TypeError("manifest must deny credentials, redirects, and caller-selected URLs");
  }
  const providers = manifest.providers;
  if (!Array.isArray(providers) || providers.length !== 2 ||
      !providers.some(item => item?.name === DEX_SOURCE && item.host === DEX_HOST) ||
      !providers.some(item => item?.name === "Solana mainnet public JSON-RPC" && item.host === RPC_HOST)) {
    throw new TypeError("manifest provider hosts do not match the fixed allowlist");
  }
  const budget = manifest.pollBudget;
  if (!isRecord(budget)) throw new TypeError("manifest pollBudget is required");
  const validatedBudget = {};
  for (const [name, ceiling] of Object.entries(FIXED_BUDGET_CEILINGS)) {
    validatedBudget[name] = assertPositiveInteger(budget[name], name, ceiling);
  }
  if (validatedBudget.maxBytesPerResponse > validatedBudget.maxBytesPerRun) {
    throw new TypeError("per-response byte budget exceeds the run byte budget");
  }
  if (!Array.isArray(manifest.allowedMints) || !Array.isArray(manifest.allowedPools) ||
      manifest.allowedMints.length < 1 || manifest.allowedPools.length < 1 ||
      manifest.allowedMints.length > validatedBudget.maxCandidates ||
      manifest.allowedPools.length > validatedBudget.maxCandidates) {
    throw new TypeError("manifest must provide bounded, nonempty mint and pool allowlists");
  }
  const allowedMints = new Set(manifest.allowedMints.map(mint => assertAddress(mint, "allowed mint")));
  const allowedPools = new Set(manifest.allowedPools.map(pool => assertAddress(pool, "allowed pool")));
  if (allowedMints.size !== manifest.allowedMints.length ||
      allowedPools.size !== manifest.allowedPools.length) {
    throw new TypeError("manifest allowlists must not contain duplicates");
  }
  return {budget: validatedBudget, allowedMints, allowedPools};
}

function validateFreshnessPolicy(policy) {
  if (!isRecord(policy) || Reflect.ownKeys(policy).some(key =>
    !["maxAcquisitionDurationMs", "maxPairAgeMs", "maxFutureSkewMs"].includes(key))) {
    throw new TypeError("an explicit bounded freshness policy is required");
  }
  return {
    maxAcquisitionDurationMs: assertPositiveInteger(
      policy.maxAcquisitionDurationMs, "maxAcquisitionDurationMs", 30 * 60 * 1000),
    maxPairAgeMs: assertPositiveInteger(policy.maxPairAgeMs, "maxPairAgeMs", 7 * 24 * 60 * 60 * 1000),
    maxFutureSkewMs: Number.isSafeInteger(policy.maxFutureSkewMs) &&
      policy.maxFutureSkewMs >= 0 && policy.maxFutureSkewMs <= 60_000
      ? policy.maxFutureSkewMs : (() => { throw new TypeError("maxFutureSkewMs is invalid"); })()
  };
}

function validateOptions(options) {
  if (!isRecord(options) || Reflect.ownKeys(options).some(key =>
    typeof key !== "string" || !ALLOWED_OPTIONS.has(key))) {
    throw new TypeError("unknown provider adapter option; caller headers and URLs are forbidden");
  }
}

function makeRequest(provider, kind, candidate, id) {
  if (provider === "dex") {
    const url = `https://${DEX_HOST}/latest/dex/pairs/solana/${candidate.pool}`;
    return Object.freeze({
      provider,
      kind,
      id,
      url,
      method: "GET",
      headers: Object.freeze({accept: "application/json"}),
      redirect: "error",
      credentials: "omit"
    });
  }
  const rpcMethod = assertAllowedSolanaRpcMethod(kind);
  return Object.freeze({
    provider,
    kind: rpcMethod,
    id,
    url: `https://${RPC_HOST}`,
    method: "POST",
    headers: Object.freeze({accept: "application/json", "content-type": "application/json"}),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: rpcMethod,
      params: rpcMethod === "getAccountInfo"
        ? [candidate.mint, {encoding: "base64", commitment: "finalized"}]
        : [candidate.mint, {commitment: "finalized"}]
    }),
    redirect: "error",
    credentials: "omit"
  });
}

function planRequests(candidates, allowlists) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError("at least one fixed candidate identity is required");
  }
  return candidates.map((candidate, index) => {
    if (!isRecord(candidate) || candidate.chainId !== "solana") {
      throw new TypeError(`candidate ${index} must identify the Solana chain`);
    }
    const mint = assertAddress(candidate.mint, "candidate mint");
    const pool = assertAddress(candidate.pool, "candidate pool");
    const quote = assertAddress(candidate.quote, "candidate quote");
    if (!allowlists.allowedMints.has(mint) || !allowlists.allowedPools.has(pool)) {
      throw new TypeError(`candidate ${index} is outside the manifest mint/pool allowlists`);
    }
    return Object.freeze({chainId: "solana", mint, pool, quote});
  }).flatMap((candidate, index) => {
    const id = index * 4 + 1;
    return [
      makeRequest("dex", "pair", candidate, id),
      makeRequest("rpc", "getAccountInfo", candidate, id + 1),
      makeRequest("rpc", "getTokenLargestAccounts", candidate, id + 2),
      makeRequest("rpc", "getTokenSupply", candidate, id + 3)
    ].map(request => Object.freeze({...request, candidateIndex: index, requested: candidate}));
  });
}

function raceWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("request aborted"));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new Error("request aborted"));
    };
    signal.addEventListener("abort", onAbort, {once: true});
    promise.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

function requestFailure(status, reason, returned = null) {
  const error = new Error(reason);
  error.status = status;
  error.returned = returned;
  return error;
}

async function readJson(response, {signal, maxBytes, consume}) {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw requestFailure("INVALID_CONTENT_TYPE", "provider response was not JSON");
  }
  const lengthHeader = response.headers?.get?.("content-length");
  let declaredLength = null;
  if (lengthHeader !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(lengthHeader) || !Number.isSafeInteger(Number(lengthHeader))) {
      throw requestFailure("INVALID_CONTENT_LENGTH", "provider content length was invalid");
    }
    declaredLength = Number(lengthHeader);
    if (declaredLength > maxBytes) {
      throw requestFailure("RESPONSE_TOO_LARGE", "provider response exceeded its byte limit");
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw requestFailure("MISSING_RESPONSE_STREAM", "provider response stream was unavailable");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await raceWithAbort(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw requestFailure("INVALID_RESPONSE_CHUNK", "provider response stream was malformed");
      }
      if (size + value.byteLength > maxBytes) {
        throw requestFailure("RESPONSE_TOO_LARGE", "provider response exceeded its byte limit");
      }
      consume(value.byteLength);
      chunks.push(value);
      size += value.byteLength;
    }
  } catch (error) {
    try { reader.cancel?.().catch?.(() => {}); } catch { /* reader may already be closed */ }
    throw error;
  } finally {
    try { reader.releaseLock?.(); } catch { /* an aborted read may still be pending */ }
  }
  if (declaredLength !== null && declaredLength !== size) {
    throw requestFailure("INVALID_CONTENT_LENGTH", "provider body length did not match its header");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch {
    throw requestFailure("INVALID_UTF8", "provider response was not valid UTF-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw requestFailure("INVALID_JSON", "provider response was not valid JSON");
  }
}

function validateDexNumbers(pair) {
  for (const [value, label] of [
    [pair.marketCap, "marketCap"], [pair.fdv, "fdv"],
    [pair.liquidity?.usd, "liquidity.usd"], [pair.volume?.h1, "volume.h1"],
    [pair.priceChange?.h1, "priceChange.h1"]
  ]) {
    if (value !== undefined && value !== null &&
        (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      throw requestFailure("INVALID_DECIMAL", `${label} was not a valid nonnegative number`);
    }
  }
  if (pair.pairCreatedAt !== undefined && pair.pairCreatedAt !== null &&
      !validTime(pair.pairCreatedAt)) {
    throw requestFailure("INVALID_SOURCE_TIME", "pairCreatedAt was not a valid millisecond timestamp");
  }
  for (const value of [pair.txns?.h1?.buys, pair.txns?.h1?.sells]) {
    if (value !== undefined && value !== null &&
        (!Number.isSafeInteger(value) || value < 0)) {
      throw requestFailure("INVALID_TRANSACTION_COUNT", "transaction counts must be nonnegative integers");
    }
  }
}

function findDexPair(payload, requested, receivedAt, freshness) {
  if (!isRecord(payload) || !Array.isArray(payload.pairs) || payload.pairs.length > 100) {
    throw requestFailure("INVALID_DEX_SCHEMA", "DexScreener pair response schema was invalid");
  }
  if (payload.pairs.length !== 1) {
    throw requestFailure("AMBIGUOUS_DEX_PAIRS", "pair response did not contain exactly one pool");
  }
  const pair = payload.pairs[0];
  if (!isRecord(pair) || pair.chainId !== requested.chainId ||
      pair.pairAddress !== requested.pool || pair.baseToken?.address !== requested.mint ||
      pair.quoteToken?.address !== requested.quote) {
    throw requestFailure("IDENTITY_MISMATCH",
      "returned chain, mint, pool, or quote did not match the request", {
        chainId: pair?.chainId ?? null,
        mint: pair?.baseToken?.address ?? null,
        pool: pair?.pairAddress ?? null,
        quote: pair?.quoteToken?.address ?? null
      });
  }
  validateDexNumbers(pair);
  if (!validTime(pair.pairCreatedAt) || pair.pairCreatedAt > receivedAt + freshness.maxFutureSkewMs ||
      receivedAt - pair.pairCreatedAt > freshness.maxPairAgeMs) {
    throw requestFailure("SOURCE_TIME_OUTSIDE_POLICY", "pair creation time was future-dated or outside freshness policy");
  }
  const parsed = parseDexScreenerPair(pair, {sampledAt: receivedAt, observedAt: receivedAt});
  if (parsed.status !== "PARTIAL") {
    throw requestFailure("INVALID_DEX_SCHEMA", parsed.reason);
  }
  return parsed;
}

function rpcResult(payload, request) {
  if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== request.id ||
      payload.error !== undefined || !Object.hasOwn(payload, "result")) {
    throw requestFailure("INVALID_RPC_ENVELOPE", "Solana RPC response envelope was invalid");
  }
  const result = payload.result;
  if (!isRecord(result) || !isRecord(result.context) ||
      !Number.isSafeInteger(result.context.slot) || result.context.slot < 0 ||
      !Object.hasOwn(result, "value")) {
    throw requestFailure("INVALID_RPC_SCHEMA", "Solana RPC result or context slot was invalid");
  }
  return result;
}

function validateAccountInfo(value) {
  if (value === null) return;
  if (!isRecord(value) || typeof value.owner !== "string" || !BASE58.test(value.owner) ||
      !Array.isArray(value.data) || value.data.length !== 2 ||
      typeof value.data[0] !== "string" || value.data[0].length > 1_000_000 ||
      value.data[1] !== "base64") {
    throw requestFailure("INVALID_ACCOUNT_INFO", "getAccountInfo value schema was invalid");
  }
}

function validateLargestAccounts(value) {
  if (!Array.isArray(value) || value.length > 20 || value.some(account =>
    !isRecord(account) || typeof account.address !== "string" || !BASE58.test(account.address) ||
    typeof account.amount !== "string" || !DECIMAL_INTEGER.test(account.amount) ||
    !Number.isInteger(account.decimals) || account.decimals < 0 || account.decimals > 18)) {
    throw requestFailure("INVALID_LARGEST_ACCOUNTS", "largest-account response contained invalid amount or decimal fields");
  }
}

function validateTokenSupply(value) {
  if (!isRecord(value) || typeof value.amount !== "string" || !DECIMAL_INTEGER.test(value.amount) ||
      !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 18 ||
      (value.uiAmount !== null && value.uiAmount !== undefined &&
        (typeof value.uiAmount !== "number" || !Number.isFinite(value.uiAmount) || value.uiAmount < 0)) ||
      (value.uiAmountString !== null && value.uiAmountString !== undefined &&
        (typeof value.uiAmountString !== "string" || !DECIMAL_AMOUNT.test(value.uiAmountString)))) {
    throw requestFailure("INVALID_TOKEN_SUPPLY", "token supply amount or decimal schema was invalid");
  }
}

function eventFor(request, status, reason, requestedAt, receivedAt, bytes = 0, returned = null) {
  return {
    requestId: request.id,
    provider: request.provider === "dex" ? DEX_SOURCE : RPC_SOURCE,
    endpointKind: request.kind,
    requested: request.requested,
    returned,
    status,
    reason,
    requestedAt,
    receivedAt,
    observedAtBasis: "response-receipt-not-source-event-time",
    bytes
  };
}

function supportedRecord(value, request, observedAt, slot, coverage = {complete: true}) {
  return {
    value,
    source: request.provider === "dex" ? DEX_SOURCE
      : request.provider === "rpc" ? `${RPC_SOURCE} ${request.kind}` : "Provider evidence boundary",
    observedAt,
    sourceTime: coverage.sourceTime === true ? value : null,
    sourceTimeKind: coverage.sourceTime === true
      ? "pairCreatedAt" : (request.provider === "dex" ? "not-provided-for-market-snapshot" : "slot-only"),
    slot,
    verified: true,
    coverage,
    binding: {
      chainId: request.requested.chainId,
      mint: request.requested.mint,
      pool: request.requested.pool,
      quote: request.requested.quote
    }
  };
}

function unknownRecord(reason, request, observedAt, slot = null) {
  return supportedRecord(null, request, observedAt, slot, {complete: false, reason});
}

function normalizeCandidate(identity, responses, sampledAt, identityMismatch) {
  const pair = responses.get("pair");
  const supply = responses.get("getTokenSupply");
  const largest = responses.get("getTokenLargestAccounts");
  const accountInfo = responses.get("getAccountInfo");
  const pairData = pair?.parsed ?? null;
  const observedAt = Math.max(sampledAt, ...[...responses.values()].map(item => item.receivedAt ?? sampledAt));
  const evidence = {};
  for (const key of FILTER_KEYS) {
    evidence[key] = unknownRecord("required evidence is not provided by the allowed sources", {
      provider: "boundary",
      kind: key.startsWith("mint") || key.startsWith("freeze") || key === "tokenExtensions"
        ? "getAccountInfo"
        : key === "top10OwnerPct" ? "getTokenLargestAccounts" : "pair",
      requested: identity
    }, observedAt);
  }
  if (identityMismatch) {
    for (const key of FILTER_KEYS) {
      evidence[key] = unknownRecord("provider returned a mismatched chain, mint, pool, or quote identity",
        {provider: "boundary", kind: "pair", requested: identity}, observedAt);
    }
  } else if (pairData) {
    const pairRequest = pair.request;
    const pairValues = {
      pairCreatedAt: pairData.pairCreatedAt,
      marketCapUsd: pairData.marketCapUsd,
      liquidityUsd: pairData.liquidityUsd,
      volume1hUsd: pairData.volume1hUsd,
      priceChange1hPct: pairData.priceChange1hPct
    };
    for (const [key, value] of Object.entries(pairValues)) {
      evidence[key] = value === null || value === undefined
        ? unknownRecord(key === "marketCapUsd"
          ? "DexScreener marketCap is absent; fdv is not a substitute"
          : `DexScreener ${key} is absent`, pairRequest, pair.receivedAt)
        : supportedRecord(value, pairRequest, pair.receivedAt, null,
          {complete: true, sourceTime: key === "pairCreatedAt"});
    }
  }
  if (supply?.value) {
    const request = supply.request;
    evidence.tokenDecimals = supportedRecord(supply.value.decimals, request, supply.receivedAt,
      supply.slot, {complete: true, amountAtoms: supply.value.amount});
  }
  if (largest?.value) {
    const request = largest.request;
    const parsed = parseSolanaLargestAccounts({
    result: {context: {slot: largest.slot}, value: largest.value.result.value}
    }, {observedAt: largest.receivedAt, slot: largest.slot});
    evidence.top10OwnerPct = unknownRecord(
    parsed.note ?? "top20 token accounts are neither complete supply coverage nor unique-owner aggregation",
    request, largest.receivedAt, largest.slot);
  }
  if (accountInfo) {
    for (const key of ["mintAuthorityRevoked", "freezeAuthorityRevoked", "tokenExtensions"]) {
      evidence[key] = unknownRecord(
        "getAccountInfo bytes were not decoded as verified mint authorities or Token-2022 extensions",
        accountInfo.request, accountInfo.receivedAt, accountInfo.slot);
    }
  }
  const transactions = pairData?.transactions1h ?? null;
  return {
    candidate: {
      chainId: identity.chainId,
      mint: identity.mint,
      pool: identity.pool,
      quote: identity.quote,
      source: DEX_SOURCE,
      sampledAt,
      pairCreatedAt: pairData?.pairCreatedAt ?? null,
      marketCapUsd: pairData?.marketCapUsd ?? null,
      decimals: supply?.value?.decimals ?? null,
      tokenSupplyAtoms: supply?.value?.amount ?? null,
      transactionCounts1h: transactions,
      largestTokenAccounts: largest?.value?.result?.value ?? null,
      mintAccountInfo: accountInfo?.value?.result?.value ?? null,
      evidence
    },
    identityStatus: identityMismatch ? "UNKNOWN" : "BOUND_TO_REQUEST",
    coverage: {
      pair: pairData ? "PARTIAL" : "UNKNOWN",
      tokenSupply: supply ? "AMOUNT_AND_DECIMALS_ONLY" : "UNKNOWN",
      largestAccounts: largest ? "TOP20_TOKEN_ACCOUNTS_ONLY" : "UNKNOWN",
      mintAuthorities: "UNKNOWN",
      tokenExtensions: "UNKNOWN",
      sourceEventTimeForMarketData: "UNAVAILABLE",
      receiptTimeIsNotSourceEventTime: true
    }
  };
}

async function performRequest(request, {
  transport, signal, timeoutMs, maxBytes, release, consume, clock, freshness
}) {
  const requestedAt = clock();
  if (!validTime(requestedAt)) {
    release();
    return {event: eventFor(request, "INVALID_CLOCK", "injected clock returned invalid time", null, null)};
  }
  if (signal?.aborted) {
    release();
    return {event: eventFor(request, "ABORTED", "caller aborted before dispatch", requestedAt, null)};
  }
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal.reason ?? new Error("caller aborted"));
  signal?.addEventListener("abort", onCallerAbort, {once: true});
  const timeout = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
  let responseBytes = 0;
  try {
    const response = await raceWithAbort(Promise.resolve().then(() => transport(request, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit"
    })), controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (response.status >= 300 && response.status < 400) {
      throw requestFailure("REDIRECT_BLOCKED", "provider redirect was blocked");
    }
    if (response.status === 429) throw requestFailure("HTTP_429", "provider returned HTTP 429; no retry was attempted");
    if (response.status !== 200) throw requestFailure(`HTTP_${response.status}`, "provider returned a non-success status");
    const payload = await readJson(response, {
      signal: controller.signal,
      maxBytes,
      consume: amount => {
        responseBytes += amount;
        consume(amount);
      }
    });
    const receivedAt = clock();
    if (!validTime(receivedAt) || receivedAt < requestedAt ||
        receivedAt - requestedAt > freshness.maxAcquisitionDurationMs) {
      throw requestFailure("STALE_ACQUISITION", "response acquisition exceeded freshness policy");
    }
    let value;
    let slot = null;
    let returned = null;
    if (request.provider === "dex") {
      value = findDexPair(payload, request.requested, receivedAt, freshness);
      returned = {
        chainId: value.chainId, mint: value.mint, pool: value.pool, quote: value.quote
      };
    } else {
      const result = rpcResult(payload, request);
      slot = result.context.slot;
      if (request.kind === "getAccountInfo") validateAccountInfo(result.value);
      else if (request.kind === "getTokenLargestAccounts") validateLargestAccounts(result.value);
      else validateTokenSupply(result.value);
      value = {result};
      returned = {chainId: null, mint: null, pool: null, quote: null, slot};
    }
    const event = eventFor(request, "RECEIVED", null, requestedAt, receivedAt, responseBytes, returned);
    return {event, value, slot, request, receivedAt, parsed: request.provider === "dex" ? value : null};
  } catch (error) {
    const receivedAt = clock();
    const reason = error?.status ? error.message
      : controller.signal.aborted
        ? (signal?.aborted ? "caller aborted during request" : "request deadline exceeded")
        : "injected transport or response processing failed";
    const status = error?.status ?? (controller.signal.aborted
      ? (signal?.aborted ? "ABORTED" : "TIMEOUT") : "TRANSPORT_ERROR");
    return {event: eventFor(request, status, reason, requestedAt,
      validTime(receivedAt) ? receivedAt : null, responseBytes, error?.returned ?? null)};
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onCallerAbort);
    release();
  }
}

export async function acquireProviderEvidence(options) {
  validateOptions(options);
  const {
    manifest, candidates, enabled = false, transport, clock, signal,
    freshnessPolicy, requestTimeoutMs = DEFAULT_TIMEOUT_MS
  } = options;
  if (!enabledManifest(manifest, enabled)) {
    return {
      status: "DISABLED",
      networkAccessed: false,
      events: [],
      candidates: [],
      counters: {requests: 0, bytes: 0, events: 0, reservedBytes: 0}
    };
  }
  if (typeof transport !== "function" || typeof clock !== "function") {
    throw new TypeError("enabled acquisition requires injected transport and clock functions");
  }
  const {budget, allowedMints, allowedPools} = validateManifest(manifest);
  const freshness = validateFreshnessPolicy(freshnessPolicy);
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 ||
      requestTimeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError("requestTimeoutMs must be between 1 and 30000 ms");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal");
  }
  if (!Array.isArray(candidates) || candidates.length > budget.maxCandidates) {
    throw new TypeError("candidate count exceeded the manifest limit");
  }
  const identities = planRequests(candidates, {allowedMints, allowedPools});
  const counter = {
    requests: 0, bytes: 0, reservedBytes: 0, events: 0,
    byProvider: {dex: 0, rpc: 0}
  };
  const results = identities.map(() => new Map());
  const events = [];
  let stoppedReason = null;
  let nextRequestId = 0;

  for (let offset = 0; offset < identities.length && !stoppedReason; offset += 4) {
    const batch = identities.slice(offset, offset + 4);
    const pending = [];
    for (const planned of batch) {
      if (signal?.aborted) {
        stoppedReason = "caller aborted; no further requests dispatched";
        break;
      }
      if (counter.requests >= budget.maxRequestsPerRun ||
          counter.byProvider[planned.provider] >= budget.maxRequestsPerProvider ||
          counter.events >= budget.maxEvents) {
        stoppedReason = "request or event budget exhausted; no further requests dispatched";
        break;
      }
      const request = Object.freeze({...planned, id: ++nextRequestId});
      const maxBytes = budget.maxBytesPerResponse;
      if (counter.bytes + counter.reservedBytes + maxBytes > budget.maxBytesPerRun) {
        stoppedReason = "run byte budget exhausted; no further requests dispatched";
        break;
      }
      counter.requests += 1;
      counter.byProvider[request.provider] += 1;
      counter.events += 1;
      counter.reservedBytes += maxBytes;
      const release = () => { counter.reservedBytes -= maxBytes; };
      const consume = amount => { counter.bytes += amount; };
      pending.push(performRequest(request, {
        transport, signal, timeoutMs: requestTimeoutMs, maxBytes,
        release, consume, clock, freshness
      }).then(outcome => ({request, outcome})));
    }
    const completed = await Promise.all(pending);
    for (const {request, outcome} of completed) {
      if (outcome.event.status === "IDENTITY_MISMATCH") {
        results[request.candidateIndex].set(request.kind, {...outcome, request, identityMismatch: true});
        stoppedReason = "provider identity mismatch; no further requests dispatched";
      } else if (outcome.value !== undefined) {
        results[request.candidateIndex].set(request.kind, {...outcome, request});
      }
      events.push(outcome.event);
      if (outcome.event.status === "ABORTED" || outcome.event.status === "TIMEOUT") {
        stoppedReason = "aborted or timed out; no further requests dispatched";
      }
    }
  }

  const finalNow = clock();
  const sampledAt = Math.max(validTime(finalNow) ? finalNow : 0,
    ...events.map(event => validTime(event.receivedAt) ? event.receivedAt : 0));
  const normalized = identities.map((identity, index) => {
    const candidateEvents = [...results[index].values()];
    const identityMismatch = candidateEvents.some(item => item.identityMismatch);
    const responseMap = new Map(candidateEvents.map(item => [item.request.kind, item]));
    return normalizeCandidate(identity, responseMap, sampledAt, identityMismatch);
  });
  return {
    status: stoppedReason ? "PARTIAL" : "ACQUISITION_FINISHED",
    networkAccessed: events.length > 0,
    stoppedReason,
    events,
    candidates: normalized,
    counters: {
      requests: counter.requests,
      bytes: counter.bytes,
      events: counter.events,
      reservedBytes: counter.reservedBytes,
      byProvider: {...counter.byProvider}
    }
  };
}
