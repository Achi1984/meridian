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

const FIXTURE_COST_CONTRACT = Object.freeze({
  version: "SYNTHETIC_FIXED_CENT_SCHEDULE_V1",
  costs: Object.freeze({
    feeCents: 1,
    spreadCents: 1,
    slippageCents: 1,
    priceImpactCents: 1,
    networkCents: 1
  })
});

function hasDataMethod(value, name) {
  let owner = value;
  while (owner !== null && owner !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) return Object.hasOwn(descriptor, "value") &&
      typeof descriptor.value === "function";
    owner = Object.getPrototypeOf(owner);
  }
  return false;
}

function fixtureAddress(index) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(index, 28);
  let number = BigInt(`0x${bytes.toString("hex")}`);
  let encoded = "";
  while (number > 0n) {
    const digit = Number(number % 58n);
    number /= 58n;
    encoded = alphabet[digit] + encoded;
  }
  return "1".repeat(32 - encoded.length) + encoded;
}

function reviewedFixtureEvidence(fixture, candidateT) {
  const candidate = structuredClone(fixture.candidate);
  const identity = {
    chainId: candidate.chainId,
    mint: candidate.mint,
    pool: candidate.pool,
    quote: candidate.quote
  };
  candidate.tokenSupplyAtoms = "1000000000";
  candidate.evidence.tokenDecimals.coverage = {
    complete: true,
    amountAtoms: candidate.tokenSupplyAtoms,
    mintAccountMatch: true,
    accountSlot: 490_004
  };
  candidate.evidence.tokenDecimals.slot = 490_004;

  const reviewed = (value, id, coverage = {complete: true}) => ({
    value,
    source: "SYNTHETIC_FIXTURE_ONLY",
    sourceVersion: "synthetic-runtime-evidence-v1",
    identity,
    observedAt: candidateT,
    slot: 490_004,
    coverage,
    review: {
      status: "REVIEWED",
      reviewerId: "synthetic-runtime-reviewer",
      reviewId: `runtime-${id}`,
      reviewedAt: candidateT - 1
    }
  });
  const selectedPoolAccount = fixture.poolProof.baseVault;
  const burnedAccount = fixture.poolProof.quoteVault;
  const owners = Array.from({length: 50}, (_, index) => fixtureAddress(700_000 + index));
  const accounts = [
    {account: selectedPoolAccount, owner: selectedPoolAccount, amountAtoms: "100000000", classification: "selected_pool"},
    {account: burnedAccount, owner: burnedAccount, amountAtoms: "100000000", classification: "burned_supply"},
    ...owners.map(owner => ({
      account: owner,
      owner,
      amountAtoms: "16000000",
      classification: "holder"
    }))
  ];
  return {
    candidate,
    evidence: {
      lpProtection: reviewed({
        pool: candidate.pool,
        model: "burn",
        burnEvidenceId: "synthetic-runtime-burn-proof"
      }, "lp"),
      ownerCensus: reviewed({
        pool: candidate.pool,
        supplyAtoms: candidate.tokenSupplyAtoms,
        context: {
          ...identity,
          slot: 490_004,
          observedAt: candidateT,
          commitment: "finalized"
        },
        selectedPoolTokenAccounts: [selectedPoolAccount],
        burnedTokenAccounts: [burnedAccount],
        accounts
      }, "owners", {
        complete: true,
        exclusions: ["selected_pool", "burned_supply"],
        ownerResolutionComplete: true,
        accountCoverageComplete: true,
        supplyContextPolicy: "same-finalized-slot",
        burnedSupplyAtoms: "100000000"
      }),
      developerAttribution: reviewed({
        method: "documented",
        developerOwners: [owners[0]],
        evidenceIds: ["synthetic-developer-attribution"]
      }, "developer"),
      priorRug: reviewed({
        found: false,
        historyCoverage: "complete"
      }, "rug"),
      bundledLaunch: reviewed({
        bundledSupplyAtoms: "50000000"
      }, "bundle", {complete: true, bundleDetectionComplete: true})
    }
  };
}

export async function acquireSyntheticRuntimeFixture(clock, {
  signal,
  remaining,
  recordRequest,
  recordWork,
  waitForStop = false,
  waitForQuoteSettle = false,
  expireDuringRequest = false,
  deadlineAt,
  variant = "BASE",
  warmupStore
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
  if (!["BASE", "MISSING_QUOTE", "MISSING_COSTS", "WRONG_IDENTITY",
    "FUTURE_EVIDENCE", "WRONG_QUOTE_IDENTITY"].includes(variant)) {
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
  if (warmupStore) {
    const [
      {makeHandoffFixture, makeBirdeyeObservation, evaluationRequest, makeSyntheticHistoryPipeline},
      {createPaperProviderWarmupHandoff}
    ] = await Promise.all([
      import("../../test/fixtures/memecoin-paper-provider-warmup-handoff/synthetic.mjs"),
      import("./provider-warmup-handoff/index.mjs")
    ]);
    const fixture = makeHandoffFixture();
    const {observation, request, calls} = await makeBirdeyeObservation(fixture);
    if (signal?.aborted || clock.wallClock() >= deadlineAt) {
      return {
        status: "UNKNOWN",
        reason: signal?.aborted ? "STOPPED" : "DEADLINE",
        candidate: null,
        pipeline: null,
        quote: null
      };
    }
    if (calls.length !== 1 || observation.status !== "SOURCE_BOUND") {
      return {
        status: "UNKNOWN",
        reason: "PROVIDER_OBSERVATION_UNBOUND",
        candidate: null,
        pipeline: null,
        quote: null
      };
    }
    const responseBytes = observation.receipts?.[0]?.responseBytes;
    if (!Number.isSafeInteger(responseBytes) || responseBytes < 0) {
      return {
        status: "UNKNOWN",
        reason: "PROVIDER_RESPONSE_SIZE_UNKNOWN",
        candidate: null,
        pipeline: null,
        quote: null
      };
    }
    try {
      recordRequest({bytes: responseBytes, events: 1});
    } catch (error) {
      return {
        status: "UNKNOWN",
        reason: error?.code === "STOPPED" ? "STOPPED" : "GLOBAL_BUDGET",
        candidate: null,
        pipeline: null,
        quote: null
      };
    }
    const handoff = createPaperProviderWarmupHandoff({
      enabled: true,
      store: warmupStore,
      datasetId: "runtime-source-fixture",
      runId: "runtime-source-fixture-run",
      identity: fixture.identity,
      clock: () => fixture.assembledAt,
      limits: {maxElapsedMs: Math.max(1, Math.min(10_000, remaining.timeMs))}
    });
    const result = await handoff.runOffline({
      observation,
      request,
      pipeline: makeSyntheticHistoryPipeline(fixture),
      evaluationRequest: evaluationRequest(fixture),
      priceEndpoints: [{
        mint: fixture.candidate.mint,
        atMs: fixture.candidateT,
        denomination: "USD"
      }],
      signal,
      remaining,
      recordRequest,
      recordWork,
      deadlineAt
    });
    if (signal?.aborted || clock.wallClock() >= deadlineAt) {
      return {
        status: "UNKNOWN",
        reason: signal?.aborted ? "STOPPED" : "DEADLINE",
        candidate: null,
        pipeline: null,
        quote: null
      };
    }
    const evaluation = result.evaluation ?? null;
    return {
      status: evaluation?.candidate ? "SYNTHETIC_FIXTURE_ONLY" : "UNKNOWN",
      reason: evaluation?.analysis?.status === "BLOCKED"
        ? "WARMUP_EVALUATION_BLOCKED" : result.reason ?? null,
      candidate: evaluation?.candidate ?? null,
      pipeline: evaluation,
      quote: null,
      warmup: {
        status: result.status,
        reason: result.reason ?? null,
        datasetDigest: result.datasetDigest ?? null,
        trust: result.trust ?? "UNKNOWN",
        completeness: result.completeness ?? "UNKNOWN"
      }
    };
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
  const fixture = makeFixture({candidateT, buyCount: 5, sellCount: 2, includeBoundaryRows: false});
  const completeFixture = reviewedFixtureEvidence(fixture, candidateT);
  const orderedTransactions = [...fixture.transactions]
    .sort((left, right) => left.blockTime - right.blockTime ||
      left.signature.localeCompare(right.signature));
  const firstTransactionSlot = 490_002;
  const lastTransactionSlot = firstTransactionSlot + orderedTransactions.length - 1;
  const endBoundarySlot = lastTransactionSlot + 1;
  const afterBoundarySlot = endBoundarySlot + 1;
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
    ...orderedTransactions.map((row, index) =>
      [firstTransactionSlot + index, row.blockTime]),
    [endBoundarySlot, Math.floor(candidateT / 1_000)],
    [afterBoundarySlot, Math.floor((candidateT + 1_000) / 1_000)]
  ]);
  const collectorRows = orderedTransactions.map((row, index) => {
    const slot = firstTransactionSlot + index;
    return {
      ...row,
      slot,
      subjectAddresses: [fixture.identity.pool],
      status: "SUCCESS",
      version: "legacy"
    };
  });
  const collectorSignatures = collectorRows.map(row => ({
    signature: row.signature,
    slot: row.slot,
    blockTime: row.blockTime,
    err: null,
    errorStatus: null,
    subjectAddresses: [fixture.identity.pool]
  }));
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
      : body.method === "getBlocks" ? [...slotTimes.keys()]
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
    const transactions = collectorRows.filter(row =>
      row.slot >= request.startSlot && row.slot <= request.endSlot);
    const signatures = collectorSignatures.filter(row =>
      row.slot >= request.startSlot && row.slot <= request.endSlot);
    const payload = JSON.stringify({
      fixture: "SYNTHETIC_FIXTURE_ONLY",
      signatures: signatures.length,
      transactions: transactions.length
    });
    chargeRequest(Buffer.byteLength(payload));
    return {
      sourceVersion: "solana-launch-history-source-v1",
      source: "Solana JSON-RPC",
      rpcOrigin: "https://api.mainnet-beta.solana.com",
      commitment: "finalized",
      declaredSubjects: request.subjects,
      slotInterval: {startInclusive: request.startSlot, endInclusive: request.endSlot},
      signatures,
      transactions,
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
        workUnits: 1 + transactions.length,
        signatures: signatures.length,
        successfulTransactions: transactions.length
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
    slotRange: {startInclusive: 490_000, endInclusive: afterBoundarySlot},
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
    providerCandidate: completeFixture.candidate,
    evidence: completeFixture.evidence,
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
  if (signal?.aborted || clock.wallClock() >= deadlineAt) {
    return {
      status: "UNKNOWN",
      reason: signal?.aborted ? "STOPPED" : "DEADLINE",
      candidate: null,
      pipeline: null,
      quote: null
    };
  }
  if (!evaluation.candidate) {
    return {
      status: "UNKNOWN",
      reason: evaluation.reason ?? "PIPELINE_CANDIDATE_UNAVAILABLE",
      candidate: null,
      pipeline: evaluation,
      quote: null
    };
  }
  const runtimeCandidate = evaluation.candidate;
  const runtimeAudit = {
    source: "SYNTHETIC_FIXTURE_ONLY",
    candidateT: evaluation.candidateT,
    assembledAt: evaluation.assembledAt,
    decisionAt: evaluation.decisionAt,
    identity: {
      chainId: evaluation.candidate.chainId,
      mint: evaluation.candidate.mint,
      pool: evaluation.candidate.pool,
      quote: evaluation.candidate.quote,
      decimals: evaluation.candidate.decimals
    },
    pipeline: {
      status: evaluation.status,
      filtersStatus: evaluation.filters?.status ?? "UNKNOWN",
      filtersAccepted: evaluation.filters?.accepted === true,
      analystStatus: evaluation.analysis?.status ?? "UNKNOWN",
      analystEvidenceSha256: createHash("sha256")
        .update(canonicalCheckpointBytes(runtimeCandidate.analystEvidence)).digest("hex"),
      sourceIdentityValid: ["chainId", "mint", "pool", "quote"].every(key =>
        marketPairEvidence?.identity?.[key] === runtimeCandidate[key]),
      marketPairChronologyValid: Number.isSafeInteger(marketPairEvidence?.observedAt) &&
        marketPairEvidence.observedAt <= evaluation.candidateT,
      syntheticAnalystEvidence: "SYNTHETIC_FIXTURE_ONLY",
      acquisitionReceiptIds: evaluation.auditReceipts.acquisition
        .map(item => item.receipt?.id).filter(Boolean).slice(0, 64)
    },
    quotes: []
  };
  if (!runtimeAudit.pipeline.sourceIdentityValid || !runtimeAudit.pipeline.marketPairChronologyValid) {
    return {
      status: "UNKNOWN",
      reason: runtimeAudit.pipeline.sourceIdentityValid
        ? "FUTURE_SOURCE_EVIDENCE" : "SOURCE_IDENTITY_MISMATCH",
      candidate: null,
      pipeline: evaluation,
      quote: null,
      runtimeAudit
    };
  }
  const attachRuntime = () => {
    runtimeCandidate.syntheticRuntime = {
      label: "SYNTHETIC_FIXTURE_ONLY",
      pipeline: runtimeAudit.pipeline,
      candidateT: runtimeAudit.candidateT,
      assembledAt: runtimeAudit.assembledAt,
      decisionAt: runtimeAudit.decisionAt,
      identity: runtimeAudit.identity
    };
  };

  const quoteAdapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => {
      clock.advance(quoteAdapterRequests > 0 ? 2_000 : 1);
      return clock.wallClock();
    },
    transport: async (url, {signal: quoteSignal} = {}) => {
      if (quoteSignal?.aborted || signal?.aborted) {
        throw Object.assign(new Error("fixture quote cancelled"), {code: "STOPPED"});
      }
      if (clock.wallClock() >= deadlineAt) {
        throw Object.assign(new Error("fixture quote deadline reached"), {code: "DEADLINE"});
      }
      if (waitForQuoteSettle) await new Promise(resolve => setTimeout(resolve, 25));
      if (quoteSignal?.aborted || signal?.aborted) {
        throw Object.assign(new Error("fixture quote cancelled"), {code: "STOPPED"});
      }
      const request = new URL(url);
      const inputMint = request.searchParams.get("inputMint");
      const outputMint = request.searchParams.get("outputMint");
      const amountAtoms = BigInt(request.searchParams.get("amount") ?? "0");
      const entry = inputMint === fixture.candidate.quote;
      const priceMicros = entry ? 5_000_000n : quoteAdapterRequests === 0 ? 5_000_000n : 4_500_000n;
      const inputDecimals = 6n;
      const outputDecimals = 6n;
      const outputAtoms = entry
        ? amountAtoms * 10n ** outputDecimals / priceMicros
        : amountAtoms * priceMicros / 10n ** inputDecimals;
      const wrongIdentity = variant === "WRONG_QUOTE_IDENTITY";
      const quoteBody = syntheticOrderResponse({
        inputMint,
        outputMint,
        inAmount: amountAtoms.toString(),
        outAmount: outputAtoms.toString(),
        otherAmountThreshold: outputAtoms.toString(),
        routePlan: [{
          swapInfo: {
            ammKey: wrongIdentity ? fixture.poolProof.baseVault : fixture.candidate.pool,
            label: "Synthetic AMM",
            inputMint,
            outputMint,
            inAmount: amountAtoms.toString(),
            outAmount: outputAtoms.toString()
          },
          percent: 100,
          bps: 10_000
        }],
        requestId: `synthetic-runtime-order-${quoteAdapterRequests + 1}`
      });
      quoteAdapterRequests += 1;
      const response = JSON.stringify(quoteBody.body);
      chargeRequest(Buffer.byteLength(response));
      return new Response(response, {
        status: variant === "MISSING_QUOTE" ? 503 : 200,
        headers: {"content-type": "application/json"}
      });
    },
    timeoutMs: 1_000,
    maxRequests: Math.max(1, Math.min(100, remaining.requests))
  });
  let quoteAdapterRequests = 0;
  const quote = async ({
    candidate, purpose, position, positionOpenedAt, now, signal: quoteSignal
  }) => {
    if (quoteSignal?.aborted || signal?.aborted || clock.wallClock() >= deadlineAt ||
        usedRequests >= remaining.requests || usedBytes >= remaining.bytes ||
        usedWork >= remaining.work) {
      return null;
    }
    const side = String(purpose).toUpperCase() === "ENTRY" ? "ENTRY" : "EXIT";
    const amountAtoms = side === "ENTRY" ? "10000000" : String(position?.tokenAtoms ?? "");
    const authorizedAt = side === "ENTRY" ? now : positionOpenedAt;
    const adapterResult = await quoteAdapter.getPaperQuote({
      identity: {
        chainId: candidate.chainId,
        mint: candidate.mint,
        pool: candidate.pool,
        quote: candidate.quote,
        decimals: candidate.decimals
      },
      side,
      amountAtoms,
      quoteDecimals: 6,
      candidateSampledAt: candidate.sampledAt,
      ...(side === "ENTRY" ? {authorizedAt} : {positionOpenedAt: authorizedAt}),
      slippageBps: 50
    }, {signal: quoteSignal ?? signal});
    if (signal?.aborted || quoteSignal?.aborted || clock.wallClock() >= deadlineAt) {
      return null;
    }
    const sourceQuote = adapterResult.quoteCandidate;
    const identity = adapterResult.request?.identity;
    const route = sourceQuote?.routeAmounts;
    const routeIdentityValid = sourceQuote?.route?.binding?.status === "SINGLE_POOL_MATCH" &&
      sourceQuote.route.binding.selectedPool === candidate.pool &&
      sourceQuote.identity?.chainId === candidate.chainId &&
      sourceQuote.identity?.mint === candidate.mint &&
      sourceQuote.identity?.pool === candidate.pool &&
      sourceQuote.identity?.quote === candidate.quote &&
      route?.inputMint === (side === "ENTRY" ? candidate.quote : candidate.mint) &&
      route?.outputMint === (side === "ENTRY" ? candidate.mint : candidate.quote);
    const quoteAt = sourceQuote?.receiptTime?.observedAt;
    const causalAt = authorizedAt;
    let paperQuote = null;
    if (routeIdentityValid && Number.isSafeInteger(quoteAt) && quoteAt > causalAt &&
        quoteAt > candidate.sampledAt && quoteAt <= clock.wallClock() &&
        sourceQuote?.status === "UNAVAILABLE" && adapterResult.authorizationEligible === false) {
      const quoteAtoms = BigInt(side === "ENTRY" ? route.inputAtoms : route.outputAtoms);
      const baseAtoms = BigInt(side === "ENTRY" ? route.outputAtoms : route.inputAtoms);
      const numerator = quoteAtoms * 10n ** BigInt(candidate.decimals) * 1_000_000n;
      const denominator = baseAtoms * 10n ** 6n;
      const priceMicros = denominator > 0n ? numerator / denominator : 0n;
      if (priceMicros > 0n && priceMicros <= BigInt(Number.MAX_SAFE_INTEGER)) {
        paperQuote = {
          eventId: sourceQuote.eventId,
          fixtureOnly: true,
          chainId: candidate.chainId,
          mint: candidate.mint,
          pool: candidate.pool,
          quote: candidate.quote,
          decimals: candidate.decimals,
          source: "SYNTHETIC_FIXTURE_ONLY",
          observedAt: quoteAt,
          priceMicros: Number(priceMicros),
          mode: "HYPOTHETICAL",
          executable: true,
          costBasis: FIXTURE_COST_CONTRACT.version,
          costs: {...FIXTURE_COST_CONTRACT.costs}
        };
        if (variant === "MISSING_COSTS") delete paperQuote.costs.networkCents;
      }
    }
    const auditQuote = {
      purpose: side === "ENTRY" ? "entry"
        : String(purpose).includes("risk-exit") || purpose === "RISK_EXIT" ? "risk-exit" : "risk-mark",
      adapterStatus: adapterResult.status,
      adapterReasons: (adapterResult.reasons ?? []).slice(0, 16),
      adapterSourceProvenance: adapterResult.sourceProvenance ?? null,
      adapterAuthorizationEligible: adapterResult.authorizationEligible === true,
      adapterCostStatus: adapterResult.costEvidence?.status ?? "UNKNOWN",
      adapterEventId: sourceQuote?.eventId ?? null,
      observedAt: quoteAt ?? null,
      receiptAt: clock.wallClock(),
      routeIdentityValid,
      causalAt: Number.isSafeInteger(causalAt) ? causalAt : null,
      chronologyValid: Number.isSafeInteger(quoteAt) && quoteAt > causalAt &&
        quoteAt > candidate.sampledAt && quoteAt <= clock.wallClock(),
      identity: identity ?? null,
      selectedPool: sourceQuote?.route?.binding?.selectedPool ?? null,
      paperFillEligible: Boolean(paperQuote &&
        Object.keys(FIXTURE_COST_CONTRACT.costs).every(key => Object.hasOwn(paperQuote.costs, key))),
      paperPriceMicros: paperQuote?.priceMicros ?? null,
      costBasis: paperQuote?.costBasis ?? null,
      costs: paperQuote?.costs ?? null,
      disposition: paperQuote &&
        Object.keys(FIXTURE_COST_CONTRACT.costs).every(key => Object.hasOwn(paperQuote.costs, key))
        ? "PENDING" : "NOT_FILL_ELIGIBLE"
    };
    runtimeAudit.quotes.push(auditQuote);
    return paperQuote;
  };
  attachRuntime();
  return {
    status: evaluation.status,
    reason: evaluation.filters?.status === "PASS" ? null : "FIXTURE_EVIDENCE_NOT_ENTRY_AUTHORITY",
    candidate: runtimeCandidate,
    pipeline: evaluation,
    quote,
    runtimeAudit
  };
}

export function createPaperRuntimeSourceAdapter(options = {}) {
  const allowedOptions = [
    "sourcePolicySha256", "fixtureMode", "clock", "variant", "fixtureBehavior", "warmupStore"
  ];
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
      Object.getOwnPropertySymbols(options).length !== 0 ||
      Object.getOwnPropertyNames(options).some(key => !allowedOptions.includes(key)) ||
      Object.getOwnPropertyNames(options).some(key =>
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key) ?? {}, "value"))) {
    throw new TypeError("runtime source adapter options must be exact bounded data");
  }
  const {
    sourcePolicySha256,
    fixtureMode,
    clock,
    variant = "BASE",
    fixtureBehavior = "NONE"
  } = options;
  const warmupStore = options.warmupStore;
  if (sourcePolicySha256 !== PAPER_RUNTIME_SOURCE_POLICY_SHA256) {
    throw new TypeError("source policy digest does not match the module-owned policy");
  }

  if (fixtureMode !== undefined) {
    const expectedFixtureKeys = warmupStore === undefined
      ? ["clock", "fixtureBehavior", "fixtureMode", "sourcePolicySha256", "variant"]
      : ["clock", "fixtureBehavior", "fixtureMode", "sourcePolicySha256", "variant", "warmupStore"];
    if (fixtureMode !== "SYNTHETIC_TEST_ONLY" ||
        Object.keys(options).sort().join(",") !== expectedFixtureKeys.sort().join(",") ||
        !clock || typeof clock.wallClock !== "function" ||
        typeof clock.advance !== "function" ||
        (warmupStore !== undefined &&
          (fixtureBehavior !== "NONE" || !hasDataMethod(warmupStore, "publish") ||
            !hasDataMethod(warmupStore, "read"))) ||
        !["BASE", "MISSING_QUOTE", "MISSING_COSTS", "WRONG_IDENTITY",
          "FUTURE_EVIDENCE", "WRONG_QUOTE_IDENTITY"].includes(variant) ||
        !["NONE", "WAIT_FOR_STOP", "EXPIRE_DURING_REQUEST", "WAIT_FOR_QUOTE_SETTLE"]
          .includes(fixtureBehavior)) {
      throw new TypeError("fixture runtime source requires exact synthetic-only dependencies");
    }
    const fixtures = new Map();
    return Object.freeze({
      async acquireCandidates({signal, remaining, recordRequest, recordWork, deadlineAt} = {}) {
        const acquired = await acquireSyntheticRuntimeFixture(clock, {
          signal, remaining, recordRequest, recordWork, deadlineAt, variant,
          waitForStop: fixtureBehavior === "WAIT_FOR_STOP",
          waitForQuoteSettle: fixtureBehavior === "WAIT_FOR_QUOTE_SETTLE",
          expireDuringRequest: fixtureBehavior === "EXPIRE_DURING_REQUEST",
          warmupStore
        });
        if (signal?.aborted) {
          return {status: "UNKNOWN", reason: "STOPPED", candidates: [], fixtureOnly: true};
        }
        if (acquired.candidate) fixtures.set(acquired.candidate.mint, acquired);
        return {
          ...acquired,
          status: acquired.candidate ? "SYNTHETIC_FIXTURE_ONLY" : acquired.status,
          candidates: acquired.candidate ? [acquired.candidate] : [],
          fixtureOnly: true
        };
      },
      async quote(request, quoteOptions) {
        const candidate = request?.candidate;
        const fixture = fixtures.get(candidate?.mint);
        if (!fixture?.quote || !candidate ||
            ["chainId", "mint", "pool", "quote", "decimals"].some(key =>
              candidate[key] !== fixture.candidate[key])) return null;
        return fixture.quote(request, quoteOptions);
      }
    });
  }

  if (Object.keys(options).sort().join(",") !== "sourcePolicySha256") {
    throw new TypeError("production runtime source options are not injectable");
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
        implementationStatus: "BLOCKED_NOT_IMPLEMENTED",
        networkAccessed: false
      };
    },
    async quote(request, options) {
      return quoteAdapter.getPaperQuote(request, options);
    }
  });
}
