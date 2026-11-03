import {createHash} from "node:crypto";
import {
  createBirdeyeSource,
  createHeliusSource
} from "../../../scripts/memecoin-paper/provider-sources/index.mjs";
import {
  createPaperSourcePipeline
} from "../../../scripts/memecoin-paper/paper-source-pipeline.mjs";
import {
  SOLANA_RPC_ORIGIN
} from "../../../scripts/memecoin-paper/launch-history-source.mjs";
import {
  ANALYST_WINDOW_METRICS
} from "../../../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {makeFixture} from "../memecoin-paper-analyst-window-evidence/source-shaped.mjs";
import {
  SYNTHETIC_PROVIDER_SECRET,
  jsonResponse,
  jsonRpcResponse,
  syntheticPriceResponse,
  syntheticTransaction
} from "../memecoin-paper-provider-sources/synthetic.mjs";

const RPC_SOURCE = "Solana JSON-RPC";

export function makeHandoffFixture() {
  return makeFixture({buyCount: 0, sellCount: 0});
}

export async function makeBirdeyeObservation(fixture, overrides = {}, {
  value = 0.00042,
  isScaledUiToken = false,
  updateUnixTime,
  success = true,
  omitUpdateUnixTime = false
} = {}) {
  const calls = [];
  const request = {
    mint: fixture.candidate.mint,
    atMs: fixture.candidateT,
    denomination: "USD",
    purpose: "paper-warmup-offline-test",
    ...overrides
  };
  const source = createBirdeyeSource({
    enabled: true,
    secret: SYNTHETIC_PROVIDER_SECRET,
    clock: () => fixture.assembledAt,
    transport: async wireRequest => {
      calls.push(wireRequest);
      const url = new URL(wireRequest.url);
      const requestedTime = Number(url.searchParams.get("unixtime"));
      const response = syntheticPriceResponse({
        value,
        isScaledUiToken,
        updateUnixTime: Number.isSafeInteger(updateUnixTime)
          ? updateUnixTime
          : Number.isSafeInteger(requestedTime)
            ? requestedTime : Math.floor(fixture.candidateT / 1_000),
        success
      });
      if (omitUpdateUnixTime) delete response.data.updateUnixTime;
      return jsonResponse(response, {url: wireRequest.url});
    }
  });
  return {
    request,
    observation: await source.readObservation(request),
    calls
  };
}

export async function makeHeliusDiagnostic(fixture, method = "history") {
  const calls = [];
  const source = createHeliusSource({
    enabled: true,
    secret: SYNTHETIC_PROVIDER_SECRET,
    clock: () => fixture.assembledAt,
    transport: async request => {
      calls.push(request);
      const body = JSON.parse(request.body);
      const result = body.method === "getTransactionsForAddress"
        ? {
            data: [syntheticTransaction({
              signature: "handoff-synthetic-history",
              slot: 490_004,
              blockTime: Math.floor(fixture.candidateT / 1_000)
            })],
            paginationToken: null
          }
        : {
            context: {slot: 490_004},
            value: {accounts: [], paginationKey: null}
          };
      return jsonRpcResponse(request, result);
    }
  });
  const envelope = method === "history"
    ? await source.getTransactionsForAddress({
        address: fixture.candidate.mint,
        limit: 1,
        startSlot: 490_000,
        endSlot: 490_006
      })
    : await source.getProgramAccountsV2({
        programId: fixture.candidate.pool,
        filters: [],
        pageSize: 1,
        minContextSlot: 490_004
      });
  return {envelope, calls};
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function slotTimes(candidateT) {
  const start = candidateT - 3_600_000;
  return new Map([
    [490_000, Math.floor((start - 1_000) / 1_000)],
    [490_001, Math.floor(start / 1_000)],
    [490_003, Math.floor((start + 1_000) / 1_000)],
    [490_004, Math.floor(candidateT / 1_000)],
    [490_006, Math.floor((candidateT + 1_000) / 1_000)]
  ]);
}

function rpcTransport(fixture) {
  const times = slotTimes(fixture.candidateT);
  return async request => {
    const body = JSON.parse(request.body);
    if (body.method === "getSlot") {
      return jsonRpcResponse(request, 490_016);
    }
    if (body.method === "getBlocks") {
      return jsonRpcResponse(request, [490_000, 490_001, 490_003, 490_004, 490_006]
        .filter(slot => slot >= body.params[0] && slot <= body.params[1]));
    }
    if (body.method === "getBlockTime") {
      return jsonRpcResponse(request, times.get(body.params[0]) ?? null);
    }
    if (body.method === "getSignaturesForAddress") {
      return jsonRpcResponse(request, []);
    }
    throw new Error(`unexpected synthetic RPC method ${body.method}`);
  };
}

function historyFixtureCollector(request, receivedAt) {
  const raw = JSON.stringify({status: "existing-source-shaped-history-fixture"});
  const events = [{
    origin: SOLANA_RPC_ORIGIN,
    method: "getSlot",
    requestStartedAt: receivedAt,
    responseReceivedAt: receivedAt,
    responseBytes: Buffer.byteLength(raw),
    responseSha256: hash(raw),
    status: "RESPONSE_RECEIVED"
  }];
  return {
    sourceVersion: "solana-launch-history-source-v1",
    source: RPC_SOURCE,
    rpcOrigin: SOLANA_RPC_ORIGIN,
    commitment: "finalized",
    declaredSubjects: request.subjects,
    slotInterval: {startInclusive: request.startSlot, endInclusive: request.endSlot},
    signatures: [],
    transactions: [],
    events,
    counters: {
      requests: events.length,
      bytes: events[0].responseBytes,
      workUnits: events.length,
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
}

export function makeSyntheticHistoryPipeline(fixture) {
  return createPaperSourcePipeline({
    enabled: true,
    mode: "SYNTHETIC_TEST_ONLY",
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    transport: rpcTransport(fixture),
    clock: () => fixture.assembledAt,
    historySlotCollector: request => historyFixtureCollector(request, fixture.assembledAt)
  });
}

export function evaluationRequest(fixture) {
  return {
    providerCandidate: fixture.candidate,
    evidence: {},
    candidateT: fixture.candidateT,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    censusSource: fixture.censusSource,
    priceSource: fixture.priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist,
    reviewEvidence: Object.fromEntries(ANALYST_WINDOW_METRICS.map(key => [key, {
      status: "REVIEWED",
      reviewerId: "offline-handoff-reviewer",
      reviewId: `offline-handoff-${key}`,
      reviewedAt: fixture.candidateT - 1
    }])),
    holdUntil: fixture.decisionAt + 8 * 60 * 60 * 1_000
  };
}
