import assert from "node:assert/strict";
import test from "node:test";
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
