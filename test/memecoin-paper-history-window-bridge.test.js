import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {buildAnalystWindowEvidence} from "../scripts/memecoin-paper/analyst-window-evidence.mjs";
import {
  acquireLaunchHistory
} from "../scripts/memecoin-paper/launch-history-source.mjs";
import {
  canonicalHistoryDigest,
  createHistoryWindowSource,
  timestampEvidenceDigest
} from "../scripts/memecoin-paper/history-window-bridge.mjs";
import {
  makeFixture,
  makeSwap
} from "./fixtures/memecoin-paper-analyst-window-evidence/source-shaped.mjs";

const RPC_SOURCE = "Solana JSON-RPC";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceEvent(method, payload, receivedAt) {
  const raw = JSON.stringify(payload);
  return {
    method,
    status: "RESPONSE_RECEIVED",
    responseBytes: Buffer.byteLength(raw),
    responseReceivedAt: receivedAt,
    responseSha256: hash(raw)
  };
}

function makeTimeEvidence({identity, requested, assembledAt, bounds = {}}) {
  const beforeStart = Math.floor(requested.startExclusiveMs / 1000);
  const afterStart = beforeStart + 1;
  const beforeEnd = Math.floor(requested.endInclusiveMs / 1000);
  const afterEnd = beforeEnd + 1;
  const evidence = {
    status: "SOURCE_BOUND",
    source: RPC_SOURCE,
    identity: {...identity},
    requested: {...requested},
    timeBounds: {
      receiptId: "time-boundary-fixture-1",
      startExclusive: {
        before: {slot: 100, blockTime: beforeStart},
        after: {slot: 101, blockTime: afterStart}
      },
      endInclusive: {
        before: {slot: 200, blockTime: beforeEnd},
        after: {slot: 201, blockTime: afterEnd}
      },
      ...bounds
    },
    coverage: {
      complete: true,
      monotonicSlots: true,
      scope: "selected-pool-inclusive-slot-range"
    },
    events: [
      sourceEvent("getBlockTime", {slot: 100, blockTime: beforeStart}, assembledAt),
      sourceEvent("getBlockTime", {slot: 101, blockTime: afterStart}, assembledAt),
      sourceEvent("getBlockTime", {slot: 200, blockTime: beforeEnd}, assembledAt),
      sourceEvent("getBlockTime", {slot: 201, blockTime: afterEnd}, assembledAt)
    ]
  };
  evidence.receipt = {
    status: "SOURCE_BOUND",
    id: evidence.timeBounds.receiptId,
    source: evidence.source,
    payloadSha256: timestampEvidenceDigest(evidence),
    receivedAt: assembledAt
  };
  return evidence;
}

function makeSlotRow(sourceRow, slot, identity) {
  return {
    signature: sourceRow.signature,
    slot,
    blockTime: sourceRow.blockTime,
    subjectAddresses: [identity.pool],
    status: "SUCCESS",
    version: "legacy",
    transaction: sourceRow.transaction,
    meta: sourceRow.meta ?? sourceRow.transaction.meta
  };
}

function makeCollectorResult(request, rows, {
  sourceHistoryCompleteness = "COMPLETE",
  slotInterval = {startInclusive: request.startSlot, endInclusive: request.endSlot},
  transactions = rows.map((row, index) => makeSlotRow(row, 101 + index, request.identity))
} = {}) {
  const signatures = transactions.map(row => ({
    signature: row.signature,
    slot: row.slot,
    blockTime: row.blockTime,
    err: null,
    errorStatus: null,
    subjectAddresses: [request.identity.pool]
  }));
  const events = [
    sourceEvent("getSlot", {slot: slotInterval.endInclusive}, request.assembledAt),
    sourceEvent("getSignaturesForAddress", signatures, request.assembledAt),
    ...transactions.map(row => sourceEvent(
      "getTransaction", row, request.assembledAt
    ))
  ];
  return {
    sourceVersion: "solana-launch-history-source-v1",
    source: RPC_SOURCE,
    rpcOrigin: "https://api.mainnet-beta.solana.com",
    commitment: "finalized",
    declaredSubjects: [{
      address: request.identity.pool,
      source: request.poolProof.source,
      evidenceId: request.poolProof.receipt.id
    }],
    slotInterval,
    signatures,
    transactions,
    events,
    counters: {
      requests: events.length,
      bytes: events.reduce((sum, event) => sum + event.responseBytes, 0),
      workUnits: events.length + transactions.length,
      signatures: signatures.length,
      successfulTransactions: transactions.length
    },
    coverage: {
      scope: "declared-subjects-and-inclusive-slot-interval-only",
      finalizedAnchor: {status: "CAPTURED", slot: slotInterval.endInclusive + 1},
      sourceHistoryCompleteness,
      complete: true,
      signaturePagesComplete: true,
      successfulTransactionRetrievalComplete: true,
      subjects: [{
        address: request.identity.pool,
        signatureCoverageComplete: true,
        terminationReason: "SOURCE_EXHAUSTED"
      }],
      terminationReason: "DECLARED_INTERVAL_COVERED"
    }
  };
}

function bridgeFor({
  resultFactory,
  timeEvidenceFactory,
  limits
} = {}) {
  let collectorRequest;
  const source = createHistoryWindowSource({
    enabled: true,
    limits,
    timeBoundarySource: {
      async readWindow(request) {
        return timeEvidenceFactory(request);
      }
    },
    slotHistoryCollector: async request => {
      collectorRequest = request;
      return resultFactory(request);
    }
  });
  return {source, getCollectorRequest: () => collectorRequest};
}

function requestFor(fixture, overrides = {}) {
  const requested = {
    startExclusiveMs: fixture.candidateT - 3_600_000,
    endInclusiveMs: fixture.candidateT
  };
  return {
    identity: fixture.identity,
    poolProof: fixture.poolProof,
    ...requested,
    ...overrides
  };
}

function fixtureSwapRows(fixture) {
  const start = fixture.candidateT - 3_600_000;
  return [
    {...makeSwap(20, start), slot: 100},
    {...makeSwap(21, start + 1_000), slot: 101},
    {...makeSwap(22, fixture.candidateT), slot: 200},
    {...makeSwap(23, fixture.candidateT + 1_000), slot: 201}
  ];
}

function collectorForFixture(fixture, sourceHistoryCompleteness = "COMPLETE") {
  const rows = fixtureSwapRows(fixture);
  return (request, overrides = {}) => makeCollectorResult(
    {...request, assembledAt: fixture.assembledAt},
    rows,
    {
      sourceHistoryCompleteness,
      transactions: rows.map((row, index) =>
        makeSlotRow(row, [100, 101, 200, 201][index], request.identity)),
      ...overrides
    }
  );
}

function normalizeFixtureSource(value, source = RPC_SOURCE, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (child === "SYNTHETIC_FIXTURE_ONLY") value[key] = source;
    else normalizeFixtureSource(child, source, seen);
  }
  return value;
}

test("disabled history source performs no collector or boundary reads", async () => {
  let calls = 0;
  const source = createHistoryWindowSource({
    slotHistoryCollector: () => { calls += 1; },
    timeBoundarySource: {readWindow: () => { calls += 1; }}
  });
  const fixture = makeFixture();
  const result = await source.readWindow(requestFor(fixture));
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "DISABLED");
  assert.equal(calls, 0);
});

test("fixture-trusted accepted collector shape plus receipts reaches the actual Analyst consumer", async () => {
  const fixture = normalizeFixtureSource(makeFixture({buyCount: 0, sellCount: 0}));
  const request = requestFor(fixture);
  const evidence = makeTimeEvidence({
    identity: fixture.identity,
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    assembledAt: fixture.assembledAt
  });
  const {source, getCollectorRequest} = bridgeFor({
    timeEvidenceFactory: () => evidence,
    resultFactory: collectorForFixture(fixture)
  });
  const bridged = await source.readWindow({...request, assembledAt: fixture.assembledAt});
  assert.equal(bridged.status, "COMPLETE", bridged.reason);
  assert.equal(bridged.receipt.status, "SOURCE_BOUND");
  assert.equal(bridged.receipt.source, RPC_SOURCE);
  assert.equal(bridged.receipt.payloadSha256, canonicalHistoryDigest({
    schema: "SOLANA_RECEIPTED_TIME_WINDOW_V1",
    sourceVersion: bridged.sourceVersion,
    source: bridged.source,
    rpcOrigin: "https://api.mainnet-beta.solana.com",
    commitment: "finalized",
    identity: bridged.identity,
    requested: bridged.requested,
    declaredSubjects: [{
      address: fixture.identity.pool,
      source: fixture.poolProof.source,
      evidenceId: fixture.poolProof.receipt.id
    }],
    slotInterval: bridged.slotInterval,
    signatures: collectorForFixture(fixture)(getCollectorRequest()).signatures,
    transactions: collectorForFixture(fixture)(getCollectorRequest()).transactions,
    events: bridged.sourceReceipts,
    counters: collectorForFixture(fixture)(getCollectorRequest()).counters,
    collectorCoverage: collectorForFixture(fixture)(getCollectorRequest()).coverage,
    timeBounds: evidence.timeBounds,
    timeEvidenceReceipt: evidence.receipt
  }));
  assert.deepEqual(
    bridged.transactions.map(row => [row.slot, row.blockTime, row.observedAt]),
    [
      [101, Math.floor((request.startExclusiveMs + 1_000) / 1000), request.startExclusiveMs + 1_000],
      [200, Math.floor(request.endInclusiveMs / 1000), request.endInclusiveMs]
    ]
  );
  assert.equal(getCollectorRequest().startSlot, 100);
  assert.equal(getCollectorRequest().endSlot, 201);

  fixture.historySource = source;
  const analyst = await buildAnalystWindowEvidence({
    candidate: fixture.candidate,
    candidateT: fixture.candidateT,
    assembledAt: fixture.assembledAt,
    decisionAt: fixture.decisionAt,
    policy: fixture.policy,
    poolProof: fixture.poolProof,
    historySource: source,
    censusSource: fixture.censusSource,
    priceSource: fixture.priceSource,
    marketPairEvidence: fixture.marketPairEvidence,
    smartWalletAllowlist: fixture.smartWalletAllowlist
  });
  assert.equal(analyst.metrics.uniqueBuyers1h.value, 2);
  assert.equal(analyst.metrics.uniqueBuyers1h.coverage.historyReceiptId, bridged.receipt.id);
  assert.equal(analyst.metrics.uniqueBuyers1h.slot, null);
});

test("the unchanged accepted collector output remains UNKNOWN when archival coverage is unknown", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const request = requestFor(fixture);
  const evidence = makeTimeEvidence({
    identity: fixture.identity,
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    assembledAt: fixture.assembledAt
  });
  const {source} = bridgeFor({
    timeEvidenceFactory: () => evidence,
    resultFactory: collectorForFixture(fixture, "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION")
  });
  const result = await source.readWindow({...request, assembledAt: fixture.assembledAt});
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "COLLECTOR_HISTORY_COMPLETENESS_UNKNOWN");
  assert.equal(result.coverage.sourceHistoryCompleteness, "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION");
});

test("collector slot interval must cover both complete time fences", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const request = requestFor(fixture);
  const evidence = makeTimeEvidence({
    identity: fixture.identity,
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    assembledAt: fixture.assembledAt
  });
  const {source} = bridgeFor({
    timeEvidenceFactory: () => evidence,
    resultFactory: collectorForFixture(fixture)
  });
  const narrowCollector = collectorForFixture(fixture);
  const {source: narrowSource} = bridgeFor({
    timeEvidenceFactory: () => evidence,
    resultFactory: input => narrowCollector(input, {
      slotInterval: {startInclusive: 101, endInclusive: 200}
    })
  });
  const narrowResult = await narrowSource.readWindow({
    ...request, assembledAt: fixture.assembledAt
  });
  assert.equal(narrowResult.status, "UNKNOWN");
  assert.equal(narrowResult.reason, "COLLECTED_SLOT_INTERVAL_DOES_NOT_COVER_TIME_FENCES");
  assert.equal((await source.readWindow({...request, assembledAt: fixture.assembledAt})).status,
    "COMPLETE");
});

test("changed transactions or time fences change the derived receipt digest", async () => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const request = requestFor(fixture);
  const evidence = makeTimeEvidence({
    identity: fixture.identity,
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    assembledAt: fixture.assembledAt
  });
  const rows = collectorForFixture(fixture);
  const first = bridgeFor({timeEvidenceFactory: () => evidence, resultFactory: rows});
  const initial = await first.source.readWindow({...request, assembledAt: fixture.assembledAt});
  const mutatedRows = collectorForFixture(fixture);
  const changedTransactions = input => {
    const collector = mutatedRows(input);
    collector.transactions[0].transaction.message.instructions[0].data += "x";
    return collector;
  };
  const changed = bridgeFor({
    timeEvidenceFactory: () => evidence,
    resultFactory: changedTransactions
  });
  const changedResult = await changed.source.readWindow({
    ...request, assembledAt: fixture.assembledAt
  });
  assert.equal(initial.status, "COMPLETE");
  assert.equal(changedResult.status, "COMPLETE");
  assert.notEqual(initial.receipt.payloadSha256, changedResult.receipt.payloadSha256);

  const alteredEvidence = structuredClone(evidence);
  alteredEvidence.timeBounds.startExclusive.after.blockTime += 1;
  const changedFence = bridgeFor({
    timeEvidenceFactory: () => alteredEvidence,
    resultFactory: rows
  });
  const rejected = await changedFence.source.readWindow({
    ...request, assembledAt: fixture.assembledAt
  });
  assert.equal(rejected.status, "UNKNOWN");
  assert.equal(rejected.reason, "TIME_BOUNDARY_RECEIPT_UNKNOWN");
});

test("actual collector preserves response bytes digests and supplied blockTime without inferring timestamps", async () => {
  const signature = "fixture-signature-1";
  const identity = {
    chainId: "solana",
    mint: "So11111111111111111111111111111111111111112",
    pool: "Vote111111111111111111111111111111111111111",
    quote: "Stake11111111111111111111111111111111111111"
  };
  const responseBodies = [];
  const transport = async request => {
    const call = JSON.parse(request.body);
    const result = call.method === "getSlot" ? 20
      : call.method === "getSignaturesForAddress"
        ? [{signature, slot: 10, blockTime: 123, err: null}]
        : {
          slot: 10,
          blockTime: 123,
          version: "legacy",
          transaction: {signatures: [signature], message: {instructions: []}},
          meta: {err: null}
        };
    const body = JSON.stringify({jsonrpc: "2.0", id: call.id, result});
    responseBodies.push(body);
    return new Response(body, {status: 200});
  };
  const result = await acquireLaunchHistory({
    subjects: [{address: identity.pool, source: RPC_SOURCE, evidenceId: "pool-receipt"}],
    startSlot: 10,
    endSlot: 10,
    transport,
    clock: () => 1_000
  });
  assert.equal(result.transactions[0].blockTime, 123);
  assert.equal(result.signatures[0].blockTime, 123);
  assert.deepEqual(result.events.map(event => event.responseSha256), responseBodies.map(hash));
  assert.equal(result.coverage.sourceHistoryCompleteness, "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION");
});

test("missing and out-of-order block times, receipt tampering, or malformed time fences remain unavailable", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const request = requestFor(fixture);
  const requested = {
    startExclusiveMs: request.startExclusiveMs,
    endInclusiveMs: request.endInclusiveMs
  };
  const baseEvidence = makeTimeEvidence({
    identity: fixture.identity,
    requested,
    assembledAt: fixture.assembledAt
  });
  const goodResult = collectorForFixture(fixture);
  const run = async (evidenceFactory, collectorFactory = goodResult) => {
    const {source} = bridgeFor({
      timeEvidenceFactory: evidenceFactory,
      resultFactory: collectorFactory
    });
    return source.readWindow({...request, assembledAt: fixture.assembledAt});
  };
  await t.test("missing transaction timestamp", async () => {
    const invalid = collectorForFixture(fixture);
    assert.equal((await run(
      () => baseEvidence,
      input => {
        const result = invalid(input);
        result.transactions[1].blockTime = null;
        return result;
      }
    )).status, "UNKNOWN");
  });
  await t.test("nonmonotone transaction times", async () => {
    const invalid = collectorForFixture(fixture);
    assert.equal((await run(
      () => baseEvidence,
      input => {
        const result = invalid(input);
        result.transactions[1].blockTime -= 3;
        return result;
      }
    )).status, "UNKNOWN");
  });
  await t.test("unreceipted time-boundary mutation", async () => {
    const invalid = structuredClone(baseEvidence);
    invalid.timeBounds.endInclusive.before.blockTime -= 1;
    assert.equal((await run(() => invalid)).reason, "TIME_BOUNDARY_RECEIPT_UNKNOWN");
  });
  await t.test("time source unknown", async () => {
    assert.equal((await run(() => ({status: "UNKNOWN"}))).status, "UNKNOWN");
  });
});

test("wrong identity, subject, incomplete pagination, and non-settling callbacks fail closed", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const request = requestFor(fixture);
  const evidence = makeTimeEvidence({
    identity: fixture.identity,
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    assembledAt: fixture.assembledAt
  });
  const rows = collectorForFixture(fixture);
  await t.test("wrong selected mint", async () => {
    const {source} = bridgeFor({
      timeEvidenceFactory: input => ({
        ...evidence,
        identity: {...input.identity, mint: "SysvarRent111111111111111111111111111111111"}
      }),
      resultFactory: rows
    });
    assert.equal((await source.readWindow({...request, assembledAt: fixture.assembledAt})).status,
      "UNKNOWN");
  });
  await t.test("wrong declared subject", async () => {
    const {source} = bridgeFor({
      timeEvidenceFactory: () => evidence,
      resultFactory: input => {
        const result = rows(input);
        result.declaredSubjects[0].address = "SysvarRent111111111111111111111111111111111";
        return result;
      }
    });
    assert.equal((await source.readWindow({...request, assembledAt: fixture.assembledAt})).status,
      "UNKNOWN");
  });
  await t.test("truncated pagination", async () => {
    const {source} = bridgeFor({
      timeEvidenceFactory: () => evidence,
      resultFactory: input => {
        const result = rows(input);
        result.coverage.signaturePagesComplete = false;
        return result;
      }
    });
    assert.equal((await source.readWindow({...request, assembledAt: fixture.assembledAt})).status,
      "UNKNOWN");
  });
  await t.test("nonsettling time source aborts on caller cancellation", async () => {
    const controller = new AbortController();
    const source = createHistoryWindowSource({
      enabled: true,
      timeBoundarySource: {readWindow: () => new Promise(() => {})},
      slotHistoryCollector: () => rows
    });
    const pending = source.readWindow({
      ...request, assembledAt: fixture.assembledAt, signal: controller.signal
    });
    setTimeout(() => controller.abort(), 5);
    assert.equal((await pending).reason, "CANCELLED");
  });
  await t.test("nonsettling collector times out and receives abort", async () => {
    let callbackSignal;
    const source = createHistoryWindowSource({
      enabled: true,
      limits: {maxElapsedMs: 5},
      timeBoundarySource: {readWindow: () => evidence},
      slotHistoryCollector: ({signal}) => {
        callbackSignal = signal;
        return new Promise(() => {});
      }
    });
    const result = await source.readWindow({...request, assembledAt: fixture.assembledAt});
    assert.equal(result.reason, "TIME_LIMIT");
    assert.equal(callbackSignal.aborted, true);
  });
});

test("collector budgets and payload digests are validated", async t => {
  const fixture = makeFixture({buyCount: 0, sellCount: 0});
  const request = requestFor(fixture);
  const evidence = makeTimeEvidence({
    identity: fixture.identity,
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    assembledAt: fixture.assembledAt
  });
  await t.test("request budget", async () => {
    const {source} = bridgeFor({
      limits: {maxRequests: 1},
      timeEvidenceFactory: () => evidence,
      resultFactory: collectorForFixture(fixture)
    });
    assert.equal((await source.readWindow({...request, assembledAt: fixture.assembledAt})).status,
      "UNKNOWN");
  });
  await t.test("work budget", async () => {
    const {source} = bridgeFor({
      timeEvidenceFactory: () => evidence,
      resultFactory: input => {
        const result = collectorForFixture(fixture)(input);
        result.counters.workUnits = 5_001;
        return result;
      }
    });
    assert.equal((await source.readWindow({...request, assembledAt: fixture.assembledAt})).status,
      "UNKNOWN");
  });
  await t.test("changed row changes digest even with same response hashes", async () => {
    const {source} = bridgeFor({
      timeEvidenceFactory: () => evidence,
      resultFactory: collectorForFixture(fixture)
    });
    const original = await source.readWindow({...request, assembledAt: fixture.assembledAt});
    assert.equal(original.status, "COMPLETE");
    const payload = {
      identity: original.identity,
      requested: original.requested,
      transactions: original.transactions,
      timeBounds: evidence.timeBounds,
      collectorResponses: original.sourceReceipts.collector,
      timeResponses: original.sourceReceipts.timeBoundaries
    };
    const digest = canonicalHistoryDigest(payload);
    payload.transactions[0].blockTime += 1;
    assert.notEqual(digest, canonicalHistoryDigest(payload));
  });
});
