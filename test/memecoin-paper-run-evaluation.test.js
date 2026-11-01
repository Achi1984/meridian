import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {createRunConfig} from "../scripts/memecoin-paper/create-run-config.mjs";
import {
  EVALUATION_SCHEMA,
  evaluateObservation,
  MAX_INPUT_BYTES,
  renderEvaluationMarkdown
} from "../scripts/memecoin-paper-run-evaluation/index.mjs";
import {projectOperatorReport} from "../scripts/memecoin-paper/operator-report.mjs";
import {reportFixtures} from "./fixtures/memecoin-paper-operator-report/scenarios.mjs";

const RUN_ID = "observation-20261101-r1";
const START = Date.parse("2026-11-01T19:02:21.383Z");
const DURATION = 8 * 60 * 60 * 1000;
const MINT = "So11111111111111111111111111111111111111112";
const POOL = "11111111111111111111111111111112";
const QUOTE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CLI = fileURLToPath(new URL("../scripts/memecoin-paper-run-evaluation/index.mjs", import.meta.url));

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function bytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function reportRecord({runId = RUN_ID, configHash, elapsedMs = DURATION, providerAccounting} = {}) {
  const checkpoint = reportFixtures.readOnlyCheckpoint({
    results: [reportFixtures.receipt("finish", "finishRun", {status: "FINISHED", elapsedMs})]
  });
  checkpoint.metadata.runId = runId;
  checkpoint.metadata.startedAt = START;
  checkpoint.metadata.deadlineAt = START + DURATION;
  checkpoint.metadata.sequence = checkpoint.results.length;
  checkpoint.snapshot.summary.runId = runId;
  const dto = projectOperatorReport(checkpoint);
  return {
    runId,
    configHash,
    dto,
    observation: {
      providerAccounting: providerAccounting ?? {
        requests: 0,
        bytes: 0,
        providerEvents: 0,
        dexRequests: 0,
        rpcRequests: 0,
        candidates: 0
      },
      entryAuthorizations: 0,
      simulatedFills: 0,
      executableQuoteAndCostEvidence: "UNAVAILABLE",
      windowFinalization: {
        basis: "SETTLED_DEADLINE_EFFECTIVE_WINDOW_END",
        effectiveEndAt: START + DURATION,
        finalizedAt: START + DURATION + 500,
        latenessMs: 500
      }
    },
    text: "PAPER OPERATOR REPORT"
  };
}

function fixture({
  stopReason = "DEADLINE",
  status = "FINISHED",
  runId = RUN_ID,
  expectedRunId = RUN_ID,
  providerAccounting = {
    requests: 0,
    bytes: 0,
    providerEvents: 0,
    dexRequests: 0,
    rpcRequests: 0,
    candidates: 0
  },
  elapsedMs = DURATION
} = {}) {
  const config = createRunConfig({
    output: path.join(os.tmpdir(), "generated-run-config.json"),
    runId,
    startAt: START,
    mint: MINT,
    pool: POOL,
    quote: QUOTE
  });
  const configBytes = bytes(config);
  const configHash = createHash("sha256").update(configBytes).digest("hex");
  const lock = {
    version: 1,
    runId,
    configHash,
    startAt: START,
    endAt: START + DURATION,
    pid: 1,
    state: "STARTED"
  };
  const effectiveEndAt = stopReason === "OPERATOR_STOP" ? START + elapsedMs : START + DURATION;
  const terminal = {
    version: 1,
    runId,
    configHash,
    status,
    controllerStatus: status === "FINISHED" ? "FINISHED" : status,
    stopReason,
    failureCode: null,
    reportStatus: "PROJECTED",
    reportTradingStatus: "NO_ENTRY_OBSERVED",
    providerAccounting,
    observation: {
      windowFinalization: {
        basis: stopReason === "OPERATOR_STOP"
          ? "VALIDATED_ACTUAL_STOP_TIME" : "SETTLED_DEADLINE_EFFECTIVE_WINDOW_END",
        effectiveEndAt,
        finalizedAt: stopReason === "OPERATOR_STOP" ? effectiveEndAt : effectiveEndAt + 500,
        latenessMs: stopReason === "OPERATOR_STOP" ? 0 : 500
      },
      entryAuthorizations: 0,
      simulatedFills: 0,
      executableQuoteAndCostEvidence: "UNAVAILABLE"
    },
    observationOnly: true,
    executionStarted: false,
    terminalAt: new Date(effectiveEndAt + 500).toISOString()
  };
  const report = reportRecord({
    runId,
    configHash,
    elapsedMs: stopReason === "OPERATOR_STOP" ? elapsedMs : DURATION,
    providerAccounting
  });
  report.observation.windowFinalization = terminal.observation.windowFinalization;
  return {
    expectedRunId,
    expectedConfigHash: configHash,
    configBytes,
    lockBytes: bytes(lock),
    terminalBytes: bytes(terminal),
    reportBytes: bytes(report)
  };
}

function evaluate(options = {}) {
  return evaluateObservation(fixture(options));
}

function criterion(evaluation, id) {
  return evaluation.criteria.find(item => item.id === id);
}

test("full deadline evaluation is deterministic, evidence-bound, and never authorizes runtime", () => {
  const input = fixture();
  const first = evaluateObservation(input);
  const second = evaluateObservation(input);
  assert.equal(first.schema, EVALUATION_SCHEMA);
  assert.equal(first.overall, "UNKNOWN");
  assert.equal(first.observation.completionStatus, "PASS");
  assert.equal(first.observation.completionMode, "FULL_DEADLINE");
  assert.equal(first.observation.scheduledDurationMs, DURATION);
  assert.equal(first.observation.evidencedDurationMs, DURATION);
  assert.equal(criterion(first, "provider_accounting").status, "PASS");
  assert.equal(first.accounting.provider.requests, 0);
  assert.equal(first.accounting.paperEntryFills, 0);
  assert.match(first.accounting.note, /not profitability evidence/);
  assert.equal(first.hardGates.runtimeAuthorization, false);
  assert.equal(first.hardGates.simulatedTradeTestEligibility, false);
  assert.deepEqual(first, second);
  assert.equal(renderEvaluationMarkdown(first), renderEvaluationMarkdown(second));
  assert.match(renderEvaluationMarkdown(first), /No time-series samples/);
});

test("an early operator stop is accepted without being labeled a full deadline run", () => {
  const result = evaluate({
    stopReason: "OPERATOR_STOP",
    elapsedMs: 60 * 60 * 1000
  });
  assert.equal(result.observation.completionStatus, "PASS");
  assert.equal(result.observation.completionMode, "OPERATOR_STOP");
  assert.equal(result.observation.fullDeadlineCompleted, false);
  assert.equal(result.observation.evidencedDurationMs, 60 * 60 * 1000);
  assert.equal(criterion(result, "observation_duration").status, "UNKNOWN");
});

test("UNKNOWN and nonterminal markers never count as completed observations", () => {
  const unknown = evaluate({status: "UNKNOWN"});
  assert.equal(unknown.observation.completionStatus, "UNKNOWN");
  assert.notEqual(unknown.overall, "PASS");

  const nonterminal = evaluate({status: "RUNNING"});
  assert.equal(nonterminal.observation.completionStatus, "UNKNOWN");
  assert.notEqual(nonterminal.overall, "PASS");
});

test("run/config identity mismatches fail closed", () => {
  const wrongExpectedRun = evaluate({expectedRunId: "another-run"});
  assert.equal(criterion(wrongExpectedRun, "run_config_identity").status, "FAIL");

  const wrongExpectedConfig = fixture();
  wrongExpectedConfig.expectedConfigHash = "0".repeat(64);
  assert.equal(criterion(evaluateObservation(wrongExpectedConfig), "run_config_identity").status, "FAIL");

  const wrongRun = evaluate({runId: "another-run"});
  assert.equal(criterion(wrongRun, "run_config_identity").status, "FAIL");
  assert.notEqual(wrongRun.overall, "PASS");
});

test("malformed and oversized artifacts are bounded and reported as failures", () => {
  const valid = fixture();
  const malformed = evaluateObservation({...valid, terminalBytes: Buffer.from("{")});
  assert.equal(criterion(malformed, "artifact_integrity").status, "FAIL");
  assert.equal(criterion(malformed, "terminal_completion").status, "FAIL");

  const oversized = evaluateObservation({
    ...valid,
    reportBytes: new Uint8Array(MAX_INPUT_BYTES.report + 1)
  });
  assert.equal(criterion(oversized, "artifact_integrity").status, "FAIL");
  assert.equal(criterion(oversized, "operator_report").status, "FAIL");
  assert.notEqual(oversized.overall, "PASS");

  const nonCanonical = evaluateObservation({
    ...valid,
    lockBytes: Buffer.from(JSON.stringify(JSON.parse(valid.lockBytes.toString("utf8")), null, 2))
  });
  assert.equal(criterion(nonCanonical, "artifact_integrity").status, "FAIL");
});

test("missing and partial coverage stay UNKNOWN and uptime is never inferred", () => {
  const valid = fixture();
  const partial = JSON.parse(valid.reportBytes.toString("utf8"));
  partial.dto.evidence.coverage.audit.truncated = true;
  const result = evaluateObservation({...valid, reportBytes: bytes(partial)});
  assert.equal(criterion(result, "checkpoint_audit_coverage").status, "UNKNOWN");
  assert.equal(criterion(result, "time_series_coverage").status, "UNKNOWN");
  assert.equal(result.coverage.uptimeAndGaps, "UNAVAILABLE");

  const missing = evaluateObservation({...valid, reportBytes: undefined});
  assert.equal(criterion(missing, "operator_report").status, "UNKNOWN");
  assert.notEqual(missing.overall, "PASS");
});

test("provider totals distinguish zero from missing, reject mismatches, and retain exact integers", () => {
  const zero = evaluate();
  assert.equal(criterion(zero, "provider_accounting").status, "PASS");
  assert.equal(zero.accounting.provider.bytes, 0);

  const missingCounters = fixture();
  const missingReport = JSON.parse(missingCounters.reportBytes.toString("utf8"));
  delete missingReport.observation.providerAccounting.bytes;
  const missing = evaluateObservation({...missingCounters, reportBytes: bytes(missingReport)});
  assert.equal(criterion(missing, "provider_accounting").status, "UNKNOWN");

  const mismatchedCounters = fixture();
  const mismatchReport = JSON.parse(mismatchedCounters.reportBytes.toString("utf8"));
  mismatchReport.observation.providerAccounting.bytes = 1;
  const mismatch = evaluateObservation({...mismatchedCounters, reportBytes: bytes(mismatchReport)});
  assert.equal(criterion(mismatch, "provider_accounting").status, "FAIL");

  const exact = evaluate({
    providerAccounting: {
      requests: 960,
      bytes: 10_485_760,
      providerEvents: 960,
      dexRequests: 480,
      rpcRequests: 480,
      candidates: 0
    }
  });
  assert.equal(criterion(exact, "provider_accounting").status, "PASS");
  assert.equal(exact.accounting.provider.bytes, 10_485_760);

  const exactAmount = fixture();
  const exactAmountReport = JSON.parse(exactAmount.reportBytes.toString("utf8"));
  exactAmountReport.dto.valuation.cashCents = "900719925474099312345";
  const exactAmountResult = evaluateObservation({
    ...exactAmount,
    reportBytes: bytes(exactAmountReport)
  });
  assert.equal(exactAmountResult.accounting.cashCents, "900719925474099312345");
  assert.equal(JSON.parse(JSON.stringify(exactAmountResult)).accounting.cashCents,
    "900719925474099312345");

  const overBudget = evaluate({
    providerAccounting: {
      requests: 961,
      bytes: 1,
      providerEvents: 961,
      dexRequests: 480,
      rpcRequests: 481,
      candidates: 0
    }
  });
  assert.equal(criterion(overBudget, "provider_accounting").status, "FAIL");
});

test("CLI reads one bounded export set and writes only to an explicit output path", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-run-evaluation-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = fixture();
  const names = ["config", "lock", "terminal", "report"];
  const artifacts = [input.configBytes, input.lockBytes, input.terminalBytes, input.reportBytes];
  const files = {};
  for (const [index, name] of names.entries()) {
    files[name] = path.join(directory, `${name}.json`);
    await writeFile(files[name], artifacts[index]);
  }
  const output = path.join(directory, "evaluation.json");
  const result = spawnSync(process.execPath, [
    CLI,
    "--run-id", RUN_ID,
    "--config-sha256", input.expectedConfigHash,
    "--config", files.config,
    "--lock", files.lock,
    "--terminal", files.terminal,
    "--report", files.report,
    "--format", "json",
    "--output", output
  ], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const saved = JSON.parse(await readFile(output, "utf8"));
  assert.equal(saved.schema, EVALUATION_SCHEMA);
  assert.deepEqual((await readdir(directory)).sort(),
    ["config.json", "evaluation.json", "lock.json", "report.json", "terminal.json"]);
});
