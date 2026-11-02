import assert from "node:assert/strict";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createObservationAudit,
  MAX_OBSERVATION_AUDIT_BYTES,
  persistObservationAudit,
  renderObservationAudit,
  validateObservationAudit
} from "../scripts/memecoin-paper/observation-audit.mjs";
import {createBlockedDecisions, createObservationFixture} from "./fixtures/memecoin-paper-observation-audit/generate.mjs";

const RUN_ID = "observation-audit-fixture";
const CONFIG_HASH = "a".repeat(64);

function createAudit({maxRequests = 960, maxCandidates = 300, maxBytes} = {}) {
  return createObservationAudit({
    runId: RUN_ID,
    configHash: CONFIG_HASH,
    maxRequests,
    maxCandidates,
    ...(maxBytes === undefined ? {} : {maxBytes})
  });
}

test("generated 159-candidate all-blocked run keeps reasons and reconciled mixed provider outcomes", () => {
  const fixture = createObservationFixture(159);
  const audit = createAudit({maxRequests: fixture.accounting.requests, maxCandidates: 159});
  audit.recordProviderEvents(fixture.providerEvents, 0);
  const {filters, analysis} = createBlockedDecisions();
  for (const candidate of fixture.candidates) audit.recordCandidate(candidate, filters, analysis, 0);
  assert.equal(audit.setProviderAccounting(fixture.accounting), true);

  const result = audit.snapshot();
  assert.equal(result.records.providerRequests.length, 636);
  assert.equal(result.records.candidates.length, 159);
  assert.equal(result.summary.requests.successful, 318);
  assert.equal(result.summary.requests.failed, 318);
  assert.equal(result.summary.requests.unknown, 0);
  assert.equal(result.summary.requests.totalsReconciled, true);
  assert.equal(result.summary.candidates.filterOutcomes.UNKNOWN, 159);
  assert.equal(result.summary.candidates.analystOutcomes.BLOCKED, 159);
  assert.ok(result.summary.candidates.majorBlockReasons.some(reason =>
    reason.reason === "required evidence missing" && reason.count === 159));
  assert.ok(result.summary.candidates.majorBlockReasons.some(reason =>
    reason.reason === "hard filters must all PASS before scoring" && reason.count === 159));
  assert.equal(validateObservationAudit(result, {runId: RUN_ID, configHash: CONFIG_HASH}), true);
});

test("request event allowlist preserves real status, reason, time and identity without raw data", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 8, maxCandidates: 2});
  const first = fixture.providerEvents[0];
  audit.recordProviderEvents([{
    ...first,
    reason: "bad https://private.example/path ******",
    rawResponse: {authorization: "private"}
  }], 3);
  audit.setProviderAccounting({...fixture.accounting, requests: 1, bytes: 16,
    providerEvents: 1, dexRequests: 1, rpcRequests: 0, candidates: 0});

  const [record] = audit.snapshot().records.providerRequests;
  assert.equal(record.requestId, first.requestId);
  assert.equal(record.cycleIndex, 3);
  assert.equal(record.provider, first.provider);
  assert.equal(record.status, "RECEIVED");
  assert.equal(record.requestedAt, first.requestedAt);
  assert.deepEqual(record.requested, first.requested);
  assert.equal(record.reason, "bad [url] ******");
  assert.equal("rawResponse" in record, false);
  assert.equal("headers" in record, false);
});

test("returned identity preserves each valid field when another field is missing or invalid", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.recordProviderEvents([{
    ...fixture.providerEvents[0],
    returned: {
      chainId: "solana",
      mint: fixture.candidates[0].mint,
      pool: fixture.candidates[0].pool,
      quote: null
    }
  }], 0);

  assert.deepEqual(audit.snapshot().records.providerRequests[0].returned, {
    chainId: "solana",
    mint: fixture.candidates[0].mint,
    pool: fixture.candidates[0].pool,
    quote: null
  });
});

test("known missing-source-time request failure is not downgraded to UNKNOWN", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.recordProviderEvents([{
    ...fixture.providerEvents[0],
    status: "MISSING_PAIR_CREATED_AT",
    reason: "pairCreatedAt is required for pair evidence"
  }], 0);
  audit.setProviderAccounting({
    requests: 1, bytes: 0, providerEvents: 1, dexRequests: 1, rpcRequests: 0, candidates: 0
  });
  assert.equal(audit.snapshot().summary.requests.failed, 1);
  assert.equal(audit.snapshot().summary.requests.unknown, 0);
});

test("free-text bounds set an explicit truncation flag", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 4, maxCandidates: 1});
  audit.recordProviderEvents([{
    ...fixture.providerEvents[0],
    reason: "x".repeat(200)
  }], 0);
  const result = audit.snapshot();
  assert.equal(result.records.providerRequests[0].reason.length, 160);
  assert.equal(result.truncation.textFields, true);
});

test("missing request and candidate evidence is declared as UNKNOWN omission, not inferred success", () => {
  const fixture = createObservationFixture(2);
  const audit = createAudit({maxRequests: 8, maxCandidates: 2});
  audit.recordProviderEvents(fixture.providerEvents.slice(0, 2), 0);
  const {filters, analysis} = createBlockedDecisions();
  audit.recordCandidate(fixture.candidates[0], filters, analysis, 0);
  audit.setProviderAccounting({
    requests: 8, bytes: fixture.accounting.bytes, providerEvents: 8,
    dexRequests: 2, rpcRequests: 6, candidates: 2
  });
  const result = audit.snapshot();

  assert.equal(result.summary.requests.successful, 1);
  assert.equal(result.summary.requests.failed, 1);
  assert.equal(result.summary.requests.unknown, 6);
  assert.equal(result.omissions.providerRequests, 6);
  assert.equal(result.omissions.candidateOutcomes, 1);
  assert.equal(result.summary.requests.totalsReconciled, true);
  assert.equal(result.summary.candidates.totalsReconciled, true);
  assert.equal(result.summary.candidates.filterOutcomes.UNKNOWN, 2);
  assert.equal(result.summary.candidates.analystOutcomes.UNKNOWN, 1);
});

test("row and byte bounds truncate deterministically and disclose omissions", () => {
  const fixture = createObservationFixture(3);
  const audit = createAudit({maxRequests: 2, maxCandidates: 2, maxBytes: 2_048});
  audit.recordProviderEvents(fixture.providerEvents, 0);
  const {filters, analysis} = createBlockedDecisions();
  for (const candidate of fixture.candidates) audit.recordCandidate(candidate, filters, analysis, 0);
  audit.setProviderAccounting(fixture.accounting);
  const result = audit.snapshot();

  assert.equal(result.bounds.maxBytes, 2_048);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= result.bounds.maxBytes);
  assert.equal(result.truncation.providerRows, true);
  assert.equal(result.truncation.candidateRows, true);
  assert.equal(result.truncation.byteLimit, true);
  assert.equal(result.summary.requests.totalsReconciled, true);
  assert.equal(result.summary.candidates.totalsReconciled, true);
  assert.equal(result.summary.candidates.filterOutcomes.UNKNOWN, 3);
  assert.equal(result.summary.candidates.analystOutcomes.UNKNOWN, 3);
  assert.equal(validateObservationAudit(result, {runId: RUN_ID, configHash: CONFIG_HASH}), true);
});

test("per-stage check bounds expose omitted checks in the artifact and rendered summary", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  const checks = count => Object.fromEntries(Array.from({length: count}, (_, index) => [
    `check-${index}`, {status: "UNKNOWN", reason: "evidence unavailable"}
  ]));
  audit.recordCandidate(fixture.candidates[0], {
    status: "UNKNOWN",
    reason: "filters unavailable",
    checks: checks(22)
  }, {
    status: "BLOCKED",
    reason: "analysis blocked",
    components: checks(23)
  }, 0);
  audit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 1
  });
  const result = audit.snapshot();

  assert.equal(result.records.candidates[0].filter.checks.length, 20);
  assert.equal(result.records.candidates[0].filter.omittedChecks, 2);
  assert.equal(result.records.candidates[0].analysis.checks.length, 20);
  assert.equal(result.records.candidates[0].analysis.omittedChecks, 3);
  assert.equal(result.omissions.filterChecks, 2);
  assert.equal(result.omissions.analysisChecks, 3);
  assert.equal(result.summary.candidates.omittedChecks.filter, 2);
  assert.equal(result.summary.candidates.omittedChecks.analysis, 3);
  assert.equal(result.truncation.filterChecks, true);
  assert.equal(result.truncation.analysisChecks, true);
  assert.match(renderObservationAudit(result),
    /Checks omitted: filter=2, analyst=3; check truncation filter=true, analyst=true/);
  assert.equal(validateObservationAudit(result, {runId: RUN_ID, configHash: CONFIG_HASH}), true);
  const undeclared = JSON.parse(JSON.stringify(result));
  undeclared.truncation.filterChecks = false;
  assert.equal(validateObservationAudit(undeclared, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
});

test("unexpected request rows and malformed nested checks are not reconciled", () => {
  const audit = createAudit({maxRequests: 4, maxCandidates: 1});
  const fixture = createObservationFixture(1);
  audit.recordProviderEvents(fixture.providerEvents, 0);
  audit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 0
  });
  const extraRequest = audit.snapshot();
  assert.equal(extraRequest.summary.requests.totalsReconciled, false);
  assert.equal(extraRequest.summary.requests.unexpected, 4);

  const candidateAudit = createAudit({maxRequests: 1, maxCandidates: 1});
  const {filters, analysis} = createBlockedDecisions();
  candidateAudit.recordCandidate(fixture.candidates[0], filters, analysis, 0);
  candidateAudit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 1
  });
  const malformed = candidateAudit.snapshot();
  malformed.records.candidates[0].filter.checks = [null];
  assert.equal(validateObservationAudit(malformed, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
  malformed.records.candidates[0].filter.checks = [{
    name: "identity", status: "UNKNOWN", reason: 17, source: null, observedAt: null
  }];
  assert.equal(validateObservationAudit(malformed, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
});

test("persisted audits reject declared-bound violations and missing check names", () => {
  const fixture = createObservationFixture(2);
  const audit = createAudit({maxRequests: 8, maxCandidates: 2});
  audit.recordProviderEvents(fixture.providerEvents, 0);
  const {filters, analysis} = createBlockedDecisions();
  const filtersWithChecks = {
    ...filters,
    checks: Object.fromEntries(Array.from({length: 21}, (_, index) => [
      `check-${index}`, {status: "UNKNOWN", reason: "evidence unavailable"}
    ]))
  };
  for (const candidate of fixture.candidates) {
    audit.recordCandidate(candidate, filtersWithChecks, analysis, 0);
  }
  audit.setProviderAccounting(fixture.accounting);
  const snapshot = audit.snapshot();

  for (const mutate of [
    result => { result.bounds.maxProviderRequestRows = 7; },
    result => { result.bounds.maxCandidateRows = 1; },
    result => { result.bounds.maxChecksPerCandidate = 19; },
    result => { result.bounds.maxTextLength = 20; },
    result => { result.bounds.maxBytes = 1_024; },
    result => { result.summary = null; },
    result => { result.summary.requests.successful = {toString: null}; },
    result => { result.records.candidates[0].filter.checks[0].name = null; }
  ]) {
    const malformed = structuredClone(snapshot);
    mutate(malformed);
    assert.equal(validateObservationAudit(malformed, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
  }
});

test("non-string persisted request statuses fail validation without classifier coercion", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.recordProviderEvents(fixture.providerEvents.slice(0, 1), 0);
  const malformed = audit.snapshot();
  malformed.records.providerRequests[0].status = {toString: null};
  assert.equal(validateObservationAudit(malformed, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
});

test("persisted request diagnostics are bounded, sanitized, and allowlisted", () => {
  const fixture = createObservationFixture(1);
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.recordProviderEvents(fixture.providerEvents.slice(0, 1), 0);
  const persisted = audit.snapshot();
  for (const mutate of [
    request => { request.reason = {toString: null}; },
    request => { request.reason = "failed at https://private.example/request"; },
    request => { request.status = "x".repeat(65); },
    request => { request.extra = "unvalidated diagnostic"; }
  ]) {
    const malformed = structuredClone(persisted);
    mutate(malformed.records.providerRequests[0]);
    assert.equal(validateObservationAudit(malformed, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
  }
});

test("audit rejects stale run and configuration identity", () => {
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 0
  });
  const result = audit.snapshot();
  assert.equal(validateObservationAudit(result), false);
  assert.equal(validateObservationAudit(result, {runId: RUN_ID}), false);
  assert.equal(validateObservationAudit(result, {runId: "another-run", configHash: CONFIG_HASH}), false);
  assert.equal(validateObservationAudit(result, {runId: RUN_ID, configHash: "b".repeat(64)}), false);
  const unbound = structuredClone(result);
  delete unbound.runId;
  delete unbound.configHash;
  assert.equal(validateObservationAudit(unbound), false);
});

test("terminal null failure remains distinct from an explicit UNKNOWN failure", () => {
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.setTerminal({
    runStatus: "UNKNOWN", controllerStatus: "UNKNOWN", stopReason: null, failureCode: null
  });
  const noFailure = audit.snapshot();
  assert.equal(noFailure.terminal.failureCode, null);
  assert.match(renderObservationAudit(noFailure), /UNKNOWN\/UNKNOWN\/null/);

  audit.setTerminal({
    runStatus: "UNKNOWN", controllerStatus: "UNKNOWN", stopReason: null, failureCode: "UNKNOWN"
  });
  const unknownFailure = audit.snapshot();
  assert.equal(unknownFailure.terminal.failureCode, "UNKNOWN");
  assert.match(renderObservationAudit(unknownFailure), /UNKNOWN\/UNKNOWN\/UNKNOWN/);
});

test("terminal failure codes preserve bounded controller names without accepting hostile text", () => {
  for (const failureCode of ["Error", "TypeError", "a".repeat(48), "A".repeat(80)]) {
    const audit = createAudit();
    audit.setTerminal({
      runStatus: "UNKNOWN", controllerStatus: "UNKNOWN", stopReason: null, failureCode
    });
    const result = audit.snapshot();
    assert.equal(result.terminal.failureCode, failureCode);
    assert.equal(validateObservationAudit(result, {runId: RUN_ID, configHash: CONFIG_HASH}), true);
    assert.match(renderObservationAudit(result), new RegExp(failureCode));

    for (const invalid of ["a".repeat(49), "A".repeat(81), "TypeError:detail",
      "bad text", "Error\n", "<script>", "https://private.example", {}, undefined]) {
      const malformed = structuredClone(result);
      malformed.terminal.failureCode = invalid;
      assert.equal(validateObservationAudit(malformed, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
      audit.setTerminal({
        runStatus: "UNKNOWN", controllerStatus: "UNKNOWN", stopReason: null, failureCode: invalid
      });
      assert.equal(audit.snapshot().terminal.failureCode, "UNKNOWN");
    }
    const malformedStatus = structuredClone(result);
    malformedStatus.terminal.controllerStatus = "TypeError";
    assert.equal(validateObservationAudit(malformedStatus, {runId: RUN_ID, configHash: CONFIG_HASH}), false);
  }
});

test("audit persistence is atomic, bounded, and reports write failures", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "meridian-observation-audit-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const audit = createAudit({maxRequests: 1, maxCandidates: 1});
  audit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 0
  });
  const target = path.join(root, "audit.json");
  const persisted = await persistObservationAudit(target, audit);
  assert.ok(persisted.bytes <= MAX_OBSERVATION_AUDIT_BYTES);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), persisted.snapshot);
  await assert.rejects(persistObservationAudit(path.join(root, "missing", "audit.json"), audit));

  const boundedAudit = createAudit({maxRequests: 1, maxCandidates: 1});
  boundedAudit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 0
  });
  const boundedTarget = path.join(root, "write-bound.json");
  await persistObservationAudit(boundedTarget, boundedAudit, {maxWrites: 1});
  await assert.rejects(
    persistObservationAudit(boundedTarget, boundedAudit, {maxWrites: 1}),
    /write-count budget/
  );

  const byteBoundedAudit = createAudit({maxRequests: 1, maxCandidates: 1});
  byteBoundedAudit.setProviderAccounting({
    requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 0
  });
  const byteBoundedTarget = path.join(root, "byte-bound.json");
  const firstWrite = await persistObservationAudit(byteBoundedTarget, byteBoundedAudit);
  await assert.rejects(
    persistObservationAudit(byteBoundedTarget, byteBoundedAudit, {
      maxTotalBytes: firstWrite.bytes
    }),
    /cumulative byte-write budget/
  );
  assert.deepEqual(JSON.parse(await readFile(byteBoundedTarget, "utf8")), firstWrite.snapshot);
});
