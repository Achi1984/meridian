import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalCheckpointBytes, MAX_CHECKPOINT_BYTES} from "../memecoin-paper/checkpoint-store.mjs";

export const EVALUATION_SCHEMA = "MEMECOIN_SIMULATED_PILOT_EVALUATION_V1";
export const EXPORT_SCHEMA = "MEMECOIN_SIMULATED_PILOT_EXPORT_V1";
export const CONFIG_SCHEMA = "MEMECOIN_SIMULATED_PILOT_CONFIG_V1";
export const TERMINAL_SCHEMA = "MEMECOIN_SIMULATED_PILOT_TERMINAL_V1";
export const MAX_INPUT_BYTES = Object.freeze({
  manifest: 65_536,
  config: 65_536,
  checkpoint: MAX_CHECKPOINT_BYTES,
  terminal: 2 * 1024 * 1024,
  report: 262_144
});

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const METHODS = new Set(["authorizeEntry", "executeEntry", "observeExitQuote", "riskSnapshot", "finishRun"]);
const COST_FIELDS = ["feeCents", "spreadCents", "slippageCents", "priceImpactCents", "networkCents"];
const REVISIONED_ARTIFACTS = ["config", "checkpoint", "terminal", "report"];
const MAX_NODES = 120_000;
const VIENNA_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Vienna",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes, name) {
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    const value = JSON.parse(text);
    let nodes = 0;
    const visit = (item, depth = 0) => {
      if (++nodes > MAX_NODES || depth > 64) throw new RangeError(`${name} exceeds structural limits`);
      if (item === null || typeof item !== "object") return;
      if (Array.isArray(item)) {
        for (const child of item) visit(child, depth + 1);
      } else {
        for (const child of Object.values(item)) visit(child, depth + 1);
      }
    };
    visit(value);
    return value;
  } catch (error) {
    throw new TypeError(`${name} is not bounded valid UTF-8 JSON: ${error.message}`);
  }
}

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function amount(value, {signed = false} = {}) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) &&
      (signed || value >= 0)) return BigInt(value);
  if (isRecord(value) && Object.keys(value).length === 1 &&
      typeof value.$bigint === "string") return amount(value.$bigint, {signed});
  if (typeof value !== "string" ||
      !(signed ? /^-?(0|[1-9]\d{0,127})$/ : /^(0|[1-9]\d{0,127})$/) ||
      value === "-0") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function quoteNotionalCents(tokenAtoms, decimals, priceMicros) {
  if (tokenAtoms === null || !integer(decimals) || decimals > 18 ||
      !Number.isSafeInteger(priceMicros) || priceMicros <= 0) return null;
  const denominator = 10n ** BigInt(decimals) * 10_000n;
  return (tokenAtoms * BigInt(priceMicros) + denominator - 1n) / denominator;
}

function quoteGrossCents(tokenAtoms, decimals, priceMicros) {
  if (tokenAtoms === null || !integer(decimals) || decimals > 18 ||
      !Number.isSafeInteger(priceMicros) || priceMicros <= 0) return null;
  return tokenAtoms * BigInt(priceMicros) / (10n ** BigInt(decimals) * 10_000n);
}

function time(value) {
  if (integer(value, 1) && Number.isFinite(new Date(value).getTime())) return value;
  if (typeof value === "string" && value.length <= 40 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function viennaDay(value) {
  const parsed = time(value);
  if (parsed === null) return null;
  const parts = VIENNA_DAY.formatToParts(new Date(parsed));
  const fields = Object.fromEntries(parts
    .filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function criterion(checks, id, status, reason) {
  checks.push({id, status, reason});
}

function hashMatches(bytes, revision) {
  return isRecord(revision) && typeof revision.revision === "string" &&
    SAFE_ID.test(revision.revision) && HASH.test(revision.sha256) &&
    sha256(bytes) === revision.sha256;
}

function byteInput(value, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be supplied as exact artifact bytes`);
  const maxBytes = MAX_INPUT_BYTES[name];
  if (!maxBytes || value.byteLength === 0 || value.byteLength > maxBytes) {
    throw new RangeError(`${name} bytes are empty or exceed the ${maxBytes ?? "supported"} byte bound`);
  }
  return Buffer.from(value);
}

function emptyResult(checks, identity = {}) {
  return {
    schema: EVALUATION_SCHEMA,
    overall: "FAIL",
    outcome: "INVALID_EVIDENCE",
    identity,
    checks,
    evidence: {entryFills: null, exits: null, openPositions: null},
    costProvenance: {declared: "UNKNOWN", measured: "NOT_SUPPLIED"},
    claims: {liveExecution: false, profitability: false, activation: false}
  };
}

function resultStatus(checks) {
  if (checks.some(check => check.status === "FAIL")) return "FAIL";
  if (checks.some(check => check.status === "UNKNOWN")) return "UNKNOWN";
  return "PASS";
}

function safeOutcome({identityValid, terminal, fills, exits, openPositions, unvalued, checks}) {
  if (!identityValid || checks.some(check => check.status === "FAIL")) return "INVALID_EVIDENCE";
  if (!terminal || terminal.status !== "FINISHED") return "INCOMPLETE_UNKNOWN";
  if (openPositions > 0 && unvalued) return "OPEN_UNVALUED_TERMINAL_POSITION";
  if (checks.some(check => check.status === "UNKNOWN")) return "INCOMPLETE_UNKNOWN";
  if (fills === 0 && openPositions === 0) return "ZERO_ENTRY_COMPLETE";
  if (fills > 0 && exits >= fills && openPositions === 0) return "SIMULATED_ENTRY_EXIT_COMPLETE";
  if (openPositions > 0) return "OPEN_POSITION_TERMINAL";
  return "SIMULATED_CYCLE_INCOMPLETE";
}

function evaluateParsed({manifest, config, checkpoint, terminal, report, raw, expected}) {
  const checks = [];
  const identity = {
    runId: expected.runId,
    buildId: expected.buildId,
    configSha256: expected.configSha256,
    artifacts: Object.fromEntries(Object.keys(raw).map(name => [name, sha256(raw[name])]))
  };
  const fail = (id, reason) => criterion(checks, id, "FAIL", reason);
  const pass = (id, reason) => criterion(checks, id, "PASS", reason);
  const unknown = (id, reason) => criterion(checks, id, "UNKNOWN", reason);

  const expectedValid = SAFE_ID.test(expected.runId) && SAFE_ID.test(expected.buildId) &&
    HASH.test(expected.configSha256);
  if (!expectedValid) fail("expected_identity", "independent expected run/build/config identity is invalid");
  else pass("expected_identity", "independent expected run/build/config identity is syntactically valid");

  let manifestValid = isRecord(manifest) && manifest.schema === EXPORT_SCHEMA &&
    manifest.runId === expected.runId && manifest.buildId === expected.buildId &&
    manifest.configSha256 === expected.configSha256 && isRecord(manifest.revisions);
  const revisions = manifestValid ? manifest.revisions : {};
  const revisionStatus = REVISIONED_ARTIFACTS.every(name =>
    hashMatches(raw[name], revisions[name]));
  const configDigestMatches = HASH.test(expected.configSha256 ?? "") &&
    sha256(raw.config) === expected.configSha256 &&
    manifest?.configSha256 === expected.configSha256;
  if (!manifestValid) fail("manifest_identity", "export manifest schema or expected identity mismatches");
  else pass("manifest_identity", "manifest binds the expected run, build, and config digest");
  if (!revisionStatus) fail("artifact_revisions", "at least one exact artifact digest or revision is missing or mismatched");
  else pass("artifact_revisions", "all artifact byte digests match their declared immutable revisions");
  if (!configDigestMatches) fail("config_identity", "config bytes do not match the independently expected and manifest-bound digest");
  else pass("config_identity", "exact config bytes match both independent and manifest digest bindings");

  const configValid = isRecord(config) && config.schema === CONFIG_SCHEMA &&
    config.buildId === expected.buildId && config.runId === expected.runId &&
    config.executionMode === "SIMULATED_ONLY" && config.mode === "SIMULATED_PAPER" &&
    config.policyVersion === "memecoin-paper-ledger-v2-monotonic-time" &&
    integer(config.startedAt, 1) && integer(config.entryCutoffAt, config.startedAt) &&
    integer(config.deadlineAt, config.entryCutoffAt) &&
    config.deadlineAt - config.startedAt === 8 * 60 * 60 * 1000 &&
    config.initialCapitalCents === "100000" && config.maxEntryCents === "8000" &&
    config.dailyLossLimitCents === "3000" && config.maxOpenPositions === 3 &&
    config.initialStopBps === 600 && config.trailingActivationBps === 1200 &&
    config.trailingDistanceBps === 600 && config.timezone === "Europe/Vienna" &&
    integer(config.quoteMaxAgeMs, 1) && config.quoteMaxAgeMs <= 300_000 &&
    isRecord(config.costPolicy);
  if (!configValid) fail("config_contract", "versioned simulated config or fixed risk/window contract is invalid");
  else pass("config_contract", "versioned SIMULATED_PAPER config and fixed risk/window contract are valid");

  const checkpointBytes = raw.checkpoint;
  let canonicalCheckpoint = false;
  try {
    canonicalCheckpoint = canonicalCheckpointBytes(checkpoint).equals(checkpointBytes);
  } catch {
    canonicalCheckpoint = false;
  }
  const records = checkpoint?.records;
  const header = checkpoint?.runHeader;
  const checkpointValid = canonicalCheckpoint && checkpoint?.formatVersion === 1 &&
    isRecord(header) && header.runId === expected.runId &&
    header.startedAt === config?.startedAt &&
    header.deadlineAt === config?.deadlineAt &&
    header.policyVersion === config?.policyVersion &&
    Array.isArray(records) && records.length > 0 &&
    records.length <= 10_000 && checkpoint.sequence === records.length - 1;
  if (!checkpointValid) fail("checkpoint_contract", "checkpoint is noncanonical, incompatible, oversized, or identity-mismatched");
  else pass("checkpoint_contract", "canonical checkpoint format, run identity, policy, and bounded sequence are valid");

  let checkpointHeadHash = null;
  let checkpointChainValid = checkpointValid;
  const commandIds = new Set();
  if (checkpointValid) {
    let predecessorHash = null;
    const headerBytes = canonicalCheckpointBytes(header);
    const prefixHash = createHash("sha256")
      .update('{"formatVersion":1,"records":[');
    for (let sequence = 0; sequence < records.length; sequence += 1) {
      const record = records[sequence];
      if (!isRecord(record) || record.sequence !== sequence || record.runId !== expected.runId ||
          record.predecessorHash !== predecessorHash || typeof record.commandId !== "string" ||
          (sequence === 0
            ? record.commandId !== "__header__" || record.method !== "constructor"
            : !SAFE_ID.test(record.commandId) || !METHODS.has(record.method)) ||
          !HASH.test(record.resultDigest ?? "") ||
          (sequence > 0 && (!METHODS.has(record.method) || commandIds.has(record.commandId)))) {
        checkpointChainValid = false;
        break;
      }
      if (sequence === 0 &&
          (!canonicalCheckpointBytes(record.inputs).equals(canonicalCheckpointBytes(header)) ||
           record.resultDigest !== sha256(canonicalCheckpointBytes({
             ...header,
             constructorStatus: "INITIALIZED"
           })))) {
        checkpointChainValid = false;
        break;
      }
      commandIds.add(record.commandId);
      if (sequence > 0) prefixHash.update(",");
      prefixHash.update(canonicalCheckpointBytes(record));
      predecessorHash = prefixHash.copy()
        .update(`],"runHeader":${headerBytes.toString("utf8")},"sequence":${sequence}}`)
        .digest("hex");
    }
    checkpointHeadHash = sha256(checkpointBytes);
    if (predecessorHash !== checkpointHeadHash) checkpointChainValid = false;
  }
  if (!checkpointChainValid) fail("checkpoint_chain", "checkpoint predecessor chain or command identity is invalid");
  else pass("checkpoint_chain", "checkpoint sequence, predecessor hashes, and unique command identities reconcile");

  const terminalValid = isRecord(terminal) && terminal.schema === TERMINAL_SCHEMA &&
    terminal.runId === expected.runId && terminal.buildId === expected.buildId &&
    terminal.configSha256 === expected.configSha256 && Array.isArray(terminal.operations) &&
    isRecord(terminal.checkpointReceipt) && isRecord(terminal.stopEvidence) &&
    isRecord(terminal.restartEvidence);
  if (!terminalValid) fail("terminal_contract", "versioned terminal receipt is missing or does not bind this run");
  else pass("terminal_contract", "terminal receipt is versioned and bound to the expected run/build/config");

  let receiptBinding = Boolean(terminalValid && checkpointValid && checkpointChainValid);
  if (receiptBinding) {
    const operations = terminal.operations;
    receiptBinding = operations.length === records.length - 1 &&
      operations.every((operation, index) => {
        const record = records[index + 1];
        if (!isRecord(operation) || !isRecord(record) ||
            operation.sequence !== record.sequence ||
            operation.commandId !== record.commandId ||
            operation.method !== record.method ||
            operation.resultDigest !== record.resultDigest ||
            sha256(canonicalCheckpointBytes(operation.result)) !== record.resultDigest) return false;
        return true;
      });
    const last = records.at(-1);
    const receipt = terminal.checkpointReceipt;
    receiptBinding = receiptBinding && last?.method === "finishRun" &&
      receipt.runId === expected.runId && receipt.sequence === checkpoint.sequence &&
      receipt.hash === checkpointHeadHash && receipt.commandId === last.commandId &&
      receipt.method === last.method && receipt.resultDigest === last.resultDigest;
  }
  if (!receiptBinding) fail("terminal_checkpoint_binding", "operation results or terminal receipt do not match durable checkpoint bytes");
  else pass("terminal_checkpoint_binding", "every result digest and final terminal receipt matches the durable checkpoint");

  const reportValid = isRecord(report) && report.schema === "MEMECOIN_PAPER_OPERATOR_REPORT_V1" &&
    isRecord(report.experiment) && report.experiment.id === expected.runId &&
    isRecord(report.trading) && isRecord(report.controls) &&
    isRecord(report.valuation) && isRecord(report.costs);
  if (!reportValid) fail("report_contract", "operator report schema or run identity is unsupported");
  else pass("report_contract", "supported operator report DTO is bound to the expected run");
  if (reportValid && terminal?.status === "FINISHED" &&
      report.experiment.reportStatus === "FINISHED") {
    pass("report_terminal_status", "operator report identifies a completed terminal run");
  } else if (reportValid && terminal?.status === "UNKNOWN" &&
      report.experiment.reportStatus === "INCOMPLETE" && report.experiment.endAt === null) {
    unknown("report_terminal_status", "operator report also preserves incomplete terminal status");
  } else if (reportValid) {
    fail("report_terminal_status", "operator report and terminal receipt disagree on completion status");
  }

  const operations = terminalValid && Array.isArray(terminal.operations) ? terminal.operations : [];
  const opRecords = checkpointValid && Array.isArray(records) ? records.slice(1) : [];
  const filled = [];
  const closed = [];
  const active = new Map();
  const seenEventIds = new Set();
  const pendingAuthorizations = new Map();
  const entriesByTickMint = new Set();
  let duplicateEvents = false;
  let quoteEvidenceUnknown = false;
  let quoteEvidenceFailed = false;
  let riskFailed = false;
  let riskSnapshotFailed = false;
  let riskSnapshotUnknown = false;
  let costEntryTotals = Object.fromEntries(COST_FIELDS.map(field => [field, 0n]));
  let costExitTotals = Object.fromEntries(COST_FIELDS.map(field => [field, 0n]));
  let cash = amount(config?.initialCapitalCents);
  let grossRealized = 0n;
  let netRealized = 0n;
  let allAccountingAvailable = cash !== null;
  let riskGateTrippedDay = null;
  let dailyDay = viennaDay(config?.startedAt);
  let dailyOpeningEquity = cash;
  let riskEvidenceUnknown = false;
  let unknownOperation = false;
  let latestTime = config?.startedAt ?? null;
  const authorizations = new Map();
  const gateSnapshots = new Map();

  const deriveMarkSnapshot = (marks, commandTime) => {
    if (!Array.isArray(marks)) return {status: "UNKNOWN"};
    const byMint = new Map(marks.map(mark => [mark?.mint, mark]));
    const markEventIds = marks.map(mark => mark?.eventId);
    if (byMint.size !== marks.length || marks.some(mark => !active.has(mark?.mint)) ||
        markEventIds.some(eventId => typeof eventId !== "string" || !SAFE_ID.test(eventId)) ||
        new Set(markEventIds).size !== markEventIds.length) return {status: "FAIL"};
    if ([...active.keys()].some(mint => !byMint.has(mint))) return {status: "UNKNOWN"};
    let grossOpen = 0n;
    let exitCosts = 0n;
    for (const [mint, position] of active) {
      const mark = byMint.get(mint);
      if (!mark) return {status: "UNKNOWN"};
      const observedAt = time(mark.observedAt);
      if (mark.decimals !== position.entry.decimals ||
          !["chainId", "mint", "pool", "quote"].every(key =>
            mark[key] === position.quote?.[key]) ||
          !Number.isSafeInteger(mark.priceMicros) || mark.priceMicros <= 0 ||
          typeof mark.source !== "string" || mark.source.length === 0) {
        return {status: "FAIL"};
      }
      if (observedAt === null || observedAt > commandTime ||
          commandTime - observedAt > config?.quoteMaxAgeMs ||
          observedAt <= (time(position.quote?.observedAt) ?? config?.startedAt)) {
        return {status: "STALE"};
      }
      if (!isRecord(mark.costs) ||
          COST_FIELDS.some(field => amount(mark.costs[field]) === null)) {
        return {status: "UNKNOWN"};
      }
      const markGross = quoteGrossCents(
        amount(position.entry.tokenAtoms), position.entry.decimals, mark.priceMicros
      );
      const markCosts = COST_FIELDS.reduce((sum, field) => sum + amount(mark.costs[field]), 0n);
      if (markGross === null || markCosts > markGross) return {status: "UNKNOWN"};
      grossOpen += markGross;
      exitCosts += markCosts;
    }
    if (cash === null) return {status: "UNKNOWN"};
    return {status: "PASS", cash, grossOpen, exitCosts, equity: cash + grossOpen - exitCosts};
  };

  const deriveGateSnapshot = (operation, inputs, result) => {
    const snapshot = deriveMarkSnapshot(inputs?.marks, time(inputs?.now));
    if (snapshot.status === "STALE") {
      quoteEvidenceFailed = true;
      if (operation.method === "riskSnapshot") riskSnapshotFailed = true;
    }
    if (snapshot.status === "UNKNOWN") {
      riskEvidenceUnknown = true;
      if (operation.method === "riskSnapshot" &&
          ["PASS", "DAILY_LOSS_LIMIT"].includes(result.status)) {
        riskFailed = true;
        riskSnapshotFailed = true;
      }
      return null;
    }
    if (snapshot.status !== "PASS") {
      riskFailed = true;
      if (operation.method === "riskSnapshot") riskSnapshotFailed = true;
      return null;
    }
    const day = viennaDay(time(inputs?.now));
    if (day === null || (dailyDay !== null && day < dailyDay)) {
      riskFailed = true;
      if (operation.method === "riskSnapshot") riskSnapshotFailed = true;
      return null;
    }
    if (day !== dailyDay) {
      dailyDay = day;
      dailyOpeningEquity = snapshot.equity;
      riskGateTrippedDay = null;
    }
    const loss = dailyOpeningEquity > snapshot.equity
      ? dailyOpeningEquity - snapshot.equity : 0n;
    const lossLimit = amount(config?.dailyLossLimitCents);
    const status = riskGateTrippedDay === day || loss >= lossLimit
      ? "DAILY_LOSS_LIMIT" : "PASS";
    if (status === "DAILY_LOSS_LIMIT") riskGateTrippedDay = day;
    const derived = {...snapshot, day, dailyOpeningEquity, loss, status};
    gateSnapshots.set(operation.sequence, derived);

    if (operation.method === "riskSnapshot") {
      const reported = {
        equity: amount(result.equityCents),
        loss: amount(result.lossCents),
        opening: amount(result.dailyOpeningEquityCents),
        limit: amount(result.limitCents),
        cash: amount(result.cashAtMarkCents),
        grossOpen: amount(result.grossOpenValueCents),
        exitCosts: amount(result.estimatedExitCostsCents)
      };
      if (Object.values(reported).some(value => value === null)) {
        riskSnapshotUnknown = true;
      } else if (reported.equity !== snapshot.equity || reported.loss !== loss ||
          reported.opening !== dailyOpeningEquity ||
          reported.limit !== lossLimit || reported.cash !== snapshot.cash ||
          reported.grossOpen !== snapshot.grossOpen ||
          reported.exitCosts !== snapshot.exitCosts ||
          result.status !== status ||
          result.entriesAllowed !== (status === "PASS")) {
        riskFailed = true;
        riskSnapshotFailed = true;
      }
    } else if (["AUTHORIZED", "FILLED_PAPER"].includes(result.status) &&
        status !== "PASS") {
      riskFailed = true;
    }
    return derived;
  };

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const record = opRecords[index];
    if (!isRecord(operation) || !isRecord(record)) continue;
    const inputs = record.inputs ?? {};
    const result = operation.result ?? {};
    if (["UNKNOWN", "UNFILLED", "VALUATION_UNAVAILABLE"].includes(result.status)) {
      unknownOperation = true;
    }
    const commandTime = time(inputs.now);
    if (commandTime === null || (latestTime !== null && commandTime < latestTime) ||
        (operation.method !== "finishRun" && commandTime > config?.deadlineAt)) {
      riskFailed = true;
    } else latestTime = commandTime;

    const identities = new Set();
    for (const eventId of [
      inputs.eventId,
      inputs.quote?.eventId,
      ...(Array.isArray(inputs.marks) ? inputs.marks.map(mark => mark?.eventId) : []),
      result.eventId,
      ...(Array.isArray(result.exitRequests) ? result.exitRequests.map(item => item?.eventId) : [])
    ]) {
      if (eventId === undefined || eventId === null) continue;
      if (typeof eventId !== "string" || !SAFE_ID.test(eventId)) {
        duplicateEvents = true;
        continue;
      }
      identities.add(eventId);
    }
    for (const eventId of identities) {
      if (seenEventIds.has(eventId)) duplicateEvents = true;
      seenEventIds.add(eventId);
    }

    const operationGateSnapshot = [
      "authorizeEntry", "executeEntry", "riskSnapshot"
    ].includes(operation.method) ? deriveGateSnapshot(operation, inputs, result) : null;

    if (operation.method === "authorizeEntry") {
      if (commandTime === null || commandTime >= config?.entryCutoffAt) riskFailed = true;
      const authId = result.authorizationId;
      if (result.status === "AUTHORIZED" && typeof authId === "string" && SAFE_ID.test(authId)) {
        const candidate = inputs.candidate;
        const candidateTime = time(candidate?.sampledAt);
        const decisionMatchesCandidate = decision => {
          const identity = decision?.identity;
          return isRecord(identity) &&
            ["chainId", "mint", "pool", "quote", "source"].every(key =>
              typeof candidate?.[key] === "string" &&
              identity[key] === candidate[key]) &&
            time(identity.sampledAt) !== null &&
            time(identity.sampledAt) === candidateTime;
        };
        if (inputs.authorizationId !== authId ||
            typeof inputs.tickId !== "string" || !SAFE_ID.test(inputs.tickId) ||
            result.tickId !== inputs.tickId ||
            !["mint", "chainId", "pool", "quote", "decimals"].every(key =>
              result[key] === candidate?.[key]) ||
            candidate?.chainId !== "solana" ||
            !integer(candidate?.decimals) || candidate.decimals > 18 ||
            typeof candidate?.source !== "string" || candidate.source.length === 0 ||
            candidateTime === null || candidateTime > commandTime ||
            commandTime - candidateTime > config?.quoteMaxAgeMs ||
            time(result.sampledAt) !== candidateTime ||
            time(result.authorizedAt) !== commandTime ||
            result.authorizedDay !== viennaDay(commandTime) ||
            result.stopLossBps !== 600 || result.trailingActivationBps !== 1200 ||
            result.trailingDistanceBps !== 600 ||
            result.executionMode !== "SIMULATED_ONLY" || result.executionRealistic !== false ||
            inputs.filterResult?.status !== "PASS" ||
            inputs.filterResult?.accepted !== true ||
            !decisionMatchesCandidate(inputs.filterResult) ||
            inputs.scoreResult?.status !== "PASS" ||
            !integer(inputs.scoreResult?.score, 70) || inputs.scoreResult.score > 100 ||
            !decisionMatchesCandidate(inputs.scoreResult)) riskFailed = true;
        const mint = result.mint;
        const tickId = inputs.tickId;
        const tickMint = `${tickId}:${mint}`;
        const reservedMints = new Set([
          ...active.keys(),
          ...[...pendingAuthorizations.values()].map(item => item.mint)
        ]);
        if (typeof mint !== "string" || typeof tickId !== "string" || !SAFE_ID.test(tickId) ||
            reservedMints.has(mint) || reservedMints.size >= config?.maxOpenPositions ||
            entriesByTickMint.has(tickMint)) riskFailed = true;
        entriesByTickMint.add(tickMint);
        if (!operationGateSnapshot || operationGateSnapshot.status !== "PASS") {
          riskEvidenceUnknown = true;
        } else {
          const reservedSpend = [...pendingAuthorizations.keys()].reduce((sum, id) => {
            const reserved = amount(authorizations.get(id)?.result?.maxSpendCents);
            return reserved === null ? null : sum === null ? null : sum + reserved;
          }, 0n);
          const available = cash === null || reservedSpend === null
            ? null : cash - reservedSpend;
          const maxAllowed = [amount(config?.maxEntryCents),
            operationGateSnapshot.equity * 8n / 100n, available].reduce((minimum, current) =>
            current === null ? minimum : current < minimum ? current : minimum);
          const authorizedSpend = amount(result.maxSpendCents);
          if (authorizedSpend === null || authorizedSpend <= 0n ||
              available === null || available < 0n ||
              authorizedSpend > maxAllowed) riskFailed = true;
        }
        authorizations.set(authId, {
          result, inputs, sequence: operation.sequence,
          riskSnapshot: operationGateSnapshot?.status === "PASS"
            ? {sequence: operation.sequence, equity: operationGateSnapshot.equity}
            : null
        });
        pendingAuthorizations.set(authId, {mint, tickId});
      }
    }
    if (riskGateTrippedDay === viennaDay(commandTime) &&
        ["authorizeEntry", "executeEntry"].includes(operation.method) &&
        !["REJECT", "BLOCKED"].includes(result.status)) riskFailed = true;

    if (operation.method === "executeEntry") {
      if (commandTime === null || commandTime >= config?.entryCutoffAt) riskFailed = true;
      const auth = authorizations.get(inputs.authorizationId);
      if (result.status === "FILLED_PAPER") {
        pendingAuthorizations.delete(inputs.authorizationId);
        const quote = inputs.quote;
        const at = time(quote?.observedAt);
        const authorizedAt = time(auth?.result?.authorizedAt);
        const allIn = amount(result.allInCents);
        const notional = amount(result.notionalCents);
        const entryCost = amount(result.entryCostsCents);
        const tokenAtoms = amount(result.tokenAtoms);
        const quotePrice = quote?.priceMicros;
        const quoteNotional = quoteNotionalCents(tokenAtoms, quote?.decimals, quotePrice);
        if (!auth || auth.sequence >= operation.sequence || !quote || at === null ||
            !SAFE_ID.test(quote.eventId ?? "") || result.eventId !== quote.eventId ||
            (inputs.eventId !== undefined &&
              (!SAFE_ID.test(inputs.eventId) || inputs.eventId !== quote.eventId)) ||
            authorizedAt === null || at <= authorizedAt || at > commandTime ||
            at < config?.startedAt || commandTime - at > config?.quoteMaxAgeMs ||
            quote.mode !== "HYPOTHETICAL" || quote.executable !== true ||
            typeof quote.source !== "string" || quote.source.length === 0 ||
            result.executionMode !== "SIMULATED_ONLY" || result.executionRealistic !== false ||
            quote.mint !== result.mint ||
            !Number.isSafeInteger(quotePrice) || quotePrice <= 0 ||
            quote.decimals !== result.decimals || result.decimals !== auth.result.decimals ||
            amount(result.entryPriceMicros) !== BigInt(quotePrice) ||
            quoteNotional === null || notional !== quoteNotional ||
            amount(result.initialStopPriceMicros) !== BigInt(quotePrice) * 9_400n / 10_000n ||
            !["mint", "chainId", "pool", "quote"].every(key =>
              typeof auth?.result?.[key] === "string" && quote[key] === auth.result[key]) ||
            allIn === null || notional === null || entryCost === null ||
            tokenAtoms === null || tokenAtoms <= 0n || notional <= 0n ||
            allIn <= 0n ||
            allIn !== notional + entryCost ||
            allIn > amount(config?.maxEntryCents) ||
            !isRecord(quote.costs) ||
            COST_FIELDS.some(field => amount(quote.costs[field]) === null)) {
          quoteEvidenceFailed = true;
        } else {
          const totals = COST_FIELDS.map(field => amount(quote.costs[field]));
          const quotedCost = totals.reduce((sum, item) => sum + item, 0n);
          if (quotedCost !== entryCost) quoteEvidenceFailed = true;
          else totals.forEach((value, i) => { costEntryTotals[COST_FIELDS[i]] += value; });
        }
        const authorizedSpend = amount(auth?.result?.maxSpendCents);
        if (!auth?.riskSnapshot || auth.riskSnapshot.status) riskEvidenceUnknown = true;
        if (allIn === null || allIn > amount(config?.maxEntryCents) ||
            authorizedSpend === null || authorizedSpend > amount(config?.maxEntryCents) ||
            allIn > authorizedSpend) riskFailed = true;
        if (!operationGateSnapshot || operationGateSnapshot.status !== "PASS" ||
            allIn > operationGateSnapshot.equity * 8n / 100n) riskFailed = true;
        const mint = result.mint;
        if (typeof mint !== "string" || active.has(mint) || active.size >= config?.maxOpenPositions) {
          riskFailed = true;
        } else {
          active.set(mint, {entry: result, quote, sequence: operation.sequence});
        }
        if (cash !== null && allIn !== null) {
          cash -= allIn;
          if (cash < 0n) riskFailed = true;
        } else allAccountingAvailable = false;
        filled.push(result);
      } else if (result.status === "UNFILLED" || result.status === "UNKNOWN") {
        quoteEvidenceUnknown = true;
      }
    }
    if (operation.method === "observeExitQuote" && result.status === "CLOSED_PAPER") {
      const quote = inputs.quote;
      const at = time(quote?.observedAt);
      const entry = active.get(result.mint);
      const gross = amount(result.grossProceedsCents);
      const exitCost = amount(result.exitCostsCents);
      const reportedNet = amount(result.realizedNetPnlCents, {signed: true});
      const reportedGross = amount(result.realizedGrossPnlCents, {signed: true});
      const expectedGross = quoteGrossCents(
        amount(entry?.entry?.tokenAtoms),
        entry?.entry?.decimals,
        quote?.priceMicros
      );
      if (!entry || !quote || !SAFE_ID.test(inputs.eventId ?? "") ||
          inputs.eventId !== quote.eventId || result.eventId !== quote.eventId ||
          result.eventId !== inputs.eventId || at === null || at > commandTime ||
          commandTime === null || commandTime - at > config?.quoteMaxAgeMs ||
          at <= (time(entry.quote?.observedAt) ?? config?.startedAt) ||
          quote.mode !== "HYPOTHETICAL" || quote.executable !== true ||
          typeof quote.source !== "string" || quote.source.length === 0 ||
          !["chainId", "mint", "pool", "quote"].every(key =>
            quote[key] === entry.quote?.[key]) ||
          quote.decimals !== entry.entry.decimals ||
          quote.mint !== result.mint || !Number.isSafeInteger(quote.priceMicros) ||
          quote.priceMicros <= 0 || amount(result.fillPriceMicros) !== BigInt(quote.priceMicros) ||
          expectedGross === null || gross !== expectedGross ||
          result.executionMode !== "SIMULATED_ONLY" ||
          result.executionRealistic !== false || gross === null || exitCost === null ||
          reportedNet === null || reportedGross === null || exitCost > gross ||
          gross - exitCost - amount(entry.entry.allInCents) !== reportedNet ||
          gross - amount(entry.entry.notionalCents) !== reportedGross ||
          !isRecord(quote.costs) ||
          COST_FIELDS.some(field => amount(quote.costs[field]) === null)) {
        quoteEvidenceFailed = true;
      } else {
        const totals = COST_FIELDS.map(field => amount(quote.costs[field]));
        if (totals.reduce((sum, item) => sum + item, 0n) !== exitCost) quoteEvidenceFailed = true;
        else totals.forEach((value, i) => { costExitTotals[COST_FIELDS[i]] += value; });
        if (cash !== null) cash += gross - exitCost;
        grossRealized += reportedGross;
        netRealized += reportedNet;
      }
      if (entry) active.delete(result.mint);
      closed.push(result);
    } else if (operation.method === "observeExitQuote" &&
        ["UNFILLED", "VALUATION_UNAVAILABLE", "UNKNOWN"].includes(result.status)) {
      quoteEvidenceUnknown = true;
    }
    if (operation.method === "riskSnapshot" && Array.isArray(result.exitRequests)) {
      for (const exit of result.exitRequests) {
        if (exit?.status === "CLOSED_PAPER") {
          const quote = Array.isArray(inputs.marks)
            ? inputs.marks.find(mark => mark?.mint === exit.mint) : null;
          const entry = active.get(exit.mint);
          const observedAt = time(quote?.observedAt);
          const gross = amount(exit.grossProceedsCents);
          const exitCost = amount(exit.exitCostsCents);
          const realizedNet = amount(exit.realizedNetPnlCents, {signed: true});
          const realizedGross = amount(exit.realizedGrossPnlCents, {signed: true});
          const expectedGross = quoteGrossCents(
            amount(entry?.entry?.tokenAtoms),
            entry?.entry?.decimals,
            quote?.priceMicros
          );
          if (!entry || !quote || !SAFE_ID.test(exit.eventId ?? "") ||
              !SAFE_ID.test(quote.eventId ?? "") || exit.eventId !== quote.eventId ||
              observedAt === null || observedAt > commandTime ||
              commandTime === null || commandTime - observedAt > config?.quoteMaxAgeMs ||
              observedAt <= (time(entry.quote?.observedAt) ?? config?.startedAt) ||
              quote.mode !== "HYPOTHETICAL" || quote.executable !== true ||
              typeof quote.source !== "string" || quote.source.length === 0 ||
              !["chainId", "mint", "pool", "quote"].every(key =>
                quote[key] === entry.quote?.[key]) ||
              quote.decimals !== entry.entry.decimals ||
              !Number.isSafeInteger(quote.priceMicros) || quote.priceMicros <= 0 ||
              amount(exit.fillPriceMicros) !== BigInt(quote.priceMicros) ||
              expectedGross === null || gross !== expectedGross ||
              gross === null || exitCost === null || realizedNet === null ||
              realizedGross === null || exitCost > gross ||
              exit.executionMode !== "SIMULATED_ONLY" ||
              exit.executionRealistic !== false ||
              gross - exitCost - amount(entry.entry.allInCents) !== realizedNet ||
              gross - amount(entry.entry.notionalCents) !== realizedGross ||
              !isRecord(quote.costs) ||
              COST_FIELDS.some(field => amount(quote.costs[field]) === null)) {
            quoteEvidenceFailed = true;
            continue;
          }
          const totals = COST_FIELDS.map(field => amount(quote.costs[field]));
          if (totals.reduce((sum, item) => sum + item, 0n) !== exitCost) {
            quoteEvidenceFailed = true;
            continue;
          }
          totals.forEach((value, i) => { costExitTotals[COST_FIELDS[i]] += value; });
          if (cash !== null) cash += gross - exitCost;
          grossRealized += realizedGross;
          netRealized += realizedNet;
          active.delete(exit.mint);
          closed.push(exit);
        } else if (exit?.status === "UNFILLED" || exit?.status === "VALUATION_UNAVAILABLE") {
          quoteEvidenceUnknown = true;
        }
      }
    }
  }

  const finishOperation = operations.at(-1);
  const finishInputs = opRecords.at(-1)?.inputs;
  const finishResult = finishOperation?.result;
  const finishTime = time(terminal?.terminalAt);
  const finishMarkSnapshot = finishOperation?.method === "finishRun"
    ? deriveMarkSnapshot(finishInputs?.marks, finishTime)
    : {status: "UNKNOWN"};
  let terminalValuationFailed = finishMarkSnapshot.status === "FAIL" ||
    finishMarkSnapshot.status === "STALE";
  if (finishMarkSnapshot.status === "STALE") quoteEvidenceFailed = true;

  if (duplicateEvents) fail("event_identity", "operation or fill event identity is malformed or duplicated");
  else pass("event_identity", "command identities and explicitly carried event identities are unique");

  if (quoteEvidenceFailed) fail("causal_quotes", "a fill lacks a fresh, causally later, identity-bound hypothetical quote or reconciled cost");
  else if (quoteEvidenceUnknown) unknown("causal_quotes", "quote/fill outcome is missing, unfilled, or unresolved");
  else pass("causal_quotes", "entry and exit fills use causal identity-bound hypothetical quotes");
  if (unknownOperation || riskEvidenceUnknown) {
    unknown("operation_outcomes", "an operation or risk snapshot has incomplete/UNKNOWN outcome evidence");
  } else pass("operation_outcomes", "operation and pre-entry risk outcomes are determinate");
  if (riskSnapshotUnknown) {
    unknown("risk_snapshot_reconciliation", "risk snapshot fields are incomplete");
  } else if (riskSnapshotFailed) {
    fail("risk_snapshot_reconciliation", "reported risk equity, cash, open value, costs, or daily gate conflicts with replayed receipts and marks");
  } else if (operations.some(operation => operation?.method === "riskSnapshot")) {
    pass("risk_snapshot_reconciliation", "risk snapshots reconcile to receipt-derived cash and identity-bound marks");
  }
  if (pendingAuthorizations.size > 0) {
    unknown("reservation_state", "one or more authorized entries remain unresolved at terminal time");
  } else if (report?.controls?.reservations !== 0) {
    unknown("reservation_state", "terminal reservation count is not explicitly zero in the report");
  } else pass("reservation_state", "no risk reservations remain unresolved");

  const fillsCount = filled.length;
  const exitsCount = closed.length;
  const openCount = terminalValid && terminal.operations.length
    ? (terminal.operations.at(-1)?.result?.openPositions?.length ??
      terminal.operations.at(-1)?.result?.positionCount ?? active.size)
    : null;
  const finalOperation = operations.at(-1);
  const finishInputAt = time(opRecords.at(-1)?.inputs?.now);
  const finalResult = finalOperation?.result;
  const finishCount = operations.filter(operation => operation?.method === "finishRun").length;
  const finishAt = time(terminal?.terminalAt);
  const stopReason = terminal?.stopEvidence?.reason;
  const validStopTime = stopReason === "DEADLINE"
    ? finishAt === config?.deadlineAt
    : stopReason === "OPERATOR_STOP" && finishAt !== config?.deadlineAt;
  const terminalStatusValid = terminalValid && terminal.status === "FINISHED" &&
    finishCount === 1 && finalOperation?.method === "finishRun" &&
    finalResult?.status === "FINISHED" &&
    terminal.stopEvidence.status === "VERIFIED" &&
    ["DEADLINE", "OPERATOR_STOP"].includes(stopReason) &&
    stopReason === terminal.stopReason &&
    time(terminal.stopEvidence.observedAt) === finishAt &&
    typeof terminal.stopEvidence.source === "string" &&
    finalResult.elapsedMs === finishAt - config?.startedAt &&
    validStopTime &&
    finishAt !== null && finishInputAt === finishAt &&
    (finalResult.terminalAt === undefined || time(finalResult.terminalAt) === finishAt) &&
    finishAt >= config?.startedAt && finishAt <= config?.deadlineAt;
  if (terminalValid && terminal.status === "UNKNOWN") {
    unknown("terminal_completion", "terminal receipt records UNKNOWN; completion is not acceptance");
  } else if (!terminalStatusValid) {
    fail("terminal_completion", "terminal state, stop evidence, finish result, or actual terminal time is inconsistent");
  } else pass("terminal_completion", "terminal finish receipt and actual stop time reconcile");
  if (terminal?.status === "FINISHED" && reportValid &&
      report.experiment.startAt === new Date(config.startedAt).toISOString() &&
      report.experiment.endAt === new Date(finishAt).toISOString()) {
    pass("report_time_binding", "operator report start/end times match config and actual terminal receipt");
  } else if (terminal?.status === "UNKNOWN" && reportValid &&
      report.experiment.startAt === new Date(config.startedAt).toISOString() &&
      report.experiment.endAt === null) {
    unknown("report_time_binding", "incomplete report has no evidenced end time");
  } else {
    fail("report_time_binding", "operator report time window does not bind to config and terminal evidence");
  }

  const restart = terminal?.restartEvidence;
  if (isRecord(restart) && restart.status === "NOT_REQUIRED" &&
      restart.restartCount === 0 && Array.isArray(restart.receipts) &&
      restart.receipts.length === 0) {
    pass("restart_evidence", "the terminal receipt explicitly records no restart");
  } else if (isRecord(restart) &&
      (restart.status === "UNKNOWN" || restart.status === "INCOMPLETE" ||
       integer(restart.restartCount, 1) || restart.status === "VERIFIED")) {
    unknown("restart_evidence", "restart receipts have no frozen schema bound to a checkpoint transition");
  } else {
    fail("restart_evidence", "restart status or count is malformed");
  }

  if (riskFailed) fail("exposure_and_daily_loss", "entry sizing, position exposure, cutoff, time order, or daily-loss gate is violated");
  else if (riskEvidenceUnknown) unknown("exposure_and_daily_loss", "pre-entry equity or daily-loss state is unavailable");
  else pass("exposure_and_daily_loss", "entry cutoff, fixed-point entry limits, concurrent exposure, and daily gate reconcile");

  const accounting = finalResult?.accounting;
  const reportCash = amount(report?.valuation?.cashCents);
  const reportGrossRealized = amount(report?.valuation?.realizedGrossPnlCents, {signed: true});
  const reportNetRealized = amount(report?.valuation?.realizedNetPnlCents, {signed: true});
  if (finishMarkSnapshot.status === "PASS") {
    const entryNotional = [...active.values()].reduce((sum, position) => {
      const value = amount(position.entry.notionalCents);
      return value === null ? null : sum === null ? null : sum + value;
    }, 0n);
    const entryCost = [...active.values()].reduce((sum, position) => {
      const value = amount(position.entry.allInCents);
      return value === null ? null : sum === null ? null : sum + value;
    }, 0n);
    const values = [
      amount(accounting?.cashCents),
      amount(accounting?.grossOpenValueCents),
      amount(accounting?.estimatedExitCostsCents),
      amount(accounting?.grossUnrealizedPnlCents, {signed: true}),
      amount(accounting?.netUnrealizedPnlCents, {signed: true}),
      amount(finalResult?.equityCents)
    ];
    const expectedGrossUnrealized = entryNotional === null
      ? null : finishMarkSnapshot.grossOpen - entryNotional;
    const expectedNetUnrealized = entryCost === null
      ? null : finishMarkSnapshot.equity - finishMarkSnapshot.cash - entryCost;
    if (values.some(value => value === null) ||
        values[0] !== finishMarkSnapshot.cash ||
        values[1] !== finishMarkSnapshot.grossOpen ||
        values[2] !== finishMarkSnapshot.exitCosts ||
        values[3] !== expectedGrossUnrealized ||
        values[4] !== expectedNetUnrealized ||
        values[5] !== finishMarkSnapshot.equity ||
        amount(report?.valuation?.grossOpenValueCents) !== finishMarkSnapshot.grossOpen ||
        amount(report?.valuation?.estimatedExitCostsCents) !== finishMarkSnapshot.exitCosts ||
        amount(report?.valuation?.unrealizedGrossPnlCents, {signed: true}) !== expectedGrossUnrealized ||
        amount(report?.valuation?.unrealizedNetPnlCents, {signed: true}) !== expectedNetUnrealized ||
        report?.valuation?.status !== "MARKED_AT_RUN_END" ||
        report?.valuation?.unresolvedPositions !== 0) {
      terminalValuationFailed = true;
    }
  } else if (finishMarkSnapshot.status === "UNKNOWN" && openCount === 0 &&
      (accounting || finalResult?.equityCents !== null)) {
    terminalValuationFailed = true;
  }
  let accountingValid = Boolean(allAccountingAvailable && cash !== null);
  let accountingConflict = false;
  if (accountingValid && (reportCash === null || reportGrossRealized === null ||
      reportNetRealized === null || (!accounting && openCount === 0))) {
    accountingValid = false;
  }
  if (accountingValid && reportCash !== null && reportCash !== cash) accountingConflict = true;
  if (accountingValid && reportGrossRealized !== null && reportGrossRealized !== grossRealized) {
    accountingConflict = true;
  }
  if (accountingValid && reportNetRealized !== null && reportNetRealized !== netRealized) {
    accountingConflict = true;
  }
  if (accountingValid && accounting) {
    const receiptCash = amount(accounting.cashCents);
    const grossOpen = amount(accounting.grossOpenValueCents);
    const exitCosts = amount(accounting.estimatedExitCostsCents);
    const equity = amount(finalResult.equityCents);
    if ([receiptCash, grossOpen, exitCosts, equity].some(value => value === null) ||
        receiptCash !== cash || grossOpen - exitCosts + receiptCash !== equity ||
        amount(accounting.realizedGrossPnlCents, {signed: true}) !== grossRealized ||
        amount(accounting.realizedNetPnlCents, {signed: true}) !== netRealized) {
      if ([receiptCash, grossOpen, exitCosts, equity].every(value => value !== null)) {
        accountingConflict = true;
      } else {
        accountingValid = false;
      }
    }
  }
  const unvalued = openCount > 0 && (!accounting || finalResult?.equityCents === null);
  if (terminalValuationFailed) {
    fail("fixedpoint_accounting", "terminal valuation claims do not reconcile to fresh identity-bound finish marks");
  } else if (finishMarkSnapshot.status === "UNKNOWN" && openCount > 0) {
    unknown("fixedpoint_accounting", "terminal open-position marks, costs, or event identity are unavailable");
  } else if (unvalued) {
    const valuationHonest = report?.valuation?.status === "UNRESOLVED" &&
      report?.valuation?.unrealizedGrossPnlCents === null &&
      report?.valuation?.unrealizedNetPnlCents === null &&
      report?.valuation?.unresolvedPositions === openCount &&
      Array.isArray(report?.controls?.openPositions) &&
      report.controls.openPositions.length === openCount &&
      report.controls.openPositions.every(position => position.markStatus === "VALUATION_UNAVAILABLE");
    if (!valuationHonest || accountingConflict) {
      fail("fixedpoint_accounting", "unvalued terminal position or its cash/realized totals conflict with the report");
    } else {
      unknown("fixedpoint_accounting", "cash/realized totals reconcile; terminal open positions remain honestly unvalued");
    }
  } else if (accountingConflict) {
    fail("fixedpoint_accounting", "fixed-point cash, realized totals, or ending equity contradict the receipts");
  } else if (!accountingValid) {
    unknown("fixedpoint_accounting", "complete fixed-point cash or valuation reconciliation is unavailable");
  } else pass("fixedpoint_accounting", "cash, realized totals, and valued ending equity reconcile in integer cents");

  let costsReconcile = true;
  let declaredCostTotal = 0n;
  for (const field of COST_FIELDS) {
    const entryValue = amount(report?.costs?.entryByType?.[field]);
    const exitValue = amount(report?.costs?.exitByType?.[field]);
    if (entryValue === null || exitValue === null ||
        entryValue !== costEntryTotals[field] || exitValue !== costExitTotals[field]) {
      costsReconcile = false;
      break;
    }
    declaredCostTotal += entryValue + exitValue;
  }
  if (amount(report?.costs?.totalCents) !== declaredCostTotal) costsReconcile = false;
  const costPolicy = config?.costPolicy;
  const costPolicyValid = isRecord(costPolicy) && costPolicy.basis === "DECLARED_HYPOTHETICAL" &&
    SAFE_ID.test(costPolicy.revision ?? "") && typeof costPolicy.source === "string" &&
    SAFE_ID.test(costPolicy.source) && costPolicy.measuredBasis === "NOT_MEASURED";
  if (!costPolicyValid) fail("cost_provenance", "declared hypothetical cost model or explicit unmeasured status is missing");
  else if (!costsReconcile) fail("cost_reconciliation", "declared quote costs do not reconcile with report fixed-point cost totals");
  else pass("cost_provenance", "declared cost model is revision-bound and measured/settled costs are explicitly not supplied");
  if (costPolicyValid && costsReconcile) {
    pass("cost_reconciliation", "per-fill declared cost components reconcile with operator report totals");
  }

  const receiptPositions = Array.isArray(finalResult?.openPositions) ? finalResult.openPositions : null;
  const reportPositionRows = report?.controls?.openPositions;
  const reportPositionIds = new Set((reportPositionRows ?? []).map(position => position?.mint));
  const receiptPositionIds = new Set((receiptPositions ?? []).map(position => position?.mint));
  const activePositionIds = new Set(active.keys());
  const derivedPositionsMatch = receiptPositions !== null &&
    receiptPositionIds.size === receiptPositions.length &&
    activePositionIds.size === active.size && active.size === receiptPositions.length &&
    [...activePositionIds].every(mint => receiptPositionIds.has(mint));
  const positionIdentityMatches = receiptPositions !== null &&
    receiptPositionIds.size === receiptPositions.length &&
    reportPositionIds.size === (reportPositionRows?.length ?? -1) &&
    [...receiptPositionIds].every(mint => reportPositionIds.has(mint)) &&
    receiptPositions.every(position => reportPositionRows.some(item =>
      item.mint === position.mint && item.markStatus === position.markStatus));
  let positionDetailsMismatch = false;
  let positionDetailsUnknown = false;
  for (const row of reportPositionRows ?? []) {
    const position = active.get(row?.mint);
    if (!position) {
      positionDetailsMismatch = true;
      continue;
    }
    const reportedAtoms = amount(row.tokenAtoms);
    const entryAtoms = amount(position.entry.tokenAtoms);
    const reportedCost = amount(row.entryCostCents);
    const entryCost = amount(position.entry.allInCents);
    if (reportedAtoms === null || entryAtoms === null ||
        !integer(row.decimals) || !integer(position.entry.decimals) ||
        reportedCost === null || entryCost === null) {
      positionDetailsUnknown = true;
    } else if (reportedAtoms !== entryAtoms || row.decimals !== position.entry.decimals ||
        reportedCost !== entryCost) {
      positionDetailsMismatch = true;
    }
  }
  if (receiptPositions !== null && !derivedPositionsMatch) {
    fail("fill_position_reconciliation", "terminal position inventory does not match the entry/exit receipt sequence");
  } else if (receiptPositions === null) {
    unknown("fill_position_reconciliation", "terminal position inventory is missing");
  } else pass("fill_position_reconciliation", "entry and exit receipts reconcile to the terminal position inventory");
  const positionCountMatches = reportValid && Number.isSafeInteger(report.controls.openPositionCount) &&
    report.controls.openPositionCount === openCount &&
    Array.isArray(report.controls.openPositions) &&
    report.controls.openPositions.length === openCount && positionIdentityMatches;
  const expectedMarkStatus = finishMarkSnapshot.status === "PASS" ? "MARKED" :
    finishMarkSnapshot.status === "UNKNOWN" && openCount > 0
      ? "VALUATION_UNAVAILABLE" : null;
  const allPositionRows = [...(receiptPositions ?? []), ...(reportPositionRows ?? [])];
  const positionMarkStatusContradiction = expectedMarkStatus !== null &&
    allPositionRows.some(position => position?.markStatus !== undefined &&
      position.markStatus !== expectedMarkStatus);
  const positionMarkStatusesComplete = openCount === 0 ||
    expectedMarkStatus !== null && allPositionRows.length === openCount * 2 &&
      allPositionRows.every(position => position?.markStatus === expectedMarkStatus);
  if (positionMarkStatusContradiction) {
    fail("terminal_positions", "terminal position mark statuses contradict the recomputed finish-mark evidence");
  } else if (positionDetailsMismatch) {
    fail("terminal_positions", "reported open-position quantities or entry basis conflict with fill receipts");
  } else if (positionDetailsUnknown || openCount === null || !positionCountMatches ||
      !positionMarkStatusesComplete) {
    unknown("terminal_positions", "terminal position count is absent or does not reconcile to the report");
  } else pass("terminal_positions", "report position rows and durable finish receipt have the same count");

  if (reportValid && report.trading.paperEntryFills !== fillsCount) {
    fail("fill_count", "operator report fill count conflicts with durable entry receipts");
  } else if (!reportValid || report.trading.paperEntryFills === null) {
    unknown("fill_count", "entry fill count is unavailable");
  } else pass("fill_count", "operator report entry fill count matches durable fill receipts");

  const outcome = safeOutcome({
    identityValid: expectedValid && manifestValid && revisionStatus && configValid &&
      configDigestMatches && checkpointValid && checkpointChainValid &&
      terminalValid && receiptBinding && reportValid,
    terminal,
    fills: fillsCount,
    exits: exitsCount,
    openPositions: openCount ?? 0,
    unvalued,
    checks
  });
  return {
    schema: EVALUATION_SCHEMA,
    overall: resultStatus(checks),
    outcome,
    identity,
    checks,
    evidence: {
      entryFills: fillsCount,
      exits: exitsCount,
      openPositions: openCount,
      terminalAt: finishAt === null ? null : new Date(finishAt).toISOString(),
      stopReason: terminal?.stopReason ?? null,
      measuredCosts: "NOT_SUPPLIED"
    },
    costProvenance: {
      declared: costPolicyValid
        ? {basis: costPolicy.basis, revision: costPolicy.revision, source: costPolicy.source}
        : "UNKNOWN",
      measured: "NOT_SUPPLIED",
      comparability: "NOT_ASSESSED"
    },
    claims: {liveExecution: false, profitability: false, activation: false}
  };
}

export function evaluateSimulatedPilotEvidence(input) {
  const raw = {};
  const checks = [];
  try {
    for (const name of Object.keys(MAX_INPUT_BYTES)) raw[name] = byteInput(input?.[name], name);
    const parsed = Object.fromEntries(Object.keys(raw).map(name => [name, parseJson(raw[name], name)]));
    const expected = {
      runId: input.expectedRunId,
      buildId: input.expectedBuildId,
      configSha256: input.expectedConfigSha256
    };
    return evaluateParsed({...parsed, raw, expected});
  } catch (error) {
    criterion(checks, "artifact_parsing", "FAIL", error.message);
    return emptyResult(checks, {
      runId: input?.expectedRunId ?? null,
      buildId: input?.expectedBuildId ?? null,
      configSha256: input?.expectedConfigSha256 ?? null
    });
  }
}

async function readBoundedFile(filename, name) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) {
    throw new TypeError(`${name} path must be absolute`);
  }
  const handle = await open(filename, constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES[name]) {
      throw new RangeError(`${name} is not a regular file within its byte bound`);
    }
    const bytes = Buffer.alloc(MAX_INPUT_BYTES[name] + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_INPUT_BYTES[name]) throw new RangeError(`${name} exceeds its byte bound`);
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function parseArguments(argv) {
  const allowed = new Set([
    "manifest", "config", "checkpoint", "terminal", "report",
    "run-id", "build-id", "config-sha256", "format", "output"
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]?.startsWith("--") ? argv[index].slice(2) : "";
    if (!allowed.has(key) || Object.hasOwn(values, key) ||
        typeof argv[index + 1] !== "string" || argv[index + 1].startsWith("--")) {
      throw new TypeError("expected unique --manifest, --config, --checkpoint, --terminal, --report, --run-id, --build-id, --config-sha256, --format, and optional --output");
    }
    values[key] = argv[++index];
  }
  for (const key of ["manifest", "config", "checkpoint", "terminal", "report", "run-id", "build-id", "config-sha256"]) {
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
  const lines = [
    "# Simulated pilot evidence evaluation",
    "",
    `- Overall evidence status: **${result.overall}**`,
    `- Outcome: **${result.outcome}**`,
    `- Run/build: \`${result.identity.runId ?? "UNKNOWN"}\` / \`${result.identity.buildId ?? "UNKNOWN"}\``,
    `- Entry fills / exits / open positions: ${result.evidence.entryFills ?? "UNKNOWN"} / ${result.evidence.exits ?? "UNKNOWN"} / ${result.evidence.openPositions ?? "UNKNOWN"}`,
    `- Stop: ${result.evidence.stopReason ?? "UNKNOWN"} at ${result.evidence.terminalAt ?? "UNKNOWN"}`,
    "- Live execution, profitability, and activation claims: **false**",
    "- Measured/settled costs: **NOT SUPPLIED**",
    "",
    "## Checks",
    "",
    "| Check | Status | Reason |",
    "| --- | --- | --- |",
    ...result.checks.map(check =>
      `| ${check.id} | ${check.status} | ${String(check.reason).replaceAll("|", "\\|").replaceAll("\n", " ")} |`)
  ];
  return `${lines.join("\n")}\n`;
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
  const entries = await Promise.all(Object.keys(MAX_INPUT_BYTES).map(async name => [
    name,
    await readBoundedFile(args[name], name)
  ]));
  const result = evaluateSimulatedPilotEvidence({
    ...Object.fromEntries(entries),
    expectedRunId: args["run-id"],
    expectedBuildId: args["build-id"],
    expectedConfigSha256: args["config-sha256"]
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
