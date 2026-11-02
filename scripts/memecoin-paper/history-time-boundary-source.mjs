import {createHash} from "node:crypto";
import {
  createBoundedHistoryRpcReader,
  DEFAULT_LAUNCH_HISTORY_LIMITS,
  LAUNCH_HISTORY_SOURCE_VERSION,
  SOLANA_RPC_ORIGIN
} from "./launch-history-source.mjs";

export const TIME_BOUNDARY_SOURCE_VERSION = "solana-time-boundary-source-v1";
export const HISTORY_WINDOW_BRIDGE_VERSION = "solana-receipted-time-window-v1";

const RPC_SOURCE = "Solana JSON-RPC";
const DIGEST = /^[a-f0-9]{64}$/;
const DEFAULT_LIMITS = Object.freeze({
  maxRequests: 960,
  maxBytesPerRun: 8_388_608,
  maxWorkUnits: 5_000,
  maxDurationMs: 15_000,
  requestTimeoutMs: 5_000,
  maxBoundarySlotSpan: 2_500,
  maxElapsedMs: 15_000
});
const HARD_LIMITS = Object.freeze({
  maxBoundarySlotSpan: 100_000,
  maxElapsedMs: 30_000
});
export const DEFAULT_TIME_BOUNDARY_LIMITS = Object.freeze({
  ...DEFAULT_LAUNCH_HISTORY_LIMITS,
  ...DEFAULT_LIMITS
});
const COLLECTOR_METHODS = new Set([
  "getSlot", "getSignaturesForAddress", "getTransaction"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function plainData(value, seen = new Set(), depth = 0) {
  if (depth > 64) throw new TypeError("receipt payload is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("receipt payload is cyclic");
    seen.add(value);
    const result = value.map(item => plainData(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) || seen.has(value)) {
    throw new TypeError("receipt payload must be plain JSON data");
  }
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("receipt payload contains an accessor");
    }
    result[key] = plainData(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(plainData(value)), "utf8").digest("hex");
}

function identityValid(identity) {
  return isRecord(identity) && identity.chainId === "solana" &&
    ["mint", "pool", "quote"].every(key =>
      typeof identity[key] === "string" &&
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(identity[key]));
}

function sameIdentity(left, right) {
  return identityValid(left) && identityValid(right) &&
    ["chainId", "mint", "pool", "quote"].every(key => left[key] === right[key]);
}

function receiptPayload(evidence) {
  return {
    schema: TIME_BOUNDARY_SOURCE_VERSION,
    source: evidence.source,
    identity: evidence.identity,
    requested: evidence.requested,
    slotRange: evidence.slotRange,
    timeBounds: evidence.timeBounds,
    slotEnumeration: evidence.slotEnumeration,
    coverage: evidence.coverage,
    counters: evidence.counters,
    events: evidence.events
  };
}

export function timeEvidenceDigest(evidence) {
  return digest(receiptPayload(evidence));
}

function resolveLimits(input = {}) {
  if (!isRecord(input) || Reflect.ownKeys(input).some(key =>
    typeof key !== "string" ||
    (!Object.hasOwn(DEFAULT_LIMITS, key) && !Object.hasOwn(DEFAULT_LAUNCH_HISTORY_LIMITS, key)))) {
    throw new TypeError("invalid bounded history-window limits");
  }
  const limits = {...DEFAULT_TIME_BOUNDARY_LIMITS, ...input};
  for (const [key, max] of Object.entries(HARD_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max) {
      throw new TypeError(`${key} is outside the fixed history-window limit`);
    }
  }
  for (const [key, max] of Object.entries({
    maxSubjects: 100,
    pageSize: 1_000,
    maxPagesPerSubject: 100,
    maxSignatures: 20_000,
    maxTransactions: 10_000,
    maxRequests: 30_000,
    maxBytesPerResponse: 2_097_152,
    maxBytesPerRun: 52_428_800,
    maxWorkUnits: 30_000,
    requestTimeoutMs: 30_000
  })) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max) {
      throw new TypeError(`${key} is outside the fixed RPC limit`);
    }
  }
  if (limits.maxBytesPerResponse > limits.maxBytesPerRun) {
    throw new TypeError("history-window response/run limits are inconsistent");
  }
  return Object.freeze(limits);
}

function slotRangeValid(range) {
  return isRecord(range) && Number.isSafeInteger(range.startInclusive) &&
    range.startInclusive >= 0 && Number.isSafeInteger(range.endInclusive) &&
    range.endInclusive >= range.startInclusive;
}

function unavailable(identity, requested, reason, details = {}) {
  return {
    status: "UNKNOWN",
    reason,
    source: RPC_SOURCE,
    identity: identityValid(identity) ? {...identity} : null,
    requested,
    transactions: [],
    receipt: null,
    sourceReceipts: [],
    coverage: {
      complete: false,
      truncated: false,
      cursorExhausted: false,
      sourceHistoryCompleteness: details.sourceHistoryCompleteness ?? "UNKNOWN"
    },
    sourceAuthentication: "NOT_ESTABLISHED",
    ...details
  };
}

function attemptDetails(timeEvidence, collector = null) {
  const timeCounters = timeEvidence?.counters;
  const collectorCounters = collector?.counters;
  const counters = isRecord(timeCounters) &&
      Number.isSafeInteger(timeCounters.requests) &&
      Number.isSafeInteger(timeCounters.bytes) &&
      Number.isSafeInteger(timeCounters.workUnits)
    ? {
        requests: timeCounters.requests,
        bytes: timeCounters.bytes,
        workUnits: timeCounters.workUnits
      } : null;
  if (counters && isRecord(collectorCounters) &&
      Number.isSafeInteger(collectorCounters.requests) &&
      Number.isSafeInteger(collectorCounters.bytes) &&
      Number.isSafeInteger(collectorCounters.workUnits)) {
    counters.requests += collectorCounters.requests;
    counters.bytes += collectorCounters.bytes;
    counters.workUnits += collectorCounters.workUnits;
  }
  return {
    sourceReceipts: {
      timeBoundaries: timeEvidence?.events ?? timeEvidence?.timeBoundaryEvents ?? [],
      collector: collector?.events ?? []
    },
    counters,
    timeBoundaryCoverage: timeEvidence?.coverage ?? null,
    collectorCoverage: collector?.coverage ?? null
  };
}

function validPoolProof(poolProof, identity, requested) {
  return isRecord(poolProof) && poolProof.status === "SOURCE_BOUND" &&
    poolProof.verified === true &&
    poolProof.chainId === identity.chainId &&
    poolProof.baseMint === identity.mint &&
    poolProof.pool === identity.pool &&
    poolProof.quoteMint === identity.quote &&
    validTime(poolProof.observedAt) &&
    poolProof.observedAt <= requested.endInclusiveMs &&
    Number.isSafeInteger(poolProof.slot) && poolProof.slot >= 0 &&
    isRecord(poolProof.receipt) && poolProof.receipt.status === "SOURCE_BOUND" &&
    poolProof.receipt.source === poolProof.source &&
    typeof poolProof.receipt.id === "string" &&
    DIGEST.test(poolProof.receipt.payloadSha256 ?? "") &&
    validTime(poolProof.receipt.receivedAt) &&
    poolProof.receipt.receivedAt >= poolProof.observedAt;
}

function slotSeconds(record) {
  if (!isRecord(record) || !Number.isSafeInteger(record.blockTime) || record.blockTime < 0) {
    return null;
  }
  const observedAt = record.blockTime * 1_000;
  return Number.isSafeInteger(observedAt) && validTime(observedAt) ? observedAt : null;
}

function compactSkippedSlots(startSlot, producedSlots, endSlot) {
  const skipped = [];
  let next = startSlot;
  for (const slot of producedSlots) {
    if (slot > next) skipped.push({startInclusive: next, endInclusive: slot - 1});
    next = slot + 1;
  }
  if (next <= endSlot) skipped.push({startInclusive: next, endInclusive: endSlot});
  return skipped;
}

function boundaryFor(points, timestamp) {
  let before = null;
  let after = null;
  for (const point of points) {
    if (point.observedAt <= timestamp) before = point;
    else {
      after = point;
      break;
    }
  }
  return before && after ? {
    before: {slot: before.slot, blockTime: before.blockTime},
    after: {slot: after.slot, blockTime: after.blockTime}
  } : null;
}

function validateRpcEvent(event, method, params) {
  return isRecord(event) && event.method === method &&
    event.origin === SOLANA_RPC_ORIGIN &&
    event.status === "RESPONSE_RECEIVED" &&
    Array.isArray(event.params) &&
    JSON.stringify(event.params) === JSON.stringify(params) &&
    DIGEST.test(event.responseSha256 ?? "") &&
    Number.isSafeInteger(event.responseBytes) && event.responseBytes >= 0 &&
    validTime(event.requestStartedAt) && validTime(event.responseReceivedAt) &&
    event.responseReceivedAt >= event.requestStartedAt;
}

function validateEnumeration(evidence, identity, requested, limits, slotRange) {
  if (!slotRangeValid(slotRange) || !isRecord(evidence) ||
      evidence.status !== "SOURCE_BOUND" ||
      evidence.source !== RPC_SOURCE || !sameIdentity(evidence.identity, identity) ||
      evidence.requested?.startExclusiveMs !== requested.startExclusiveMs ||
      evidence.requested?.endInclusiveMs !== requested.endInclusiveMs ||
      evidence.slotRange?.startInclusive !== slotRange.startInclusive ||
      evidence.slotRange?.endInclusive !== slotRange.endInclusive ||
      evidence.coverage?.complete !== true ||
      evidence.coverage?.enumerationComplete !== true ||
      evidence.coverage?.monotonicSlots !== true ||
      evidence.coverage?.scope !== "selected-pool-inclusive-slot-range" ||
      evidence.coverage?.skippedSlotsAccounted !== true ||
      !Array.isArray(evidence.slotEnumeration?.producedSlots) ||
      !Array.isArray(evidence.slotEnumeration?.skippedRanges) ||
      !Array.isArray(evidence.slotEnumeration?.unavailableSlots) ||
      evidence.slotEnumeration?.enumerationComplete !== true ||
      !Array.isArray(evidence.slotEnumeration?.unresolvedSlots) ||
      !Array.isArray(evidence.slotEnumeration?.points) ||
      !Array.isArray(evidence.events) || !isRecord(evidence.counters) ||
      evidence.events.length !== evidence.counters.requests ||
      evidence.counters.requests > limits.maxRequests ||
      !Number.isSafeInteger(evidence.counters.bytes) ||
      evidence.counters.bytes > limits.maxBytesPerRun ||
      !Number.isSafeInteger(evidence.counters.workUnits) ||
      evidence.counters.workUnits > limits.maxWorkUnits ||
      evidence.receipt?.status !== "SOURCE_BOUND" ||
      evidence.receipt?.source !== evidence.source ||
      evidence.receipt?.id !== evidence.timeBounds?.receiptId ||
      evidence.receipt?.payloadSha256 !== timeEvidenceDigest(evidence) ||
      !validTime(evidence.receipt?.receivedAt) ||
      evidence.receipt.receivedAt < requested.endInclusiveMs ||
      evidence.receipt.receivedAt < Math.max(...evidence.events.map(event => event.responseReceivedAt))) return null;

  const span = slotRange.endInclusive - slotRange.startInclusive + 1;
  if (span > limits.maxBoundarySlotSpan ||
      evidence.counters.workUnits < evidence.events.length + span) return null;

  const producedSlots = evidence.slotEnumeration.producedSlots;
  let prior = slotRange.startInclusive - 1;
  for (const slot of producedSlots) {
    if (!Number.isSafeInteger(slot) || slot <= prior || slot > slotRange.endInclusive) return null;
    prior = slot;
  }
  if (evidence.slotEnumeration.points.length !== producedSlots.length ||
      evidence.slotEnumeration.unavailableSlots.length !== 0 ||
      evidence.slotEnumeration.unresolvedSlots.length !== 0 ||
      JSON.stringify(evidence.slotEnumeration.skippedRanges) !==
        JSON.stringify(compactSkippedSlots(
          slotRange.startInclusive, producedSlots, slotRange.endInclusive
        ))) return null;
  const points = [];
  let previousObservedAt = -1;
  for (let index = 0; index < producedSlots.length; index += 1) {
    const point = evidence.slotEnumeration.points[index];
    const observedAt = slotSeconds(point);
    if (!isRecord(point) || point.slot !== producedSlots[index] ||
        observedAt === null || observedAt < previousObservedAt) return null;
    previousObservedAt = observedAt;
    points.push({slot: point.slot, blockTime: point.blockTime, observedAt});
  }
  const expectedMethods = new Map([
    ["getSlot", 1],
    ["getBlocks", 1],
    ["getBlockTime", producedSlots.length]
  ]);
  if (evidence.events.length !== [...expectedMethods.values()].reduce((a, b) => a + b, 0) ||
      evidence.events[0]?.method !== "getSlot" ||
      !validateRpcEvent(evidence.events[0], "getSlot", [{commitment: "finalized"}]) ||
      evidence.events[1]?.method !== "getBlocks" ||
      !validateRpcEvent(evidence.events[1], "getBlocks", [
        slotRange.startInclusive, slotRange.endInclusive, {commitment: "finalized"}
      ]) ||
      evidence.events.slice(2).some((event, index) =>
        !validateRpcEvent(event, "getBlockTime", [producedSlots[index]])) ||
      evidence.events.some((event, index, events) =>
        event.responseReceivedAt < requested.endInclusiveMs ||
        index > 0 && event.requestStartedAt < events[index - 1].responseReceivedAt)) return null;
  const bytes = evidence.events.reduce((sum, event) => sum + event.responseBytes, 0);
  if (bytes !== evidence.counters.bytes ||
      evidence.events.some(event => event.responseBytes > limits.maxBytesPerResponse)) return null;

  const startExclusive = boundaryFor(points, requested.startExclusiveMs);
  const endInclusive = boundaryFor(points, requested.endInclusiveMs);
  if (!startExclusive || !endInclusive ||
      startExclusive.before.slot >= startExclusive.after.slot ||
      startExclusive.after.slot > endInclusive.before.slot ||
      startExclusive.after.blockTime * 1_000 <= requested.startExclusiveMs ||
      endInclusive.before.blockTime * 1_000 > requested.endInclusiveMs ||
      endInclusive.after.blockTime * 1_000 <= requested.endInclusiveMs) return null;
  return {startExclusive, endInclusive, points};
}

export function createTimeBoundarySource({
  enabled = false,
  slotRange,
  transport,
  clock,
  limits: suppliedLimits = {}
} = {}) {
  const limits = resolveLimits(suppliedLimits);
  if (enabled && (!slotRangeValid(slotRange) ||
      slotRange.endInclusive - slotRange.startInclusive + 1 > limits.maxBoundarySlotSpan ||
      typeof transport !== "function" || typeof clock !== "function")) {
    throw new TypeError("enabled time-boundary source requires an explicit bounded slot range, transport, and clock");
  }
  return Object.freeze({
    async readWindow({identity, requested, poolProof, limits: requestLimits, signal} = {}) {
      const request = {
        startExclusiveMs: requested?.startExclusiveMs ?? null,
        endInclusiveMs: requested?.endInclusiveMs ?? null
      };
      if (!enabled) return unavailable(identity, request, "DISABLED");
      if (signal?.aborted) return unavailable(identity, request, "CANCELLED");
      if (!identityValid(identity) || !isRecord(requested) ||
          !validTime(request.startExclusiveMs) || !validTime(request.endInclusiveMs) ||
          request.startExclusiveMs >= request.endInclusiveMs ||
          !validPoolProof(poolProof, identity, request) ||
          poolProof.slot < slotRange.startInclusive || poolProof.slot > slotRange.endInclusive) {
        return unavailable(identity, request, "INVALID_OR_UNBOUND_REQUEST");
      }
      let effectiveLimits;
      try {
        effectiveLimits = resolveLimits({...limits, ...(requestLimits ?? {})});
      } catch {
        return unavailable(identity, request, "INVALID_LIMITS");
      }
      const startedMonotonic = performance.now();
      const span = slotRange.endInclusive - slotRange.startInclusive + 1;
      if (span + 2 > effectiveLimits.maxWorkUnits) {
        return unavailable(identity, request, "WORK_LIMIT");
      }
      const readerLimits = Object.fromEntries(Object.keys(DEFAULT_LAUNCH_HISTORY_LIMITS)
        .map(key => [key, effectiveLimits[key]]));
      readerLimits.maxWorkUnits = effectiveLimits.maxWorkUnits - span;
      const reader = createBoundedHistoryRpcReader({
        transport,
        clock,
        signal,
        limits: readerLimits,
        maxDurationMs: Math.min(effectiveLimits.maxDurationMs, effectiveLimits.maxElapsedMs)
      });
      const events = [];
      const producedSlots = [];
      const points = [];
      const unavailableSlots = [];
      let enumerationComplete = false;
      let enumerationWork = 0;
      const read = async (method, params) => {
        if (signal?.aborted) throw new Error("CANCELLED");
        const counters = reader.counters();
        const elapsed = performance.now() - startedMonotonic;
        if (elapsed >= effectiveLimits.maxElapsedMs ||
            counters.requests >= effectiveLimits.maxRequests ||
            counters.workUnits >= effectiveLimits.maxWorkUnits) {
          throw new Error("TIME_OR_WORK_LIMIT");
        }
        const outcome = await reader.read({
          method,
          params,
          signal
        });
        if (!outcome.ok || !validateRpcEvent(outcome.event, method, params)) {
          throw new Error(outcome.status ?? "RPC_RESPONSE_UNKNOWN");
        }
        events.push(outcome.event);
        return outcome.result;
      };
      try {
        const finalizedSlot = await read("getSlot", [{commitment: "finalized"}]);
        if (!Number.isSafeInteger(finalizedSlot) || finalizedSlot < slotRange.endInclusive) {
          throw new Error("SLOT_RANGE_AFTER_FINALIZED_ANCHOR");
        }
        const result = await read("getBlocks", [
          slotRange.startInclusive,
          slotRange.endInclusive,
          {commitment: "finalized"}
        ]);
        if (!Array.isArray(result)) throw new Error("BLOCK_ENUMERATION_UNKNOWN");
        enumerationWork = span;
        let previous = slotRange.startInclusive - 1;
        for (const slot of result) {
          if (!Number.isSafeInteger(slot) || slot < slotRange.startInclusive ||
              slot > slotRange.endInclusive || slot <= previous) {
            throw new Error("BLOCK_ENUMERATION_INVALID");
          }
          producedSlots.push(slot);
          previous = slot;
        }
        enumerationComplete = true;
        for (const slot of producedSlots) {
          const blockTime = await read("getBlockTime", [slot]);
          if (blockTime === null) {
            unavailableSlots.push(slot);
            throw new Error("BLOCK_TIME_UNAVAILABLE");
          }
          const observedAt = slotSeconds({blockTime});
          if (observedAt === null) {
            unavailableSlots.push(slot);
            throw new Error("BLOCK_TIME_INVALID");
          }
          const previousPoint = points.at(-1);
          if (previousPoint && observedAt < previousPoint.observedAt) {
            unavailableSlots.push(slot);
            throw new Error("BLOCK_TIME_REGRESSION");
          }
          points.push({slot, blockTime, observedAt});
        }
        const timeBounds = {
          receiptId: `${TIME_BOUNDARY_SOURCE_VERSION}:${slotRange.startInclusive}:${slotRange.endInclusive}`,
          startExclusive: boundaryFor(points, request.startExclusiveMs),
          endInclusive: boundaryFor(points, request.endInclusiveMs)
        };
        const counters = reader.counters();
        const workUnits = counters.workUnits + span;
        if (workUnits > effectiveLimits.maxWorkUnits ||
            counters.bytes > effectiveLimits.maxBytesPerRun ||
            counters.requests !== events.length ||
            performance.now() - startedMonotonic > effectiveLimits.maxElapsedMs) {
          throw new Error("SHARED_BUDGET_EXHAUSTED");
        }
        if (!timeBounds.startExclusive || !timeBounds.endInclusive) {
          throw new Error("SLOT_RANGE_DOES_NOT_COVER_TIME_WINDOW");
        }
        const receivedAt = clock();
        const latestEventAt = Math.max(...events.map(event => event.responseReceivedAt));
        if (!validTime(receivedAt) || receivedAt < latestEventAt ||
            receivedAt < request.endInclusiveMs) {
          throw new Error("INVALID_RECEIPT_TIME");
        }
        const evidence = {
          status: "SOURCE_BOUND",
          source: RPC_SOURCE,
          identity: {...identity},
          requested: request,
          slotRange: {...slotRange},
          timeBounds,
          slotEnumeration: {
            enumerationComplete: true,
            producedSlots,
            skippedRanges: compactSkippedSlots(
              slotRange.startInclusive, producedSlots, slotRange.endInclusive
            ),
            unavailableSlots,
            unresolvedSlots: [],
            points: points.map(({slot, blockTime}) => ({slot, blockTime}))
          },
          coverage: {
            complete: true,
            enumerationComplete: true,
            monotonicSlots: true,
            scope: "selected-pool-inclusive-slot-range",
            skippedSlotsAccounted: true,
            sourceAuthentication: "NOT_ESTABLISHED"
          },
          events,
          counters: {
            requests: counters.requests,
            bytes: counters.bytes,
            workUnits
          },
          receipt: null
        };
        const payloadSha256 = timeEvidenceDigest(evidence);
        evidence.receipt = {
          status: "SOURCE_BOUND",
          id: evidence.timeBounds.receiptId,
          source: RPC_SOURCE,
          payloadSha256,
          receivedAt
        };
        if (!validateEnumeration(
          evidence, identity, request, effectiveLimits, slotRange
        )) throw new Error("TIME_BOUNDARY_RECEIPT_UNKNOWN");
        return evidence;
      } catch (error) {
        const counters = reader.counters();
        return unavailable(identity, request, error?.message ?? "TIME_BOUNDARY_UNKNOWN", {
          timeBoundaryEvents: events,
          slotEnumeration: {
            enumerationComplete,
            producedSlots,
            skippedRanges: enumerationComplete
              ? compactSkippedSlots(slotRange.startInclusive, producedSlots, slotRange.endInclusive)
              : [],
            unavailableSlots,
            unresolvedSlots: enumerationComplete
              ? producedSlots.filter(slot =>
                !points.some(point => point.slot === slot) && !unavailableSlots.includes(slot))
              : [],
            points: points.map(({slot, blockTime}) => ({slot, blockTime}))
          },
          counters: {
            ...counters,
            workUnits: counters.workUnits + enumerationWork
          }
        });
      }
    }
  });
}

function eventSetValid(events, methodSet, limits, minimumReceivedAt) {
  if (!Array.isArray(events) || events.length < 1 ||
      events.length > limits.maxRequests) return null;
  let bytes = 0;
  let latestReceivedAt = 0;
  for (const event of events) {
    if (!isRecord(event) || !methodSet.has(event.method) ||
        event.origin !== SOLANA_RPC_ORIGIN ||
        event.status !== "RESPONSE_RECEIVED" ||
        !DIGEST.test(event.responseSha256 ?? "") ||
        !Number.isSafeInteger(event.responseBytes) || event.responseBytes < 0 ||
        event.responseBytes > limits.maxBytesPerResponse ||
        !validTime(event.requestStartedAt) || !validTime(event.responseReceivedAt) ||
        event.responseReceivedAt < event.requestStartedAt ||
        event.responseReceivedAt < minimumReceivedAt) return null;
    bytes += event.responseBytes;
    if (!Number.isSafeInteger(bytes) || bytes > limits.maxBytesPerRun) return null;
    latestReceivedAt = Math.max(latestReceivedAt, event.responseReceivedAt);
  }
  return {bytes, latestReceivedAt};
}

function collectorIsBound(collector, identity, interval, limits, minimumReceivedAt) {
  if (!isRecord(collector) ||
      collector.sourceVersion !== LAUNCH_HISTORY_SOURCE_VERSION ||
      collector.source !== RPC_SOURCE || collector.rpcOrigin !== SOLANA_RPC_ORIGIN ||
      collector.commitment !== "finalized" ||
      !Array.isArray(collector.declaredSubjects) ||
      collector.declaredSubjects.length !== 1 ||
      collector.declaredSubjects[0]?.address !== identity.pool ||
      !isRecord(collector.slotInterval) ||
      collector.slotInterval.startInclusive > interval.startInclusive ||
      collector.slotInterval.endInclusive < interval.endInclusive ||
      collector.coverage?.scope !== "declared-subjects-and-inclusive-slot-interval-only" ||
      !Number.isSafeInteger(collector.slotInterval.startInclusive) ||
      !Number.isSafeInteger(collector.slotInterval.endInclusive) ||
      collector.slotInterval.startInclusive < 0 ||
      collector.slotInterval.endInclusive < collector.slotInterval.startInclusive ||
      collector.coverage?.complete !== true ||
      collector.coverage?.signaturePagesComplete !== true ||
      collector.coverage?.successfulTransactionRetrievalComplete !== true ||
      collector.coverage?.terminationReason !== "DECLARED_INTERVAL_COVERED" ||
      collector.coverage?.finalizedAnchor?.status !== "CAPTURED" ||
      collector.coverage.finalizedAnchor.slot < interval.endInclusive ||
      collector.coverage?.sourceHistoryCompleteness !== "COMPLETE" ||
      collector.coverage?.subjects?.length !== 1 ||
      collector.coverage.subjects[0]?.address !== identity.pool ||
      collector.coverage.subjects[0]?.signatureCoverageComplete !== true ||
      !["SOURCE_EXHAUSTED", "LOWER_SLOT_BOUND_REACHED"].includes(
        collector.coverage.subjects[0]?.terminationReason) ||
      !Array.isArray(collector.signatures) ||
      !Array.isArray(collector.transactions) ||
      !isRecord(collector.counters)) return null;
  const events = eventSetValid(
    collector.events, COLLECTOR_METHODS, limits, minimumReceivedAt
  );
  if (!events || collector.counters.requests !== collector.events.length ||
      collector.counters.bytes !== events.bytes ||
      !Number.isSafeInteger(collector.counters.workUnits) ||
      collector.counters.workUnits < collector.counters.requests ||
      collector.counters.workUnits > limits.maxWorkUnits ||
      collector.counters.signatures !== collector.signatures.length ||
      collector.counters.successfulTransactions !== collector.transactions.length ||
      collector.counters.signatures > limits.maxSignatures ||
      collector.counters.successfulTransactions > limits.maxTransactions) return null;
  return events;
}

function validateCollectorRows(collector, identity, interval, timeEvidence, requested) {
  const produced = new Map(timeEvidence.slotEnumeration.points.map(point =>
    [point.slot, point.blockTime * 1_000]));
  const signatures = new Map();
  for (const row of collector.signatures) {
    if (!isRecord(row) || typeof row.signature !== "string" || !row.signature ||
        signatures.has(row.signature) || !Number.isSafeInteger(row.slot) ||
        !Array.isArray(row.subjectAddresses) || row.subjectAddresses.length !== 1 ||
        row.subjectAddresses[0] !== identity.pool) return null;
    signatures.set(row.signature, row);
  }
  if (collector.transactions.length !== [...signatures.values()].filter(row =>
    row.err === null && row.errorStatus === null &&
    row.slot >= interval.startInclusive && row.slot <= interval.endInclusive).length) return null;
  const transactions = [];
  let previousSlot = -1;
  let previousTime = -1;
  const seen = new Set();
  for (const row of collector.transactions) {
    const signature = signatures.get(row?.signature);
    const observedAt = slotSeconds(row);
    const enumeratedTime = produced.get(row?.slot);
    if (!isRecord(row) || !signature || seen.has(row.signature) ||
        row.status !== "SUCCESS" || row.slot !== signature.slot ||
        signature.err !== null || signature.errorStatus !== null ||
        (signature.blockTime !== null && signature.blockTime !== row.blockTime) ||
        !Array.isArray(row.subjectAddresses) ||
        row.subjectAddresses.length !== 1 || row.subjectAddresses[0] !== identity.pool ||
        !Number.isSafeInteger(row.slot) || row.slot < previousSlot ||
        row.slot < interval.startInclusive || row.slot > interval.endInclusive ||
        !isRecord(row.transaction) || !isRecord(row.meta) ||
        observedAt === null || observedAt !== enumeratedTime ||
        observedAt < previousTime) return null;
    previousSlot = row.slot;
    previousTime = observedAt;
    seen.add(row.signature);
    if (observedAt > requested.startExclusiveMs &&
        observedAt <= requested.endInclusiveMs) {
      transactions.push({...row, observedAt});
    }
  }
  return transactions;
}

function sharedLimits(limits, counters, elapsedMs) {
  const maxRequests = limits.maxRequests - counters.requests;
  const maxBytesPerRun = limits.maxBytesPerRun - counters.bytes;
  const maxWorkUnits = limits.maxWorkUnits - counters.workUnits;
  const maxDurationMs = Math.floor(limits.maxElapsedMs - elapsedMs);
  if (maxRequests < 1 || maxBytesPerRun < 1 || maxWorkUnits < 1 || maxDurationMs < 1) {
    return null;
  }
  return {
    maxRequests,
    maxBytesPerResponse: Math.min(limits.maxBytesPerResponse, maxBytesPerRun),
    maxBytesPerRun,
    maxWorkUnits,
    maxSignatures: limits.maxSignatures,
    maxTransactions: limits.maxTransactions,
    maxDurationMs,
    requestTimeoutMs: Math.min(limits.requestTimeoutMs, maxDurationMs)
  };
}

function waitForCollector(callback, request, signal, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const controller = new AbortController();
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
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

export function createHistoryWindowSource({
  enabled = false,
  timeBoundarySource,
  slotHistoryCollector,
  clock,
  limits: suppliedLimits = {}
} = {}) {
  const limits = resolveLimits(suppliedLimits);
  if (enabled && (typeof timeBoundarySource?.readWindow !== "function" ||
      typeof slotHistoryCollector !== "function" || typeof clock !== "function")) {
    throw new TypeError("enabled history-window source requires injected boundary, collector, and clock interfaces");
  }
  return Object.freeze({
    async readWindow({
      identity,
      poolProof,
      startExclusiveMs,
      endInclusiveMs,
      signal
    } = {}) {
      const requested = {startExclusiveMs, endInclusiveMs};
      if (!enabled) return unavailable(identity, requested, "DISABLED");
      if (signal?.aborted) return unavailable(identity, requested, "CANCELLED");
      if (!identityValid(identity) || !validTime(startExclusiveMs) ||
          !validTime(endInclusiveMs) || startExclusiveMs >= endInclusiveMs ||
          !validPoolProof(poolProof, identity, requested)) {
        return unavailable(identity, requested, "INVALID_OR_UNBOUND_REQUEST");
      }
      const startedMonotonic = performance.now();
      let timeEvidence;
      try {
        timeEvidence = await timeBoundarySource.readWindow({
          identity: {...identity},
          requested: {...requested},
          poolProof,
          limits,
          signal
        });
      } catch {
        return unavailable(identity, requested, "TIME_BOUNDARY_UNKNOWN");
      }
      const validatedTime = validateEnumeration(
        timeEvidence, identity, requested, limits, timeEvidence?.slotRange
      );
      if (!validatedTime) {
        return unavailable(identity, requested, "TIME_BOUNDARY_RECEIPT_UNKNOWN",
          attemptDetails(timeEvidence));
      }
      const interval = {
        startInclusive: validatedTime.startExclusive.before.slot,
        endInclusive: validatedTime.endInclusive.after.slot
      };
      const boundaryCounters = timeEvidence.counters;
      const elapsedMs = performance.now() - startedMonotonic;
      const collectorLimits = sharedLimits(limits, boundaryCounters, elapsedMs);
      if (!collectorLimits) {
        return unavailable(identity, requested, "SHARED_BUDGET_EXHAUSTED",
          attemptDetails(timeEvidence));
      }
      const collectorOutcome = await waitForCollector(slotHistoryCollector, {
        identity: {...identity},
        requested: {...requested},
        poolProof,
        subjects: [{
          address: identity.pool,
          source: poolProof.source,
          evidenceId: poolProof.receipt.id
        }],
        startSlot: interval.startInclusive,
        endSlot: interval.endInclusive,
        limits: collectorLimits
      }, signal, collectorLimits.maxDurationMs);
      if (collectorOutcome.status !== "RESULT") {
        return unavailable(identity, requested, collectorOutcome.status,
          attemptDetails(timeEvidence));
      }
      const collector = collectorOutcome.value;
      const collectorEvents = collectorIsBound(
        collector, identity, interval, limits, endInclusiveMs
      );
      if (!collectorEvents) {
        return unavailable(
          identity,
          requested,
          collector?.coverage?.sourceHistoryCompleteness ===
            "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION"
            ? "COLLECTOR_HISTORY_COMPLETENESS_UNKNOWN"
            : "COLLECTOR_COVERAGE_OR_RECEIPT_UNKNOWN",
          {
            ...attemptDetails(timeEvidence, collector),
            sourceHistoryCompleteness:
              collector?.coverage?.sourceHistoryCompleteness ?? "UNKNOWN"
          }
        );
      }
      if (collector.counters.requests + boundaryCounters.requests > limits.maxRequests ||
          collector.counters.bytes + boundaryCounters.bytes > limits.maxBytesPerRun ||
          collector.counters.workUnits + boundaryCounters.workUnits > limits.maxWorkUnits ||
          performance.now() - startedMonotonic > limits.maxElapsedMs) {
        return unavailable(identity, requested, "SHARED_BUDGET_EXHAUSTED",
          attemptDetails(timeEvidence, collector));
      }
      if (collector.slotInterval.startInclusive > interval.startInclusive ||
          collector.slotInterval.endInclusive < interval.endInclusive) {
        return unavailable(identity, requested, "COLLECTED_SLOT_INTERVAL_TOO_NARROW",
          attemptDetails(timeEvidence, collector));
      }
      const transactions = validateCollectorRows(
        collector, identity, interval, timeEvidence, requested
      );
      if (!transactions) {
        return unavailable(identity, requested, "TRANSACTION_TIMESTAMP_OR_ORDER_UNKNOWN",
          attemptDetails(timeEvidence, collector));
      }
      const sourceReceipts = {
        timeBoundaries: timeEvidence.events,
        collector: collector.events
      };
      const receiptPayload = {
        schema: HISTORY_WINDOW_BRIDGE_VERSION,
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
        sourceReceipts,
        counters: {
          requests: boundaryCounters.requests + collector.counters.requests,
          bytes: boundaryCounters.bytes + collector.counters.bytes,
          workUnits: boundaryCounters.workUnits + collector.counters.workUnits
        },
        collectorCoverage: collector.coverage,
        timeBounds: timeEvidence.timeBounds,
        slotEnumeration: timeEvidence.slotEnumeration,
        timeEvidenceReceipt: timeEvidence.receipt
      };
      const payloadSha256 = digest(receiptPayload);
      const receivedAt = clock();
      const latestEventAt = Math.max(
        ...timeEvidence.events.map(event => event.responseReceivedAt),
        ...collector.events.map(event => event.responseReceivedAt)
      );
      if (!validTime(receivedAt) || receivedAt < endInclusiveMs ||
          receivedAt < latestEventAt) {
        return unavailable(identity, requested, "INVALID_RECEIPT_TIME");
      }
      return {
        status: "COMPLETE",
        source: collector.source,
        sourceVersion: HISTORY_WINDOW_BRIDGE_VERSION,
        identity: {...identity},
        requested: {...requested},
        transactions,
        receipt: {
          status: "SOURCE_BOUND",
          id: `${HISTORY_WINDOW_BRIDGE_VERSION}:${payloadSha256.slice(0, 24)}`,
          source: collector.source,
          payloadSha256,
          receivedAt
        },
        sourceReceipts,
        counters: receiptPayload.counters,
        coverage: {
          complete: true,
          truncated: false,
          cursorExhausted: true,
          sourceHistoryCompleteness: "COMPLETE",
          sourceAuthentication: "NOT_ESTABLISHED",
          archivalRetention: "NOT_ESTABLISHED",
          slotInterval: {...collector.slotInterval},
          slotEnumeration: {
            producedSlots: timeEvidence.slotEnumeration.producedSlots.length,
            skippedRanges: timeEvidence.slotEnumeration.skippedRanges
          }
        }
      };
    }
  });
}
