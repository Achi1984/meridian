import {
  timestampEvidenceDigest
} from "./history-window-bridge.mjs";
import {
  createBoundedHistoryRpcReader,
  DEFAULT_LAUNCH_HISTORY_LIMITS,
  LAUNCH_HISTORY_SOURCE_VERSION,
  SOLANA_RPC_ORIGIN
} from "./launch-history-source.mjs";

export const TIME_BOUNDARY_SOURCE_VERSION = "solana-time-boundary-source-v1";

const RPC_SOURCE = "Solana JSON-RPC";
const DIGEST = /^[a-f0-9]{64}$/;
const DEFAULT_LIMITS = Object.freeze({
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
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

function slotRangeValid(range) {
  return isRecord(range) && Number.isSafeInteger(range.startInclusive) &&
    range.startInclusive >= 0 && Number.isSafeInteger(range.endInclusive) &&
    range.endInclusive >= range.startInclusive;
}

function resolveLimits(input = {}) {
  if (!isRecord(input) || Reflect.ownKeys(input).some(key =>
    typeof key !== "string" || !Object.hasOwn(DEFAULT_TIME_BOUNDARY_LIMITS, key))) {
    throw new TypeError("invalid bounded history-window limits");
  }
  const limits = {...DEFAULT_TIME_BOUNDARY_LIMITS, ...input};
  for (const [key, maximum] of Object.entries({
    ...HARD_LIMITS,
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
  })) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 ||
        limits[key] > maximum) {
      throw new TypeError(`${key} is outside the fixed history-window limit`);
    }
  }
  if (limits.maxBytesPerResponse > limits.maxBytesPerRun) {
    throw new TypeError("history-window response/run limits are inconsistent");
  }
  return Object.freeze(limits);
}

function limitsFromBridge(configured, input) {
  if (input === undefined) return configured;
  if (!isRecord(input)) throw new TypeError("invalid bridge limits");
  const mapped = {...input};
  if (Object.hasOwn(mapped, "maxResponseBytes")) {
    mapped.maxBytesPerResponse = mapped.maxResponseBytes;
    delete mapped.maxResponseBytes;
  }
  if (Object.hasOwn(mapped, "maxBytes")) {
    mapped.maxBytesPerRun = mapped.maxBytes;
    delete mapped.maxBytes;
  }
  return resolveLimits({...configured, ...mapped});
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
      sourceHistoryCompleteness: "UNKNOWN",
      sourceAuthentication: "NOT_ESTABLISHED"
    },
    ...details
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

function slotMilliseconds(blockTime) {
  if (!Number.isSafeInteger(blockTime) || blockTime < 0) return null;
  const observedAt = blockTime * 1_000;
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

function validRpcEvent(event, method, params) {
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

function validEnumeration(points, producedSlots, slotRange) {
  if (points.length !== producedSlots.length) return false;
  let previousSlot = slotRange.startInclusive - 1;
  let previousTime = -1;
  for (let index = 0; index < producedSlots.length; index += 1) {
    const point = points[index];
    if (!Number.isSafeInteger(point.slot) ||
        point.slot !== producedSlots[index] ||
        point.slot <= previousSlot ||
        point.slot > slotRange.endInclusive ||
        !Number.isSafeInteger(point.blockTime) ||
        slotMilliseconds(point.blockTime) === null ||
        point.observedAt !== slotMilliseconds(point.blockTime) ||
        point.observedAt < previousTime) return false;
    previousSlot = point.slot;
    previousTime = point.observedAt;
  }
  return true;
}

export function createTimeBoundarySource({
  enabled = false,
  slotRange,
  transport,
  clock,
  limits: suppliedLimits = {}
} = {}) {
  const configuredLimits = resolveLimits(suppliedLimits);
  if (enabled && (!slotRangeValid(slotRange) ||
      slotRange.endInclusive - slotRange.startInclusive + 1 >
        configuredLimits.maxBoundarySlotSpan ||
      typeof transport !== "function" || typeof clock !== "function")) {
    throw new TypeError(
      "enabled time-boundary source requires an explicit bounded slot range, transport, and clock"
    );
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
          poolProof.slot < slotRange.startInclusive ||
          poolProof.slot > slotRange.endInclusive) {
        return unavailable(identity, request, "INVALID_OR_UNBOUND_REQUEST");
      }

      let limits;
      try {
        limits = limitsFromBridge(configuredLimits, requestLimits);
      } catch {
        return unavailable(identity, request, "INVALID_LIMITS");
      }
      const span = slotRange.endInclusive - slotRange.startInclusive + 1;
      if (span + 2 > limits.maxWorkUnits) {
        return unavailable(identity, request, "WORK_LIMIT");
      }
      const readerLimits = Object.fromEntries(
        Object.keys(DEFAULT_LAUNCH_HISTORY_LIMITS)
          .map(key => [key, limits[key]])
      );
      const startedMonotonic = performance.now();
      const reader = createBoundedHistoryRpcReader({
        transport,
        clock,
        signal,
        limits: readerLimits,
        maxDurationMs: Math.min(limits.maxDurationMs, limits.maxElapsedMs)
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
        if (counters.elapsedMs >= limits.maxElapsedMs ||
            counters.requests >= limits.maxRequests ||
            counters.workUnits >= limits.maxWorkUnits) {
          throw new Error("TIME_OR_WORK_LIMIT");
        }
        const outcome = await reader.read({method, params, signal});
        if (!outcome.ok || !validRpcEvent(outcome.event, method, params)) {
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
        const enumerated = await read("getBlocks", [
          slotRange.startInclusive,
          slotRange.endInclusive,
          {commitment: "finalized"}
        ]);
        if (!Array.isArray(enumerated)) throw new Error("BLOCK_ENUMERATION_UNKNOWN");
        enumerationWork = span;
        let previous = slotRange.startInclusive - 1;
        for (const slot of enumerated) {
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
          const observedAt = slotMilliseconds(blockTime);
          if (observedAt === null) {
            unavailableSlots.push(slot);
            throw new Error(blockTime === null
              ? "BLOCK_TIME_UNAVAILABLE" : "BLOCK_TIME_INVALID");
          }
          if (points.length > 0 && observedAt < points.at(-1).observedAt) {
            unavailableSlots.push(slot);
            throw new Error("BLOCK_TIME_REGRESSION");
          }
          points.push({slot, blockTime, observedAt});
        }
        if (!validEnumeration(points, producedSlots, slotRange)) {
          throw new Error("BLOCK_ENUMERATION_INVALID");
        }
        const timeBounds = {
          receiptId: `${TIME_BOUNDARY_SOURCE_VERSION}:${slotRange.startInclusive}:${slotRange.endInclusive}`,
          startExclusive: boundaryFor(points, request.startExclusiveMs),
          endInclusive: boundaryFor(points, request.endInclusiveMs)
        };
        if (!timeBounds.startExclusive || !timeBounds.endInclusive) {
          throw new Error("SLOT_RANGE_DOES_NOT_COVER_TIME_WINDOW");
        }
        const readerCounters = reader.counters();
        const workUnits = readerCounters.workUnits + span;
        if (workUnits > limits.maxWorkUnits ||
            readerCounters.bytes > limits.maxBytesPerRun ||
            performance.now() - startedMonotonic > limits.maxElapsedMs) {
          throw new Error("SHARED_BUDGET_EXHAUSTED");
        }
        const timestampEvents = events.filter(event => event.method === "getBlockTime");
        const auxiliaryEvents = events.filter(event => event.method !== "getBlockTime");
        const timestampBytes = timestampEvents.reduce(
          (total, event) => total + event.responseBytes, 0
        );
        const auxiliaryBytes = auxiliaryEvents.reduce(
          (total, event) => total + event.responseBytes, 0
        );
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
          timeBounds,
          coverage: {
            complete: true,
            monotonicSlots: true,
            scope: "selected-pool-inclusive-slot-range",
            skippedSlotsAccounted: true,
            sourceAuthentication: "NOT_ESTABLISHED",
            slotRange: {...slotRange},
            finalizedAnchor: {slot: finalizedSlot, commitment: "finalized"},
            slotEnumeration: {
              enumerationComplete: true,
              producedSlots,
              skippedRanges: compactSkippedSlots(
                slotRange.startInclusive, producedSlots, slotRange.endInclusive
              ),
              unavailableSlots,
              unresolvedSlots: [],
              points
            },
            auxiliaryEvents,
            auxiliaryCounters: {
              requests: auxiliaryEvents.length,
              bytes: auxiliaryBytes,
              workUnits: auxiliaryEvents.length
            }
          },
          events: timestampEvents,
          counters: {
            requests: timestampEvents.length,
            bytes: timestampBytes,
            workUnits
          },
          receipt: null
        };
        const payloadSha256 = timestampEvidenceDigest(evidence);
        evidence.receipt = {
          status: "SOURCE_BOUND",
          id: timeBounds.receiptId,
          source: RPC_SOURCE,
          payloadSha256,
          receivedAt
        };
        return evidence;
      } catch (error) {
        const readerCounters = reader.counters();
        return unavailable(identity, request, error?.message ?? "TIME_BOUNDARY_UNKNOWN", {
          timeBoundaryEvents: events,
          slotEnumeration: {
            enumerationComplete,
            producedSlots,
            skippedRanges: enumerationComplete
              ? compactSkippedSlots(
                slotRange.startInclusive, producedSlots, slotRange.endInclusive
              )
              : [],
            unavailableSlots,
            unresolvedSlots: enumerationComplete
              ? producedSlots.filter(slot =>
                !points.some(point => point.slot === slot) && !unavailableSlots.includes(slot))
              : [],
            points
          },
          counters: {
            ...readerCounters,
            workUnits: readerCounters.workUnits + enumerationWork
          }
        });
      }
    }
  });
}
