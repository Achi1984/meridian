export const LAUNCH_HISTORY_SOURCE_VERSION = "solana-launch-history-source-v1";
export const SOLANA_RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
export const DEFAULT_LAUNCH_HISTORY_LIMITS = Object.freeze({
  maxSubjects: 10,
  pageSize: 100,
  maxPagesPerSubject: 20,
  maxSignatures: 2_000,
  maxTransactions: 1_000,
  maxRequests: 2_100,
  maxBytesPerResponse: 1_048_576,
  maxBytesPerRun: 10_485_760,
  maxWorkUnits: 5_000,
  maxDurationMs: 30_000,
  requestTimeoutMs: 5_000
});

const HARD_LIMITS = Object.freeze({
  maxSubjects: 100,
  pageSize: 1_000,
  maxPagesPerSubject: 100,
  maxSignatures: 20_000,
  maxTransactions: 10_000,
  maxRequests: 30_000,
  maxBytesPerResponse: 2_097_152,
  maxBytesPerRun: 52_428_800,
  maxWorkUnits: 30_000,
  maxDurationMs: 60_000,
  requestTimeoutMs: 30_000
});
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ALLOWED_OPTIONS = new Set([
  "subjects", "startSlot", "endSlot", "transport", "clock", "signal", "limits"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedText(value, maxLength = 256) {
  return String(value ?? "unknown").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

function validateOptions(options) {
  if (!isRecord(options) || Reflect.ownKeys(options).some(key =>
    typeof key !== "string" || !ALLOWED_OPTIONS.has(key))) {
    throw new TypeError("unknown launch history option");
  }
  if (!Array.isArray(options.subjects) || options.subjects.length < 1) {
    throw new TypeError("an explicit nonempty subject set is required");
  }
  if (options.subjects.length > HARD_LIMITS.maxSubjects) {
    throw new TypeError("subject set exceeds the hard limit");
  }
  const addresses = new Set();
  const subjects = options.subjects.map((subject, index) => {
    if (!isRecord(subject) || typeof subject.address !== "string" ||
        !BASE58.test(subject.address) || addresses.has(subject.address) ||
        typeof subject.source !== "string" || !subject.source.trim() ||
        subject.source.length > 128 ||
        typeof subject.evidenceId !== "string" || !subject.evidenceId.trim() ||
        subject.evidenceId.length > 128) {
      throw new TypeError(`subject ${index} must have a unique address and source evidence reference`);
    }
    addresses.add(subject.address);
    return Object.freeze({
      address: subject.address,
      source: subject.source,
      evidenceId: subject.evidenceId
    });
  });
  if (!Number.isSafeInteger(options.startSlot) || options.startSlot < 0 ||
      !Number.isSafeInteger(options.endSlot) || options.endSlot < options.startSlot) {
    throw new TypeError("an explicit nonnegative inclusive slot interval is required");
  }
  if (typeof options.transport !== "function" || typeof options.clock !== "function") {
    throw new TypeError("injected transport and clock are required");
  }
  if (options.signal !== undefined &&
      (typeof options.signal?.aborted !== "boolean" ||
       typeof options.signal?.addEventListener !== "function")) {
    throw new TypeError("signal must be an AbortSignal");
  }
  const supplied = options.limits ?? {};
  if (!isRecord(supplied) || Reflect.ownKeys(supplied).some(key =>
    typeof key !== "string" || !Object.hasOwn(HARD_LIMITS, key))) {
    throw new TypeError("launch history limits contain an unsupported field");
  }
  const limits = {};
  for (const [name, defaultValue] of Object.entries(DEFAULT_LAUNCH_HISTORY_LIMITS)) {
    const value = supplied[name] ?? defaultValue;
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_LIMITS[name]) {
      throw new TypeError(`${name} is outside the fixed hard limit`);
    }
    limits[name] = value;
  }
  if (limits.maxBytesPerResponse > limits.maxBytesPerRun ||
      limits.maxRequests < 1) {
    throw new TypeError("launch history response/run limits are inconsistent");
  }
  return {subjects, startSlot: options.startSlot, endSlot: options.endSlot, limits};
}

function parseErrorMessage(error) {
  return boundedText(error?.message ?? error?.data?.message ?? error?.code ?? "RPC error");
}

function transactionVersion(result) {
  const version = result?.version;
  if (version === "legacy" || version === 0) return {supported: true, value: version};
  return {supported: false, value: version ?? null};
}

async function readJsonBounded(response, state, limits) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw failure("MISSING_RESPONSE_STREAM", "RPC response has no readable body");
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^(?:0|[1-9]\d*)$/.test(declaredLength) ||
        Number(declaredLength) > limits.maxBytesPerResponse) {
      throw failure("RESPONSE_TOO_LARGE", "RPC response exceeds the per-response byte limit");
    }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let responseBytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw failure("INVALID_RESPONSE_CHUNK", "RPC response contains an invalid byte chunk");
      }
      responseBytes += value.byteLength;
      if (responseBytes > limits.maxBytesPerResponse ||
          state.bytes + responseBytes > limits.maxBytesPerRun) {
        throw failure("RESPONSE_TOO_LARGE", "RPC response exceeds a byte limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(error); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
  state.bytes += responseBytes;
  const bytes = new Uint8Array(responseBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch {
    throw failure("INVALID_UTF8", "RPC response is not valid UTF-8");
  }
  try {
    return {payload: JSON.parse(text), bytes: responseBytes};
  } catch {
    throw failure("INVALID_JSON", "RPC response is not valid JSON");
  }
}

function responseTargetIsAllowed(response, request) {
  if (response?.redirected === true) return false;
  if (typeof response?.url !== "string" || response.url === "") return true;
  try {
    const actual = new URL(response.url);
    const expected = new URL(request.url);
    return actual.origin === expected.origin && actual.pathname === expected.pathname &&
      actual.search === "" && actual.hash === "" && actual.username === "" &&
      actual.password === "";
  } catch {
    return false;
  }
}

function makeRequest(id, method, params) {
  return Object.freeze({
    url: SOLANA_RPC_ORIGIN,
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

function checkTime(state, limits) {
  let now;
  try { now = state.clock(); } catch { return "INVALID_CLOCK"; }
  if (!Number.isSafeInteger(now) || now < 0) return "INVALID_CLOCK";
  if (now < state.startedAt) return "INVALID_CLOCK";
  if (performance.now() - state.startedMonotonic > limits.maxDurationMs) return "TIME_LIMIT";
  return null;
}

async function requestRpc(state, limits, method, params) {
  const timeFailure = checkTime(state, limits);
  if (timeFailure) return {ok: false, status: timeFailure};
  if (state.requests >= limits.maxRequests) return {ok: false, status: "REQUEST_LIMIT"};
  if (state.workUnits >= limits.maxWorkUnits) return {ok: false, status: "WORK_LIMIT"};
  if (state.signal?.aborted) return {ok: false, status: "CANCELLED"};
  const id = ++state.requestId;
  const request = makeRequest(id, method, params);
  state.requests += 1;
  state.workUnits += 1;
  const controller = new AbortController();
  let timer;
  let abortHandler;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure("TIMEOUT", "RPC request timed out"));
    }, limits.requestTimeoutMs);
  });
  const abortedPromise = new Promise((_, reject) => {
    if (!state.signal) return;
    abortHandler = () => {
      controller.abort();
      reject(failure("CANCELLED", "launch history acquisition was cancelled"));
    };
    state.signal.addEventListener("abort", abortHandler, {once: true});
  });
  let startedAt;
  try { startedAt = state.clock(); } catch {
    return {ok: false, status: "INVALID_CLOCK"};
  }
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    return {ok: false, status: "INVALID_CLOCK"};
  }
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => state.transport(request, {signal: controller.signal})),
      timeoutPromise,
      abortedPromise
    ]);
    if (!responseTargetIsAllowed(response, request)) {
      throw failure("INVALID_RESPONSE_URL", "RPC response origin or redirect is not allowed");
    }
    if (response.status !== 200) {
      return {ok: false, status: `HTTP_${response.status}`};
    }
    const {payload, bytes: responseBytes} = await Promise.race([
      readJsonBounded(response, state, limits),
      timeoutPromise,
      abortedPromise
    ]);
    const receivedAt = state.clock();
    if (!Number.isSafeInteger(receivedAt) || receivedAt < startedAt) {
      throw failure("INVALID_CLOCK", "injected clock returned an invalid time");
    }
    const elapsedFailure = checkTime(state, limits);
    if (elapsedFailure) throw failure(elapsedFailure, "launch history time limit was reached");
    const event = {
      requestId: id,
      method,
      requestStartedAt: startedAt,
      responseReceivedAt: receivedAt,
      responseBytes,
      status: "RESPONSE_RECEIVED"
    };
    state.events.push(event);
    if (!isRecord(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
      return {ok: false, status: "INVALID_RPC_ENVELOPE"};
    }
    if (Object.hasOwn(payload, "error")) {
      const error = isRecord(payload.error) ? payload.error : {};
      return {
        ok: false,
        status: method === "getTransaction" &&
          /unsupported transaction version|transaction version.*not supported/i.test(
            parseErrorMessage(error))
          ? "UNSUPPORTED_TRANSACTION_VERSION" : "RPC_ERROR",
        error: {
          code: Number.isSafeInteger(error.code) ? error.code : null,
          message: parseErrorMessage(error)
        }
      };
    }
    if (!Object.hasOwn(payload, "result")) {
      return {ok: false, status: "MISSING_RESULT"};
    }
    return {ok: true, result: payload.result};
  } catch (error) {
    const code = error?.code ?? "TRANSPORT_ERROR";
    return {ok: false, status: code, error: {message: parseErrorMessage(error)}};
  } finally {
    clearTimeout(timer);
    if (abortHandler) state.signal.removeEventListener("abort", abortHandler);
  }
}

function signatureError(value) {
  if (value === null) return null;
  return value === undefined ? "MISSING_SIGNATURE_ERROR_FIELD" : "FAILED_TRANSACTION";
}

function createCoverageSubject(subject) {
  return {
    address: subject.address,
    source: subject.source,
    evidenceId: subject.evidenceId,
    pageBoundaries: [],
    status: "IN_PROGRESS",
    signatureCoverageComplete: false,
    terminationReason: null
  };
}

export async function acquireLaunchHistory(options) {
  const {subjects, startSlot, endSlot, limits} = validateOptions(options);
  let startedAt;
  try { startedAt = options.clock(); } catch {
    throw new TypeError("injected clock must return a nonnegative safe integer");
  }
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    throw new TypeError("injected clock must return a nonnegative safe integer");
  }
  const state = {
    transport: options.transport,
    clock: options.clock,
    signal: options.signal,
    startedAt,
    startedMonotonic: performance.now(),
    requests: 0,
    bytes: 0,
    workUnits: 0,
    requestId: 0,
    events: [],
    signatures: new Map(),
    transactions: new Map(),
    stopReason: null
  };
  const subjectCoverage = [];
  for (const subject of subjects) {
    const coverage = createCoverageSubject(subject);
    subjectCoverage.push(coverage);
    const seenForSubject = new Set();
    let before;
    let pageCount = 0;
    for (;;) {
      const timeFailure = checkTime(state, limits);
      if (state.signal?.aborted || timeFailure || state.stopReason) {
        coverage.terminationReason = state.signal?.aborted ? "CANCELLED"
          : state.stopReason ?? timeFailure;
        state.stopReason ??= coverage.terminationReason;
        break;
      }
      if (pageCount >= limits.maxPagesPerSubject) {
        coverage.terminationReason = "PAGE_LIMIT";
        break;
      }
      const requestedBefore = before ?? null;
      const outcome = await requestRpc(state, limits, "getSignaturesForAddress", [
        subject.address,
        {limit: limits.pageSize, commitment: "finalized", ...(before ? {before} : {})}
      ]);
      pageCount += 1;
      if (!outcome.ok) {
        coverage.pageBoundaries.push({
          page: pageCount,
          before: requestedBefore,
          status: outcome.status,
          error: outcome.error ?? null,
          signatureCount: 0,
          firstSignature: null,
          lastSignature: null,
          terminationReason: outcome.status
        });
        coverage.terminationReason = outcome.status;
        state.stopReason ??= [
          "REQUEST_LIMIT", "TIME_LIMIT", "INVALID_CLOCK", "CANCELLED",
          "WORK_LIMIT", "RESPONSE_TOO_LARGE", "TIMEOUT"
        ].includes(outcome.status) ? outcome.status : null;
        break;
      }
      if (outcome.result === null) {
        coverage.pageBoundaries.push({
          page: pageCount,
          before: requestedBefore,
          status: "NULL_RESULT",
          signatureCount: 0,
          firstSignature: null,
          lastSignature: null,
          terminationReason: "NULL_RESULT"
        });
        coverage.terminationReason = "NULL_RESULT";
        break;
      }
      if (!Array.isArray(outcome.result)) {
        coverage.pageBoundaries.push({
          page: pageCount,
          before: requestedBefore,
          status: "INVALID_SIGNATURE_PAGE",
          signatureCount: 0,
          firstSignature: null,
          lastSignature: null,
          terminationReason: "INVALID_SIGNATURE_PAGE"
        });
        coverage.terminationReason = "INVALID_SIGNATURE_PAGE";
        break;
      }
      const page = outcome.result;
      let priorSlot = Number.POSITIVE_INFINITY;
      let malformed = false;
      let repeated = false;
      let limitHit = false;
      let conflict = false;
      const accepted = [];
      for (const entry of page) {
        if (!isRecord(entry) || typeof entry.signature !== "string" ||
            !entry.signature.trim() || !Number.isSafeInteger(entry.slot) ||
            entry.slot < 0 || !Object.hasOwn(entry, "err")) {
          malformed = true;
          break;
        }
        if (entry.slot > priorSlot) {
          malformed = true;
          break;
        }
        priorSlot = entry.slot;
        if (seenForSubject.has(entry.signature)) {
          repeated = true;
          break;
        }
        if (state.workUnits >= limits.maxWorkUnits) {
          limitHit = true;
          break;
        }
        state.workUnits += 1;
        seenForSubject.add(entry.signature);
        accepted.push(entry);
        let record = state.signatures.get(entry.signature);
        if (!record) {
          if (state.signatures.size >= limits.maxSignatures) {
            limitHit = true;
            accepted.pop();
            break;
          }
          record = {
            signature: entry.signature,
            slot: entry.slot,
            err: entry.err,
            subjectAddresses: [],
            errorStatus: signatureError(entry.err)
          };
          state.signatures.set(entry.signature, record);
        } else if (record.slot !== entry.slot ||
            JSON.stringify(record.err) !== JSON.stringify(entry.err)) {
          record.errorStatus = "CONFLICTING_SIGNATURE_RECORD";
          conflict = true;
        }
        if (!record.subjectAddresses.includes(subject.address)) {
          record.subjectAddresses.push(subject.address);
        }
      }
      const first = page[0];
      const last = page.at(-1);
      const pageReason = malformed ? "MALFORMED_PAGE"
        : repeated ? "REPEATED_CURSOR"
          : conflict ? "CONFLICTING_SIGNATURE_RECORD"
          : limitHit ? "SIGNATURE_OR_WORK_LIMIT" : null;
      coverage.pageBoundaries.push({
        page: pageCount,
        before: requestedBefore,
        status: pageReason ?? "OK",
        signatureCount: page.length,
        acceptedSignatureCount: accepted.length,
        firstSignature: typeof first?.signature === "string" ? first.signature : null,
        firstSlot: Number.isSafeInteger(first?.slot) ? first.slot : null,
        lastSignature: typeof last?.signature === "string" ? last.signature : null,
        lastSlot: Number.isSafeInteger(last?.slot) ? last.slot : null,
        terminationReason: pageReason
      });
      if (pageReason) {
        coverage.terminationReason = pageReason;
        state.stopReason ??= limitHit ? "WORK_LIMIT" : null;
        break;
      }
      if (page.length === 0) {
        coverage.signatureCoverageComplete = true;
        coverage.terminationReason = "SOURCE_EXHAUSTED";
        break;
      }
      if (last.slot < startSlot) {
        coverage.signatureCoverageComplete = true;
        coverage.terminationReason = "LOWER_SLOT_BOUND_REACHED";
        break;
      }
      if (page.length < limits.pageSize) {
        coverage.signatureCoverageComplete = true;
        coverage.terminationReason = "SOURCE_EXHAUSTED";
        break;
      }
      const cursor = last.signature;
      if (!cursor || cursor === before) {
        coverage.terminationReason = "REPEATED_CURSOR";
        coverage.pageBoundaries.at(-1).status = "REPEATED_CURSOR";
        coverage.pageBoundaries.at(-1).terminationReason = "REPEATED_CURSOR";
        break;
      }
      before = cursor;
    }
    if (coverage.terminationReason === null) coverage.terminationReason = "UNKNOWN_TERMINATION";
    coverage.status = coverage.signatureCoverageComplete ? "SIGNATURES_COMPLETE"
      : "SIGNATURES_INCOMPLETE";
  }

  const eligible = [...state.signatures.values()]
    .filter(record => record.slot >= startSlot && record.slot <= endSlot && record.err === null &&
      record.errorStatus === null)
    .sort((left, right) => left.slot - right.slot || left.signature.localeCompare(right.signature));
  let transactionCoverageComplete = true;
  for (const signature of eligible) {
    if (state.signal?.aborted || state.stopReason) {
      transactionCoverageComplete = false;
      break;
    }
    if (state.transactions.size >= limits.maxTransactions) {
      transactionCoverageComplete = false;
      state.stopReason ??= "TRANSACTION_LIMIT";
      break;
    }
    const outcome = await requestRpc(state, limits, "getTransaction", [
      signature.signature,
      {commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0}
    ]);
    let transactionRecord;
    if (!outcome.ok) {
      transactionRecord = {
        signature: signature.signature,
        slot: signature.slot,
        subjectAddresses: [...signature.subjectAddresses],
        status: outcome.status,
        error: outcome.error ?? null,
        version: null,
        transaction: null,
        meta: null
      };
      transactionCoverageComplete = false;
    } else if (outcome.result === null) {
      transactionRecord = {
        signature: signature.signature,
        slot: signature.slot,
        subjectAddresses: [...signature.subjectAddresses],
        status: "MISSING_TRANSACTION",
        error: null,
        version: null,
        transaction: null,
        meta: null
      };
      transactionCoverageComplete = false;
    } else {
      const version = transactionVersion(outcome.result);
      const validTransaction = isRecord(outcome.result) &&
        Number.isSafeInteger(outcome.result.slot) &&
        outcome.result.slot === signature.slot &&
        isRecord(outcome.result.transaction) &&
        Array.isArray(outcome.result.transaction.signatures) &&
        outcome.result.transaction.signatures[0] === signature.signature &&
        isRecord(outcome.result.meta);
      const metaSucceeded = validTransaction && outcome.result.meta.err === null;
      const status = !version.supported ? "UNSUPPORTED_TRANSACTION_VERSION"
        : !validTransaction ? "INVALID_TRANSACTION"
          : !metaSucceeded ? "TRANSACTION_NOT_SUCCESSFUL"
            : "SUCCESS";
      transactionRecord = {
        signature: signature.signature,
        slot: signature.slot,
        subjectAddresses: [...signature.subjectAddresses],
        status,
        error: null,
        version: version.value,
        transaction: validTransaction ? outcome.result.transaction : null,
        meta: validTransaction ? outcome.result.meta : null
      };
      if (status !== "SUCCESS") transactionCoverageComplete = false;
    }
    state.transactions.set(signature.signature, transactionRecord);
  }
  const signatureCoverageComplete = subjectCoverage.every(item =>
    item.signatureCoverageComplete);
  if (state.signatures.size !== eligible.length) {
    const successfulEligible = eligible.length;
    const pending = state.signatures.size - successfulEligible;
    if (pending < 0) transactionCoverageComplete = false;
  }
  if (state.transactions.size < eligible.length) transactionCoverageComplete = false;
  if (state.signal?.aborted) state.stopReason ??= "CANCELLED";
  if (!state.stopReason && subjectCoverage.some(item => !item.signatureCoverageComplete)) {
    state.stopReason = subjectCoverage.find(item => !item.signatureCoverageComplete)?.terminationReason ??
      "SIGNATURE_COVERAGE_INCOMPLETE";
  }
  if (!state.stopReason && !transactionCoverageComplete) state.stopReason = "TRANSACTION_COVERAGE_INCOMPLETE";
  const signatures = [...state.signatures.values()].map(item => ({
    ...item,
    subjectAddresses: [...item.subjectAddresses]
  }));
  const transactions = [...state.transactions.values()];
  return {
    sourceVersion: LAUNCH_HISTORY_SOURCE_VERSION,
    source: "Solana JSON-RPC",
    rpcOrigin: SOLANA_RPC_ORIGIN,
    commitment: "finalized",
    supportedTransactionVersions: ["legacy", 0],
    declaredSubjects: subjects,
    slotInterval: {startInclusive: startSlot, endInclusive: endSlot},
    signatures,
    transactions,
    events: state.events,
    counters: {
      requests: state.requests,
      bytes: state.bytes,
      workUnits: state.workUnits,
      signatures: signatures.length,
      successfulTransactions: transactions.filter(item => item.status === "SUCCESS").length
    },
    coverage: {
      scope: "declared-subjects-and-inclusive-slot-interval-only",
      complete: signatureCoverageComplete && transactionCoverageComplete &&
        eligible.length === transactions.length,
      signaturePagesComplete: signatureCoverageComplete,
      successfulTransactionRetrievalComplete: transactionCoverageComplete &&
        eligible.length === transactions.length,
      subjects: subjectCoverage,
      terminationReason: state.stopReason ?? "DECLARED_INTERVAL_COVERED"
    }
  };
}
