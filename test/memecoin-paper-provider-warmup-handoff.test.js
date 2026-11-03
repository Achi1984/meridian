import assert from "node:assert/strict";
import {mkdtemp, open, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EvidenceWarmupStore,
  createWarmupCensusSource,
  createWarmupPriceSource
} from "../scripts/memecoin-paper/evidence-warmup/index.mjs";
import {
  createPaperRuntimeSourceAdapter,
  PAPER_RUNTIME_SOURCE_POLICY_SHA256
} from "../scripts/memecoin-paper/paper-runtime-source.mjs";
import {
  createPaperProviderWarmupHandoff,
  preflightPaperProduction,
  summarizeHeliusDiagnostic
} from "../scripts/memecoin-paper/provider-warmup-handoff/index.mjs";
import {
  evaluationRequest,
  makeBirdeyeObservation,
  makeHandoffFixture,
  makeHeliusDiagnostic,
  makeSyntheticHistoryPipeline
} from "./fixtures/memecoin-paper-provider-warmup-handoff/synthetic.mjs";

async function temporaryStore(t, {enabled = true, limits} = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "meridian-provider-warmup-handoff-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const root = path.join(parent, "store");
  return {root, store: new EvidenceWarmupStore(root, {enabled, limits})};
}

function handoff(store, fixture, options = {}) {
  return createPaperProviderWarmupHandoff({
    enabled: true,
    store,
    datasetId: "provider-handoff-test",
    runId: "offline-run-1",
    identity: fixture.identity,
    clock: () => fixture.assembledAt,
    ...options
  });
}

function runRequest(fixture, observation, request, pipeline = makeSyntheticHistoryPipeline(fixture)) {
  return {
    observation,
    request,
    pipeline,
    evaluationRequest: evaluationRequest(fixture),
    priceEndpoints: [{
      mint: fixture.candidate.mint,
      atMs: fixture.candidateT,
      denomination: "USD"
    }]
  };
}

test("disabled handoff and production preflight perform no acquisition or storage mutation", async () => {
  let publishes = 0;
  let reads = 0;
  let evaluations = 0;
  const store = {
    async publish() { publishes += 1; },
    async read() { reads += 1; }
  };
  const disabled = createPaperProviderWarmupHandoff();
  const result = await disabled.runOffline();
  assert.equal(result.status, "DISABLED");
  assert.deepEqual({publishes, reads, evaluations}, {publishes: 0, reads: 0, evaluations: 0});

  const preflight = await preflightPaperProduction();
  assert.equal(preflight.reason, "SOURCE_POLICY_UNAPPROVED");
  assert.equal(preflight.implementationStatus, "BLOCKED_NOT_IMPLEMENTED");
  assert.equal(preflight.sourcePolicySha256, PAPER_RUNTIME_SOURCE_POLICY_SHA256);
  assert.equal(preflight.acquisitionAttempted, false);
  assert.equal(preflight.storageMutated, false);
  assert.equal(preflight.networkAccessed, false);
  assert.throws(() => createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    policy: {enabled: true, approved: true},
    clock: () => Date.now(),
    transport: () => { throw new Error("must not be called"); }
  }), /runtime source adapter options must be exact bounded data/);
  assert.deepEqual({publishes, reads}, {publishes: 0, reads: 0});
});

test("provider observation round-trips through immutable UNKNOWN warmup and canonical no-entry", async t => {
  const fixture = makeHandoffFixture();
  const {store, root} = await temporaryStore(t);
  const {observation, request, calls} = await makeBirdeyeObservation(fixture);
  assert.equal(observation.status, "SOURCE_BOUND");
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, "https://public-api.birdeye.so");

  const result = await handoff(store, fixture).runOffline(runRequest(
    fixture, observation, request
  ));
  assert.equal(result.status, "OFFLINE_EVALUATED");
  assert.equal(result.publication, "PUBLISHED");
  assert.equal(result.warmupReadback, "AVAILABLE");
  assert.equal(result.trust, "UNKNOWN");
  assert.equal(result.completeness, "UNKNOWN");
  assert.equal(result.sourcePolicySha256, PAPER_RUNTIME_SOURCE_POLICY_SHA256);
  assert.match(result.datasetDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.coverage.exactAvailable.prices.length, 0);
  assert.equal(result.coverage.exactMissing.prices.length, 1);

  const readback = await new EvidenceWarmupStore(root).read("provider-handoff-test");
  const [record] = readback.document.records;
  assert.equal(record.kind, "price");
  assert.equal(record.source, observation.source);
  assert.equal(record.sourceAtMs, observation.sourceAtMs);
  assert.equal(record.receivedAt, observation.receivedAt);
  assert.equal(record.payload.receipt.id, observation.receipt.id);
  assert.equal(record.payload.receipt.payloadSha256, observation.receipt.payloadSha256);
  assert.equal(record.payload.receipts[0].responseSha256,
    observation.receipts[0].responseSha256);
  assert.deepEqual(record.payload.data, observation.data);
  assert.equal(await createWarmupPriceSource(readback.document).readObservation({
    mint: fixture.candidate.mint,
    atMs: fixture.candidateT,
    denomination: "USD"
  }), null);
  const census = await createWarmupCensusSource(readback.document).readSnapshots({
    identity: fixture.identity,
    startAtMs: fixture.candidateT - 3_600_000,
    endAtMs: fixture.candidateT,
    policy: fixture.policy.censusPolicy
  });
  assert.equal(census.status, "WARMUP");
  assert.deepEqual(census.snapshots, []);

  const evaluation = result.evaluation;
  assert.equal(evaluation.mode, "SYNTHETIC_TEST_ONLY");
  assert.equal(evaluation.analystEvidence.unavailableMetrics.buySellUsdRatio1h.status,
    "UNAVAILABLE");
  assert.equal(evaluation.filters.status, "UNKNOWN");
  assert.equal(evaluation.analysis.status, "BLOCKED");
  assert.equal(evaluation.executionAuthorized, false);
  assert.equal(evaluation.realDataEntryEligible, false);
});

test("invalid mint, missing/near/future time, scaling, and receipt binding never reach storage", async () => {
  const fixture = makeHandoffFixture();
  let publishes = 0;
  let reads = 0;
  const store = {
    async publish() { publishes += 1; return {status: "PUBLISHED"}; },
    async read() { reads += 1; return {status: "UNKNOWN"}; }
  };
  const target = handoff(store, fixture);
  const valid = await makeBirdeyeObservation(fixture);
  const alteredTime = structuredClone(valid.observation);
  alteredTime.sourceAtMs += 1_000;
  assert.equal((await target.runOffline(runRequest(
    fixture, alteredTime, valid.request
  ))).reason, "PROVIDER_OBSERVATION_UNBOUND");

  const scaled = await makeBirdeyeObservation(fixture, {}, {isScaledUiToken: true});
  assert.notEqual(scaled.observation.status, "SOURCE_BOUND");
  assert.equal((await target.runOffline(runRequest(
    fixture, scaled.observation, scaled.request
  ))).reason, "PROVIDER_OBSERVATION_UNBOUND");

  for (const options of [
    {omitUpdateUnixTime: true},
    {updateUnixTime: fixture.candidateT / 1_000 - 1},
    {updateUnixTime: fixture.candidateT / 1_000 + 1},
    {success: false}
  ]) {
    const unavailable = await makeBirdeyeObservation(fixture, {}, options);
    assert.notEqual(unavailable.observation.status, "SOURCE_BOUND");
    assert.equal((await target.runOffline(runRequest(
      fixture, unavailable.observation, unavailable.request
    ))).reason, "PROVIDER_OBSERVATION_UNBOUND");
  }

  const wrongMint = await makeBirdeyeObservation(fixture, {
    mint: fixture.candidate.quote
  });
  assert.equal((await target.runOffline(runRequest(
    fixture, wrongMint.observation, wrongMint.request
  ))).reason, "INVALID_REQUEST_BINDING");

  const badReceipt = structuredClone(valid.observation);
  badReceipt.receipt.payloadSha256 = "0".repeat(64);
  assert.equal((await target.runOffline(runRequest(
    fixture, badReceipt, valid.request
  ))).reason, "PROVIDER_OBSERVATION_UNBOUND");
  assert.deepEqual({publishes, reads}, {publishes: 0, reads: 0});
});

test("ambiguous publication and readback corruption remain UNKNOWN without retry", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  let publishes = 0;
  let reads = 0;
  const ambiguous = handoff({
    async publish() {
      publishes += 1;
      return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
    },
    async read() {
      reads += 1;
      return {status: "UNKNOWN", reason: "PUBLICATION_STATE_UNKNOWN"};
    }
  }, fixture);
  const publication = await ambiguous.runOffline(runRequest(
    fixture, observation, request
  ));
  assert.equal(publication.reason, "PUBLICATION_STATE_UNKNOWN");
  assert.deepEqual({publishes, reads}, {publishes: 1, reads: 0});

  publishes = 0;
  reads = 0;
  const corrupt = handoff({
    async publish(input) {
      publishes += 1;
      return {
        status: "PUBLISHED",
        datasetId: input.datasetId,
        digest: "b".repeat(64)
      };
    },
    async read() {
      reads += 1;
      return {status: "UNKNOWN", reason: "WARMUP_DIGEST_MISMATCH"};
    }
  }, fixture);
  const readback = await corrupt.runOffline(runRequest(
    fixture, observation, request
  ));
  assert.equal(readback.reason, "WARMUP_READBACK_MISMATCH");
  assert.deepEqual({publishes, reads}, {publishes: 1, reads: 1});
});

test("corrupt immutable data stays UNKNOWN and is not repaired or republished", async t => {
  const fixture = makeHandoffFixture();
  const {root, store} = await temporaryStore(t);
  const {observation, request} = await makeBirdeyeObservation(fixture);
  const initial = await handoff(store, fixture).runOffline(runRequest(
    fixture, observation, request
  ));
  assert.equal(initial.publication, "PUBLISHED");

  const handle = await open(path.join(root, "evidence-warmup.json"), "r+");
  try {
    await handle.write(Buffer.from("tampered"), 0, 8, 0);
  } finally {
    await handle.close();
  }
  assert.equal((await new EvidenceWarmupStore(root).read("provider-handoff-test")).status,
    "UNKNOWN");

  let publishes = 0;
  let reads = 0;
  const countedStore = {
    async publish(...args) {
      publishes += 1;
      return store.publish(...args);
    },
    async read(...args) {
      reads += 1;
      return store.read(...args);
    }
  };
  const result = await handoff(countedStore, fixture).runOffline(runRequest(
    fixture, observation, request
  ));
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "WARMUP_DIGEST_MISMATCH");
  assert.deepEqual({publishes, reads}, {publishes: 1, reads: 0});
});

test("caller cancellation before validation causes no storage operation", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  let publishes = 0;
  let reads = 0;
  const controller = new AbortController();
  controller.abort();
  const result = await handoff({
    async publish() { publishes += 1; },
    async read() { reads += 1; }
  }, fixture).runOffline({
    ...runRequest(fixture, observation, request),
    signal: controller.signal
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "CANCELLED");
  assert.deepEqual({publishes, reads}, {publishes: 0, reads: 0});
});

test("immutable duplicate and conflict outcomes are preserved without retries", async t => {
  const fixture = makeHandoffFixture();
  const {store, root} = await temporaryStore(t);
  const target = handoff(store, fixture);
  const original = await makeBirdeyeObservation(fixture);
  const first = await target.runOffline(runRequest(
    fixture, original.observation, original.request
  ));
  const restarted = handoff(new EvidenceWarmupStore(root, {enabled: true}), fixture);
  const duplicate = await restarted.runOffline(runRequest(
    fixture, original.observation, original.request
  ));
  assert.equal(first.publication, "PUBLISHED");
  assert.equal(duplicate.publication, "DUPLICATE");

  const changed = await makeBirdeyeObservation(fixture, {}, {value: 0.00043});
  const conflict = await target.runOffline(runRequest(
    fixture, changed.observation, changed.request
  ));
  assert.equal(conflict.status, "UNKNOWN");
  assert.equal(conflict.reason, "IMMUTABLE_DATASET_CONFLICT");
  assert.equal(original.calls.length + changed.calls.length, 2);
});

test("overall deadline is passed to the actual warmup readers and evaluation", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  let published;
  let publishCalls = 0;
  let readCalls = 0;
  let evaluationCalls = 0;
  let evaluationSignal;
  const store = {
    async publish(input) {
      published = input;
      publishCalls += 1;
      return {status: "PUBLISHED", datasetId: input.datasetId, digest: "a".repeat(64)};
    },
    async read(datasetId, {signal, timeoutMs}) {
      readCalls += 1;
      assert.equal(timeoutMs <= 40, true);
      assert.equal(signal.aborted, false);
      return {
        status: "AVAILABLE",
        digest: "a".repeat(64),
        document: {
          datasetId,
          identity: published.identity,
          capturedAt: published.capturedAt,
          records: published.records
        }
      };
    }
  };
  const pipeline = {
    enabled: true,
    mode: "SYNTHETIC_TEST_ONLY",
    async evaluate(input) {
      evaluationCalls += 1;
      evaluationSignal = input.signal;
      await new Promise(resolve =>
        input.signal.addEventListener("abort", resolve, {once: true}));
      return {status: "NO_ENTRY"};
    }
  };
  const result = await handoff(store, fixture, {
    limits: {maxElapsedMs: 40}
  }).runOffline(runRequest(fixture, observation, request, pipeline));
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "DEADLINE");
  assert.equal(publishCalls, 1);
  assert.equal(readCalls, 1);
  assert.equal(evaluationCalls, 1);
  assert.equal(evaluationSignal.aborted, true);
});

test("noncooperating publication, readback, and evaluation are all deadline-raced", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  const baseStore = () => {
    let published;
    return {
      async publish(input) {
        published = input;
        return {
          status: "PUBLISHED",
          datasetId: input.datasetId,
          digest: "c".repeat(64)
        };
      },
      async read(datasetId) {
        return {
          status: "AVAILABLE",
          digest: "c".repeat(64),
          document: {
            datasetId,
            identity: published.identity,
            capturedAt: published.capturedAt,
            records: published.records
          }
        };
      }
    };
  };
  const never = () => new Promise(() => {});
  const noncooperatingPipeline = {
    enabled: true,
    mode: "SYNTHETIC_TEST_ONLY",
    evaluate: never
  };
  let publicationReads = 0;
  let publicationEvaluations = 0;
  const publication = await handoff({
    async publish() { return never(); },
    async read() { publicationReads += 1; }
  }, fixture, {limits: {maxElapsedMs: 25}}).runOffline(runRequest(
    fixture, observation, request, {
      ...noncooperatingPipeline,
      async evaluate() { publicationEvaluations += 1; }
    }
  ));
  assert.equal(publication.reason, "DEADLINE");
  assert.deepEqual({publicationReads, publicationEvaluations},
    {publicationReads: 0, publicationEvaluations: 0});

  const readStore = baseStore();
  let readEvaluations = 0;
  const readback = await handoff({
    ...readStore,
    async read() { return never(); }
  }, fixture, {limits: {maxElapsedMs: 25}}).runOffline(runRequest(
    fixture, observation, request, {
      ...noncooperatingPipeline,
      async evaluate() { readEvaluations += 1; }
    }
  ));
  assert.equal(readback.reason, "DEADLINE");
  assert.equal(readEvaluations, 0);

  const evaluation = await handoff(baseStore(), fixture, {
    limits: {maxElapsedMs: 25}
  }).runOffline(runRequest(fixture, observation, request, noncooperatingPipeline));
  assert.equal(evaluation.reason, "DEADLINE");
});

test("publication resolving after deadline cannot start readback or evaluation", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  let reads = 0;
  let evaluations = 0;
  const result = await handoff({
    async publish() {
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        status: "PUBLISHED",
        datasetId: "provider-handoff-test",
        digest: "d".repeat(64)
      };
    },
    async read() { reads += 1; }
  }, fixture, {limits: {maxElapsedMs: 20}}).runOffline(runRequest(
    fixture, observation, request, {
      enabled: true,
      mode: "SYNTHETIC_TEST_ONLY",
      async evaluate() { evaluations += 1; }
    }
  ));
  assert.equal(result.reason, "DEADLINE");
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual({reads, evaluations}, {reads: 0, evaluations: 0});
});

test("cancellation during each noncooperating asynchronous stage returns promptly", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  const never = () => new Promise(() => {});
  const makeStore = () => {
    let published;
    return {
      async publish(input) {
        published = input;
        return {
          status: "PUBLISHED",
          datasetId: input.datasetId,
          digest: "e".repeat(64)
        };
      },
      async read(datasetId) {
        return {
          status: "AVAILABLE",
          digest: "e".repeat(64),
          document: {
            datasetId,
            identity: published.identity,
            capturedAt: published.capturedAt,
            records: published.records
          }
        };
      }
    };
  };
  const cases = [
    ["publish", {
      async publish() { return never(); },
      async read() { assert.fail("read must not follow cancelled publication"); }
    }],
    ["read", {
      async publish(input) {
        return {status: "PUBLISHED", datasetId: input.datasetId, digest: "e".repeat(64)};
      },
      async read() { return never(); }
    }]
  ];
  for (const [stage, store] of cases) {
    const controller = new AbortController();
    const promise = handoff(store, fixture).runOffline({
      ...runRequest(fixture, observation, request),
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 10);
    const result = await promise;
    assert.equal(result.reason, "CANCELLED", stage);
  }

  const controller = new AbortController();
  const promise = handoff(makeStore(), fixture).runOffline({
    ...runRequest(fixture, observation, request, {
      enabled: true,
      mode: "SYNTHETIC_TEST_ONLY",
      evaluate: never
    }),
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 10);
  assert.equal((await promise).reason, "CANCELLED");
});

test("Helius history and GPA remain bounded diagnostics, never historical or census records", async () => {
  const fixture = makeHandoffFixture();
  for (const kind of ["history", "gpa"]) {
    const {envelope, calls} = await makeHeliusDiagnostic(fixture, kind);
    const diagnostic = summarizeHeliusDiagnostic(envelope);
    assert.equal(calls.length, 1);
    assert.equal(diagnostic.status, "DIAGNOSTIC_CAPTURED");
    assert.equal(diagnostic.provider.name, "Helius");
    assert.equal(diagnostic.provider.method,
      kind === "history" ? "getTransactionsForAddress" : "getProgramAccountsV2");
    assert.deepEqual(JSON.parse(JSON.stringify(diagnostic.queryScope)), envelope.queryScope);
    assert.equal(diagnostic.receipts[0].responseSha256,
      envelope.receipts[0].responseSha256);
    assert.equal(diagnostic.observedCompleteness, "UNKNOWN");
    assert.equal(diagnostic.historicalCoverageProven, false);
    assert.equal(diagnostic.censusEligible, false);
    assert.equal(diagnostic.warmupRecord, null);
  }
});
