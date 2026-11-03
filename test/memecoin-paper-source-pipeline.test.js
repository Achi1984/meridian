import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {
  createTimeBoundarySource
} from "../scripts/memecoin-paper/history-time-boundary-source.mjs";
import {
  createHistoryWindowSource,
  timestampEvidenceDigest
} from "../scripts/memecoin-paper/history-window-bridge.mjs";
import {
  createBoundedHistoryRpcReader,
  SOLANA_RPC_ORIGIN
} from "../scripts/memecoin-paper/launch-history-source.mjs";
import {ANALYST_WINDOW_METRICS} from "../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {createPaperSourcePipeline} from "../scripts/memecoin-paper/paper-source-pipeline.mjs";
import {makeFixture} from "./fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs";

const RPC_SOURCE = "Solana JSON-RPC";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rpcResponse(request, result, rawResponses = null) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: JSON.parse(request.body).id,
    result
  });
  rawResponses?.push(body);
  return new Response(body, {
    status: 200,
    headers: {"content-type": "application/json"}
  });
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

function rpcHarness(fixture, {
  hang = false,
  range = [490_000, 490_006],
  latency = 0,
  beforeResponse
} = {}) {
  const times = slotTimes(fixture.candidateT);
  const calls = [];
  const rawResponses = [];
  const transport = async request => {
    const body = JSON.parse(request.body);
    calls.push({url: request.url, method: body.method, params: body.params});
    assert.equal(request.url, SOLANA_RPC_ORIGIN);
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
    if (hang) return new Promise(() => {});
    await beforeResponse?.(request);
    if (latency > 0) await new Promise(resolve => setTimeout(resolve, latency));
    if (body.method === "getSlot") return rpcResponse(request, range[1] + 10, rawResponses);
    if (body.method === "getBlocks") {
      return rpcResponse(request, [490_000, 490_001, 490_003, 490_004, 490_006]
        .filter(slot => slot >= body.params[0] && slot <= body.params[1]), rawResponses);
    }
    if (body.method === "getBlockTime") {
      return rpcResponse(request, times.get(body.params[0]) ?? null, rawResponses);
    }
    if (body.method === "getSignaturesForAddress") return rpcResponse(request, [], rawResponses);
    throw new Error(`unexpected RPC method ${body.method}`);
  };
  return {transport, calls, rawResponses};
}

function requested(fixture) {
  return {
    startExclusiveMs: fixture.candidateT - 3_600_000,
    endInclusiveMs: fixture.candidateT
  };
}

function timeSource(fixture, options = {}) {
  const harness = rpcHarness(fixture, options);
  const source = createTimeBoundarySource({
    enabled: true,
    slotRange: options.slotRange ?? {startInclusive: 490_000, endInclusive: 490_006},
    transport: harness.transport,
    clock: () => fixture.assembledAt,
    limits: options.limits
  });
  return {...harness, source};
}

function fixtureCollector(request, receivedAt) {
  const raw = JSON.stringify({status: "fixture-collector-response"});
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

function boundaryRowsCollector(request, receivedAt, fixture) {
  const collector = fixtureCollector(request, receivedAt);
  const times = slotTimes(fixture.candidateT);
  const slots = [490_001, 490_003, 490_004, 490_006];
  collector.signatures = slots.map((slot, index) => ({
    signature: `fixture-boundary-signature-${index}`,
    slot,
    blockTime: times.get(slot),
    err: null,
    errorStatus: null,
    subjectAddresses: [request.identity.pool]
  }));
  collector.transactions = collector.signatures.map(signature => ({
    signature: signature.signature,
    slot: signature.slot,
    blockTime: signature.blockTime,
    subjectAddresses: [request.identity.pool],
    status: "SUCCESS",
    version: "legacy",
    transaction: {signatures: [signature.signature], message: {instructions: []}},
    meta: {err: null}
  }));
  collector.counters.signatures = collector.signatures.length;
  collector.counters.successfulTransactions = collector.transactions.length;
  collector.counters.workUnits += collector.transactions.length;
  return collector;
}

function poolProofFor(fixture) {
  return fixture.poolProof;
}

function sourcePipeline(fixture, {
  mode = "SYNTHETIC_TEST_ONLY",
  collector,
  limits = {},
  clock = () => fixture.assembledAt,
  latency = 0,
  beforeResponse
} = {}) {
  const harness = rpcHarness(fixture, {latency, beforeResponse});
  return createPaperSourcePipeline({
    enabled: true,
    mode,
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    transport: harness.transport,
    clock,
    limits,
    ...(collector ? {
      historySlotCollector: request => collector(request, fixture.assembledAt)
    } : {})
  });
}

function reviews(candidateT) {
  return Object.fromEntries(ANALYST_WINDOW_METRICS.map(key => [key, {
    status: "REVIEWED",
    reviewerId: "offline-fixture-reviewer",
    reviewId: `offline-${key}`,
    reviewedAt: candidateT - 1
  }]));
}

test("disabled source and pipeline are inert", async () => {
  let calls = 0;
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const source = createTimeBoundarySource({
    slotRange: {startInclusive: 1, endInclusive: 5},
    transport: () => { calls += 1; },
    clock: () => fixture.assembledAt
  });
  assert.equal((await source.readWindow({
    identity: fixture.identity,
    requested: requested(fixture),
    poolProof: fixture.poolProof
  })).reason, "DISABLED");
  assert.equal(calls, 0);

  const pipeline = createPaperSourcePipeline();
  assert.equal((await pipeline.evaluate({providerCandidate: fixture.candidate})).reason, "DISABLED");
  assert.equal(calls, 0);
});

test("enumerates produced slots, accounts for skipped slots, and hashes actual bounded RPC responses", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const {source, calls, rawResponses} = timeSource(fixture);
  const result = await source.readWindow({
    identity: fixture.identity,
    requested: requested(fixture),
    poolProof: fixture.poolProof
  });
  assert.equal(result.status, "SOURCE_BOUND", result.reason);
  assert.deepEqual(result.coverage.slotEnumeration.producedSlots, [
    490_000, 490_001, 490_003, 490_004, 490_006
  ]);
  assert.deepEqual(result.coverage.slotEnumeration.skippedRanges, [
    {startInclusive: 490_002, endInclusive: 490_002},
    {startInclusive: 490_005, endInclusive: 490_005}
  ]);
  assert.deepEqual(result.timeBounds.startExclusive, {
    before: {slot: 490_001, blockTime: slotTimes(fixture.candidateT).get(490_001)},
    after: {slot: 490_003, blockTime: slotTimes(fixture.candidateT).get(490_003)}
  });
  assert.equal(result.timeBounds.endInclusive.before.slot, 490_004);
  assert.equal(result.timeBounds.endInclusive.after.slot, 490_006);
  assert.equal(result.events.length, 5);
  assert.equal(result.counters.requests, 5);
  assert.equal(result.counters.workUnits, 14);
  assert.ok(result.events.every(event => /^[a-f0-9]{64}$/.test(event.responseSha256)));
  assert.deepEqual(result.events.map(event => event.responseSha256), rawResponses.slice(2).map(hash));
  assert.equal(result.counters.bytes, rawResponses.reduce((sum, body) =>
    sum + Buffer.byteLength(body), 0) -
    rawResponses.slice(0, 2).reduce((sum, body) => sum + Buffer.byteLength(body), 0));
  assert.equal(result.coverage.auxiliaryEvents.length, 2);
  assert.equal(result.coverage.auxiliaryCounters.requests, 2);
  assert.ok(result.events.every(event => event.responseReceivedAt === fixture.assembledAt));
  assert.equal(result.receipt.receivedAt, fixture.assembledAt);
  assert.deepEqual(calls.map(call => call.method), [
    "getSlot", "getBlocks", "getBlockTime", "getBlockTime", "getBlockTime",
    "getBlockTime", "getBlockTime"
  ]);
  assert.deepEqual(calls[1].params, [
    490_000, 490_006, {commitment: "finalized"}
  ]);
  assert.equal(result.receipt.status, "SOURCE_BOUND");
  assert.equal(result.receipt.payloadSha256, timestampEvidenceDigest(result));
  assert.equal(result.coverage.sourceAuthentication, "NOT_ESTABLISHED");
});

test("missing, regressing, or out-of-range slot timestamps remain UNKNOWN", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const missing = timeSource(fixture);
  const missingTransport = missing.transport;
  missing.source = createTimeBoundarySource({
    enabled: true,
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    clock: () => fixture.assembledAt,
    transport: async request => {
      const call = JSON.parse(request.body);
      if (call.method === "getBlockTime" && call.params[0] === 490_004) {
        return rpcResponse(request, null);
      }
      return missingTransport(request);
    }
  });
  const absent = await missing.source.readWindow({
    identity: fixture.identity, requested: requested(fixture), poolProof: fixture.poolProof
  });
  assert.equal(absent.status, "UNKNOWN");
  assert.equal(absent.reason, "BLOCK_TIME_UNAVAILABLE");
  assert.deepEqual(absent.slotEnumeration.unavailableSlots, [490_004]);
  assert.deepEqual(absent.slotEnumeration.unresolvedSlots, [490_006]);

  const regressing = timeSource(fixture);
  const baseTransport = regressing.transport;
  const regressionSource = createTimeBoundarySource({
    enabled: true,
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    clock: () => fixture.assembledAt,
    transport: async request => {
      const call = JSON.parse(request.body);
      if (call.method === "getBlockTime" && call.params[0] === 490_004) {
        return rpcResponse(request, slotTimes(fixture.candidateT).get(490_003) - 1);
      }
      return baseTransport(request);
    }
  });
  const backwards = await regressionSource.readWindow({
    identity: fixture.identity, requested: requested(fixture), poolProof: fixture.poolProof
  });
  assert.equal(backwards.status, "UNKNOWN");
  assert.equal(backwards.reason, "BLOCK_TIME_REGRESSION");
  assert.deepEqual(backwards.slotEnumeration.unavailableSlots, [490_004]);

  await t.test("narrow configured slot range", async () => {
    const narrow = timeSource(fixture, {
      slotRange: {startInclusive: 490_001, endInclusive: 490_004}
    });
    const result = await narrow.source.readWindow({
      identity: fixture.identity,
      requested: requested(fixture),
      poolProof: {...fixture.poolProof, slot: 490_001}
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "SLOT_RANGE_DOES_NOT_COVER_TIME_WINDOW");
  });
});

test("boundary digest and identity mismatches fail closed before collector invocation", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const time = timeSource(fixture);
  const evidence = await time.source.readWindow({
    identity: fixture.identity,
    requested: requested(fixture),
    poolProof: fixture.poolProof
  });
  let collectorCalls = 0;
  const source = createHistoryWindowSource({
    enabled: true,
    timeBoundarySource: {
      async readWindow() {
        const changed = structuredClone(evidence);
        changed.timeBounds.startExclusive.after.blockTime += 1;
        return changed;
      }
    },
    slotHistoryCollector: () => {
      collectorCalls += 1;
      return fixtureCollector;
    }
  });
  const tampered = await source.readWindow({
    identity: fixture.identity,
    poolProof: fixture.poolProof,
    ...requested(fixture)
  });
  assert.equal(tampered.status, "UNKNOWN");
  assert.equal(tampered.reason, "TIME_BOUNDARY_RECEIPT_UNKNOWN");
  assert.equal(collectorCalls, 0);

  await t.test("pool proof identity mismatch", async () => {
    const wrongIdentity = {
      ...fixture.poolProof,
      pool: "SysvarRent111111111111111111111111111111111"
    };
    const result = await time.source.readWindow({
      identity: fixture.identity,
      requested: requested(fixture),
      poolProof: wrongIdentity
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "INVALID_OR_UNBOUND_REQUEST");
  });
});

test("receipt-bound collector handoff uses start-exclusive and end-inclusive timestamps", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const time = timeSource(fixture);
  const source = createHistoryWindowSource({
    enabled: true,
    timeBoundarySource: time.source,
    slotHistoryCollector: request =>
      boundaryRowsCollector(request, fixture.assembledAt, fixture)
  });
  const result = await source.readWindow({
    identity: fixture.identity,
    poolProof: fixture.poolProof,
    ...requested(fixture)
  });
  assert.equal(result.status, "COMPLETE", result.reason);
  assert.equal(result.receipt.status, "SOURCE_BOUND");
  assert.deepEqual(result.transactions.map(row => [row.slot, row.observedAt]), [
    [490_003, (fixture.candidateT - 3_600_000 + 1_000)],
    [490_004, fixture.candidateT]
  ]);
  assert.equal(result.coverage.sourceAuthentication, "NOT_ESTABLISHED");
  assert.equal(result.coverage.archivalRetention, "NOT_ESTABLISHED");
});

test("bounded RPC reader restricts method allowlist and enforces cumulative request limits", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const harness = rpcHarness(fixture);
  const reader = createBoundedHistoryRpcReader({
    transport: harness.transport,
    clock: () => fixture.assembledAt,
    limits: {maxRequests: 1}
  });
  assert.equal((await reader.read({method: "getSlot", params: [{commitment: "finalized"}]})).ok, true);
  assert.equal((await reader.read({
    method: "getBlocks",
    params: [1, 2, {commitment: "finalized"}]
  })).status, "REQUEST_LIMIT");
  assert.equal((await reader.read({method: "getSignaturesForAddress", params: []})).status,
    "METHOD_NOT_ALLOWED");
  assert.equal(harness.calls.length, 1);
});

test("request, byte, work, and shared collector budgets are cumulative", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  await t.test("request budget", async () => {
    const harness = rpcHarness(fixture);
    const source = createTimeBoundarySource({
      enabled: true,
      slotRange: {startInclusive: 490_000, endInclusive: 490_006},
      transport: harness.transport,
      clock: () => fixture.assembledAt,
      limits: {maxRequests: 6}
    });
    const result = await source.readWindow({
      identity: fixture.identity,
      requested: requested(fixture),
      poolProof: fixture.poolProof
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "TIME_OR_WORK_LIMIT");
    assert.equal(harness.calls.length, 6);
  });

  await t.test("cumulative byte budget", async () => {
    const harness = rpcHarness(fixture);
    const source = createTimeBoundarySource({
      enabled: true,
      slotRange: {startInclusive: 490_000, endInclusive: 490_006},
      transport: harness.transport,
      clock: () => fixture.assembledAt,
      limits: {maxBytesPerResponse: 200, maxBytesPerRun: 200}
    });
    const result = await source.readWindow({
      identity: fixture.identity,
      requested: requested(fixture),
      poolProof: fixture.poolProof
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "RESPONSE_TOO_LARGE");
  });

  await t.test("slot work budget", async () => {
    const harness = rpcHarness(fixture);
    const source = createTimeBoundarySource({
      enabled: true,
      slotRange: {startInclusive: 490_000, endInclusive: 490_006},
      transport: harness.transport,
      clock: () => fixture.assembledAt,
      limits: {maxWorkUnits: 13}
    });
    const result = await source.readWindow({
      identity: fixture.identity,
      requested: requested(fixture),
      poolProof: fixture.poolProof
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "WORK_LIMIT");
  });

  await t.test("boundary and collector share the request budget", async () => {
    const harness = rpcHarness(fixture);
    const time = createTimeBoundarySource({
      enabled: true,
      slotRange: {startInclusive: 490_000, endInclusive: 490_006},
      transport: harness.transport,
      clock: () => fixture.assembledAt
    });
    let collectorCalls = 0;
    const source = createHistoryWindowSource({
      enabled: true,
      timeBoundarySource: time,
      slotHistoryCollector: () => {
        collectorCalls += 1;
        return fixtureCollector;
      },
      limits: {maxRequests: 5}
    });
    const result = await source.readWindow({
      identity: fixture.identity,
      poolProof: fixture.poolProof,
      ...requested(fixture)
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "TIME_BOUNDARY_RECEIPT_UNKNOWN");
    assert.equal(collectorCalls, 0);
  });
});

test("time limits and abort prevent an unsettled RPC callback from escaping", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const hanging = rpcHarness(fixture, {hang: true});
  const source = createTimeBoundarySource({
    enabled: true,
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    transport: hanging.transport,
    clock: () => fixture.assembledAt,
    limits: {
      maxElapsedMs: 40,
      maxDurationMs: 40,
      requestTimeoutMs: 10
    }
  });
  const timedOut = await source.readWindow({
    identity: fixture.identity,
    requested: requested(fixture),
    poolProof: fixture.poolProof
  });
  assert.equal(timedOut.status, "UNKNOWN");
  assert.ok(["TIMEOUT", "TIME_LIMIT"].includes(timedOut.reason));

  await t.test("abort", async () => {
    const controller = new AbortController();
    const aborted = source.readWindow({
      identity: fixture.identity,
      requested: requested(fixture),
      poolProof: fixture.poolProof,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 5);
    const result = await aborted;
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "CANCELLED");
  });
});

test("fixture-trusted window reaches the canonical Analyst adapter only in synthetic mode", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const pipeline = sourcePipeline(fixture, {collector: fixtureCollector});
  const result = await pipeline.evaluate({
    providerCandidate: fixture.candidate,
    evidence: {},
    candidateT: fixture.candidateT,
    policy: fixture.policy,
    poolProof: poolProofFor(fixture),
    censusSource: fixture.censusSource,
    priceSource: fixture.priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist,
    reviewEvidence: reviews(fixture.candidateT),
    holdUntil: fixture.decisionAt + 8 * 60 * 60 * 1_000
  });
  assert.equal(result.mode, "SYNTHETIC_TEST_ONLY");
  assert.equal(result.analystEvidence.metrics.uniqueBuyers1h.value, 0);
  assert.equal(result.analystEvidence.metrics.uniqueBuyers1h.coverage.complete, true);
  assert.equal(result.candidate.chainId, "solana");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.realDataEntryEligible, false);
  assert.equal(result.auditReceipts.history?.id, result.auditReceipts.acquisition[0]?.receipt?.id);
  assert.equal(result.auditReceipts.acquisition[0]?.receipt?.status, "SOURCE_BOUND");
  assert.equal(result.auditReceipts.acquisition[0]?.coverage.sourceHistoryCompleteness, "COMPLETE");
  assert.equal(result.candidateT, fixture.candidateT);
  assert.equal(result.assembledAt, fixture.assembledAt);
  assert.equal(result.decisionAt, fixture.assembledAt);
});

test("actual collector archival UNKNOWN stays UNKNOWN and external mode rejects fixture trust", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  let now = fixture.assembledAt;
  const clock = () => {
    now += 1;
    return now;
  };
  const externalCandidate = Object.fromEntries([
    "chainId", "mint", "pool", "quote", "sampledAt", "pairCreatedAt",
    "marketCapUsd", "decimals", "tokenSupplyAtoms"
  ].map(key => [key, fixture.candidate[key]]));
  externalCandidate.source = "DexScreener public API";
  externalCandidate.evidence = {};
  const externalPoolProof = {
    ...fixture.poolProof,
    source: "Reviewed pool source",
    receipt: {...fixture.poolProof.receipt, source: "Reviewed pool source"}
  };
  const externalPolicy = {
    ...fixture.policy,
    historicalPriceTrust: null,
    censusPolicy: null,
    walletQualification: null
  };
  const pipeline = sourcePipeline(fixture, {
    mode: "EXTERNAL_READ_ONLY_INPUT",
    clock,
    latency: 2
  });
  const result = await pipeline.evaluate({
    providerCandidate: externalCandidate,
    evidence: {},
    policy: externalPolicy,
    poolProof: externalPoolProof,
    reviewEvidence: reviews(fixture.candidateT)
  });
  assert.equal(result.mode, "EXTERNAL_READ_ONLY_INPUT");
  assert.equal(result.analystEvidence.metrics.uniqueBuyers1h, undefined);
  assert.equal(result.analystEvidence.unavailableMetrics.uniqueBuyers1h.status, "UNAVAILABLE");
  assert.equal(result.auditReceipts.history, null);
  assert.equal(result.auditReceipts.acquisition[0]?.reason,
    "COLLECTOR_HISTORY_COMPLETENESS_UNKNOWN");
  assert.equal(result.auditReceipts.acquisition[0]?.collectorCoverage.sourceHistoryCompleteness,
    "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION");
  assert.equal(result.auditReceipts.acquisition[0]?.sourceReceipts.timeBoundaries.length, 5);
  assert.equal(result.auditReceipts.acquisition[0]?.timeBoundaryCoverage.auxiliaryEvents.length, 2);
  assert.ok(result.auditReceipts.acquisition[0]?.sourceReceipts.collector.length > 0);
  assert.equal(result.auditReceipts.acquisition[0]?.counters.requests, 9);
  const sourceEvents = [
    ...result.auditReceipts.acquisition[0].sourceReceipts.timeBoundaries,
    ...result.auditReceipts.acquisition[0].sourceReceipts.collector
  ];
  assert.ok(sourceEvents.every(event => event.responseReceivedAt < result.assembledAt));
  assert.ok(result.assembledAt > fixture.assembledAt);
  assert.equal(result.analystEvidence.assembledAt, result.assembledAt);
  assert.equal(result.analystEvidence.candidateT, fixture.candidateT);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.realDataEntryEligible, false);
  assert.equal(result.candidate.source, "DexScreener public API");
  assert.throws(() => createPaperSourcePipeline({
    enabled: true,
    mode: "EXTERNAL_READ_ONLY_INPUT",
    slotRange: {startInclusive: 490_000, endInclusive: 490_006},
    transport: () => {},
    clock,
    historySlotCollector: () => fixtureCollector
  }), /custom history collectors are limited to synthetic test mode/);
});

test("overlapping pipeline evaluations are explicitly rejected", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  let release;
  let announceStarted;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { announceStarted = resolve; });
  let blocked = false;
  const pipeline = sourcePipeline(fixture, {
    collector: fixtureCollector,
    beforeResponse: async () => {
      if (blocked) return;
      blocked = true;
      announceStarted();
      await gate;
    }
  });
  const request = {
    providerCandidate: fixture.candidate,
    evidence: {},
    candidateT: fixture.candidateT,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    censusSource: fixture.censusSource,
    priceSource: fixture.priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist,
    reviewEvidence: reviews(fixture.candidateT),
    holdUntil: fixture.decisionAt + 8 * 60 * 60 * 1_000
  };
  const first = pipeline.evaluate(request);
  await started;
  const overlapping = await pipeline.evaluate(request);
  assert.equal(overlapping.status, "UNKNOWN");
  assert.equal(overlapping.reason, "EVALUATION_IN_PROGRESS");
  release();
  const result = await first;
  assert.equal(result.mode, "SYNTHETIC_TEST_ONLY");
  assert.equal(result.auditReceipts.acquisition.length, 1);
});

test("price and census source receipts completed after prefetch start are accepted only after assembly", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  let now = fixture.assembledAt;
  const priceReceivedAt = [];
  const censusReceivedAt = [];
  const priceSource = {
    async readObservation(request) {
      now += 10;
      const result = structuredClone(await fixture.priceSource.readObservation(request));
      result.receivedAt = now;
      result.receipt.receivedAt = now;
      priceReceivedAt.push(now);
      return result;
    }
  };
  const censusSource = {
    async readSnapshots(request) {
      now += 10;
      const result = structuredClone(await fixture.censusSource.readSnapshots(request));
      for (const snapshot of result.snapshots) {
        snapshot.receivedAt = now;
        snapshot.receipt.receivedAt = now;
      }
      censusReceivedAt.push(now);
      return result;
    }
  };
  const pipeline = sourcePipeline(fixture, {
    collector: fixtureCollector,
    clock: () => now
  });
  const result = await pipeline.evaluate({
    providerCandidate: fixture.candidate,
    evidence: {},
    candidateT: fixture.candidateT,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    censusSource,
    priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist,
    reviewEvidence: reviews(fixture.candidateT),
    holdUntil: fixture.decisionAt + 8 * 60 * 60 * 1_000
  });
  assert.ok(priceReceivedAt.length >= 2);
  assert.equal(censusReceivedAt.length, 1);
  assert.ok(priceReceivedAt.every(receivedAt => receivedAt > fixture.assembledAt));
  assert.ok(censusReceivedAt.every(receivedAt => receivedAt > fixture.assembledAt));
  assert.ok([...priceReceivedAt, ...censusReceivedAt]
    .every(receivedAt => receivedAt <= result.assembledAt));
  assert.ok(result.assembledAt > fixture.assembledAt);
  assert.equal(result.analystEvidence.metrics.momentum15m?.coverage.exactEndpoints, true);
  assert.equal(result.analystEvidence.metrics.holderGrowthPct1h?.coverage.exactEndpoints, true);
  assert.ok(result.analystEvidence.receipts.prices.length >= 2);
  assert.equal(result.analystEvidence.receipts.census.length, 2);
  assert.equal(result.candidate.chainId, fixture.candidate.chainId);
  assert.equal(result.executionAuthorized, false);
});

test("late collector completion after timeout cannot overwrite the next evaluation audit", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  let releaseFirst;
  let releaseSecond;
  let announceFirst;
  let announceSecond;
  const firstStarted = new Promise(resolve => { announceFirst = resolve; });
  const secondStarted = new Promise(resolve => { announceSecond = resolve; });
  const firstPending = new Promise(resolve => { releaseFirst = resolve; });
  const secondPending = new Promise(resolve => { releaseSecond = resolve; });
  let collectorCall = 0;
  const collector = request => {
    collectorCall += 1;
    if (collectorCall === 1) {
      announceFirst();
      return firstPending.then(() => ({
        ...fixtureCollector(request, fixture.assembledAt),
        coverage: {...fixtureCollector(request, fixture.assembledAt).coverage, auditMarker: "A"}
      }));
    }
    announceSecond();
    return secondPending.then(() => ({
      ...fixtureCollector(request, fixture.assembledAt),
      coverage: {...fixtureCollector(request, fixture.assembledAt).coverage, auditMarker: "B"}
    }));
  };
  const pipeline = sourcePipeline(fixture, {
    collector,
    limits: {maxElapsedMs: 100, maxDurationMs: 100, requestTimeoutMs: 20}
  });
  const request = {
    providerCandidate: fixture.candidate,
    evidence: {},
    candidateT: fixture.candidateT,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    reviewEvidence: reviews(fixture.candidateT)
  };

  const firstEvaluation = pipeline.evaluate(request);
  await firstStarted;
  const first = await firstEvaluation;
  assert.equal(first.auditReceipts.acquisition[0]?.collectorCoverage.auditMarker, undefined);
  assert.equal(first.auditReceipts.acquisition[0]?.sourceReceipts.collector.length, 0);

  const secondEvaluation = pipeline.evaluate(request);
  await secondStarted;
  releaseFirst();
  await new Promise(resolve => setImmediate(resolve));
  const second = await secondEvaluation;
  assert.notEqual(second.analystEvidence.status, "COMPLETE");
  assert.equal(second.auditReceipts.acquisition[0]?.collectorCoverage.auditMarker, undefined);
  assert.equal(second.auditReceipts.acquisition[0]?.sourceReceipts.collector.length, 0);
  assert.equal(second.auditReceipts.acquisition[0]?.counters.requests, 7);
  assert.equal(second.auditReceipts.acquisition[0]?.reason, "TIME_LIMIT");
  releaseSecond();
});
