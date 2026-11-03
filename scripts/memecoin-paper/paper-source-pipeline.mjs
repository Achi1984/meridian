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

export function createPaperSourcePipeline({
  enabled = false,
  mode = "EXTERNAL_READ_ONLY_INPUT",
  slotRange,
  transport,
  clock,
  limits = {},
  historySlotCollector
} = {}) {
  if (!MODES.has(mode)) throw new TypeError("paper source pipeline mode is unsupported");
  if (historySlotCollector !== undefined &&
      (mode !== "SYNTHETIC_TEST_ONLY" || typeof historySlotCollector !== "function")) {
    throw new TypeError("custom history collectors are limited to synthetic test mode");
  }
  const timeBoundarySource = createTimeBoundarySource({
    enabled,
    slotRange,
    transport,
    clock,
    limits
  });
  const collector = historySlotCollector ?? (request => acquireLaunchHistory({
    subjects: request.subjects,
    startSlot: request.startSlot,
    endSlot: request.endSlot,
    transport,
    clock,
    signal: request.signal,
    limits: request.limits
  }));
  const reportedLimits = Object.freeze({...DEFAULT_TIME_BOUNDARY_LIMITS, ...limits});
  let activeAcquisition = null;
  const observedTimeBoundarySource = Object.freeze({
    async readWindow(request) {
      const result = await timeBoundarySource.readWindow(request);
      if (activeAcquisition) activeAcquisition.timeEvidence = result;
      return result;
    }
  });
  const observedCollector = async request => {
    const result = await collector(request);
    if (activeAcquisition) activeAcquisition.collector = result;
    return result;
  };
  const historySource = createHistoryWindowSource({
    enabled,
    timeBoundarySource: observedTimeBoundarySource,
    slotHistoryCollector: observedCollector,
    limits: bridgeLimitsFor(reportedLimits)
  });
  let evaluationActive = false;

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
      holdUntil = null
    } = {}) {
      if (!enabled) return unavailable("DISABLED");
      if (evaluationActive) return unavailable("EVALUATION_IN_PROGRESS", {
        candidateT, assembledAt, decisionAt, holdUntil
      });
      evaluationActive = true;
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
        const acquisitionReceipts = [];
        const acquisition = {timeEvidence: null, collector: null};
        activeAcquisition = acquisition;
        let prefetchedHistory = null;
        if (isRecord(policy) && policy.windowsMs?.swaps1h === 3_600_000 &&
            isRecord(poolProof)) {
          try {
            prefetchedHistory = await historySource.readWindow({
              identity,
              poolProof,
              startExclusiveMs: candidateT - policy.windowsMs.swaps1h,
              endInclusiveMs: candidateT
            });
          } catch {
            prefetchedHistory = null;
          }
          acquisitionReceipts.push(receiptSummary(
            prefetchedHistory, acquisition.timeEvidence, acquisition.collector
          ));
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
        const assembledHistorySource = prefetchedHistory === null ? null : Object.freeze({
          async readWindow(request) {
            if (request?.identity?.chainId !== identity.chainId ||
                request?.identity?.mint !== identity.mint ||
                request?.identity?.pool !== identity.pool ||
                request?.identity?.quote !== identity.quote ||
                request?.startExclusiveMs !== candidateT - 3_600_000 ||
                request?.endInclusiveMs !== candidateT) return null;
            return prefetchedHistory;
          }
        });
        let packet;
        try {
          packet = await buildAnalystWindowEvidence({
            candidate: providerCandidate,
            candidateT,
            assembledAt: actualAssembledAt,
            decisionAt: analystCutoff,
            policy,
            poolProof,
            historySource: assembledHistorySource,
            censusSource: mode === "EXTERNAL_READ_ONLY_INPUT"
              ? withoutFixtureResults(censusSource, "readSnapshots") : censusSource,
            priceSource: mode === "EXTERNAL_READ_ONLY_INPUT"
              ? withoutFixtureResults(priceSource, "readObservation") : priceSource,
            marketPairEvidence,
            smartWalletAllowlist
          });
        } catch {
          return unavailable("ANALYST_EVIDENCE_BUILD_UNKNOWN", {
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
          evaluation = await evaluateWithCanonicalMarketAdapter({
            canonicalAdapter: adaptMarketEvidence,
            providerCandidate,
            evidence,
            packet,
            reviewEvidence,
            now: actualDecisionAt,
            holdUntil
          });
        } catch {
          return unavailable("CANONICAL_EVALUATION_UNKNOWN", {
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
        activeAcquisition = null;
        evaluationActive = false;
      }
    }
  });
}
