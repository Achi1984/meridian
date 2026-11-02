import {createHash} from "node:crypto";
import {constants as fsConstants} from "node:fs";
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
const MAX_DATE_MS = 8_640_000_000_000_000;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const INPUT_NAMES = Object.keys(MAX_INPUT_BYTES);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_TAG = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag
).get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE, "buffer"
).get;
const TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE, "byteOffset"
).get;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE, "byteLength"
).get;

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

function copyBoundedUint8Array(input, maxBytes) {
  try {
    if (TYPED_ARRAY_TAG.call(input) !== "Uint8Array") return null;
    const byteLength = TYPED_ARRAY_BYTE_LENGTH.call(input);
    if (byteLength > maxBytes) return {oversized: true};
    const view = new Uint8Array(
      TYPED_ARRAY_BUFFER.call(input),
      TYPED_ARRAY_BYTE_OFFSET.call(input),
      byteLength
    );
    return {bytes: Buffer.from(view)};
  } catch {
    return null;
  }
}

function parseArtifact(input, name) {
  if (input === undefined || input === null) {
    return {status: "MISSING", reason: "artifact bytes were not supplied", value: null, digest: null};
  }
  const copied = copyBoundedUint8Array(input, MAX_INPUT_BYTES[name]);
  if (!copied) {
    return {status: "INVALID", reason: "artifact must be supplied as exported bytes", value: null, digest: null};
  }
  if (copied.oversized) {
    return {status: "INVALID", reason: "artifact exceeds its byte limit", value: null, digest: null};
  }
  const bytes = copied.bytes;
  const digest = sha256(bytes);
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
    startAt <= MAX_DATE_MS && Number.isSafeInteger(endAt) && endAt <= MAX_DATE_MS &&
    endAt - startAt === EIGHT_HOURS_MS &&
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

function validDateText(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validText(value, maxBytes, nullable = true) {
  return (nullable && value === null) ||
    (typeof value === "string" && Buffer.byteLength(value, "utf8") <= maxBytes &&
      (nullable || value.length > 0));
}

function validCoverageShape(value) {
  if (!isRecord(value)) return false;
  const counts = ["observedTotal", "total", "displayed", "unaccounted"];
  const flags = ["displayTruncated", "sourceTruncated"];
  return Object.keys(value).every(key => [...counts, ...flags].includes(key)) &&
    counts.every(key => !Object.hasOwn(value, key) || value[key] === null ||
      Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    flags.every(key => !Object.hasOwn(value, key) || value[key] === null ||
      typeof value[key] === "boolean");
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
  if (audit.replayLoggerTruncated === true || audit.ledgerAuditTruncated === true) {
    return makeCriterion("checkpoint_audit_coverage", "UNKNOWN",
      "A checkpoint audit component is explicitly truncated.");
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

function candidateCoverageStatus(report) {
  const coverage = report?.dto?.candidates?.detailsCoverage;
  const details = report?.dto?.candidates?.details;
  const summary = report?.dto?.candidates;
  if (!isRecord(coverage)) {
    return makeCriterion("candidate_detail_coverage", "UNKNOWN",
      "Candidate detail coverage is unavailable.");
  }
  if (!Array.isArray(details)) {
    return makeCriterion("candidate_detail_coverage", "UNKNOWN",
      "Candidate detail rows are unavailable.");
  }
  const counts = [coverage.displayed, coverage.observedTotal, coverage.total, coverage.unaccounted];
  if (counts.some(value => !Number.isSafeInteger(value) || value < 0) ||
      typeof coverage.displayTruncated !== "boolean" ||
      typeof coverage.sourceTruncated !== "boolean") {
    return makeCriterion("candidate_detail_coverage", "UNKNOWN",
      "Candidate detail coverage counters or truncation flags are unavailable.");
  }
  if (coverage.displayed > coverage.observedTotal || coverage.observedTotal > coverage.total ||
      coverage.unaccounted > coverage.observedTotal) {
    return makeCriterion("candidate_detail_coverage", "FAIL",
      "Candidate detail counters contradict their reported totals.");
  }
  if (coverage.displayed !== details.length) {
    return makeCriterion("candidate_detail_coverage", "FAIL",
      "Displayed candidate count does not match the supplied detail rows.");
  }
  const summaryCounts = ["considered", "accepted", "rejected", "unknown"].map(key =>
    summary?.[key]);
  if (summaryCounts.some(value => value !== null && value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0))) {
    return makeCriterion("candidate_detail_coverage", "FAIL",
      "Candidate summary counts are not non-negative safe integers.");
  }
  if (Number.isSafeInteger(summary?.considered) && Number.isSafeInteger(coverage.total) &&
      summary.considered !== coverage.total) {
    return makeCriterion("candidate_detail_coverage", "FAIL",
      "Candidate considered count conflicts with the detail coverage total.");
  }
  if (coverage.unaccounted === 0 && coverage.sourceTruncated === false &&
      Number.isSafeInteger(summary?.considered) &&
      ["accepted", "rejected", "unknown"].every(key => Number.isSafeInteger(summary[key])) &&
      summary.accepted + summary.rejected + summary.unknown !== summary.considered) {
    return makeCriterion("candidate_detail_coverage", "FAIL",
      "Complete candidate outcome counts do not sum to the considered total.");
  }
  if (coverage.unaccounted === 0 && coverage.sourceTruncated === false &&
      coverage.displayTruncated === false && coverage.displayed === details.length &&
      ["accepted", "rejected", "unknown"].every(key => Number.isSafeInteger(summary?.[key]))) {
    const rowCounts = {
      accepted: details.filter(row => row?.status === "ACCEPTED").length,
      rejected: details.filter(row => row?.status === "REJECT").length,
      unknown: details.filter(row => row?.status === "UNKNOWN").length
    };
    if (Object.keys(rowCounts).some(key => rowCounts[key] !== summary[key])) {
      return makeCriterion("candidate_detail_coverage", "FAIL",
        "Complete candidate detail outcomes conflict with the summary counts.");
    }
  }
  const validCandidate = candidate => isRecord(candidate) &&
    Object.keys(candidate).every(key =>
      ["chainId", "mint", "pool", "relatedPool", "quote", "sampledAt", "status",
        "reasons", "reasonsCoverage"].includes(key)) &&
    ["chainId", "mint", "pool", "relatedPool", "quote", "sampledAt", "status",
      "reasons", "reasonsCoverage"].every(key => Object.hasOwn(candidate, key)) &&
    validText(candidate.chainId, 32) && validText(candidate.mint, 80) &&
    validText(candidate.pool, 80) && validText(candidate.relatedPool, 80) &&
    validText(candidate.quote, 80) &&
    (candidate.sampledAt === null || validDateText(candidate.sampledAt)) &&
    ["ACCEPTED", "REJECT", "UNKNOWN"].includes(candidate.status) &&
    Array.isArray(candidate.reasons) && validCoverageShape(candidate.reasonsCoverage) &&
    candidate.reasons.every(reason => isRecord(reason) &&
      Object.keys(reason).every(key =>
        ["gate", "status", "reason", "source", "observedAt"].includes(key)) &&
      ["gate", "status", "reason", "source", "observedAt"]
        .every(key => Object.hasOwn(reason, key)) &&
      validText(reason.gate, 80) && validText(reason.status, 32) &&
      validText(reason.reason, 512) && validText(reason.source, 120) &&
      (reason.observedAt === null || validDateText(reason.observedAt)));
  if (!details.every(validCandidate)) {
    return makeCriterion("candidate_detail_coverage", "FAIL",
      "One or more candidate or rejection-reason rows are malformed.");
  }
  let nestedReasonCoverageUnknown = false;
  for (const candidate of details) {
    if (["chainId", "mint", "pool", "quote"].some(key =>
      typeof candidate[key] !== "string" || candidate[key].length === 0) ||
        (candidate.status === "REJECT" && candidate.reasons.length === 0) ||
        candidate.reasons.some(reason => reason.status === null || reason.reason === null)) {
      nestedReasonCoverageUnknown = true;
    }
    const reasonsCoverage = candidate.reasonsCoverage;
    if (reasonsCoverage.displayed !== null && reasonsCoverage.displayed !== undefined &&
        reasonsCoverage.displayed !== candidate.reasons.length) {
      return makeCriterion("candidate_detail_coverage", "FAIL",
        "Displayed rejection-reason count does not match its detail rows.");
    }
    const reasonCounts = [
      reasonsCoverage.observedTotal, reasonsCoverage.total, reasonsCoverage.displayed,
      reasonsCoverage.unaccounted
    ];
    if (reasonCounts.some(value => value !== null && value !== undefined &&
        !Number.isSafeInteger(value)) ||
        (Number.isSafeInteger(reasonsCoverage.observedTotal) &&
          Number.isSafeInteger(reasonsCoverage.total) &&
          reasonsCoverage.observedTotal > reasonsCoverage.total)) {
      return makeCriterion("candidate_detail_coverage", "FAIL",
        "Rejection-reason coverage counters are inconsistent.");
    }
    if (reasonCounts.some(value => !Number.isSafeInteger(value)) ||
        reasonsCoverage.displayTruncated !== false || reasonsCoverage.sourceTruncated !== false ||
        reasonsCoverage.unaccounted !== 0 ||
        reasonsCoverage.observedTotal !== candidate.reasons.length ||
        reasonsCoverage.total !== candidate.reasons.length) {
      nestedReasonCoverageUnknown = true;
    }
  }
  if (nestedReasonCoverageUnknown || coverage.displayTruncated ||
      coverage.sourceTruncated || coverage.unaccounted > 0 ||
      coverage.displayed !== coverage.total || coverage.observedTotal !== coverage.total) {
    return makeCriterion("candidate_detail_coverage", "UNKNOWN",
      "Candidate details are truncated, unaccounted, or only partially represented.");
  }
  if (summary.discoveryTruncated === true || summary.scoutAuditTruncated === true) {
    return makeCriterion("candidate_detail_coverage", "UNKNOWN",
      "Candidate discovery or Scout audit is explicitly truncated.");
  }
  return makeCriterion("candidate_detail_coverage", "PASS",
    "Candidate detail coverage is complete according to the supplied report.");
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
    ["rpcRequests", "rpcRequests"],
    ["candidates", "candidates"]
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
  const startIso = Number.isSafeInteger(startAt) && Number.isFinite(new Date(startAt).getTime())
    ? new Date(startAt).toISOString() : null;
  const endIso = Number.isSafeInteger(effectiveEndAt) &&
    Number.isFinite(new Date(effectiveEndAt).getTime())
    ? new Date(effectiveEndAt).toISOString() : null;
  const finalizedAtValid = Number.isSafeInteger(finalizedAt) &&
    Number.isFinite(new Date(finalizedAt).getTime());
  if (![effectiveEndAt, finalizedAt, latenessMs].every(Number.isSafeInteger) ||
      latenessMs < 0 || effectiveEndAt < startAt || effectiveEndAt > endAt ||
      !finalizedAtValid || finalizedAt < effectiveEndAt ||
      startIso === null || endIso === null ||
      report?.dto?.experiment?.startAt !== startIso ||
      report?.dto?.experiment?.endAt !== endIso) {
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
      completionMode: validDeadline ? "FULL_DEADLINE" : "INCONSISTENT",
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
      completionMode: validStop ? "OPERATOR_STOP" : "INCONSISTENT",
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

function hasFields(value, fields) {
  return isRecord(value) && fields.every(field => Object.hasOwn(value, field));
}

function hasExactFields(value, fields) {
  return hasFields(value, fields) && Object.keys(value).length === fields.length;
}

function nullableCount(value) {
  return value === null || Number.isSafeInteger(value) && value >= 0;
}

function nullableFlag(value) {
  return value === null || typeof value === "boolean";
}

function nullableAmount(value, signed = false) {
  return value === null || typeof value === "string" &&
    (signed ? /^-?(?:0|[1-9]\d{0,128})$/ : /^(?:0|[1-9]\d{0,128})$/).test(value) &&
    value !== "-0";
}

function completeCoverage(value) {
  const fields = [
    "observedTotal", "total", "displayed", "displayTruncated", "sourceTruncated", "unaccounted"
  ];
  return hasExactFields(value, fields) &&
    ["observedTotal", "total", "displayed", "unaccounted"].every(key =>
      nullableCount(value[key])) &&
    ["displayTruncated", "sourceTruncated"].every(key => nullableFlag(value[key]));
}

function completeReasonRow(reason) {
  const required = ["gate", "status", "reason", "source", "observedAt"];
  const allowed = [...required, "mint"];
  return isRecord(reason) &&
    required.every(key => Object.hasOwn(reason, key)) &&
    Object.keys(reason).every(key => allowed.includes(key)) &&
    validText(reason.gate, 80) && validText(reason.status, 32) &&
    validText(reason.reason, 512) && validText(reason.source, 120) &&
    (!Object.hasOwn(reason, "mint") || validText(reason.mint, 80)) &&
    (reason.observedAt === null || validDateText(reason.observedAt));
}

function completeStopRow(row) {
  const fields = ["kind", "status", "reason", "observedAt", "source"];
  return hasExactFields(row, fields) && validText(row.kind, 64) &&
    validText(row.status, 32) && validText(row.reason, 512) &&
    (row.observedAt === null || validDateText(row.observedAt)) && validText(row.source, 120);
}

function completePositionRow(row) {
  const fields = [
    "mint", "tokenAtoms", "decimals", "entryCostCents", "stopPriceMicros",
    "trailingActive", "markStatus"
  ];
  return hasExactFields(row, fields) && validText(row.mint, 80) &&
    nullableAmount(row.tokenAtoms) && nullableCount(row.decimals) &&
    nullableAmount(row.entryCostCents) && nullableAmount(row.stopPriceMicros) &&
    nullableFlag(row.trailingActive) && validText(row.markStatus, 32);
}

function completeUnresolvedFill(row) {
  const fields = ["kind", "receiptId", "status", "reason"];
  return hasExactFields(row, fields) && validText(row.kind, 40) &&
    validText(row.receiptId, 120) && validText(row.status, 32) &&
    validText(row.reason, 512);
}

function completeProvenanceRow(row) {
  const fields = ["chainId", "mint", "pool", "relatedPool", "quote", "sampledAt", "status"];
  return hasExactFields(row, fields) && validText(row.chainId, 32) &&
    validText(row.mint, 80) && validText(row.pool, 80) &&
    validText(row.relatedPool, 80) && validText(row.quote, 80) &&
    (row.sampledAt === null || validDateText(row.sampledAt)) &&
    validText(row.status, 32);
}

function completeCandidateDetail(candidate) {
  const fields = [
    "chainId", "mint", "pool", "relatedPool", "quote", "sampledAt", "status",
    "reasons", "reasonsCoverage"
  ];
  return hasExactFields(candidate, fields) &&
    validText(candidate.chainId, 32) && validText(candidate.mint, 80) &&
    validText(candidate.pool, 80) && validText(candidate.relatedPool, 80) &&
    validText(candidate.quote, 80) &&
    (candidate.sampledAt === null || validDateText(candidate.sampledAt)) &&
    ["ACCEPTED", "REJECT", "UNKNOWN"].includes(candidate.status) &&
    Array.isArray(candidate.reasons) && candidate.reasons.length <= 40 &&
    completeCoverage(candidate.reasonsCoverage) &&
    candidate.reasons.every(completeReasonRow);
}

function completeOperatorDto(dto) {
  const topFields = [
    "schema", "experiment", "evidence", "candidates", "trading", "controls",
    "valuation", "costs", "unresolvedFills", "unresolvedFillsCoverage",
    "provenance", "provenanceCoverage"
  ];
  const experimentFields = [
    "id", "source", "evidenceKind", "sourceProvenance", "reportStatus",
    "sourceReadiness", "operationalStatus", "startAt", "endAt"
  ];
  const discoveryFields = [
    "observedRecords", "scoutAuditRows", "unaccountedObservedRecords",
    "sourceTruncated", "scoutAuditTruncated", "exhaustive"
  ];
  const auditFields = [
    "present", "observedRows", "truncated", "totalRows", "replayLoggerTruncated",
    "ledgerAuditTruncated", "ledgerEventsReported", "ledgerEventsAudited"
  ];
  const candidateFields = [
    "considered", "accepted", "rejected", "unknown", "audited",
    "authorizationReceiptCount", "unaccountedObserved", "discoveryTruncated",
    "scoutAuditTruncated", "basis", "details", "detailsCoverage"
  ];
  const tradingFields = [
    "status", "paperEntryFills", "basis", "noTradeReasons", "noTradeReasonsCoverage"
  ];
  const controlFields = [
    "stops", "stopsCoverage", "reservations", "openPositionCount",
    "openPositions", "openPositionsCoverage"
  ];
  const valuationFields = [
    "status", "cashCents", "realizedGrossPnlCents", "realizedNetPnlCents",
    "grossOpenValueCents", "estimatedExitCostsCents", "unrealizedGrossPnlCents",
    "unrealizedNetPnlCents", "unresolvedPositions", "basis"
  ];
  const costFields = ["basis", "entryByType", "exitByType", "totalByType", "totalCents"];
  const costKeys = ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"];
  const coverageFields = ["discovery", "audit"];
  const textArray = (items, max) => Array.isArray(items) && items.length <= max &&
    items.every(item => validText(item, 120, false));
  const countFieldsValid = (record, fields) => fields.every(key => nullableCount(record[key]));
  const flagFieldsValid = (record, fields) => fields.every(key => nullableFlag(record[key]));
  const exactCoverage = value => completeCoverage(value);
  if (!hasExactFields(dto, topFields) || dto.schema !== "MEMECOIN_PAPER_OPERATOR_REPORT_V1" ||
      !hasExactFields(dto.experiment, experimentFields) ||
      !validText(dto.experiment.id, 80, false) || !validText(dto.experiment.source, 120, false) ||
      !validText(dto.experiment.evidenceKind, 64, false) ||
      !validText(dto.experiment.sourceProvenance, 64, false) ||
      !["FINISHED", "INCOMPLETE"].includes(dto.experiment.reportStatus) ||
      !validText(dto.experiment.sourceReadiness, 64) ||
      dto.experiment.operationalStatus !== "NOT_EVIDENCED" ||
      (dto.experiment.startAt !== null && !validDateText(dto.experiment.startAt)) ||
      (dto.experiment.endAt !== null && !validDateText(dto.experiment.endAt)) ||
      !hasExactFields(dto.evidence, ["status", "observedFrom", "observedThrough", "basis", "sources", "coverage"]) ||
      !["PASS", "REJECT", "UNKNOWN"].includes(dto.evidence.status) ||
      !validText(dto.evidence.basis, 512) || !textArray(dto.evidence.sources, 20) ||
      (dto.evidence.observedFrom !== null && !validDateText(dto.evidence.observedFrom)) ||
      (dto.evidence.observedThrough !== null && !validDateText(dto.evidence.observedThrough)) ||
      !hasExactFields(dto.evidence.coverage, coverageFields) ||
      !hasExactFields(dto.evidence.coverage.discovery, discoveryFields) ||
      !hasExactFields(dto.evidence.coverage.audit, auditFields) ||
      !countFieldsValid(dto.evidence.coverage.discovery, [
        "observedRecords", "scoutAuditRows", "unaccountedObservedRecords"
      ]) || !flagFieldsValid(dto.evidence.coverage.discovery, [
        "sourceTruncated", "scoutAuditTruncated", "exhaustive"
      ]) ||
      !flagFieldsValid(dto.evidence.coverage.audit, [
        "present", "truncated", "replayLoggerTruncated", "ledgerAuditTruncated"
      ]) || !countFieldsValid(dto.evidence.coverage.audit, [
        "observedRows", "totalRows", "ledgerEventsReported", "ledgerEventsAudited"
      ]) ||
      !hasExactFields(dto.candidates, candidateFields) ||
      !countFieldsValid(dto.candidates, [
        "considered", "accepted", "rejected", "unknown", "audited",
        "authorizationReceiptCount", "unaccountedObserved"
      ]) || !flagFieldsValid(dto.candidates, ["discoveryTruncated", "scoutAuditTruncated"]) ||
      !validText(dto.candidates.basis, 512) || !Array.isArray(dto.candidates.details) ||
      dto.candidates.details.length > 40 ||
      !dto.candidates.details.every(completeCandidateDetail) ||
      !exactCoverage(dto.candidates.detailsCoverage) ||
      !hasExactFields(dto.trading, tradingFields) ||
      !validText(dto.trading.status, 64, false) ||
      !nullableCount(dto.trading.paperEntryFills) || !validText(dto.trading.basis, 512) ||
      !Array.isArray(dto.trading.noTradeReasons) || dto.trading.noTradeReasons.length > 40 ||
      !dto.trading.noTradeReasons.every(completeReasonRow) ||
      !exactCoverage(dto.trading.noTradeReasonsCoverage) ||
      !hasExactFields(dto.controls, controlFields) ||
      !Array.isArray(dto.controls.stops) || dto.controls.stops.length > 40 ||
      !dto.controls.stops.every(completeStopRow) ||
      !exactCoverage(dto.controls.stopsCoverage) || !nullableCount(dto.controls.reservations) ||
      !nullableCount(dto.controls.openPositionCount) ||
      !Array.isArray(dto.controls.openPositions) || dto.controls.openPositions.length > 40 ||
      !dto.controls.openPositions.every(completePositionRow) ||
      !exactCoverage(dto.controls.openPositionsCoverage) ||
      !hasExactFields(dto.valuation, valuationFields) ||
      !validText(dto.valuation.status, 64, false) ||
      !nullableAmount(dto.valuation.cashCents) ||
      !nullableAmount(dto.valuation.realizedGrossPnlCents, true) ||
      !nullableAmount(dto.valuation.realizedNetPnlCents, true) ||
      !nullableAmount(dto.valuation.grossOpenValueCents) ||
      !nullableAmount(dto.valuation.estimatedExitCostsCents) ||
      !nullableAmount(dto.valuation.unrealizedGrossPnlCents, true) ||
      !nullableAmount(dto.valuation.unrealizedNetPnlCents, true) ||
      !nullableCount(dto.valuation.unresolvedPositions) || !validText(dto.valuation.basis, 512) ||
      !hasExactFields(dto.costs, costFields) || !validText(dto.costs.basis, 512) ||
      ![dto.costs.entryByType, dto.costs.exitByType, dto.costs.totalByType]
        .every(cost => hasExactFields(cost, costKeys) &&
          costKeys.every(key => nullableAmount(cost[key]))) ||
      !nullableAmount(dto.costs.totalCents) ||
      !Array.isArray(dto.unresolvedFills) || dto.unresolvedFills.length > 40 ||
      !dto.unresolvedFills.every(completeUnresolvedFill) ||
      !exactCoverage(dto.unresolvedFillsCoverage) || !Array.isArray(dto.provenance) ||
      dto.provenance.length > 40 || !dto.provenance.every(completeProvenanceRow) ||
      !exactCoverage(dto.provenanceCoverage)) {
    return false;
  }
  return true;
}

function reportStatus(report, expectedRunId, configHash) {
  const dto = report?.dto;
  const experiment = dto?.experiment;
  if (!isRecord(report) || !completeOperatorDto(dto) ||
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
  if (!completeOperatorDto(report?.dto)) {
    return makeCriterion("terminal_completion", "FAIL",
      "Persisted operator DTO is structurally incomplete.");
  }
  if (terminal.controllerStatus === "UNKNOWN" || terminal.controllerStatus === "NOT_STARTED" ||
      terminal.stopReason === "UNKNOWN" || terminal.reportStatus === "UNKNOWN") {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "Controller, stop reason, or report projection remains unknown.");
  }
  const terminalObservation = terminal.observation;
  const reportObservation = report?.observation;
  const observationFields = [
    "entryAuthorizations", "simulatedFills", "executableQuoteAndCostEvidence"
  ];
  if (!isRecord(terminalObservation) || !isRecord(reportObservation) ||
      observationFields.some(key => !Object.hasOwn(terminalObservation, key) ||
        !Object.hasOwn(reportObservation, key)) ||
      !isRecord(terminalObservation.windowFinalization) ||
      !isRecord(reportObservation.windowFinalization)) {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "Observation-only activity and finalization fields are incomplete.");
  }
  if (observationFields.some(key =>
    terminalObservation[key] !== reportObservation[key]) ||
      canonicalJson(terminalObservation.windowFinalization) !==
        canonicalJson(reportObservation.windowFinalization)) {
    return makeCriterion("terminal_completion", "FAIL",
      "Terminal and report observation fields conflict.");
  }
  const reportTrading = report?.dto?.trading;
  const reportExperiment = report?.dto?.experiment;
  if (reportExperiment?.reportStatus === "INCOMPLETE") {
    return makeCriterion("terminal_completion", "FAIL",
      "Terminal completion conflicts with an operator DTO marked INCOMPLETE.");
  }
  if (reportExperiment?.reportStatus !== "FINISHED") {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "The operator DTO does not establish a finished report.");
  }
  if (!isRecord(reportTrading) || terminal.reportTradingStatus !== reportTrading.status) {
    return makeCriterion("terminal_completion", "FAIL",
      "Terminal report-trading status does not match the persisted operator DTO.");
  }
  if (!["UNKNOWN", "NO_ENTRY_OBSERVED", "ZERO_TRADES", "TRADES_RECORDED"]
    .includes(reportTrading.status)) {
    return makeCriterion("terminal_completion", "FAIL",
      "Operator report contains an unsupported trading status.");
  }
  if (reportTrading.paperEntryFills !== null &&
      reportTrading.paperEntryFills !== undefined &&
      (!Number.isSafeInteger(reportTrading.paperEntryFills) || reportTrading.paperEntryFills < 0)) {
    return makeCriterion("terminal_completion", "FAIL",
      "Operator report fill count is not a non-negative safe integer.");
  }
  if (reportTrading.paperEntryFills > 0 || reportTrading.status === "TRADES_RECORDED") {
    return makeCriterion("terminal_completion", "FAIL",
      "Paper-fill evidence conflicts with an observation-only terminal marker.");
  }
  if (reportTrading.paperEntryFills === null || reportTrading.paperEntryFills === undefined ||
      reportTrading.status === "UNKNOWN") {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "The report does not establish a known zero-fill observation.");
  }
  const finalizedAt = terminalObservation.windowFinalization.finalizedAt;
  const {effectiveEndAt, latenessMs} = terminalObservation.windowFinalization;
  if (![effectiveEndAt, finalizedAt, latenessMs].every(Number.isSafeInteger) ||
      effectiveEndAt < 0 || finalizedAt < effectiveEndAt || latenessMs < 0 ||
      finalizedAt > MAX_DATE_MS || effectiveEndAt > MAX_DATE_MS ||
      finalizedAt - effectiveEndAt !== latenessMs) {
    return makeCriterion("terminal_completion", "FAIL",
      "Terminal window-finalization timestamps are invalid or inconsistent.");
  }
  if (terminal.terminalAt === undefined || terminal.terminalAt === null) {
    return makeCriterion("terminal_completion", "UNKNOWN",
      "Terminal marker timestamp is missing.");
  }
  if (!Number.isSafeInteger(terminal.terminalAt) || terminal.terminalAt < finalizedAt ||
      terminal.terminalAt > MAX_DATE_MS) {
    return makeCriterion("terminal_completion", "FAIL",
      "Terminal timestamp is invalid or precedes observation finalization.");
  }
  if (terminal.controllerStatus !== "FINISHED" ||
      !["DEADLINE", "OPERATOR_STOP"].includes(terminal.stopReason) ||
      terminal.failureCode !== null || terminal.reportStatus !== "PROJECTED" ||
      terminal.observationOnly !== true || terminal.executionStarted !== false ||
      terminalObservation.entryAuthorizations !== 0 ||
      terminalObservation.simulatedFills !== 0 ||
      terminalObservation.executableQuoteAndCostEvidence !== "UNAVAILABLE") {
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
  const candidates = artifacts.report.status === "VALID"
    ? candidateCoverageStatus(report)
    : makeCriterion("candidate_detail_coverage", "UNKNOWN",
      "Candidate detail coverage cannot be assessed without a valid operator report.");
  const accounting = artifacts.terminal.status === "VALID" && artifacts.report.status === "VALID"
    ? providerAccountingStatus(terminal, report, config)
    : makeCriterion("provider_accounting", "UNKNOWN",
      "Terminal and report accounting are not both available.");
  const identityBound = identity.status === "PASS";
  const boundCriterion = (criterion, label) => identityBound ? criterion :
    makeCriterion(criterion.id, "UNKNOWN",
      `The expected run/config identity is not established; ${label} cannot be attributed to this run.`);
  const boundTerminalCheck = boundCriterion(terminalCheck, "terminal completion");
  const boundDurationCheck = boundCriterion(duration.criterion, "observation duration");
  const boundAccounting = boundCriterion(accounting, "provider accounting");
  const boundCheckpoint = boundCriterion(checkpoint, "checkpoint audit coverage");
  const boundCandidates = boundCriterion(candidates, "candidate detail coverage");
  const criteria = [
    makeCriterion("artifact_integrity", artifactStatus(artifacts),
      artifactStatus(artifacts) === "PASS"
        ? "All four bounded artifacts are canonical UTF-8 JSON."
        : "One or more required artifacts are missing, malformed, non-canonical, or oversized.",
      {artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, item]) =>
        [name, {status: item.status, reason: item.reason}]))}),
    identity,
    boundTerminalCheck,
    reportCheck,
    boundDurationCheck,
    boundAccounting,
    boundCheckpoint,
    boundCandidates,
    makeCriterion("time_series_coverage", "UNKNOWN",
      "No time-series samples were supplied; uptime and gaps are unavailable."),
    makeCriterion("clock_provenance", "UNKNOWN",
      "The caller-supplied clock and exported artifact provenance are not externally verified."),
    makeCriterion("executable_quote_cost_evidence", "UNKNOWN",
      "Executable quote and validated cost evidence are unavailable."),
    makeCriterion("simulated_trade_test_readiness", "UNKNOWN",
      "A separate simulated-trade test has not been evaluated by this observation-only report.")
  ];
  const status = criteria.some(item => item.status === "FAIL") ? "FAIL" :
    criteria.some(item => item.status === "UNKNOWN") ? "UNKNOWN" : "PASS";
  return {
    criteria, status, identity, reportCheck, terminalCheck: boundTerminalCheck, duration,
    accounting: boundAccounting, checkpoint: boundCheckpoint, candidates: boundCandidates
  };
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
  const completionStatus = evaluation.identity.status === "PASS" &&
    evaluation.reportCheck.status === "PASS"
    ? evaluation.terminalCheck.status : "UNKNOWN";
  const completionMode = completionStatus === "PASS"
    ? duration.completionMode : "UNKNOWN";
  return {
    schema: EVALUATION_SCHEMA,
    expectedRunId: typeof expectedRunId === "string" ? expectedRunId : null,
    expectedConfigHash: typeof expectedConfigHash === "string" ? expectedConfigHash : null,
    overall: evaluation.status,
    observation: {
      completionStatus,
      completionMode,
      stopReason: typeof terminal?.stopReason === "string" ? terminal.stopReason : null,
      failureCode: terminal?.failureCode ?? null,
      controllerStatus: terminal?.controllerStatus ?? "UNKNOWN",
      reportStatus: terminal?.reportStatus ?? "UNKNOWN",
      scheduledDurationMs: duration.scheduledMs,
      evidencedDurationMs: duration.evidencedMs,
      fullDeadlineCompleted: completionMode === "FULL_DEADLINE" &&
        duration.criterion.status === "PASS" &&
        completionStatus === "PASS" &&
        evaluation.reportCheck.status === "PASS"
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
      candidateDetails: evaluation.candidates.status,
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
    .replaceAll("!", "\\!").replaceAll("[", "\\[").replaceAll("]", "\\]")
    .replaceAll("(", "\\(").replaceAll(")", "\\)")
    .replaceAll("*", "\\*").replaceAll("_", "\\_").replaceAll("~", "\\~")
    .replaceAll("#", "\\#")
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
  if (!Number.isInteger(fsConstants.O_NONBLOCK) || !Number.isInteger(fsConstants.O_NOFOLLOW)) {
    throw new Error("platform does not support nonblocking no-follow input opens");
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW
  );
  try {
    if (!(await handle.stat()).isFile()) {
      throw new TypeError("input path must resolve to a regular file");
    }
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
