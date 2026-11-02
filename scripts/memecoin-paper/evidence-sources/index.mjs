import {createHash} from "node:crypto";

const DEX_ORIGIN = "https://api.dexscreener.com";
const PROFILES_PATH = "/token-profiles/latest/v1";
const TOKENS_PATH = "/latest/dex/tokens/";
const PROFILE_SOURCE = "DexScreener public API latest token profiles";
const PAIR_SOURCE = "DexScreener public API token pairs";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HARD_LIMITS = Object.freeze({
  maxProfiles: 1_000,
  maxCandidates: 300,
  maxPairRows: 3_000,
  maxRequests: 11,
  maxBytesPerResponse: 1_048_576,
  maxBytesPerRun: 10_485_760,
  maxDurationMs: 30_000,
  requestTimeoutMs: 10_000
});
const DEFAULT_LIMITS = Object.freeze({
  maxProfiles: 300,
  maxCandidates: 300,
  maxPairRows: 1_000,
  maxRequests: 11,
  maxBytesPerResponse: 1_048_576,
  maxBytesPerRun: 10_485_760,
  maxDurationMs: 30_000,
  requestTimeoutMs: 5_000
});
const REQUEST_ERROR_CODES = new Set([
  "CANCELLED",
  "INVALID_CONTENT_LENGTH",
  "INVALID_CONTENT_TYPE",
  "INVALID_HTTP_STATUS",
  "INVALID_JSON",
  "INVALID_LOCAL_CLOCK",
  "INVALID_RESPONSE_CHUNK",
  "INVALID_RESPONSE_URL",
  "INVALID_UTF8",
  "MISSING_RESPONSE_STREAM",
  "REDIRECT_BLOCKED",
  "RESPONSE_TOO_LARGE",
  "TIMEOUT",
  "TRANSPORT_ERROR",
  "WORK_LIMIT"
]);

export const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  "pairCreatedAt",
  "marketCapUsd",
  "tokenDecimals",
  "mintAuthorityRevoked",
  "freezeAuthorityRevoked",
  "lpProtection",
  "liquidityUsd",
  "volume1hUsd",
  "top10OwnerPct",
  "devAssociatedPct",
  "crediblePriorRug",
  "bundledLaunchPct",
  "priceChange1hPct",
  "tokenExtensions",
  "momentum15m",
  "uniqueBuyers1h",
  "buySellUsdRatio1h",
  "holderGrowthPct1h",
  "liquidityMarketCapPct",
  "qualifiedSmartWallets"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validAddress(value) {
  return typeof value === "string" && BASE58.test(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function requestFailure(status, reason) {
  const error = new Error(reason);
  error.status = status;
  return error;
}

function boundedLimits(input = {}) {
  if (!isRecord(input) || Reflect.ownKeys(input).some(key =>
    typeof key !== "string" || !Object.hasOwn(HARD_LIMITS, key))) {
    throw new TypeError("unknown discovery limit");
  }
  const limits = {...DEFAULT_LIMITS, ...input};
  for (const [name, maximum] of Object.entries(HARD_LIMITS)) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1 ||
        limits[name] > maximum) {
      throw new TypeError(`${name} is outside the bounded discovery limit`);
    }
  }
  if (limits.maxRequests < 1) throw new TypeError("maxRequests must include discovery");
  return limits;
}

function clockValue(clock) {
  const value = clock();
  if (!validTime(value)) throw requestFailure("INVALID_LOCAL_CLOCK", "injected clock returned an invalid time");
  return value;
}

function raceWithAbort(promise, signal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? requestFailure("CANCELLED", "collection was cancelled"));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? requestFailure("CANCELLED", "collection was cancelled"));
    };
    signal.addEventListener("abort", onAbort, {once: true});
    promise.then(
      value => { cleanup(); resolve(value); },
      error => { cleanup(); reject(error); }
    );
  });
}

function validateTarget(response, request) {
  if (response?.redirected === true) {
    throw requestFailure("REDIRECT_BLOCKED", "provider redirected the request");
  }
  if (response?.url !== undefined && typeof response.url !== "string") {
    throw requestFailure("INVALID_RESPONSE_URL", "provider response URL was invalid");
  }
  if (typeof response?.url === "string" && response.url !== "") {
    let returned;
    try { returned = new URL(response.url); } catch {
      throw requestFailure("INVALID_RESPONSE_URL", "provider response URL was invalid");
    }
    const requested = new URL(request.url);
    if (returned.origin !== requested.origin || returned.pathname !== requested.pathname ||
        returned.search !== requested.search || returned.hash !== "" ||
        returned.username !== "" || returned.password !== "") {
      throw requestFailure("INVALID_RESPONSE_URL", "provider response did not match the fixed endpoint");
    }
  }
}

async function readJson(response, {signal, limits, counters}) {
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw requestFailure("INVALID_CONTENT_TYPE", "provider response was not JSON");
  }
  const lengthHeader = response.headers?.get?.("content-length");
  if (lengthHeader !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(lengthHeader) ||
        !Number.isSafeInteger(Number(lengthHeader))) {
      throw requestFailure("INVALID_CONTENT_LENGTH", "provider content length was invalid");
    }
    if (Number(lengthHeader) > limits.maxBytesPerResponse ||
        Number(lengthHeader) > limits.maxBytesPerRun - counters.bytes) {
      throw requestFailure("RESPONSE_TOO_LARGE", "provider response exceeded a byte limit");
    }
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw requestFailure("MISSING_RESPONSE_STREAM", "provider response stream was unavailable");
  const chunks = [];
  const digest = createHash("sha256");
  let size = 0;
  try {
    while (true) {
      const {done, value} = await raceWithAbort(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw requestFailure("INVALID_RESPONSE_CHUNK", "provider response stream was malformed");
      }
      if (value.byteLength > limits.maxBytesPerResponse - size ||
          value.byteLength > limits.maxBytesPerRun - counters.bytes) {
        throw requestFailure("RESPONSE_TOO_LARGE", "provider response exceeded a byte limit");
      }
      size += value.byteLength;
      counters.bytes += value.byteLength;
      digest.update(value);
      chunks.push(value);
    }
  } catch (error) {
    try { reader.cancel?.().catch?.(() => {}); } catch { /* reader may already be closed */ }
    throw error;
  } finally {
    try { reader.releaseLock?.(); } catch { /* an aborted read may still be pending */ }
  }
  if (lengthHeader !== null && Number(lengthHeader) !== size) {
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
    return {
      payload: JSON.parse(text),
      bytes: size,
      responseSha256: digest.digest("hex")
    };
  } catch {
    throw requestFailure("INVALID_JSON", "provider response was not valid JSON");
  }
}

async function requestJson({
  path,
  kind,
  id,
  transport,
  signal,
  limits,
  counters,
  requestTimeoutMs
}) {
  const request = Object.freeze({
    id,
    kind,
    url: `${DEX_ORIGIN}${path}`,
    method: "GET",
    headers: Object.freeze({accept: "application/json"}),
    redirect: "error",
    credentials: "omit"
  });
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(
    signal.reason ?? requestFailure("CANCELLED", "collection was cancelled"));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, {once: true});
  const timer = setTimeout(() => controller.abort(
    requestFailure("TIMEOUT", "provider request exceeded its time limit")),
  requestTimeoutMs);
  let response = null;
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? requestFailure("CANCELLED", "collection was cancelled");
    }
    counters.requests += 1;
    response = await raceWithAbort(
      Promise.resolve().then(() => transport(request, {
        redirect: "error",
        credentials: "omit",
        signal: controller.signal
      })),
      controller.signal
    );
    validateTarget(response, request);
    const status = response?.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw requestFailure("INVALID_HTTP_STATUS", "provider returned an invalid HTTP status");
    }
    if (status < 200 || status >= 300) {
      throw requestFailure(`HTTP_${status}`, `provider returned HTTP ${status}`);
    }
    return await readJson(response, {signal: controller.signal, limits, counters});
  } catch (error) {
    try { response?.body?.cancel?.().catch?.(() => {}); } catch { /* body may already be locked or closed */ }
    const status = requestStatus(error, controller.signal);
    throw requestFailure(status, REQUEST_ERROR_CODES.has(status) || /^HTTP_[1-5]\d\d$/.test(status)
      ? error.message : "provider request failed");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function requestStatus(error, signal) {
  const status = typeof error?.status === "string" ? error.status
    : signal.aborted ? signal.reason?.status ?? "CANCELLED" : "TRANSPORT_ERROR";
  return REQUEST_ERROR_CODES.has(status) || /^HTTP_[1-5]\d\d$/.test(status)
    ? status : "TRANSPORT_ERROR";
}

function pairAge(pair) {
  return Number.isSafeInteger(pair?.pairCreatedAt) && pair.pairCreatedAt >= 0 &&
    Number.isFinite(new Date(pair.pairCreatedAt).getTime())
    ? pair.pairCreatedAt : null;
}

function unknownEvidence() {
  return Object.fromEntries(REQUIRED_EVIDENCE_FIELDS.map(field => [field, {
    status: "UNKNOWN",
    reason: "candidate discovery supplies identity hints only; required source evidence is not established"
  }]));
}

function addEvent(events, {
  kind,
  status,
  reason,
  requestedAt,
  receivedAt = null,
  requestId = null,
  endpointPath,
  bytes = 0,
  responseSha256 = null
}) {
  events.push({
    kind,
    source: kind === "profiles" ? PROFILE_SOURCE : PAIR_SOURCE,
    sourceVersion: "UNVERSIONED_PUBLIC_API",
    method: "GET",
    endpointPath,
    requestId,
    status,
    reason,
    requestedAt,
    receivedAt,
    bytes,
    responseSha256,
    timeBasis: "injected local receipt clock; trust and skew are not authenticated",
    slot: null
  });
}

function failureReason(status) {
  return status === "INVALID_SCHEMA" ? "provider response did not match the documented endpoint shape"
    : status === "IDENTITY_MISMATCH" ? "pair identity did not match a requested Solana token"
      : status === "RESPONSE_TOO_LARGE" ? "response exceeded a configured byte limit"
        : status === "HTTP_429" ? "provider rate-limited the bounded request; no retry was attempted"
          : status === "TIMEOUT" ? "provider request exceeded its configured deadline"
            : status === "CANCELLED" ? "collection was cancelled"
              : status === "INVALID_RESPONSE_URL" || status === "REDIRECT_BLOCKED"
                ? "redirects and non-allowlisted response URLs are rejected"
                : "provider response could not be safely acquired";
}

export async function collectCandidateDiscovery({
  enabled = false,
  transport,
  clock,
  signal,
  limits: inputLimits
} = {}) {
  if (enabled !== true) {
    return {
      status: "DISABLED",
      networkAccessed: false,
      counters: {requests: 0, bytes: 0},
      candidates: [],
      requiredEvidence: {},
      discovery: {exhaustive: false, reason: "collector is disabled by default"}
    };
  }
  if (typeof transport !== "function" || typeof clock !== "function") {
    throw new TypeError("enabled discovery requires injected transport and clock functions");
  }
  const limits = boundedLimits(inputLimits);
  const counters = {requests: 0, bytes: 0, pairRows: 0};
  const events = [];
  const candidates = new Map();
  const startedAt = clockValue(clock);
  const startedMonotonic = performance.now();
  const deadlineAt = startedAt + limits.maxDurationMs;
  let profilesTruncated = false;
  let pairsTruncated = false;
  let profileObservedAt = null;
  let completedPairBatches = 0;
  let requestedPairBatches = 0;
  let failureCount = 0;

  const runRequest = async (path, kind) => {
    let requestedAt = null;
    let requestId = null;
    const before = counters.bytes;
    try {
      if (signal?.aborted) throw requestFailure("CANCELLED", "collection was cancelled");
      requestedAt = clockValue(clock);
      if (requestedAt > deadlineAt || counters.requests >= limits.maxRequests) {
        throw requestFailure("WORK_LIMIT", "candidate discovery request or time budget was exhausted");
      }
      const remainingMs = limits.maxDurationMs - (performance.now() - startedMonotonic);
      if (remainingMs <= 0) {
        throw requestFailure("TIMEOUT", "candidate discovery exceeded its total time limit");
      }
      requestId = counters.requests + 1;
      const result = await requestJson({
        path, kind, id: requestId, transport, signal, limits, counters,
        requestTimeoutMs: Math.max(1, Math.min(limits.requestTimeoutMs, Math.ceil(remainingMs)))
      });
      const receivedAt = clockValue(clock);
      if (receivedAt > deadlineAt || performance.now() - startedMonotonic > limits.maxDurationMs) {
        throw requestFailure("TIMEOUT", "candidate discovery exceeded its total time limit");
      }
      addEvent(events, {kind, status: "OK", reason: null, requestedAt, receivedAt,
        requestId, endpointPath: path, bytes: counters.bytes - before,
        responseSha256: result.responseSha256});
      return {...result, receivedAt, requestId};
    } catch (error) {
      const receivedAt = (() => {
        try { return clockValue(clock); } catch { return null; }
      })();
      const status = requestStatus(error, signal ?? new AbortController().signal);
      addEvent(events, {kind, status, reason: failureReason(status), requestedAt, receivedAt,
        requestId, endpointPath: path, bytes: counters.bytes - before});
      failureCount += 1;
      return null;
    }
  };

  const profileResponse = await runRequest(PROFILES_PATH, "profiles");
  if (profileResponse) {
    profileObservedAt = profileResponse.receivedAt;
    if (!Array.isArray(profileResponse.payload)) {
      Object.assign(events.at(-1), {status: "INVALID_SCHEMA", reason: failureReason("INVALID_SCHEMA")});
      failureCount += 1;
    } else {
      const profiles = profileResponse.payload;
      profilesTruncated = profiles.length > limits.maxProfiles;
      const addresses = [];
      const seen = new Set();
      const boundedProfiles = profiles.slice(0, limits.maxProfiles);
      for (const profile of boundedProfiles) {
        if (profile?.chainId !== "solana" || !validAddress(profile.tokenAddress) ||
            seen.has(profile.tokenAddress)) continue;
        seen.add(profile.tokenAddress);
        if (addresses.length >= limits.maxCandidates) {
          profilesTruncated = true;
        } else {
          addresses.push(profile.tokenAddress);
        }
      }
      const maxBatches = Math.max(0, limits.maxRequests - counters.requests);
      const tokensPerBatch = 30;
      const addressLimit = maxBatches * tokensPerBatch;
      const selectedAddresses = addresses.slice(0, addressLimit);
      const requestedAddresses = new Set(selectedAddresses);
      if (selectedAddresses.length < addresses.length) profilesTruncated = true;
      const batches = [];
      for (let index = 0; index < selectedAddresses.length; index += tokensPerBatch) {
        batches.push(selectedAddresses.slice(index, index + tokensPerBatch));
      }
      requestedPairBatches = batches.length;
      batchLoop: for (const batch of batches) {
        if (signal?.aborted || counters.requests >= limits.maxRequests ||
            performance.now() - startedMonotonic > limits.maxDurationMs) {
          pairsTruncated = true;
          break;
        }
        const path = `${TOKENS_PATH}${batch.join(",")}`;
        const pairResponse = await runRequest(path, "pairs");
        if (!pairResponse) {
          if (signal?.aborted || counters.requests >= limits.maxRequests ||
              events.at(-1)?.status === "WORK_LIMIT") {
            pairsTruncated = true;
            break;
          }
          continue;
        }
        completedPairBatches += 1;
        if (!isRecord(pairResponse.payload) || !Array.isArray(pairResponse.payload.pairs)) {
          Object.assign(events.at(-1), {status: "INVALID_SCHEMA", reason: failureReason("INVALID_SCHEMA")});
          failureCount += 1;
          completedPairBatches -= 1;
          continue;
        }
        const rows = pairResponse.payload.pairs;
        const availableRows = Math.max(0, limits.maxPairRows - counters.pairRows);
        const boundedRows = rows.slice(0, availableRows);
        if (boundedRows.length < rows.length) pairsTruncated = true;
        counters.pairRows += boundedRows.length;
        for (const pair of boundedRows) {
          const mint = pair?.baseToken?.address;
          const pool = pair?.pairAddress;
          const quote = pair?.quoteToken?.address;
          if (pair?.chainId !== "solana" || !validAddress(mint) || !validAddress(pool) ||
              !validAddress(quote) || !requestedAddresses.has(mint)) continue;
          const key = `${mint}|${pool}|${quote}`;
          if (candidates.has(key)) continue;
          if (candidates.size >= limits.maxCandidates) {
            pairsTruncated = true;
            break batchLoop;
          }
          candidates.set(key, {
            chainId: "solana",
            mint,
            pool,
            quote,
            source: "DexScreener public API",
            sampledAt: pairResponse.receivedAt,
            pairCreatedAt: pairAge(pair),
            profileObservedAt,
            discovery: {
              profileEndpoint: PROFILES_PATH,
              pairEndpoint: TOKENS_PATH,
              profileRequestId: profileResponse.requestId,
              profileResponseSha256: profileResponse.responseSha256,
              pairRequestId: pairResponse.requestId,
              pairResponseSha256: pairResponse.responseSha256,
              sourceVersion: "UNVERSIONED_PUBLIC_API",
              identityStatus: "SOURCE_REPORTED_NOT_AUTHENTICATED",
              sourceEventTime: pairAge(pair),
              sourceEventTimeKind: "pairCreatedAt",
              receivedAt: pairResponse.receivedAt,
              timeTrust: "UNVERIFIED_INJECTED_LOCAL_CLOCK",
              slot: null,
              coverage: {
                kind: "candidate-discovery-hint",
                complete: false,
                exhaustive: false
              }
            },
            evidence: {},
            analystEvidence: {}
          });
        }
      }
      if (profilesTruncated || batches.length < Math.ceil(addresses.length / tokensPerBatch)) {
        pairsTruncated = true;
      }
    }
  }

  const candidateRows = [...candidates.values()].sort((left, right) =>
    left.mint.localeCompare(right.mint) || left.pool.localeCompare(right.pool) ||
    left.quote.localeCompare(right.quote));
  for (const candidate of candidateRows) candidate.requiredEvidence = unknownEvidence();
  const endedAt = (() => {
    try { return clockValue(clock); } catch { return null; }
  })();
  const cancelled = signal?.aborted === true;
  const truncated = profilesTruncated || pairsTruncated || cancelled;
  return {
    status: failureCount > 0 || cancelled ? "PARTIAL"
      : truncated ? "BOUNDED_PARTIAL" : "DISCOVERY_HINTS_ACQUIRED",
    networkAccessed: counters.requests > 0,
    sourceAuthentication: "NOT_ESTABLISHED",
    clockTrust: "INJECTED_LOCAL_CLOCK_UNVERIFIED",
    counters,
    events,
    candidates: candidateRows,
    requiredEvidence: Object.fromEntries(REQUIRED_EVIDENCE_FIELDS.map(field =>
      [field, {status: "UNKNOWN", reason:
        "candidate discovery does not acquire or verify this mandatory field"}])),
    discovery: {
      source: "DexScreener public API",
      profileEndpoint: PROFILES_PATH,
      pairEndpoint: `${TOKENS_PATH}{comma-separated-token-addresses}`,
      profileObservedAt,
      endedAt,
      profileRecordsTruncated: profilesTruncated,
      pairRecordsTruncated: pairsTruncated,
      requestedPairBatches,
      completedPairBatches,
      exhaustive: false,
      note: "Latest token profiles are discovery hints, not an exhaustive new-pair feed or evidence of quality."
    }
  };
}
