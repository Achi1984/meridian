import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {createBoundedExternalReadOnlyInput} from "../scripts/memecoin-paper/execution-runner.mjs";
import {
  evaluateMemecoinPaperRunExport
} from "../scripts/memecoin-paper-simulated-evaluation/index.mjs";

const START = Date.parse("2026-01-01T19:00:00Z");
const CLI = fileURLToPath(new URL("../scripts/memecoin-paper/paper-pilot-composition.mjs", import.meta.url));
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
  fault = "NONE",
  onTestInitialized
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-composition-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const pilot = createPaperPilotComposition({
    config: runConfig,
    dataDirectory: directory,
    adapters: adapters ?? offlineFixtureAdapters({clock, fault}),
    clock,
    onTestInitialized
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
    /only a clock, named offline fixture fault, and modeled fixture policy/);
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
    /only a clock, named offline fixture fault, and modeled fixture policy/);
  assert.equal(getterCalls, 0);
});

test("bounded external candidate reaches existing filters and ends with a durable no-entry receipt", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-composition-external-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const startedAt = Date.now() - 1_000;
  const sampledAt = Date.now() - 100;
  const externalReadOnlyInput = createBoundedExternalReadOnlyInput({
    kind: "MEMECOIN_EXTERNAL_READ_ONLY_INPUT_V1",
    schemaVersion: 1,
    producerRevision: "candidate-intake-1",
    sourceContracts: {candidateIntakeSha: "a".repeat(40), evidenceSha: null, quotesSha: null},
    timing: {
      sourceTimestamp: sampledAt,
      receiptTimestamp: sampledAt,
      uncertaintyMs: 1,
      monotonicElapsedMs: 0,
      clockSource: "claimed-source-clock"
    },
    payload: {
      candidate: {
        chainId: "solana",
        mint: "11111111111111111111111111111111",
        pool: "Vote111111111111111111111111111111111111111",
        quote: "Stake11111111111111111111111111111111111111",
        decimals: 6,
        sampledAt,
        source: "SYNTHETIC_FIXTURE_ONLY",
        evidence: {},
        analystEvidence: {}
      }
    }
  });
  const externalInputBytes = Buffer.byteLength(canonicalCheckpointBytes(externalReadOnlyInput));
  const budgetExhaustingInput = createBoundedExternalReadOnlyInput({
    ...externalReadOnlyInput,
    payload: {...externalReadOnlyInput.payload, padding: "x".repeat(1_500)}
  });
  const exhaustedBytes = Buffer.byteLength(canonicalCheckpointBytes(budgetExhaustingInput));
  assert.ok(exhaustedBytes >= 1_024);
  assert.throws(() => createPaperPilotComposition({
    config: config({
      mode: "EXTERNAL_READ_ONLY_INPUT",
      budgets: {...BUDGETS, bytes: exhaustedBytes}
    }),
    dataDirectory: path.join(directory, "exhausted"),
    externalReadOnlyInput: budgetExhaustingInput
  }), /must leave bytes for runner input/);
  const pilot = createPaperPilotComposition({
    config: config({mode: "EXTERNAL_READ_ONLY_INPUT", runId: "external-composition-test", startedAt}),
    dataDirectory: directory,
    externalReadOnlyInput
  });
  const result = await pilot.start();
  assert.equal(result.status, "FINISHED");
  assert.equal(result.strategyOutcome, "BLOCKED");
  assert.equal(result.mode, "EXTERNAL_READ_ONLY_INPUT");
  assert.equal(result.executionStarted, true);
  assert.deepEqual(result.terminalReceipt, result.report.runnerReport.terminalReceipt);
  assert.equal(result.report.schemaVersion, "memecoin-paper-run-export/v1");
  assert.equal(result.report.persistence, "ACKNOWLEDGED");
  assert.equal(result.report.exportBinding, "PRESTART_BOUND");
  assert.equal(result.budgets.bytes, externalInputBytes);
  assert.ok(result.report.runnerReport.inputBytes <= BUDGETS.bytes - externalInputBytes);
  assert.equal(result.report.runnerReport.executionMode, "READ_ONLY_EXTERNAL");
  assert.equal(result.report.runnerReport.provenance, "UNVERIFIED_CALLER_INPUT");
  assert.equal(result.report.runnerReport.counters.quotes, 0);
  assert.equal(result.report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry"), false);
  const decision = result.report.runnerReport.operationResults.find(item =>
    item.method === "authorizeEntry");
  assert.equal(decision.status, "BLOCKED");
  assert.equal(decision.filterResult.accepted, false);
  assert.equal(decision.candidateObservation.source, "UNVERIFIED_EXTERNAL_READ_ONLY_INPUT");
  assert.equal(decision.candidateObservation.sourceClaim, "SYNTHETIC_FIXTURE_ONLY");
  assert.deepEqual(result.report.checkpoint.records.map(record => record.method), [
    "constructor", "riskSnapshot", "riskSnapshot", "finishRun"
  ]);
  assert.equal(result.report.checkpointSha256,
    createHash("sha256").update(canonicalCheckpointBytes(result.report.checkpoint)).digest("hex"));
  assert.equal(result.report.bindingReceipt.externalInputSha256, result.report.runnerReport.externalInputDigest);
  const persistedBinding = JSON.parse(await readFile(path.join(directory, "start-binding.json"), "utf8"));
  assert.deepEqual(persistedBinding, result.report.bindingReceipt);
  const {receiptSha256, ...unsignedBinding} = persistedBinding;
  assert.equal(receiptSha256, createHash("sha256")
    .update(canonicalCheckpointBytes(unsignedBinding)).digest("hex"));
  const alteredCheckpoint = structuredClone(result.report.checkpoint);
  alteredCheckpoint.records.at(-1).method = "riskSnapshot";
  assert.notEqual(createHash("sha256")
    .update(canonicalCheckpointBytes(alteredCheckpoint)).digest("hex"), result.report.checkpointSha256);
  assert.equal(result.authority.liveReady, false);
  assert.throws(() => createPaperPilotComposition({
    config: config(),
    externalReadOnlyInput
  }), /requires EXTERNAL_READ_ONLY_INPUT mode/);
});

test("CLI rejects FIFOs and symlinked config files without waiting or creating checkpoints", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-composition-cli-files-"));
  const stateDirectory = path.join(root, "state");
  await mkdir(stateDirectory);
  t.after(() => rm(root, {recursive: true, force: true}));

  const fifo = path.join(root, "config.fifo");
  execFileSync("mkfifo", [fifo]);
  const fifoResult = spawnSync(process.execPath, [
    CLI, "offline-proof", "--config", fifo, "--data-dir", stateDirectory
  ], {encoding: "utf8", timeout: 1_000});
  assert.equal(fifoResult.error, undefined);
  assert.equal(fifoResult.status, 1);
  assert.deepEqual(JSON.parse(fifoResult.stdout), {status: "BLOCKED", code: "INVALID_CONFIGURATION"});
  assert.deepEqual(await readdir(stateDirectory), []);

  const regularConfig = path.join(root, "regular.json");
  const linkedConfig = path.join(root, "linked.json");
  await writeFile(regularConfig, JSON.stringify(config()));
  await symlink(regularConfig, linkedConfig);
  const symlinkResult = spawnSync(process.execPath, [
    CLI, "offline-proof", "--config", linkedConfig, "--data-dir", stateDirectory
  ], {encoding: "utf8", timeout: 1_000});
  assert.equal(symlinkResult.error, undefined);
  assert.equal(symlinkResult.status, 1);
  assert.deepEqual(JSON.parse(symlinkResult.stdout), {status: "BLOCKED", code: "INVALID_CONFIGURATION"});
  assert.deepEqual(await readdir(stateDirectory), []);
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
  assert.equal(result.report.schemaVersion, "memecoin-paper-run-export/v1");
  assert.equal(result.report.producerRevision, "paper-pilot-composition/3");
  assert.deepEqual(result.report.config, config());
  assert.equal(result.report.configSha256, createHash("sha256")
    .update(canonicalCheckpointBytes(config())).digest("hex"));
  assert.equal(result.report.runId, "composition-test");
  assert.equal(result.report.startedAt, START);
  assert.equal(result.report.deadlineAt, START + 8 * 60 * 60 * 1000);
  assert.equal(result.report.policyVersion, result.report.checkpoint.runHeader.policyVersion);
  assert.equal(result.report.persistence, "ACKNOWLEDGED");
  assert.equal(result.report.exportBinding, "PRESTART_BOUND");
  assert.equal(result.report.bindingReceipt.configSha256, result.report.configSha256);
  const persisted = await checkpoint(directory);
  assert.deepEqual(result.report.checkpoint, persisted);
  assert.equal(result.report.checkpointSha256,
    createHash("sha256").update(canonicalCheckpointBytes(persisted)).digest("hex"));
  const alteredConfig = config({runId: "tampered-config"});
  assert.notEqual(createHash("sha256").update(canonicalCheckpointBytes(alteredConfig)).digest("hex"),
    result.report.configSha256);
  assert.deepEqual(result.report.runnerReport, {
    status: result.report.runnerReport.status,
    reason: result.report.runnerReport.reason,
    runId: result.report.runnerReport.runId,
    executionMode: result.report.runnerReport.executionMode,
    provenance: result.report.runnerReport.provenance,
    realDataSourceCoverage: result.report.runnerReport.realDataSourceCoverage,
    counters: result.report.runnerReport.counters,
    inputBytes: result.report.runnerReport.inputBytes,
    candidateBudgetReached: result.report.runnerReport.candidateBudgetReached,
    receipts: result.report.runnerReport.receipts,
    operationResults: result.report.runnerReport.operationResults,
    missingTerminalValuationMints: result.report.runnerReport.missingTerminalValuationMints,
    pendingAuthorizationIds: result.report.runnerReport.pendingAuthorizationIds,
    terminalResult: result.report.runnerReport.terminalResult,
    terminalReceipt: result.report.runnerReport.terminalReceipt,
    summary: result.report.runnerReport.summary
  });
  assert.deepEqual(result.report.runnerReport.terminalReceipt, {
    runId: result.terminalReceipt.runId,
    sequence: result.terminalReceipt.sequence,
    hash: result.terminalReceipt.hash,
    resultDigest: result.terminalReceipt.resultDigest
  });
  assert.equal(persisted.records.at(-1).method, "finishRun");
  assert.equal(persisted.records.at(-1).commandId, result.report.runnerReport.terminalResult.commandId);
  assert.equal(persisted.records.at(-1).resultDigest, result.terminalReceipt.resultDigest);
  assert.equal(result.terminalReceipt.hash, result.report.checkpointSha256);
  const entryRecord = persisted.records.find(record => record.method === "executeEntry");
  assert.equal(entryRecord.inputs.quote.source, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(entryRecord.inputs.quote.costs.networkCents, 0);
  assert.equal(result.report.runnerReport.operationResults.find(item =>
    item.method === "executeEntry").status, "FILLED_PAPER");
  assert.equal(result.report.runnerReport.operationResults.some(item =>
    item.method === "observeExitQuote" && item.status === "CLOSED_PAPER"), true);
  assert.deepEqual(result.report.runnerReport.terminalResult.openPositions, []);
  assert.equal(result.timing.clockSource, "SYNTHETIC_FIXTURE_CLOCK");
  assert.equal(result.provenance.candidates[0].sourceTimestamp < result.provenance.candidates[0].receiptTimestamp, true);
  assert.deepEqual(result.provenance.quotes.map(item => item.purpose), ["entry", "risk-mark", "risk-mark"]);

  const durable = persisted;
  const methods = durable.records.map(record => record.method);
  assert.deepEqual(methods, [
    "constructor", "riskSnapshot", "authorizeEntry", "executeEntry", "observeExitQuote",
    "riskSnapshot", "observeExitQuote", "riskSnapshot", "finishRun"
  ]);
  assert.equal(methods.filter(method => method === "executeEntry").length, 1);
  assert.equal(durable.records.at(-1).method, "finishRun");
  assert.equal(durable.sequence, result.terminalReceipt.sequence);
  assert.equal(durable.records[4].inputs.now <= durable.records[5].inputs.now, true);
  assert.equal(durable.records[5].inputs.now <= durable.records[6].inputs.now, true);
  assert.notEqual(durable.records[1].commandId, durable.records[5].commandId);
});

test("synthetic runtime fixture carries adapter quotes through entry, risk, exit, and exported audit", async t => {
  const {directory, pilot} = await harness(t, {
    fault: "PIPELINE_QUOTE",
    runConfig: config({budgets: {...BUDGETS, requests: 40, cycles: 8}})
  });
  const result = await pilot.start();
  const report = result.report;
  const runtime = report.runnerReport.runtimeAudit;
  assert.ok(runtime);
  assert.equal(runtime.source, "SYNTHETIC_FIXTURE_ONLY");
  assert.equal(runtime.candidates.length, 1);
  const candidate = runtime.candidates[0];
  assert.equal(candidate.pipeline.filtersStatus, "PASS");
  assert.equal(candidate.pipeline.filtersAccepted, true);
  assert.equal(candidate.pipeline.analystStatus, "PASS");
  assert.equal(candidate.pipeline.syntheticAnalystEvidence, "SYNTHETIC_FIXTURE_ONLY");
  assert.ok(candidate.pipeline.acquisitionReceiptIds.length > 0);
  assert.ok(candidate.assembledAt >= candidate.candidateT);
  assert.ok(candidate.decisionAt >= candidate.assembledAt);
  assert.deepEqual(candidate.quotes.map(item => item.purpose), ["entry", "risk-mark"]);
  assert.deepEqual(candidate.quotes.map(item => item.paperPriceMicros), [5_000_000, 4_500_000]);
  assert.ok(candidate.quotes.every(item =>
    item.adapterStatus === "UNAVAILABLE" &&
    item.adapterAuthorizationEligible === false &&
    item.adapterCostStatus === "UNKNOWN" &&
    item.adapterSourceProvenance === "INJECTED_TRANSPORT_NOT_AUTHENTICATED"));
  assert.ok(candidate.quotes.every(item =>
    item.paperFillEligible &&
    item.costBasis === "SYNTHETIC_FIXED_CENT_SCHEDULE_V1" &&
    Object.keys(item.costs).length === 5), JSON.stringify(candidate.quotes, null, 2));
  assert.ok(report.runnerReport.counters.quotes >= 2);
  assert.equal(report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry" && item.status === "FILLED_PAPER"), true);
  assert.equal(report.runnerReport.operationResults.some(item =>
    item.method === "observeExitQuote" && item.status === "CLOSED_PAPER"), true);
  const authorization = report.runnerReport.operationResults.find(item =>
    item.method === "authorizeEntry");
  assert.equal(authorization.candidateMint, candidate.identity.mint);
  assert.equal(authorization.candidateAnalystEvidenceSha256,
    candidate.pipeline.analystEvidenceSha256);
  assert.deepEqual(report.runnerReport.terminalResult.openPositions, []);
  assert.equal(report.persistence, "ACKNOWLEDGED");
  assert.equal(report.exportBinding, "PRESTART_BOUND");
  assert.ok(await readFile(path.join(directory, "checkpoint.json")));

  const exportBytes = canonicalCheckpointBytes(report);
  const parsedReport = JSON.parse(exportBytes.toString("utf8"));
  assert.deepEqual(parsedReport.runnerReport.runtimeAudit, runtime);
  const configSha256 = createHash("sha256")
    .update(canonicalCheckpointBytes(report.config)).digest("hex");
  const evaluation = evaluateMemecoinPaperRunExport(exportBytes, {
    runId: report.runId,
    configSha256,
    producerRevision: report.producerRevision
  });
  assert.equal(evaluation.checks.find(item => item.id === "runtime_source_quote_audit").status, "PASS");
  assert.equal(evaluation.evidence.entryFills, 1);
  assert.equal(evaluation.evidence.exits, 1);
  assert.equal(evaluation.outcome, "SIMULATED_ENTRY_EXIT_COMPLETE");
  assert.equal(evaluation.claims.liveExecution, false);
});

test("valid entry quote stopped or expired before execution is explicitly unconsumed", async t => {
  for (const [runId, fault, status, reason, disposition] of [
    ["quote-before-stop", "PIPELINE_QUOTE_STOP_AFTER_ENTRY", "STOPPED", "SHUTDOWN", "NOT_CONSUMED_STOPPED"],
    ["quote-before-deadline", "PIPELINE_QUOTE_DEADLINE_AFTER_ENTRY", "FINISHED", "DEADLINE", "NOT_CONSUMED_DEADLINE"]
  ]) {
    const {pilot} = await harness(t, {
      fault,
      runConfig: config({
        runId,
        budgets: {...BUDGETS, requests: 40, cycles: 8}
      })
    });
    const result = await pilot.start();
    const report = result.report;
    const auditQuote = report.runnerReport.runtimeAudit.candidates[0].quotes[0];
    assert.equal(result.status, status);
    assert.equal(report.runnerReport.reason, reason);
    assert.equal(auditQuote.purpose, "entry");
    assert.equal(auditQuote.paperFillEligible, true);
    assert.equal(auditQuote.disposition, disposition);
    assert.equal(report.runnerReport.operationResults.some(item =>
      item.method === "executeEntry"), false);
    assert.deepEqual(report.runnerReport.terminalResult.openPositions, []);
    const bytes = canonicalCheckpointBytes(report);
    const parsed = JSON.parse(bytes.toString("utf8"));
    assert.deepEqual(parsed.runnerReport.runtimeAudit, report.runnerReport.runtimeAudit);
    const evaluation = evaluateMemecoinPaperRunExport(bytes, {
      runId: report.runId,
      configSha256: createHash("sha256")
        .update(canonicalCheckpointBytes(report.config)).digest("hex"),
      producerRevision: report.producerRevision
    });
    assert.equal(evaluation.checks.find(item => item.id === "runtime_source_quote_audit").status, "PASS");
    assert.equal(evaluation.evidence.entryFills, 0);
  }
});

test("pipeline and adapter identity, chronology, quote, and cost failures remain no-entry", async t => {
  for (const [runId, fault, sourceIdentityValid, marketPairChronologyValid, expectedAdapterCalls] of [
    ["pipeline-wrong-identity", "PIPELINE_QUOTE_WRONG_IDENTITY", false, true, 0],
    ["pipeline-future-evidence", "PIPELINE_QUOTE_FUTURE_EVIDENCE", true, false, 0],
    ["pipeline-missing-quote", "PIPELINE_QUOTE_MISSING_QUOTE", true, true, 1],
    ["pipeline-missing-costs", "PIPELINE_QUOTE_MISSING_COSTS", true, true, 1],
    ["pipeline-route-identity", "PIPELINE_QUOTE_ROUTE_IDENTITY", true, true, 1]
  ]) {
    const {pilot} = await harness(t, {
      runConfig: config({runId, budgets: {...BUDGETS, requests: 40, cycles: 8}}),
      fault
    });
    const result = await pilot.start();
    const audit = result.report.runnerReport.runtimeAudit;
    assert.ok(audit);
    assert.equal(audit.candidates[0].pipeline.sourceIdentityValid, sourceIdentityValid);
    assert.equal(audit.candidates[0].pipeline.marketPairChronologyValid, marketPairChronologyValid);
    assert.equal(result.report.runnerReport.counters.quotes, expectedAdapterCalls);
    assert.ok(audit.candidates[0].quotes.every(item => !item.paperFillEligible),
      JSON.stringify(audit.candidates[0], null, 2));
    assert.equal(result.report.runnerReport.operationResults.some(item =>
      item.method === "executeEntry" && item.status === "FILLED_PAPER"), false);
    assert.deepEqual(result.report.runnerReport.terminalResult.openPositions, []);
    const reportBytes = canonicalCheckpointBytes(result.report);
    const parsedReport = JSON.parse(reportBytes.toString("utf8"));
    assert.deepEqual(parsedReport.runnerReport.runtimeAudit, audit);
    const evaluation = evaluateMemecoinPaperRunExport(reportBytes, {
      runId: result.report.runId,
      configSha256: createHash("sha256")
        .update(canonicalCheckpointBytes(result.report.config)).digest("hex"),
      producerRevision: result.report.producerRevision
    });
    assert.equal(evaluation.checks.find(item =>
      item.id === "runtime_source_quote_audit").status, "PASS");
  }
});

test("repeated fixture acquisition shares request and work budgets and deduplicates candidate identity", async t => {
  const duplicate = await harness(t, {
    runConfig: config({
      runId: "pipeline-duplicate",
      // Two 25-request acquisitions, three source polls, and two quotes need 55; keep 9 headroom.
      budgets: {...BUDGETS, requests: 64, cycles: 8}
    }),
    fault: "PIPELINE_QUOTE_DUPLICATE"
  });
  const result = await duplicate.pilot.start();
  assert.equal(result.status, "FINISHED");
  assert.equal(result.provenance.candidates.length, 1);
  assert.equal(result.budgets.acquisitionCycles, 3);
  assert.ok(result.budgets.requests <= 64);
  assert.ok(result.budgets.events <= BUDGETS.events);
  assert.deepEqual(result.report.runnerReport.terminalResult.openPositions, []);

  const exhausted = await harness(t, {
    runConfig: config({
      runId: "pipeline-budget-exhausted",
      budgets: {...BUDGETS, requests: 10, cycles: 8}
    }),
    fault: "PIPELINE_QUOTE_DUPLICATE"
  });
  const bounded = await exhausted.pilot.start();
  assert.equal(bounded.status, "UNKNOWN");
  assert.equal(bounded.report.runnerReport.reason, "GLOBAL_BUDGET");
  assert.equal(bounded.budgets.requests, 10);
  assert.ok(bounded.budgets.events <= BUDGETS.events);
  assert.equal(bounded.report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry" && item.status === "FILLED_PAPER"), false);
});

test("stop during the integrated fixture callback isolates its late completion", async t => {
  let initialized;
  const ready = new Promise(resolve => { initialized = resolve; });
  const {pilot} = await harness(t, {
    fault: "PIPELINE_QUOTE_WAIT",
    onTestInitialized: initialized
  });
  const pending = pilot.start();
  await ready;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(pilot.stop(), true);
  const result = await pending;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(["STOPPED", "UNKNOWN"].includes(result.status));
  assert.ok(result.report.runnerReport.counters.quotes === 0);
  assert.equal(result.provenance.candidates.length, 0);
});

test("deadline during fixture acquisition prevents its subsequent quote request", async t => {
  const {pilot} = await harness(t, {fault: "PIPELINE_QUOTE_DEADLINE"});
  const result = await pilot.start();
  assert.equal(result.provenance.candidates.length, 0);
  assert.equal(result.report.runnerReport.counters.candidates, 0);
  assert.equal(result.report.runnerReport.counters.quotes, 0);
  assert.ok(["FINISHED", "STOPPED", "UNKNOWN"].includes(result.status));
});

test("missing hard evidence and missing full cost components do not fill", async t => {
  const noEvidence = await harness(t, {fault: "MISSING_EVIDENCE"});
  const rejected = await noEvidence.pilot.start();
  assert.equal(rejected.status, "FINISHED");
  assert.equal(rejected.strategyOutcome, "BLOCKED");
  assert.equal(rejected.strategyOutcome, "BLOCKED");
  assert.equal(rejected.accounting.cashCents, "100000");
  const evidenceRecords = (await checkpoint(noEvidence.directory)).records;
  assert.equal(evidenceRecords.some(record => record.method === "executeEntry"), false);
  assert.equal(evidenceRecords.at(-1).method, "finishRun");

  const noCosts = await harness(t, {fault: "MISSING_COSTS"});
  const costResult = await noCosts.pilot.start();
  assert.equal(costResult.status, "FINISHED");
  assert.equal(costResult.strategyOutcome, "REJECT");
  assert.equal(costResult.accounting.cashCents, "100000");
  assert.equal(costResult.terminalState.reservedPositions, 1);
  const costCheckpoint = await checkpoint(noCosts.directory);
  assert.equal(costCheckpoint.records.some(record => record.method === "executeEntry"), false);
  assert.equal(costCheckpoint.records.at(-1).method, "finishRun");
  assert.equal(costResult.report.persistence, "ACKNOWLEDGED");
  assert.equal(costResult.report.runnerReport.pendingAuthorizationIds.length, 1);
});

test("no candidates emits a terminal checkpoint without inventing a trade", async t => {
  const {directory, pilot} = await harness(t, {fault: "NO_CANDIDATES"});
  const result = await pilot.start();
  assert.equal(result.status, "FINISHED");
  assert.equal(result.strategyOutcome, "NO_CANDIDATES");
  assert.equal(result.accounting.cashCents, "100000");
  assert.equal(result.accounting.openPositions.length, 0);
  const records = (await checkpoint(directory)).records;
  assert.deepEqual(records.map(record => record.method), ["constructor", "riskSnapshot", "finishRun"]);
});

test("blocked start and expired windows leave a truthful blocked lifecycle state", async t => {
  const future = await harness(t, {
    runConfig: config({startedAt: START + 10_000})
  });
  const futureResult = await future.pilot.start();
  assert.equal(futureResult.code, "RUN_WINDOW_NOT_STARTED");
  assert.equal(futureResult.executionStarted, false);
  assert.equal(futureResult.terminalReceipt, null);
  assert.equal(futureResult.report.runnerReport, null);
  assert.equal(future.pilot.status().state, "BLOCKED");
  assert.equal(future.pilot.stop(), false);

  const expired = await harness(t, {
    runConfig: config({startedAt: START - 8 * 60 * 60 * 1000})
  });
  const expiredResult = await expired.pilot.start();
  assert.equal(expiredResult.code, "RUN_WINDOW_EXPIRED");
  assert.equal(expiredResult.executionStarted, false);
  assert.equal(expiredResult.terminalReceipt, null);
  assert.equal(expiredResult.report.runnerReport, null);
  assert.equal(expired.pilot.status().state, "BLOCKED");
  assert.equal(expired.pilot.stop(), false);
});

test("pre-aborted timeout does not write or invent a terminal result", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-composition-aborted-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const controller = new AbortController();
  controller.abort(new DOMException("fixture timeout", "TimeoutError"));
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
  assert.equal(result.executionStarted, false);
  assert.equal(result.terminalReceipt, null);
  assert.equal(result.report.persistence, "NOT_STARTED");
  assert.equal(result.report.runnerReport, null);
  assert.deepEqual(await readdir(directory), []);
});

test("stop during checkpoint-store opening is STOPPED and NOT_STARTED", async t => {
  const {directory, pilot} = await harness(t);
  const pending = pilot.start();
  assert.equal(pilot.stop(), true);
  const result = await pending;
  assert.equal(result.status, "STOPPED");
  assert.equal(result.state, "STOPPED");
  assert.equal(result.report.persistence, "NOT_STARTED");
  assert.equal(result.report.bindingReceipt, null);
  assert.equal(result.terminalReceipt, null);
  assert.equal(result.report.runnerReport, null);
  assert.deepEqual(await readdir(directory), []);
});

test("disconnect, timeout and late callbacks stay UNKNOWN while terminal persistence is separately classified", async t => {
  const disconnectHarness = await harness(t, {fault: "DISCONNECT"});
  const disconnectedResult = await disconnectHarness.pilot.start();
  assert.equal(disconnectedResult.status, "UNKNOWN");
  assert.equal(disconnectedResult.code, "DISCONNECTED");
  assert.ok(disconnectedResult.terminalReceipt);
  assert.equal(disconnectedResult.report.runnerReport.status, "UNKNOWN");
  assert.equal(disconnectedResult.report.runnerReport.reason, "DISCONNECTED");
  assert.equal(disconnectedResult.report.persistence, "ACKNOWLEDGED");
  const disconnectedRecords = (await checkpoint(disconnectHarness.directory)).records;
  assert.equal(disconnectedRecords.filter(record => record.method === "finishRun").length, 1);
  assert.equal(disconnectedRecords.some(record => record.method === "executeEntry"), false);

  const timeoutHarness = await harness(t, {
    fault: "CALLBACK_TIMEOUT",
    runConfig: config({budgets: {...BUDGETS, callbackTimeoutMs: 5}})
  });
  const timeoutResult = await timeoutHarness.pilot.start();
  assert.equal(timeoutResult.status, "UNKNOWN");
  assert.equal(timeoutResult.code, "CALLBACK_TIMEOUT");
  assert.ok(timeoutResult.terminalReceipt);
  assert.equal(timeoutResult.report.runnerReport.status, "UNKNOWN");
  assert.equal(timeoutResult.report.runnerReport.reason, "CALLBACK_TIMEOUT");
  assert.equal(timeoutResult.report.persistence, "ACKNOWLEDGED");
  await new Promise(resolve => setTimeout(resolve, 40));
  const timeoutRecords = (await checkpoint(timeoutHarness.directory)).records;
  assert.equal(timeoutRecords.filter(record => record.method === "finishRun").length, 1);
  assert.equal(timeoutRecords.some(record => record.method === "executeEntry"), false);

  const deadlineHarness = await harness(t, {
    fault: "LATE_DEADLINE",
    runConfig: config({
      budgets: {...BUDGETS, durationMs: 5, callbackTimeoutMs: 5}
    })
  });
  const deadlineResult = await deadlineHarness.pilot.start();
  assert.equal(deadlineResult.status, "FINISHED");
  assert.equal(deadlineResult.code, "DEADLINE");
  assert.ok(deadlineResult.terminalReceipt);
  assert.equal(deadlineResult.report.runnerReport.reason, "DEADLINE");
  assert.equal(deadlineResult.report.persistence, "ACKNOWLEDGED");
  assert.equal(deadlineResult.report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry"), false);
  assert.equal((await checkpoint(deadlineHarness.directory)).records.at(-1).method, "finishRun");
});

test("stop has one STOPPED lifecycle with acknowledged persistence; clock jumps remain UNKNOWN", async t => {
  const stopped = await harness(t, {fault: "WAIT_FOR_STOP"});
  const pending = stopped.pilot.start();
  let initialized = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await checkpoint(stopped.directory);
      initialized = true;
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  assert.equal(initialized, true);
  assert.equal(stopped.pilot.stop(), true);
  const stoppedResult = await pending;
  assert.equal(stoppedResult.status, "STOPPED");
  assert.equal(stoppedResult.state, "STOPPED");
  assert.ok(stoppedResult.terminalReceipt);
  assert.equal(stoppedResult.report.persistence, "ACKNOWLEDGED");
  assert.equal((await checkpoint(stopped.directory)).records.at(-1).method, "finishRun");

  const jumped = await harness(t, {fault: "CLOCK_JUMP"});
  const jumpResult = await jumped.pilot.start();
  assert.equal(jumpResult.status, "UNKNOWN");
  assert.equal(jumpResult.code, "CLOCK_JUMP");
  assert.equal(jumpResult.terminalReceipt, null);
  assert.equal(jumpResult.report.persistence, "UNKNOWN");
  assert.equal((await checkpoint(jumped.directory)).records.at(-1).method, "riskSnapshot");
});

test("lost checkpoint ACK remains UNKNOWN and runner does not duplicate entry commands", async t => {
  const lost = await harness(t, {fault: "LOST_ACK"});
  const uncertain = await lost.pilot.start();
  assert.equal(uncertain.status, "UNKNOWN");
  assert.equal(uncertain.terminalReceipt, null);
  assert.equal((await checkpoint(lost.directory)).sequence, 1);
  assert.equal(uncertain.report.persistence, "UNKNOWN");

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
  const restartResult = await restarted.start();
  assert.equal(restartResult.status, "BLOCKED");
  assert.equal(restartResult.code, "RESTART_NOT_ALLOWED");
  assert.equal(restartResult.terminalReceipt, null);
  assert.equal(restartResult.report.persistence, "NOT_STARTED");
});

test("lost sequence-zero acknowledgement is UNKNOWN, never NOT_STARTED", async t => {
  const initial = await harness(t, {fault: "LOST_INITIAL_ACK"});
  const result = await initial.pilot.start();
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.code, "CHECKPOINT_UNKNOWN");
  assert.equal(result.report.persistence, "UNKNOWN");
  assert.equal(result.executionStarted, true);
  assert.equal(result.terminalReceipt, null);
  assert.equal(result.report.runnerReport, null);
  assert.equal(result.report.checkpoint, null);
  assert.equal(result.report.exportBinding, "PRESTART_BOUND");
  assert.equal((await checkpoint(initial.directory)).sequence, 0);
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
  assert.equal(durable.records.at(-1).method, "finishRun");
});

test("request and byte budgets are global and source labels cannot masquerade as real evidence", async t => {
  const budget = await harness(t, {
    fault: "REQUEST_BUDGET",
    runConfig: config({budgets: {...BUDGETS, requests: 1}})
  });
  const exhausted = await budget.pilot.start();
  assert.equal(exhausted.status, "UNKNOWN");
  assert.equal(exhausted.code, "GLOBAL_BUDGET");
  assert.equal((await checkpoint(budget.directory)).records.at(-1).method, "finishRun");

  const byteBudget = await harness(t, {
    runConfig: config({budgets: {...BUDGETS, bytes: 1024}})
  });
  const tooLarge = await byteBudget.pilot.start();
  assert.equal(tooLarge.status, "UNKNOWN");
  assert.equal(tooLarge.code, "BYTE_BUDGET");
  assert.equal(tooLarge.terminalReceipt, null);
  assert.equal(tooLarge.report.persistence, "UNKNOWN");
  assert.equal((await checkpoint(byteBudget.directory)).records.at(-1).method, "constructor");

  const source = await harness(t, {fault: "SPOOF_SOURCE"});
  const refused = await source.pilot.start();
  assert.equal(refused.status, "UNKNOWN");
  assert.equal(refused.code, "SOURCE_PROVENANCE");
});
