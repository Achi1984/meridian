import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
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

function reportRecord({
  runId = RUN_ID,
  configHash,
  elapsedMs = DURATION,
  providerAccounting,
  candidateRejection = false
} = {}) {
  const checkpoint = reportFixtures.readOnlyCheckpoint({
    results: [reportFixtures.receipt("finish", "finishRun", {status: "FINISHED", elapsedMs})]
  });
  checkpoint.metadata.runId = runId;
  checkpoint.metadata.startedAt = START;
  checkpoint.metadata.deadlineAt = START + DURATION;
  checkpoint.metadata.sequence = checkpoint.results.length;
  checkpoint.snapshot.summary.runId = runId;
  const dto = projectOperatorReport(checkpoint);
  if (candidateRejection) {
    dto.candidates.rejected = 1;
    dto.candidates.detailsCoverage = {
      observedTotal: 1,
      total: 1,
      displayed: 1,
      displayTruncated: false,
      sourceTruncated: false,
      unaccounted: 0
    };
    dto.candidates.details = [{
      chainId: "solana",
      mint: MINT,
      pool: POOL,
      relatedPool: null,
      quote: QUOTE,
      sampledAt: new Date(START).toISOString(),
      status: "REJECT",
      reasons: [{
        gate: "liquidity",
        status: "REJECT",
        reason: "liquidity evidence was below the configured threshold",
        source: "caller export",
        observedAt: new Date(START).toISOString()
      }],
      reasonsCoverage: {
        observedTotal: 1,
        total: 1,
        displayed: 1,
        displayTruncated: false,
        sourceTruncated: false,
        unaccounted: 0
      }
    }];
  }
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
    terminalAt: effectiveEndAt + 500
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

test("finalization beyond the supported timestamp range cannot pass a deadline", () => {
  const input = fixture();
  const maxDate = 8_640_000_000_000_000;
  const config = JSON.parse(input.configBytes.toString("utf8"));
  config.startAt = maxDate - DURATION;
  config.endAt = maxDate;
  config.manifest.startAt = config.startAt;
  config.manifest.endAt = config.endAt;
  input.configBytes = bytes(config);
  const configHash = createHash("sha256").update(input.configBytes).digest("hex");
  input.expectedConfigHash = configHash;

  const lock = JSON.parse(input.lockBytes.toString("utf8"));
  lock.startAt = config.startAt;
  lock.endAt = config.endAt;
  lock.configHash = configHash;
  input.lockBytes = bytes(lock);

  const terminal = JSON.parse(input.terminalBytes.toString("utf8"));
  terminal.configHash = configHash;
  terminal.observation.windowFinalization = {
    basis: "SETTLED_DEADLINE_EFFECTIVE_WINDOW_END",
    effectiveEndAt: maxDate,
    finalizedAt: maxDate + 1,
    latenessMs: 1
  };
  input.terminalBytes = bytes(terminal);

  const report = JSON.parse(input.reportBytes.toString("utf8"));
  report.configHash = configHash;
  report.dto.experiment.startAt = new Date(config.startAt).toISOString();
  report.dto.experiment.endAt = new Date(config.endAt).toISOString();
  report.observation.windowFinalization = terminal.observation.windowFinalization;
  input.reportBytes = bytes(report);

  const result = evaluateObservation(input);
  assert.equal(criterion(result, "run_config_identity").status, "PASS");
  assert.equal(criterion(result, "observation_duration").status, "FAIL");
  assert.notEqual(result.observation.completionMode, "FULL_DEADLINE");
  assert.equal(result.observation.fullDeadlineCompleted, false);

  const late = fixture();
  const lateTerminal = JSON.parse(late.terminalBytes.toString("utf8"));
  const lateFinalization = lateTerminal.observation.windowFinalization;
  lateFinalization.finalizedAt += 60_001;
  lateFinalization.latenessMs = lateFinalization.finalizedAt - lateFinalization.effectiveEndAt;
  lateTerminal.terminalAt = lateFinalization.finalizedAt;
  late.terminalBytes = bytes(lateTerminal);
  const lateReport = JSON.parse(late.reportBytes.toString("utf8"));
  lateReport.observation.windowFinalization = lateFinalization;
  late.reportBytes = bytes(lateReport);
  const lateResult = evaluateObservation(late);
  assert.equal(criterion(lateResult, "terminal_completion").status, "PASS",
    JSON.stringify(criterion(lateResult, "terminal_completion")));
  assert.equal(criterion(lateResult, "observation_duration").status, "FAIL");
  assert.equal(lateResult.observation.completionMode, "INCONSISTENT");
  assert.equal(lateResult.observation.fullDeadlineCompleted, false);
});

test("UNKNOWN and nonterminal markers never count as completed observations", () => {
  const unknown = evaluate({status: "UNKNOWN"});
  assert.equal(unknown.observation.completionStatus, "UNKNOWN");
  assert.equal(unknown.observation.completionMode, "UNKNOWN");
  assert.equal(unknown.observation.fullDeadlineCompleted, false);
  assert.notEqual(unknown.overall, "PASS");

  const nonterminal = evaluate({status: "RUNNING"});
  assert.equal(nonterminal.observation.completionStatus, "UNKNOWN");
  assert.notEqual(nonterminal.overall, "PASS");
});

test("run/config identity mismatches fail closed", () => {
  const wrongExpectedRun = evaluate({expectedRunId: "another-run"});
  assert.equal(criterion(wrongExpectedRun, "run_config_identity").status, "FAIL");
  assert.equal(wrongExpectedRun.observation.completionStatus, "UNKNOWN");
  assert.equal(wrongExpectedRun.observation.completionMode, "UNKNOWN");
  assert.equal(wrongExpectedRun.observation.fullDeadlineCompleted, false);
  assert.equal(criterion(wrongExpectedRun, "observation_duration").status, "UNKNOWN");
  assert.equal(criterion(wrongExpectedRun, "provider_accounting").status, "UNKNOWN");

  const wrongExpectedConfig = fixture();
  wrongExpectedConfig.expectedConfigHash = "0".repeat(64);
  const wrongConfigResult = evaluateObservation(wrongExpectedConfig);
  assert.equal(criterion(wrongConfigResult, "run_config_identity").status, "FAIL");
  assert.equal(wrongConfigResult.observation.completionStatus, "UNKNOWN");

  const wrongRun = evaluate({runId: "another-run"});
  assert.equal(criterion(wrongRun, "run_config_identity").status, "FAIL");
  assert.notEqual(wrongRun.overall, "PASS");
});

test("malformed and oversized artifacts are bounded and reported as failures", () => {
  const valid = fixture();
  const malformed = evaluateObservation({...valid, terminalBytes: Buffer.from("{")});
  assert.equal(criterion(malformed, "artifact_integrity").status, "FAIL");
  assert.equal(criterion(malformed, "terminal_completion").status, "UNKNOWN");

  const oversized = evaluateObservation({
    ...valid,
    reportBytes: new Uint8Array(MAX_INPUT_BYTES.report + 1)
  });
  assert.equal(criterion(oversized, "artifact_integrity").status, "FAIL");
  assert.equal(criterion(oversized, "operator_report").status, "FAIL");
  assert.equal(oversized.coverage.inputDigests.report, null);
  assert.notEqual(oversized.overall, "PASS");

  const shadowedLength = new Uint8Array(MAX_INPUT_BYTES.report + 1);
  Object.defineProperty(shadowedLength, "byteLength", {value: 1});
  const shadowedOversize = evaluateObservation({...valid, reportBytes: shadowedLength});
  assert.equal(criterion(shadowedOversize, "artifact_integrity").status, "FAIL");
  assert.equal(shadowedOversize.coverage.inputDigests.report, null);

  const nonCanonical = evaluateObservation({
    ...valid,
    lockBytes: Buffer.from(JSON.stringify(JSON.parse(valid.lockBytes.toString("utf8")), null, 2))
  });
  assert.equal(criterion(nonCanonical, "artifact_integrity").status, "FAIL");

  const outOfRange = fixture();
  const config = JSON.parse(outOfRange.configBytes.toString("utf8"));
  config.startAt = 8_640_000_000_000_001;
  config.endAt = config.startAt + DURATION;
  config.manifest.startAt = config.startAt;
  config.manifest.endAt = config.endAt;
  assert.doesNotThrow(() => {
    const invalidTime = evaluateObservation({...outOfRange, configBytes: bytes(config)});
    assert.equal(criterion(invalidTime, "run_config_identity").status, "FAIL");
    assert.equal(criterion(invalidTime, "observation_duration").status, "UNKNOWN");
  });
});

test("malformed and out-of-range config timestamps return structured pure and CLI results", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-run-evaluation-dates-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = fixture();
  const files = {};
  for (const [name, content] of Object.entries({
    config: input.configBytes,
    lock: input.lockBytes,
    terminal: input.terminalBytes,
    report: input.reportBytes
  })) {
    files[name] = path.join(directory, `${name}.json`);
    await writeFile(files[name], content);
  }

  const malformed = JSON.parse(input.configBytes.toString("utf8"));
  malformed.startAt = "not-a-timestamp";
  malformed.manifest.startAt = malformed.startAt;
  const outOfRange = JSON.parse(input.configBytes.toString("utf8"));
  outOfRange.startAt = 8_640_000_000_000_001;
  outOfRange.endAt = outOfRange.startAt + DURATION;
  outOfRange.manifest.startAt = outOfRange.startAt;
  outOfRange.manifest.endAt = outOfRange.endAt;

  for (const config of [malformed, outOfRange]) {
    const configBytes = bytes(config);
    const pureResult = evaluateObservation({...input, configBytes});
    assert.equal(criterion(pureResult, "run_config_identity").status, "FAIL");
    assert.equal(criterion(pureResult, "observation_duration").status, "UNKNOWN");
    assert.equal(pureResult.observation.completionStatus, "UNKNOWN");
    assert.equal(pureResult.observation.fullDeadlineCompleted, false);

    await writeFile(files.config, configBytes);
    const cliResult = spawnSync(process.execPath, [
      CLI,
      "--run-id", RUN_ID,
      "--config-sha256", input.expectedConfigHash,
      "--config", files.config,
      "--lock", files.lock,
      "--terminal", files.terminal,
      "--report", files.report
    ], {encoding: "utf8", timeout: 1_000});
    assert.equal(cliResult.error, undefined);
    assert.equal(cliResult.status, 0, cliResult.stderr);
    const evaluation = JSON.parse(cliResult.stdout);
    assert.equal(criterion(evaluation, "run_config_identity").status, "FAIL");
    assert.equal(criterion(evaluation, "observation_duration").status, "UNKNOWN");
    assert.equal(evaluation.observation.completionStatus, "UNKNOWN");
    assert.equal(evaluation.observation.fullDeadlineCompleted, false);
  }
});

test("missing and partial coverage stay UNKNOWN and uptime is never inferred", () => {
  const valid = fixture();
  const partial = JSON.parse(valid.reportBytes.toString("utf8"));
  partial.dto.evidence.coverage.audit.truncated = true;
  const result = evaluateObservation({...valid, reportBytes: bytes(partial)});
  assert.equal(criterion(result, "checkpoint_audit_coverage").status, "UNKNOWN");
  assert.equal(criterion(result, "time_series_coverage").status, "UNKNOWN");
  assert.equal(result.coverage.uptimeAndGaps, "UNAVAILABLE");

  const componentTruncated = JSON.parse(valid.reportBytes.toString("utf8"));
  componentTruncated.dto.evidence.coverage.audit.truncated = false;
  componentTruncated.dto.evidence.coverage.audit.replayLoggerTruncated = true;
  const componentResult = evaluateObservation({
    ...valid,
    reportBytes: bytes(componentTruncated)
  });
  assert.equal(criterion(componentResult, "checkpoint_audit_coverage").status, "UNKNOWN");

  const missing = evaluateObservation({...valid, reportBytes: undefined});
  assert.equal(criterion(missing, "operator_report").status, "UNKNOWN");
  assert.notEqual(missing.overall, "PASS");
});

test("candidate rejection reasons are preserved without manufacturing rejected counts", () => {
  const input = fixture();
  const report = JSON.parse(input.reportBytes.toString("utf8"));
  const replaced = reportRecord({
    runId: RUN_ID,
    configHash: input.expectedConfigHash,
    candidateRejection: true
  });
  input.reportBytes = bytes(replaced);
  const result = evaluateObservation(input);
  assert.deepEqual(result.checkpointEvidence.rejectionReasons, [{
    mint: MINT,
    gate: "liquidity",
    reason: "liquidity evidence was below the configured threshold"
  }]);
  assert.equal(result.checkpointEvidence.candidates.length, 1);
  assert.equal(result.accounting.paperEntryFills, 0);
  assert.equal(report.runId, RUN_ID);

  const mismatchedRows = JSON.parse(input.reportBytes.toString("utf8"));
  mismatchedRows.dto.candidates.detailsCoverage.displayed = 0;
  const inconsistent = evaluateObservation({...input, reportBytes: bytes(mismatchedRows)});
  assert.equal(criterion(inconsistent, "candidate_detail_coverage").status, "FAIL");

  const malformedRows = JSON.parse(input.reportBytes.toString("utf8"));
  malformedRows.dto.candidates.details[0] = {};
  const malformed = evaluateObservation({...input, reportBytes: bytes(malformedRows)});
  assert.equal(criterion(malformed, "candidate_detail_coverage").status, "FAIL");

  const discoveryTruncated = JSON.parse(input.reportBytes.toString("utf8"));
  discoveryTruncated.dto.candidates.scoutAuditTruncated = true;
  const truncatedResult = evaluateObservation({...input, reportBytes: bytes(discoveryTruncated)});
  assert.equal(criterion(truncatedResult, "candidate_detail_coverage").status, "UNKNOWN");

  const invalidDateRows = JSON.parse(input.reportBytes.toString("utf8"));
  invalidDateRows.dto.candidates.details[0].sampledAt = "not-a-date";
  const invalidDate = evaluateObservation({...input, reportBytes: bytes(invalidDateRows)});
  assert.equal(criterion(invalidDate, "candidate_detail_coverage").status, "FAIL");

  const inconsistentSummary = JSON.parse(input.reportBytes.toString("utf8"));
  inconsistentSummary.dto.candidates.considered = 0;
  const inconsistentCounts = evaluateObservation({...input, reportBytes: bytes(inconsistentSummary)});
  assert.equal(criterion(inconsistentCounts, "candidate_detail_coverage").status, "FAIL");
});

test("Markdown rendering neutralizes untrusted image and link syntax", () => {
  const input = fixture();
  const report = reportRecord({
    configHash: input.expectedConfigHash,
    candidateRejection: true
  });
  report.dto.candidates.details[0].reasons[0].reason =
    "![x](https://example.invalid/track)";
  input.reportBytes = bytes(report);
  const markdown = renderEvaluationMarkdown(evaluateObservation(input));
  assert.doesNotMatch(markdown, /!\[x\]\(https:\/\/example\.invalid\/track\)/);
  assert.ok(markdown.includes("\\!\\[x\\]\\(https://example.invalid/track\\)"));
});

test("terminal observation activity cannot conflict with a zero-activity report", () => {
  const input = fixture();
  const terminal = JSON.parse(input.terminalBytes.toString("utf8"));
  terminal.observation.simulatedFills = 1;
  const result = evaluateObservation({...input, terminalBytes: bytes(terminal)});
  assert.equal(criterion(result, "terminal_completion").status, "FAIL");
  assert.notEqual(result.overall, "PASS");

  const reportActivity = fixture();
  const report = JSON.parse(reportActivity.reportBytes.toString("utf8"));
  report.dto.trading.paperEntryFills = 1;
  report.dto.trading.status = "TRADES_RECORDED";
  reportActivity.reportBytes = bytes(report);
  const reportConflict = evaluateObservation(reportActivity);
  assert.equal(criterion(reportConflict, "terminal_completion").status, "FAIL");

  const unsupportedTradingStatus = fixture();
  const unsupportedReport = JSON.parse(unsupportedTradingStatus.reportBytes.toString("utf8"));
  unsupportedReport.dto.trading.status = "UNRECOGNIZED";
  unsupportedTradingStatus.reportBytes = bytes(unsupportedReport);
  const unsupportedTerminal = JSON.parse(unsupportedTradingStatus.terminalBytes.toString("utf8"));
  unsupportedTerminal.reportTradingStatus = "UNRECOGNIZED";
  unsupportedTradingStatus.terminalBytes = bytes(unsupportedTerminal);
  assert.equal(criterion(evaluateObservation(unsupportedTradingStatus),
    "terminal_completion").status, "FAIL");

  const statusConflict = fixture();
  const statusTerminal = JSON.parse(statusConflict.terminalBytes.toString("utf8"));
  statusTerminal.reportTradingStatus = "UNKNOWN";
  statusConflict.terminalBytes = bytes(statusTerminal);
  const reportStatusConflict = evaluateObservation(statusConflict);
  assert.equal(criterion(reportStatusConflict, "terminal_completion").status, "FAIL");

  const missingFillCount = fixture();
  const missingFillReport = JSON.parse(missingFillCount.reportBytes.toString("utf8"));
  delete missingFillReport.dto.trading.paperEntryFills;
  missingFillReport.dto.trading.status = "UNKNOWN";
  missingFillCount.reportBytes = bytes(missingFillReport);
  const missingFillTerminal = JSON.parse(missingFillCount.terminalBytes.toString("utf8"));
  missingFillTerminal.reportTradingStatus = "UNKNOWN";
  missingFillCount.terminalBytes = bytes(missingFillTerminal);
  const unknownFillCount = evaluateObservation(missingFillCount);
  assert.equal(criterion(unknownFillCount, "terminal_completion").status, "FAIL");
  assert.notEqual(unknownFillCount.overall, "PASS");
});

test("completion requires a finished report DTO and a coherent epoch terminal timestamp", () => {
  const incomplete = fixture();
  const incompleteReport = JSON.parse(incomplete.reportBytes.toString("utf8"));
  incompleteReport.dto.experiment.reportStatus = "INCOMPLETE";
  incomplete.reportBytes = bytes(incompleteReport);
  const incompleteResult = evaluateObservation(incomplete);
  assert.equal(criterion(incompleteResult, "operator_report").status, "UNKNOWN");
  assert.equal(criterion(incompleteResult, "terminal_completion").status, "FAIL");

  for (const section of ["evidence", "candidates", "controls", "valuation", "costs"]) {
    const incompleteDto = fixture();
    const report = JSON.parse(incompleteDto.reportBytes.toString("utf8"));
    delete report.dto[section];
    incompleteDto.reportBytes = bytes(report);
    const result = evaluateObservation(incompleteDto);
    assert.equal(criterion(result, "operator_report").status, "FAIL", section);
    assert.equal(criterion(result, "terminal_completion").status, "FAIL", section);
  }
  const missingAccountingValue = fixture();
  const missingAccountingReport = JSON.parse(missingAccountingValue.reportBytes.toString("utf8"));
  delete missingAccountingReport.dto.valuation.cashCents;
  missingAccountingValue.reportBytes = bytes(missingAccountingReport);
  const missingAccountingResult = evaluateObservation(missingAccountingValue);
  assert.equal(criterion(missingAccountingResult, "operator_report").status, "FAIL");
  assert.equal(criterion(missingAccountingResult, "terminal_completion").status, "FAIL");

  const missingTimestamp = fixture();
  const missingTerminal = JSON.parse(missingTimestamp.terminalBytes.toString("utf8"));
  delete missingTerminal.terminalAt;
  missingTimestamp.terminalBytes = bytes(missingTerminal);
  const missingTimestampResult = evaluateObservation(missingTimestamp);
  assert.equal(criterion(missingTimestampResult, "terminal_completion").status, "UNKNOWN");

  const invalidFinalization = fixture();
  const invalidTerminal = JSON.parse(invalidFinalization.terminalBytes.toString("utf8"));
  const invalidReport = JSON.parse(invalidFinalization.reportBytes.toString("utf8"));
  invalidTerminal.observation.windowFinalization.finalizedAt = "not-an-epoch";
  invalidReport.observation.windowFinalization.finalizedAt = "not-an-epoch";
  invalidFinalization.terminalBytes = bytes(invalidTerminal);
  invalidFinalization.reportBytes = bytes(invalidReport);
  const invalidFinalizationResult = evaluateObservation(invalidFinalization);
  assert.equal(criterion(invalidFinalizationResult, "terminal_completion").status, "FAIL");
  assert.equal(criterion(invalidFinalizationResult, "observation_duration").status, "FAIL");

  const earlierTimestamp = fixture();
  const earlierTerminal = JSON.parse(earlierTimestamp.terminalBytes.toString("utf8"));
  earlierTerminal.terminalAt = earlierTerminal.observation.windowFinalization.finalizedAt - 1;
  earlierTimestamp.terminalBytes = bytes(earlierTerminal);
  const earlierTimestampResult = evaluateObservation(earlierTimestamp);
  assert.equal(criterion(earlierTimestampResult, "terminal_completion").status, "FAIL");
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

  const inconsistentRequests = evaluate({
    providerAccounting: {
      requests: 2,
      bytes: 10,
      providerEvents: 2,
      dexRequests: 1,
      rpcRequests: 0,
      candidates: 0
    }
  });
  assert.equal(criterion(inconsistentRequests, "provider_accounting").status, "FAIL");

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

  const candidateOverBudget = evaluate({
    providerAccounting: {
      requests: 0,
      bytes: 0,
      providerEvents: 0,
      dexRequests: 0,
      rpcRequests: 0,
      candidates: 161
    }
  });
  assert.equal(criterion(candidateOverBudget, "provider_accounting").status, "FAIL");
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

test("CLI rejects symlink and FIFO inputs without blocking", async t => {
  if (process.platform !== "linux") {
    t.skip("O_NONBLOCK and O_NOFOLLOW input checks are Linux-specific");
    return;
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-run-evaluation-special-input-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const input = fixture();
  const paths = {};
  for (const [name, content] of Object.entries({
    config: input.configBytes,
    lock: input.lockBytes,
    terminal: input.terminalBytes,
    report: input.reportBytes
  })) {
    paths[name] = path.join(directory, `${name}.json`);
    await writeFile(paths[name], content);
  }
  const args = configPath => [
    CLI,
    "--run-id", RUN_ID,
    "--config-sha256", input.expectedConfigHash,
    "--config", configPath,
    "--lock", paths.lock,
    "--terminal", paths.terminal,
    "--report", paths.report
  ];

  const linkPath = path.join(directory, "config-link.json");
  await symlink(paths.config, linkPath);
  const symlinkResult = spawnSync(process.execPath, args(linkPath), {encoding: "utf8", timeout: 1_000});
  assert.equal(symlinkResult.error, undefined);
  assert.notEqual(symlinkResult.status, 0);

  const fifoPath = path.join(directory, "config.fifo");
  execFileSync("mkfifo", [fifoPath]);
  const fifoResult = spawnSync(process.execPath, args(fifoPath), {encoding: "utf8", timeout: 1_000});
  assert.equal(fifoResult.error, undefined);
  assert.notEqual(fifoResult.status, 0);
  assert.match(fifoResult.stderr, /regular file/);
});

test("importing the evaluator does not invoke its CLI or emit output", () => {
  const child = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(pathToFileURL(CLI).href)})`
  ], {encoding: "utf8"});
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
});
