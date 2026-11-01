import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {createPublicTransport} from "../scripts/memecoin-paper/pilot-online-assembly.mjs";
import {filterCandidate} from "../scripts/memecoin-paper/stages.mjs";
import {
  createPilotOnline,
  readPilotReport,
  readPilotStatus,
  requestPilotStop
} from "../scripts/memecoin-paper/pilot-online.mjs";
import {
  canonicalJson,
  createFakeAssembly,
  createRunConfig,
  FIXTURE_IDENTITIES,
  FIXTURE_RUN_ID,
  FIXTURE_START
} from "./fixtures/memecoin-paper-pilot-online/generate.mjs";

async function createHarness(t, {
  config: configOptions,
  fakeAssemblyOptions,
  wallClock = () => FIXTURE_START + 1_000,
  openCheckpointStore
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-online-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dataDirectory = path.join(root, "volume");
  await mkdir(dataDirectory);
  const configPath = path.join(root, "run-config.json");
  const config = createRunConfig(configOptions);
  await writeFile(configPath, canonicalJson(config), {mode: 0o600});
  const fake = createFakeAssembly(fakeAssemblyOptions);
  const runner = createPilotOnline({
    mode: "READ_ONLY_PAPER",
    dataDirectory,
    configPath,
    assembly: fake.assembly,
    wallClock,
    monotonicClock: () => 10,
    openCheckpointStore
  });
  return {root, dataDirectory, configPath, config, runner, ...fake};
}

test("disabled by default and invokes no provider or filesystem callback", async () => {
  const disabled = createPilotOnline();
  assert.equal((await disabled.start()).status, "DISABLED");
  assert.deepEqual(await disabled.stop(), {status: "BLOCKED", reason: "run is not active"});
  assert.throws(() => createPilotOnline({mode: "SYNTHETIC_TEST_ONLY"}), /only explicit READ_ONLY_PAPER/);
});

test("pinned public transport rejects arbitrary hosts and RPC methods before fetch", async () => {
  let fetchCalls = 0;
  const transport = createPublicTransport(async () => {
    fetchCalls += 1;
    return new Response("{}");
  });
  const options = {signal: new AbortController().signal, redirect: "error", credentials: "omit"};
  const base = {
    requested: FIXTURE_IDENTITIES[0],
    redirect: "error",
    credentials: "omit"
  };
  await assert.rejects(transport({
    ...base,
    provider: "dex",
    headers: {accept: "application/json"},
    method: "GET",
    url: "https://attacker.example/latest/dex/pairs/solana/CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
  }, options), /fixed read-only boundary/);
  await assert.rejects(transport({
    ...base,
    provider: "rpc",
    kind: "sendTransaction",
    id: 1,
    headers: {accept: "application/json", "content-type": "application/json"},
    method: "POST",
    url: "https://api.mainnet-beta.solana.com",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "sendTransaction", params: []})
  }, options), /read-only allowlist/);
  assert.equal(fetchCalls, 0);
});

test("bounded online composition produces only a receipt-bound no-entry report", async t => {
  let observedStepEvent;
  let projectedInput;
  const harness = await createHarness(t, {
    fakeAssemblyOptions: {
      onStep(event) {
        observedStepEvent = event;
      },
      onReportInput(input) {
        projectedInput = input;
      }
    }
  });

  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "FINISHED");
  assert.equal(terminal.observationOnly, true);
  assert.equal(terminal.executionStarted, false);
  assert.equal(terminal.reportStatus, "PROJECTED");
  assert.equal(terminal.reportTradingStatus, "NO_ENTRY_OBSERVED");
  assert.deepEqual(terminal.providerAccounting, {
    requests: 4, bytes: 50, providerEvents: 4, dexRequests: 1, rpcRequests: 3, candidates: 1
  });
  assert.equal(harness.calls.provider, 1);
  assert.equal(harness.calls.steps, 1);
  assert.equal(observedStepEvent.kind, "READ_ONLY_OBSERVATION");
  assert.equal(observedStepEvent.eventId, undefined);
  assert.equal(observedStepEvent.candidate.source, "DexScreener public API");
  assert.equal(filterCandidate(observedStepEvent.candidate, {now: FIXTURE_START + 1_000}).status, "UNKNOWN");
  assert.equal(projectedInput.reportType, "READ_ONLY_PAPER_CHECKPOINT");
  assert.equal(projectedInput.source, "READ_ONLY_PAPER_CHECKPOINT");
  assert.equal(projectedInput.metadata.runId, FIXTURE_RUN_ID);
  assert.equal(projectedInput.metadata.sequence, projectedInput.results.length);
  assert.equal(projectedInput.results.at(-1).method, "finishRun");
  assert.equal(projectedInput.snapshot.summary.cashCents, "100000");
  assert.deepEqual(projectedInput.snapshot.summary.openPositions, []);
  assert.equal("summary" in projectedInput, false);
  assert.equal(await readPilotStatus(harness.dataDirectory).then(value => value.status), "FINISHED");
  const report = await readPilotReport(harness.dataDirectory);
  assert.equal(report.status, "AVAILABLE");
  assert.equal(report.report.trading.status, "NO_ENTRY_OBSERVED");
  assert.equal(report.observation.filterOutcomes.UNKNOWN, 1);
  assert.equal(report.observation.entryAuthorizations, 0);
  assert.match(report.text, /Observation only/);
  assert.match(report.text, /Executable quote and validated cost evidence: UNAVAILABLE/);
  const checkpoint = JSON.parse(await readFile(path.join(harness.dataDirectory, "checkpoint", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.sequence, 2);
  assert.equal(checkpoint.records.at(-1).method, "finishRun");
});

test("provider, request, event, and candidate budgets accumulate across cycles", async t => {
  const harness = await createHarness(t, {
    fakeAssemblyOptions: {maxCycles: 4},
    config: {budgets: {events: 2, candidates: 2}}
  });
  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "FINISHED");
  assert.equal(harness.calls.provider, 2);
  assert.equal(harness.calls.checkpoint, 4);
  assert.deepEqual(terminal.providerAccounting, {
    requests: 8, bytes: 100, providerEvents: 8, dexRequests: 2, rpcRequests: 6, candidates: 2
  });
});

test("mixed provider identity is UNKNOWN and is never retried", async t => {
  const harness = await createHarness(t, {
    fakeAssemblyOptions: {
      resultFactory(candidates) {
        return {
          status: "ACQUISITION_FINISHED",
          events: [{type: "provider-request"}],
          candidates: candidates.map(identity => ({
            candidate: {...identity, source: "DexScreener public API", sampledAt: FIXTURE_START + 1_000, evidence: {}},
            identityStatus: "UNKNOWN"
          })),
          counters: {requests: 4, bytes: 50, events: 4, reservedBytes: 0, byProvider: {dex: 1, rpc: 3}}
        };
      },
      maxCycles: 4
    }
  });
  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "UNKNOWN");
  assert.equal(harness.calls.provider, 1);
  assert.equal(harness.calls.steps, 0);
  assert.equal(terminal.executionStarted, false);
});

test("operator stop is durable and ends one run without enabling restart", async t => {
  const harness = await createHarness(t, {
    fakeAssemblyOptions: {waitForStop: true}
  });
  const running = harness.runner.start();
  await harness.stopReady;
  const stopped = await harness.runner.stop();
  assert.equal(stopped.status, "STOP_REQUESTED");
  const terminal = await running;
  assert.equal(terminal.status, "FINISHED");
  assert.equal(terminal.stopReason, "OPERATOR_STOP");
  const repeat = await requestPilotStop(harness.dataDirectory);
  assert.equal(repeat.status, "ALREADY_TERMINAL");
  const secondRunner = createPilotOnline({
    mode: "READ_ONLY_PAPER",
    dataDirectory: harness.dataDirectory,
    configPath: harness.configPath,
    assembly: harness.assembly,
    wallClock: () => FIXTURE_START + 1_000
  });
  await assert.rejects(secondRunner.start(), /persistent run state already exists/);
  assert.equal(harness.calls.provider, 1);
});

test("ambiguous checkpoint readback is terminal UNKNOWN and never retried", async t => {
  let readCount = 0;
  let commitCount = 0;
  const harness = await createHarness(t, {
    openCheckpointStore: async directory => {
      const store = await CheckpointStore.open(directory);
      return {
        async readCheckpoint() {
          readCount += 1;
          if (readCount >= 3) return {status: "UNKNOWN", reason: "synthetic lost acknowledgement"};
          return store.readCheckpoint();
        },
        async commitCheckpoint(input) {
          commitCount += 1;
          return store.commitCheckpoint(input);
        },
        close: () => store.close()
      };
    }
  });
  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "UNKNOWN");
  assert.equal(harness.calls.checkpoint, 1);
  assert.equal(commitCount, 2);
  assert.ok(readCount >= 3);
  assert.equal(harness.calls.provider, 1);
  assert.equal((await readPilotStatus(harness.dataDirectory)).status, "UNKNOWN");
});

test("pre-existing checkpoint evidence blocks stale-position recovery and provider access", async t => {
  const harness = await createHarness(t);
  const checkpointDirectory = path.join(harness.dataDirectory, "checkpoint");
  await mkdir(checkpointDirectory, {recursive: true});
  await writeFile(path.join(checkpointDirectory, "stale-evidence"), "unknown prior state");
  await assert.rejects(harness.runner.start(), /checkpoint directory is not empty/);
  assert.equal(harness.calls.provider, 0);
});

test("corrupt durable run state remains UNKNOWN and cannot be stopped by guessed identity", async t => {
  const harness = await createHarness(t);
  await writeFile(path.join(harness.dataDirectory, "run.lock"), "{");
  assert.equal((await readPilotStatus(harness.dataDirectory)).status, "UNKNOWN");
  assert.equal((await requestPilotStop(harness.dataDirectory)).status, "UNKNOWN");
});
