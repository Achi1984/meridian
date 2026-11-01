import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import test from "node:test";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {
  MAX_READINESS_PACKET_BYTES,
  projectPilotReadiness
} from "../scripts/memecoin-paper/pilot-readiness.mjs";

const fixtureUrl = new URL("./fixtures/memecoin-paper-pilot-readiness/incomplete.json", import.meta.url);
const sourceManifestUrl = new URL("../scripts/memecoin-paper/run-manifest.json", import.meta.url);
const MINT = "So11111111111111111111111111111111111111112";
const POOL = "11111111111111111111111111111112";
const QUOTE = "So11111111111111111111111111111111111111112";
const AS_OF = Date.parse("2026-11-01T00:00:00Z");
const SHA1 = "a".repeat(40);

async function basePacket() {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const sourceManifest = JSON.parse(await readFile(sourceManifestUrl, "utf8"));
  assert.deepEqual(fixture.manifest, sourceManifest);
  return fixture;
}

function digest(value) {
  return createHash("sha256").update(canonicalCheckpointBytes(value)).digest("hex");
}

function makeConfiguredPacket(packet) {
  packet.codeCommit = SHA1;
  packet.manifest = structuredClone(packet.manifest);
  packet.manifest.runId = "pilot-20261101";
  packet.manifest.startAt = AS_OF;
  packet.manifest.endAt = AS_OF + 8 * 60 * 60 * 1000;
  packet.manifest.allowedMints = [MINT];
  packet.manifest.allowedPools = [POOL];
  packet.candidateIdentities = [{chainId: "solana", mint: MINT, pool: POOL, quote: QUOTE}];
  packet.configurationSha256 = digest(packet.manifest);
  packet.candidateIdentitySha256 = digest(packet.candidateIdentities);
  return packet;
}

function setEvidence(packet, name, overrides = {}) {
  packet.operationalEvidence[name] = {
    status: "VERIFIED",
    kind: "OBSERVED",
    source: "local-review-receipt",
    observedAt: AS_OF,
    expiresAt: AS_OF,
    binding: {
      codeCommit: packet.codeCommit,
      configurationSha256: packet.configurationSha256,
      candidateIdentitySha256: packet.candidateIdentitySha256,
      runId: packet.manifest.runId
    },
    ...overrides
  };
}

test("incomplete shipped manifest preserves unset fields and never grants authority", async () => {
  const packet = await basePacket();
  const report = projectPilotReadiness(packet);
  assert.equal(report.inputStatus, "VALID");
  assert.equal(report.identities.codeCommit, "UNSET");
  assert.equal(report.identities.runId, "UNSET");
  assert.equal(report.identities.startAt, "UNSET");
  assert.equal(report.dimensions.SOURCE_READY.ready, false);
  assert.equal(report.dimensions.OPERATIONALLY_VERIFIED.verified, false);
  assert.equal(report.dimensions.RUN_AUTHORIZED.authorized, false);
  assert.equal(report.executionStarted, false);
  assert.equal(report.limitProfile.initialCapitalCents, "100000");
  assert.equal(report.limitProfile.maxEntryUsd, "80");
  assert.equal(report.limitProfile.maxOpenPositions, 3);
  assert.equal(report.limitProfile.dailyLossUsd, "30");
});

test("missing and unknown operational evidence remain distinct blockers", async () => {
  const packet = makeConfiguredPacket(await basePacket());
  packet.operationalEvidence.clock = {status: "UNKNOWN", kind: "UNKNOWN"};
  const report = projectPilotReadiness(packet);
  assert.equal(report.operationalEvidence.provider, "UNSET");
  assert.equal(report.operationalEvidence.clock, "UNKNOWN");
  assert.ok(report.dimensions.OPERATIONALLY_VERIFIED.blockers.includes("clock:UNKNOWN"));
});

test("synthetic evidence and synthetic candidate data cannot satisfy operational evidence", async () => {
  const packet = makeConfiguredPacket(await basePacket());
  for (const name of Object.keys(packet.operationalEvidence)) {
    setEvidence(packet, name, {kind: "SYNTHETIC"});
  }
  const report = projectPilotReadiness(packet);
  assert.equal(report.operationalEvidence.provider, "SYNTHETIC");
  assert.ok(report.dimensions.OPERATIONALLY_VERIFIED.blockers
    .includes("provider:SYNTHETIC_EVIDENCE_NOT_OPERATIONAL"));
  assert.ok(Object.values(report.operationalEvidence).every(status => status === "SYNTHETIC"));
  assert.equal(report.dimensions.RUN_AUTHORIZED.authorized, false);
});

test("mixed source, configuration, candidate, or run bindings fail closed", async () => {
  for (const binding of [
    {codeCommit: "b".repeat(40)},
    {configurationSha256: "b".repeat(64)},
    {candidateIdentitySha256: "b".repeat(64)},
    {runId: "different-run"}
  ]) {
    const packet = makeConfiguredPacket(await basePacket());
    setEvidence(packet, "provider", {binding: {
      codeCommit: packet.codeCommit,
      configurationSha256: packet.configurationSha256,
      candidateIdentitySha256: packet.candidateIdentitySha256,
      runId: packet.manifest.runId,
      ...binding
    }});
    const report = projectPilotReadiness(packet);
    assert.equal(report.operationalEvidence.provider, "MISMATCH");
    assert.ok(report.dimensions.OPERATIONALLY_VERIFIED.blockers.includes("provider:IDENTITY_MISMATCH"));
  }
});

test("expired and future-dated evidence is not accepted; expiry boundary is inclusive", async () => {
  const expired = makeConfiguredPacket(await basePacket());
  setEvidence(expired, "clock", {expiresAt: AS_OF - 1});
  assert.equal(projectPilotReadiness(expired).operationalEvidence.clock, "STALE");

  const future = makeConfiguredPacket(await basePacket());
  setEvidence(future, "clock", {observedAt: AS_OF + 1});
  assert.equal(projectPilotReadiness(future).operationalEvidence.clock, "STALE");

  const exact = makeConfiguredPacket(await basePacket());
  setEvidence(exact, "clock", {observedAt: AS_OF, expiresAt: AS_OF});
  assert.equal(projectPilotReadiness(exact).operationalEvidence.clock, "ASSERTED_VERIFIED");
});

test("hash drift and malformed candidate identities are rejected", async () => {
  const mixed = makeConfiguredPacket(await basePacket());
  mixed.configurationSha256 = "f".repeat(64);
  assert.equal(projectPilotReadiness(mixed).inputStatus, "INVALID");

  const invalidCandidate = makeConfiguredPacket(await basePacket());
  invalidCandidate.candidateIdentities[0].pool = "not-a-solana-address";
  assert.equal(projectPilotReadiness(invalidCandidate).inputStatus, "INVALID");
});

test("candidate evidence gaps block entries without becoming run-level data failures", async () => {
  const packet = makeConfiguredPacket(await basePacket());
  packet.candidateDataGates = [{
    mint: MINT,
    pool: POOL,
    filterStatus: "UNKNOWN",
    unavailableEvidence: ["concentration", "developer", "bundle", "smartWallet"]
  }];
  const report = projectPilotReadiness(packet);
  assert.equal(report.candidateDataGates[0].entryDisposition,
    "ENTRY_BLOCKED_BY_EXISTING_FILTER_CONTRACT");
  assert.deepEqual(report.candidateDataGates[0].unavailableEvidence,
    ["concentration", "developer", "bundle", "smartWallet"]);
  assert.match(report.candidateDataInterpretation, /zero entries do not establish profitability/);
  assert.equal(report.dimensions.RUN_AUTHORIZED.authorized, false);
});

test("a filter pass remains an assertion, not an entry authorization", async () => {
  const packet = makeConfiguredPacket(await basePacket());
  packet.candidateDataGates = [{
    mint: MINT,
    pool: POOL,
    filterStatus: "PASS",
    unavailableEvidence: []
  }];
  const report = projectPilotReadiness(packet);
  assert.equal(report.candidateDataGates[0].entryDisposition,
    "FILTER_PASS_ASSERTED_ONLY_NOT_ENTRY_AUTHORITY");
  assert.equal(report.dimensions.RUN_AUTHORIZED.authorized, false);
});

test("duration and budget equality boundaries are accepted as configuration, not readiness", async () => {
  const packet = makeConfiguredPacket(await basePacket());
  for (const name of Object.keys(packet.operationalEvidence)) setEvidence(packet, name);
  packet.manifest.pollBudget.maxRequestsPerProvider = packet.manifest.pollBudget.maxRequestsPerRun;
  packet.manifest.pollBudget.maxBytesPerResponse = packet.manifest.pollBudget.maxBytesPerRun;
  packet.configurationSha256 = digest(packet.manifest);
  packet.candidateIdentitySha256 = digest(packet.candidateIdentities);
  for (const evidence of Object.values(packet.operationalEvidence)) {
    evidence.binding.configurationSha256 = packet.configurationSha256;
    evidence.binding.candidateIdentitySha256 = packet.candidateIdentitySha256;
  }
  packet.manifest.endAt = packet.manifest.startAt + 8 * 60 * 60 * 1000;
  packet.configurationSha256 = digest(packet.manifest);
  for (const evidence of Object.values(packet.operationalEvidence)) {
    evidence.binding.configurationSha256 = packet.configurationSha256;
  }
  const report = projectPilotReadiness(packet);
  assert.equal(report.inputStatus, "VALID");
  assert.equal(report.configuredPollBudget.maxRequestsPerProvider,
    report.configuredPollBudget.maxRequestsPerRun);
  assert.equal(report.dimensions.RUN_AUTHORIZED.authorized, false);
});

test("oversized, accessor-bearing, and unknown-field packets are invalid", async () => {
  const oversized = await basePacket();
  oversized.extra = "x".repeat(MAX_READINESS_PACKET_BYTES);
  assert.equal(projectPilotReadiness(oversized).inputStatus, "INVALID");

  const accessor = await basePacket();
  Object.defineProperty(accessor, "secret", {enumerable: true, get() {
    throw new Error("accessor must not execute");
  }});
  assert.equal(projectPilotReadiness(accessor).inputStatus, "INVALID");

  const unknown = await basePacket();
  unknown.operationalEvidence.credential = {status: "VERIFIED"};
  assert.equal(projectPilotReadiness(unknown).inputStatus, "INVALID");

  const unexpectedRootField = await basePacket();
  unexpectedRootField.credential = "not accepted";
  assert.equal(projectPilotReadiness(unexpectedRootField).inputStatus, "INVALID");
});
