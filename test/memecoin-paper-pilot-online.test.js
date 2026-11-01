import assert from "node:assert/strict";
import test from "node:test";
import {access, mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
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
  FIXTURE_RUN_ID,
  FIXTURE_START
} from "./fixtures/memecoin-paper-pilot-online/generate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PINNED_MODULES = [
  ["fa04cf49842f0350bd4fc21f466984612a139396", "scripts/memecoin-paper/checkpoint-session.mjs"],
  ["b000c6a6dcfcce102e61821e8316174a15a0dd58", "scripts/memecoin-paper/provider-evidence.mjs"],
  ["89a20bf118e059c6153ac75b51f2ed6947d46332", "scripts/memecoin-paper/pilot-run-control.mjs"],
  ["14075eef9ef0eebde3249718a6f6e3c51016bdee", "scripts/memecoin-paper/operator-report.mjs"]
];
const PROVIDER_FIXTURES = path.join(root, "test/fixtures/memecoin-paper-provider-evidence");
const INTEGRATION_START = Date.parse("2026-11-01T18:40:00Z");
const INTEGRATION_IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});

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

function virtualScheduler() {
  let now = 0;
  let nextId = 0;
  let queued = false;
  const timers = new Map();
  const queue = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      const next = [...timers.values()].sort((left, right) =>
        left.at - right.at || left.id - right.id)[0];
      if (!next) return;
      timers.delete(next.id);
      now = Math.max(now, next.at);
      next.callback();
      queue();
    });
  };
  return {
    clock: () => now,
    scheduler: {
      setTimeout(callback, delay) {
        const id = ++nextId;
        timers.set(id, {id, at: now + delay, callback});
        queue();
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    }
  };
}

async function providerFixture(name) {
  return JSON.parse(await readFile(path.join(PROVIDER_FIXTURES, name), "utf8"));
}

async function syntheticProviderResponse(url, init) {
  if (url.startsWith("https://api.dexscreener.com/")) {
    const payload = await providerFixture("dex-pair.json");
    payload.pairs[0].baseToken.address = INTEGRATION_IDENTITY.mint;
    payload.pairs[0].pairAddress = INTEGRATION_IDENTITY.pool;
    payload.pairs[0].quoteToken.address = INTEGRATION_IDENTITY.quote;
    return payload;
  }
  const request = JSON.parse(init.body);
  const filename = {
    getAccountInfo: "get-account-info.json",
    getTokenLargestAccounts: "get-largest-accounts.json",
    getTokenSupply: "get-token-supply.json"
  }[request.method];
  if (!filename) throw new Error(`unexpected synthetic RPC method: ${request.method}`);
  const payload = await providerFixture(filename);
  payload.id = request.id;
  return payload;
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
    requested: INTEGRATION_IDENTITY,
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

test("pinned producer assembly spans the eight-hour deadline within report budgets", async t => {
  const requiredPaths = [
    ...PINNED_MODULES.map(([, file]) => path.join(root, file)),
    ...["dex-pair.json", "get-account-info.json", "get-largest-accounts.json", "get-token-supply.json"]
      .map(file => path.join(PROVIDER_FIXTURES, file))
  ];
  try {
    await Promise.all(requiredPaths.map(file => access(file)));
  } catch {
    t.skip("BLOCKED: exact pinned producer modules and their synthetic fixture set are absent from this checkout");
    return;
  }
  for (const [pin] of PINNED_MODULES) {
    execFileSync("git", ["merge-base", "--is-ancestor", pin, "HEAD"], {cwd: root});
  }

  const {createPinnedAssembly} = await import("../scripts/memecoin-paper/pilot-online-assembly.mjs");
  const virtual = virtualScheduler();
  let networkCalls = 0;
  let reportInput;
  const importedAssembly = await createPinnedAssembly({
    fetchImpl: async (url, init) => {
      networkCalls += 1;
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      return new Response(JSON.stringify(await syntheticProviderResponse(url, init)), {
        status: 200,
        headers: {"content-type": "application/json"}
      });
    }
  });
  const assembly = {
    ...importedAssembly,
    projectOperatorReport(input) {
      reportInput = input;
      return importedAssembly.projectOperatorReport(input);
    }
  };
  assert.deepEqual(assembly.pins, {
    provider: PINNED_MODULES[1][0],
    controller: PINNED_MODULES[2][0],
    report: PINNED_MODULES[3][0]
  });

  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-pinned-"));
  t.after(() => rm(rootDirectory, {recursive: true, force: true}));
  const dataDirectory = path.join(rootDirectory, "volume");
  await mkdir(dataDirectory);
  const configPath = path.join(rootDirectory, "run-config.json");
  const config = createRunConfig({
    startAt: INTEGRATION_START,
    candidates: [INTEGRATION_IDENTITY],
    budgets: {
      requests: 960,
      dexRequests: 480,
      rpcRequests: 480,
      bytes: 10_485_760,
      providerEvents: 10_000,
      candidates: 160,
      events: 1_000,
      cycles: 481
    }
  });
  Object.assign(config.manifest.pollBudget, {
    maxRequestsPerRun: 960,
    maxRequestsPerProvider: 480,
    maxBytesPerResponse: 1_048_576,
    maxBytesPerRun: 10_485_760,
    maxEvents: 10_000,
    maxCandidates: 1
  });
  await writeFile(configPath, canonicalJson(config), {mode: 0o600});
  const runner = createPilotOnline({
    mode: "READ_ONLY_PAPER",
    dataDirectory,
    configPath,
    assembly,
    wallClock: () => INTEGRATION_START + virtual.clock(),
    monotonicClock: virtual.clock,
    scheduler: virtual.scheduler
  });

  const terminal = await runner.start();
  assert.equal(virtual.clock(), 8 * 60 * 60 * 1000);
  assert.equal(terminal.status, "FINISHED");
  assert.equal(terminal.stopReason, "DEADLINE");
  assert.equal(terminal.executionStarted, false);
  assert.equal(terminal.providerAccounting.requests, 640);
  assert.equal(terminal.providerAccounting.dexRequests, 160);
  assert.equal(terminal.providerAccounting.rpcRequests, 480);
  assert.equal(terminal.providerAccounting.providerEvents, 640);
  assert.equal(terminal.providerAccounting.candidates, 160);
  assert.ok(terminal.providerAccounting.bytes > 0);
  assert.ok(terminal.providerAccounting.bytes <= 10_485_760);
  assert.equal(networkCalls, 640);
  const projected = await readPilotReport(dataDirectory);
  assert.equal(projected.status, "AVAILABLE");
  assert.equal(projected.report.experiment.source, "READ_ONLY_PAPER_CHECKPOINT");
  assert.equal(projected.report.experiment.reportStatus, "FINISHED");
  assert.equal(projected.report.trading.status, "ZERO_TRADES");
  assert.equal(projected.report.trading.paperEntryFills, 0);
  assert.equal(projected.observation.entryAuthorizations, 0);
  assert.equal(projected.observation.simulatedFills, 0);
  assert.equal(reportInput.metadata.sequence, 481);
  assert.equal(reportInput.results.length, 481);
  assert.equal(reportInput.results.at(-1).method, "finishRun");
  assert.equal(reportInput.snapshot.summary.auditTruncated, false);
  assert.ok(reportInput.snapshot.auditEvents.length <= 1_000);
  const checkpoint = JSON.parse(await readFile(
    path.join(dataDirectory, "checkpoint", "checkpoint.json"), "utf8"
  ));
  assert.equal(checkpoint.sequence, 481);
  assert.equal(checkpoint.records.length, 482);
  assert.equal(checkpoint.records.at(-1).method, "finishRun");
  assert.equal(checkpoint.records.at(-1).result.elapsedMs, 8 * 60 * 60 * 1000);
  assert.ok((await readFile(path.join(dataDirectory, "report.json"))).byteLength <= 262_144);
});
