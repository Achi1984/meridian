import {adaptMarketEvidence} from "./market-evidence-adapter.mjs";
import {
  buildAnalystWindowEvidence,
  evaluateWithCanonicalMarketAdapter
} from "./analyst-window-evidence.mjs";
import {acquireLaunchHistory} from "./launch-history-source.mjs";
import {
  DEFAULT_TIME_BOUNDARY_LIMITS,
  createHistoryWindowSource,
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
  const historySource = createHistoryWindowSource({
    enabled,
    timeBoundarySource,
    slotHistoryCollector: collector,
    clock,
    limits
  });
  const reportedLimits = Object.freeze({...DEFAULT_TIME_BOUNDARY_LIMITS, ...limits});
  const acquisitionReceipts = [];
  const observedHistorySource = Object.freeze({
    async readWindow(request) {
      const result = await historySource.readWindow(request);
      acquisitionReceipts.push(result ? {
        status: result.status ?? "UNKNOWN",
        reason: result.reason ?? null,
        source: result.source ?? null,
        receipt: result.receipt ?? null,
        coverage: result.coverage ?? null,
        counters: result.counters ?? null,
        sourceReceipts: result.sourceReceipts ?? [],
        timeBoundaryCoverage: result.timeBoundaryCoverage ?? null,
        collectorCoverage: result.collectorCoverage ?? null
      } : {
        status: "UNKNOWN",
        reason: "HISTORY_SOURCE_RETURNED_NO_RESULT",
        source: null,
        receipt: null,
        coverage: null,
        counters: null,
        sourceReceipts: [],
        timeBoundaryCoverage: null,
        collectorCoverage: null
      });
      return result;
    }
  });

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
      if (typeof clock !== "function" || !isRecord(providerCandidate) ||
          !validTime(candidateT) || providerCandidate.sampledAt !== candidateT ||
          !isRecord(evidence) || !isRecord(reviewEvidence)) {
        return unavailable("INVALID_PIPELINE_REQUEST", {candidateT, assembledAt, decisionAt, holdUntil});
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
      const identity = {
        chainId: providerCandidate.chainId,
        mint: providerCandidate.mint,
        pool: providerCandidate.pool,
        quote: providerCandidate.quote
      };
      acquisitionReceipts.length = 0;
      let packet;
      try {
        packet = await buildAnalystWindowEvidence({
          candidate: providerCandidate,
          candidateT,
          assembledAt: actualAssembledAt,
          decisionAt: analystCutoff,
          policy,
          poolProof,
          historySource: observedHistorySource,
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
    }
  });
}
