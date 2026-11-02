import {randomBytes} from "node:crypto";
import {open, rename, rm} from "node:fs/promises";
import path from "node:path";

export const OBSERVATION_AUDIT_SCHEMA = "MERIDIAN_PAPER_OBSERVATION_AUDIT_V1";
export const OBSERVATION_AUDIT_FILE = "observation-audit.json";
export const MAX_OBSERVATION_AUDIT_BYTES = 4 * 1024 * 1024;
export const MAX_OBSERVATION_AUDIT_WRITES = 800;
export const MAX_OBSERVATION_AUDIT_WRITE_BYTES = 512 * 1024 * 1024;

const MAX_REQUEST_ROWS = 960;
const MAX_CANDIDATE_ROWS = 300;
const MAX_CHECK_ROWS = 20;
const MAX_TEXT_LENGTH = 160;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const persistenceTotals = new WeakMap();
const PROVIDERS = new Set(["DexScreener public API", "Solana JSON-RPC", "Solana mainnet public JSON-RPC"]);
const FAILURE_STATUSES = new Set([
  "INVALID_CLOCK", "OUTSIDE_RUN_WINDOW", "ABORTED", "REDIRECT_BLOCKED",
  "INVALID_RESPONSE_URL", "INVALID_CONTENT_TYPE", "INVALID_CONTENT_LENGTH",
  "RESPONSE_TOO_LARGE", "MISSING_RESPONSE_STREAM", "INVALID_RESPONSE_CHUNK",
  "INVALID_UTF8", "INVALID_JSON", "STALE_ACQUISITION", "MISSING_PAIR_CREATED_AT", "INVALID_DECIMAL",
  "INVALID_SOURCE_TIME", "INVALID_TRANSACTION_COUNT", "AMBIGUOUS_DEX_PAIRS",
  "INVALID_DEX_SCHEMA", "IDENTITY_MISMATCH", "INVALID_RPC_ENVELOPE",
  "INVALID_RPC_SCHEMA", "INVALID_ACCOUNT_INFO", "INVALID_LARGEST_ACCOUNTS",
  "INVALID_TOKEN_SUPPLY", "SOURCE_TIME_OUTSIDE_POLICY", "TIMEOUT", "TRANSPORT_ERROR"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestSafeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_:-]{1,64}$/.test(value) ? value : "UNKNOWN";
}

function safeText(value, maxLength = MAX_TEXT_LENGTH, onTruncate = () => {}) {
  if (typeof value !== "string") return null;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\bBearer\s+\S+/gi, "******")
    .replace(/\b(authorization|api[-_ ]?key|access[-_ ]?token|secret|password)\s*[:=]\s*[^,\s;]+/gi,
      "$1=[redacted]")
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gi, "[redacted]");
  if (sanitized.length > maxLength) onTruncate();
  return sanitized.slice(0, maxLength);
}

function safeTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
}

function safeRequestId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function safeIdentity(value) {
  if (!isRecord(value)) return null;
  return {
    chainId: value.chainId === "solana" ? "solana" : null,
    mint: typeof value.mint === "string" && BASE58.test(value.mint) ? value.mint : null,
    pool: typeof value.pool === "string" && BASE58.test(value.pool) ? value.pool : null,
    quote: typeof value.quote === "string" && BASE58.test(value.quote) ? value.quote : null
  };
}

function validAuditText(value, maxLength = MAX_TEXT_LENGTH) {
  return value === null || (typeof value === "string" && value.length <= maxLength &&
    safeText(value, maxLength) === value);
}

function validAuditCode(value) {
  return value === null || (typeof value === "string" && /^[A-Z0-9_:-]{1,64}$/.test(value));
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validAuditTime(value) {
  return value === null || safeTime(value) === value;
}

function validAuditIdentity(value) {
  return value === null || (hasExactKeys(value, ["chainId", "mint", "pool", "quote"]) &&
    (value.chainId === null || value.chainId === "solana") &&
    ["mint", "pool", "quote"].every(field =>
      value[field] === null || (typeof value[field] === "string" && BASE58.test(value[field]))));
}

function requestClassification(status) {
  if (typeof status !== "string") return "UNKNOWN";
  if (status === "RECEIVED") return "SUCCESS";
  if (FAILURE_STATUSES.has(status) || /^HTTP_[1-5]\d\d$/.test(status)) return "FAILED";
  return "UNKNOWN";
}

function validAuditRequest(request, maxTextLength) {
  const requestIdValid = request?.requestId === null ||
    (Number.isSafeInteger(request?.requestId) && request.requestId >= 0) ||
    (typeof request?.requestId === "string" && SAFE_ID.test(request.requestId));
  const slotValid = request?.slot === null ||
    (Number.isSafeInteger(request?.slot) && request.slot >= 0);
  const bytesValid = request?.bytes === null ||
    (Number.isSafeInteger(request?.bytes) && request.bytes >= 0);
  return hasExactKeys(request, [
    "cycleIndex", "requestId", "provider", "endpointKind", "requested", "returned",
    "slot", "status", "outcome", "reason", "requestedAt", "receivedAt",
    "observedAtBasis", "bytes"
  ]) &&
    Number.isSafeInteger(request.cycleIndex) && request.cycleIndex >= 0 &&
    requestIdValid &&
    (request.provider === null || PROVIDERS.has(request.provider)) &&
    validAuditText(request.endpointKind, Math.min(64, maxTextLength)) &&
    validAuditIdentity(request.requested) &&
    validAuditIdentity(request.returned) &&
    slotValid &&
    validAuditCode(request.status) &&
    ["SUCCESS", "FAILED", "UNKNOWN"].includes(request.outcome) &&
    request.outcome === requestClassification(request.status) &&
    validAuditText(request.reason, maxTextLength) &&
    validAuditTime(request.requestedAt) &&
    validAuditTime(request.receivedAt) &&
    (request.observedAtBasis === null ||
      request.observedAtBasis === "response-receipt-not-source-event-time") &&
    bytesValid;
}

function statusClassification(status, allowed) {
  return allowed.has(status) ? status : "UNKNOWN";
}

function safeCheckEntries(value, allowedStatuses, text) {
  if (!isRecord(value)) return {checks: [], omitted: 0};
  const entries = Object.entries(value);
  return {
    checks: entries.slice(0, MAX_CHECK_ROWS).map(([name, check]) => ({
      name: text(name, 64) ?? "UNKNOWN",
      status: statusClassification(check?.status, allowedStatuses),
      reason: text(check?.reason),
      source: text(check?.source, 96),
      observedAt: safeTime(check?.observedAt)
    })),
    omitted: Math.max(0, entries.length - MAX_CHECK_ROWS)
  };
}

function countStatuses(records, field, statuses) {
  const counts = Object.fromEntries(statuses.map(status => [status, 0]));
  for (const record of records) {
    const status = record[field];
    if (Object.hasOwn(counts, status)) counts[status] += 1;
    else counts.UNKNOWN += 1;
  }
  return counts;
}

function reasonSummary(records) {
  const counts = new Map();
  const recordReason = (stage, gate, status, reason) => {
    if (!reason || status === "PASS") return;
    const key = canonicalJson([stage, gate, status, reason]);
    const current = counts.get(key) ?? {stage, gate, status, reason, count: 0};
    current.count += 1;
    counts.set(key, current);
  };
  for (const candidate of records) {
    for (const stage of ["filter", "analysis"]) {
      recordReason(stage, "overall", candidate[stage].status, candidate[stage].reason);
      for (const check of candidate[stage].checks) {
        recordReason(stage, check.name, check.status, check.reason);
      }
    }
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count ||
      left.stage.localeCompare(right.stage) ||
      left.gate.localeCompare(right.gate) ||
      left.reason.localeCompare(right.reason))
    .slice(0, 10);
}

function summarize(requests, candidates, accounting) {
  const expectedRequests = accounting?.providerEvents ?? null;
  const expectedCandidates = accounting?.candidates ?? null;
  const expectedRequestRows = expectedRequests === null ? requests.length : expectedRequests;
  const expectedCandidateRows = expectedCandidates === null ? candidates.length : expectedCandidates;
  const detailedRequests = Math.min(requests.length, expectedRequestRows);
  const detailedCandidates = Math.min(candidates.length, expectedCandidateRows);
  const requestOutcomes = {SUCCESS: 0, FAILED: 0, UNKNOWN: 0};
  for (const request of requests.slice(0, detailedRequests)) {
    requestOutcomes[request.outcome] += 1;
  }
  const omittedRequests = expectedRequests === null
    ? null : Math.max(0, expectedRequests - detailedRequests);
  if (omittedRequests !== null) requestOutcomes.UNKNOWN += omittedRequests;
  const filterOutcomes = countStatuses(candidates.slice(0, detailedCandidates), "filterStatus",
    ["PASS", "REJECT", "UNKNOWN"]);
  const analystOutcomes = countStatuses(candidates.slice(0, detailedCandidates), "analysisStatus",
    ["PASS", "REJECT", "UNKNOWN", "SCORE_UNAVAILABLE", "BLOCKED"]);
  const omittedCandidates = expectedCandidates === null
    ? null : Math.max(0, expectedCandidates - detailedCandidates);
  const omittedChecks = candidates.slice(0, detailedCandidates).reduce((totals, candidate) => {
    totals.filter += candidate.filter.omittedChecks;
    totals.analysis += candidate.analysis.omittedChecks;
    return totals;
  }, {filter: 0, analysis: 0});
  if (omittedCandidates !== null) {
    filterOutcomes.UNKNOWN += omittedCandidates;
    analystOutcomes.UNKNOWN += omittedCandidates;
  }
  return {
    requests: {
      expected: expectedRequests,
      detailed: detailedRequests,
      unexpected: Math.max(0, requests.length - detailedRequests),
      omitted: omittedRequests,
      successful: requestOutcomes.SUCCESS,
      failed: requestOutcomes.FAILED,
      unknown: requestOutcomes.UNKNOWN,
      totalsReconciled: expectedRequests !== null &&
        Math.max(0, requests.length - detailedRequests) === 0 &&
        detailedRequests + (omittedRequests ?? 0) === expectedRequests
    },
    candidates: {
      expected: expectedCandidates,
      detailed: detailedCandidates,
      unexpected: Math.max(0, candidates.length - detailedCandidates),
      omitted: omittedCandidates,
      filterOutcomes,
      analystOutcomes,
      omittedChecks,
      majorBlockReasons: reasonSummary(candidates.slice(0, detailedCandidates)),
      totalsReconciled: expectedCandidates !== null &&
        Math.max(0, candidates.length - detailedCandidates) === 0 &&
        detailedCandidates + omittedCandidates === expectedCandidates
    }
  };
}

function makeSnapshot(state, requestRecords, candidateRecords, byteTruncated) {
  const accounting = state.accounting;
  const summary = summarize(requestRecords, candidateRecords, accounting);
  return {
    schema: OBSERVATION_AUDIT_SCHEMA,
    runId: state.runId,
    configHash: state.configHash,
    state: state.terminal === null ? "RUNNING" : "TERMINAL",
    bounds: {
      maxBytes: state.maxBytes,
      maxProviderRequestRows: state.maxRequestRows,
      maxCandidateRows: state.maxCandidateRows,
      maxChecksPerCandidate: MAX_CHECK_ROWS,
      maxTextLength: MAX_TEXT_LENGTH
    },
    accounting: accounting === null
      ? {status: "UNKNOWN", providerAccounting: null}
      : {status: "KNOWN", providerAccounting: accounting},
    terminal: state.terminal,
    truncation: {
      providerRows: state.requestRowsTruncated || requestRecords.length < state.requests.length,
      candidateRows: state.candidateRowsTruncated || candidateRecords.length < state.candidates.length,
      filterChecks: state.filterChecksTruncated,
      analysisChecks: state.analysisChecksTruncated,
      byteLimit: byteTruncated,
      textFields: state.textTruncated
    },
    omissions: {
      providerRequests: summary.requests.omitted,
      unexpectedProviderEvents: summary.requests.unexpected,
      candidateOutcomes: summary.candidates.omitted,
      unexpectedCandidateOutcomes: summary.candidates.unexpected,
      filterChecks: summary.candidates.omittedChecks.filter,
      analysisChecks: summary.candidates.omittedChecks.analysis
    },
    summary,
    records: {providerRequests: requestRecords, candidates: candidateRecords}
  };
}

function buildSnapshot(state) {
  let requests = state.requests;
  let candidates = state.candidates;
  let byteTruncated = false;
  let snapshot = makeSnapshot(state, requests, candidates, byteTruncated);
  if (Buffer.byteLength(canonicalJson(snapshot), "utf8") <= state.maxBytes) return snapshot;

  byteTruncated = true;
  let low = 0;
  let high = requests.length;
  let best = makeSnapshot(state, [], candidates, byteTruncated);
  if (Buffer.byteLength(canonicalJson(best), "utf8") <= state.maxBytes) {
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = makeSnapshot(state, requests.slice(0, middle), candidates, byteTruncated);
      if (Buffer.byteLength(canonicalJson(candidate), "utf8") <= state.maxBytes) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return best;
  }

  low = 0;
  high = candidates.length;
  best = makeSnapshot(state, [], [], byteTruncated);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = makeSnapshot(state, [], candidates.slice(0, middle), byteTruncated);
    if (Buffer.byteLength(canonicalJson(candidate), "utf8") <= state.maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (Buffer.byteLength(canonicalJson(best), "utf8") > state.maxBytes) {
    throw new RangeError("observation audit header exceeds its byte limit");
  }
  return best;
}

export function createObservationAudit({
  runId,
  configHash,
  maxRequests,
  maxCandidates,
  maxBytes = MAX_OBSERVATION_AUDIT_BYTES
} = {}) {
  if (typeof runId !== "string" || !SAFE_ID.test(runId) ||
      typeof configHash !== "string" || !/^[a-f0-9]{64}$/.test(configHash) ||
      !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > MAX_REQUEST_ROWS ||
      !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > MAX_CANDIDATE_ROWS ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_OBSERVATION_AUDIT_BYTES) {
    throw new TypeError("observation audit identity or bound is invalid");
  }
  const state = {
    runId,
    configHash,
    maxRequestRows: maxRequests,
    maxCandidateRows: maxCandidates,
    maxBytes,
    requests: [],
    candidates: [],
    requestRowsTruncated: false,
    candidateRowsTruncated: false,
    filterChecksTruncated: false,
    analysisChecksTruncated: false,
    textTruncated: false,
    accounting: null,
    terminal: null
  };

  return Object.freeze({
    recordProviderEvents(events, cycleIndex) {
      if (!Number.isSafeInteger(cycleIndex) || cycleIndex < 0) {
        throw new TypeError("observation cycle index is invalid");
      }
      const text = (value, maxLength) =>
        safeText(value, maxLength, () => { state.textTruncated = true; });
      if (!Array.isArray(events)) {
        state.requestRowsTruncated = true;
        return;
      }
      const limit = Math.min(events.length, state.maxRequestRows + 1);
      for (let index = 0; index < limit; index += 1) {
        if (state.requests.length >= state.maxRequestRows) {
          state.requestRowsTruncated = true;
          break;
        }
        const event = events[index];
        const status = digestSafeCode(event?.status);
        const requestedIdentity = safeIdentity(event?.requested);
        const returnedIdentity = safeIdentity(event?.returned);
        state.requests.push({
          cycleIndex,
          requestId: safeRequestId(event?.requestId),
          provider: PROVIDERS.has(event?.provider) ? event.provider : null,
          endpointKind: text(event?.endpointKind, 64),
          requested: requestedIdentity,
          returned: returnedIdentity,
          slot: Number.isSafeInteger(event?.returned?.slot) && event.returned.slot >= 0
            ? event.returned.slot : null,
          status,
          outcome: requestClassification(status),
          reason: text(event?.reason),
          requestedAt: safeTime(event?.requestedAt),
          receivedAt: safeTime(event?.receivedAt),
          observedAtBasis: event?.observedAtBasis === "response-receipt-not-source-event-time"
            ? event.observedAtBasis : null,
          bytes: Number.isSafeInteger(event?.bytes) && event.bytes >= 0 ? event.bytes : null
        });
      }
      if (events.length > limit) state.requestRowsTruncated = true;
    },
    recordCandidate(candidate, filters, analysis, cycleIndex) {
      if (state.candidates.length >= state.maxCandidateRows) {
        state.candidateRowsTruncated = true;
        return;
      }
      const filterStatus = statusClassification(filters?.status, new Set(["PASS", "REJECT", "UNKNOWN"]));
      const analysisStatus = statusClassification(analysis?.status,
        new Set(["PASS", "REJECT", "UNKNOWN", "SCORE_UNAVAILABLE", "BLOCKED"]));
      const text = (value, maxLength) =>
        safeText(value, maxLength, () => { state.textTruncated = true; });
      const filterChecks = safeCheckEntries(filters?.checks,
        new Set(["PASS", "REJECT", "UNKNOWN"]), text);
      const analysisChecks = safeCheckEntries(analysis?.components,
        new Set(["PASS", "REJECT", "UNKNOWN"]), text);
      if (filterChecks.omitted > 0) state.filterChecksTruncated = true;
      if (analysisChecks.omitted > 0) state.analysisChecksTruncated = true;
      state.candidates.push({
        cycleIndex: Number.isSafeInteger(cycleIndex) && cycleIndex >= 0 ? cycleIndex : null,
        identity: safeIdentity(candidate),
        sampledAt: safeTime(candidate?.sampledAt),
        filterStatus,
        analysisStatus,
        filter: {
          status: filterStatus,
          reason: text(filters?.reason),
          checks: filterChecks.checks,
          omittedChecks: filterChecks.omitted
        },
        analysis: {
          status: analysisStatus,
          reason: text(analysis?.reason),
          checks: analysisChecks.checks,
          omittedChecks: analysisChecks.omitted
        }
      });
    },
    setProviderAccounting(totals) {
      const keys = ["requests", "bytes", "providerEvents", "dexRequests", "rpcRequests", "candidates"];
      if (!isRecord(totals) || Object.keys(totals).sort().join(",") !== [...keys].sort().join(",") ||
          keys.some(key => !Number.isSafeInteger(totals[key]) || totals[key] < 0) ||
          totals.requests !== totals.providerEvents ||
          totals.dexRequests + totals.rpcRequests !== totals.requests) {
        state.accounting = null;
        return false;
      }
      state.accounting = Object.fromEntries(keys.map(key => [key, totals[key]]));
      return true;
    },
    setTerminal({runStatus, controllerStatus, stopReason, failureCode} = {}) {
      state.terminal = {
        runStatus: runStatus === null ? null : digestSafeCode(runStatus),
        controllerStatus: controllerStatus === null ? null : digestSafeCode(controllerStatus),
        stopReason: stopReason === null ? null : digestSafeCode(stopReason),
        failureCode: failureCode === null ? null : digestSafeCode(failureCode)
      };
    },
    snapshot() {
      return buildSnapshot(state);
    }
  });
}

export function validateObservationAudit(audit, {runId, configHash} = {}) {
  if (typeof runId !== "string" || !SAFE_ID.test(runId) ||
      typeof configHash !== "string" || !/^[a-f0-9]{64}$/.test(configHash) ||
      !hasExactKeys(audit, [
        "schema", "runId", "configHash", "state", "bounds", "accounting", "terminal",
        "truncation", "omissions", "summary", "records"
      ]) || audit.schema !== OBSERVATION_AUDIT_SCHEMA ||
      audit.runId !== runId || audit.configHash !== configHash ||
      !["RUNNING", "TERMINAL"].includes(audit.state) ||
      !hasExactKeys(audit.bounds, [
        "maxBytes", "maxProviderRequestRows", "maxCandidateRows",
        "maxChecksPerCandidate", "maxTextLength"
      ]) ||
      !hasExactKeys(audit.accounting, ["status", "providerAccounting"]) ||
      !hasExactKeys(audit.truncation, [
        "providerRows", "candidateRows", "filterChecks", "analysisChecks", "byteLimit", "textFields"
      ]) ||
      !hasExactKeys(audit.omissions, [
        "providerRequests", "unexpectedProviderEvents", "candidateOutcomes",
        "unexpectedCandidateOutcomes", "filterChecks", "analysisChecks"
      ]) ||
      !hasExactKeys(audit.records, ["providerRequests", "candidates"]) ||
      !Array.isArray(audit.records.providerRequests) || !Array.isArray(audit.records.candidates) ||
      audit.records.providerRequests.length > MAX_REQUEST_ROWS ||
      audit.records.candidates.length > MAX_CANDIDATE_ROWS ||
      !Number.isSafeInteger(audit.bounds.maxBytes) || audit.bounds.maxBytes < 1024 ||
      audit.bounds.maxBytes > MAX_OBSERVATION_AUDIT_BYTES ||
      !Number.isSafeInteger(audit.bounds.maxProviderRequestRows) ||
      audit.bounds.maxProviderRequestRows < 1 || audit.bounds.maxProviderRequestRows > MAX_REQUEST_ROWS ||
      !Number.isSafeInteger(audit.bounds.maxCandidateRows) ||
      audit.bounds.maxCandidateRows < 1 || audit.bounds.maxCandidateRows > MAX_CANDIDATE_ROWS ||
      !Number.isSafeInteger(audit.bounds.maxChecksPerCandidate) ||
      audit.bounds.maxChecksPerCandidate < 1 || audit.bounds.maxChecksPerCandidate > MAX_CHECK_ROWS ||
      !Number.isSafeInteger(audit.bounds.maxTextLength) ||
      audit.bounds.maxTextLength < 1 || audit.bounds.maxTextLength > MAX_TEXT_LENGTH ||
      audit.records.providerRequests.length > audit.bounds.maxProviderRequestRows ||
      audit.records.candidates.length > audit.bounds.maxCandidateRows ||
      typeof audit.truncation.providerRows !== "boolean" ||
      typeof audit.truncation.candidateRows !== "boolean" ||
      typeof audit.truncation.filterChecks !== "boolean" ||
      typeof audit.truncation.analysisChecks !== "boolean" ||
      typeof audit.truncation.byteLimit !== "boolean" ||
      typeof audit.truncation.textFields !== "boolean" ||
      !Number.isSafeInteger(audit.omissions.unexpectedProviderEvents) ||
      audit.omissions.unexpectedProviderEvents < 0 ||
      !Number.isSafeInteger(audit.omissions.unexpectedCandidateOutcomes) ||
      audit.omissions.unexpectedCandidateOutcomes < 0 ||
      !Number.isSafeInteger(audit.omissions.filterChecks) || audit.omissions.filterChecks < 0 ||
      !Number.isSafeInteger(audit.omissions.analysisChecks) || audit.omissions.analysisChecks < 0 ||
      (audit.omissions.providerRequests !== null &&
        (!Number.isSafeInteger(audit.omissions.providerRequests) || audit.omissions.providerRequests < 0)) ||
      (audit.omissions.candidateOutcomes !== null &&
        (!Number.isSafeInteger(audit.omissions.candidateOutcomes) || audit.omissions.candidateOutcomes < 0)) ||
      (audit.state === "RUNNING" && audit.terminal !== null) ||
      (audit.state === "TERMINAL" &&
       (!hasExactKeys(audit.terminal, ["runStatus", "controllerStatus", "stopReason", "failureCode"]) ||
        !["runStatus", "controllerStatus", "stopReason", "failureCode"]
          .every(field => validAuditCode(audit.terminal[field])))) ||
      !isRecord(audit.summary) ||
      !isRecord(audit.summary.requests) || !isRecord(audit.summary.candidates)) return false;
  const providerAccounting = audit.accounting.status === "KNOWN"
    ? audit.accounting.providerAccounting : null;
  if ((audit.accounting.status !== "UNKNOWN" && audit.accounting.status !== "KNOWN") ||
      (audit.accounting.status === "UNKNOWN" && audit.accounting.providerAccounting !== null)) return false;
  if (audit.accounting.status === "KNOWN" &&
      (!isRecord(providerAccounting) ||
       !hasExactKeys(providerAccounting, [
         "requests", "bytes", "providerEvents", "dexRequests", "rpcRequests", "candidates"
       ]) ||
       !["requests", "bytes", "providerEvents", "dexRequests", "rpcRequests", "candidates"]
         .every(key => Number.isSafeInteger(providerAccounting[key]) && providerAccounting[key] >= 0) ||
       providerAccounting.requests !== providerAccounting.providerEvents ||
       providerAccounting.dexRequests + providerAccounting.rpcRequests !== providerAccounting.requests)) {
    return false;
  }
  if (audit.records.providerRequests.some(request =>
    !validAuditRequest(request, audit.bounds.maxTextLength))) return false;
  if (audit.records.candidates.some(candidate =>
    !hasExactKeys(candidate, [
      "cycleIndex", "identity", "sampledAt", "filterStatus", "analysisStatus", "filter", "analysis"
    ]) ||
    (candidate.cycleIndex !== null &&
      (!Number.isSafeInteger(candidate.cycleIndex) || candidate.cycleIndex < 0)) ||
    !validAuditIdentity(candidate.identity) || !validAuditTime(candidate.sampledAt) ||
    !hasExactKeys(candidate.filter, ["status", "reason", "checks", "omittedChecks"]) ||
    !hasExactKeys(candidate.analysis, ["status", "reason", "checks", "omittedChecks"]) ||
    !Array.isArray(candidate.filter.checks) || !Array.isArray(candidate.analysis.checks) ||
    candidate.filter.checks.length > audit.bounds.maxChecksPerCandidate ||
    candidate.analysis.checks.length > audit.bounds.maxChecksPerCandidate ||
    !Number.isSafeInteger(candidate.filter.omittedChecks) || candidate.filter.omittedChecks < 0 ||
    !Number.isSafeInteger(candidate.analysis.omittedChecks) || candidate.analysis.omittedChecks < 0 ||
    !validAuditText(candidate.filter.reason, audit.bounds.maxTextLength) ||
    !validAuditText(candidate.analysis.reason, audit.bounds.maxTextLength) ||
    [...candidate.filter.checks, ...candidate.analysis.checks].some(check =>
      !hasExactKeys(check, ["name", "status", "reason", "source", "observedAt"]) ||
      typeof check.name !== "string" || check.name.length === 0 ||
      !validAuditText(check.name, Math.min(64, audit.bounds.maxTextLength)) ||
      !["PASS", "REJECT", "UNKNOWN"].includes(check.status) ||
      !validAuditText(check.reason, audit.bounds.maxTextLength) ||
      !validAuditText(check.source, Math.min(96, audit.bounds.maxTextLength)) ||
      !validAuditTime(check.observedAt)) ||
    candidate.filterStatus !== candidate.filter.status ||
    candidate.analysisStatus !== candidate.analysis.status ||
    !["PASS", "REJECT", "UNKNOWN"].includes(candidate.filterStatus) ||
    !["PASS", "REJECT", "UNKNOWN", "SCORE_UNAVAILABLE", "BLOCKED"].includes(candidate.analysisStatus))) {
    return false;
  }
  const recomputed = summarize(audit.records.providerRequests, audit.records.candidates, providerAccounting);
  return Buffer.byteLength(canonicalJson(audit), "utf8") <= audit.bounds.maxBytes &&
    Buffer.byteLength(canonicalJson(audit), "utf8") <= MAX_OBSERVATION_AUDIT_BYTES &&
    canonicalJson(recomputed) === canonicalJson(audit.summary) &&
    (audit.truncation.filterChecks || recomputed.candidates.omittedChecks.filter === 0) &&
    (audit.truncation.analysisChecks || recomputed.candidates.omittedChecks.analysis === 0) &&
    audit.omissions.providerRequests === recomputed.requests.omitted &&
    audit.omissions.unexpectedProviderEvents === recomputed.requests.unexpected &&
    audit.omissions.candidateOutcomes === recomputed.candidates.omitted &&
    audit.omissions.unexpectedCandidateOutcomes === recomputed.candidates.unexpected &&
    audit.omissions.filterChecks === recomputed.candidates.omittedChecks.filter &&
    audit.omissions.analysisChecks === recomputed.candidates.omittedChecks.analysis;
}

export function renderObservationAudit(audit) {
  const requests = audit.summary.requests;
  const candidates = audit.summary.candidates;
  const lines = [
    "## Bounded observation audit (separate from ledger)",
    `Run: ${audit.runId}; config SHA-256: ${audit.configHash}`,
    `Audit state: ${audit.state}; terminal run/controller/failure: ${audit.terminal?.runStatus ?? "UNKNOWN"}/${audit.terminal?.controllerStatus ?? "UNKNOWN"}/${audit.terminal?.failureCode === null ? "null" : audit.terminal?.failureCode ?? "UNKNOWN"}`,
    `Provider requests: successful=${requests.successful}, failed=${requests.failed}, unknown=${requests.unknown}; detailed=${requests.detailed}, omitted=${requests.omitted ?? "UNKNOWN"}, unexpected=${requests.unexpected}`,
    `Candidate outcomes: detailed=${candidates.detailed}, omitted=${candidates.omitted ?? "UNKNOWN"}, unexpected=${candidates.unexpected}`,
    `Filter outcomes: PASS=${candidates.filterOutcomes.PASS}, REJECT=${candidates.filterOutcomes.REJECT}, UNKNOWN=${candidates.filterOutcomes.UNKNOWN}`,
    `Analyst outcomes: PASS=${candidates.analystOutcomes.PASS}, REJECT=${candidates.analystOutcomes.REJECT}, UNKNOWN=${candidates.analystOutcomes.UNKNOWN}, SCORE_UNAVAILABLE=${candidates.analystOutcomes.SCORE_UNAVAILABLE}, BLOCKED=${candidates.analystOutcomes.BLOCKED}`,
    `Checks omitted: filter=${candidates.omittedChecks.filter}, analyst=${candidates.omittedChecks.analysis}; check truncation filter=${audit.truncation.filterChecks}, analyst=${audit.truncation.analysisChecks}`,
    `Totals reconcile: requests=${requests.totalsReconciled ? "YES" : "UNKNOWN"}, candidates=${candidates.totalsReconciled ? "YES" : "UNKNOWN"}`,
    `Truncated: provider rows=${audit.truncation.providerRows}, candidate rows=${audit.truncation.candidateRows}, byte limit=${audit.truncation.byteLimit}, text fields=${audit.truncation.textFields}`,
    "Major non-PASS reasons:"
  ];
  if (candidates.majorBlockReasons.length === 0) lines.push("- none recorded");
  else {
    for (const reason of candidates.majorBlockReasons) {
      lines.push(`- ${reason.stage}.${reason.gate} ${reason.status} (${reason.count}): ${reason.reason}`);
    }
  }
  return lines.join("\n");
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function persistObservationAudit(filePath, audit, {
  maxWrites = MAX_OBSERVATION_AUDIT_WRITES,
  maxTotalBytes = MAX_OBSERVATION_AUDIT_WRITE_BYTES
} = {}) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath) ||
      typeof audit?.snapshot !== "function" ||
      !Number.isSafeInteger(maxWrites) || maxWrites < 1 || maxWrites > MAX_OBSERVATION_AUDIT_WRITES ||
      !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 ||
      maxTotalBytes > MAX_OBSERVATION_AUDIT_WRITE_BYTES) {
    throw new TypeError("observation audit persistence requires an absolute path and audit");
  }
  const previous = persistenceTotals.get(audit) ?? {writes: 0, bytes: 0};
  if (previous.writes >= maxWrites) {
    throw new RangeError("observation audit exceeded its atomic write-count budget");
  }
  const snapshot = audit.snapshot();
  const bytes = Buffer.from(canonicalJson(snapshot), "utf8");
  if (bytes.length > snapshot.bounds.maxBytes || bytes.length > MAX_OBSERVATION_AUDIT_BYTES) {
    throw new RangeError("observation audit exceeds its configured byte limit");
  }
  if (previous.bytes + bytes.length > maxTotalBytes) {
    throw new RangeError("observation audit exceeded its cumulative byte-write budget");
  }
  const directory = path.dirname(filePath);
  const temporary = path.join(directory,
    `.observation-audit-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, filePath);
    await syncDirectory(directory);
    persistenceTotals.set(audit, {writes: previous.writes + 1, bytes: previous.bytes + bytes.length});
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
  return {bytes: bytes.length, snapshot};
}
