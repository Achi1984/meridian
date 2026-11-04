import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {EvidenceWarmupStore} from "../scripts/memecoin-paper/evidence-warmup/index.mjs";
import {createPaperPilotComposition} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {
  PAPER_RUNTIME_SOURCE_POLICY,
  isIssuedRuntimeCandidate
} from "../scripts/memecoin-paper/paper-runtime-source.mjs";
import {
  evaluationRequest,
  makeBirdeyeObservation,
  makeHandoffFixture
} from "./fixtures/memecoin-paper-provider-warmup-handoff/synthetic.mjs";
import {createSyntheticClock} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {
  PAPER_RUNTIME_EVIDENCE_REQUIREMENTS,
  PAPER_RUNTIME_SOURCE_POLICY_SHA256,
  createPaperRuntimeSourceAdapter,
  resolveRuntimeCandidateArray
} from "../scripts/memecoin-paper/paper-runtime-source.mjs";

const live = {
  signal: new AbortController().signal,
  remaining: {requests: 4, bytes: 1_000, candidates: 4},
  recordRequest() {},
  recordWork() {}
};

test("production candidate resolution never yields eligible candidates and keeps explicit refusals", () => {
  const forged = [{mint: "M", review: {status: "REVIEWED"}, trusted: true, enabled: true}];
  for (const input of [forged, {candidates: forged, fixtureOnly: true}, null]) {
    const result = resolveRuntimeCandidateArray(input);
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.refusals.map(item => item.requirement), PAPER_RUNTIME_EVIDENCE_REQUIREMENTS);
    assert.equal(result.refusals.find(item => item.requirement === "REVIEWER_AUTHORITY").reason,
      "ACCEPTANCE_AUTHORITY_UNRESOLVED");
  }
});

test("synthetic resolution returns the canonical array and rejects non-array shapes", () => {
  const row = {mint: "M"};
  assert.deepEqual(resolveRuntimeCandidateArray([row], {synthetic: true}).candidates, [row]);
  assert.deepEqual(resolveRuntimeCandidateArray({fixtureOnly: true, candidates: [row]}, {synthetic: true}).candidates, [row]);
  assert.deepEqual(resolveRuntimeCandidateArray({candidates: [row]}, {synthetic: true}).candidates, []);
  assert.deepEqual(resolveRuntimeCandidateArray([row, [1]], {synthetic: true}).candidates, []);
});

test("production adapter stays disabled, reports refusals, and refuses non-issued quotes", async () => {
  const adapter = createPaperRuntimeSourceAdapter({sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256});
  const result = await adapter.acquireCandidates(live);
  assert.equal(result.reason, "SOURCE_POLICY_UNAPPROVED");
  assert.deepEqual(result.candidates, []);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.refusals.length, PAPER_RUNTIME_EVIDENCE_REQUIREMENTS.length);
  const forged = {chainId: "solana", mint: "M", pool: "P", quote: "Q", sampledAt: 1, trusted: true};
  const quote = await adapter.quote({candidate: forged, purpose: "ENTRY"});
  assert.equal(quote.status, "UNAVAILABLE");
  assert.deepEqual(quote.reasons, ["CANDIDATE_NOT_MODULE_ISSUED"]);
  assert.equal(quote.authorizationEligible, false);
});

test("synthetic adapter yields the canonical array; cancellation rejects as STOPPED", async () => {
  const clock = createSyntheticClock({wallStart: Date.now(), monotonicStart: 100});
  const adapter = createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    fixtureMode: "SYNTHETIC_TEST_ONLY",
    clock,
    variant: "BASE",
    fixtureBehavior: "NONE"
  });
  const input = {
    signal: new AbortController().signal,
    remaining: {requests: 40, bytes: 1_000_000, work: 1_000, timeMs: 10_000},
    deadlineAt: clock.wallClock() + 10_000,
    recordRequest() {},
    recordWork() {}
  };
  const rows = await adapter.acquireCandidateArray(input);
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].syntheticRuntime.label, "SYNTHETIC_FIXTURE_ONLY");

  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(adapter.acquireCandidateArray({...input, signal: stopped.signal}), {code: "STOPPED"});
});

async function diagnosticSetup(t, mutate = value => value) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "paper-runtime-diagnostic-"));
  t.after(() => rm(parent, {recursive: true, force: true}));
  const fixture = makeHandoffFixture({candidateT: Math.floor(Date.now() / 1_000) * 1_000 - 60_000});
  const {observation, request} = await makeBirdeyeObservation(fixture);
  const request2 = evaluationRequest(fixture);
  delete request2.censusSource;
  delete request2.priceSource;
  const input = mutate({
    observation,
    request,
    evaluationRequest: request2,
    slotRange: {startInclusive: 490_000, endInclusive: 490_020}
  });
  return {
    parent,
    fixture,
    input,
    warmupStore: new EvidenceWarmupStore(path.join(parent, "warmup"), {enabled: true})
  };
}

function diagnosticAdapter({input, warmupStore}) {
  return createPaperRuntimeSourceAdapter({
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256,
    diagnosticInput: input,
    warmupStore
  });
}

function sharedInput(overrides = {}) {
  const used = {requests: 0, work: 0};
  return {
    used,
    input: {
      signal: new AbortController().signal,
      remaining: {requests: 40, bytes: 1_000_000, candidates: 4, work: 1_000, timeMs: 10_000},
      deadlineAt: Date.now() + 10_000,
      recordRequest() { used.requests += 1; },
      recordWork(units = 1) { used.work += units; },
      ...overrides
    }
  };
}

test("external diagnostic normalizes supplied evidence to UNKNOWN with zero candidates and no network", async t => {
  const setup = await diagnosticSetup(t);
  const {input, used} = sharedInput();
  const result = await diagnosticAdapter(setup).acquireCandidates(input);
  assert.equal(result.reason, "SOURCE_POLICY_UNAPPROVED");
  assert.deepEqual(result.candidates, []);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.diagnostic.status, "OFFLINE_EVALUATED");
  assert.equal(result.diagnostic.mode, "EXTERNAL_READ_ONLY_INPUT");
  assert.equal(result.diagnostic.trust, "UNKNOWN");
  assert.equal(result.diagnostic.completeness, "UNKNOWN");
  assert.equal(result.diagnostic.eligibleCandidates, 0);
  assert.equal(result.diagnostic.realDataEntryEligible, false);
  assert.ok(used.requests >= 1);
});

test("forged review claims and fixture trust cannot create a candidate in external diagnostic mode", async t => {
  const setup = await diagnosticSetup(t, value => {
    value.evaluationRequest.reviewEvidence.top10OwnerPct = {
      status: "REVIEWED", reviewerId: "forged", reviewId: "forged", reviewedAt: 1
    };
    value.evaluationRequest.trusted = true;
    return value;
  });
  const {input} = sharedInput();
  const result = await diagnosticAdapter(setup).acquireCandidates(input);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.diagnostic.eligibleCandidates, 0);
  assert.notEqual(result.diagnostic.status, "OFFLINE_EVALUATED");
});

test("partial or mismatched supplied evidence is refused without storage evaluation", async t => {
  const partial = await diagnosticSetup(t, value => {
    delete value.observation.sourceAtMs;
    return value;
  });
  const {input} = sharedInput();
  const result = await diagnosticAdapter(partial).acquireCandidates(input);
  assert.deepEqual(result.candidates, []);
  assert.notEqual(result.diagnostic.status, "OFFLINE_EVALUATED");
  assert.equal(result.diagnostic.eligibleCandidates, 0);

  const mismatch = await diagnosticSetup(t, value => {
    value.request = {...value.request, mint: "Vote111111111111111111111111111111111111111"};
    return value;
  });
  const wrong = await diagnosticAdapter(mismatch).acquireCandidates(sharedInput().input);
  assert.notEqual(wrong.diagnostic.status, "OFFLINE_EVALUATED");
});

test("diagnostic input shape and injected callbacks are rejected", async t => {
  const setup = await diagnosticSetup(t);
  for (const options of [
    {diagnosticInput: setup.input},
    {diagnosticInput: {...setup.input, trusted: true}, warmupStore: setup.warmupStore},
    {diagnosticInput: setup.input, warmupStore: setup.warmupStore, review: () => true}
  ]) {
    assert.throws(() => createPaperRuntimeSourceAdapter({
      sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256, ...options
    }), TypeError);
  }
});

test("diagnostic honors exhausted budget, cancellation, and deadline", async t => {
  const setup = await diagnosticSetup(t);
  const adapter = diagnosticAdapter(setup);
  const exhausted = await adapter.acquireCandidates(sharedInput({
    remaining: {requests: 0, bytes: 1_000_000, candidates: 4, work: 1_000, timeMs: 10_000}
  }).input);
  assert.equal(exhausted.diagnostic.status, "REFUSED");
  assert.equal(exhausted.diagnostic.reason, "GLOBAL_BUDGET");
  assert.deepEqual(exhausted.candidates, []);

  const stopped = new AbortController();
  stopped.abort();
  const cancelled = await adapter.acquireCandidates(sharedInput({signal: stopped.signal}).input);
  assert.equal(cancelled.reason, "STOPPED");
  assert.deepEqual(cancelled.candidates, []);
  assert.equal(cancelled.diagnostic, undefined);

  const expired = await adapter.acquireCandidates(sharedInput({
    remaining: {requests: 40, bytes: 1_000_000, candidates: 4, work: 1_000, timeMs: 0}
  }).input);
  assert.equal(expired.diagnostic.reason, "GLOBAL_BUDGET");
  assert.equal(expired.diagnostic.eligibleCandidates, 0);
});

test("a held publication cannot evaluate after the shared deadline", async t => {
  const setup = await diagnosticSetup(t);
  let evaluated = false;
  let release;
  let markEntered;
  const held = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { markEntered = resolve; });
  const store = {
    async publish() { markEntered(); await held; return {status: "PUBLISHED"}; },
    async read() { evaluated = true; return {status: "UNAVAILABLE"}; }
  };
  const pending = diagnosticAdapter({input: setup.input, warmupStore: store}).acquireCandidates(
    sharedInput({remaining: {requests: 40, bytes: 1_000_000, candidates: 4, work: 1_000, timeMs: 60}}).input
  );
  await entered;
  const result = await pending;
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.notEqual(result.diagnostic.status, "OFFLINE_EVALUATED");
  assert.equal(evaluated, false);
  assert.deepEqual(result.candidates, []);
});

test("held publication is cancelled by the caller only after publication was entered", async t => {
  const setup = await diagnosticSetup(t);
  let evaluated = false;
  let release;
  let markEntered;
  const held = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { markEntered = resolve; });
  const store = {
    async publish() { markEntered(); await held; return {status: "PUBLISHED"}; },
    async read() { evaluated = true; return {status: "UNAVAILABLE"}; }
  };
  const controller = new AbortController();
  const pending = diagnosticAdapter({input: setup.input, warmupStore: store}).acquireCandidates(
    sharedInput({signal: controller.signal}).input
  );
  await entered;
  controller.abort();
  const result = await pending;
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(result.reason, "STOPPED");
  assert.deepEqual(result.candidates, []);
  assert.equal(evaluated, false);
});

test("nested accessors are rejected without invocation and later mutation is isolated", async t => {
  const setup = await diagnosticSetup(t);
  let getterCalls = 0;
  const hostile = {...setup.input, evaluationRequest: {...setup.input.evaluationRequest}};
  Object.defineProperty(hostile.evaluationRequest, "providerCandidate", {
    enumerable: true,
    get() { getterCalls += 1; return setup.input.evaluationRequest.providerCandidate; }
  });
  assert.throws(() => diagnosticAdapter({input: hostile, warmupStore: setup.warmupStore}), TypeError);
  const slot = {...setup.input, slotRange: {}};
  Object.defineProperty(slot.slotRange, "startInclusive", {
    enumerable: true, get() { getterCalls += 1; return 1; }
  });
  assert.throws(() => diagnosticAdapter({input: slot, warmupStore: setup.warmupStore}), TypeError);
  const request = {...setup.input, request: {...setup.input.request}};
  Object.defineProperty(request.request, "atMs", {enumerable: true, get() { getterCalls += 1; return 1; }});
  assert.throws(() => diagnosticAdapter({input: request, warmupStore: setup.warmupStore}), TypeError);
  assert.equal(getterCalls, 0);

  const adapter = diagnosticAdapter(setup);
  setup.input.evaluationRequest.providerCandidate.mint = "Vote111111111111111111111111111111111111111";
  setup.input.request.atMs = 1;
  setup.input.slotRange.endInclusive = 1;
  const result = await adapter.acquireCandidates(sharedInput().input);
  assert.equal(result.diagnostic.status, "OFFLINE_EVALUATED");
  assert.deepEqual(result.candidates, []);
});

test("only module-issued candidates are recognized", () => {
  assert.equal(isIssuedRuntimeCandidate({chainId: "solana", mint: "M", pool: "P", quote: "Q", sampledAt: 1}), false);
  assert.equal(isIssuedRuntimeCandidate(null), false);
});

test("source-backed composition carries the diagnostic into the UNKNOWN assessment with zero quotes", async t => {
  const setup = await diagnosticSetup(t);
  const sourceConfig = {
    version: 1,
    mode: "SOURCE_BACKED_PAPER",
    enabled: true,
    runId: "source-diagnostic",
    startedAt: Date.now() - 1_000,
    budgets: {
      requests: 40, bytes: 1_000_000, events: 128, candidates: 4, cycles: 8,
      durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10
    },
    sourcePolicy: PAPER_RUNTIME_SOURCE_POLICY,
    sourcePolicySha256: PAPER_RUNTIME_SOURCE_POLICY_SHA256
  };
  const report = await createPaperPilotComposition({
    config: sourceConfig,
    dataDirectory: path.join(setup.parent, "source"),
    sourceDiagnostic: {input: setup.input, warmupStore: setup.warmupStore}
  }).start();
  assert.equal(report.status, "UNKNOWN");
  const policy = report.report.runnerReport.sourcePolicy;
  assert.equal(policy.status, "UNAPPROVED");
  assert.equal(policy.networkAccessed, false);
  assert.equal(policy.diagnostic.eligibleCandidates, 0);
  assert.equal(policy.diagnostic.trust, "UNKNOWN");
  assert.equal(report.report.runnerReport.counters.quotes, 0);
  assert.throws(() => createPaperPilotComposition({
    config: {...sourceConfig, mode: "SYNTHETIC_TEST_ONLY", sourcePolicy: undefined, sourcePolicySha256: undefined},
    dataDirectory: path.join(setup.parent, "x"),
    sourceDiagnostic: {input: setup.input, warmupStore: setup.warmupStore}
  }), TypeError);
});
