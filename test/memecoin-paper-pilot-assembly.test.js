import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {CheckpointStore} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {createPinnedAssembly} from "../scripts/memecoin-paper/pilot-online-assembly.mjs";
import {createPilotOnline, readPilotReport, readPilotStatus} from "../scripts/memecoin-paper/pilot-online.mjs";
import {createRunConfig, writeRunConfig} from "../scripts/memecoin-paper/create-run-config.mjs";
import {createSyntheticProviderFetch} from "./fixtures/memecoin-paper-pilot-online/provider-responses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PINS = [
  ["b000c6a6dcfcce102e61821e8316174a15a0dd58", "scripts/memecoin-paper/provider-evidence.mjs"],
  ["89a20bf118e059c6153ac75b51f2ed6947d46332", "scripts/memecoin-paper/pilot-run-control.mjs"],
  ["14075eef9ef0eebde3249718a6f6e3c51016bdee", "scripts/memecoin-paper/operator-report.mjs"]
];
const START_AT = Date.parse("2026-11-01T18:40:00Z");
const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  pool: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  quote: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"
});

function virtualScheduler({paused = false} = {}) {
  let now = 0;
  let nextId = 0;
  let queued = false;
  let isPaused = paused;
  const timers = new Map();
  const queue = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      if (isPaused) return;
      const next = [...timers.values()].filter(timer => timer.delay === 60_000 || timer.delay > 60_000)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next || next.at - now > 60_000) return;
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
        timers.set(id, {id, at: now + delay, delay, callback});
        queue();
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      }
    }
  };
}

async function createHarness(t, {
  mismatchPair = false,
  paused = false,
  deadlineWallDelayMs = 0,
  openCheckpointStore,
  onFirstCheckpoint
} = {}) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-assembly-"));
  t.after(() => rm(rootDirectory, {recursive: true, force: true}));
  const dataDirectory = path.join(rootDirectory, "volume");
  await mkdir(dataDirectory);
  const configPath = path.join(dataDirectory, "run-config.json");
  await writeRunConfig({
    output: configPath,
    runId: "pilot-assembly-fixture-001",
    startAt: START_AT,
    ...IDENTITY
  });
  const virtual = virtualScheduler({paused});
  const network = await createSyntheticProviderFetch(IDENTITY, {mismatchPair});
  const importedAssembly = await createPinnedAssembly({fetchImpl: network.fetch});
  let reportInput;
  let controllerReportSummary;
  let firstCheckpointResolve;
  const firstCheckpoint = new Promise(resolve => { firstCheckpointResolve = resolve; });
  let checkpointSeen = false;
  const assembly = {
    ...importedAssembly,
    projectOperatorReport(input) {
      reportInput = input;
      return importedAssembly.projectOperatorReport(input);
    },
    createPilotRunControl(options) {
      const checkpoint = options.callbacks.checkpoint;
      const report = options.callbacks.report;
      return importedAssembly.createPilotRunControl({
        ...options,
        callbacks: {
          ...options.callbacks,
          async checkpoint(input) {
            const result = await checkpoint(input);
            if (!checkpointSeen) {
              checkpointSeen = true;
              firstCheckpointResolve(result);
              onFirstCheckpoint?.();
            }
            return result;
          },
          async report(input) {
            controllerReportSummary = input.summary;
            return report(input);
          }
        }
      });
    }
  };
  const runnerOptions = {
    mode: "READ_ONLY_PAPER",
    dataDirectory,
    configPath,
    assembly,
    wallClock: () => START_AT + virtual.clock() +
      (virtual.clock() >= 8 * 60 * 60 * 1000 ? deadlineWallDelayMs : 0),
    monotonicClock: virtual.clock,
    scheduler: virtual.scheduler,
    openCheckpointStore
  };
  const runner = createPilotOnline(runnerOptions);
  return {
    assembly, configPath, dataDirectory, firstCheckpoint, network, runner,
    runnerOptions, virtual,
    get reportInput() { return reportInput; },
    get controllerReportSummary() { return controllerReportSummary; }
  };
}

test("pinned modules import without I/O and match the approved source pins", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("network is disabled in this test");
  };
  try {
    const isolated = await import("../scripts/memecoin-paper/pilot-online-assembly.mjs?side-effect-check");
    const assembly = await isolated.createPinnedAssembly();
    assert.deepEqual(assembly.pins, {
      provider: PINS[0][0],
      controller: PINS[1][0],
      report: PINS[2][0]
    });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const dockerfile = await readFile(path.join(root, "Dockerfile.paper"), "utf8");
  assert.match(dockerfile, /ENTRYPOINT \["node", "scripts\/memecoin-paper\/pilot-online\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /gateway|EXPOSE|npm (?:ci|install)/i);
});

test("offline run-config generation requires explicit candidate identity and launch window", () => {
  assert.throws(() => createRunConfig({}), /explicit Solana mint\/pool\/quote/);
  const config = createRunConfig({
    output: "/tmp/pilot-run-config.json",
    runId: "explicit-run-001",
    startAt: START_AT,
    ...IDENTITY
  });
  assert.equal(config.startAt, START_AT);
  assert.equal(config.endAt - config.startAt, 8 * 60 * 60 * 1000);
  assert.equal(config.candidates[0].mint, IDENTITY.mint);
  assert.equal(config.dependencyPins.provider, PINS[0][0]);
});

for (const delayMs of [250, 30_000]) {
  test(`actual eight-hour deadline finalizes at window end after ${delayMs}ms scheduling delay`, async t => {
    let reportInput;
    const harness = await createHarness(t, {deadlineWallDelayMs: delayMs});
    const importedProjector = harness.assembly.projectOperatorReport;
    harness.assembly.projectOperatorReport = input => {
      reportInput = input;
      return importedProjector(input);
    };
    const terminal = await harness.runner.start();
    assert.equal(harness.virtual.clock(), 8 * 60 * 60 * 1000);
    assert.equal(terminal.status, "FINISHED",
      JSON.stringify({terminal, controllerSummary: harness.controllerReportSummary}));
    assert.equal(terminal.stopReason, "DEADLINE");
    assert.equal(terminal.executionStarted, false);
    assert.deepEqual(terminal.observation.windowFinalization, {
      basis: "SETTLED_DEADLINE_EFFECTIVE_WINDOW_END",
      effectiveEndAt: START_AT + 8 * 60 * 60 * 1000,
      finalizedAt: START_AT + 8 * 60 * 60 * 1000 + delayMs,
      latenessMs: delayMs
    });
    assert.equal(terminal.providerAccounting.requests, 640);
    assert.equal(terminal.providerAccounting.dexRequests, 160);
    assert.equal(terminal.providerAccounting.rpcRequests, 480);
    assert.equal(terminal.providerAccounting.providerEvents, 640);
    assert.equal(terminal.providerAccounting.candidates, 160);
    assert.ok(terminal.providerAccounting.bytes > 0);
    assert.ok(terminal.providerAccounting.bytes <= 10_485_760);
    assert.equal(harness.network.calls, 640);
    assert.equal(terminal.observation.filterOutcomes.UNKNOWN > 0, true);
    assert.equal(terminal.observation.entryAuthorizations, 0);
    assert.equal(terminal.observation.simulatedFills, 0);
    assert.equal(reportInput.metadata.sequence, 481);
    assert.equal(reportInput.results.length, 481);
    assert.equal(reportInput.results.filter(item => item.method === "riskSnapshot").length, 480);
    assert.equal(reportInput.results.at(-1).method, "finishRun");
    assert.equal(reportInput.results.at(-1).result.elapsedMs, 8 * 60 * 60 * 1000);
    assert.equal(reportInput.snapshot.summary.auditTruncated, false);
    assert.ok(reportInput.snapshot.auditEvents.length <= 1_000);
    const checkpoint = JSON.parse(await readFile(
      path.join(harness.dataDirectory, "checkpoint", "checkpoint.json"), "utf8"
    ));
    assert.equal(checkpoint.sequence, 481);
    assert.equal(checkpoint.records.length, 482);
    assert.equal(checkpoint.records.at(-1).method, "finishRun");
    const report = await readPilotReport(harness.dataDirectory);
    assert.equal(report.status, "AVAILABLE");
    assert.equal(report.report.experiment.source, "READ_ONLY_PAPER_CHECKPOINT");
    assert.equal(report.report.experiment.reportStatus, "FINISHED");
    assert.equal(report.report.experiment.operationalStatus, "NOT_EVIDENCED");
    assert.equal(report.report.trading.status, "ZERO_TRADES");
    assert.equal(report.report.trading.paperEntryFills, 0);
    assert.match(report.text, /Effective observation-window end:/);
    assert.match(report.text, new RegExp(`Finalization lateness: ${delayMs} ms`));
    assert.ok((await readFile(path.join(harness.dataDirectory, "operator-report.json"))).byteLength <= 262_144);
    assert.equal((await readPilotStatus(harness.dataDirectory)).status, "FINISHED");
    const secondRun = createPilotOnline({
      ...harness.runnerOptions,
      wallClock: () => START_AT + 1_000
    });
    await assert.rejects(secondRun.start(), /persistent run state already exists/);
    assert.equal(harness.network.calls, 640);
  });
}

test("deadline beyond bounded wall-clock settlement remains UNKNOWN", async t => {
  const harness = await createHarness(t, {deadlineWallDelayMs: 60_001});
  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "UNKNOWN");
  assert.equal(terminal.failureCode, "DEADLINE_FINALIZATION_TIME_UNKNOWN");
  assert.equal(harness.network.calls, 640);
  const checkpoint = JSON.parse(await readFile(
    path.join(harness.dataDirectory, "checkpoint", "checkpoint.json"), "utf8"
  ));
  assert.equal(checkpoint.sequence, 480);
  assert.equal(checkpoint.records.some(record => record.method === "finishRun"), false);
});

test("actual provider identity mismatch remains UNKNOWN and is not retried", async t => {
  const harness = await createHarness(t, {mismatchPair: true});
  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "UNKNOWN");
  assert.equal(terminal.executionStarted, false);
  assert.equal(harness.network.calls, 4);
  assert.equal(terminal.providerAccounting.candidates, 0);
});

test("actual checkpoint uncertainty is terminal and does not retry the write", async t => {
  let reads = 0;
  let commits = 0;
  const harness = await createHarness(t, {
    openCheckpointStore: async directory => {
      const store = await CheckpointStore.open(directory);
      return {
        async readCheckpoint() {
          reads += 1;
          if (reads >= 3) return {status: "UNKNOWN", reason: "synthetic lost readback"};
          return store.readCheckpoint();
        },
        async commitCheckpoint(input) {
          commits += 1;
          return store.commitCheckpoint(input);
        },
        close: () => store.close()
      };
    }
  });
  const terminal = await harness.runner.start();
  assert.equal(terminal.status, "UNKNOWN");
  assert.equal(harness.network.calls, 4);
  assert.equal(commits, 2);
  assert.ok(reads >= 3);
});

test("actual controller honors operator stop before the full deadline", async t => {
  const harness = await createHarness(t, {paused: true});
  const running = harness.runner.start();
  await harness.firstCheckpoint;
  const requested = await harness.runner.stop();
  assert.equal(requested.status, "STOP_REQUESTED");
  const terminal = await running;
  assert.equal(terminal.status, "FINISHED");
  assert.equal(terminal.stopReason, "OPERATOR_STOP");
  assert.equal(harness.network.calls, 4);
  assert.equal(terminal.executionStarted, false);
});
