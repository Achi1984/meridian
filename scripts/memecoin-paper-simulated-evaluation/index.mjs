import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalCheckpointBytes, MAX_CHECKPOINT_BYTES} from "../memecoin-paper/checkpoint-store.mjs";

export const EVALUATION_SCHEMA = "MEMECOIN_SIMULATED_PILOT_EVALUATION_V1";
export const EXPORT_SCHEMA = "memecoin-paper-run-export/v1";
export const START_BINDING_SCHEMA = "memecoin-paper-start-binding/v1";
export const MAX_EXPORT_BYTES = 2 * MAX_CHECKPOINT_BYTES;

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const CHECKPOINT_POLICY = "memecoin-paper-ledger-v2-monotonic-time";
const METHODS = new Set(["authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"]);
const COST_KEYS = ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"];
const SYNTHETIC_SOURCE = "SYNTHETIC_FIXTURE_ONLY";
const EXPORT_FIELDS = [
  "schemaVersion", "producerRevision", "config", "configSha256", "runId", "startedAt",
  "deadlineAt", "policyVersion", "runnerReport", "checkpoint", "checkpointSha256",
  "persistence", "exportBinding", "bindingReceipt"
];
const BINDING_FIELDS = [
  "schemaVersion", "producerRevision", "runId", "startedAt", "deadlineAt",
  "policyVersion", "configSha256", "externalInputSha256", "receiptSha256"
];
const PERSISTENCE = new Set(["ACKNOWLEDGED", "UNKNOWN", "NOT_STARTED"]);
const MAX_NODES = 200_000;
const BUDGET_KEYS = [
  "requests", "bytes", "events", "candidates", "cycles", "durationMs",
  "callbackTimeoutMs", "maxWallClockUncertaintyMs"
];
const BUDGET_MAXIMA = {
  requests: 960,
  bytes: MAX_CHECKPOINT_BYTES,
  events: 1_000,
  candidates: 100,
  cycles: 256,
  durationMs: 8 * 60 * 60 * 1000,
  callbackTimeoutMs: 30_000,
  maxWallClockUncertaintyMs: 60_000
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected) {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) {
    return false;
  }
  return expected.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor;
  });
}

function integerTime(value) {
  return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime());
}

function safeTime(value) {
  if (integerTime(value)) return value;
  if (typeof value !== "string" || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoundedJson(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
      bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new RangeError("export bytes are empty or exceed the bounded export limit");
  }
  const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  const value = JSON.parse(text);
  let nodes = 0;
  const visit = (item, depth = 0) => {
    if (++nodes > MAX_NODES || depth > 64) throw new RangeError("export exceeds structural limits");
    if (item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value);
  return value;
}

function resultDigest(value) {
  return sha256(canonicalCheckpointBytes(value));
}

function recordHashes(checkpoint) {
  const {runHeader, records} = checkpoint;
  const prefixHash = createHash("sha256").update('{"formatVersion":1,"records":[');
  const headerBytes = canonicalCheckpointBytes(runHeader);
  const hashes = [];
  let predecessorHash = null;
  const commandIds = new Set();
  for (let sequence = 0; sequence < records.length; sequence += 1) {
    const record = records[sequence];
    if (!isRecord(record) || record.sequence !== sequence ||
        record.runId !== runHeader.runId || record.predecessorHash !== predecessorHash ||
        typeof record.commandId !== "string" || commandIds.has(record.commandId) ||
        !HASH.test(record.resultDigest ?? "") ||
        (sequence === 0
          ? record.commandId !== "__header__" || record.method !== "constructor"
          : !SAFE_ID.test(record.commandId) || !METHODS.has(record.method))) {
      return null;
    }
    if (sequence === 0 &&
        (!canonicalCheckpointBytes(record.inputs).equals(headerBytes) ||
         record.resultDigest !== resultDigest({...runHeader, constructorStatus: "INITIALIZED"}))) {
      return null;
    }
    commandIds.add(record.commandId);
    if (sequence > 0) prefixHash.update(",");
    prefixHash.update(canonicalCheckpointBytes(record));
    predecessorHash = prefixHash.copy()
      .update(`],"runHeader":${headerBytes.toString("utf8")},"sequence":${sequence}}`)
      .digest("hex");
    hashes.push(predecessorHash);
  }
  return hashes;
}

function checkExport(exportValue, expected, checks) {
  const fail = (id, reason) => checks.push({id, status: "FAIL", reason});
  const pass = (id, reason) => checks.push({id, status: "PASS", reason});
  const unknown = (id, reason) => checks.push({id, status: "UNKNOWN", reason});
  const expectedValid = exactKeys(expected, ["runId", "configSha256", "producerRevision"]) &&
    SAFE_ID.test(expected.runId ?? "") &&
    HASH.test(expected.configSha256 ?? "") &&
    SAFE_REVISION.test(expected.producerRevision ?? "");
  if (!expectedValid) fail("expected_binding", "independent run, config digest, or producer expectation is invalid");
  else pass("expected_binding", "independent run, config digest, and producer expectations are well formed");

  if (!exactKeys(exportValue, EXPORT_FIELDS)) {
    fail("export_contract", "export envelope does not use the exact v1 field set");
    return {exportValue, expectedValid, checks};
  }
  const validSchema = exportValue.schemaVersion === EXPORT_SCHEMA;
  if (validSchema) pass("export_contract", "export uses the agreed memecoin-paper-run-export/v1 envelope");
  else fail("export_contract", "export schema version is unsupported");

  const producerMatches = SAFE_REVISION.test(exportValue.producerRevision ?? "") &&
    exportValue.producerRevision === expected.producerRevision;
  if (producerMatches) pass("producer_binding", "producer revision matches the independent expectation");
  else fail("producer_binding", "producer revision is absent or does not match the independent expectation");

  const config = exportValue.config;
  let configBytes;
  let configDigest = null;
  try {
    configBytes = canonicalCheckpointBytes(config);
    configDigest = sha256(configBytes);
  } catch {
    configBytes = null;
  }
  const configShape = exactKeys(config, ["version", "mode", "enabled", "runId", "startedAt", "budgets"]) &&
    config.version === 1 && config.enabled === true &&
    ["SYNTHETIC_TEST_ONLY", "EXTERNAL_READ_ONLY_INPUT"].includes(config.mode) &&
    SAFE_ID.test(config.runId ?? "") && integerTime(config.startedAt) &&
    exactKeys(config.budgets, BUDGET_KEYS) &&
    BUDGET_KEYS.every(key => {
      const minimum = key === "maxWallClockUncertaintyMs" ? 0 : key === "bytes" ? 1_024 : 1;
      return Number.isSafeInteger(config.budgets[key]) &&
        config.budgets[key] >= minimum && config.budgets[key] <= BUDGET_MAXIMA[key];
    }) &&
    config.budgets.callbackTimeoutMs <= config.budgets.durationMs;
  const expectedDeadline = integerTime(config?.startedAt) ? config.startedAt + 8 * 60 * 60 * 1000 : null;
  const configMatches = configShape && configDigest === exportValue.configSha256 &&
    exportValue.configSha256 === expected.configSha256 &&
    exportValue.runId === expected.runId && config.runId === expected.runId &&
    exportValue.startedAt === config.startedAt && exportValue.deadlineAt === expectedDeadline &&
    exportValue.policyVersion === CHECKPOINT_POLICY &&
    exportValue.policyVersion === (config.policyVersion ?? CHECKPOINT_POLICY);
  if (!configShape) fail("config_contract", "canonical composition config is invalid or outside the bounded v1 schema");
  else if (!configMatches) fail("config_binding", "config digest, run identity, time window, or policy does not match expected values");
  else pass("config_binding", "canonical config digest, run identity, fixed window, and policy are bound");

  const bindingReceipt = exportValue.bindingReceipt;
  if (exportValue.exportBinding === "EXPORT_ASSERTED" && bindingReceipt === null) {
    unknown("historical_run_binding", "no immutable pre-start binding receipt exists; matching after-the-fact hashes are assertions only");
  } else if (exportValue.exportBinding !== "PRESTART_BOUND" ||
      !exactKeys(bindingReceipt, BINDING_FIELDS)) {
    fail("historical_run_binding", "pre-start binding label and receipt are missing or inconsistent");
  } else {
    const {receiptSha256, ...unsigned} = bindingReceipt;
    const receiptValid = bindingReceipt.schemaVersion === START_BINDING_SCHEMA &&
      bindingReceipt.producerRevision === expected.producerRevision &&
      bindingReceipt.runId === expected.runId &&
      bindingReceipt.startedAt === config?.startedAt &&
      bindingReceipt.deadlineAt === expectedDeadline &&
      bindingReceipt.policyVersion === CHECKPOINT_POLICY &&
      bindingReceipt.configSha256 === expected.configSha256 &&
      (bindingReceipt.externalInputSha256 === null ||
        HASH.test(bindingReceipt.externalInputSha256 ?? "")) &&
      HASH.test(receiptSha256 ?? "") &&
      receiptSha256 === resultDigest(unsigned);
    if (receiptValid) pass("historical_run_binding", "immutable pre-start receipt binds config, producer, run, and window");
    else fail("historical_run_binding", "pre-start binding receipt digest or identity does not reconcile");
  }

  let checkpoint = exportValue.checkpoint;
  let checkpointBytes = null;
  let checkpointSha = null;
  try {
    if (checkpoint !== null) {
      checkpointBytes = canonicalCheckpointBytes(checkpoint);
      if (checkpointBytes.byteLength <= MAX_CHECKPOINT_BYTES) checkpointSha = sha256(checkpointBytes);
      else checkpointBytes = null;
    }
  } catch {
    checkpointBytes = null;
  }
  const header = checkpoint?.runHeader;
  const records = checkpoint?.records;
  const checkpointShape = checkpointBytes !== null &&
    exactKeys(checkpoint, ["formatVersion", "runHeader", "sequence", "records"]) &&
    checkpoint.formatVersion === 1 && isRecord(header) &&
    header.runId === expected.runId && header.startedAt === config?.startedAt &&
    header.deadlineAt === expectedDeadline && header.policyVersion === CHECKPOINT_POLICY &&
    Array.isArray(records) && records.length > 0 && records.length <= 10_000 &&
    checkpoint.sequence === records.length - 1;
  if (!checkpointShape) {
    if (["UNKNOWN", "NOT_STARTED"].includes(exportValue.persistence) && checkpoint === null) {
      unknown("checkpoint_contract", "checkpoint was not read back or published with known certainty");
    } else fail("checkpoint_contract", "checkpoint is absent, oversized, noncanonical, or mismatches the run header");
  } else if (checkpointSha !== exportValue.checkpointSha256) {
    fail("checkpoint_digest", "full canonical checkpoint does not match checkpointSha256");
  } else pass("checkpoint_digest", "full canonical checkpoint matches checkpointSha256");

  const hashes = checkpointShape ? recordHashes(checkpoint) : null;
  if (!checkpointShape) {
    if (["UNKNOWN", "NOT_STARTED"].includes(exportValue.persistence) && checkpoint === null) {
      unknown("checkpoint_chain", "no checkpoint chain exists because execution was not started");
    }
  } else if (!hashes || hashes.at(-1) !== checkpointSha) {
    fail("checkpoint_chain", "checkpoint predecessor chain, constructor record, or command identity is invalid");
  } else pass("checkpoint_chain", "checkpoint sequence, predecessor hashes, and command identities reconcile");

  const runnerReport = exportValue.runnerReport;
  const operationResults = runnerReport?.operationResults;
  if (!isRecord(runnerReport) || runnerReport.runId !== expected.runId ||
      !["FINISHED", "STOPPED", "UNKNOWN"].includes(runnerReport.status) ||
      !Array.isArray(operationResults) || !Array.isArray(runnerReport.receipts)) {
    if (["NOT_STARTED", "UNKNOWN"].includes(exportValue.persistence) && runnerReport === null) {
      unknown("runner_report", "no complete runner report is available");
    } else fail("runner_report", "runner report is missing or does not match the agreed raw runner contract");
  } else pass("runner_report", "raw runner report has the expected run identity and lifecycle fields");

  const reportReceiptRows = Array.isArray(operationResults)
    ? operationResults.filter(item => item?.receipt !== null && item?.receipt !== undefined) : [];
  const persistedRecords = checkpointShape && Array.isArray(records) ? records.slice(1) : [];
  let receiptTraceValid = Boolean(runnerReport && hashes &&
    reportReceiptRows.length === persistedRecords.length);
  if (receiptTraceValid) {
    for (let index = 0; index < persistedRecords.length; index += 1) {
      const record = persistedRecords[index];
      const operation = reportReceiptRows[index];
      const receipt = operation.receipt;
      if (operation.method !== record.method || !isRecord(receipt) ||
          receipt.runId !== expected.runId || receipt.sequence !== record.sequence ||
          receipt.hash !== hashes[record.sequence] ||
          receipt.resultDigest !== record.resultDigest) {
        receiptTraceValid = false;
        break;
      }
    }
  }
  const reportReceipts = runnerReport?.receipts;
  if (receiptTraceValid && Array.isArray(reportReceipts)) {
    receiptTraceValid = reportReceipts.length === reportReceiptRows.length &&
      reportReceipts.every((receipt, index) =>
        canonicalCheckpointBytes(receipt).equals(canonicalCheckpointBytes(reportReceiptRows[index].receipt)));
  }
  if (receiptTraceValid) pass("runner_receipts", "runner receipt rows map one-to-one to actual checkpoint records");
  else if (["UNKNOWN", "NOT_STARTED"].includes(exportValue.persistence) &&
      persistedRecords.length === 0) {
    unknown("runner_receipts", "no runner receipt rows were published");
  } else fail("runner_receipts", "runner operation receipts do not match actual checkpoint records");

  const terminalReceipt = runnerReport?.terminalReceipt;
  const terminalResult = runnerReport?.terminalResult;
  const finalRecord = checkpointShape ? records.at(-1) : null;
  let terminalValid = false;
  let finishAt = null;
  if (finalRecord?.method === "finishRun" && hashes && isRecord(terminalResult) &&
      isRecord(terminalReceipt) && isRecord(terminalResult.receipt)) {
    finishAt = safeTime(finalRecord.inputs?.now);
    const {commandId, receipt, ...resultWithoutRunnerFields} = terminalResult;
    terminalValid = exactKeys(terminalReceipt, ["runId", "sequence", "hash", "resultDigest"]) &&
      terminalResult.status === "FINISHED" && commandId === finalRecord.commandId &&
      receipt.runId === expected.runId && receipt.sequence === finalRecord.sequence &&
      receipt.hash === checkpointSha && receipt.resultDigest === finalRecord.resultDigest &&
      terminalReceipt.runId === receipt.runId && terminalReceipt.sequence === receipt.sequence &&
      terminalReceipt.hash === receipt.hash && terminalReceipt.resultDigest === receipt.resultDigest &&
      finalRecord.sequence === checkpoint.sequence && hashes.at(-1) === checkpointSha &&
      resultDigest(resultWithoutRunnerFields) === finalRecord.resultDigest &&
      finalRecord.runStart === config?.startedAt &&
      finalRecord.inputs?.startedAt === config?.startedAt &&
      finishAt !== null && finishAt >= config.startedAt;
  }
  if (terminalValid) pass("terminal_receipt", "actual finishRun receipt, command ID, result digest, and checkpoint head reconcile");
  else if (exportValue.persistence === "NOT_STARTED" && checkpoint === null) {
    unknown("terminal_receipt", "no terminal command exists because execution was not started");
  } else if (exportValue.persistence === "UNKNOWN" && !terminalReceipt) {
    unknown("terminal_receipt", "terminal receipt is unavailable; no receipt is inferred");
  } else fail("terminal_receipt", "terminal result and receipt do not bind the final checkpoint finishRun record");

  const persistenceValid = PERSISTENCE.has(exportValue.persistence);
  if (!persistenceValid) fail("persistence", "persistence certainty is outside the agreed enum");
  else if (terminalValid && exportValue.persistence === "ACKNOWLEDGED") {
    pass("persistence", "terminal receipt was read back from the actual checkpoint");
  } else if (exportValue.persistence === "UNKNOWN") {
    unknown("persistence", "durable persistence certainty is UNKNOWN, independently of lifecycle status");
  } else if (exportValue.persistence === "NOT_STARTED" && checkpoint === null) {
    unknown("persistence", "execution and checkpoint publication did not start");
  } else fail("persistence", "ACKNOWLEDGED persistence requires a verified terminal checkpoint receipt");

  const recordTimes = [];
  let timeValid = Boolean(checkpointShape && records);
  if (timeValid) {
    let latest = config.startedAt;
    for (const record of records.slice(1)) {
      const commandTime = safeTime(record.inputs?.now);
      if (commandTime === null || commandTime < latest ||
          (record.method !== "finishRun" && commandTime > expectedDeadline) ||
          (record.method === "finishRun" && commandTime > expectedDeadline &&
            runnerReport?.reason !== "DEADLINE")) {
        timeValid = false;
        break;
      }
      latest = commandTime;
      recordTimes.push(commandTime);
    }
  }
  if (timeValid) pass("time_lifecycle", "record times are monotonic; terminal time is actual and is not backdated");
  else if (exportValue.persistence === "UNKNOWN" && !checkpointShape) {
    unknown("time_lifecycle", "no complete checkpoint time sequence is available");
  } else fail("time_lifecycle", "checkpoint times regress or a late finish lacks a DEADLINE reason");
  if (terminalValid && runnerReport?.reason === "DEADLINE" && finishAt < expectedDeadline) {
    fail("deadline_reason", "DEADLINE terminal time precedes the configured deadline");
  } else if (terminalValid && runnerReport?.reason === "SOURCES_EXHAUSTED" &&
      finishAt > expectedDeadline) {
    fail("deadline_reason", "source exhaustion was reported after the fixed deadline");
  } else if (terminalValid && ["DEADLINE", "SOURCES_EXHAUSTED", "SHUTDOWN"].includes(runnerReport?.reason)) {
    pass("deadline_reason", `runner reason ${runnerReport.reason} is preserved with the actual finish timestamp`);
  } else if (runnerReport?.reason) {
    checks.push({id: "deadline_reason", status: "UNKNOWN", reason: `runner reason ${runnerReport.reason} is retained but not an acceptance completion`});
  }

  let markReuseValid = true;
  const marksByEvent = new Map();
  const quoteEvents = new Set();
  if (checkpointShape) {
    for (const record of records.slice(1)) {
      const input = record.inputs ?? {};
      const commandTime = safeTime(input.now);
      const marks = input.marks ?? [];
      if (!Array.isArray(marks)) {
        markReuseValid = false;
        break;
      }
      const marksByMint = new Set();
      for (const mark of marks) {
        if (!isRecord(mark) || !SAFE_ID.test(mark.eventId ?? "") ||
            typeof mark.mint !== "string" || marksByMint.has(mark.mint) ||
            safeTime(mark.observedAt) === null || safeTime(mark.observedAt) > commandTime) {
          markReuseValid = false;
          break;
        }
        marksByMint.add(mark.mint);
        const digest = resultDigest(mark);
        const prior = marksByEvent.get(mark.eventId);
        if (prior !== undefined && prior !== digest) {
          markReuseValid = false;
          break;
        }
        marksByEvent.set(mark.eventId, digest);
      }
      if (!markReuseValid) break;
      const quote = input.quote;
      if (quote !== undefined) {
        const eventBindingValid = isRecord(quote) && (record.method === "executeEntry"
          ? input.eventId === undefined || input.eventId === quote.eventId
          : record.method === "observeExitQuote" && input.eventId === quote.eventId);
        if (!isRecord(quote) || !SAFE_ID.test(quote.eventId ?? "") ||
            !eventBindingValid || quoteEvents.has(quote.eventId) ||
            safeTime(quote.observedAt) === null || safeTime(quote.observedAt) > commandTime ||
            !["chainId", "mint", "pool", "quote"].every(key =>
              typeof quote[key] === "string" && quote[key].length > 0) ||
            !Number.isSafeInteger(quote.decimals) || quote.decimals < 0 || quote.decimals > 18 ||
            !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0 ||
            quote.mode !== "HYPOTHETICAL" || quote.executable !== true ||
            typeof quote.source !== "string" || quote.source.length === 0 ||
            !exactKeys(quote.costs, COST_KEYS) ||
            !COST_KEYS.every(key => Number.isSafeInteger(quote.costs[key]) && quote.costs[key] >= 0) ||
            (config?.mode === "SYNTHETIC_TEST_ONLY" &&
              (quote.fixtureOnly !== true || quote.source !== SYNTHETIC_SOURCE))) {
          markReuseValid = false;
          break;
        }
        quoteEvents.add(quote.eventId);
      }
    }
  }
  if (markReuseValid && checkpointShape) {
    pass("mark_reuse_consistency", "reused marks are allowed only when the complete event-bound mark is identical");
  } else if (exportValue.persistence === "UNKNOWN" && !checkpointShape) {
    unknown("mark_reuse_consistency", "mark records are unavailable");
  } else fail("mark_reuse_consistency", "a mark event was malformed, reused with changed content, or a quote identity/time failed");

  const entries = Array.isArray(operationResults)
    ? operationResults.filter(item => item?.method === "executeEntry" && item.status === "FILLED_PAPER").length
    : null;
  const closedQuotes = Array.isArray(operationResults)
    ? operationResults.filter(item => item?.method === "observeExitQuote" && item.status === "CLOSED_PAPER").length
    : null;
  const openPositions = Array.isArray(terminalResult?.openPositions)
    ? terminalResult.openPositions : null;
  const summaryOpen = runnerReport?.summary?.openPositions;
  const terminalMints = Array.isArray(openPositions) ? openPositions.map(position => position?.mint) : [];
  const summaryMints = Array.isArray(summaryOpen) ? summaryOpen.map(position => position?.mint) : [];
  const inventoryValid = Array.isArray(openPositions) && Array.isArray(summaryOpen) &&
    terminalMints.every(mint => typeof mint === "string" && mint.length > 0) &&
    new Set(terminalMints).size === terminalMints.length &&
    new Set(summaryMints).size === summaryMints.length &&
    terminalMints.length === summaryMints.length &&
    terminalMints.every(mint => summaryMints.includes(mint)) &&
    openPositions.every(position => position.markStatus === "VALUATION_UNAVAILABLE" ||
      position.markStatus === "MARKED");
  if (inventoryValid) pass("terminal_inventory", "terminal result and raw runner summary agree on open positions");
  else if (exportValue.persistence === "UNKNOWN" && !terminalResult) {
    unknown("terminal_inventory", "terminal position inventory is unavailable");
  } else fail("terminal_inventory", "terminal positions are missing, duplicated, or disagree with runner summary");

  const accounting = terminalResult?.accounting;
  const summaryPnl = runnerReport?.summary?.pnl;
  const unvaluedPositions = Array.isArray(openPositions) && openPositions.length > 0 &&
    openPositions.every(position => position.markStatus === "VALUATION_UNAVAILABLE") &&
    terminalResult?.equityCents === null && accounting === null;
  const accountingValid = isRecord(accounting) && isRecord(summaryPnl) &&
    accounting.cashCents === runnerReport?.summary?.cashCents &&
    accounting.realizedGrossPnlCents === summaryPnl.realizedGrossCents &&
    accounting.realizedNetPnlCents === summaryPnl.realizedNetCents &&
    accounting.grossUnrealizedPnlCents === summaryPnl.unrealizedGrossCents &&
    accounting.netUnrealizedPnlCents === summaryPnl.unrealizedNetCents;
  if (accountingValid) pass("runner_accounting", "terminal accounting agrees with the unmodified runner summary");
  else if (unvaluedPositions) {
    unknown("runner_accounting", "open positions remain unvalued; terminal accounting is intentionally unavailable");
  }
  else if (exportValue.persistence === "UNKNOWN" && !terminalResult) {
    unknown("runner_accounting", "terminal accounting is unavailable");
  } else fail("runner_accounting", "terminal accounting conflicts with raw runner summary or is incomplete");
  if (unvaluedPositions) {
    unknown("terminal_valuation", "open positions are retained with VALUATION_UNAVAILABLE; no liquidation or mark is inferred");
  } else if (Array.isArray(openPositions) && openPositions.some(position =>
    position.markStatus === "VALUATION_UNAVAILABLE")) {
    fail("terminal_valuation", "terminal position valuation markers are inconsistent");
  }

  const lifecycleStatus = runnerReport?.reason === "SHUTDOWN" && runnerReport?.status !== "UNKNOWN"
    ? "STOPPED" : runnerReport?.status ?? "UNKNOWN";
  const syntheticMode = config?.mode === "SYNTHETIC_TEST_ONLY" &&
    (!runnerReport || runnerReport.provenance === "SYNTHETIC_FIXTURE_ONLY");
  if (!syntheticMode) {
    unknown("real_source_readiness", "external evidence and source trust remain unresolved");
  }
  if (runnerReport?.pendingAuthorizationIds?.length) {
    unknown("pending_authorizations", "one or more entry reservations remain unresolved");
  }
  if (Array.isArray(operationResults) &&
      operationResults.some(item => ["UNKNOWN", "UNFILLED", "EQUITY_UNKNOWN", "VALUATION_UNAVAILABLE"]
        .includes(item?.status))) {
    unknown("operation_outcomes", "one or more runner operation outcomes remain unresolved");
  }
  if (runnerReport?.status === "UNKNOWN") {
    unknown("runner_lifecycle", `runner lifecycle is UNKNOWN: ${runnerReport.reason ?? "reason unavailable"}`);
  } else if (lifecycleStatus === "STOPPED") {
    unknown("runner_lifecycle", "operator stop is preserved separately from persistence certainty");
  } else if (runnerReport?.status === "FINISHED" && terminalValid &&
      ["SOURCES_EXHAUSTED", "DEADLINE"].includes(runnerReport.reason)) {
    pass("runner_lifecycle", `runner completed with reason ${runnerReport.reason ?? "unspecified"}`);
  } else if (runnerReport) {
    unknown("runner_lifecycle", "runner did not produce an accepted terminal completion");
  } else {
    unknown("runner_lifecycle", "runner was not started");
  }

  const checksFailed = checks.some(check => check.status === "FAIL");
  const checksUnknown = checks.some(check => check.status === "UNKNOWN");
  const overall = checksFailed ? "FAIL" : checksUnknown ? "UNKNOWN" : "PASS";
  const unresolved = [
    ...(Array.isArray(runnerReport?.unresolved) ? runnerReport.unresolved : []),
    ...(runnerReport?.reason && runnerReport.reason !== "SOURCES_EXHAUSTED"
      ? [runnerReport.reason] : []),
    ...(exportValue.exportBinding === "EXPORT_ASSERTED" ? ["HISTORICAL_RUN_BINDING_UNKNOWN"] : [])
  ];
  let outcome = "INCOMPLETE_UNKNOWN";
  if (overall === "FAIL") outcome = "INVALID_EVIDENCE";
  else if (overall === "PASS" && lifecycleStatus === "FINISHED" && terminalValid && inventoryValid) {
    if (entries === 0 && openPositions.length === 0) outcome = "ZERO_ENTRY_COMPLETE";
    else if (entries > 0 && closedQuotes >= entries && openPositions.length === 0) {
      outcome = "SIMULATED_ENTRY_EXIT_COMPLETE";
    } else if (openPositions.length > 0 &&
        openPositions.every(position => position.markStatus === "VALUATION_UNAVAILABLE")) {
      outcome = "OPEN_UNVALUED_TERMINAL_POSITION";
    } else outcome = "SIMULATED_CYCLE_INCOMPLETE";
  } else if (terminalValid && Array.isArray(openPositions) && openPositions.length > 0 &&
      openPositions.every(position => position.markStatus === "VALUATION_UNAVAILABLE")) {
    outcome = "OPEN_UNVALUED_TERMINAL_POSITION";
  } else if (overall === "UNKNOWN") {
    outcome = "INCOMPLETE_UNKNOWN";
  } else if (terminalValid && entries > 0 && closedQuotes >= entries &&
      Array.isArray(openPositions) && openPositions.length === 0) {
    outcome = "SIMULATED_ENTRY_EXIT_COMPLETE";
  } else if (terminalValid && entries === 0 && Array.isArray(openPositions) &&
      openPositions.length === 0) {
    outcome = "ZERO_ENTRY_COMPLETE";
  }

  return {
    schema: EVALUATION_SCHEMA,
    overall,
    outcome,
    lifecycleStatus,
    persistence: exportValue.persistence,
    exportBinding: exportValue.exportBinding,
    identity: {
      runId: exportValue.runId ?? null,
      producerRevision: exportValue.producerRevision ?? null,
      configSha256: exportValue.configSha256 ?? null,
      checkpointSha256: exportValue.checkpointSha256 ?? null
    },
    evidence: {
      entryFills: entries,
      exits: closedQuotes,
      openPositions: Array.isArray(openPositions) ? openPositions.length : null,
      terminalAt: finishAt === null ? null : new Date(finishAt).toISOString(),
      reason: runnerReport?.reason ?? null,
      realDataSourceCoverage: runnerReport?.realDataSourceCoverage ?? "NOT_ASSESSED",
      measuredCosts: "NOT_SUPPLIED"
    },
    unresolved: [...new Set(unresolved)],
    checks,
    claims: {liveExecution: false, profitability: false, activation: false, sourceReadiness: false}
  };
}

export function evaluateMemecoinPaperRunExport(exportBytes, expected) {
  try {
    const exportValue = parseBoundedJson(exportBytes);
    return checkExport(exportValue, expected, []);
  } catch (error) {
    return {
      schema: EVALUATION_SCHEMA,
      overall: "FAIL",
      outcome: "INVALID_EVIDENCE",
      lifecycleStatus: "UNKNOWN",
      persistence: "UNKNOWN",
      exportBinding: "EXPORT_ASSERTED",
      identity: {
        runId: expected?.runId ?? null,
        producerRevision: expected?.producerRevision ?? null,
        configSha256: expected?.configSha256 ?? null,
        checkpointSha256: null
      },
      evidence: {
        entryFills: null, exits: null, openPositions: null, terminalAt: null,
        reason: null, realDataSourceCoverage: "NOT_ASSESSED", measuredCosts: "NOT_SUPPLIED"
      },
      unresolved: ["export could not be parsed within its bounded input contract"],
      checks: [{id: "export_parsing", status: "FAIL", reason: error.message}],
      claims: {liveExecution: false, profitability: false, activation: false, sourceReadiness: false}
    };
  }
}

async function readBoundedFile(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) {
    throw new TypeError("--export path must be absolute");
  }
  const handle = await open(filename, constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_EXPORT_BYTES) {
      throw new RangeError("export must be a regular file within its byte bound");
    }
    const bytes = Buffer.alloc(MAX_EXPORT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_EXPORT_BYTES) throw new RangeError("export exceeds its byte bound");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function parseArguments(argv) {
  const allowed = new Set(["export", "run-id", "config-sha256", "producer-revision", "format", "output"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.startsWith("--") ? argv[index].slice(2) : "";
    if (!allowed.has(key) || Object.hasOwn(values, key) ||
        typeof argv[index + 1] !== "string" || argv[index + 1].startsWith("--")) {
      throw new TypeError("expected unique --export, --run-id, --config-sha256, --producer-revision, and optional --format/--output");
    }
    values[key] = argv[++index];
  }
  for (const key of ["export", "run-id", "config-sha256", "producer-revision"]) {
    if (!Object.hasOwn(values, key)) throw new TypeError(`--${key} is required`);
  }
  if (values.format !== undefined && !["json", "markdown"].includes(values.format)) {
    throw new TypeError("--format must be json or markdown");
  }
  if (values.output !== undefined && !path.isAbsolute(values.output)) {
    throw new TypeError("--output must be absolute");
  }
  return values;
}

function renderMarkdown(result) {
  return [
    "# Memecoin Paper run export evaluation",
    "",
    `- Overall evidence status: **${result.overall}**`,
    `- Outcome: **${result.outcome}**`,
    `- Lifecycle / persistence: **${result.lifecycleStatus} / ${result.persistence}**`,
    `- Run / producer: \`${result.identity.runId ?? "UNKNOWN"}\` / \`${result.identity.producerRevision ?? "UNKNOWN"}\``,
    `- Entries / observed exits / open positions: ${result.evidence.entryFills ?? "UNKNOWN"} / ${result.evidence.exits ?? "UNKNOWN"} / ${result.evidence.openPositions ?? "UNKNOWN"}`,
    `- Runner reason / terminal time: ${result.evidence.reason ?? "UNKNOWN"} / ${result.evidence.terminalAt ?? "UNKNOWN"}`,
    "- Live execution, profitability, activation, and source-readiness claims: **false**",
    "- Measured/settled costs: **NOT SUPPLIED**",
    "",
    "## Checks",
    "",
    "| Check | Status | Reason |",
    "| --- | --- | --- |",
    ...result.checks.map(check =>
      `| ${check.id} | ${check.status} | ${String(check.reason).replaceAll("|", "\\|").replaceAll("\n", " ")} |`)
  ].join("\n") + "\n";
}

async function writeOutput(filename, contents) {
  const handle = await open(filename, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const bytes = await readBoundedFile(args.export);
  const result = evaluateMemecoinPaperRunExport(bytes, {
    runId: args["run-id"],
    configSha256: args["config-sha256"],
    producerRevision: args["producer-revision"]
  });
  const output = args.format === "markdown" ? renderMarkdown(result) : `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) await writeOutput(args.output, output);
  else process.stdout.write(output);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => {
    process.exitCode = result.overall === "PASS" ? 0 : result.overall === "UNKNOWN" ? 2 : 1;
  }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
