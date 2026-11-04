import {adaptMarketEvidence} from "./market-evidence-adapter.mjs";
import {
  buildAnalystWindowEvidence,
  evaluateWithCanonicalMarketAdapter
} from "./analyst-window-evidence.mjs";
import {
  createHistoryWindowSource
} from "./history-window-bridge.mjs";
import {acquireLaunchHistory} from "./launch-history-source.mjs";
import {
  DEFAULT_TIME_BOUNDARY_LIMITS,
  createTimeBoundarySource
} from "./history-time-boundary-source.mjs";

export const PAPER_SOURCE_PIPELINE_VERSION = "paper-source-pipeline-v1";

const MODES = new Set(["SYNTHETIC_TEST_ONLY", "EXTERNAL_READ_ONLY_INPUT"]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTime(value) {
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isFinite(new Date(value).getTime());
}

function budgetedTransport(transport, budget) {
  if (!budget || typeof budget.reserveRequest !== "function" ||
      typeof transport !== "function") return transport;
  return async (request, options) => {
    const chargeBytes = budget.reserveRequest();
    const response = await transport(request, options);
    if (!response?.body?.getReader) return response;
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const {done, value} = await reader.read();
          if (done) {
            controller.close();
            reader.releaseLock();
            return;
          }
          chargeBytes(value.byteLength);
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          void reader.cancel(error).catch(() => {});
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });
    return {
      status: response.status,
      headers: response.headers,
      redirected: response.redirected,
      url: response.url,
      body
    };
  };
}

function serializedBytes(value) {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? Buffer.byteLength(serialized) : 0;
  } catch {
    return null;
  }
}

function containsFixtureTrust(value, seen = new WeakSet(), budget = {nodes: 0}) {
  if (value === "SYNTHETIC_FIXTURE_ONLY") return true;
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  budget.nodes += 1;
  if (budget.nodes > 50_000) return true;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) return true;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.values(descriptors).some(descriptor =>
    !Object.hasOwn(descriptor, "value") ||
    containsFixtureTrust(descriptor.value, seen, budget));
}

function withoutFixtureResults(source, method) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, method);
  if (!descriptor || !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "function") return null;
  const read = descriptor.value;
  return Object.freeze({
    async [method](request) {
      try {
        const result = await read.call(source, request);
        return containsFixtureTrust(result) ? null : result;
      } catch {
        return null;
      }
    }
  });
}

function unavailable(reason, request = {}) {
  return {
    status: "UNKNOWN",
    reason,
    candidateT: request.candidateT ?? null,
    assembledAt: request.assembledAt ?? null,
    decisionAt: request.decisionAt ?? null,
    holdUntil: request.holdUntil ?? null,
    candidate: null,
    analystEvidence: null,
    auditReceipts: {pool: null, history: null, acquisition: []},
    executionAuthorized: false,
    realDataEntryEligible: false
  };
}

function awaitBounded(operation, evaluation) {
  const {signal, deadlineAt, isCurrent, abort} = evaluation;
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error("source evaluation cancelled"), {
      code: signal.reason?.code ?? "CANCELLED"
    }));
  }
  const remainingMs = deadlineAt - performance.now();
  if (remainingMs <= 0) {
    abort("DEADLINE");
    return Promise.reject(Object.assign(new Error("source evaluation deadline reached"), {
      code: "DEADLINE"
    }));
  }
  let timer;
  let abortListener;
  const pending = Promise.resolve().then(() => {
    if (!isCurrent()) {
      throw Object.assign(new Error("source evaluation cancelled"), {code: "CANCELLED"});
    }
    return operation();
  }).then(value => {
    if (performance.now() >= deadlineAt) abort("DEADLINE");
    if (!isCurrent()) {
      throw Object.assign(new Error("source evaluation stopped"), {
        code: signal.reason?.code ?? "CANCELLED"
      });
    }
    return value;
  });
  void pending.catch(() => {});
  const stopped = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abort("DEADLINE");
      reject(Object.assign(new Error("source evaluation deadline reached"), {
        code: "DEADLINE"
      }));
    }, remainingMs);
    if (signal) {
      abortListener = () => reject(Object.assign(new Error("source evaluation stopped"), {
        code: signal.reason?.code ?? "CANCELLED"
      }));
      signal.addEventListener("abort", abortListener, {once: true});
      if (signal.aborted) abortListener();
    }
  });
  return Promise.race([pending, stopped]).finally(() => {
    clearTimeout(timer);
    if (abortListener) signal.removeEventListener("abort", abortListener);
  });
}

function bridgeLimitsFor(limits) {
  const reservedRequests = 2;
  const bridgeBytes = Math.max(
    1, limits.maxBytesPerRun - reservedRequests * limits.maxBytesPerResponse
  );
  return {
    maxRequests: Math.max(1, limits.maxRequests - reservedRequests),
    maxResponseBytes: Math.min(limits.maxBytesPerResponse, bridgeBytes),
    maxBytes: bridgeBytes,
    maxWorkUnits: limits.maxWorkUnits,
    maxSignatures: limits.maxSignatures,
    maxTransactions: limits.maxTransactions,
    maxBoundarySlotSpan: limits.maxBoundarySlotSpan,
    maxElapsedMs: limits.maxElapsedMs
  };
}

function receiptSummary(result, timeEvidence, collector) {
  const boundaryCounters = timeEvidence?.counters;
  const auxiliaryCounters = timeEvidence?.status === "SOURCE_BOUND"
    ? timeEvidence.coverage?.auxiliaryCounters : null;
  const collectorCounters = collector?.counters;
  const counters = isRecord(boundaryCounters) && isRecord(collectorCounters)
    ? {
        requests: boundaryCounters.requests + (auxiliaryCounters?.requests ?? 0) +
          collectorCounters.requests,
        bytes: boundaryCounters.bytes + (auxiliaryCounters?.bytes ?? 0) +
          collectorCounters.bytes,
        workUnits: boundaryCounters.workUnits + collectorCounters.workUnits
      }
    : isRecord(boundaryCounters) ? {
        requests: boundaryCounters.requests + (auxiliaryCounters?.requests ?? 0),
        bytes: boundaryCounters.bytes + (auxiliaryCounters?.bytes ?? 0),
        workUnits: boundaryCounters.workUnits
      } : result?.counters ?? null;
  return {
    status: result?.status ?? "UNKNOWN",
    reason: result?.reason ?? (result ? null : "HISTORY_SOURCE_RETURNED_NO_RESULT"),
    source: result?.source ?? null,
    receipt: result?.receipt ?? null,
    coverage: result?.coverage ?? null,
    counters,
    sourceReceipts: {
      timeBoundaries: timeEvidence?.events ?? timeEvidence?.timeBoundaryEvents ??
        result?.sourceReceipts?.timeBoundaries ?? [],
      collector: collector?.events ?? result?.sourceReceipts?.collector ?? result?.events ?? []
    },
    timeBoundaryCoverage: timeEvidence?.coverage ?? result?.timeBoundaryCoverage ?? null,
    collectorCoverage: collector?.coverage ?? result?.collectorCoverage ?? result?.coverage ?? null
  };
}

function cachedSource(source, method, keyOf, evaluation, budget) {
  const cache = new Map();
  const descriptor = source && Object.getOwnPropertyDescriptor(source, method);
  const read = descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : null;
  if (typeof read !== "function") return null;
  return Object.freeze({
    async [method](request) {
      if (!evaluation.isCurrent()) return null;
      let key;
      try {
        key = keyOf(request);
      } catch {
        return null;
      }
      if (!cache.has(key)) {
        cache.set(key, Promise.resolve().then(async () => {
          if (!evaluation.isCurrent()) return null;
          const chargeBytes = budget?.reserveRequest?.();
          if (budget && !chargeBytes) return null;
          const result = await read.call(source, {...request, signal: evaluation.signal});
          if (!evaluation.isCurrent()) return null;
          const bytes = serializedBytes(result);
          if (bytes === null) return null;
          chargeBytes?.(bytes);
          return result;
        }));
      }
      try {
        const result = await cache.get(key);
        return evaluation.isCurrent() ? result : null;
      } catch {
        return null;
      }
    }
  });
}

function createHistorySource({
  enabled,
  timeBoundarySource,
  collector,
  limits,
  acquisition,
  evaluation,
  budget,
  customCollector
}) {
  const observedTimeBoundarySource = Object.freeze({
    async readWindow(request) {
      const result = await timeBoundarySource.readWindow({
        ...request,
        signal: evaluation.signal
      });
      if (evaluation.isCurrent()) acquisition.timeEvidence = result;
      return result;
    }
  });
  const observedCollector = async request => {
    const chargeBytes = customCollector ? budget?.reserveRequest?.() : null;
    if (customCollector && budget && !chargeBytes) return null;
    const result = await collector({...request, signal: evaluation.signal, budget});
    if (customCollector && chargeBytes) {
      const bytes = serializedBytes(result);
      if (bytes === null) return null;
      chargeBytes(bytes);
    }
    if (evaluation.isCurrent()) acquisition.collector = result;
    return result;
  };
  return createHistoryWindowSource({
    enabled,
    timeBoundarySource: observedTimeBoundarySource,
    slotHistoryCollector: observedCollector,
    limits
  });
}

export function createPaperSourcePipeline({
  enabled = false,
  mode = "EXTERNAL_READ_ONLY_INPUT",
  slotRange,
  transport,
  clock,
  limits = {},
  historySlotCollector,
  budget
} = {}) {
  if (!MODES.has(mode)) throw new TypeError("paper source pipeline mode is unsupported");
  if (historySlotCollector !== undefined &&
      (mode !== "SYNTHETIC_TEST_ONLY" || typeof historySlotCollector !== "function")) {
    throw new TypeError("custom history collectors are limited to synthetic test mode");
  }
  const boundedTransport = budgetedTransport(transport, budget);
  const timeBoundarySource = createTimeBoundarySource({
    enabled,
    slotRange,
    transport: boundedTransport,
    clock,
    limits
  });
  const collector = historySlotCollector ?? (request => acquireLaunchHistory({
    subjects: request.subjects,
    startSlot: request.startSlot,
    endSlot: request.endSlot,
    transport: boundedTransport,
    clock,
    signal: request.signal,
    limits: request.limits
  }));
  const reportedLimits = Object.freeze({...DEFAULT_TIME_BOUNDARY_LIMITS, ...limits});
  let evaluationActive = false;
  let evaluationGeneration = 0;

  return Object.freeze({
    enabled,
    mode,
    async evaluate({
      providerCandidate,
      evidence = {},
      candidateT = providerCandidate?.sampledAt,
      assembledAt,
      decisionAt,
      policy,
      poolProof,
      censusSource,
      priceSource,
      marketPairEvidence,
      smartWalletAllowlist,
      reviewEvidence = {},
      holdUntil = null,
      signal
    } = {}) {
      if (!enabled) return unavailable("DISABLED");
      if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" ||
          typeof signal.addEventListener !== "function" ||
          typeof signal.removeEventListener !== "function")) {
        return unavailable("INVALID_ABORT_SIGNAL", {candidateT, assembledAt, decisionAt, holdUntil});
      }
      if (signal?.aborted) {
        return unavailable("CANCELLED", {candidateT, assembledAt, decisionAt, holdUntil});
      }
      if (evaluationActive) return unavailable("EVALUATION_IN_PROGRESS", {
        candidateT, assembledAt, decisionAt, holdUntil
      });
      evaluationActive = true;
      const generation = ++evaluationGeneration;
      const controller = new AbortController();
      const runFence = {
        signal: controller.signal,
        deadlineAt: performance.now() + reportedLimits.maxElapsedMs,
        isCurrent: () => evaluationActive && evaluationGeneration === generation &&
          !controller.signal.aborted,
        abort: code => {
          if (!controller.signal.aborted) {
            controller.abort(Object.assign(new Error(
              code === "DEADLINE" ? "source evaluation deadline reached" :
                "source evaluation cancelled"
            ), {code}));
          }
        }
      };
      const callerAbort = () => runFence.abort(
        signal?.reason?.code === "DEADLINE" ? "DEADLINE" : "CANCELLED"
      );
      if (signal) {
        signal.addEventListener("abort", callerAbort, {once: true});
        if (signal.aborted) callerAbort();
      }
      const deadlineTimer = setTimeout(
        () => runFence.abort("DEADLINE"),
        Math.max(0, runFence.deadlineAt - performance.now())
      );
      try {
        if (typeof clock !== "function" || !isRecord(providerCandidate) ||
            !validTime(candidateT) || providerCandidate.sampledAt !== candidateT ||
            !isRecord(evidence) || !isRecord(reviewEvidence)) {
          return unavailable("INVALID_PIPELINE_REQUEST", {
            candidateT, assembledAt, decisionAt, holdUntil
          });
        }
        if (mode === "EXTERNAL_READ_ONLY_INPUT" &&
            providerCandidate.source === "SYNTHETIC_FIXTURE_ONLY") {
          return unavailable("SYNTHETIC_FIXTURE_NOT_ALLOWED_IN_EXTERNAL_MODE", {
            candidateT, assembledAt, decisionAt, holdUntil
          });
        }
        if (mode === "EXTERNAL_READ_ONLY_INPUT" &&
            containsFixtureTrust({
              providerCandidate,
              evidence,
              policy,
              poolProof,
              marketPairEvidence,
              smartWalletAllowlist
            })) {
          return unavailable("SYNTHETIC_FIXTURE_NOT_ALLOWED_IN_EXTERNAL_MODE", {
            candidateT, assembledAt, decisionAt, holdUntil
          });
        }

        const identity = {
          chainId: providerCandidate.chainId,
          mint: providerCandidate.mint,
          pool: providerCandidate.pool,
          quote: providerCandidate.quote
        };
        const acceptedReviewEvidence = mode === "SYNTHETIC_TEST_ONLY" ? reviewEvidence : {};
        const acquisitionReceipts = [];
        const acquisition = {timeEvidence: null, collector: null};
        const historySource = createHistorySource({
          enabled,
          timeBoundarySource,
          collector,
          limits: bridgeLimitsFor(reportedLimits),
          acquisition,
          evaluation: runFence,
          budget,
          customCollector: Boolean(historySlotCollector)
        });
        let prefetchedHistory = null;
        if (isRecord(policy) && policy.windowsMs?.swaps1h === 3_600_000 &&
            isRecord(poolProof)) {
          try {
            prefetchedHistory = await awaitBounded(() => historySource.readWindow({
              identity,
              poolProof,
              startExclusiveMs: candidateT - policy.windowsMs.swaps1h,
              endInclusiveMs: candidateT,
              signal: runFence.signal
            }), runFence);
          } catch (error) {
            if (error?.code === "CANCELLED" || error?.code === "DEADLINE" ||
                !runFence.isCurrent()) {
              return unavailable(controller.signal.reason?.code ?? error?.code ?? "CANCELLED", {
                candidateT, holdUntil
              });
            }
            prefetchedHistory = null;
          }
          if (!runFence.isCurrent()) {
            return unavailable(controller.signal.reason?.code ?? "CANCELLED", {
              candidateT, holdUntil
            });
          }
          acquisitionReceipts.push(receiptSummary(
            prefetchedHistory, acquisition.timeEvidence, acquisition.collector
          ));
        }

        const sourceAssembly = clock();
        if (!validTime(sourceAssembly) || sourceAssembly < candidateT) {
          return unavailable("INVALID_SOURCE_PREFETCH_CLOCK", {
            candidateT, assembledAt: sourceAssembly, holdUntil
          });
        }
        const prefetchPriceSource = mode === "EXTERNAL_READ_ONLY_INPUT"
          ? withoutFixtureResults(priceSource, "readObservation") : priceSource;
        const prefetchCensusSource = mode === "EXTERNAL_READ_ONLY_INPUT"
          ? withoutFixtureResults(censusSource, "readSnapshots") : censusSource;
        const cachedPriceSource = cachedSource(
          prefetchPriceSource,
          "readObservation",
          request => JSON.stringify([
            identity.chainId,
            identity.mint,
            identity.pool,
            identity.quote,
            request?.mint,
            request?.atMs,
            request?.denomination
          ]),
          runFence,
          budget
        );
        const cachedCensusSource = cachedSource(
          prefetchCensusSource,
          "readSnapshots",
          request => JSON.stringify([
            request?.identity?.chainId,
            request?.identity?.mint,
            request?.identity?.pool,
            request?.identity?.quote,
            request?.startAtMs,
            request?.endAtMs,
            request?.policy
          ]),
          runFence,
          budget
        );
        const cachedHistorySource = prefetchedHistory === null ? null : Object.freeze({
          async readWindow(request) {
            if (!runFence.isCurrent()) return null;
            if (request?.identity?.chainId !== identity.chainId ||
                request?.identity?.mint !== identity.mint ||
                request?.identity?.pool !== identity.pool ||
                request?.identity?.quote !== identity.quote ||
                request?.startExclusiveMs !== candidateT - 3_600_000 ||
                request?.endInclusiveMs !== candidateT) return null;
            return prefetchedHistory;
          }
        });
        try {
          await awaitBounded(() => buildAnalystWindowEvidence({
            candidate: providerCandidate,
            candidateT,
            assembledAt: sourceAssembly,
            decisionAt: sourceAssembly,
            policy,
            poolProof,
            historySource: cachedHistorySource,
            censusSource: cachedCensusSource,
            priceSource: cachedPriceSource,
            marketPairEvidence,
            smartWalletAllowlist,
            sourcePrefetchOnly: true,
            syntheticHistorySourceOverride: mode === "SYNTHETIC_TEST_ONLY"
          }), runFence);
        } catch (error) {
          if (error?.code === "CANCELLED" || error?.code === "DEADLINE" ||
              !runFence.isCurrent()) {
            return unavailable(controller.signal.reason?.code ?? error?.code ?? "CANCELLED", {
              candidateT, assembledAt: sourceAssembly, holdUntil
            });
          }
          return unavailable("ANALYST_SOURCE_PREFETCH_UNKNOWN", {
            candidateT, assembledAt: sourceAssembly, holdUntil
          });
        }
        if (!runFence.isCurrent()) {
          return unavailable(controller.signal.reason?.code ?? "CANCELLED", {
            candidateT, assembledAt: sourceAssembly, holdUntil
          });
        }

        let actualAssembledAt;
        try {
          actualAssembledAt = clock();
        } catch {
          return unavailable("INVALID_ASSEMBLY_CLOCK", {candidateT, holdUntil});
        }
        if (!validTime(actualAssembledAt) || actualAssembledAt < candidateT ||
            (assembledAt !== undefined && assembledAt !== actualAssembledAt)) {
          return unavailable("ASSEMBLY_TIME_NOT_CURRENT", {
            candidateT, assembledAt: actualAssembledAt, decisionAt, holdUntil
          });
        }
        let analystCutoff;
        try {
          analystCutoff = clock();
        } catch {
          return unavailable("INVALID_DECISION_CLOCK", {
            candidateT, assembledAt: actualAssembledAt, holdUntil
          });
        }
        if (!validTime(analystCutoff) || analystCutoff < actualAssembledAt ||
            (decisionAt !== undefined && decisionAt !== analystCutoff) ||
            (holdUntil !== null && (!validTime(holdUntil) || holdUntil <= analystCutoff))) {
          return unavailable("DECISION_TIME_OR_HOLD_INVALID", {
            candidateT, assembledAt: actualAssembledAt, decisionAt: analystCutoff, holdUntil
          });
        }
        let packet;
        try {
          packet = await awaitBounded(() => buildAnalystWindowEvidence({
            candidate: providerCandidate,
            candidateT,
            assembledAt: actualAssembledAt,
            decisionAt: analystCutoff,
            policy,
            poolProof,
            historySource: cachedHistorySource,
            censusSource: cachedCensusSource,
            priceSource: cachedPriceSource,
            marketPairEvidence,
            smartWalletAllowlist,
            syntheticHistorySourceOverride: mode === "SYNTHETIC_TEST_ONLY"
          }), runFence);
        } catch (error) {
          if (error?.code === "CANCELLED" || error?.code === "DEADLINE" ||
              !runFence.isCurrent()) {
            return unavailable(controller.signal.reason?.code ?? error?.code ?? "CANCELLED", {
              candidateT, assembledAt: actualAssembledAt, decisionAt: analystCutoff, holdUntil
            });
          }
          return unavailable("ANALYST_EVIDENCE_BUILD_UNKNOWN", {
            candidateT, assembledAt: actualAssembledAt, decisionAt: analystCutoff, holdUntil
          });
        }
        if (!runFence.isCurrent()) {
          return unavailable(controller.signal.reason?.code ?? "CANCELLED", {
            candidateT, assembledAt: actualAssembledAt, decisionAt: analystCutoff, holdUntil
          });
        }
        let actualDecisionAt;
        try {
          actualDecisionAt = clock();
        } catch {
          actualDecisionAt = null;
        }
        if (!validTime(actualDecisionAt) || actualDecisionAt < analystCutoff) {
          return unavailable("INVALID_FINAL_DECISION_CLOCK", {
            candidateT, assembledAt: actualAssembledAt, decisionAt: actualDecisionAt, holdUntil
          });
        }
        let evaluation;
        try {
          evaluation = await awaitBounded(() => evaluateWithCanonicalMarketAdapter({
            canonicalAdapter: adaptMarketEvidence,
            providerCandidate,
            evidence,
            packet,
            reviewEvidence: acceptedReviewEvidence,
            now: actualDecisionAt,
            holdUntil
          }), runFence);
        } catch (error) {
          if (error?.code === "CANCELLED" || error?.code === "DEADLINE" ||
              !runFence.isCurrent()) {
            return unavailable(controller.signal.reason?.code ?? error?.code ?? "CANCELLED", {
              candidateT, assembledAt: actualAssembledAt, decisionAt: actualDecisionAt, holdUntil
            });
          }
          return unavailable("CANONICAL_EVALUATION_UNKNOWN", {
            candidateT, assembledAt: actualAssembledAt, decisionAt: actualDecisionAt, holdUntil
          });
        }
        if (!runFence.isCurrent()) {
          return unavailable(controller.signal.reason?.code ?? "CANCELLED", {
            candidateT, assembledAt: actualAssembledAt, decisionAt: actualDecisionAt, holdUntil
          });
        }
        return {
          status: evaluation.status,
          mode,
          candidateT,
          assembledAt: actualAssembledAt,
          decisionAt: actualDecisionAt,
          analystCutoff,
          holdUntil,
          candidate: evaluation.adapted?.candidate ?? null,
          adapted: evaluation.adapted,
          filters: evaluation.filters,
          analysis: evaluation.analysis,
          analystEvidence: packet,
          auditReceipts: {
            ...packet.receipts,
            acquisition: acquisitionReceipts.map(item => ({...item}))
          },
          sourceLimits: {...reportedLimits},
          executionAuthorized: false,
          realDataEntryEligible: false
        };
      } finally {
        clearTimeout(deadlineTimer);
        if (signal) signal.removeEventListener("abort", callerAbort);
        runFence.abort("COMPLETE");
        evaluationActive = false;
      }
    }
  });
}
