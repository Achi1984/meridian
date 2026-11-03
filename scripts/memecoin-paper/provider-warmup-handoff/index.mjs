import {
  BIRDEYE_SOURCE,
  HELIUS_SOURCE
} from "../provider-sources/index.mjs";
import {
  DEFAULT_WARMUP_LIMITS,
  createWarmupCensusSource,
  createWarmupPriceSource,
  warmupCoverage
} from "../evidence-warmup/index.mjs";
import {
  PAPER_RUNTIME_SOURCE_POLICY_SHA256,
  createPaperRuntimeSourceAdapter
} from "../paper-runtime-source.mjs";

export const PAPER_PROVIDER_WARMUP_HANDOFF_VERSION = "paper-provider-warmup-handoff-v1";
export const DEFAULT_HANDOFF_LIMITS = Object.freeze({
  maxElapsedMs: 10_000,
  maxEnvelopeBytes: 1_048_576,
  maxNodes: 10_000
});

const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const HASH = /^[a-f0-9]{64}$/;
const HELIUS_METHODS = new Set(["getTransactionsForAddress", "getProgramAccountsV2"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function sameIdentity(left, right) {
  return isRecord(left) && isRecord(right) &&
    ["chainId", "mint", "pool", "quote"].every(key => left[key] === right[key]);
}

function cloneBounded(value, budget = {nodes: 0, seen: new WeakSet()}, depth = 0,
  maxNodes = DEFAULT_HANDOFF_LIMITS.maxNodes) {
  budget.nodes += 1;
  if (budget.nodes > maxNodes || depth > 48) {
    throw new TypeError("HANDOFF_ENVELOPE_LIMIT");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("HANDOFF_ENVELOPE_INVALID_NUMBER");
    }
    return value;
  }
  if (!value || typeof value !== "object" || budget.seen.has(value)) {
    throw new TypeError("HANDOFF_ENVELOPE_INVALID_VALUE");
  }
  budget.seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string")) {
    throw new TypeError("HANDOFF_ENVELOPE_INVALID_KEY");
  }
  if (Array.isArray(value)) {
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("HANDOFF_ENVELOPE_INVALID_ARRAY");
      }
      output.push(cloneBounded(descriptor.value, budget, depth + 1, maxNodes));
    }
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) {
      throw new TypeError("HANDOFF_ENVELOPE_INVALID_ARRAY");
    }
    return output;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("HANDOFF_ENVELOPE_INVALID_OBJECT");
  }
  const output = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("HANDOFF_ENVELOPE_INVALID_PROPERTY");
    }
    output[key] = cloneBounded(descriptor.value, budget, depth + 1, maxNodes);
  }
  return output;
}

function resolveLimits(input = {}) {
  if (!isRecord(input) || Reflect.ownKeys(input).some(key =>
    typeof key !== "string" || !Object.hasOwn(DEFAULT_HANDOFF_LIMITS, key))) {
    throw new TypeError("invalid handoff limits");
  }
  const limits = {...DEFAULT_HANDOFF_LIMITS, ...input};
  for (const [key, maximum] of Object.entries(DEFAULT_HANDOFF_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 ||
        limits[key] > Math.min(maximum, key === "maxElapsedMs"
          ? DEFAULT_WARMUP_LIMITS.maxElapsedMs : maximum)) {
      throw new RangeError(`invalid handoff limit: ${key}`);
    }
  }
  return Object.freeze(limits);
}

function projectRecord(value, keys, {rejectUnknown = true} = {}) {
  if (!isRecord(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key =>
    typeof key !== "string" || (rejectUnknown && !keys.includes(key)))) return null;
  const output = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    if (keys.includes(key)) output[key] = descriptor.value;
  }
  return output;
}

function operationDeadline(timeoutMs, signal) {
  const startedAt = performance.now();
  const controller = new AbortController();
  let reason = null;
  let timer;
  const stop = value => {
    if (reason) return;
    reason = value;
    controller.abort(value);
  };
  const onAbort = () => stop("CANCELLED");
  if (signal?.aborted) stop("CANCELLED");
  else signal?.addEventListener("abort", onAbort, {once: true});
  timer = setTimeout(() => stop("DEADLINE"), timeoutMs);
  return {
    signal: controller.signal,
    reason() {
      if (signal?.aborted) stop("CANCELLED");
      if (!reason && performance.now() - startedAt >= timeoutMs) stop("DEADLINE");
      return reason;
    },
    remaining() {
      this.reason();
      return Math.max(0, Math.floor(timeoutMs - (performance.now() - startedAt)));
    },
    close() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
}

function exactRequest(input, identity, now, maxNodes) {
  let value;
  try {
    value = cloneBounded(input, {nodes: 0, seen: new WeakSet()}, 0, maxNodes);
  } catch {
    return null;
  }
  if (!isRecord(value) ||
      Reflect.ownKeys(value).some(key =>
        !["mint", "atMs", "denomination", "purpose"].includes(key)) ||
      value.mint !== identity.mint || !validTime(value.atMs) || value.atMs % 1_000 !== 0 ||
      value.atMs > now || value.denomination !== "USD" ||
      typeof value.purpose !== "string" || value.purpose.trim() === "" ||
      value.purpose.length > 128) return null;
  return {
    mint: value.mint,
    atMs: value.atMs,
    denomination: value.denomination,
    purpose: value.purpose
  };
}

function boundedEvaluationRequest(input, maxBytes, maxNodes) {
  const allowed = [
    "providerCandidate", "evidence", "candidateT", "assembledAt", "decisionAt",
    "policy", "poolProof", "marketPairEvidence", "smartWalletAllowlist",
    "reviewEvidence", "holdUntil", "censusSource", "priceSource"
  ];
  let descriptors;
  try {
    if (!isRecord(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null;
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    return null;
  }
  if (Reflect.ownKeys(descriptors).some(key =>
    typeof key !== "string" || !allowed.includes(key))) return null;
  const selected = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    if (key !== "censusSource" && key !== "priceSource") {
      selected[key] = descriptor.value;
    }
  }
  let normalized;
  try {
    normalized = cloneBounded(selected, {nodes: 0, seen: new WeakSet()}, 0, maxNodes);
    if (Buffer.byteLength(JSON.stringify(normalized)) > maxBytes) return null;
  } catch {
    return null;
  }
  return normalized;
}

function validateBirdeyeObservation(input, request, identity, capturedAt, maxBytes, maxNodes) {
  let observation;
  try {
    observation = cloneBounded(input, {nodes: 0, seen: new WeakSet()}, 0, maxNodes);
  } catch (error) {
    return {reason: error.message};
  }
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(observation));
  } catch {
    return {reason: "INVALID_PROVIDER_ENVELOPE"};
  }
  if (bytes > maxBytes) return {reason: "PROVIDER_ENVELOPE_LIMIT"};
  const receipt = observation.receipt;
  const wireReceipt = observation.receipts?.[0];
  const sourceAtMs = observation.data?.updateUnixTime * 1_000;
  const hash = wireReceipt?.responseSha256;
  const scope = observation.queryScope;
  if (observation.status !== "SOURCE_BOUND" || observation.source !== BIRDEYE_SOURCE ||
      observation.provider?.name !== BIRDEYE_SOURCE ||
      observation.provider?.method !== "historical_price_unix" ||
      observation.mint !== request.mint || observation.denomination !== request.denomination ||
      observation.purpose !== request.purpose ||
      identity.chainId !== "solana" ||
      !isRecord(scope) || Reflect.ownKeys(scope).length !== 4 ||
      scope.mint !== request.mint || scope.atMs !== request.atMs ||
      scope.denomination !== request.denomination || scope.purpose !== request.purpose ||
      !validTime(sourceAtMs) || sourceAtMs !== request.atMs ||
      observation.sourceAtMs !== request.atMs || observation.observedAt !== request.atMs ||
      observation.data?.isScaledUiToken !== false ||
      !Array.isArray(observation.receipts) || observation.receipts.length !== 1 ||
      typeof observation.valueUsd !== "number" || !Number.isFinite(observation.valueUsd) ||
      observation.valueUsd <= 0 || observation.data?.value !== observation.valueUsd ||
      typeof observation.methodologyVersion !== "string" ||
      observation.methodologyVersion !== "birdeye-historical-price-unix-v1" ||
      !validTime(observation.receivedAt) || observation.receivedAt < request.atMs ||
      observation.receivedAt > capturedAt ||
      !isRecord(receipt) || receipt.status !== "SOURCE_BOUND" ||
      receipt.source !== BIRDEYE_SOURCE || receipt.receivedAt !== observation.receivedAt ||
      receipt.payloadSha256 !== hash || !HASH.test(hash ?? "") ||
      receipt.id !== `${BIRDEYE_SOURCE}:${request.mint}:${request.atMs}:${hash}` ||
      !isRecord(wireReceipt) || wireReceipt.provider !== BIRDEYE_SOURCE ||
      wireReceipt.method !== "historical_price_unix" ||
      !isRecord(wireReceipt.requestScope) ||
      Reflect.ownKeys(wireReceipt.requestScope).length !== 2 ||
      wireReceipt.requestScope?.mint !== request.mint ||
      wireReceipt.requestScope?.unixTime !== request.atMs / 1_000 ||
      !validTime(wireReceipt.requestStartedAt) ||
      wireReceipt.requestStartedAt > wireReceipt.responseReceivedAt ||
      wireReceipt.responseReceivedAt !== observation.receivedAt ||
      !Number.isSafeInteger(wireReceipt.responseBytes) || wireReceipt.responseBytes < 1 ||
      !HASH.test(wireReceipt.responseSha256 ?? "") ||
      observation.qualification?.providerIdentity !== BIRDEYE_SOURCE ||
      observation.qualification?.documentedScope !== "historical_price_unix" ||
      observation.qualification?.observedCompleteness !== "UNKNOWN" ||
      observation.qualification?.exactTimestampFidelity !== "EXACT" ||
      observation.qualification?.policyApproval !== "NOT_APPROVED" ||
      observation.coverage?.observedCompleteness !== "UNKNOWN" ||
      observation.coverage?.policyApproval !== "NOT_APPROVED") {
    return {reason: "PROVIDER_OBSERVATION_UNBOUND"};
  }
  return {observation, byteLength: bytes};
}

function unavailable(reason, context = {}) {
  return {
    status: "UNKNOWN",
    reason,
    datasetId: context.datasetId ?? null,
    runId: context.runId ?? null,
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
  };
}

export async function preflightPaperProduction({signal} = {}) {
  const source = createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
  });
  const result = await source.acquireCandidates({
    signal,
    remaining: {requests: 0, bytes: 0, candidates: 0}
  });
  return {
    ...result,
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    acquisitionAttempted: false,
    storageMutated: false
  };
}

export function summarizeHeliusDiagnostic(envelope) {
  let value;
  try {
    const projection = projectRecord(envelope,
      ["status", "reason", "provider", "queryScope", "receipts"],
      {rejectUnknown: false});
    if (!projection) return {status: "UNKNOWN", reason: "INVALID_HELIUS_DIAGNOSTIC"};
    value = cloneBounded(projection);
    if (Buffer.byteLength(JSON.stringify(value)) > DEFAULT_HANDOFF_LIMITS.maxEnvelopeBytes) {
      return {status: "UNKNOWN", reason: "HELIUS_DIAGNOSTIC_BYTE_LIMIT"};
    }
  } catch {
    return {status: "UNKNOWN", reason: "INVALID_HELIUS_DIAGNOSTIC"};
  }
  const method = value?.provider?.method;
  if (value?.provider?.name !== HELIUS_SOURCE || !HELIUS_METHODS.has(method) ||
      !isRecord(value.queryScope) || !Array.isArray(value.receipts) ||
      value.receipts.length > 100) {
    return {status: "UNKNOWN", reason: "INVALID_HELIUS_DIAGNOSTIC"};
  }
  const receipts = value.receipts.map(receipt => ({
    provider: receipt?.provider ?? null,
    method: receipt?.method ?? null,
    requestScope: receipt?.requestScope ?? null,
    requestStartedAt: receipt?.requestStartedAt ?? null,
    responseReceivedAt: receipt?.responseReceivedAt ?? null,
    responseBytes: receipt?.responseBytes ?? null,
    responseSha256: HASH.test(receipt?.responseSha256 ?? "")
      ? receipt.responseSha256 : null
  }));
  if (receipts.some(receipt => receipt.provider !== HELIUS_SOURCE ||
      receipt.method !== method || receipt.responseSha256 === null)) {
    return {status: "UNKNOWN", reason: "INVALID_HELIUS_RECEIPT"};
  }
  return {
    status: value.status === "CAPTURED" ? "DIAGNOSTIC_CAPTURED" : "DIAGNOSTIC_UNKNOWN",
    reason: value.reason ?? null,
    provider: {...value.provider},
    queryScope: value.queryScope,
    receipts,
    observedCompleteness: "UNKNOWN",
    policyApproval: "NOT_APPROVED",
    historicalCoverageProven: false,
    censusEligible: false,
    warmupRecord: null
  };
}

export function createPaperProviderWarmupHandoff({
  enabled = false,
  store,
  datasetId,
  runId,
  identity,
  clock = () => Date.now(),
  limits = {}
} = {}) {
  if (typeof enabled !== "boolean") throw new TypeError("handoff enabled flag must be boolean");
  const boundedLimits = resolveLimits(limits);
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      datasetId: datasetId ?? null,
      runId: runId ?? null,
      identity: null,
      async runOffline() {
        return {
          status: "DISABLED",
          datasetId: datasetId ?? null,
          runId: runId ?? null,
          sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
        };
      }
    });
  }
  if (!DATASET_ID.test(datasetId ?? "") || !DATASET_ID.test(runId ?? "") ||
      !isRecord(identity) || identity.chainId !== "solana" ||
      !["mint", "pool", "quote"].every(key =>
        typeof identity[key] === "string" && identity[key].length <= 64) ||
      typeof clock !== "function" || !store ||
      typeof store.publish !== "function" || typeof store.read !== "function") {
    throw new TypeError("handoff requires bounded dataset identity, clock, and warmup store");
  }
  const boundIdentity = Object.freeze({
    chainId: identity.chainId,
    mint: identity.mint,
    pool: identity.pool,
    quote: identity.quote
  });

  return Object.freeze({
    enabled,
    datasetId,
    runId,
    identity: boundIdentity,

    async runOffline({
      observation,
      request,
      pipeline,
      evaluationRequest,
      priceEndpoints = [],
      censusEndpoints = [],
      signal
    } = {}) {
      const context = {datasetId, runId};
      if (!enabled) return {status: "DISABLED", ...context,
        sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256};
      if (!pipeline || pipeline.enabled !== true ||
          pipeline.mode !== "SYNTHETIC_TEST_ONLY" ||
          typeof pipeline.evaluate !== "function" ||
          !Array.isArray(priceEndpoints) || priceEndpoints.length > 10 ||
          !Array.isArray(censusEndpoints) || censusEndpoints.length > 2) {
        return unavailable("OFFLINE_PIPELINE_REQUIRED", context);
      }
      const deadline = operationDeadline(boundedLimits.maxElapsedMs, signal);
      try {
        let stop = deadline.reason();
        if (stop) return unavailable(stop, context);
        let capturedAt;
        try {
          capturedAt = clock();
        } catch {
          return unavailable("INVALID_CAPTURE_CLOCK", context);
        }
        if (!validTime(capturedAt)) return unavailable("INVALID_CAPTURE_CLOCK", context);
        const exact = exactRequest(
          request, boundIdentity, capturedAt, boundedLimits.maxNodes
        );
        if (!exact) return unavailable("INVALID_REQUEST_BINDING", context);
        const normalized = validateBirdeyeObservation(
          observation, exact, boundIdentity, capturedAt, boundedLimits.maxEnvelopeBytes,
          boundedLimits.maxNodes
        );
        if (!normalized.observation) return unavailable(normalized.reason, context);
        const normalizedEvaluation = boundedEvaluationRequest(
          evaluationRequest, boundedLimits.maxEnvelopeBytes, boundedLimits.maxNodes
        );
        if (!normalizedEvaluation ||
            !sameIdentity(normalizedEvaluation.providerCandidate, boundIdentity) ||
            normalizedEvaluation.providerCandidate?.sampledAt !== exact.atMs ||
            normalizedEvaluation.candidateT !== exact.atMs) {
          return unavailable("EVALUATION_IDENTITY_MISMATCH", context);
        }
        let boundedEndpoints;
        try {
          boundedEndpoints = cloneBounded({
            priceEndpoints,
            censusEndpoints
          }, {nodes: 0, seen: new WeakSet()}, 0, boundedLimits.maxNodes);
          if (Buffer.byteLength(JSON.stringify(boundedEndpoints)) >
              boundedLimits.maxEnvelopeBytes) {
            return unavailable("EVALUATION_ENDPOINT_LIMIT", context);
          }
        } catch {
          return unavailable("EVALUATION_ENDPOINT_LIMIT", context);
        }
        if (deadline.reason()) return unavailable(deadline.reason(), context);
        const record = {
          kind: "price",
          identity: boundIdentity,
          mint: exact.mint,
          sourceAtMs: exact.atMs,
          denomination: exact.denomination,
          methodologyVersion: normalized.observation.methodologyVersion,
          receivedAt: normalized.observation.receivedAt,
          source: BIRDEYE_SOURCE,
          trust: "UNKNOWN",
          completeness: "UNKNOWN",
          payload: normalized.observation
        };
        const publication = await store.publish({
          datasetId,
          identity: boundIdentity,
          capturedAt,
          versions: {
            handoff: PAPER_PROVIDER_WARMUP_HANDOFF_VERSION,
            provider: BIRDEYE_SOURCE,
            sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
          },
          budgets: {
            elapsedLimitMs: boundedLimits.maxElapsedMs,
            envelopeBytes: normalized.byteLength,
            runId
          },
          records: [record]
        }, {signal: deadline.signal});
        if (deadline.reason()) return unavailable(deadline.reason(), context);
        if (!["PUBLISHED", "DUPLICATE"].includes(publication?.status) ||
            publication.datasetId !== datasetId || !HASH.test(publication.digest ?? "")) {
          return {
            ...unavailable(publication?.reason ?? publication?.status ??
              "PUBLICATION_UNKNOWN", context),
            publication
          };
        }
        const remaining = deadline.remaining();
        if (remaining < 1) return unavailable(deadline.reason() ?? "DEADLINE", context);
        const readback = await store.read(datasetId, {
          signal: deadline.signal,
          timeoutMs: Math.max(1, Math.min(remaining, DEFAULT_WARMUP_LIMITS.maxElapsedMs))
        });
        if (deadline.reason()) return unavailable(deadline.reason(), context);
        const dataset = readback?.document;
        const persistedRecord = dataset?.records?.length === 1 ? dataset.records[0] : null;
        if (readback?.status !== "AVAILABLE" || readback.digest !== publication.digest ||
            dataset.datasetId !== datasetId || !sameIdentity(dataset.identity, boundIdentity) ||
            dataset.capturedAt !== capturedAt ||
            !persistedRecord || persistedRecord.trust !== "UNKNOWN" ||
            persistedRecord.completeness !== "UNKNOWN" ||
            persistedRecord.kind !== "price" || persistedRecord.source !== BIRDEYE_SOURCE ||
            !sameIdentity(persistedRecord.identity, boundIdentity) ||
            persistedRecord.mint !== exact.mint || persistedRecord.sourceAtMs !== exact.atMs ||
            persistedRecord.denomination !== exact.denomination ||
            persistedRecord.methodologyVersion !== normalized.observation.methodologyVersion ||
            persistedRecord.receivedAt !== normalized.observation.receivedAt ||
            JSON.stringify(persistedRecord.payload) !== JSON.stringify(normalized.observation)) {
          return unavailable("WARMUP_READBACK_MISMATCH", context);
        }
        const priceSource = createWarmupPriceSource(dataset);
        const censusSource = createWarmupCensusSource(dataset);
        const coverage = warmupCoverage(dataset, {
          identity: boundIdentity,
          priceEndpoints: boundedEndpoints.priceEndpoints,
          censusEndpoints: boundedEndpoints.censusEndpoints
        });
        const unavailablePrice = await priceSource.readObservation({
          mint: exact.mint,
          atMs: exact.atMs,
          denomination: exact.denomination,
          purpose: exact.purpose
        });
        if (unavailablePrice !== null) return unavailable("UNKNOWN_PRICE_BECAME_USABLE", context);
        if (deadline.reason()) return unavailable(deadline.reason(), context);
        const evaluation = await pipeline.evaluate({
          ...normalizedEvaluation,
          priceSource,
          censusSource,
          signal: deadline.signal
        });
        if (deadline.reason()) return unavailable(deadline.reason(), context);
        return {
          status: "OFFLINE_EVALUATED",
          datasetId,
          runId,
          sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
          datasetDigest: readback.digest,
          capturedAt: dataset.capturedAt,
          publication: publication.status,
          warmupReadback: readback.status,
          trust: persistedRecord.trust,
          completeness: persistedRecord.completeness,
          coverage,
          evaluation
        };
      } catch {
        const reason = deadline.reason() ?? "HANDOFF_UNKNOWN";
        return unavailable(reason, context);
      } finally {
        deadline.close();
      }
    }
  });
}
