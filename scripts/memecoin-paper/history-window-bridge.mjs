import {createHash} from "node:crypto";

const HISTORY_SOURCE_VERSION = "solana-launch-history-source-v1";
const RPC_SOURCE = "Solana JSON-RPC";
const RPC_ORIGIN = "https://api.mainnet-beta.solana.com";
const DIGEST = /^[a-f0-9]{64}$/;
const DEFAULT_LIMITS = Object.freeze({
  maxRequests: 2_100,
  maxResponseBytes: 1_048_576,
  maxBytes: 10_485_760,
  maxWorkUnits: 5_000,
  maxSignatures: 2_000,
  maxTransactions: 1_000,
  maxBoundarySlotSpan: 100_000,
  maxElapsedMs: 15_000
});
const HARD_LIMITS = Object.freeze({
  ...DEFAULT_LIMITS,
  maxElapsedMs: 30_000,
  maxSignatures: 20_000,
  maxTransactions: 10_000,
  maxBoundarySlotSpan: 1_000_000
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value, seen = new Set(), depth = 0) {
  if (depth > 64) throw new TypeError("receipt payload is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("receipt payload is cyclic");
    seen.add(value);
    const result = value.map(item => canonicalize(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) || seen.has(value)) {
    throw new TypeError("receipt payload is not plain JSON data");
  }
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("receipt payload contains an accessor");
    }
    result[key] = canonicalize(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

export function canonicalHistoryDigest(payload) {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload)), "utf8").digest("hex");
}

function identityValid(identity) {
  return isRecord(identity) && identity.chainId === "solana" &&
    ["mint", "pool", "quote"].every(key =>
      typeof identity[key] === "string" &&
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(identity[key]));
}

function identitySnapshot(identity) {
  return identityValid(identity) ? {
    chainId: identity.chainId,
    mint: identity.mint,
    pool: identity.pool,
    quote: identity.quote
  } : null;
}

function sameIdentity(left, right) {
  return identityValid(left) && identityValid(right) &&
    ["chainId", "mint", "pool", "quote"].every(key => left[key] === right[key]);
}

function validSignal(signal) {
  return signal === undefined || (signal !== null &&
    typeof signal.aborted === "boolean" &&
    typeof signal.addEventListener === "function" &&
    typeof signal.removeEventListener === "function");
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validReceipt(receipt, source, minimumReceivedAt = 0) {
  return typeof source === "string" && source.trim().length > 0 && source.length <= 256 &&
    isRecord(receipt) && receipt.status === "SOURCE_BOUND" &&
    receipt.source === source && typeof receipt.id === "string" &&
    receipt.id.trim().length > 0 && receipt.id.length <= 256 &&
    DIGEST.test(receipt.payloadSha256 ?? "") && validTime(receipt.receivedAt) &&
    receipt.receivedAt >= minimumReceivedAt;
}

function receiptPayload(timeEvidence) {
  return {
    source: timeEvidence.source,
    identity: timeEvidence.identity,
    requested: timeEvidence.requested,
    timeBounds: timeEvidence.timeBounds,
    coverage: timeEvidence.coverage,
    counters: timeEvidence.counters,
    events: timeEvidence.events
  };
}

export function timestampEvidenceDigest(timeEvidence) {
  return canonicalHistoryDigest(receiptPayload(timeEvidence));
}

function blockTimeMs(value) {
  if (!isRecord(value) || !Number.isSafeInteger(value.blockTime) || value.blockTime < 0) return null;
  const milliseconds = value.blockTime * 1000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function boundaryPoint(value) {
  const observedAt = blockTimeMs(value);
  return isRecord(value) && observedAt !== null &&
    Number.isSafeInteger(value.slot) && value.slot >= 0
    ? {slot: value.slot, blockTime: value.blockTime, observedAt}
    : null;
}

function validEvents(events, limits, {
  minimumReceivedAt = 0,
  methods = null
} = {}) {
  if (!Array.isArray(events) || events.length < 1 || events.length > limits.maxRequests) return null;
  let bytes = 0;
  let latestReceivedAt = 0;
  for (const event of events) {
    if (!isRecord(event) || !DIGEST.test(event.responseSha256 ?? "") ||
        !Number.isSafeInteger(event.responseBytes) || event.responseBytes < 0 ||
        event.responseBytes > limits.maxResponseBytes ||
        !validTime(event.responseReceivedAt) ||
        event.responseReceivedAt < minimumReceivedAt ||
        (methods && (!methods.has(event.method) || event.status !== "RESPONSE_RECEIVED"))) return null;
    bytes += event.responseBytes;
    if (!Number.isSafeInteger(bytes) || bytes > limits.maxBytes) return null;
    latestReceivedAt = Math.max(latestReceivedAt, event.responseReceivedAt);
  }
  return {bytes, latestReceivedAt};
}

function resolveLimits(input = {}) {
  if (!isRecord(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULT_LIMITS, key))) {
    throw new TypeError("invalid bounded history-window limits");
  }
  const limits = {...DEFAULT_LIMITS, ...input};
  if (Object.entries(limits).some(([key, value]) =>
    !Number.isSafeInteger(value) || value < 1 || value > HARD_LIMITS[key]) ||
      limits.maxResponseBytes > limits.maxBytes) {
    throw new TypeError("history-window limits exceed fixed ceilings");
  }
  return Object.freeze(limits);
}

function unavailable(identity, requested, reason, collector = null) {
  return {
    status: "UNKNOWN",
    reason,
    source: typeof collector?.source === "string" ? collector.source : RPC_SOURCE,
    identity: identitySnapshot(identity),
    requested,
    transactions: [],
    receipt: null,
    sourceReceipts: [],
    coverage: {
      complete: false,
      truncated: collector?.coverage?.complete === false,
      cursorExhausted: false,
      sourceHistoryCompleteness: collector?.coverage?.sourceHistoryCompleteness ?? "UNKNOWN"
    },
    sourceAuthentication: "NOT_ESTABLISHED"
  };
}

function waitForCallback(callback, request, signal, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const controller = new AbortController();
    const finish = outcome => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      controller.abort(signal?.reason);
      finish({status: "CANCELLED"});
    };
    const timer = setTimeout(() => {
      controller.abort();
      finish({status: "TIME_LIMIT"});
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, {once: true});
    if (signal?.aborted) {
      onAbort();
      return;
    }
    Promise.resolve().then(() => callback({...request, signal: controller.signal})).then(
      value => finish({status: "RESULT", value}),
      () => finish({status: "COLLECTOR_UNKNOWN"})
    );
  });
}

function validateTimeEvidence(value, identity, requested, limits) {
  if (!isRecord(value) || value.status !== "SOURCE_BOUND" || value.source !== RPC_SOURCE ||
      !sameIdentity(value.identity, identity) ||
      value.requested?.startExclusiveMs !== requested.startExclusiveMs ||
      value.requested?.endInclusiveMs !== requested.endInclusiveMs) return null;
  const eventTotals = validEvents(value.events, limits, {
    methods: new Set(["getBlockTime"])
  });
  const counters = value.counters;
  const bounds = value.timeBounds;
  const receipt = value.receipt;
  if (!eventTotals || !isRecord(counters) ||
      counters.requests !== value.events.length ||
      counters.bytes !== eventTotals.bytes ||
      !Number.isSafeInteger(counters.workUnits) ||
      counters.workUnits < counters.requests ||
      counters.workUnits > limits.maxWorkUnits ||
      !validReceipt(receipt, value.source, requested.endInclusiveMs) ||
      receipt.payloadSha256 !== timestampEvidenceDigest(value) ||
      receipt.receivedAt < eventTotals.latestReceivedAt ||
      !isRecord(value.coverage) || value.coverage.complete !== true ||
      value.coverage.monotonicSlots !== true ||
      value.coverage.scope !== "selected-pool-inclusive-slot-range" ||
      !isRecord(bounds) || bounds.receiptId !== receipt.id) return null;
  const startBefore = boundaryPoint(bounds.startExclusive?.before);
  const startAfter = boundaryPoint(bounds.startExclusive?.after);
  const endBefore = boundaryPoint(bounds.endInclusive?.before);
  const endAfter = boundaryPoint(bounds.endInclusive?.after);
  if (!startBefore || !startAfter || !endBefore || !endAfter ||
      startBefore.slot >= startAfter.slot ||
      startBefore.observedAt > requested.startExclusiveMs ||
      startAfter.observedAt <= requested.startExclusiveMs ||
      startAfter.slot > endBefore.slot ||
      startAfter.observedAt > endBefore.observedAt ||
      endBefore.observedAt > requested.endInclusiveMs ||
      endBefore.slot >= endAfter.slot ||
      endAfter.observedAt <= requested.endInclusiveMs ||
      endAfter.slot - startBefore.slot > limits.maxBoundarySlotSpan) return null;
  return {
    startBefore, startAfter, endBefore, endAfter, receipt,
    events: value.events, counters
  };
}

function validCollector(collector, identity, slotInterval, limits) {
  if (!isRecord(collector) || collector.sourceVersion !== HISTORY_SOURCE_VERSION ||
      collector.source !== RPC_SOURCE || collector.rpcOrigin !== RPC_ORIGIN ||
      collector.commitment !== "finalized" ||
      !Array.isArray(collector.declaredSubjects) || collector.declaredSubjects.length !== 1 ||
      collector.declaredSubjects[0]?.address !== identity.pool ||
      collector.coverage?.scope !== "declared-subjects-and-inclusive-slot-interval-only" ||
      !Number.isSafeInteger(collector.slotInterval?.startInclusive) ||
      !Number.isSafeInteger(collector.slotInterval?.endInclusive) ||
      collector.slotInterval.startInclusive < 0 ||
      collector.slotInterval.endInclusive < collector.slotInterval.startInclusive ||
      collector.coverage?.complete !== true ||
      collector.coverage?.signaturePagesComplete !== true ||
      collector.coverage?.successfulTransactionRetrievalComplete !== true ||
      collector.coverage?.terminationReason !== "DECLARED_INTERVAL_COVERED" ||
      collector.coverage?.finalizedAnchor?.status !== "CAPTURED" ||
      collector.coverage.finalizedAnchor.slot < collector.slotInterval.endInclusive ||
      collector.coverage?.subjects?.length !== 1 ||
      collector.coverage.subjects[0]?.address !== identity.pool ||
      collector.coverage.subjects[0]?.signatureCoverageComplete !== true ||
      !["SOURCE_EXHAUSTED", "LOWER_SLOT_BOUND_REACHED"].includes(
        collector.coverage.subjects[0]?.terminationReason) ||
      collector.coverage.sourceHistoryCompleteness !== "COMPLETE") return null;

  const counters = collector.counters;
  const events = validEvents(collector.events, limits, {
    methods: new Set(["getSlot", "getSignaturesForAddress", "getTransaction"])
  });
  if (!isRecord(counters) || !events ||
      counters.requests !== collector.events.length ||
      counters.bytes !== events.bytes || counters.bytes > limits.maxBytes ||
      !Number.isSafeInteger(counters.workUnits) || counters.workUnits < 0 ||
      counters.workUnits > limits.maxWorkUnits ||
      !Number.isSafeInteger(counters.signatures) || counters.signatures < 0 ||
      counters.signatures > limits.maxSignatures ||
      !Number.isSafeInteger(counters.successfulTransactions) ||
      counters.successfulTransactions < 0 ||
      counters.successfulTransactions > limits.maxTransactions ||
      !Array.isArray(collector.signatures) ||
      collector.signatures.length !== counters.signatures ||
      !Array.isArray(collector.transactions) ||
      collector.transactions.length !== counters.successfulTransactions) return null;
  return {events, counters};
}

function validateRows(collector, identity, interval, timeBounds, requested) {
  const lowerSlot = timeBounds.startAfter.slot;
  const upperSlot = timeBounds.endBefore.slot;
  const signatureById = new Map();
  for (const signature of collector.signatures) {
    if (!isRecord(signature) || typeof signature.signature !== "string" ||
        !signature.signature || signatureById.has(signature.signature) ||
        !Number.isSafeInteger(signature.slot) ||
        !Array.isArray(signature.subjectAddresses) ||
        signature.subjectAddresses.length !== 1 ||
        signature.subjectAddresses[0] !== identity.pool) return null;
    signatureById.set(signature.signature, signature);
  }
  let previousSlot = -1;
  let previousTime = -1;
  const transactions = [];
  const timedSlots = [
    timeBounds.startBefore,
    timeBounds.startAfter,
    ...collector.transactions,
    timeBounds.endBefore,
    timeBounds.endAfter
  ].map(row => isRecord(row)
    ? {slot: row.slot, observedAt: blockTimeMs(row)}
    : {slot: -1, observedAt: null})
    .sort((left, right) => left.slot - right.slot);
  let priorTimedSlot = -1;
  let priorSlotTime = -1;
  for (const point of timedSlots) {
    if (point.observedAt === null || point.slot < priorTimedSlot ||
        point.observedAt < priorSlotTime ||
        (point.slot === priorTimedSlot && point.observedAt !== priorSlotTime)) return null;
    priorTimedSlot = point.slot;
    priorSlotTime = point.observedAt;
  }
  for (const row of collector.transactions) {
    const observedAt = blockTimeMs(row);
    const signature = signatureById.get(row?.signature);
    if (!isRecord(row) || !signature ||
        row.status !== "SUCCESS" ||
        row.slot !== signature.slot ||
        signature.err !== null ||
        signature.errorStatus !== null ||
        (signature.blockTime !== null && signature.blockTime !== row.blockTime) ||
        !Array.isArray(row.subjectAddresses) ||
        row.subjectAddresses.length !== 1 ||
        row.subjectAddresses[0] !== identity.pool ||
        !Number.isSafeInteger(row.slot) ||
        row.slot < previousSlot ||
        row.slot < interval.startInclusive || row.slot > interval.endInclusive ||
        !isRecord(row.transaction) || !isRecord(row.meta) ||
        observedAt === null || observedAt < previousTime) return null;
    previousSlot = row.slot;
    previousTime = observedAt;
    if (observedAt > requested.startExclusiveMs && observedAt <= requested.endInclusiveMs &&
        (row.slot < lowerSlot || row.slot > upperSlot)) return null;
    if (observedAt > requested.startExclusiveMs && observedAt <= requested.endInclusiveMs) {
      transactions.push({...row, observedAt});
    }
  }
  return transactions;
}

function aggregateReceiptPayload(collector, identity, requested, timeEvidence, events) {
  return {
    schema: "SOLANA_RECEIPTED_TIME_WINDOW_V1",
    sourceVersion: collector.sourceVersion,
    source: collector.source,
    rpcOrigin: collector.rpcOrigin,
    commitment: collector.commitment,
    identity,
    requested,
    declaredSubjects: collector.declaredSubjects,
    slotInterval: collector.slotInterval,
    signatures: collector.signatures,
    transactions: collector.transactions,
    events,
    counters: collector.counters,
    collectorCoverage: collector.coverage,
    timeBounds: timeEvidence.timeBounds,
    timeEvidenceReceipt: timeEvidence.receipt
  };
}

function launchHistoryLimits(limits, timeCounters, remainingMs) {
  const maxRequests = limits.maxRequests - timeCounters.requests;
  const maxBytesPerRun = limits.maxBytes - timeCounters.bytes;
  const maxWorkUnits = limits.maxWorkUnits - timeCounters.workUnits;
  if (maxRequests < 1 || maxBytesPerRun < 1 || maxWorkUnits < 1 || remainingMs < 1) {
    return null;
  }
  return {
    maxRequests,
    maxBytesPerResponse: Math.min(limits.maxResponseBytes, maxBytesPerRun),
    maxBytesPerRun,
    maxWorkUnits,
    maxSignatures: limits.maxSignatures,
    maxTransactions: limits.maxTransactions,
    maxDurationMs: remainingMs,
    requestTimeoutMs: Math.min(5_000, remainingMs)
  };
}

export function createHistoryWindowSource({
  slotHistoryCollector,
  timeBoundarySource,
  enabled = false,
  limits: suppliedLimits
} = {}) {
  const limits = resolveLimits(suppliedLimits);
  return Object.freeze({
    async readWindow({identity, poolProof, startExclusiveMs, endInclusiveMs, signal} = {}) {
      const requested = {
        startExclusiveMs: validTime(startExclusiveMs) ? startExclusiveMs : null,
        endInclusiveMs: validTime(endInclusiveMs) ? endInclusiveMs : null
      };
      if (!enabled) return unavailable(identity, requested, "DISABLED");
      if (signal?.aborted) return unavailable(identity, requested, "CANCELLED");
      if (!validSignal(signal) || !identityValid(identity) ||
          !isRecord(poolProof) || poolProof.status !== "SOURCE_BOUND" ||
          poolProof.verified !== true ||
          poolProof.chainId !== identity.chainId ||
          poolProof.baseMint !== identity.mint ||
          poolProof.pool !== identity.pool ||
          poolProof.quoteMint !== identity.quote ||
          !validTime(poolProof.observedAt) ||
          poolProof.observedAt > endInclusiveMs ||
          !Number.isSafeInteger(poolProof.slot) || poolProof.slot < 0 ||
          !validReceipt(poolProof.receipt, poolProof.source, poolProof.observedAt) ||
          !validTime(startExclusiveMs) || !validTime(endInclusiveMs) ||
          startExclusiveMs >= endInclusiveMs ||
          typeof timeBoundarySource?.readWindow !== "function" ||
          typeof slotHistoryCollector !== "function") {
        return unavailable(identity, requested, "INVALID_OR_UNBOUND_REQUEST");
      }

      const startedAt = performance.now();
      const requestBase = {
        identity: identitySnapshot(identity),
        requested: {...requested},
        poolProof,
        limits
      };
      const timeOutcome = await waitForCallback(
        timeBoundarySource.readWindow.bind(timeBoundarySource),
        requestBase,
        signal,
        limits.maxElapsedMs
      );
      if (timeOutcome.status !== "RESULT") {
        return unavailable(identity, requested, timeOutcome.status);
      }
      const timeEvidence = timeOutcome.value;
      let validatedTime;
      try {
        validatedTime = validateTimeEvidence(timeEvidence, identity, requested, limits);
      } catch {
        validatedTime = null;
      }
      if (!validatedTime) {
        return unavailable(identity, requested, "TIME_BOUNDARY_RECEIPT_UNKNOWN");
      }

      const slotInterval = {
        startInclusive: validatedTime.startBefore.slot,
        endInclusive: validatedTime.endAfter.slot
      };
      const remainingMs = Math.floor(limits.maxElapsedMs - (performance.now() - startedAt));
      if (remainingMs <= 0) return unavailable(identity, requested, "TIME_LIMIT");
      const collectorLimits = launchHistoryLimits(limits, validatedTime.counters, remainingMs);
      if (!collectorLimits) {
        return unavailable(identity, requested, "SHARED_BUDGET_EXHAUSTED", timeEvidence);
      }
      const collectorOutcome = await waitForCallback(
        slotHistoryCollector,
        {
          ...requestBase,
          limits: collectorLimits,
          subjects: [{
            address: identity.pool,
            source: poolProof.source,
            evidenceId: poolProof.receipt.id
          }],
          startSlot: slotInterval.startInclusive,
          endSlot: slotInterval.endInclusive,
          signal
        },
        signal,
        remainingMs
      );
      if (collectorOutcome.status !== "RESULT") {
        return unavailable(identity, requested, collectorOutcome.status);
      }
      const collector = collectorOutcome.value;
      const collectorValidation = validCollector(collector, identity, slotInterval, limits);
      if (!collectorValidation) {
        return unavailable(
          identity,
          requested,
          collector?.coverage?.sourceHistoryCompleteness === "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION"
            ? "COLLECTOR_HISTORY_COMPLETENESS_UNKNOWN"
            : "COLLECTOR_COVERAGE_OR_RECEIPT_UNKNOWN",
          collector
        );
      }
      if (collectorValidation.counters.requests + validatedTime.counters.requests >
            limits.maxRequests ||
          collectorValidation.counters.bytes + validatedTime.counters.bytes > limits.maxBytes ||
          collectorValidation.counters.workUnits + validatedTime.counters.workUnits >
            limits.maxWorkUnits) {
        return unavailable(identity, requested, "SHARED_BUDGET_EXHAUSTED", collector);
      }

      const windowSpan = {
        startInclusive: collector.slotInterval.startInclusive,
        endInclusive: collector.slotInterval.endInclusive
      };
      if (windowSpan.startInclusive > validatedTime.startBefore.slot ||
          windowSpan.endInclusive < validatedTime.endAfter.slot) {
        return unavailable(identity, requested, "COLLECTED_SLOT_INTERVAL_DOES_NOT_COVER_TIME_FENCES", collector);
      }
      const timeEvents = validEvents(timeEvidence.events, limits, {
        minimumReceivedAt: requested.endInclusiveMs,
        methods: new Set(["getBlockTime"])
      });
      if (!timeEvents || !validReceipt(
        timeEvidence.receipt, timeEvidence.source, requested.endInclusiveMs
      )) {
        return unavailable(identity, requested, "TIME_EVIDENCE_RECEIPT_UNKNOWN", collector);
      }
      const collectorEvents = validEvents(collector.events, limits, {
        minimumReceivedAt: requested.endInclusiveMs,
        methods: new Set(["getSlot", "getSignaturesForAddress", "getTransaction"])
      });
      if (!collectorEvents || !Array.isArray(collector.declaredSubjects) ||
          collector.declaredSubjects.length !== 1 ||
          collector.declaredSubjects[0].address !== identity.pool ||
          collector.coverage.scope !== "declared-subjects-and-inclusive-slot-interval-only") {
        return unavailable(identity, requested, "COLLECTOR_SCOPE_OR_RECEIPT_UNKNOWN", collector);
      }
      const transactions = validateRows(
        collector, identity, windowSpan, validatedTime, requested
      );
      if (!transactions) {
        return unavailable(identity, requested, "TRANSACTION_TIMESTAMP_OR_ORDER_UNKNOWN", collector);
      }
      const sourceReceipts = {
        collector: collector.events,
        timeBoundaries: timeEvidence.events
      };
      let payloadSha256;
      try {
        payloadSha256 = canonicalHistoryDigest(aggregateReceiptPayload(
          collector, identitySnapshot(identity), requested, timeEvidence, sourceReceipts
        ));
      } catch {
        return unavailable(identity, requested, "AGGREGATE_RECEIPT_INVALID", collector);
      }
      const receivedAt = Math.max(
        collectorEvents.latestReceivedAt,
        timeEvents.latestReceivedAt,
        timeEvidence.receipt.receivedAt
      );
      const receipt = {
        status: "SOURCE_BOUND",
        id: `history-window:${payloadSha256.slice(0, 40)}`,
        source: collector.source,
        payloadSha256,
        receivedAt
      };
      return {
        status: "COMPLETE",
        source: collector.source,
        sourceVersion: collector.sourceVersion,
        identity: identitySnapshot(identity),
        requested,
        slotInterval: {...collector.slotInterval},
        transactions,
        receipt,
        sourceReceipts,
        coverage: {
          complete: true,
          truncated: false,
          cursorExhausted: true,
          timeBoundaryCoverage: "RECEIPTED_BLOCKTIME_FENCES",
          timestampBasis: "SOLANA_RPC_ESTIMATED_BLOCK_TIME_SECONDS",
          sourceHistoryCompleteness: collector.coverage.sourceHistoryCompleteness,
          sourceAuthentication: "NOT_ESTABLISHED",
          archivalRetention: "NOT_ESTABLISHED"
        },
        sourceAuthentication: "NOT_ESTABLISHED"
      };
    }
  });
}
