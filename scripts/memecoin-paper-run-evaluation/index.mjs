import {createHash} from "node:crypto";
import {open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const EVALUATION_SCHEMA = "MEMECOIN_PAPER_RUN_EVALUATION_V1";
export const MAX_INPUT_BYTES = Object.freeze({
  config: 64 * 1024,
  lock: 16 * 1024,
  terminal: 16 * 1024,
  report: 256 * 1024
});

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const MAX_DEADLINE_FINALIZATION_DELAY_MS = 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const INPUT_NAMES = Object.keys(MAX_INPUT_BYTES);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("unsafe JSON number");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new TypeError("unsupported JSON value");
  return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArtifact(input, name) {
  if (input === undefined || input === null) {
    return {status: "MISSING", reason: "artifact bytes were not supplied", value: null, digest: null};
  }
  if (!(input instanceof Uint8Array)) {
    return {status: "INVALID", reason: "artifact must be supplied as exported bytes", value: null, digest: null};
  }
  const bytes = Buffer.from(input);
  const digest = sha256(bytes);
  if (bytes.byteLength > MAX_INPUT_BYTES[name]) {
    return {status: "INVALID", reason: "artifact exceeds its byte limit", value: null, digest};
  }
  try {
    const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    const value = JSON.parse(text);
    if (!isRecord(value) || canonicalJson(value) !== text) {
      throw new TypeError("artifact must be a canonical JSON object");
    }
    return {status: "VALID", reason: null, value, digest};
  } catch {
    return {status: "INVALID", reason: "artifact is malformed or not canonical JSON", value: null, digest};
  }
}

function artifactStatus(artifacts) {
  if (Object.values(artifacts).some(item => item.status === "INVALID")) return "FAIL";
  if (Object.values(artifacts).some(item => item.status === "MISSING")) return "UNKNOWN";
  return "PASS";
}

function identityArtifactStatus(artifacts) {
  if (Object.values(artifacts).some(item => item.status === "INVALID")) return "FAIL";
  if (Object.values(artifacts).some(item => item.status === "MISSING")) return "UNKNOWN";
  return "PASS";
}

function validConfig(config, expectedRunId) {
  const startAt = config?.startAt;
  const endAt = config?.endAt;
  const manifest = config?.manifest;
  return config?.version === 1 && config.mode === "READ_ONLY_PAPER" &&
    config.runId === expectedRunId && Number.isSafeInteger(startAt) && startAt > 0 &&
    Number.isSafeInteger(endAt) && endAt - startAt === EIGHT_HOURS_MS &&
    isRecord(manifest) && manifest.enabled === true && manifest.mode === "READ_ONLY_PAPER" &&
    manifest.execution === "SIMULATED_ONLY" && manifest.runId === expectedRunId &&
    manifest.startAt === startAt && manifest.endAt === endAt &&
    manifest.durationMs === EIGHT_HOURS_MS && manifest.stopSwitch?.engaged === false &&
    manifest.http?.credentials === false && manifest.http?.redirects === "error" &&
    manifest.http?.arbitraryUrls === false && manifest.http?.tokenProvidedUrls === false;
}

function makeCriterion(id, status, reason, details = {}) {
  return {id, status, reason, ...details};
}

function coverageStatus(report) {
  const audit = report?.dto?.evidence?.coverage?.audit;
  if (!isRecord(audit) || audit.present !== true) {
    return makeCriterion("checkpoint_audit_coverage", "UNKNOWN",
      "The report does not establish a complete checkpoint audit export.");
  }
  if (audit.truncated === true) {
    return makeCriterion("checkpoint_audit_coverage", "UNKNOWN",
      "The exported checkpoint audit is explicitly truncated.");
  }
  const counts = [
    audit.observedRows, audit.totalRows, audit.ledgerEventsReported, audit.ledgerEventsAudited
  ];
  if (audit.truncated !== false || counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
    return makeCriterion("checkpoint_audit_coverage", "UNKNOWN",
      "Checkpoint audit completeness counters are missing or unavailable.");
  }
  if (audit.observedRows > audit.totalRows || audit.ledgerEventsAudited > audit.ledgerEventsReported) {
    return makeCriterion("checkpoint_audit_coverage", "FAIL",
      "Checkpoint audit counters contradict the reported totals.");
  }
  if (audit.observedRows !== audit.totalRows ||
      audit.ledgerEventsReported !== audit.ledgerEventsAudited) {
    return makeCriterion("checkpoint_audit_coverage", "UNKNOWN",
      "Checkpoint audit coverage is partial.");
  }
  return makeCriterion("checkpoint_audit_coverage", "PASS",
    "The report declares complete audit coverage and reconciled ledger-event counts.");
}

function providerAccountingStatus(terminal, report, config) {
  const terminalTotals = terminal?.providerAccounting;
  const reportTotals = report?.observation?.providerAccounting;
  if (!isRecord(terminalTotals) || !isRecord(reportTotals)) {
    return makeCriterion("provider_accounting", "UNKNOWN",
      "Provider accounting is missing from the terminal marker or report.");
  }
  const keys = ["requests", "bytes", "providerEvents", "dexRequests", "rpcRequests", "candidates"];
  if (keys.some(key => !Object.hasOwn(terminalTotals, key) || !Object.hasOwn(reportTotals, key))) {
    return makeCriterion("provider_accounting", "UNKNOWN",
      "One or more provider counters are absent; absent counters are not treated as zero.");
  }
  if (keys.some(key => !Number.isSafeInteger(terminalTotals[key]) || terminalTotals[key] < 0 ||
      !Number.isSafeInteger(reportTotals[key]) || reportTotals[key] < 0)) {
    return makeCriterion("provider_accounting", "FAIL",
      "Provider counters must be non-negative safe integers.");
  }
  if (keys.some(key => terminalTotals[key] !== reportTotals[key])) {
    return makeCriterion("provider_accounting", "FAIL",
      "Terminal and operator-report provider counters do not match.");
  }
  const requestSum = terminalTotals.dexRequests + terminalTotals.rpcRequests;
  if (!Number.isSafeInteger(requestSum) || requestSum !== terminalTotals.requests ||
      terminalTotals.providerEvents !== terminalTotals.requests) {
    return makeCriterion("provider_accounting", "FAIL",
      "Provider requests, provider events, and per-provider requests do not reconcile.");
  }
  const budgets = config?.budgets;
  const budgetPairs = [
    ["requests", "requests"],
    ["bytes", "bytes"],
    ["providerEvents", "providerEvents"],
    ["dexRequests", "dexRequests"],
    ["rpcRequests", "rpcRequests"]
  ];
  if (!isRecord(budgets) || budgetPairs.some(([total, budget]) =>
    !Number.isSafeInteger(budgets[budget]) || budgets[budget] < 0)) {
    return makeCriterion("provider_accounting", "UNKNOWN",
      "Provider accounting budgets are unavailable in the supplied run config.");
  }
  if (budgetPairs.some(([total, budget]) => terminalTotals[total] > budgets[budget])) {
    return makeCriterion("provider_accounting", "FAIL",
      "Provider accounting exceeds one or more configured request or byte budgets.");
  }
  return makeCriterion("provider_accounting", "PASS",
    "Terminal and report accounting match and request/event totals reconcile.",
    {totals: Object.fromEntries(keys.map(key => [key, terminalTotals[key]]))});
}

function evaluateDuration(config, terminal, report) {
  const observation = terminal?.observation;
  const finalization = observation?.windowFinalization;
  if (!isRecord(finalization)) {
    return {
      criterion: makeCriterion("observation_duration", "UNKNOWN",
        "No validated window-finalization evidence is present."),
      completionMode: "UNKNOWN",
      scheduledMs: EIGHT_HOURS_MS,
      evidencedMs: null
    };
  }
  const {startAt, endAt} = config;
  const {effectiveEndAt, finalizedAt, latenessMs, basis} = finalization;
  if (![effectiveEndAt, finalizedAt, latenessMs].every(Number.isSafeInteger) ||
      latenessMs < 0 || effectiveEndAt < startAt || effectiveEndAt > endAt ||
      finalizedAt < effectiveEndAt ||
      report?.dto?.experiment?.startAt !== new Date(startAt).toISOString() ||
      report?.dto?.experiment?.endAt !== new Date(effectiveEndAt).toISOString()) {
    return {
      criterion: makeCriterion("observation_duration", "FAIL",
        "Run bounds, report timestamps, and finalization evidence are inconsistent."),
      completionMode: "INCONSISTENT",
      scheduledMs: endAt - startAt,
      evidencedMs: null
    };
  }
  if (terminal.stopReason === "DEADLINE") {
    const validDeadline = basis === "SETTLED_DEADLINE_EFFECTIVE_WINDOW_END" &&
      effectiveEndAt === endAt && latenessMs <= MAX_DEADLINE_FINALIZATION_DELAY_MS &&
      finalizedAt - effectiveEndAt === latenessMs;
    return {
      criterion: makeCriterion("observation_duration", validDeadline ? "PASS" : "FAIL",
        validDeadline
          ? "The evidenced window reaches the configured deadline."
          : "Deadline stop does not reconcile to the full configured window."),
      completionMode: "FULL_DEADLINE",
      scheduledMs: endAt - startAt,
      evidencedMs: effectiveEndAt - startAt
    };
  }
  if (terminal.stopReason === "OPERATOR_STOP") {
    const validStop = basis === "VALIDATED_ACTUAL_STOP_TIME" &&
      effectiveEndAt === finalizedAt && finalizedAt <= endAt && latenessMs === 0;
    const evidencedMs = validStop ? effectiveEndAt - startAt : null;
    return {
      criterion: makeCriterion("observation_duration",
        validStop && evidencedMs === endAt - startAt ? "PASS" : validStop ? "UNKNOWN" : "FAIL",
        !validStop
          ? "Operator-stop timing is inconsistent with the configured observation window."
          : evidencedMs === endAt - startAt
            ? "Operator stop occurred at the scheduled end."
            : "A valid early operator stop is accepted as a completed stop, not a full-deadline run."),
      completionMode: "OPERATOR_STOP",
      scheduledMs: endAt - startAt,
      evidencedMs
    };
  }
  return {
    criterion: makeCriterion("observation_duration", "UNKNOWN",
      "The stop reason does not establish either a deadline or accepted operator stop."),
    completionMode: "UNKNOWN",
    scheduledMs: endAt - startAt,
    evidencedMs: effectiveEndAt - startAt
  };
}

function reportStatus(report, expectedRunId, configHash) {
  const dto = report?.dto;
  const experiment = dto?.experiment;
  if (!isRecord(report) || !isRecord(dto) || dto.schema !== "MEMECOIN_PAPER_OPERATOR_REPORT_V1" ||
      !isRecord(experiment) || typeof report.text !== "string") {
    return makeCriterion("operator_report", "FAIL", "Persisted operator-report record is malformed.");
  }
  if (report.runId !== expectedRunId || report.configHash !== configHash ||
      experiment.id !== expectedRunId) {
    return makeCriterion("operator_report", "FAIL",
      "Persisted report identity does not match the expected run and configuration.");
  }
  if (experiment.source !== "READ_ONLY_PAPER_CHECKPOINT" ||
      experiment.evidenceKind !== "READ_ONLY_PAPER_CHECKPOINT_RECEIPTS" ||
      experiment.sourceProvenance !== "CALLER_LABEL_ONLY_NOT_AUTHENTICATED") {
    return makeCriterion("operator_report", "FAIL",
      "Report is not the persisted read-only checkpoint report contract.");
  }
  if (experiment.reportStatus !== "FINISHED") {
    return makeCriterion("operator_report", "UNKNOWN",
      "The operator report does not declare a finished observation.");
  }
  return makeCriterion("operator_report", "PASS",
    "Persisted report schema, source label, and run/config identity match.");
}

function identityStatus(expectedRunId, expectedConfigHash, artifacts, configHash) {
  const artifactCheck = identityArtifactStatus(artifacts);
  if (artifactCheck !== "PASS") {
    return makeCriterion("run_config_identity", artifactCheck,
      artifactCheck === "FAIL"
        ? "One or more required identity artifacts are corrupt or oversized."
        : "One or more required identity artifacts are missing.");
  }
  const {config, lock, terminal, report} = Object.fromEntries(
    Object.entries(artifacts).map(([name, item]) => [name, item.value])
  );
  if (!SAFE_ID.test(expectedRunId) || !SHA256.test(expectedConfigHash) ||
      expectedConfigHash !== configHash || !isRecord(config) || !isRecord(lock) ||
      !isRecord(terminal) || !isRecord(report) || !isRecord(report.dto) ||
      !isRecord(report.dto.experiment) || !validConfig(config, expectedRunId) ||
      lock.version !== 1 || lock.runId !== expectedRunId || lock.configHash !== configHash ||
      lock.startAt !== config.startAt || lock.endAt !== config.endAt ||
      !Number.isSafeInteger(lock.pid) || lock.pid < 1 || lock.state !== "STARTED" ||
      terminal.version !== 1 || terminal.runId !== expectedRunId ||
      terminal.configHash !== configHash ||
      report.runId !== expectedRunId || report.configHash !== configHash ||
      report.dto?.experiment?.id !== expectedRunId) {
    return makeCriterion("run_config_identity", "FAIL",
      "Expected run ID, validated eight-hour config, durable lock, terminal, and report do not bind to one config hash.");
  }
  return makeCriterion("run_config_identity", "PASS",
    "Expected run ID and SHA-256 config identity match across all persisted artifacts.",
    {configHash});
}

function terminalStatus(terminal, report) {
  if (!terminal) {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "No terminal marker is available.");
  }
  if (terminal.status === "UNKNOWN") {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "The persisted terminal marker is explicitly UNKNOWN.");
  }
  if (terminal.status !== "FINISHED") {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "The persisted status does not establish a terminal FINISHED run.");
  }
  if (terminal.controllerStatus === "UNKNOWN" || terminal.controllerStatus === "NOT_STARTED" ||
      terminal.stopReason === "UNKNOWN" || terminal.reportStatus === "UNKNOWN") {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "Controller, stop reason, or report projection remains unknown.");
  }
  if (terminal.controllerStatus !== "FINISHED" ||
      !["DEADLINE", "OPERATOR_STOP"].includes(terminal.stopReason) ||
      terminal.failureCode !== null || terminal.reportStatus !== "PROJECTED" ||
      terminal.observationOnly !== true || terminal.executionStarted !== false ||
      report?.observation?.entryAuthorizations !== 0 ||
      report?.observation?.simulatedFills !== 0 ||
      report?.observation?.executableQuoteAndCostEvidence !== "UNAVAILABLE") {
    return makeCriterion("terminal_completion", "FAIL",
      "Terminal status, stop reason, report projection, or observation-only invariants conflict.");
  }
  return makeCriterion("terminal_completion", "PASS",
    terminal.stopReason === "DEADLINE"
      ? "Run finished at its deadline without an observed execution path."
      : "Run finished by an evidenced operator stop without an observed execution path.",
    {completionMode: terminal.stopReason === "DEADLINE" ? "FULL_DEADLINE" : "OPERATOR_STOP"});
}

function candidateRows(report) {
  const rows = report?.dto?.candidates?.details;
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({
    mint: typeof row?.mint === "string" ? row.mint : null,
    status: typeof row?.status === "string" ? row.status : "UNKNOWN",
    reasons: Array.isArray(row?.reasons) ? row.reasons.map(reason => ({
      gate: typeof reason?.gate === "string" ? reason.gate : "UNKNOWN",
      status: typeof reason?.status === "string" ? reason.status : "UNKNOWN",
      reason: typeof reason?.reason === "string" ? reason.reason : "reason unavailable"
    })) : []
  }));
}

function evaluateCriteria(expectedRunId, expectedConfigHash, artifacts) {
  const configHash = artifacts.config.digest;
  const identity = identityStatus(expectedRunId, expectedConfigHash, artifacts, configHash);
  const reportCheck = artifacts.report.status === "MISSING"
    ? makeCriterion("operator_report", "UNKNOWN", "No persisted operator report was supplied.")
    : artifacts.report.status === "INVALID"
      ? makeCriterion("operator_report", "FAIL", artifacts.report.reason)
      : reportStatus(artifacts.report.value, expectedRunId, configHash);
  const terminal = artifacts.terminal.status === "VALID" ? artifacts.terminal.value : null;
  const report = artifacts.report.status === "VALID" ? artifacts.report.value : null;
  const config = artifacts.config.status === "VALID" ? artifacts.config.value : null;
  const terminalCheck = artifacts.terminal.status === "MISSING"
    ? makeCriterion("terminal_completion", "UNKNOWN", "No terminal marker was supplied.")
    : artifacts.terminal.status === "INVALID"
      ? makeCriterion("terminal_completion", "FAIL", artifacts.terminal.reason)
      : terminalStatus(terminal, report);
  const duration = config && terminal && report
    ? evaluateDuration(config, terminal, report)
    : {
      criterion: makeCriterion("observation_duration", "UNKNOWN",
        "Config, terminal timing, or report timestamps are unavailable."),
      completionMode: "UNKNOWN",
      scheduledMs: config ? config.endAt - config.startAt : EIGHT_HOURS_MS,
      evidencedMs: null
    };
  const checkpoint = artifacts.report.status === "VALID"
    ? coverageStatus(report)
    : makeCriterion("checkpoint_audit_coverage", "UNKNOWN",
      "Checkpoint audit coverage cannot be assessed without a valid operator report.");
  const accounting = artifacts.terminal.status === "VALID" && artifacts.report.status === "VALID"
    ? providerAccountingStatus(terminal, report, config)
    : makeCriterion("provider_accounting", "UNKNOWN",
      "Terminal and report accounting are not both available.");
  const criteria = [
    makeCriterion("artifact_integrity", artifactStatus(artifacts),
      artifactStatus(artifacts) === "PASS"
        ? "All four bounded artifacts are canonical UTF-8 JSON."
        : "One or more required artifacts are missing, malformed, non-canonical, or oversized.",
      {artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, item]) =>
        [name, {status: item.status, reason: item.reason}]))}),
    identity,
    terminalCheck,
    reportCheck,
    duration.criterion,
    accounting,
    checkpoint,
    makeCriterion("time_series_coverage", "UNKNOWN",
      "No time-series samples were supplied; uptime and gaps are unavailable."),
    makeCriterion("clock_provenance", "UNKNOWN",
      "The caller-supplied clock and exported artifact provenance are not externally verified.")
  ];
  const status = criteria.some(item => item.status === "FAIL") ? "FAIL" :
    criteria.some(item => item.status === "UNKNOWN") ? "UNKNOWN" : "PASS";
  return {criteria, status, identity, reportCheck, terminalCheck, duration, accounting, checkpoint};
}

export function evaluateObservation({
  expectedRunId,
  expectedConfigHash,
  configBytes,
  lockBytes,
  terminalBytes,
  reportBytes
} = {}) {
  const inputs = {config: configBytes, lock: lockBytes, terminal: terminalBytes, report: reportBytes};
  const artifacts = Object.fromEntries(INPUT_NAMES.map(name => [
    name,
    parseArtifact(inputs[name], name)
  ]));
  const evaluation = evaluateCriteria(expectedRunId, expectedConfigHash, artifacts);
  const terminal = artifacts.terminal.status === "VALID" ? artifacts.terminal.value : null;
  const report = artifacts.report.status === "VALID" ? artifacts.report.value : null;
  const totals = evaluation.accounting.totals ?? null;
  const reportDto = report?.dto;
  const duration = evaluation.duration;
  return {
    schema: EVALUATION_SCHEMA,
    expectedRunId: typeof expectedRunId === "string" ? expectedRunId : null,
    expectedConfigHash: typeof expectedConfigHash === "string" ? expectedConfigHash : null,
    overall: evaluation.status,
    observation: {
      completionStatus: evaluation.terminalCheck.status,
      completionMode: duration.completionMode,
      stopReason: typeof terminal?.stopReason === "string" ? terminal.stopReason : null,
      scheduledDurationMs: duration.scheduledMs,
      evidencedDurationMs: duration.evidencedMs,
      fullDeadlineCompleted: duration.completionMode === "FULL_DEADLINE" &&
        duration.criterion.status === "PASS"
    },
    criteria: evaluation.criteria,
    accounting: {
      provider: totals,
      paperEntryFills: Number.isSafeInteger(reportDto?.trading?.paperEntryFills)
        ? reportDto.trading.paperEntryFills : null,
      cashCents: reportDto?.valuation?.cashCents ?? null,
      realizedGrossPnlCents: reportDto?.valuation?.realizedGrossPnlCents ?? null,
      realizedNetPnlCents: reportDto?.valuation?.realizedNetPnlCents ?? null,
      unrealizedGrossPnlCents: reportDto?.valuation?.unrealizedGrossPnlCents ?? null,
      unrealizedNetPnlCents: reportDto?.valuation?.unrealizedNetPnlCents ?? null,
      totalCostsCents: reportDto?.costs?.totalCents ?? null,
      note: reportDto?.trading?.paperEntryFills === 0
        ? "Zero observed fills are not profitability evidence."
        : "Financial totals are copied from the supplied operator report; no profitability metric is calculated."
    },
    checkpointEvidence: {
      coverage: reportDto?.evidence?.coverage?.audit ?? null,
      candidatesCoverage: reportDto?.candidates?.detailsCoverage ?? null,
      candidates: candidateRows(report),
      rejectionReasons: candidateRows(report).flatMap(candidate => candidate.reasons
        .filter(reason => reason.status === "REJECT")
        .map(reason => ({mint: candidate.mint, gate: reason.gate, reason: reason.reason})))
    },
    coverage: {
      inputDigests: Object.fromEntries(Object.entries(artifacts).map(([name, item]) =>
        [name, item.digest])),
      checkpointAudit: evaluation.checkpoint.status,
      timeSeries: "UNAVAILABLE",
      uptimeAndGaps: "UNAVAILABLE",
      externallyVerifiedClock: false,
      externallyVerifiedProvenance: false
    },
    hardGates: {
      executableQuoteAndCostEvidence: report?.observation?.executableQuoteAndCostEvidence ?? "UNKNOWN",
      simulatedTradeTestEligibility: false,
      runtimeAuthorization: false,
      remainingPrerequisites: [
        "A separate simulated-trade test with independently reviewed, identity-bound evidence",
        "Validated executable quote and cost evidence",
        "Complete time-series evidence for any uptime or gap claim",
        "Independent verification of clock and source provenance"
      ]
    }
  };
}

function markdownEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("`", "\\`")
    .replaceAll("|", "\\|").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\r", " ").replaceAll("\n", " ");
}

export function renderEvaluationMarkdown(evaluation) {
  if (!isRecord(evaluation) || evaluation.schema !== EVALUATION_SCHEMA) {
    throw new TypeError("a memecoin paper run evaluation is required");
  }
  const criteria = evaluation.criteria.map(item =>
    `| ${markdownEscape(item.id)} | ${item.status} | ${markdownEscape(item.reason)} |`);
  const provider = evaluation.accounting.provider;
  const providerRows = provider
    ? Object.entries(provider).map(([key, value]) => `- ${key}: ${value}`)
    : ["- UNKNOWN (missing or mismatched counters)"];
  const candidates = evaluation.checkpointEvidence.candidates.length
    ? evaluation.checkpointEvidence.candidates.flatMap(candidate => [
      `- ${markdownEscape(candidate.mint ?? "mint unavailable")}: ${markdownEscape(candidate.status)}`,
      ...candidate.reasons.map(reason =>
        `  - ${markdownEscape(reason.gate)} [${markdownEscape(reason.status)}]: ${markdownEscape(reason.reason)}`)
    ])
    : ["- No candidate detail rows supplied."];
  return [
    "# Offline observation-run evaluation",
    "",
    `- Expected run: ${markdownEscape(evaluation.expectedRunId ?? "UNKNOWN")}`,
    `- Overall evidence result: **${evaluation.overall}**`,
    `- Completion: ${evaluation.observation.completionStatus} (${evaluation.observation.completionMode})`,
    `- Stop reason: ${markdownEscape(evaluation.observation.stopReason ?? "UNKNOWN")}`,
    `- Scheduled duration: ${evaluation.observation.scheduledDurationMs} ms`,
    `- Evidenced duration: ${evaluation.observation.evidencedDurationMs ?? "UNKNOWN"} ms`,
    `- Full deadline completed: ${evaluation.observation.fullDeadlineCompleted}`,
    "",
    "## Operational criteria",
    "",
    "| Criterion | Status | Evidence / limit |",
    "| --- | --- | --- |",
    ...criteria,
    "",
    "## Provider accounting",
    "",
    ...providerRows,
    "",
    "## Checkpoint and candidate evidence",
    "",
    ...candidates,
    "",
    "## Hard gates and limits",
    "",
    `- Simulated-trade test eligibility: ${evaluation.hardGates.simulatedTradeTestEligibility}`,
    `- Runtime authorization: ${evaluation.hardGates.runtimeAuthorization}`,
    `- Time-series / uptime / gaps: ${evaluation.coverage.timeSeries} (not inferred from report age or file growth)`,
    `- Clock and provenance externally verified: ${evaluation.coverage.externallyVerifiedClock} / ${evaluation.coverage.externallyVerifiedProvenance}`,
    `- Financial note: ${markdownEscape(evaluation.accounting.note)}`,
    "- This report evaluates caller-supplied exported evidence only; it grants no trading or runtime authority.",
    "",
    "Remaining prerequisites:",
    ...evaluation.hardGates.remainingPrerequisites.map(item => `- ${markdownEscape(item)}`),
    ""
  ].join("\n");
}

async function readBoundedFile(filePath, maxBytes) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw new TypeError("input paths must be absolute");
  }
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new RangeError("input file exceeds its byte limit");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function parseArguments(argv) {
  const options = new Map();
  const allowed = new Set([
    "run-id", "config-sha256", "config", "lock", "terminal", "report", "format", "output"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]?.startsWith("--") ? argv[index].slice(2) : "";
    if (!allowed.has(name) || options.has(name) || typeof argv[index + 1] !== "string" ||
        argv[index + 1].startsWith("--")) {
      throw new TypeError("expected unique --run-id, --config-sha256, --config, --lock, --terminal, --report, optional --format and --output arguments");
    }
    options.set(name, argv[++index]);
  }
  for (const name of ["run-id", "config-sha256", "config", "lock", "terminal", "report"]) {
    if (!options.has(name)) throw new TypeError(`--${name} is required`);
  }
  const format = options.get("format") ?? "json";
  if (!["json", "markdown"].includes(format)) throw new TypeError("--format must be json or markdown");
  if (options.has("output") && !path.isAbsolute(options.get("output"))) {
    throw new TypeError("--output must be an absolute path");
  }
  return {
    runId: options.get("run-id"),
    configHash: options.get("config-sha256"),
    config: options.get("config"),
    lock: options.get("lock"),
    terminal: options.get("terminal"),
    report: options.get("report"),
    format,
    output: options.get("output")
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const [configBytes, lockBytes, terminalBytes, reportBytes] = await Promise.all([
    readBoundedFile(options.config, MAX_INPUT_BYTES.config),
    readBoundedFile(options.lock, MAX_INPUT_BYTES.lock),
    readBoundedFile(options.terminal, MAX_INPUT_BYTES.terminal),
    readBoundedFile(options.report, MAX_INPUT_BYTES.report)
  ]);
  const evaluation = evaluateObservation({
    expectedRunId: options.runId,
    expectedConfigHash: options.configHash,
    configBytes,
    lockBytes,
    terminalBytes,
    reportBytes
  });
  const output = options.format === "json"
    ? `${JSON.stringify(evaluation, null, 2)}\n`
    : renderEvaluationMarkdown(evaluation);
  if (options.output) {
    const handle = await open(options.output, "wx", 0o600);
    try {
      await handle.writeFile(output, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } else {
    process.stdout.write(output);
  }
  return evaluation;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
