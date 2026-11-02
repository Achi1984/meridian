import assert from "node:assert/strict";
import test from "node:test";
import {createHistoryWindowSource} from "../scripts/memecoin-paper/history-window-bridge.mjs";

const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});
const START = 100_000_000;
const END = 100_004_000;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function receipt(id, payloadSha256, receivedAt) {
  return {id, payloadSha256, receivedAt};
}

function poolProof(overrides = {}) {
  return {
    status: "SOURCE_BOUND",
    verified: true,
    chainId: IDENTITY.chainId,
    baseMint: IDENTITY.mint,
    pool: IDENTITY.pool,
    quoteMint: IDENTITY.quote,
    observedAt: START - 1_000,
    slot: 9,
    receipt: receipt("pool-proof", HASH_A, START),
    ...overrides
  };
}

function transaction(signature, slot, blockTime, subject = IDENTITY.pool) {
  return {
    signature,
    slot,
    blockTime,
    subjectAddresses: [subject],
    status: "SUCCESS",
    version: "legacy",
    transaction: {message: {instructions: []}},
    meta: {err: null, innerInstructions: []}
  };
}

function collectorResult(request, overrides = {}) {
  const events = [
    {responseSha256: HASH_A, bytes: 100},
    {responseSha256: HASH_B, bytes: 200}
  ];
  return {
    sourceVersion: "solana-launch-history-source-v1",
    source: "Solana JSON-RPC",
    rpcOrigin: "https://api.mainnet-beta.solana.com",
    commitment: "finalized",
    identity: {...request.identity},
    requested: {
      startExclusiveMs: request.startExclusiveMs,
      endInclusiveMs: request.endInclusiveMs
    },
    declaredSubjects: [{address: IDENTITY.pool, source: "selected pool"}],
    slotInterval: {startInclusive: 9, endInclusive: 15},
    signatures: [],
    transactions: [
      transaction("at-start", 10, 100_000),
      transaction("after-start", 11, 100_001),
      transaction("inside", 12, 100_003),
      transaction("at-end", 13, 100_004),
      transaction("after-end", 14, 100_005)
    ],
    events,
    counters: {
      requests: 2,
      bytes: 300,
      workUnits: 10,
      signatures: 5,
      successfulTransactions: 5
    },
    receipt: receipt("history-window", HASH_B, END + 1_000),
    coverage: {
      complete: true,
      signaturePagesComplete: true,
      successfulTransactionRetrievalComplete: true,
      sourceHistoryCompleteness: "COMPLETE",
      terminationReason: "DECLARED_INTERVAL_COVERED",
      finalizedAnchor: {status: "CAPTURED", slot: 16},
      subjects: [{
        address: IDENTITY.pool,
        signatureCoverageComplete: true,
        terminationReason: "SOURCE_EXHAUSTED"
      }],
      timeBounds: {
        complete: true,
        monotonicSlots: true,
        receiptId: "history-window",
        startExclusive: {
          before: {slot: 10, blockTime: 100_000},
          after: {slot: 11, blockTime: 100_001}
        },
        endInclusive: {
          before: {slot: 13, blockTime: 100_004},
          after: {slot: 14, blockTime: 100_005}
        }
      }
    },
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    identity: IDENTITY,
    poolProof: poolProof(),
    startExclusiveMs: START,
    endInclusiveMs: END,
    ...overrides
  };
}

function sourceFor(resultFactory = collectorResult, options = {}) {
  return createHistoryWindowSource({
    enabled: true,
    slotHistoryCollector: async input => resultFactory(input),
    ...options
  });
}

test("disabled source does not call the injected collector", async () => {
  let calls = 0;
  const source = createHistoryWindowSource({
    slotHistoryCollector: () => { calls += 1; }
  });
  const result = await source.readWindow(request());
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "DISABLED");
  assert.equal(calls, 0);
});

test("collector-shaped receipt bridges to the Analyst readWindow contract without changing source payloads", async () => {
  let called;
  const source = createHistoryWindowSource({
    enabled: true,
    slotHistoryCollector: async input => {
      called = input;
      return collectorResult(input);
    }
  });
  const result = await source.readWindow(request());
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(called.identity, IDENTITY);
  assert.deepEqual(called.limits, {
    maxRequests: 2_100,
    maxResponseBytes: 1_048_576,
    maxBytes: 10_485_760,
    maxWorkUnits: 5_000,
    maxTransactions: 1_000,
    maxElapsedMs: 15_000
  });
  assert.deepEqual(result.requested, {
    startExclusiveMs: START,
    endInclusiveMs: END
  });
  assert.deepEqual(result.identity, IDENTITY);
  assert.deepEqual(result.transactions.map(row => row.signature), [
    "after-start", "inside", "at-end"
  ]);
  assert.deepEqual(result.transactions.map(row => row.slot), [11, 12, 13]);
  assert.deepEqual(result.transactions.map(row => row.blockTime), [100_001, 100_003, 100_004]);
  assert.deepEqual(result.transactions.map(row => row.observedAt), [
    100_001_000, 100_003_000, 100_004_000
  ]);
  assert.deepEqual(result.receipt, receipt("history-window", HASH_B, END + 1_000));
  assert.deepEqual(result.sourceReceipts, [
    {responseSha256: HASH_A, bytes: 100},
    {responseSha256: HASH_B, bytes: 200}
  ]);
  assert.deepEqual(result.coverage, {
    complete: true,
    truncated: false,
    cursorExhausted: true,
    timeBoundaryCoverage: "PROVEN_BY_RECEIPTED_BLOCKTIME_FENCES",
    timestampBasis: "SOLANA_RPC_ESTIMATED_BLOCK_TIME_SECONDS",
    sourceHistoryCompleteness: "COMPLETE"
  });
});

test("the current accepted slot collector shape without time and receipt extensions stays unavailable", async () => {
  const source = sourceFor(input => {
    const result = collectorResult(input);
    delete result.identity;
    delete result.requested;
    delete result.receipt;
    delete result.coverage.timeBounds;
    result.coverage.sourceHistoryCompleteness = "UNKNOWN_ARCHIVAL_OR_INDEX_TRUNCATION";
    for (const row of result.transactions) delete row.blockTime;
    return result;
  });
  const result = await source.readWindow(request());
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.transactions.length, 0);
  assert.equal(result.coverage.complete, false);
});

test("missing block time or nonmonotone slot timestamps remain unavailable", async t => {
  await t.test("missing timestamp", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      delete result.transactions[1].blockTime;
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
  await t.test("out-of-order timestamp", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.transactions[2].blockTime = 100_000;
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
  await t.test("ambiguous time monotonicity", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.coverage.timeBounds.monotonicSlots = false;
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
});

test("truncated pagination and empty unproven responses do not imply complete coverage", async t => {
  await t.test("truncated pages", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.coverage.complete = false;
      result.coverage.signaturePagesComplete = false;
      result.coverage.terminationReason = "PAGE_LIMIT";
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
  await t.test("empty without boundary proof", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.transactions = [];
      result.counters.successfulTransactions = 0;
      result.coverage.timeBounds = null;
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
});

test("wrong selected pool or mint is rejected", async t => {
  await t.test("pool proof mismatch", async () => {
    const source = sourceFor();
    const result = await source.readWindow(request({
      poolProof: poolProof({pool: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"})
    }));
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.reason, "INVALID_OR_UNBOUND_REQUEST");
  });
  await t.test("collector mint mismatch", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.identity.mint = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
  await t.test("subject is not the selected pool", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.coverage.subjects[0].address = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
});

test("cancellation and a nonsettling callback return UNKNOWN and abort the injected signal", async t => {
  const controller = new AbortController();
  let callbackSignal;
  const source = createHistoryWindowSource({
    enabled: true,
    slotHistoryCollector: ({signal}) => {
      callbackSignal = signal;
      return new Promise(() => {});
    }
  });
  const pending = source.readWindow(request({signal: controller.signal}));
  setTimeout(() => controller.abort(), 5);
  const result = await pending;
  assert.equal(result.reason, "CANCELLED");
  assert.equal(callbackSignal.aborted, true);
});

test("deadline aborts a nonsettling injected callback", async () => {
  let callbackSignal;
  const source = createHistoryWindowSource({
    enabled: true,
    limits: {maxElapsedMs: 5},
    slotHistoryCollector: ({signal}) => {
      callbackSignal = signal;
      return new Promise(() => {});
    }
  });
  const result = await source.readWindow(request());
  assert.equal(result.reason, "TIME_LIMIT");
  assert.equal(callbackSignal.aborted, true);
});

test("request, response-byte, and work exhaustion are unavailable", async t => {
  await t.test("request budget", async () => {
    const source = sourceFor(collectorResult, {limits: {maxRequests: 1}});
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
  await t.test("response-byte budget", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.events = Array.from({length: 11}, (_, index) => ({
        responseSha256: index % 2 ? HASH_A : HASH_B,
        bytes: 1_000_000
      }));
      result.counters.requests = 11;
      result.counters.bytes = 11_000_000;
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
  await t.test("work budget", async () => {
    const source = sourceFor(input => {
      const result = collectorResult(input);
      result.counters.workUnits = 5_001;
      return result;
    });
    assert.equal((await source.readWindow(request())).status, "UNKNOWN");
  });
});

test("collector rejection and invalid limits fail closed", async () => {
  const rejecting = createHistoryWindowSource({
    enabled: true,
    slotHistoryCollector: async () => { throw new Error("source unavailable"); }
  });
  assert.equal((await rejecting.readWindow(request())).reason, "COLLECTOR_UNKNOWN");
  assert.throws(() => createHistoryWindowSource({
    limits: {maxRequests: 2_101}
  }), /hard bounds/);
});
