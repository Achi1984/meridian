const HISTORY_SOURCE_VERSION = "solana-launch-history-source-v1";
const RPC_SOURCE = "Solana JSON-RPC";
const RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
const DIGEST = /^[a-f0-9]{64}$/;
const LIMITS = Object.freeze({
  maxRequests: 2_100,
  maxResponseBytes: 1_048_576,
  maxBytes: 10_485_760,
  maxWorkUnits: 5_000,
  maxTransactions: 1_000,
  maxElapsedMs: 15_000
});
const HARD_LIMITS = Object.freeze({
  maxRequests: 2_100,
  maxResponseBytes: 1_048_576,
  maxBytes: 10_485_760,
  maxWorkUnits: 5_000,
  maxTransactions: 1_000,
  maxElapsedMs: 30_000
});

function resolveLimits(value = LIMITS) {
  if (!isRecord(value) ||
      Object.keys(value).some(key => !Object.hasOwn(LIMITS, key))) {
    throw new TypeError("invalid history window limits");
  }
  const resolved = {...LIMITS, ...value};
  if (Object.entries(resolved).some(([key, limit]) =>
    !Number.isSafeInteger(limit) || limit < 1 || limit > HARD_LIMITS[key])) {
    throw new TypeError("history window limits exceed hard bounds");
  }
  return Object.freeze(resolved);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validIdentity(identity) {
  return isRecord(identity) && identity.chainId === "solana" &&
    ["mint", "pool", "quote"].every(key =>
      typeof identity[key] === "string" &&
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(identity[key]));
}

function sameIdentity(left, right) {
  return validIdentity(left) && validIdentity(right) &&
    ["chainId", "mint", "pool", "quote"].every(key => left[key] === right[key]);
}

function validReceipt(receipt, endInclusiveMs) {
  return isRecord(receipt) && typeof receipt.id === "string" &&
    receipt.id.trim().length > 0 && receipt.id.length <= 256 &&
    DIGEST.test(receipt.payloadSha256 ?? "") && validTime(receipt.receivedAt) &&
    receipt.receivedAt >= endInclusiveMs;
}

function validPoolProof(poolProof, identity) {
  return isRecord(poolProof) && poolProof.status === "SOURCE_BOUND" &&
    poolProof.verified === true &&
    poolProof.chainId === identity.chainId &&
    poolProof.baseMint === identity.mint &&
    poolProof.pool === identity.pool &&
    poolProof.quoteMint === identity.quote &&
    validTime(poolProof.observedAt) &&
    Number.isSafeInteger(poolProof.slot) && poolProof.slot >= 0 &&
    validReceipt(poolProof.receipt, poolProof.observedAt);
}

function blockTimeMs(row) {
  if (!isRecord(row) || !Number.isSafeInteger(row.blockTime) || row.blockTime < 0) return null;
  const value = row.blockTime * 1000;
  return Number.isSafeInteger(value) ? value : null;
}

function boundaryPoint(value) {
  const observedAt = blockTimeMs(value);
  return isRecord(value) && observedAt !== null &&
    Number.isSafeInteger(value.slot) && value.slot >= 0
    ? {slot: value.slot, observedAt}
    : null;
}

function validTimeBoundaries(timeBounds, startExclusiveMs, endInclusiveMs, receiptId) {
  if (!isRecord(timeBounds) || timeBounds.complete !== true ||
      timeBounds.monotonicSlots !== true || timeBounds.receiptId !== receiptId) return false;
  const lowerBefore = boundaryPoint(timeBounds.startExclusive?.before);
  const lowerAfter = boundaryPoint(timeBounds.startExclusive?.after);
  const upperBefore = boundaryPoint(timeBounds.endInclusive?.before);
  const upperAfter = boundaryPoint(timeBounds.endInclusive?.after);
  if (!lowerBefore || !lowerAfter || !upperBefore || !upperAfter) return false;
  return lowerBefore.slot < lowerAfter.slot &&
    lowerBefore.observedAt <= startExclusiveMs &&
    lowerAfter.observedAt > startExclusiveMs &&
    lowerAfter.slot <= upperBefore.slot &&
    lowerAfter.observedAt <= upperBefore.observedAt &&
    upperBefore.observedAt <= endInclusiveMs &&
    upperBefore.slot < upperAfter.slot &&
    upperAfter.observedAt > endInclusiveMs;
}

function validCollectorReceipts(result, limits) {
  if (!Array.isArray(result.events) || result.events.length < 1 ||
      result.events.length > limits.maxRequests) return false;
  let bytes = 0;
  for (const event of result.events) {
    if (!isRecord(event) || !DIGEST.test(event.responseSha256 ?? "") ||
        !Number.isSafeInteger(event.bytes) || event.bytes < 0 ||
        event.bytes > limits.maxResponseBytes) return false;
    bytes += event.bytes;
    if (!Number.isSafeInteger(bytes) || bytes > limits.maxBytes) return false;
  }
  return result.counters?.requests === result.events.length &&
    result.counters.bytes === bytes;
}

function validCounters(result, limits) {
  const counters = result.counters;
  return isRecord(counters) &&
    Number.isSafeInteger(counters.requests) && counters.requests > 0 &&
    counters.requests <= limits.maxRequests &&
    Number.isSafeInteger(counters.bytes) && counters.bytes >= 0 &&
    counters.bytes <= limits.maxBytes &&
    Number.isSafeInteger(counters.workUnits) && counters.workUnits >= 0 &&
    counters.workUnits <= limits.maxWorkUnits &&
    Number.isSafeInteger(counters.signatures) && counters.signatures >= 0 &&
    Number.isSafeInteger(counters.successfulTransactions) &&
    counters.successfulTransactions >= 0 &&
    counters.successfulTransactions <= limits.maxTransactions;
}

function validCoverage(result, identity, receiptId, startExclusiveMs, endInclusiveMs) {
  const coverage = result.coverage;
  const subjects = coverage?.subjects;
  return isRecord(coverage) && coverage.complete === true &&
    coverage.signaturePagesComplete === true &&
    coverage.successfulTransactionRetrievalComplete === true &&
    coverage.sourceHistoryCompleteness === "COMPLETE" &&
    coverage.terminationReason === "DECLARED_INTERVAL_COVERED" &&
    coverage.finalizedAnchor?.status === "CAPTURED" &&
    Number.isSafeInteger(coverage.finalizedAnchor.slot) &&
    coverage.finalizedAnchor.slot >= result.slotInterval?.endInclusive &&
    Array.isArray(subjects) && subjects.length === 1 &&
    subjects[0]?.address === identity.pool &&
    subjects[0]?.signatureCoverageComplete === true &&
    ["SOURCE_EXHAUSTED", "LOWER_SLOT_BOUND_REACHED"].includes(subjects[0]?.terminationReason) &&
    validTimeBoundaries(coverage.timeBounds, startExclusiveMs, endInclusiveMs, receiptId);
}

function validTransactions(result, slotInterval, timeBounds, startExclusiveMs, endInclusiveMs, limits) {
  if (!Array.isArray(result.transactions) ||
      result.transactions.length > limits.maxTransactions ||
      result.transactions.length !== result.counters.successfulTransactions) return null;
  const lowerSlot = timeBounds.startExclusive.after.slot;
  const upperSlot = timeBounds.endInclusive.before.slot;
  let previousSlot = -1;
  let previousTime = -1;
  const seen = new Set();
  const withinWindow = [];
  for (const row of result.transactions) {
    const observedAt = blockTimeMs(row);
    if (!isRecord(row) || typeof row.signature !== "string" || !row.signature ||
        row.signature.length > 256 || seen.has(row.signature) ||
        !Number.isSafeInteger(row.slot) || row.slot < previousSlot ||
        row.slot < slotInterval.startInclusive || row.slot > slotInterval.endInclusive ||
        !Array.isArray(row.subjectAddresses) || !row.subjectAddresses.includes(result.identity.pool) ||
        !isRecord(row.transaction) || !isRecord(row.meta) ||
        row.status !== "SUCCESS" || observedAt === null || observedAt < previousTime ||
        (row.observedAt !== undefined && row.observedAt !== observedAt)) return null;
    seen.add(row.signature);
    previousSlot = row.slot;
    previousTime = observedAt;
    if (observedAt > startExclusiveMs && observedAt <= endInclusiveMs &&
        (row.slot < lowerSlot || row.slot > upperSlot)) return null;
    if (observedAt > startExclusiveMs && observedAt <= endInclusiveMs) {
      withinWindow.push({...row, observedAt});
    }
  }
  return withinWindow;
}

function unavailable(identity, requested, reason, sourceResult = null) {
  return {
    status: "UNKNOWN",
    reason,
    source: sourceResult?.source ?? RPC_SOURCE,
    identity: validIdentity(identity) ? {...identity} : null,
    requested,
    transactions: [],
    receipt: isRecord(sourceResult?.receipt) ? sourceResult.receipt : null,
    sourceReceipts: Array.isArray(sourceResult?.events) ? sourceResult.events : [],
    coverage: {complete: false, truncated: null, cursorExhausted: false}
  };
}

function waitForCollection(collector, request, signal, limits) {
  return new Promise(resolve => {
    let settled = false;
    const controller = new AbortController();
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      controller.abort(signal?.reason);
      finish({kind: "CANCELLED"});
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish({kind: "TIME_LIMIT"});
    }, limits.maxElapsedMs);
    signal?.addEventListener("abort", onAbort, {once: true});
    if (signal?.aborted) {
      onAbort();
      return;
    }
    Promise.resolve().then(() => collector({...request, signal: controller.signal})).then(
      value => finish({kind: "RESULT", value}),
      () => finish({kind: "COLLECTOR_UNKNOWN"})
    );
  });
}

export function createHistoryWindowSource({
  slotHistoryCollector,
  enabled = false,
  limits: suppliedLimits
} = {}) {
  const limits = resolveLimits(suppliedLimits);
  return Object.freeze({
    async readWindow({identity, poolProof, startExclusiveMs, endInclusiveMs, signal} = {}) {
      const requested = {startExclusiveMs, endInclusiveMs};
      if (!enabled) return unavailable(identity, requested, "DISABLED");
      if (signal?.aborted) return unavailable(identity, requested, "CANCELLED");
      if (typeof slotHistoryCollector !== "function" ||
          !validIdentity(identity) || !validPoolProof(poolProof, identity) ||
          !validTime(startExclusiveMs) || !validTime(endInclusiveMs) ||
          startExclusiveMs >= endInclusiveMs) {
        return unavailable(identity, requested, "INVALID_OR_UNBOUND_REQUEST");
      }

      const outcome = await waitForCollection(slotHistoryCollector, {
        identity: {...identity},
        poolProof,
        startExclusiveMs,
        endInclusiveMs,
        signal,
        limits
      }, signal, limits);
      if (outcome.kind !== "RESULT") {
        return unavailable(identity, requested, outcome.kind);
      }

      const result = outcome.value;
      if (!isRecord(result) || result.sourceVersion !== HISTORY_SOURCE_VERSION ||
          result.source !== RPC_SOURCE || result.rpcOrigin !== RPC_ORIGIN ||
          result.commitment !== "finalized" ||
          !sameIdentity(result.identity, identity) ||
          result.requested?.startExclusiveMs !== startExclusiveMs ||
          result.requested?.endInclusiveMs !== endInclusiveMs ||
          !validReceipt(result.receipt, endInclusiveMs) ||
          !validCounters(result, limits) || !validCollectorReceipts(result, limits)) {
        return unavailable(identity, requested, "COLLECTOR_RECEIPT_OR_IDENTITY_UNKNOWN", result);
      }

      const slotInterval = result.slotInterval;
      if (!isRecord(slotInterval) ||
          !Number.isSafeInteger(slotInterval.startInclusive) ||
          !Number.isSafeInteger(slotInterval.endInclusive) ||
          slotInterval.startInclusive < 0 ||
          slotInterval.startInclusive > slotInterval.endInclusive ||
          !validCoverage(result, identity, result.receipt.id, startExclusiveMs, endInclusiveMs)) {
        return unavailable(identity, requested, "TIME_BOUNDARY_OR_HISTORY_COVERAGE_UNKNOWN", result);
      }

      const transactions = validTransactions(
        result, slotInterval, result.coverage.timeBounds, startExclusiveMs, endInclusiveMs, limits
      );
      if (!transactions) {
        return unavailable(identity, requested, "TRANSACTION_TIMESTAMP_OR_ORDER_UNKNOWN", result);
      }
      return {
        status: "COMPLETE",
        source: result.source,
        sourceVersion: result.sourceVersion,
        identity: {...identity},
        requested,
        slotInterval: {...slotInterval},
        transactions,
        receipt: result.receipt,
        sourceReceipts: result.events,
        coverage: {
          complete: true,
          truncated: false,
          cursorExhausted: true,
          timeBoundaryCoverage: "PROVEN_BY_RECEIPTED_BLOCKTIME_FENCES",
          timestampBasis: "SOLANA_RPC_ESTIMATED_BLOCK_TIME_SECONDS",
          sourceHistoryCompleteness: result.coverage.sourceHistoryCompleteness
        }
      };
    }
  });
}
