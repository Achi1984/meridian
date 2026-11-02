import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {evaluateMemecoinPaperRunExport} from "../scripts/memecoin-paper-simulated-evaluation/index.mjs";

const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const START = Date.parse("2026-01-01T19:00:00Z");
const CLI = fileURLToPath(new URL("../scripts/memecoin-paper-simulated-evaluation/index.mjs", import.meta.url));
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

function config(runId, {startedAt = START, budgets = BUDGETS} = {}) {
  return {
    version: 1,
    mode: "SYNTHETIC_TEST_ONLY",
    enabled: true,
    runId,
    startedAt,
    budgets: {...budgets}
  };
}

function configDigest(value) {
  return createHash("sha256").update(canonicalCheckpointBytes(value)).digest("hex");
}

function evaluate(exportValue, expected = {}) {
  return evaluateMemecoinPaperRunExport(Buffer.from(JSON.stringify(exportValue)), {
    runId: exportValue.runId,
    configSha256: exportValue.configSha256,
    producerRevision: exportValue.producerRevision,
    ...expected
  });
}

async function produce(t, {
  fault = "NONE",
  runId = `actual-${fault.toLowerCase().replaceAll("_", "-")}`,
  startedAt = START,
  wallStart = startedAt + 5_000,
  budgets = BUDGETS
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "memecoin-export-e2e-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const runConfig = config(runId, {startedAt, budgets});
  const clock = createSyntheticClock({wallStart, monotonicStart: 100});
  const result = await createPaperPilotComposition({
    config: runConfig,
    dataDirectory: directory,
    clock,
    adapters: offlineFixtureAdapters({clock, fault})
  }).start();
  return {
    result,
    export: result.report,
    expected: {
      runId,
      configSha256: configDigest(runConfig),
      producerRevision: result.report.producerRevision
    },
    directory
  };
}

function check(result, id) {
  return result.checks.find(item => item.id === id);
}

function assertInvalidDto(result, expected) {
  assert.deepEqual(Object.keys(result).sort(), [
    "schema", "overall", "outcome", "lifecycleStatus", "persistence", "exportBinding",
    "identity", "evidence", "unresolved", "checks", "claims"
  ].sort());
  assert.equal(result.overall, "FAIL");
  assert.equal(result.outcome, "INVALID_EVIDENCE");
  assert.equal(result.lifecycleStatus, "UNKNOWN");
  assert.equal(result.persistence, "UNKNOWN");
  assert.equal(result.identity.runId, expected.runId);
  assert.equal(result.identity.configSha256, expected.configSha256);
  assert.equal(result.identity.producerRevision, expected.producerRevision);
  assert.equal(result.checks.some(item => item.status === "FAIL"), true);
}

test("actual zero-entry composition export verifies as a distinct complete run", async t => {
  const {result: run, export: runExport} = await produce(t, {fault: "NO_CANDIDATES"});
  const evaluation = evaluate(runExport);

  assert.equal(run.status, "FINISHED");
  assert.equal(run.strategyOutcome, "NO_CANDIDATES");
  assert.equal(runExport.runnerReport.reason, "SOURCES_EXHAUSTED");
  assert.equal(evaluation.overall, "PASS");
  assert.equal(evaluation.outcome, "ZERO_ENTRY_COMPLETE");
  assert.equal(evaluation.evidence.entryFills, 0);
  assert.equal(evaluation.evidence.exits, 0);
  assert.equal(evaluation.evidence.openPositions, 0);
  assert.equal(evaluation.evidence.reason, "SOURCES_EXHAUSTED");
  assert.deepEqual(evaluation.claims, {
    liveExecution: false, profitability: false, activation: false, sourceReadiness: false
  });
});

test("actual missing-evidence and missing-cost compositions never become paper fills", async t => {
  const {result: evidenceRun, export: evidenceExport} = await produce(t, {
    fault: "MISSING_EVIDENCE",
    runId: "actual-missing-evidence"
  });
  const evidenceEvaluation = evaluate(evidenceExport);
  assert.equal(evidenceRun.strategyOutcome, "BLOCKED");
  assert.equal(evidenceRun.report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry"), false);
  assert.equal(evidenceEvaluation.evidence.entryFills, 0);
  assert.equal(evidenceEvaluation.overall, "PASS");

  const {result: costRun, export: costExport} = await produce(t, {
    fault: "MISSING_COSTS",
    runId: "actual-missing-costs"
  });
  const costEvaluation = evaluate(costExport);
  assert.equal(costRun.strategyOutcome, "REJECT");
  assert.equal(costRun.report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry"), false);
  assert.equal(costRun.report.runnerReport.pendingAuthorizationIds.length, 1);
  assert.equal(costEvaluation.evidence.entryFills, 0);
  assert.equal(costEvaluation.overall, "UNKNOWN");
  assert.equal(check(costEvaluation, "pending_authorizations").status, "UNKNOWN");
});

test("actual entry/exit export verifies runner report, full checkpoint, and finish receipt", async t => {
  const {result: run, export: runExport} = await produce(t);
  const evaluation = evaluate(runExport);

  assert.equal(run.status, "FINISHED");
  assert.equal(evaluation.overall, "PASS");
  assert.equal(evaluation.outcome, "SIMULATED_ENTRY_EXIT_COMPLETE");
  assert.equal(evaluation.evidence.entryFills, 1);
  assert.equal(evaluation.evidence.exits, 1);
  assert.equal(evaluation.evidence.openPositions, 0);
  assert.deepEqual(runExport.runnerReport, run.report.runnerReport);
  assert.equal(runExport.checkpoint.sequence, runExport.runnerReport.terminalReceipt.sequence);
  assert.equal(check(evaluation, "terminal_receipt").status, "PASS");
  assert.equal(check(evaluation, "historical_run_binding").status, "PASS");
});

test("actual open unvalued positions remain UNKNOWN without fabricated terminal marks", async t => {
  const {result: run, export: runExport} = await produce(t, {fault: "NO_MARK"});
  const evaluation = evaluate(runExport);

  assert.equal(run.status, "FINISHED");
  assert.equal(run.terminalState.openPositions.length, 1);
  assert.equal(run.terminalState.equityCents, null);
  assert.equal(evaluation.overall, "UNKNOWN");
  assert.equal(evaluation.outcome, "OPEN_UNVALUED_TERMINAL_POSITION");
  assert.equal(evaluation.evidence.openPositions, 1);
  assert.equal(check(evaluation, "terminal_valuation").status, "UNKNOWN");
  assert.equal(runExport.runnerReport.terminalResult.openPositions[0].markStatus, "VALUATION_UNAVAILABLE");
});

test("actual deadline completion keeps the post-deadline finish time without backdating", async t => {
  const startedAt = START;
  const deadlineAt = startedAt + EIGHT_HOURS;
  const {result: run, export: runExport} = await produce(t, {
    fault: "LATE_DEADLINE",
    runId: "actual-late-deadline",
    startedAt,
    wallStart: deadlineAt - 10_000
  });
  const finishAt = runExport.checkpoint.records.at(-1).inputs.now;
  const evaluation = evaluate(runExport);
  const nonPassChecks = evaluation.checks.filter(item => item.status !== "PASS");

  assert.equal(run.status, "FINISHED");
  assert.equal(runExport.runnerReport.reason, "DEADLINE");
  assert.ok(finishAt > deadlineAt);
  assert.equal(evaluation.evidence.terminalAt, new Date(finishAt).toISOString());
  assert.ok(runExport.runnerReport.operationResults.some(item =>
    item.method === "riskSnapshot"), "a complete risk snapshot must precede the late acquisition");
  assert.equal(evaluation.overall, "PASS", JSON.stringify(nonPassChecks, null, 2));
  assert.equal(evaluation.outcome, "ZERO_ENTRY_COMPLETE");
  assert.equal(check(evaluation, "time_lifecycle").status, "PASS");
  assert.equal(check(evaluation, "deadline_reason").status, "PASS");
});

test("sequence-zero lost acknowledgement stays UNKNOWN and has no invented terminal receipt", async t => {
  const {result: run, export: runExport} = await produce(t, {
    fault: "LOST_INITIAL_ACK",
    runId: "actual-initial-ack-loss"
  });
  const evaluation = evaluate(runExport);

  assert.equal(run.status, "UNKNOWN");
  assert.equal(runExport.persistence, "UNKNOWN");
  assert.equal(runExport.runnerReport, null);
  assert.equal(runExport.runnerReport?.terminalReceipt, undefined);
  assert.equal(evaluation.overall, "UNKNOWN");
  assert.equal(evaluation.lifecycleStatus, "UNKNOWN");
  assert.equal(evaluation.persistence, "UNKNOWN");
  assert.equal(evaluation.evidence.terminalAt, null);
  assert.equal(check(evaluation, "terminal_receipt").status, "UNKNOWN");
  assert.equal(check(evaluation, "persistence").status, "UNKNOWN");
});

test("missing and tampered pre-start binding never pass based only on after-the-fact hashes", async t => {
  const {export: runExport} = await produce(t, {runId: "actual-binding-check"});
  const missing = structuredClone(runExport);
  missing.exportBinding = "EXPORT_ASSERTED";
  missing.bindingReceipt = null;
  const missingResult = evaluate(missing);
  assert.equal(missingResult.overall, "UNKNOWN");
  assert.equal(check(missingResult, "historical_run_binding").status, "UNKNOWN");

  const altered = structuredClone(runExport);
  altered.bindingReceipt.runId = "different-run";
  const alteredResult = evaluate(altered);
  assert.equal(alteredResult.overall, "FAIL");
  assert.equal(check(alteredResult, "historical_run_binding").status, "FAIL");
});

test("config, producer, and checkpoint tampering fail the actual export contract", async t => {
  const {export: runExport, expected} = await produce(t, {runId: "actual-tamper-check"});

  const changedConfig = structuredClone(runExport);
  changedConfig.config.runId = "different-run";
  assert.equal(evaluate(changedConfig).overall, "FAIL");
  assert.equal(check(evaluate(changedConfig), "config_binding").status, "FAIL");

  assert.equal(evaluate(runExport, {producerRevision: "paper-pilot-composition/999"}).overall, "FAIL");

  const changedCheckpoint = structuredClone(runExport);
  changedCheckpoint.checkpoint.records[1].inputs.now += 1;
  const checkpointEvaluation = evaluate(changedCheckpoint, expected);
  assert.equal(checkpointEvaluation.overall, "FAIL");
  assert.equal(check(checkpointEvaluation, "checkpoint_digest").status, "FAIL");
});

test("two actual open positions may reuse identical marks across risk and entry commands", async t => {
  const {export: runExport} = await produce(t, {
    fault: "TWO_OPEN_POSITIONS",
    runId: "actual-two-position-marks",
    budgets: {...BUDGETS, requests: 24, events: 256}
  });
  const evaluation = evaluate(runExport);
  const markUses = new Map();
  for (const record of runExport.checkpoint.records) {
    for (const mark of record.inputs?.marks ?? []) {
      markUses.set(mark.eventId, (markUses.get(mark.eventId) ?? 0) + 1);
    }
  }

  assert.equal(runExport.runnerReport.operationResults.filter(item =>
    item.method === "executeEntry" && item.status === "FILLED_PAPER").length, 2);
  assert.ok([...markUses.values()].some(count => count > 1));
  assert.equal(check(evaluation, "mark_reuse_consistency").status, "PASS");
  assert.equal(evaluation.evidence.openPositions, 2);
  assert.equal(evaluation.outcome, "OPEN_UNVALUED_TERMINAL_POSITION");

  const alteredMark = structuredClone(runExport);
  const occurrences = new Map();
  let modified = false;
  for (const record of alteredMark.checkpoint.records) {
    for (const mark of record.inputs?.marks ?? []) {
      const prior = occurrences.get(mark.eventId);
      if (prior && !modified) {
        mark.priceMicros += 1;
        modified = true;
      } else {
        occurrences.set(mark.eventId, mark);
      }
    }
  }
  assert.equal(modified, true);
  const alteredEvaluation = evaluate(alteredMark);
  assert.equal(check(alteredEvaluation, "mark_reuse_consistency").status, "FAIL");
});

test("malformed actual exports return complete invalid DTOs through API and JSON/Markdown CLI", async t => {
  const {export: runExport, expected, directory} = await produce(t, {
    fault: "NO_CANDIDATES",
    runId: "actual-cli-export"
  });
  const exportPath = path.join(directory, "run-export.json");
  await writeFile(exportPath, JSON.stringify(runExport), {flag: "wx"});
  const cliArgs = (filename, format) => [
    CLI, "--export", filename,
    "--run-id", expected.runId,
    "--config-sha256", expected.configSha256,
    "--producer-revision", expected.producerRevision,
    "--format", format
  ];
  const accepted = spawnSync(process.execPath, cliArgs(exportPath, "json"), {
    encoding: "utf8", timeout: 5_000
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).outcome, "ZERO_ENTRY_COMPLETE");

  const missingField = structuredClone(runExport);
  delete missingField.checkpointSha256;
  assertInvalidDto(evaluate(missingField), expected);

  const missingPath = path.join(directory, "missing-field.json");
  await writeFile(missingPath, JSON.stringify(missingField), {flag: "wx"});
  const missingJson = spawnSync(process.execPath, cliArgs(missingPath, "json"), {
    encoding: "utf8", timeout: 5_000
  });
  assert.equal(missingJson.status, 1, missingJson.stderr);
  assertInvalidDto(JSON.parse(missingJson.stdout), expected);

  const addedField = {...structuredClone(runExport), unexpectedField: true};
  assertInvalidDto(evaluate(addedField), expected);

  const addedPath = path.join(directory, "added-field.json");
  await writeFile(addedPath, JSON.stringify(addedField), {flag: "wx"});
  const addedMarkdown = spawnSync(process.execPath, cliArgs(addedPath, "markdown"), {
    encoding: "utf8", timeout: 5_000
  });
  assert.equal(addedMarkdown.status, 1, addedMarkdown.stderr);
  assert.match(addedMarkdown.stdout, /Overall evidence status: \*\*FAIL\*\*/);
  assert.match(addedMarkdown.stdout, /Outcome: \*\*INVALID_EVIDENCE\*\*/);
  assert.match(addedMarkdown.stdout, /actual-cli-export/);
  assert.equal(addedMarkdown.stderr, "");

  const fifo = path.join(directory, "export.fifo");
  execFileSync("mkfifo", [fifo]);
  const rejected = spawnSync(process.execPath, cliArgs(fifo, "json"), {
    encoding: "utf8",
    timeout: 5_000
  });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /regular file/);
  assert.deepEqual(JSON.parse(await readFile(exportPath, "utf8")), runExport);
});
