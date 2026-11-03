import {createHash} from "node:crypto";

export const HELIUS_ORIGIN = "https://mainnet.helius-rpc.com";
export const BIRDEYE_ORIGIN = "https://public-api.birdeye.so";
export const HELIUS_SOURCE = "Helius";
export const BIRDEYE_SOURCE = "Birdeye historical_price_unix";

export const DEFAULT_PROVIDER_LIMITS = Object.freeze({
  maxRequests: 20,
  maxBytesPerResponse: 1_048_576,
  maxBytesPerRun: 5_242_880,
  maxWorkUnits: 5_000,
  maxPages: 20,
  maxRows: 2_000,
  maxDurationMs: 15_000,
  requestTimeoutMs: 5_000
});

const HARD_LIMITS = Object.freeze({
  maxRequests: 100,
  maxBytesPerResponse: 2_097_152,
  maxBytesPerRun: 10_485_760,
  maxWorkUnits: 10_000,
  maxPages: 100,
  maxRows: 10_000,
  maxDurationMs: 60_000,
  requestTimeoutMs: 30_000
});
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HELIUS_METHODS = new Set([
  "getTransactionsForAddress",
  "getProgramAccountsV2"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function validSignal(signal) {
  return signal === undefined || (typeof signal?.aborted === "boolean" &&
    typeof signal?.addEventListener === "function" &&
    typeof signal?.removeEventListener === "function");
}

function redactSecret(value, secret, seen = new WeakMap()) {
  if (typeof value === "string") {
    return secret && value.includes(secret) ? "[REDACTED]" : value;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  for (const [key, child] of Object.entries(value)) {
    output[key] = redactSecret(child, secret, seen);
  }
  return output;
}

function plainDataRecord(value, allowedKeys) {
  if (!isRecord(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
       Object.getPrototypeOf(value) !== null)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" || !allowedKeys.has(key))) return null;
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    output[key] = descriptor.value;
  }
  return output;
}

function boundedFilters(filters) {
  try {
    if (!Array.isArray(filters) || filters.length > 10) return null;
    const descriptors = Object.getOwnPropertyDescriptors(filters);
    if (Reflect.ownKeys(descriptors).length !== filters.length + 1) return null;
    const result = [];
    for (let index = 0; index < filters.length; index += 1) {
      const filterDescriptor = descriptors[index];
      if (!filterDescriptor?.enumerable ||
          !Object.hasOwn(filterDescriptor, "value")) return null;
      const filter = filterDescriptor.value;
      const item = plainDataRecord(filter, new Set(["dataSize", "memcmp"]));
      if (!item || Object.keys(item).length !== 1) return null;
      if (Object.hasOwn(item, "dataSize")) {
        if (!Number.isSafeInteger(item.dataSize) || item.dataSize < 0 ||
            item.dataSize > 0xffff_ffff) return null;
        result.push({dataSize: item.dataSize});
        continue;
      }
      const memcmp = plainDataRecord(item.memcmp, new Set(["offset", "bytes"]));
      if (!memcmp || Object.keys(memcmp).length !== 2 ||
          !Number.isSafeInteger(memcmp.offset) || memcmp.offset < 0 ||
          memcmp.offset > 1_000_000 || typeof memcmp.bytes !== "string" ||
          memcmp.bytes.length < 1 || memcmp.bytes.length > 256) return null;
      result.push({memcmp: {offset: memcmp.offset, bytes: memcmp.bytes}});
    }
    return result;
  } catch {
    return null;
  }
}

function resolveLimits(input = {}) {
  if (!isRecord(input) || Reflect.ownKeys(input).some(key =>
    typeof key !== "string" || !Object.hasOwn(HARD_LIMITS, key))) {
    throw new TypeError("invalid provider acquisition limits");
  }
  const limits = {...DEFAULT_PROVIDER_LIMITS, ...input};
  for (const [key, maximum] of Object.entries(HARD_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 ||
        limits[key] > maximum) {
      throw new TypeError(`${key} is outside the fixed provider limit`);
    }
  }
  if (limits.maxBytesPerResponse > limits.maxBytesPerRun ||
      limits.requestTimeoutMs > limits.maxDurationMs) {
    throw new TypeError("provider response, run, and deadline limits are inconsistent");
  }
  return Object.freeze(limits);
}

function cancelledBody(target, reason) {
  try {
    const result = target?.cancel?.(reason);
    if (result && typeof result.then === "function") result.catch(() => {});
  } catch {}
}

function providerEnvelope(provider, method, scope, state, {
  status = "UNKNOWN",
  reason = null,
  data = null,
  coverage = {}
} = {}) {
  return redactSecret({
    status,
    reason,
    provider: {name: provider, method},
    queryScope: scope,
    qualification: {
      providerIdentity: provider,
      documentedScope: method,
      observedCompleteness: "UNKNOWN",
      exactTimestampFidelity: method === "historical_price_unix"
        ? "UNKNOWN" : "NOT_APPLICABLE",
      policyApproval: "NOT_APPROVED"
    },
    data,
    receipts: state.receipts,
    counters: {
      requests: state.requests,
      bytes: state.bytes,
      workUnits: state.workUnits
    },
    coverage: {
      observedCompleteness: "UNKNOWN",
      policyApproval: "NOT_APPROVED",
      ...coverage
    }
  }, state.secret);
}

function responseUrlAllowed(response, request, provider, secret) {
  if (response?.redirected === true) return false;
  if (typeof response?.url !== "string" || response.url === "") return true;
  try {
    const actual = new URL(response.url);
    const expected = new URL(request.url);
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname ||
        actual.hash !== "" || actual.username !== "" || actual.password !== "") return false;
    if (provider === HELIUS_SOURCE) {
      if (actual.search === "") return true;
      const entries = [...actual.searchParams.entries()];
      return entries.length === 1 && entries[0][0] === "api-key" &&
        entries[0][1] === secret;
    }
    return actual.search === expected.search;
  } catch {
    return false;
  }
}

async function readJson(response, state, limits, signal) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw new Error("INVALID_RESPONSE_BODY");
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined &&
      (!/^(?:0|[1-9]\d*)$/.test(declaredLength) ||
       Number(declaredLength) > limits.maxBytesPerResponse)) {
    throw new Error("RESPONSE_BYTE_LIMIT");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let sealed = false;
  const seal = () => {
    sealed = true;
    cancelledBody(reader, signal?.reason);
  };
  signal?.addEventListener("abort", seal, {once: true});
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (sealed || signal?.aborted) throw new Error("CANCELLED");
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("INVALID_RESPONSE_BODY");
      bytes += value.byteLength;
      state.bytes += value.byteLength;
      if (bytes > limits.maxBytesPerResponse || state.bytes > limits.maxBytesPerRun) {
        throw new Error("RESPONSE_BYTE_LIMIT");
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelledBody(reader, error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", seal);
    try { reader.releaseLock(); } catch {}
  }
  const raw = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(raw));
  } catch {
    throw new Error("INVALID_JSON");
  }
  return {
    parsed,
    bytes,
    sha256: createHash("sha256").update(raw).digest("hex")
  };
}

function makeRequest(provider, method, params, id) {
  if (provider === HELIUS_SOURCE) {
    if (!HELIUS_METHODS.has(method)) throw new Error("METHOD_NOT_ALLOWED");
    return Object.freeze({
      url: `${HELIUS_ORIGIN}/`,
      method: "POST",
      headers: Object.freeze({
        accept: "application/json",
        "content-type": "application/json"
      }),
      redirect: "error",
      credentials: "omit",
      body: JSON.stringify({jsonrpc: "2.0", id, method, params})
    });
  }
  if (method !== "historical_price_unix") throw new Error("METHOD_NOT_ALLOWED");
  const url = new URL("/defi/historical_price_unix", BIRDEYE_ORIGIN);
  url.searchParams.set("address", params.mint);
  url.searchParams.set("unixtime", String(params.unixTime));
  return Object.freeze({
    url: url.href,
    method: "GET",
    headers: Object.freeze({accept: "application/json"}),
    redirect: "error",
    credentials: "omit",
    body: undefined
  });
}

function createState(clock, limits, transport, secret, signal) {
  let startedAt;
  try { startedAt = clock(); } catch { startedAt = null; }
  return {
    clock,
    limits,
    transport,
    secret,
    signal,
    startedAt,
    startedMonotonic: performance.now(),
    requests: 0,
    bytes: 0,
    workUnits: 0,
    nextId: 0,
    receipts: []
  };
}

function acquisitionFailure(state) {
  if (state.signal?.aborted) return "CANCELLED";
  if (!validTime(state.startedAt)) return "INVALID_CLOCK";
  if (performance.now() - state.startedMonotonic >= state.limits.maxDurationMs) {
    return "DEADLINE_EXCEEDED";
  }
  if (state.requests >= state.limits.maxRequests) return "REQUEST_QUOTA_EXHAUSTED";
  if (state.workUnits >= state.limits.maxWorkUnits) return "WORK_QUOTA_EXHAUSTED";
  return null;
}

function chargeWork(state, count = 1) {
  if (!Number.isSafeInteger(count) || count < 0 ||
      state.workUnits + count > state.limits.maxWorkUnits) return false;
  state.workUnits += count;
  return true;
}

async function requestJson(state, provider, method, params, signal = state.signal) {
  const failure = acquisitionFailure(state);
  if (failure) return {ok: false, reason: failure};
  if (typeof state.transport !== "function" || !state.secret) {
    return {ok: false, reason: "SOURCE_CONFIGURATION_UNAVAILABLE"};
  }
  const requestId = ++state.nextId;
  const request = makeRequest(provider, method, params, requestId);
  state.requests += 1;
  state.workUnits += 1;
  let startedAt;
  try { startedAt = state.clock(); } catch { return {ok: false, reason: "INVALID_CLOCK"}; }
  if (!validTime(startedAt) || startedAt < state.startedAt) {
    return {ok: false, reason: "INVALID_CLOCK"};
  }
  const controller = new AbortController();
  let timer;
  let abortHandler;
  let response;
  const remaining = state.limits.maxDurationMs -
    (performance.now() - state.startedMonotonic);
  const timeoutMs = Math.min(state.limits.requestTimeoutMs, remaining);
  if (timeoutMs <= 0) return {ok: false, reason: "DEADLINE_EXCEEDED"};
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
    if (!signal) return;
    abortHandler = () => {
      controller.abort();
      reject(new Error("CANCELLED"));
    };
    signal.addEventListener("abort", abortHandler, {once: true});
    if (signal.aborted) abortHandler();
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(remaining <= state.limits.requestTimeoutMs
        ? "DEADLINE_EXCEEDED" : "REQUEST_TIMEOUT"));
    }, timeoutMs);
  });
  const transportPromise = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new Error("CANCELLED");
    return state.transport(request, {signal: controller.signal, secret: state.secret});
  });
  transportPromise.then(late => {
    if (controller.signal.aborted) cancelledBody(late?.body, "request closed");
  }, () => {});
  try {
    response = await Promise.race([transportPromise, timeout, aborted]);
    if (!responseUrlAllowed(response, request, provider, state.secret)) {
      cancelledBody(response?.body, "invalid response target");
      return {ok: false, reason: "REDIRECT_OR_PATH_REJECTED"};
    }
    if (response.status !== 200) {
      cancelledBody(response?.body, "invalid response status");
      return {ok: false, reason: "HTTP_STATUS_UNAVAILABLE"};
    }
    const decoded = await Promise.race([
      readJson(response, state, state.limits, controller.signal),
      timeout,
      aborted
    ]);
    const receivedAt = state.clock();
    if (!validTime(receivedAt) || receivedAt < startedAt ||
        performance.now() - state.startedMonotonic > state.limits.maxDurationMs) {
      return {ok: false, reason: "DEADLINE_EXCEEDED"};
    }
    const receipt = {
      provider,
      method,
      requestId,
      requestScope: params,
      requestStartedAt: startedAt,
      responseReceivedAt: receivedAt,
      responseBytes: decoded.bytes,
      responseSha256: decoded.sha256
    };
    state.receipts.push(receipt);
    let result;
    if (provider === HELIUS_SOURCE) {
      if (!isRecord(decoded.parsed) || decoded.parsed.jsonrpc !== "2.0" ||
          decoded.parsed.id !== requestId) {
        return {ok: false, reason: "INVALID_RPC_ENVELOPE"};
      }
      if (Object.hasOwn(decoded.parsed, "error")) {
        const message = String(decoded.parsed.error?.message ?? "");
        return {
          ok: false,
          reason: /unsupported transaction version|transaction version.*not supported/i.test(message)
            ? "UNSUPPORTED_TRANSACTION_VERSION" : "PROVIDER_ERROR"
        };
      }
      if (!Object.hasOwn(decoded.parsed, "result")) {
        return {ok: false, reason: "MISSING_RESULT"};
      }
      result = decoded.parsed.result;
    } else {
      result = decoded.parsed;
    }
    return {ok: true, result, receipt};
  } catch (error) {
    controller.abort();
    cancelledBody(response?.body, "request closed");
    const safeReasons = new Set([
      "CANCELLED", "DEADLINE_EXCEEDED", "REQUEST_TIMEOUT",
      "RESPONSE_BYTE_LIMIT", "INVALID_RESPONSE_BODY", "INVALID_JSON"
    ]);
    const reason = safeReasons.has(error?.message) ? error.message : "TRANSPORT_UNAVAILABLE";
    return {ok: false, reason};
  } finally {
    clearTimeout(timer);
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    if (signal?.aborted && !controller.signal.aborted) {
      controller.abort();
      rejectAbort?.(new Error("CANCELLED"));
    }
  }
}

function createSourceConfig({enabled, secret, transport, clock, limits, source}) {
  const configuredLimits = resolveLimits(limits);
  if (typeof enabled !== "boolean") {
    throw new TypeError(`${source} enabled flag must be boolean`);
  }
  if (enabled && (typeof secret !== "string" || secret.length === 0 ||
      typeof transport !== "function" || typeof clock !== "function")) {
    throw new TypeError(`${source} requires an injected secret, transport, and clock`);
  }
  return {enabled: enabled === true, secret, transport, clock, limits: configuredLimits};
}

function address(value) {
  return typeof value === "string" && BASE58.test(value);
}

function safeScope(input) {
  return JSON.parse(JSON.stringify(input));
}

function failureEnvelope(provider, method, scope, state, reason, data = null) {
  return providerEnvelope(provider, method, scope, state, {
    status: "UNAVAILABLE",
    reason,
    data,
    coverage: {observedCompleteness: "UNKNOWN", policyApproval: "NOT_APPROVED"}
  });
}

function exactKeys(value, allowed) {
  try {
    return isRecord(value) && Reflect.ownKeys(value).every(key =>
      typeof key === "string" && allowed.has(key));
  } catch {
    return false;
  }
}

export function createHeliusSource({
  enabled = false,
  secret,
  transport,
  clock,
  limits = {}
} = {}) {
  const config = createSourceConfig({
    enabled, secret, transport, clock, limits, source: HELIUS_SOURCE
  });
  return Object.freeze({
    async getTransactionsForAddress({
      address: queriedAddress,
      limit = 100,
      startSlot = null,
      endSlot = null,
      startBlockTime = null,
      endBlockTime = null,
      signal
    } = {}) {
      const scope = {
        address: address(queriedAddress) ? queriedAddress : null,
        commitment: "finalized",
        limit,
        startSlot,
        endSlot,
        startBlockTime,
        endBlockTime
      };
      if (!config.enabled) {
        return failureEnvelope(HELIUS_SOURCE, "getTransactionsForAddress", scope,
          {requests: 0, bytes: 0, workUnits: 0, receipts: []}, "DISABLED");
      }
      const state = createState(config.clock, config.limits,
        config.transport, config.secret, signal);
      if (!address(queriedAddress) || !Number.isSafeInteger(limit) || limit < 1 ||
          !validSignal(signal) ||
          limit > 1_000 || [startSlot, endSlot].some(value =>
            value !== null && (!Number.isSafeInteger(value) || value < 0)) ||
          (startSlot !== null && endSlot !== null && endSlot < startSlot) ||
          [startBlockTime, endBlockTime].some(value =>
            value !== null && (!Number.isSafeInteger(value) || value < 0)) ||
          (startBlockTime !== null && endBlockTime !== null &&
            endBlockTime < startBlockTime)) {
        return failureEnvelope(HELIUS_SOURCE, "getTransactionsForAddress", scope,
          state, "INVALID_QUERY_SCOPE");
      }
      const transactions = [];
      const seen = new Map();
      const seenCursors = new Set();
      let before;
      let cursorParameter = "before";
      let reason = null;
      for (let page = 0; page < config.limits.maxPages; page += 1) {
        const params = [queriedAddress, {
          commitment: "finalized",
          limit,
          ...(before ? {[cursorParameter]: before} : {})
        }];
        const outcome = await requestJson(state, HELIUS_SOURCE,
          "getTransactionsForAddress", params, signal);
        if (!outcome.ok) {
          reason = outcome.reason;
          break;
        }
        const pageRows = Array.isArray(outcome.result) ? outcome.result
          : Array.isArray(outcome.result?.data) ? outcome.result.data
            : Array.isArray(outcome.result?.transactions) ? outcome.result.transactions
              : null;
        if (!pageRows) {
          reason = "INVALID_TRANSACTION_PAGE";
          break;
        }
        const explicitCursor = isRecord(outcome.result) &&
          (Object.hasOwn(outcome.result, "paginationToken") ||
           Object.hasOwn(outcome.result, "nextCursor"));
        const nextCursor = explicitCursor
          ? (outcome.result.paginationToken ?? outcome.result.nextCursor)
          : null;
        const nextCursorParameter = isRecord(outcome.result) &&
          Object.hasOwn(outcome.result, "paginationToken")
          ? "paginationToken" : "before";
        let lastSignature = null;
        for (const row of pageRows) {
          if (!isRecord(row) || typeof row.signature !== "string" ||
              !row.signature || row.signature.length > 128 ||
              !Number.isSafeInteger(row.slot) || row.slot < 0) {
            reason = "INVALID_TRANSACTION_ROW";
            break;
          }
          if (!Object.hasOwn(row, "blockTime") ||
              (row.blockTime !== null && (!Number.isSafeInteger(row.blockTime) ||
                row.blockTime < 0))) {
            reason = "INVALID_BLOCK_TIME";
            break;
          }
          if (!isRecord(row.meta)) {
            reason = "NULL_TRANSACTION_METADATA";
            break;
          }
          if (!(row.version === "legacy" || row.version === 0)) {
            reason = "UNSUPPORTED_TRANSACTION_VERSION";
            break;
          }
          if (!chargeWork(state)) {
            reason = "WORK_QUOTA_EXHAUSTED";
            break;
          }
          const serialized = JSON.stringify(row);
          const prior = seen.get(row.signature);
          if (prior !== undefined) {
            if (prior !== serialized) reason = "CONTRADICTORY_DUPLICATE_TRANSACTION";
            else reason = "DUPLICATE_TRANSACTION";
            break;
          }
          seen.set(row.signature, serialized);
          transactions.push({
            ...row,
            providerIdentity: HELIUS_SOURCE,
            originalSlot: row.slot,
            originalBlockTime: row.blockTime,
            queryScope: safeScope(scope),
            receiptSha256: outcome.receipt.responseSha256
          });
          lastSignature = row.signature;
          if (transactions.length > config.limits.maxRows) {
            reason = "ROW_QUOTA_EXHAUSTED";
            break;
          }
        }
        if (reason) break;
        if (explicitCursor && nextCursor === null) {
          reason = "PROVIDER_PAGE_EXHAUSTED";
          break;
        }
        if (!explicitCursor && (pageRows.length === 0 || pageRows.length < limit)) {
          reason = "PROVIDER_PAGE_EXHAUSTED";
          break;
        }
        const next = explicitCursor ? nextCursor : lastSignature;
        if (typeof next !== "string" || !next ||
            seenCursors.has(next) || next === before) {
          reason = "REPEATED_CURSOR";
          break;
        }
        seenCursors.add(next);
        before = next;
        cursorParameter = explicitCursor ? nextCursorParameter : "before";
      }
      if (!reason) reason = "PAGE_QUOTA_EXHAUSTED";
      const data = {
        transactions,
        cursorTermination: reason === "PROVIDER_PAGE_EXHAUSTED" ? "SHORT_OR_EMPTY_PAGE" : null
      };
      if (reason !== "PROVIDER_PAGE_EXHAUSTED") {
        return failureEnvelope(HELIUS_SOURCE, "getTransactionsForAddress",
          safeScope(scope), state, reason, data);
      }
      return providerEnvelope(HELIUS_SOURCE, "getTransactionsForAddress",
        safeScope(scope), state, {
          status: "CAPTURED",
          reason: null,
          data,
          coverage: {
            cursorExhausted: true,
            observedCompleteness: "UNKNOWN",
            policyApproval: "NOT_APPROVED",
            finalizedIsNotCompletenessProof: true
          }
        });
    },

    async getProgramAccountsV2({
      programId,
      filters = [],
      pageSize = 100,
      minContextSlot = null,
      signal
    } = {}) {
      const safeFilters = boundedFilters(filters);
      const scope = {
        programId: address(programId) ? programId : null,
        filters: safeFilters,
        pageSize,
        minContextSlot
      };
      if (!config.enabled) {
        return failureEnvelope(HELIUS_SOURCE, "getProgramAccountsV2",
          scope, {requests: 0, bytes: 0, workUnits: 0, receipts: []}, "DISABLED");
      }
      const state = createState(config.clock, config.limits,
        config.transport, config.secret, signal);
      if (!address(programId) || !safeFilters || !Number.isSafeInteger(pageSize) ||
          !validSignal(signal) ||
          pageSize < 1 || pageSize > 1_000 ||
          (minContextSlot !== null &&
            (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0))) {
        return failureEnvelope(HELIUS_SOURCE, "getProgramAccountsV2",
          safeScope(scope), state, "INVALID_QUERY_SCOPE");
      }
      const pages = [];
      const accounts = new Map();
      const contextSlots = [];
      const owners = new Map();
      let rawAmountTotal = 0n;
      let allDecoded = true;
      let paginationKey = null;
      let reason = null;
      let terminated = false;
      const seenKeys = new Set();
      for (let page = 0; page < config.limits.maxPages; page += 1) {
        const params = [programId, {
          filters: safeFilters,
          limit: pageSize,
          minContextSlot: minContextSlot ?? undefined,
          paginationKey
        }];
        const outcome = await requestJson(state, HELIUS_SOURCE,
          "getProgramAccountsV2", params, signal);
        if (!outcome.ok) {
          reason = outcome.reason;
          break;
        }
        const result = outcome.result;
        if (!isRecord(result) || !Array.isArray(result.accounts) ||
            !isRecord(result.context) || !Number.isSafeInteger(result.context.slot) ||
            result.context.slot < 0 || !Object.hasOwn(result, "paginationKey") ||
            (result.paginationKey !== null &&
              (typeof result.paginationKey !== "string" || !result.paginationKey))) {
          reason = "INVALID_ACCOUNT_PAGE";
          break;
        }
        const pageContextSlot = result.context.slot;
        if (minContextSlot !== null && pageContextSlot < minContextSlot) {
          reason = "MIN_CONTEXT_SLOT_NOT_MET";
          break;
        }
        contextSlots.push(pageContextSlot);
        pages.push({
          context: {slot: pageContextSlot},
          requestedPaginationKey: paginationKey,
          paginationKey: result.paginationKey,
          responseSha256: outcome.receipt.responseSha256,
          accountCount: result.accounts.length
        });
        for (const row of result.accounts) {
          if (!isRecord(row) ||
              (typeof row.address !== "string" && typeof row.pubkey !== "string")) {
            reason = "INVALID_ACCOUNT_ROW";
            break;
          }
          const accountAddress = row.address ?? row.pubkey;
          if (!address(accountAddress)) {
            reason = "INVALID_ACCOUNT_ROW";
            break;
          }
          const serialized = JSON.stringify(row);
          const prior = accounts.get(accountAddress);
          if (prior !== undefined) {
            if (prior !== serialized) reason = "CONTRADICTORY_DUPLICATE_ACCOUNT";
            else reason = "DUPLICATE_ACCOUNT";
            break;
          }
          if (!chargeWork(state)) {
            reason = "WORK_QUOTA_EXHAUSTED";
            break;
          }
          accounts.set(accountAddress, serialized);
          if (accounts.size > config.limits.maxRows) {
            reason = "ROW_QUOTA_EXHAUSTED";
            break;
          }
          const decodedOwner = row.decoded?.owner ??
            row.account?.data?.parsed?.info?.owner ?? null;
          const rawAmount = row.decoded?.amount ??
            row.account?.data?.parsed?.info?.tokenAmount?.amount ?? null;
          if (typeof decodedOwner !== "string" || !BASE58.test(decodedOwner) ||
              typeof rawAmount !== "string" || !/^(?:0|[1-9]\d{0,79})$/.test(rawAmount)) {
            allDecoded = false;
            continue;
          }
          const amount = BigInt(rawAmount);
          rawAmountTotal += amount;
          const aggregate = owners.get(decodedOwner) ?? {owner: decodedOwner, accountCount: 0, rawAmount: 0n};
          aggregate.accountCount += 1;
          aggregate.rawAmount += amount;
          owners.set(decodedOwner, aggregate);
        }
        if (reason) break;
        if (result.paginationKey === null) {
          terminated = true;
          break;
        }
        if (seenKeys.has(result.paginationKey) || result.paginationKey === paginationKey) {
          reason = "REPEATED_CURSOR";
          break;
        }
        seenKeys.add(result.paginationKey);
        paginationKey = result.paginationKey;
      }
      if (!reason && !terminated) reason = "PAGE_QUOTA_EXHAUSTED";
      const ownerRows = [...owners.values()].map(item => ({
        owner: item.owner,
        accountCount: item.accountCount,
        rawAmount: item.rawAmount.toString()
      })).sort((left, right) => left.owner.localeCompare(right.owner));
      const ownerTotal = ownerRows.reduce((total, item) => total + BigInt(item.rawAmount), 0n);
      const data = {
        pages,
        accounts: accounts.size,
        owners: ownerRows,
        reconciliation: {
          decodedAccounts: allDecoded ? accounts.size : null,
          rawAmountTotal: allDecoded ? rawAmountTotal.toString() : null,
          ownerRawAmountTotal: allDecoded ? ownerTotal.toString() : null,
          matches: allDecoded ? rawAmountTotal === ownerTotal : null
        },
        contextSlots,
        contextSlotDrift: new Set(contextSlots).size > 1,
        minContextSlotIsLowerBound: true,
        paginationTerminatedByNull: terminated
      };
      if (reason) {
        return failureEnvelope(HELIUS_SOURCE, "getProgramAccountsV2",
          safeScope(scope), state, reason, data);
      }
      if (new Set(contextSlots).size > 1) {
        return failureEnvelope(HELIUS_SOURCE, "getProgramAccountsV2",
          safeScope(scope), state, "CONTEXT_SLOT_DRIFT", data);
      }
      return providerEnvelope(HELIUS_SOURCE, "getProgramAccountsV2",
        safeScope(scope), state, {
          status: "CAPTURED",
          data,
          coverage: {
            paginationTerminatedByNull: true,
            observedCompleteness: "UNKNOWN",
            policyApproval: "NOT_APPROVED",
            frozenSnapshot: false
          }
        });
    }
  });
}

export function createBirdeyeSource({
  enabled = false,
  secret,
  transport,
  clock,
  limits = {}
} = {}) {
  const config = createSourceConfig({
    enabled, secret, transport, clock, limits, source: BIRDEYE_SOURCE
  });
  return Object.freeze({
    async readObservation(input = {}) {
      const allowed = new Set(["mint", "atMs", "denomination", "purpose", "signal"]);
      const scope = {
        mint: address(input?.mint) ? input.mint : null,
        atMs: Number.isSafeInteger(input?.atMs) ? input.atMs : null,
        denomination: input?.denomination ?? null,
        purpose: typeof input?.purpose === "string" ? input.purpose : null
      };
      if (!config.enabled) {
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          scope, {requests: 0, bytes: 0, workUnits: 0, receipts: []}, "DISABLED");
      }
      const state = createState(config.clock, config.limits,
        config.transport, config.secret, input?.signal);
      if (!exactKeys(input, allowed)) {
        const scaling = ["tokenScale", "decimals", "amount", "scale"];
        let hasScale = false;
        try {
          hasScale = Reflect.ownKeys(input ?? {}).some(key => scaling.includes(key));
        } catch {}
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          scope, state, hasScale ? "UNSUPPORTED_TOKEN_SCALING" : "INVALID_OBSERVATION_REQUEST");
      }
      let now;
      try { now = config.clock(); } catch { now = null; }
      if (!address(input.mint) || !Number.isSafeInteger(input.atMs) ||
          input.atMs < 0 || input.atMs % 1_000 !== 0 ||
          input.denomination !== "USD" ||
          typeof input.purpose !== "string" || !input.purpose.trim() ||
          input.purpose.length > 128 ||
          (input.signal !== undefined &&
            !validSignal(input.signal)) ||
          !validTime(now) || input.atMs > now) {
        const reason = input.atMs % 1_000 !== 0
          ? "REQUEST_TIME_NOT_SECOND_ALIGNED"
          : input.atMs > now ? "FUTURE_REQUEST_TIME" : "INVALID_OBSERVATION_REQUEST";
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          safeScope(scope), state, reason);
      }
      const outcome = await requestJson(state, BIRDEYE_SOURCE,
        "historical_price_unix", {
          mint: input.mint,
          unixTime: input.atMs / 1_000
        }, input.signal);
      if (!outcome.ok) {
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          safeScope(scope), state, outcome.reason);
      }
      const data = outcome.result?.data;
      if (!isRecord(data)) {
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          safeScope(scope), state, "MISSING_OBSERVATION_TIME");
      }
      const preservedData = {
        updateUnixTime: data.updateUnixTime ?? null,
        value: data.value ?? null
      };
      if (typeof data.updateUnixTime !== "number" ||
          !Number.isSafeInteger(data.updateUnixTime)) {
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          safeScope(scope), state, "MISSING_OBSERVATION_TIME", preservedData);
      }
      const sourceAtMs = data.updateUnixTime * 1_000;
      if (!Number.isSafeInteger(sourceAtMs) || sourceAtMs !== input.atMs) {
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          safeScope(scope), state,
          sourceAtMs > now ? "FUTURE_OBSERVATION_TIME" : "NONEXACT_OBSERVATION_TIME",
          {...preservedData, sourceAtMs});
      }
      if (typeof data.value !== "number" || !Number.isFinite(data.value) ||
          data.value <= 0) {
        return failureEnvelope(BIRDEYE_SOURCE, "historical_price_unix",
          safeScope(scope), state, "INVALID_PRICE_VALUE", {...preservedData, sourceAtMs});
      }
      const receipt = outcome.receipt;
      return redactSecret({
        status: "SOURCE_BOUND",
        source: BIRDEYE_SOURCE,
        provider: {name: BIRDEYE_SOURCE, method: "historical_price_unix"},
        queryScope: safeScope(scope),
        mint: input.mint,
        denomination: "USD",
        purpose: input.purpose,
        value: data.value,
        data: preservedData,
        sourceAtMs,
        observedAt: sourceAtMs,
        receivedAt: receipt.responseReceivedAt,
        receipt: {
          status: "SOURCE_BOUND",
          id: `${BIRDEYE_SOURCE}:${input.mint}:${sourceAtMs}:${receipt.responseSha256}`,
          source: BIRDEYE_SOURCE,
          payloadSha256: receipt.responseSha256,
          receivedAt: receipt.responseReceivedAt
        },
        receipts: state.receipts,
        counters: {
          requests: state.requests,
          bytes: state.bytes,
          workUnits: state.workUnits
        },
        coverage: {
          observedCompleteness: "UNKNOWN",
          exactTimestampFidelity: "EXACT",
          policyApproval: "NOT_APPROVED"
        },
        qualification: {
          providerIdentity: BIRDEYE_SOURCE,
          documentedScope: "historical_price_unix",
          observedCompleteness: "UNKNOWN",
          exactTimestampFidelity: "EXACT",
          policyApproval: "NOT_APPROVED",
          scaling: "PROVIDER_PRICE_PER_TOKEN_UNSCALED"
        }
      }, config.secret);
    }
  });
}
