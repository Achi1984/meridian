import assert from "node:assert/strict";
import test from "node:test";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {runHostAcceptance} from "../scripts/memecoin-paper/host-acceptance.mjs";

const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-host-acceptance-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const volume = path.join(root, "volume");
  await mkdir(volume);
  return {root, volume};
}

function successfulAssembly(onAcquire = () => {}) {
  return {
    pins: {
      provider: "b000c6a6dcfcce102e61821e8316174a15a0dd58",
      controller: "89a20bf118e059c6153ac75b51f2ed6947d46332",
      report: "14075eef9ef0eebde3249718a6f6e3c51016bdee"
    },
    transport: async () => { throw new Error("transport should be injected by the provider module"); },
    freshnessPolicy: {
      maxAcquisitionDurationMs: 30_000,
      maxPairAgeMs: 72 * 60 * 60 * 1000,
      maxFutureSkewMs: 0
    },
    async acquireProviderEvidence(options) {
      onAcquire(options);
      return {
        status: "ACQUISITION_FINISHED",
        networkAccessed: true,
        counters: {
          requests: 4, bytes: 800, events: 4, reservedBytes: 0, byProvider: {dex: 1, rpc: 3}
        },
        events: [
          {provider: "DexScreener public API", endpointKind: "pair", status: "RECEIVED", bytes: 200},
          {provider: "Solana JSON-RPC", endpointKind: "getAccountInfo", status: "RECEIVED", bytes: 200},
          {provider: "Solana JSON-RPC", endpointKind: "getTokenLargestAccounts", status: "RECEIVED", bytes: 200},
          {provider: "Solana JSON-RPC", endpointKind: "getTokenSupply", status: "RECEIVED", bytes: 200}
        ]
      };
    }
  };
}

test("host acceptance is explicit and imports do not create or start anything", async t => {
  const harness = await fixture(t);
  await assert.rejects(runHostAcceptance({
    evidenceId: "not-opted-in",
    mountRoot: harness.volume,
    providerPreflight: true
  }), /explicit HOST_ACCEPTANCE_ONLY/);
  await assert.rejects(runHostAcceptance({
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId: "not-opted-in",
    mountRoot: harness.volume
  }), /explicit HOST_ACCEPTANCE_ONLY/);
});

test("bounded volume probe persists evidence and the same-ID restart never repeats providers", async t => {
  const harness = await fixture(t);
  let acquisitions = 0;
  const assemblyLoader = async () => successfulAssembly(options => {
    acquisitions += 1;
    assert.equal(options.enabled, true);
    assert.equal(options.candidates.length, 1);
    assert.equal(options.manifest.pollBudget.maxRequestsPerRun, 4);
    assert.equal(options.manifest.pollBudget.maxRequestsPerProvider, 3);
    assert.equal(options.manifest.pollBudget.maxEvents, 4);
    assert.equal(options.manifest.pollBudget.maxBytesPerRun, 4 * 256 * 1024);
    assert.equal(options.requestTimeoutMs, 5_000);
    assert.equal(options.signal instanceof AbortSignal, true);
  });
  const input = {
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId: "mount-check-001",
    candidate: IDENTITY,
    providerPreflight: true,
    mountRoot: harness.volume,
    assemblyLoader
  };
  const first = await runHostAcceptance(input);
  assert.equal(first.status, "PASS");
  assert.equal(first.scope, "HOST_ACCEPTANCE_ONLY");
  assert.equal(first.hostDurability, "NOT_VERIFIED");
  assert.equal(first.clockProvenance, "UNVERIFIED");
  assert.equal(first.pilotStarted, false);
  assert.equal(first.runtimeAuthorization, false);
  assert.equal(first.providerPreflight.requestCount, 4);
  assert.equal(first.providerPreflight.retries, 0);
  assert.deepEqual(first.providerPreflight.producerPins, {
    provider: "b000c6a6dcfcce102e61821e8316174a15a0dd58",
    controller: "89a20bf118e059c6153ac75b51f2ed6947d46332",
    report: "14075eef9ef0eebde3249718a6f6e3c51016bdee"
  });
  assert.equal(first.clock.provenance, "UNVERIFIED");
  assert.equal(first.evidencePreserved, true);
  assert.equal(acquisitions, 1);

  const evidenceDirectory = path.join(harness.volume, "host-acceptance", input.evidenceId);
  const probe = await readFile(path.join(evidenceDirectory, "probe.json"));
  const stored = JSON.parse(await readFile(path.join(evidenceDirectory, "result.json"), "utf8"));
  assert.equal(stored.evidenceHash, first.evidenceHash);
  assert.equal(stored.probeSha256, first.probeSha256);
  assert.match(probe.toString("utf8"), /"runtimeUid"/);

  const restarted = await runHostAcceptance(input);
  assert.equal(restarted.status, "RESTART_VERIFIED");
  assert.equal(restarted.persistedEvidenceSha256, first.evidenceHash);
  assert.equal(restarted.providerRequestsThisInvocation, 0);
  assert.equal(acquisitions, 1);
});

test("a runtime-UID ownership mismatch blocks writes and provider requests", async t => {
  const harness = await fixture(t);
  let acquisitions = 0;
  const runtimeUid = typeof process.getuid === "function" ? process.getuid() + 1 : 10001;
  const result = await runHostAcceptance({
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId: "wrong-owner",
    candidate: IDENTITY,
    providerPreflight: true,
    mountRoot: harness.volume,
    runtimeUid,
    assemblyLoader: async () => {
      acquisitions += 1;
      return successfulAssembly();
    }
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.providerRequests, 0);
  assert.equal(result.runtimeUid, runtimeUid);
  assert.equal(acquisitions, 0);
});

test("incomplete existing evidence remains UNKNOWN and is not repaired or replayed", async t => {
  const harness = await fixture(t);
  const evidenceId = "interrupted-001";
  const evidenceParent = path.join(harness.volume, "host-acceptance");
  await mkdir(evidenceParent, {mode: 0o700});
  const evidenceDirectory = path.join(harness.volume, "host-acceptance", evidenceId);
  await mkdir(evidenceDirectory, {mode: 0o700});
  const probePath = path.join(evidenceDirectory, "probe.json");
  await writeFile(probePath, "partial evidence");
  let acquisitions = 0;
  const result = await runHostAcceptance({
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId,
    candidate: IDENTITY,
    providerPreflight: true,
    mountRoot: harness.volume,
    assemblyLoader: async () => {
      acquisitions += 1;
      return successfulAssembly();
    }
  });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.providerRequestsThisInvocation, 0);
  assert.equal(acquisitions, 0);
  assert.equal(await readFile(probePath, "utf8"), "partial evidence");
});

test("unsafe evidence IDs are rejected before creating host evidence", async t => {
  const harness = await fixture(t);
  await assert.rejects(runHostAcceptance({
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId: "../escape",
    candidate: IDENTITY,
    providerPreflight: true,
    mountRoot: harness.volume,
    assemblyLoader: async () => successfulAssembly()
  }), /safe, unique path component/);
});

test("provider preflight failure is retained and a restart cannot repeat it", async t => {
  const harness = await fixture(t);
  let acquisitions = 0;
  const failingAssemblyLoader = async () => ({
    ...successfulAssembly(),
    async acquireProviderEvidence() {
      acquisitions += 1;
      return {
        status: "PARTIAL",
        networkAccessed: true,
        counters: {requests: 1, bytes: 10, events: 1, reservedBytes: 0},
        events: [{provider: "DexScreener public API", endpointKind: "pair", status: "TIMEOUT", bytes: 10}]
      };
    }
  });
  const input = {
    mode: "HOST_ACCEPTANCE_ONLY",
    evidenceId: "provider-blocked-001",
    candidate: IDENTITY,
    providerPreflight: true,
    mountRoot: harness.volume,
    assemblyLoader: failingAssemblyLoader
  };
  const first = await runHostAcceptance(input);
  assert.equal(first.status, "BLOCKED");
  assert.equal(first.providerPreflight.status, "BLOCKED");
  assert.equal(first.providerPreflight.requestCount, 1);
  const repeat = await runHostAcceptance(input);
  assert.equal(repeat.status, "BLOCKED");
  assert.equal(repeat.providerRequestsThisInvocation, 0);
  assert.equal(acquisitions, 1);
});
