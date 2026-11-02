import assert from "node:assert/strict";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";

const START = Date.parse("2026-01-01T19:00:00Z");
const BUDGETS = {
  requests: 12,
  bytes: 1_000_000,
  events: 128,
  candidates: 4,
  cycles: 4,
  durationMs: 20_000,
  callbackTimeoutMs: 1_000,
  maxWallClockUncertaintyMs: 10
};

function config(overrides = {}) {
  return {
    version: 1,
    mode: "SYNTHETIC_TEST_ONLY",
    enabled: true,
    runId: "composition-test",
    startedAt: START,
    budgets: {...BUDGETS},
    ...overrides
  };
}

function clockHarness() {
  return createSyntheticClock({wallStart: START + 5_000, monotonicStart: 100});
}

async function harness(t, {
  runConfig = config(),
  clock = clockHarness(),
  adapters,
  fault = "NONE"
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-composition-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const pilot = createPaperPilotComposition({
    config: runConfig,
    dataDirectory: directory,
    adapters: adapters ?? offlineFixtureAdapters({clock, fault}),
    clock
  });
  return {directory, pilot, clock};
}

async function checkpoint(directory) {
  return JSON.parse(await readFile(path.join(directory, "checkpoint.json"), "utf8"));
}

test("disabled by default and rejects non-synthetic activation configuration", async t => {
  const directory = path.join(os.tmpdir(), `paper-composition-disabled-${process.pid}`);
  const disabled = createPaperPilotComposition();
  assert.equal((await disabled.start()).status, "DISABLED");
  assert.equal(disabled.stop(), false);
  assert.throws(() => createPaperPilotComposition({
    config: config({mode: "READ_ONLY_PAPER"}),
    dataDirectory: directory
  }), /invalid bounded composition configuration/);
  await rm(directory, {recursive: true, force: true});
  assert.throws(() => createPaperPilotComposition({
    config: config(),
    dataDirectory: directory,
    adapters: {acquireCandidates() {}, entryQuote() {}, exitQuote() {}},
    clock: clockHarness()
  }), /only module-generated offline fixture adapters may run/);
  assert.throws(() => offlineFixtureAdapters({candidate: {source: "SYNTHETIC_FIXTURE_ONLY"}}),
    /only a clock and named offline fixture fault/);
  let getterCalls = 0;
  const accessorConfig = {};
  Object.defineProperty(accessorConfig, "enabled", {
    get() { getterCalls += 1; return true; }
  });
  assert.throws(() => createPaperPilotComposition({config: accessorConfig}),
    /configuration cannot contain accessors/);
  const factoryOptions = {};
  Object.defineProperty(factoryOptions, "config", {
    get() { getterCalls += 1; return config(); }
  });
  assert.throws(() => createPaperPilotComposition(factoryOptions),
    /composition factory options must be bounded data/);
  const clockOptions = {};
  Object.defineProperty(clockOptions, "wallStart", {
    get() { getterCalls += 1; return START; }
  });
  assert.throws(() => createSyntheticClock(clockOptions), /synthetic clock options must be bounded data/);
  const fixtureOptions = {};
  Object.defineProperty(fixtureOptions, "fault", {
    get() { getterCalls += 1; return "NONE"; }
  });
  assert.throws(() => offlineFixtureAdapters(fixtureOptions),
    /only a clock and named offline fixture fault/);
  assert.equal(getterCalls, 0);
});

test("complete offline path uses existing gates, ledger, independent ticks and durable terminal receipt", async t => {
  const {directory, pilot} = await harness(t);
  const result = await pilot.start();
  assert.equal(result.status, "FINISHED");
  assert.equal(result.mode, "SYNTHETIC_TEST_ONLY");
  assert.equal(result.strategyOutcome, "CLOSED_PAPER");
  assert.equal(result.authority.liveReady, false);
  assert.equal(result.authority.signing, false);
  assert.equal(result.accounting.openPositions.length, 0);
  assert.equal(result.terminalReceipt.runId, "composition-test");
  assert.equal(result.terminalReceipt.sequence, result.checkpoint.sequence);
  assert.equal(result.timing.clockSource, "SYNTHETIC_FIXTURE_CLOCK");
  assert.equal(result.provenance.candidates[0].sourceTimestamp < result.provenance.candidates[0].receiptTimestamp, true);
  assert.deepEqual(result.provenance.quotes.map(item => item.purpose), ["entry", "risk-mark", "exit"]);

  const durable = await checkpoint(directory);
  const methods = durable.records.map(record => record.method);
  assert.deepEqual(methods, [
    "constructor", "authorizeEntry", "executeEntry", "riskSnapshot",
    "observeExitQuote", "riskSnapshot", "finishRun"
  ]);
  assert.equal(methods.filter(method => method === "executeEntry").length, 1);
  assert.equal(durable.records.at(-1).method, "finishRun");
  assert.equal(durable.sequence, result.terminalReceipt.sequence);
  assert.equal(durable.records[3].inputs.now <= durable.records[4].inputs.now, true);
  assert.equal(durable.records[4].inputs.now <= durable.records[5].inputs.now, true);
  assert.notEqual(durable.records[3].commandId, durable.records[5].commandId);
});

test("missing hard evidence and missing full cost components do not fill", async t => {
  const noEvidence = await harness(t, {fault: "MISSING_EVIDENCE"});
  const rejected = await noEvidence.pilot.start();
  assert.equal(rejected.status, "FINISHED");
  assert.equal(rejected.strategyOutcome, "BLOCKED");
  assert.equal(rejected.accounting.cashCents, "100000");
  assert.deepEqual((await checkpoint(noEvidence.directory)).records.map(record => record.method),
    ["constructor", "finishRun"]);

  const noCosts = await harness(t, {fault: "MISSING_COSTS"});
  const costResult = await noCosts.pilot.start();
  assert.equal(costResult.status, "FINISHED");
  assert.equal(costResult.strategyOutcome, "REJECT");
  assert.equal(costResult.accounting.cashCents, "100000");
  assert.equal(costResult.terminalState.reservedPositions, 1);
  const costCheckpoint = await checkpoint(noCosts.directory);
  assert.equal(costCheckpoint.records.some(record => record.method === "executeEntry"), false);
  assert.equal(costCheckpoint.records.at(-1).method, "finishRun");
});

test("no candidates emits a terminal checkpoint without inventing a trade", async t => {
  const {directory, pilot} = await harness(t, {fault: "NO_CANDIDATES"});
  const result = await pilot.start();
  assert.equal(result.status, "FINISHED");
  assert.equal(result.strategyOutcome, "NO_CANDIDATES");
  assert.equal(result.accounting.cashCents, "100000");
  assert.equal(result.accounting.openPositions.length, 0);
  assert.deepEqual((await checkpoint(directory)).records.map(record => record.method),
    ["constructor", "finishRun"]);
});

test("blocked start and expired windows leave a truthful blocked lifecycle state", async t => {
  const future = await harness(t, {
    runConfig: config({startedAt: START + 10_000})
  });
  assert.equal((await future.pilot.start()).code, "RUN_WINDOW_NOT_STARTED");
  assert.equal(future.pilot.status().state, "BLOCKED");
  assert.equal(future.pilot.stop(), false);

  const expired = await harness(t, {
    runConfig: config({startedAt: START - 8 * 60 * 60 * 1000})
  });
  assert.equal((await expired.pilot.start()).code, "RUN_WINDOW_EXPIRED");
  assert.equal(expired.pilot.status().state, "BLOCKED");
  assert.equal(expired.pilot.stop(), false);
});

test("pre-aborted composition does not write or initialize a checkpoint", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-composition-aborted-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const controller = new AbortController();
  controller.abort();
  const clock = clockHarness();
  const pilot = createPaperPilotComposition({
    config: config(),
    dataDirectory: directory,
    adapters: offlineFixtureAdapters({clock}),
    clock,
    signal: controller.signal
  });
  const result = await pilot.start();
  assert.equal(result.status, "STOPPED");
  assert.equal(pilot.status().state, "STOPPED");
  assert.deepEqual(await readdir(directory), []);
});

test("disconnect, timeout and late callback results remain nonterminal and are not retried", async t => {
  const disconnectHarness = await harness(t, {fault: "DISCONNECT"});
  const disconnectedResult = await disconnectHarness.pilot.start();
  assert.equal(disconnectedResult.status, "UNKNOWN");
  assert.equal(disconnectedResult.code, "DISCONNECTED");
  assert.equal(disconnectedResult.terminalReceipt, null);
  assert.equal((await checkpoint(disconnectHarness.directory)).sequence, 0);

  const timeoutHarness = await harness(t, {
    fault: "CALLBACK_TIMEOUT",
    runConfig: config({budgets: {...BUDGETS, callbackTimeoutMs: 5}})
  });
  const timeoutResult = await timeoutHarness.pilot.start();
  assert.equal(timeoutResult.status, "UNKNOWN");
  assert.equal(timeoutResult.code, "CALLBACK_TIMEOUT");
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await checkpoint(timeoutHarness.directory)).sequence, 0);

  const deadlineHarness = await harness(t, {
    fault: "LATE_DEADLINE",
    runConfig: config({
      budgets: {...BUDGETS, durationMs: 5, callbackTimeoutMs: 5}
    })
  });
  const deadlineResult = await deadlineHarness.pilot.start();
  assert.equal(deadlineResult.status, "UNKNOWN");
  assert.equal(deadlineResult.code, "DEADLINE");
  assert.equal((await checkpoint(deadlineHarness.directory)).sequence, 0);
});

test("stop cancels an outstanding adapter; clock jumps fail closed", async t => {
  const stopped = await harness(t, {fault: "WAIT_FOR_STOP"});
  const pending = stopped.pilot.start();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(stopped.pilot.stop(), true);
  const stoppedResult = await pending;
  assert.equal(stoppedResult.state, "STOPPED");
  assert.equal(stoppedResult.terminalReceipt, null);
  assert.equal((await checkpoint(stopped.directory)).sequence, 0);

  const jumped = await harness(t, {fault: "CLOCK_JUMP"});
  const jumpResult = await jumped.pilot.start();
  assert.equal(jumpResult.status, "UNKNOWN");
  assert.equal(jumpResult.code, "CLOCK_JUMP");
  assert.equal((await checkpoint(jumped.directory)).sequence, 0);
});

test("lost checkpoint ACK is UNKNOWN and duplicate events do not append another command", async t => {
  const lost = await harness(t, {fault: "LOST_ACK"});
  const uncertain = await lost.pilot.start();
  assert.equal(uncertain.status, "UNKNOWN");
  assert.equal(uncertain.terminalReceipt, null);
  assert.equal((await checkpoint(lost.directory)).sequence, 1);

  const complete = await harness(t);
  const result = await complete.pilot.start();
  const durable = await checkpoint(complete.directory);
  assert.equal(result.status, "FINISHED");
  assert.equal(durable.records.filter(record => record.method === "executeEntry").length, 1);
  const restartClock = clockHarness();
  const restarted = createPaperPilotComposition({
    config: config({runId: "different-run"}),
    dataDirectory: complete.directory,
    adapters: offlineFixtureAdapters({clock: restartClock}),
    clock: restartClock
  });
  assert.deepEqual(await restarted.start(), {
    status: "BLOCKED", code: "RESTART_NOT_ALLOWED", terminalReceipt: null
  });
});

test("unavailable final mark remains open and unvalued instead of being liquidated", async t => {
  const {directory, pilot} = await harness(t, {fault: "NO_MARK"});
  const result = await pilot.start();
  assert.equal(result.status, "FINISHED");
  assert.equal(result.strategyOutcome, "VALUATION_UNAVAILABLE");
  assert.equal(result.terminalState.openPositions.length, 1);
  assert.equal(result.terminalState.openPositions[0].markStatus, "VALUATION_UNAVAILABLE");
  assert.equal(result.terminalState.equityCents, null);
  assert.match(result.terminalState.note, /not liquidated/);
  const durable = await checkpoint(directory);
  assert.equal(durable.records.at(-1).method, "finishRun");
  assert.equal(durable.records.some(record => record.method === "observeExitQuote"), false);
});

test("source quote time later than local receipt is rejected before entry dispatch", async t => {
  const {directory, pilot} = await harness(t, {fault: "QUOTE_AFTER_RECEIPT"});
  const result = await pilot.start();
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.code, "QUOTE_AFTER_RECEIPT");
  const durable = await checkpoint(directory);
  assert.equal(durable.records.some(record => record.method === "executeEntry"), false);
  assert.equal(durable.records.at(-1).method, "authorizeEntry");
});

test("request and byte budgets are global and source labels cannot masquerade as real evidence", async t => {
  const budget = await harness(t, {
    fault: "REQUEST_BUDGET",
    runConfig: config({budgets: {...BUDGETS, requests: 1}})
  });
  const exhausted = await budget.pilot.start();
  assert.equal(exhausted.status, "UNKNOWN");
  assert.equal(exhausted.code, "GLOBAL_BUDGET");
  assert.equal((await checkpoint(budget.directory)).sequence, 0);

  const byteBudget = await harness(t, {
    runConfig: config({budgets: {...BUDGETS, bytes: 1024}})
  });
  const tooLarge = await byteBudget.pilot.start();
  assert.equal(tooLarge.status, "UNKNOWN");
  assert.equal(tooLarge.code, "BYTE_BUDGET");
  assert.equal((await checkpoint(byteBudget.directory)).sequence, 0);

  const source = await harness(t, {fault: "SPOOF_SOURCE"});
  const refused = await source.pilot.start();
  assert.equal(refused.status, "UNKNOWN");
  assert.equal(refused.code, "SOURCE_PROVENANCE");
});
