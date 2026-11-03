import {createHash} from "node:crypto";
import {canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {createMarketQuoteAdapter} from "./market-quote-adapter.mjs";
import {
  createPaperSourcePipeline,
  PAPER_SOURCE_PIPELINE_VERSION
} from "./paper-source-pipeline.mjs";

const PAPER_SOURCE_POLICY = Object.freeze({
  schemaVersion: "memecoin-paper-source-policy/v1",
  enabled: false,
  providers: Object.freeze([
    Object.freeze({
      name: "DexScreener public API",
      origin: "https://api.dexscreener.com",
      methods: Object.freeze(["GET /latest/dex/pairs/solana/{pool}"]),
      approved: false
    }),
    Object.freeze({
      name: "Solana mainnet public JSON-RPC",
      origin: "https://api.mainnet-beta.solana.com",
      methods: Object.freeze([
        "getAccountInfo", "getBlocks", "getBlockTime", "getProgramAccounts",
        "getSignaturesForAddress", "getSlot", "getTokenLargestAccounts",
        "getTokenSupply", "getTransaction"
      ]),
      approved: false
    }),
    Object.freeze({
      name: "Jupiter Swap API V2",
      origin: "https://api.jup.ag",
      methods: Object.freeze(["GET /swap/v2/order"]),
      approved: false
    })
  ]),
  missingRequirements: Object.freeze([
    "provider authenticity and source-time attestation",
    "complete historical archive and evidence census",
    "reviewed LP, developer, rug, bundled-supply, and wallet policies",
    "source-bound price and all five nonoverlapping USD cost components",
    "independent approval of this exact provider policy"
  ])
});

export const PAPER_RUNTIME_SOURCE_POLICY = PAPER_SOURCE_POLICY;
export const PAPER_RUNTIME_SOURCE_POLICY_SHA256 = createHash("sha256")
  .update(canonicalCheckpointBytes(PAPER_SOURCE_POLICY))
  .digest("hex");

export async function acquireSyntheticRuntimeFixture(clock, {
  signal,
  remaining,
  recordRequest,
  recordWork,
  waitForStop = false,
  expireDuringRequest = false,
  deadlineAt,
  variant = "BASE"
} = {}) {
  if (!clock || typeof clock.wallClock !== "function" || typeof clock.advance !== "function") {
    throw new TypeError("synthetic runtime fixture requires the module synthetic clock");
  }
  if (typeof recordRequest !== "function" || typeof recordWork !== "function") {
    throw new TypeError("synthetic runtime fixture requires shared budget callbacks");
  }
  if (!remaining || !Number.isSafeInteger(remaining.requests) ||
      !Number.isSafeInteger(remaining.bytes) || !Number.isSafeInteger(remaining.work) ||
      !Number.isSafeInteger(remaining.timeMs) || !Number.isSafeInteger(deadlineAt)) {
    throw new TypeError("synthetic runtime fixture requires shared remaining budgets");
  }
  if (!["BASE", "MISSING_QUOTE", "WRONG_IDENTITY", "FUTURE_EVIDENCE"].includes(variant)) {
    throw new TypeError("synthetic runtime fixture variant is unsupported");
  }
  let usedRequests = 0;
  let usedBytes = 0;
  let usedWork = 0;
  const chargeWork = units => {
    if (signal?.aborted || !Number.isSafeInteger(units) || units < 1 ||
        usedWork + units > remaining.work) {
      throw Object.assign(new Error("synthetic source work budget exhausted"), {
        code: signal?.aborted ? "STOPPED" : "GLOBAL_BUDGET"
      });
    }
    recordWork(units);
    usedWork += units;
  };
  const chargeRequest = bytes => {
    if (signal?.aborted || !Number.isSafeInteger(bytes) || bytes < 0 ||
        usedRequests + 1 > remaining.requests || usedBytes + bytes > remaining.bytes ||
        usedWork + 1 > remaining.work) {
      throw Object.assign(new Error("synthetic source request budget exhausted"), {
        code: signal?.aborted ? "STOPPED" : "GLOBAL_BUDGET"
      });
    }
    recordRequest({bytes, events: 1});
    usedRequests += 1;
    usedBytes += bytes;
    usedWork += 1;
  };
  if (remaining.requests < 1 || remaining.bytes < 1 ||
      remaining.work < 1 || remaining.timeMs < 1) {
    return {status: "UNKNOWN", reason: "GLOBAL_BUDGET", candidate: null, pipeline: null, quote: null};
  }
  const [{makeFixture}, {createPaperSourcePipeline}, {ANALYST_WINDOW_METRICS},
    {createMarketQuoteAdapter}, {syntheticOrderResponse}] = await Promise.all([
    import("../../test/fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs"),
    import("./paper-source-pipeline.mjs"),
    import("./analyst-window-evidence.mjs"),
    import("./market-quote-adapter.mjs"),
    import("../../test/fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs")
  ]);
  const candidateT = clock.wallClock() - 1_000;
  const fixture = makeFixture({candidateT});
  const marketPairEvidence = variant === "WRONG_IDENTITY"
    ? {
        ...fixture.marketPairEvidence,
        identity: {...fixture.identity, mint: "Vote111111111111111111111111111111111111111"}
      }
    : variant === "FUTURE_EVIDENCE"
      ? {...fixture.marketPairEvidence, observedAt: candidateT + 1_000}
      : fixture.marketPairEvidence;
  const slotTimes = new Map([
    [490_000, Math.floor((candidateT - 3_601_000) / 1_000)],
    [490_001, Math.floor((candidateT - 3_600_000) / 1_000)],
    [490_003, Math.floor((candidateT - 3_599_000) / 1_000)],
    [490_004, Math.floor(candidateT / 1_000)],
    [490_006, Math.floor((candidateT + 1_000) / 1_000)]
  ]);
  const rpcMethods = [];
  const transport = async request => {
    if (expireDuringRequest) clock.advance(remaining.timeMs + 1);
    if (clock.wallClock() >= deadlineAt) {
      throw Object.assign(new Error("synthetic runtime deadline reached"), {code: "DEADLINE"});
    }
    if (waitForStop) {
      await new Promise(resolve => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", resolve, {once: true});
      });
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (signal?.aborted) throw Object.assign(new Error("fixture acquisition cancelled"), {code: "STOPPED"});
    const body = JSON.parse(request.body);
    rpcMethods.push(body.method);
    const result = body.method === "getSlot" ? 490_016
      : body.method === "getBlocks" ? [490_000, 490_001, 490_003, 490_004, 490_006]
        : body.method === "getBlockTime" ? slotTimes.get(body.params[0]) ?? null
          : null;
    const response = JSON.stringify({jsonrpc: "2.0", id: body.id, result});
    chargeRequest(Buffer.byteLength(response));
    return new Response(response, {
      status: 200,
      headers: {"content-type": "application/json"}
    });
  };
  const historySlotCollector = request => {
    if (signal?.aborted) throw Object.assign(new Error("fixture acquisition cancelled"), {code: "STOPPED"});
    const payload = JSON.stringify({fixture: "SYNTHETIC_FIXTURE_ONLY"});
    chargeRequest(Buffer.byteLength(payload));
    return {
      sourceVersion: "solana-launch-history-source-v1",
      source: "Solana JSON-RPC",
      rpcOrigin: "https://api.mainnet-beta.solana.com",
      commitment: "finalized",
      declaredSubjects: request.subjects,
      slotInterval: {startInclusive: request.startSlot, endInclusive: request.endSlot},
      signatures: [],
      transactions: [],
      events: [{
        origin: "https://api.mainnet-beta.solana.com",
        method: "getSlot",
        requestStartedAt: clock.wallClock(),
        responseReceivedAt: clock.wallClock(),
        responseBytes: Buffer.byteLength(payload),
        responseSha256: createHash("sha256").update(payload).digest("hex"),
        status: "RESPONSE_RECEIVED"
      }],
      counters: {
        requests: 1,
        bytes: Buffer.byteLength(payload),
        workUnits: 1,
        signatures: 0,
        successfulTransactions: 0
      },
      coverage: {
        scope: "declared-subjects-and-inclusive-slot-interval-only",
        finalizedAnchor: {status: "CAPTURED", slot: request.endSlot + 10},
        sourceHistoryCompleteness: "COMPLETE",
        complete: true,
        signaturePagesComplete: true,
        successfulTransactionRetrievalComplete: true,
        terminationReason: "DECLARED_INTERVAL_COVERED",
        subjects: [{
          address: request.identity.pool,
          signatureCoverageComplete: true,
          terminationReason: "SOURCE_EXHAUSTED"
        }]
      }
    };
  };
  const pipeline = createPaperSourcePipeline({
    enabled: true,
    mode: "SYNTHETIC_TEST_ONLY",
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    transport,
    clock: () => clock.wallClock(),
    limits: {
      maxRequests: Math.max(1, remaining.requests),
      maxBytesPerResponse: Math.min(1_048_576, Math.max(1, Math.floor(remaining.bytes / 3))),
      maxBytesPerRun: Math.max(1, remaining.bytes),
      maxWorkUnits: Math.max(1, remaining.work),
      maxDurationMs: Math.max(1, remaining.timeMs),
      requestTimeoutMs: Math.min(1_000, Math.max(1, remaining.timeMs))
    },
    historySlotCollector
  });
  const reviewEvidence = Object.fromEntries(ANALYST_WINDOW_METRICS.map(key => [key, {
    status: "REVIEWED",
    reviewerId: "offline-fixture-reviewer",
    reviewId: `offline-${key}`,
    reviewedAt: candidateT - 1
  }]));
  const censusSource = Object.freeze({
    async readSnapshots(request) {
      if (signal?.aborted) throw Object.assign(new Error("fixture acquisition cancelled"), {code: "STOPPED"});
      chargeWork(1);
      return fixture.censusSource.readSnapshots(request);
    }
  });
  const priceSource = Object.freeze({
    async readObservation(request) {
      if (signal?.aborted) throw Object.assign(new Error("fixture acquisition cancelled"), {code: "STOPPED"});
      chargeWork(1);
      return fixture.priceSource.readObservation(request);
    }
  });
  chargeWork(1);
  const evaluation = await pipeline.evaluate({
    providerCandidate: fixture.candidate,
    evidence: fixture.candidate.evidence,
    candidateT,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    censusSource,
    priceSource,
    marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist,
    reviewEvidence,
    holdUntil: candidateT + 8 * 60 * 60 * 1_000,
    signal
  });
  if (!evaluation.candidate) {
    return {
      status: "UNKNOWN",
      reason: evaluation.reason ?? "PIPELINE_CANDIDATE_UNAVAILABLE",
      candidate: null,
      pipeline: evaluation,
      quote: null
    };
  }
  const liquidityCoverage = evaluation.candidate.analystEvidence?.liquidityMarketCapPct?.coverage;
  if (liquidityCoverage && Object.hasOwn(liquidityCoverage, "windowMs") &&
      liquidityCoverage.windowMs === undefined) {
    delete liquidityCoverage.windowMs;
  }
  const attachRuntime = quote => {
    evaluation.candidate.syntheticRuntime = {
      label: "SYNTHETIC_FIXTURE_ONLY",
      pipeline: {
        status: evaluation.status,
        candidateT: evaluation.candidateT,
        assembledAt: evaluation.assembledAt,
        decisionAt: evaluation.decisionAt,
        filtersStatus: evaluation.filters?.status ?? "UNKNOWN",
        filtersAccepted: evaluation.filters?.accepted === true,
        rpcMethods,
        acquisitionReceiptIds: evaluation.auditReceipts.acquisition
          .map(item => item.receipt?.id).filter(Boolean)
      },
      quote: {
        status: quote?.status ?? "UNAVAILABLE",
        sourceProvenance: quote?.sourceProvenance ?? "NOT_REQUESTED",
        eventId: quote?.quoteCandidate?.eventId ?? null,
        observedAt: quote?.quoteCandidate?.receiptTime?.observedAt ?? null,
        costStatus: quote?.costEvidence?.status ?? "UNKNOWN",
        scenarioStatus: quote?.scenarioProjection?.status ?? null,
        paperFillEligible: false
      }
    };
  };

  const quoteBody = syntheticOrderResponse({
    inputMint: fixture.candidate.quote,
    outputMint: fixture.candidate.mint
  });
  if (signal?.aborted || clock.wallClock() >= deadlineAt ||
      usedRequests >= remaining.requests ||
      usedBytes >= remaining.bytes || usedWork >= remaining.work) {
    attachRuntime(null);
    return {
      status: evaluation.status,
      reason: signal?.aborted ? "STOPPED"
        : clock.wallClock() >= deadlineAt ? "DEADLINE" : "GLOBAL_BUDGET",
      candidate: evaluation.candidate,
      pipeline: evaluation,
      quote: null
    };
  }
  const quoteAdapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => {
      clock.advance(1);
      return clock.wallClock();
    },
    transport: async () => {
      if (signal?.aborted) throw Object.assign(new Error("fixture quote cancelled"), {code: "STOPPED"});
      const response = JSON.stringify(quoteBody.body);
      chargeRequest(Buffer.byteLength(response));
      return new Response(response, {
        status: variant === "MISSING_QUOTE" ? 503 : 200,
        headers: {"content-type": "application/json"}
      });
    },
    timeoutMs: 1_000,
    maxRequests: 1
  });
  const quote = await quoteAdapter.getPaperQuote({
    identity: {
      chainId: fixture.candidate.chainId,
      mint: fixture.candidate.mint,
      pool: fixture.candidate.pool,
      quote: fixture.candidate.quote,
      decimals: fixture.candidate.decimals
    },
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: candidateT,
    authorizedAt: evaluation.decisionAt,
    slippageBps: 50
  }, {signal});

  attachRuntime(quote);
  return {
    status: evaluation.status,
    reason: evaluation.filters?.status === "PASS" ? null : "FIXTURE_EVIDENCE_NOT_ENTRY_AUTHORITY",
    candidate: evaluation.candidate,
    pipeline: evaluation,
    quote
  };
}

export function createPaperRuntimeSourceAdapter(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Object.getOwnPropertySymbols(options).length !== 0 ||
      Object.getOwnPropertyNames(options).join(",") !== "sourcePolicySha256" ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(options, "sourcePolicySha256") ?? {}, "value")) {
    throw new TypeError("runtime source adapter options must be exact bounded data");
  }
  const {sourcePolicySha256} = options;
  if (sourcePolicySha256 !== PAPER_RUNTIME_SOURCE_POLICY_SHA256) {
    throw new TypeError("source policy digest does not match the module-owned policy");
  }

  const pipeline = createPaperSourcePipeline({
    enabled: false,
    mode: "EXTERNAL_READ_ONLY_INPUT"
  });
  const quoteAdapter = createMarketQuoteAdapter({enabled: false});

  return Object.freeze({
    async acquireCandidates({signal, remaining} = {}) {
      if (signal?.aborted) {
        return {status: "UNKNOWN", reason: "STOPPED", candidates: [], unresolved: []};
      }
      if (!remaining || !Number.isSafeInteger(remaining.requests) ||
          remaining.requests < 0 || !Number.isSafeInteger(remaining.bytes) ||
          remaining.bytes < 0 || !Number.isSafeInteger(remaining.candidates) ||
          remaining.candidates < 0) {
        return {
          status: "UNKNOWN",
          reason: "GLOBAL_BUDGET",
          candidates: [],
          unresolved: [...PAPER_SOURCE_POLICY.missingRequirements]
        };
      }
      return {
        status: "UNKNOWN",
        reason: "SOURCE_POLICY_UNAPPROVED",
        candidates: [],
        unresolved: [...PAPER_SOURCE_POLICY.missingRequirements],
        pipelineVersion: PAPER_SOURCE_PIPELINE_VERSION,
        pipelineEnabled: pipeline.enabled,
        quoteAdapterStatus: "DISABLED",
        networkAccessed: false
      };
    },
    async quote(request, options) {
      return quoteAdapter.getPaperQuote(request, options);
    }
  });
}
