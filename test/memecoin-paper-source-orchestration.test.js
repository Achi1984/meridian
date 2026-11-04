import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {EvidenceWarmupStore} from "../scripts/memecoin-paper/evidence-warmup/index.mjs";
import {PaperLedger} from "../scripts/memecoin-paper/ledger.mjs";
import {createMarketQuoteAdapter} from "../scripts/memecoin-paper/market-quote-adapter.mjs";
import {
  createPaperPilotComposition,
  createSyntheticClock,
  offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {
  PAPER_RUNTIME_SOURCE_POLICY,
  PAPER_RUNTIME_SOURCE_POLICY_SHA256,
  createPaperRuntimeSourceAdapter
} from "../scripts/memecoin-paper/paper-runtime-source.mjs";
import {createPaperProviderWarmupHandoff} from "../scripts/memecoin-paper/provider-warmup-handoff/index.mjs";
import {
  evaluationRequest,
  makeBirdeyeObservation,
  makeHandoffFixture,
  makeSyntheticHistoryPipeline
} from "./fixtures/memecoin-paper-provider-warmup-handoff/synthetic.mjs";
import {syntheticOrderResponse} from "./fixtures/memecoin-paper-route-quotes/jupiter-v2-order.mjs";

test("generated provider warmup remains UNKNOWN and quote/ledger adapters reject independently", async t => {
  const fixture = makeHandoffFixture();
  const parent = await mkdtemp(path.join(os.tmpdir(), "paper-source-orchestration-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const store = new EvidenceWarmupStore(path.join(parent, "store"), {enabled: true});
  const handoff = createPaperProviderWarmupHandoff({
    enabled: true,
    store,
    datasetId: "orchestration-test",
    runId: "synthetic-only",
    identity: fixture.identity,
    clock: () => fixture.assembledAt
  });
  const {observation, request, calls} = await makeBirdeyeObservation(fixture);
  assert.equal(calls.length, 1);
  assert.equal(observation.status, "SOURCE_BOUND");
  const result = await handoff.runOffline({
    observation,
    request,
    pipeline: makeSyntheticHistoryPipeline(fixture),
    evaluationRequest: evaluationRequest(fixture),
    priceEndpoints: [{mint: fixture.identity.mint, atMs: fixture.candidateT, denomination: "USD"}]
  });
  assert.equal(result.status, "OFFLINE_EVALUATED");
  assert.equal(result.trust, "UNKNOWN");
  assert.equal(result.completeness, "UNKNOWN");
  assert.equal(result.coverage.exactAvailable.prices.length, 0);
  assert.match(result.datasetDigest, /^[a-f0-9]{64}$/);
  const persisted = await store.read("orchestration-test");
  assert.equal(persisted.digest, result.datasetDigest);
  assert.equal(persisted.document.records[0].payload.receipt.payloadSha256,
    observation.receipt.payloadSha256);
  assert.equal(result.evaluation.analysis.status, "BLOCKED");
  assert.equal(result.evaluation.executionAuthorized, false);
  assert.equal(result.evaluation.realDataEntryEligible, false);

  const identity = {...fixture.identity, decimals: fixture.candidate.decimals};
  const body = syntheticOrderResponse({
    inputMint: identity.quote,
    outputMint: identity.mint,
    routePlan: [{
      swapInfo: {
        ammKey: identity.pool,
        label: "Synthetic AMM",
        inputMint: identity.quote,
        outputMint: identity.mint,
        inAmount: "100000000",
        outAmount: "17057460"
      },
      percent: 100,
      bps: 10_000
    }]
  }).body;
  let quoteCalls = 0;
  const quoteAdapter = createMarketQuoteAdapter({
    enabled: true,
    clock: () => fixture.decisionAt + 1,
    transport: async () => {
      quoteCalls += 1;
      return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});
    }
  });
  const quote = await quoteAdapter.getPaperQuote({
    identity,
    side: "ENTRY",
    amountAtoms: "100000000",
    quoteDecimals: 6,
    candidateSampledAt: fixture.candidateT,
    authorizedAt: fixture.decisionAt,
    slippageBps: 50
  });
  assert.equal(quoteCalls, 1);
  assert.equal(quote.authorizationEligible, false);
  assert.equal(quote.quoteCandidate.route.binding.status, "SINGLE_POOL_MATCH");
  assert.equal(quote.quoteCandidate.priceMicros, null);
  assert.equal(quote.quoteCandidate.executable, false);
  for (const component of Object.values(quote.costEvidence.components)) {
    assert.equal(component.status, "UNKNOWN");
    assert.equal(component.amount, null);
  }

  const ledger = new PaperLedger({now: fixture.decisionAt});
  const authorization = ledger.authorizeEntry({
    authorizationId: "source-orchestration-test",
    candidate: result.evaluation.candidate,
    filterResult: result.evaluation.filters,
    scoreResult: result.evaluation.analysis,
    tickId: "synthetic-tick",
    now: fixture.decisionAt
  });
  assert.equal(authorization.status, "REJECT");
  assert.equal(ledger.summary().openPositions.length, 0);
});

test("composition blocks unapproved source candidates before quotes and preserves synthetic control", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "paper-source-composition-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const sourceConfig = {
    version: 1,
    mode: "SOURCE_BACKED_PAPER",
    enabled: true,
    runId: "source-composition-blocked",
    startedAt: Date.now() - 1_000,
    budgets: {
      requests: 40,
      bytes: 1_000_000,
      events: 128,
      candidates: 4,
      cycles: 8,
      durationMs: 20_000,
      callbackTimeoutMs: 1_000,
      maxWallClockUncertaintyMs: 10
    },
    sourcePolicy: PAPER_RUNTIME_SOURCE_POLICY,
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
  };
  const blocked = await createPaperPilotComposition({
    config: sourceConfig,
    dataDirectory: path.join(parent, "source")
  }).start();
  assert.equal(blocked.status, "UNKNOWN");
  assert.equal(blocked.report.runnerReport.sourcePolicy.status, "UNAPPROVED");
  assert.equal(blocked.report.runnerReport.sourcePolicy.networkAccessed, false);
  assert.equal(blocked.report.runnerReport.sourcePolicy.quoteAdapterStatus, "DISABLED");
  assert.equal(blocked.report.runnerReport.counters.quotes, 0);
  assert.equal(blocked.report.runnerReport.operationResults.some(item =>
    item.method === "authorizeEntry" || item.method === "executeEntry"), false);
  assert.deepEqual(blocked.report.checkpoint.records.map(record => record.method), [
    "constructor", "riskSnapshot", "finishRun"
  ]);
  assert.equal(blocked.report.persistence, "ACKNOWLEDGED");

  const startedAt = Date.parse("2026-01-01T19:00:00Z");
  const clock = createSyntheticClock({wallStart: startedAt + 5_000, monotonicStart: 100});
  const control = await createPaperPilotComposition({
    config: {
      version: 1,
      mode: "SYNTHETIC_TEST_ONLY",
      enabled: true,
      runId: "synthetic-composition-control",
      startedAt,
      budgets: {...sourceConfig.budgets}
    },
    dataDirectory: path.join(parent, "synthetic"),
    adapters: offlineFixtureAdapters({clock, fault: "PIPELINE_QUOTE"}),
    clock
  }).start();
  assert.ok(control.report.runnerReport.counters.quotes >= 2);
  assert.equal(control.report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry" && item.status === "FILLED_PAPER"), true);
  assert.deepEqual(control.report.runnerReport.terminalResult.openPositions, []);
  assert.equal(control.report.persistence, "ACKNOWLEDGED");
});

test("runtime handoff persists and evaluates an acquired UNKNOWN envelope under one budget", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "paper-runtime-source-warmup-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const store = new EvidenceWarmupStore(path.join(parent, "warmup"), {enabled: true});
  const fixture = makeHandoffFixture();
  const clock = createSyntheticClock({wallStart: fixture.assembledAt, monotonicStart: 100});
  const used = {requests: 0, bytes: 0, work: 0};
  const budget = {
    reserveRequest() {
      if (used.requests >= 40 || used.work >= 1_000) {
        throw Object.assign(new Error("global request budget exhausted"), {code: "GLOBAL_BUDGET"});
      }
      used.requests += 1;
      used.work += 1;
      return bytes => {
        if (used.bytes + bytes > 1_000_000) {
          throw Object.assign(new Error("global byte budget exhausted"), {code: "GLOBAL_BUDGET"});
        }
        used.bytes += bytes;
      };
    },
    recordWork(units = 1) {
      used.work += units;
      if (used.work > 1_000) throw Object.assign(new Error("global work budget exhausted"), {
        code: "GLOBAL_BUDGET"
      });
    }
  };
  const acquiredEnvelope = await makeBirdeyeObservation(fixture, {}, {budget});
  const adapter = createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    fixtureMode: "SYNTHETIC_TEST_ONLY",
    clock,
    variant: "BASE",
    fixtureBehavior: "NONE",
    warmupStore: store
  });
  const result = await adapter.acquireCandidates({
    signal: new AbortController().signal,
    remaining: {requests: 40, bytes: 1_000_000, work: 1_000, timeMs: 10_000},
    deadlineAt: clock.wallClock() + 10_000,
    recordRequest() {},
    recordWork() {},
    budget,
    acquiredEnvelope
  });
  assert.equal(result.status, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(result.warmup.status, "OFFLINE_EVALUATED");
  assert.equal(result.warmup.trust, "UNKNOWN");
  assert.equal(result.warmup.completeness, "UNKNOWN");
  assert.equal(result.pipeline.executionAuthorized, false);
  assert.ok(used.requests > 1);
  assert.ok(used.bytes > 0);
  assert.ok(used.work >= used.requests);
  const readback = await store.read(`paper-runtime-${fixture.candidateT}`);
  assert.equal(readback.status, "AVAILABLE");
  assert.equal(readback.document.records[0].trust, "UNKNOWN");
  assert.equal(readback.document.records[0].completeness, "UNKNOWN");
});

test("non-warmup runtime evaluation propagates caller cancellation into the pipeline", async () => {
  const clock = createSyntheticClock({wallStart: Date.now(), monotonicStart: 100});
  let markDispatched;
  const dispatched = new Promise(resolve => { markDispatched = resolve; });
  let requests = 0;
  const budget = {
    reserveRequest() {
      requests += 1;
      if (requests === 1) markDispatched();
      return () => {};
    }
  };
  const adapter = createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    fixtureMode: "SYNTHETIC_TEST_ONLY",
    clock,
    variant: "BASE",
    fixtureBehavior: "WAIT_FOR_STOP"
  });
  const controller = new AbortController();
  const deadlineAt = clock.wallClock() + 5_000;
  const pending = adapter.acquireCandidates({
    signal: controller.signal,
    remaining: {requests: 40, bytes: 1_000_000, work: 1_000, timeMs: 5_000},
    deadlineAt,
    recordRequest() {},
    recordWork() {},
    budget
  });
  await dispatched;
  const abortAt = performance.now();
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "STOPPED");
  assert.ok(performance.now() - abortAt < 150);
});

test("expired held persistence cannot read back or overwrite a later runtime evaluation", async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "paper-runtime-source-held-publish-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const firstFixture = makeHandoffFixture();
  const clock = createSyntheticClock({wallStart: firstFixture.assembledAt, monotonicStart: 100});
  const store = new EvidenceWarmupStore(path.join(parent, "warmup"), {enabled: true});
  const publish = store.publish.bind(store);
  const read = store.read.bind(store);
  let releasePublish;
  let enteredPublish;
  let holdFirstPublish = true;
  const publishEntered = new Promise(resolve => { enteredPublish = resolve; });
  const heldPublish = new Promise(resolve => { releasePublish = resolve; });
  const readIds = [];
  store.publish = async (input, options) => {
    if (holdFirstPublish) {
      holdFirstPublish = false;
      enteredPublish();
      await heldPublish;
      if (options?.signal?.aborted) return {status: "UNKNOWN", reason: "CANCELLED"};
    }
    return publish(input, options);
  };
  store.read = async datasetId => {
    readIds.push(datasetId);
    return read(datasetId);
  };
  const budgetState = {requests: 0, bytes: 0, work: 0};
  const budget = {
    reserveRequest() {
      budgetState.requests += 1;
      budgetState.work += 1;
      return bytes => { budgetState.bytes += bytes; };
    },
    recordWork(units = 1) { budgetState.work += units; }
  };
  const adapter = createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    fixtureMode: "SYNTHETIC_TEST_ONLY",
    clock,
    variant: "BASE",
    fixtureBehavior: "NONE",
    warmupStore: store
  });
  const acquire = async (fixture, timeoutMs) => {
    const envelope = await makeBirdeyeObservation(fixture, {}, {budget});
    return adapter.acquireCandidates({
      signal: new AbortController().signal,
      remaining: {requests: 100, bytes: 1_000_000, work: 2_000, timeMs: timeoutMs},
      deadlineAt: clock.wallClock() + timeoutMs,
      recordRequest() {},
      recordWork() {},
      budget,
      acquiredEnvelope: envelope
    });
  };

  const first = acquire(firstFixture, 300);
  await publishEntered;
  const expired = await first;
  assert.equal(expired.status, "UNKNOWN");
  assert.match(expired.reason, /DEADLINE/);
  assert.deepEqual(readIds, []);

  const laterFixture = makeHandoffFixture({candidateT: firstFixture.candidateT + 1_000});
  clock.advance(1_000);
  const later = await acquire(laterFixture, 10_000);
  assert.equal(later.status, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(later.warmup.status, "OFFLINE_EVALUATED");
  const readsAfterLaterEvaluation = [...readIds];
  assert.equal(readsAfterLaterEvaluation.length, 1);
  releasePublish();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(readIds, readsAfterLaterEvaluation);
  assert.notEqual((await read(`paper-runtime-${firstFixture.candidateT}`)).status, "AVAILABLE");
});

test("warmup persistence shares the run budget and reserves before store operations", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  const calls = [];
  const budget = {
    reserveRequest() {
      calls.push("reserve");
      return bytes => calls.push(`bytes:${bytes}`);
    }
  };
  const store = {
    async publish() { calls.push("publish"); return {status: "PUBLISHED", datasetId: "budget-test", digest: "a".repeat(64)}; },
    async read() { calls.push("read"); return {status: "UNKNOWN"}; }
  };
  const handoff = createPaperProviderWarmupHandoff({
    enabled: true,
    store,
    datasetId: "budget-test",
    runId: "budget-test-run",
    identity: fixture.identity,
    clock: () => fixture.assembledAt
  });
  const result = await handoff.runOffline({
    observation,
    request,
    pipeline: makeSyntheticHistoryPipeline(fixture),
    evaluationRequest: evaluationRequest(fixture),
    signal: new AbortController().signal,
    remaining: {requests: 10, bytes: 1_000_000, work: 20, timeMs: 10_000},
    recordRequest() {},
    recordWork() {},
    deadlineAt: fixture.assembledAt + 10_000,
    budget
  });
  assert.equal(result.reason, "WARMUP_READBACK_MISMATCH");
  assert.deepEqual(calls.map(call => call === "reserve" || call === "publish" || call === "read"
    ? call : "bytes"), ["reserve", "bytes", "publish", "reserve", "read", "bytes"]);
});

test("expired held runtime quote cannot contaminate a later evaluation", async () => {
  const clock = createSyntheticClock({wallStart: Date.now(), monotonicStart: 100});
  const adapter = createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    fixtureMode: "SYNTHETIC_TEST_ONLY",
    clock,
    variant: "BASE",
    fixtureBehavior: "WAIT_FOR_QUOTE_SETTLE"
  });
  const firstDeadline = clock.wallClock() + 10_000;
  const acquired = await adapter.acquireCandidates({
    signal: new AbortController().signal,
    remaining: {requests: 40, bytes: 1_000_000, work: 1_000, timeMs: 10_000},
    deadlineAt: firstDeadline,
    recordRequest() {},
    recordWork() {}
  });
  clock.jumpWall(firstDeadline - clock.wallClock() - 20);
  const quoteStartedAt = performance.now();
  const pending = adapter.quote({
    candidate: acquired.candidate,
    purpose: "ENTRY",
    now: clock.wallClock(),
    signal: new AbortController().signal
  });
  const quote = await pending;
  assert.ok(performance.now() - quoteStartedAt < 80);
  assert.equal(quote, null);
  assert.equal(acquired.runtimeAudit.quotes.length, 0);

  const laterDeadline = clock.wallClock() + 10_000;
  const later = await adapter.acquireCandidates({
    signal: new AbortController().signal,
    remaining: {requests: 40, bytes: 1_000_000, work: 1_000, timeMs: 10_000},
    deadlineAt: laterDeadline,
    recordRequest() {},
    recordWork() {}
  });
  assert.equal(later.status, "SYNTHETIC_FIXTURE_ONLY");
  const laterAuditBeforeRelease = structuredClone(later.runtimeAudit);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(acquired.runtimeAudit.quotes.length, 0);
  assert.deepEqual(later.runtimeAudit, laterAuditBeforeRelease);
});

test("forged provider receipt cannot publish or reach the evaluation", async () => {
  const fixture = makeHandoffFixture();
  const {observation, request} = await makeBirdeyeObservation(fixture);
  observation.receipt.payloadSha256 = "0".repeat(64);
  let calls = 0;
  const store = {
    async publish() { calls += 1; },
    async read() { calls += 1; }
  };
  const handoff = createPaperProviderWarmupHandoff({
    enabled: true,
    store,
    datasetId: "forged-test",
    runId: "synthetic-only",
    identity: fixture.identity,
    clock: () => fixture.assembledAt
  });
  const result = await handoff.runOffline({
    observation,
    request,
    pipeline: makeSyntheticHistoryPipeline(fixture),
    evaluationRequest: evaluationRequest(fixture)
  });
  assert.equal(result.reason, "PROVIDER_OBSERVATION_UNBOUND");
  assert.equal(calls, 0);
});
