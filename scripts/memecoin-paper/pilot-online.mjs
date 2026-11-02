import {createHash} from "node:crypto";
import {lstat, mkdir, open, readFile, readdir, rename, rm} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";
import {PaperCheckpointSession} from "./checkpoint-session.mjs";
import {CheckpointStore, canonicalCheckpointBytes} from "./checkpoint-store.mjs";
import {analyzeCandidate, filterCandidate} from "./stages.mjs";

export const READ_ONLY_PAPER = "READ_ONLY_PAPER";
export const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
export const MAX_DEADLINE_FINALIZATION_DELAY_MS = 60_000;
export const PILOT_DEPENDENCY_PINS = Object.freeze({
  provider: "b000c6a6dcfcce102e61821e8316174a15a0dd58",
  controller: "89a20bf118e059c6153ac75b51f2ed6947d46332",
  report: "14075eef9ef0eebde3249718a6f6e3c51016bdee"
});

const SAFE_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;
const PROVIDER_POLL_CYCLE_INTERVAL = 3;
const HOSTS = Object.freeze({
  dex: "api.dexscreener.com",
  rpc: "api.mainnet-beta.solana.com"
});
const DISABLED = Object.freeze({
  status: "DISABLED",
  mode: "DISABLED",
  acquisitionStarted: false,
  executionStarted: false,
  reason: "READ_ONLY_PAPER mode was not explicitly selected"
});

function isRecord(value) {
  return value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("run configuration contains an unsafe number");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length) {
      throw new TypeError("run configuration contains a sparse or extended array");
    }
    if (seen.has(value)) throw new TypeError("run configuration contains a cycle");
    seen.add(value);
    const result = `[${value.map(item => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isRecord(value) || seen.has(value) || Object.getOwnPropertySymbols(value).length) {
    throw new TypeError("run configuration must contain plain JSON data");
  }
  seen.add(value);
  const keys = Object.keys(value).sort();
  if (Object.getOwnPropertyNames(value).length !== keys.length) {
    throw new TypeError("run configuration contains hidden fields");
  }
  const fields = keys.map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("run configuration contains an accessor");
    }
    return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`;
  });
  seen.delete(value);
  return `{${fields.join(",")}}`;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new TypeError(`${label} has an unsupported shape`);
  }
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is outside its supported bound`);
  }
  return value;
}

function validatePins(pins, label) {
  exactKeys(pins, ["provider", "controller", "report"], label);
  for (const name of Object.keys(PILOT_DEPENDENCY_PINS)) {
    if (pins[name] !== PILOT_DEPENDENCY_PINS[name]) {
      throw new Error(`${label} ${name} pin does not match the configured dependency candidate`);
    }
  }
}

function validateConfig(config, now) {
  boundedInteger(now, "launch time", 1, Number.MAX_SAFE_INTEGER);
  exactKeys(config, [
    "version", "mode", "runId", "startAt", "endAt", "dependencyPins",
    "manifest", "candidates", "budgets"
  ], "run configuration");
  if (config.version !== 1 || config.mode !== READ_ONLY_PAPER ||
      typeof config.runId !== "string" || !SAFE_ID.test(config.runId)) {
    throw new TypeError("run configuration must identify one READ_ONLY_PAPER run");
  }
  validatePins(config.dependencyPins, "run configuration");
  boundedInteger(config.startAt, "startAt", 1, Number.MAX_SAFE_INTEGER);
  boundedInteger(config.endAt, "endAt", config.startAt + 1, Number.MAX_SAFE_INTEGER);
  if (config.endAt - config.startAt !== EIGHT_HOURS_MS ||
      now < config.startAt || now >= config.endAt) {
    throw new Error("launch must occur inside the exact pinned eight-hour run window");
  }
  const manifest = config.manifest;
  if (!isRecord(manifest) || manifest.enabled !== true || manifest.mode !== READ_ONLY_PAPER ||
      manifest.execution !== "SIMULATED_ONLY" || manifest.runId !== config.runId ||
      manifest.startAt !== config.startAt || manifest.endAt !== config.endAt ||
      manifest.durationMs !== EIGHT_HOURS_MS || manifest.stopSwitch?.engaged !== false ||
      manifest.http?.credentials !== false || manifest.http?.redirects !== "error" ||
      manifest.http?.arbitraryUrls !== false || manifest.http?.tokenProvidedUrls !== false) {
    throw new TypeError("provider manifest must be the fixed, credential-free read-only run manifest");
  }
  exactKeys(manifest, [
    "enabled", "mode", "execution", "runId", "startAt", "endAt", "durationMs",
    "stopSwitch", "http", "providers", "allowedMints", "allowedPools", "pollBudget"
  ], "provider manifest");
  exactKeys(manifest.http, ["credentials", "redirects", "arbitraryUrls", "tokenProvidedUrls"], "manifest HTTP policy");
  exactKeys(manifest.stopSwitch, ["engaged"], "manifest stop switch");
  if (!Array.isArray(manifest.providers) || manifest.providers.length !== 2 ||
      !manifest.providers.some(item => item?.name === "DexScreener public API" &&
        item.host === HOSTS.dex && item.enabled === true) ||
      !manifest.providers.some(item => item?.name === "Solana mainnet public JSON-RPC" &&
        item.host === HOSTS.rpc && item.enabled === true) ||
      manifest.providers.some(item => !isRecord(item) ||
        Object.keys(item).sort().join(",") !== "enabled,host,name")) {
    throw new TypeError("provider manifest does not match the fixed public read-only hosts");
  }
  if (!Array.isArray(config.candidates) || config.candidates.length < 1 ||
      config.candidates.length > 300 || !Array.isArray(manifest.allowedMints) ||
      !Array.isArray(manifest.allowedPools)) {
    throw new TypeError("a bounded, nonempty fixed candidate allowlist is required");
  }
  const candidateKeys = new Set();
  for (const candidate of config.candidates) {
    exactKeys(candidate, ["chainId", "mint", "pool", "quote"], "candidate identity");
    if (candidate.chainId !== "solana" || !BASE58.test(candidate.mint) ||
        !BASE58.test(candidate.pool) || !BASE58.test(candidate.quote)) {
      throw new TypeError("candidate identity must be a valid Solana mint, pool, and quote");
    }
    const key = `${candidate.chainId}:${candidate.mint}:${candidate.pool}:${candidate.quote}`;
    if (candidateKeys.has(key)) throw new TypeError("candidate identities must be unique");
    candidateKeys.add(key);
  }
  const mints = [...new Set(config.candidates.map(item => item.mint))].sort();
  const pools = [...new Set(config.candidates.map(item => item.pool))].sort();
  if (canonicalJson(manifest.allowedMints) !== canonicalJson(mints) ||
      canonicalJson(manifest.allowedPools) !== canonicalJson(pools)) {
    throw new TypeError("manifest allowlists must exactly bind the configured candidate identities");
  }
  const poll = manifest.pollBudget;
  exactKeys(poll, [
    "maxRequestsPerRun", "maxRequestsPerProvider", "maxBytesPerResponse",
    "maxBytesPerRun", "maxEvents", "maxCandidates"
  ], "provider poll budget");
  boundedInteger(poll.maxRequestsPerRun, "manifest maxRequestsPerRun", 1, 960);
  boundedInteger(poll.maxRequestsPerProvider, "manifest maxRequestsPerProvider", 1, 480);
  boundedInteger(poll.maxBytesPerResponse, "manifest maxBytesPerResponse", 1, 1_048_576);
  boundedInteger(poll.maxBytesPerRun, "manifest maxBytesPerRun", poll.maxBytesPerResponse, 10_485_760);
  boundedInteger(poll.maxEvents, "manifest maxEvents", 1, 10_000);
  boundedInteger(poll.maxCandidates, "manifest maxCandidates", config.candidates.length, 300);
  exactKeys(config.budgets, [
    "requests", "dexRequests", "rpcRequests", "bytes", "providerEvents",
    "candidates", "events", "cycles", "pollIntervalMs",
    "callbackSettlementMs", "requestTimeoutMs"
  ], "run budgets");
  boundedInteger(config.budgets.requests, "requests", 1, Math.min(960, poll.maxRequestsPerRun));
  boundedInteger(config.budgets.dexRequests, "dexRequests", 1, Math.min(480, poll.maxRequestsPerProvider));
  boundedInteger(config.budgets.rpcRequests, "rpcRequests", 1, Math.min(480, poll.maxRequestsPerProvider));
  boundedInteger(config.budgets.bytes, "bytes", 1, Math.min(10_485_760, poll.maxBytesPerRun));
  boundedInteger(config.budgets.providerEvents, "providerEvents", 1, Math.min(10_000, poll.maxEvents));
  boundedInteger(config.budgets.candidates, "candidates", 1, Math.min(300, poll.maxCandidates));
  boundedInteger(config.budgets.events, "events", 1, 1_000);
  boundedInteger(config.budgets.cycles, "cycles", 1, 481);
  if (config.budgets.pollIntervalMs !== 60_000) {
    throw new TypeError("pollIntervalMs must remain fixed at 60000 ms");
  }
  boundedInteger(config.budgets.callbackSettlementMs, "callbackSettlementMs",
    config.budgets.requestTimeoutMs, 60_000);
  boundedInteger(config.budgets.requestTimeoutMs, "requestTimeoutMs", 1, 30_000);
  if (config.budgets.candidates > config.budgets.events ||
      config.budgets.requests > config.budgets.dexRequests + config.budgets.rpcRequests) {
    throw new TypeError("run budgets are internally inconsistent");
  }
  return config;
}

async function readCanonicalJson(filePath, maxBytes, label) {
  const bytes = await readFile(filePath);
  if (bytes.length > maxBytes) throw new RangeError(`${label} exceeds its byte limit`);
  const text = bytes.toString("utf8");
  const value = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new TypeError(`${label} must use canonical JSON bytes`);
  return {value, bytes};
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeExclusive(filePath, value) {
  const directory = path.dirname(filePath);
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(directory);
}

async function writeAtomic(filePath, bytes) {
  const directory = path.dirname(filePath);
  const temporary = path.join(directory, `.pilot-${process.pid}-${digest(bytes).slice(0, 12)}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
    await syncDirectory(directory);
  } catch (error) {
    await rm(temporary, {force: true}).catch(() => {});
    throw error;
  }
}

function pathsFor(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new TypeError("pilot data directory must be an absolute path");
  }
  const root = path.resolve(directory);
  return {
    root,
    lock: path.join(root, "run.lock"),
    stop: path.join(root, "stop.request"),
    terminal: path.join(root, "terminal.json"),
    config: path.join(root, "run-config.json"),
    checkpoint: path.join(root, "checkpoint"),
    reportJson: path.join(root, "operator-report.json"),
    reportText: path.join(root, "operator-report.md")
  };
}

async function readOptionalJson(filePath, maxBytes = 16 * 1024) {
  try {
    return (await readCanonicalJson(filePath, maxBytes, path.basename(filePath))).value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function readPilotStatus(dataDirectory) {
  const paths = pathsFor(dataDirectory);
  let lock;
  let terminal;
  try {
    [lock, terminal] = await Promise.all([
      readOptionalJson(paths.lock),
      readOptionalJson(paths.terminal)
    ]);
  } catch {
    return {status: "UNKNOWN", reason: "durable run state is unreadable"};
  }
  if (!lock) return {status: "NOT_STARTED", runId: null};
  if (lock.version !== 1 || typeof lock.runId !== "string" || !SAFE_ID.test(lock.runId) ||
      typeof lock.configHash !== "string" || !/^[a-f0-9]{64}$/.test(lock.configHash)) {
    return {status: "UNKNOWN", reason: "durable run lock is malformed"};
  }
  if (terminal) {
    if (terminal.version !== 1 || !["FINISHED", "UNKNOWN"].includes(terminal.status) ||
        terminal.runId !== lock.runId || terminal.configHash !== lock.configHash) {
      return {status: "UNKNOWN", reason: "terminal marker does not bind the durable run lock"};
    }
    return terminal;
  }
  return {
    status: "UNKNOWN",
    runId: lock.runId,
    configHash: lock.configHash,
    reason: "durable run lock exists without a terminal marker; restart is forbidden"
  };
}

export async function requestPilotStop(dataDirectory, {now = Date.now()} = {}) {
  const paths = pathsFor(dataDirectory);
  let lock;
  let terminal;
  try {
    lock = await readOptionalJson(paths.lock);
    terminal = await readOptionalJson(paths.terminal);
  } catch {
    return {status: "UNKNOWN", reason: "durable run state is unreadable"};
  }
  if (!lock) return {status: "BLOCKED", reason: "no durable run lock exists"};
  if (lock.version !== 1 || typeof lock.runId !== "string" || !SAFE_ID.test(lock.runId) ||
      typeof lock.configHash !== "string" || !/^[a-f0-9]{64}$/.test(lock.configHash)) {
    return {status: "UNKNOWN", reason: "durable run lock is malformed"};
  }
  if (terminal) return {status: "ALREADY_TERMINAL", runId: lock.runId};
  const request = {
    runId: lock.runId,
    configHash: lock.configHash,
    requestedAt: boundedInteger(now, "stop request time", 1, Number.MAX_SAFE_INTEGER),
    reason: "OPERATOR_STOP"
  };
  try {
    await writeExclusive(paths.stop, request);
    return {status: "STOP_REQUESTED", runId: lock.runId};
  } catch (error) {
    if (error.code === "EEXIST") {
      const existing = await readOptionalJson(paths.stop);
      if (existing?.runId === lock.runId && existing?.configHash === lock.configHash) {
        return {status: "STOP_REQUESTED", runId: lock.runId};
      }
      return {status: "UNKNOWN", reason: "existing stop request has a different identity"};
    }
    throw error;
  }
}

export async function readPilotReport(dataDirectory) {
  const paths = pathsFor(dataDirectory);
  let status;
  let report;
  try {
    [status, report] = await Promise.all([
      readPilotStatus(dataDirectory),
      readOptionalJson(paths.reportJson, MAX_REPORT_BYTES)
    ]);
  } catch {
    return {status: "UNKNOWN", reason: "persisted operator report is unreadable"};
  }
  if (!report) return {status: "BLOCKED", runStatus: status.status, reason: "no durable operator report exists"};
  const accounting = report.observation?.providerAccounting;
  if (report.runId !== status.runId || report.configHash !== status.configHash ||
      !isRecord(report.dto?.experiment) ||
      report.dto.experiment.source !== "READ_ONLY_PAPER_CHECKPOINT" ||
      report.dto.experiment.evidenceKind !== "READ_ONLY_PAPER_CHECKPOINT_RECEIPTS" ||
      report.dto.experiment.sourceProvenance !== "CALLER_LABEL_ONLY_NOT_AUTHENTICATED" ||
      !isRecord(accounting) || !isRecord(status.providerAccounting) ||
      canonicalJson(accounting) !== canonicalJson(status.providerAccounting) ||
      report.observation.entryAuthorizations !== 0 ||
      report.observation.simulatedFills !== 0 ||
      report.observation.executableQuoteAndCostEvidence !== "UNAVAILABLE") {
    return {status: "UNKNOWN", reason: "report failed its provenance or durable identity contract"};
  }
  return {
    status: "AVAILABLE",
    runStatus: status.status,
    report: report.dto,
    observation: report.observation,
    text: report.text
  };
}

function validateAssembly(assembly) {
  validatePins(assembly?.pins, "assembly");
  for (const name of [
    "acquireProviderEvidence", "createPilotRunControl", "projectOperatorReport",
    "renderOperatorReport", "transport"
  ]) {
    if (typeof assembly[name] !== "function") {
      throw new TypeError(`pinned assembly must export ${name} as a function`);
    }
  }
  if (!isRecord(assembly.freshnessPolicy)) {
    throw new TypeError("pinned assembly must supply the documented provider freshnessPolicy");
  }
  return assembly;
}

function addCounters(totals, counters, budgets) {
  if (!isRecord(counters) || !isRecord(counters.byProvider) ||
      !["requests", "bytes", "events", "reservedBytes"].every(key =>
        Number.isSafeInteger(counters[key]) && counters[key] >= 0) ||
      !["dex", "rpc"].every(key =>
        Number.isSafeInteger(counters.byProvider[key]) && counters.byProvider[key] >= 0) ||
      counters.byProvider.dex + counters.byProvider.rpc !== counters.requests ||
      counters.events !== counters.requests || counters.reservedBytes !== 0) {
    throw new Error("provider request accounting is incomplete or inconsistent");
  }
  totals.requests += counters.requests;
  totals.bytes += counters.bytes;
  totals.providerEvents += counters.events;
  totals.dexRequests += counters.byProvider.dex;
  totals.rpcRequests += counters.byProvider.rpc;
  for (const [key, limit] of [
    ["requests", budgets.requests], ["bytes", budgets.bytes],
    ["providerEvents", budgets.providerEvents], ["dexRequests", budgets.dexRequests],
    ["rpcRequests", budgets.rpcRequests]
  ]) {
    if (totals[key] > limit) throw new Error(`cumulative ${key} budget exceeded`);
  }
}

function makeInvocationManifest(config, totals, candidateCount) {
  const remaining = {
    requests: config.budgets.requests - totals.requests,
    dex: config.budgets.dexRequests - totals.dexRequests,
    rpc: config.budgets.rpcRequests - totals.rpcRequests,
    bytes: config.budgets.bytes - totals.bytes,
    events: config.budgets.providerEvents - totals.providerEvents,
    candidates: config.budgets.candidates - totals.candidates
  };
  if (remaining.requests < 1 || remaining.dex < 1 || remaining.rpc < 1 ||
      remaining.bytes < 1 || remaining.events < 1 || remaining.candidates < 1) return null;
  const allowed = config.candidates.slice(0, Math.min(candidateCount, remaining.candidates));
  const maxBytesPerResponse = Math.min(config.manifest.pollBudget.maxBytesPerResponse, remaining.bytes);
  if (maxBytesPerResponse < 1) return null;
  const manifest = {
    ...config.manifest,
    allowedMints: [...new Set(allowed.map(item => item.mint))].sort(),
    allowedPools: [...new Set(allowed.map(item => item.pool))].sort(),
    pollBudget: {
      ...config.manifest.pollBudget,
      maxRequestsPerRun: Math.min(config.manifest.pollBudget.maxRequestsPerRun, remaining.requests),
      maxRequestsPerProvider: Math.min(
        config.manifest.pollBudget.maxRequestsPerProvider,
        remaining.dex,
        remaining.rpc
      ),
      maxBytesPerResponse,
      maxBytesPerRun: Math.min(config.manifest.pollBudget.maxBytesPerRun, remaining.bytes),
      maxEvents: Math.min(config.manifest.pollBudget.maxEvents, remaining.events),
      maxCandidates: allowed.length
    }
  };
  return {manifest, candidates: allowed};
}

async function verifyCheckpoint(session, store) {
  const metadata = session.metadata;
  const readback = await store.readCheckpoint();
  if (readback.status !== "OK" || readback.sequence !== metadata.sequence ||
      readback.hash !== metadata.hash || digest(readback.bytes) !== metadata.hash) {
    throw new Error("checkpoint receipt lacks exact durable readback");
  }
  const checkpoint = JSON.parse(readback.bytes.toString("utf8"));
  if (!canonicalCheckpointBytes(checkpoint).equals(readback.bytes) ||
      checkpoint.runHeader?.runId !== metadata.runId ||
      checkpoint.runHeader?.startedAt !== metadata.startedAt ||
      checkpoint.sequence !== metadata.sequence ||
      checkpoint.records?.length !== metadata.sequence + 1) {
    throw new Error("checkpoint readback has mixed run, sequence, or hash identity");
  }
  return {metadata, checkpoint};
}

async function commandReceipt(session, store, command, method, result, priorSequence) {
  const {metadata, checkpoint} = await verifyCheckpoint(session, store);
  const record = checkpoint.records.at(-1);
  const expectedDigest = digest(canonicalCheckpointBytes(result));
  if (metadata.sequence !== priorSequence + 1 || record.sequence !== metadata.sequence ||
      record.runId !== metadata.runId || record.commandId !== command ||
      record.method !== method || record.resultDigest !== expectedDigest) {
    throw new Error("checkpoint command result is not bound to its acknowledged receipt");
  }
  return {
    commandId: record.commandId,
    method: record.method,
    result,
    resultDigest: record.resultDigest
  };
}

function reportInput({session, receipts}) {
  const metadata = session.metadata;
  const snapshot = session.snapshot();
  if (metadata.sequence !== receipts.length || snapshot.summary.runId !== metadata.runId ||
      !Array.isArray(snapshot.auditEvents)) {
    throw new Error("checkpoint report input does not match the complete receipt sequence");
  }
  return {
    reportType: "READ_ONLY_PAPER_CHECKPOINT",
    source: "READ_ONLY_PAPER_CHECKPOINT",
    metadata,
    results: receipts,
    snapshot,
    liveCandidateEvidence: false
  };
}

function summaryCode(value) {
  return typeof value === "string" && /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : "UNKNOWN";
}

async function persistReport(assembly, paths, input, identity, observation) {
  const dto = assembly.projectOperatorReport(input);
  if (!isRecord(dto?.experiment) || dto.experiment.source !== "READ_ONLY_PAPER_CHECKPOINT" ||
      dto.experiment.evidenceKind !== "READ_ONLY_PAPER_CHECKPOINT_RECEIPTS" ||
      dto.experiment.sourceProvenance !== "CALLER_LABEL_ONLY_NOT_AUTHENTICATED" ||
      !isRecord(dto.trading)) {
    throw new TypeError("operator report projector returned an unsupported read-only checkpoint result");
  }
  const projectedText = assembly.renderOperatorReport(dto);
  if (typeof projectedText !== "string") throw new TypeError("operator report renderer did not return text");
  const text = [
    projectedText,
    "",
    "## Runtime observation (not a trade ledger)",
    `Provider requests: ${observation.providerAccounting.requests}`,
    `Provider request events: ${observation.providerAccounting.providerEvents}`,
    `Response bytes: ${observation.providerAccounting.bytes}`,
    `Candidate observations: ${observation.providerAccounting.candidates}`,
    `Hard-filter outcomes: PASS=${observation.filterOutcomes.PASS}, REJECT=${observation.filterOutcomes.REJECT}, UNKNOWN=${observation.filterOutcomes.UNKNOWN}`,
    `Analyst outcomes: PASS=${observation.analysisOutcomes.PASS}, REJECT=${observation.analysisOutcomes.REJECT}, UNKNOWN=${observation.analysisOutcomes.UNKNOWN}, SCORE_UNAVAILABLE=${observation.analysisOutcomes.SCORE_UNAVAILABLE}, BLOCKED=${observation.analysisOutcomes.BLOCKED}`,
    `Controller status: ${observation.controllerStatus}; stop reason: ${observation.stopReason}; failure: ${observation.failureCode}`,
    ...(observation.windowFinalization ? [
      `Effective observation-window end: ${new Date(observation.windowFinalization.effectiveEndAt).toISOString()}`,
      `Actual ledger finalization: ${new Date(observation.windowFinalization.finalizedAt).toISOString()}`,
      `Finalization lateness: ${observation.windowFinalization.latenessMs} ms (${observation.windowFinalization.basis})`
    ] : ["Window finalization timing: UNKNOWN"]),
    ...(observation.controllerPositionEvidence ? [
      `Controller position evidence: ${observation.controllerPositionEvidence.status}; last-known status: ${summaryCode(observation.controllerPositionEvidence.lastKnown?.status)}`
    ] : []),
    "Entry authorizations: 0",
    "Simulated fills: 0",
    "Executable quote and validated cost evidence: UNAVAILABLE"
  ].join("\n");
  const record = {runId: identity.runId, configHash: identity.configHash, dto, observation, text};
  const json = Buffer.from(canonicalJson(record), "utf8");
  const markdown = Buffer.from(text, "utf8");
  if (json.length > MAX_REPORT_BYTES || markdown.length > MAX_REPORT_BYTES) {
    throw new RangeError("operator report exceeds the persisted report bound");
  }
  await writeAtomic(paths.reportJson, json);
  await writeAtomic(paths.reportText, markdown);
  return {dto, text};
}

export function createPilotOnline(options = {}) {
  const mode = options.mode ?? null;
  if (mode !== null && mode !== READ_ONLY_PAPER) {
    throw new TypeError("only explicit READ_ONLY_PAPER mode is supported");
  }
  let control = null;
  let started = false;
  let startPromise = null;
  let pendingStop = false;

  const integration = {
    async start() {
      if (mode !== READ_ONLY_PAPER) return DISABLED;
      if (startPromise) return startPromise;
      started = true;
      startPromise = run();
      return startPromise;
    },
    async stop() {
      if (mode !== READ_ONLY_PAPER || !started) return {status: "BLOCKED", reason: "run is not active"};
      pendingStop = true;
      const requested = await requestPilotStop(options.dataDirectory);
      control?.stop();
      return requested;
    },
    async status() {
      return readPilotStatus(options.dataDirectory);
    },
    async report() {
      return readPilotReport(options.dataDirectory);
    }
  };

  async function run() {
    const paths = pathsFor(options.dataDirectory);
    let store;
    let session;
    let lockCreated = false;
    const totals = {
      requests: 0, bytes: 0, providerEvents: 0, dexRequests: 0, rpcRequests: 0, candidates: 0
    };
    const observations = {
      filterOutcomes: {PASS: 0, REJECT: 0, UNKNOWN: 0},
      analysisOutcomes: {
        PASS: 0, REJECT: 0, UNKNOWN: 0, SCORE_UNAVAILABLE: 0, BLOCKED: 0
      },
      controllerStatus: "NOT_STARTED",
      stopReason: "UNKNOWN",
      failureCode: "UNKNOWN",
      windowFinalization: null,
      entryAuthorizations: 0,
      simulatedFills: 0,
      executableQuoteAndCostEvidence: "UNAVAILABLE"
    };
    const receipts = [];
    let controllerSummary = null;
    let controllerReportObserved = false;
    let reportStatus = "BLOCKED";
    let reportTradingStatus = "UNKNOWN";
    let failureCode = null;
    let callbackWorkUnsettled = false;
    const callbackWork = new Set();
    let configHash = null;
    let config;
    let assembly;
    const wallClock = options.wallClock ?? Date.now;
    let lastWallClockValue = null;
    let wallClockFault = false;
    const readWallClock = () => {
      let value;
      try {
        value = wallClock();
      } catch {
        wallClockFault = true;
        return null;
      }
      if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime()) ||
          (lastWallClockValue !== null && value < lastWallClockValue)) {
        wallClockFault = true;
        return null;
      }
      lastWallClockValue = value;
      return value;
    };
    const monotonicClock = options.monotonicClock ?? (() => performance.now());
    const scheduler = options.scheduler ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: handle => clearTimeout(handle)
    };
    const openCheckpointStore = options.openCheckpointStore ?? CheckpointStore.open;
    const openCheckpointSession = options.openCheckpointSession ?? PaperCheckpointSession.open;
    const trackCallback = callback => payload => {
      const task = Promise.resolve().then(() => callback(payload));
      callbackWork.add(task);
      task.then(
        () => callbackWork.delete(task),
        () => callbackWork.delete(task)
      );
      return task;
    };
    const settleCallbackWork = () => {
      if (callbackWork.size === 0) return Promise.resolve(true);
      return new Promise(resolve => {
        let timer;
        let ownsTimer = false;
        let settled = false;
        const finish = result => {
          if (settled) return;
          settled = true;
          if (ownsTimer) {
            try { scheduler.clearTimeout(timer); } catch { /* leave uncertain work blocked */ }
          }
          resolve(result && callbackWork.size === 0);
        };
        try {
          timer = scheduler.setTimeout(
            () => finish(false),
            config.budgets.callbackSettlementMs
          );
          ownsTimer = timer !== undefined && timer !== null;
          if (!ownsTimer) {
            finish(false);
            return;
          }
        } catch {
          finish(false);
          return;
        }
        Promise.all([...callbackWork].map(task => task.then(
          () => undefined,
          () => undefined
        ))).then(() => finish(true));
      });
    };
    if (typeof wallClock !== "function" || typeof monotonicClock !== "function" ||
        !isRecord(scheduler) || typeof scheduler.setTimeout !== "function" ||
        typeof scheduler.clearTimeout !== "function" ||
        typeof openCheckpointStore !== "function" || typeof openCheckpointSession !== "function") {
      throw new TypeError("clocks, scheduler, and checkpoint openers are required");
    }
    try {
      if (typeof options.dataDirectory !== "string" || !path.isAbsolute(options.dataDirectory) ||
          typeof options.configPath !== "string" || !path.isAbsolute(options.configPath) ||
          (options.assembly === undefined &&
            (typeof options.assemblyPath !== "string" || !path.isAbsolute(options.assemblyPath)))) {
        throw new TypeError("dataDirectory, configPath, and assemblyPath must be explicit absolute paths");
      }
      const loaded = await readCanonicalJson(options.configPath, MAX_CONFIG_BYTES, "run configuration");
      configHash = digest(loaded.bytes);
      config = validateConfig(loaded.value, readWallClock());
      if (options.assembly !== undefined) {
        assembly = validateAssembly(options.assembly);
      } else {
        const imported = await import(pathToFileURL(options.assemblyPath).href);
        const supplied = typeof imported.createPinnedAssembly === "function"
          ? await imported.createPinnedAssembly()
          : imported.default ?? imported;
        assembly = validateAssembly(supplied);
      }
      validatePins(assembly.pins, "assembly");
      const rootStat = await lstat(paths.root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        throw new Error("pilot data directory must be a pre-mounted real directory");
      }
      const existing = await readdir(paths.root);
      if (existing.some(name => name !== "checkpoint" && name !== "run-config.json")) {
        throw new Error("persistent run state already exists; restart or recovery is forbidden");
      }
      const configAlreadyPersisted = existing.includes("run-config.json");
      if (configAlreadyPersisted) {
        const configStat = await lstat(paths.config);
        if (!configStat.isFile() || configStat.isSymbolicLink()) {
          throw new Error("persistent run configuration must be a regular file");
        }
        const persistedConfig = await readCanonicalJson(
          paths.config, MAX_CONFIG_BYTES, "persistent run configuration"
        );
        if (!persistedConfig.bytes.equals(loaded.bytes)) {
          throw new Error("persistent run configuration differs from the explicitly supplied config");
        }
      }
      await mkdir(paths.checkpoint, {recursive: true, mode: 0o700});
      await syncDirectory(paths.root);
      if ((await readdir(paths.checkpoint)).length !== 0) {
        throw new Error("checkpoint directory is not empty; recovery is blocked");
      }
      await writeExclusive(paths.lock, {
        version: 1,
        runId: config.runId,
        configHash,
        startAt: config.startAt,
        endAt: config.endAt,
        pid: process.pid,
        state: "STARTED"
      });
      lockCreated = true;
      if (!configAlreadyPersisted) await writeExclusive(paths.config, loaded.value);
      store = await openCheckpointStore(paths.checkpoint);
      session = await openCheckpointSession({
        store,
        runId: config.runId,
        startedAt: config.startAt
      });
      const initial = await verifyCheckpoint(session, store);
      if (initial.metadata.sequence !== 0 || initial.checkpoint.records.length !== 1) {
        throw new Error("fresh one-shot run did not initialize a header-only checkpoint");
      }
      const initialState = session.snapshot();
      const initialPositions = initialState.summary.openPositions;
      if (!Array.isArray(initialPositions) || initialPositions.length !== 0) {
        throw new Error("new one-shot run has unresolved prior positions; recovery is blocked");
      }

      const callbacks = {
        async acquire({cycleIndex, remainingRequests, remainingEvents, signal}) {
          if (signal?.aborted) throw new Error("provider acquisition cancelled");
          if (cycleIndex % PROVIDER_POLL_CYCLE_INTERVAL !== 0) {
            return {
              events: [],
              requestsUsed: 0,
              done: false,
              evidenceSource: "READ_ONLY_PROVIDER_CALLBACK"
            };
          }
          const candidatesAvailable = Math.min(
            config.budgets.events - totals.candidates,
            config.budgets.candidates - totals.candidates
          );
          const plan = candidatesAvailable > 0
            ? makeInvocationManifest(config, totals, candidatesAvailable) : null;
          if (!plan) {
            return {
              events: [],
              requestsUsed: 0,
              done: false,
              evidenceSource: "READ_ONLY_PROVIDER_CALLBACK"
            };
          }
          const result = await assembly.acquireProviderEvidence({
            manifest: plan.manifest,
            candidates: plan.candidates,
            enabled: true,
            transport: (request, requestOptions) => {
              const now = readWallClock();
              if (wallClockFault || !Number.isSafeInteger(now) ||
                  now < config.startAt || now >= config.endAt) {
                throw new Error("provider dispatch blocked by invalid clock or closed run window");
              }
              return assembly.transport(request, requestOptions);
            },
            clock: readWallClock,
            signal,
            freshnessPolicy: assembly.freshnessPolicy,
            requestTimeoutMs: config.budgets.requestTimeoutMs
          });
          addCounters(totals, result?.counters, config.budgets);
          if (totals.candidates + (result?.candidates?.length ?? 0) > config.budgets.candidates ||
              (result?.candidates?.length ?? 0) > remainingEvents ||
              result?.counters?.requests > remainingRequests) {
            throw new Error("provider result exceeded the cumulative run-control budget");
          }
          if (!Array.isArray(result.candidates) || result.candidates.length !== plan.candidates.length ||
              !["ACQUISITION_FINISHED", "PARTIAL"].includes(result.status)) {
            throw new Error("provider result does not match the pinned acquisition contract");
          }
          const events = result.candidates.map((item, index) => {
            const candidate = item?.candidate;
            const expected = plan.candidates[index];
            if (item.identityStatus !== "BOUND_TO_REQUEST" ||
                candidate?.chainId !== expected.chainId || candidate?.mint !== expected.mint ||
                candidate?.pool !== expected.pool || candidate?.quote !== expected.quote) {
              throw new Error("provider candidate identity is missing, mixed, or unknown");
            }
            return {kind: "READ_ONLY_OBSERVATION", candidate};
          });
          totals.candidates += events.length;
          return {
            events,
            requestsUsed: result.counters.requests,
            done: result.status !== "ACQUISITION_FINISHED",
            evidenceSource: "READ_ONLY_PROVIDER_CALLBACK"
          };
        },
        async step({event, signal}) {
          if (signal?.aborted || event?.kind !== "READ_ONLY_OBSERVATION" ||
              !isRecord(event.candidate)) {
            throw new Error("read-only observation step is invalid or cancelled");
          }
          const now = readWallClock();
          const filters = filterCandidate(event.candidate, {now, holdUntil: config.endAt});
          const analysis = analyzeCandidate(event.candidate, {
            now,
            filterResult: filters,
            smartWalletAllowlist: {status: "UNSET", provenance: null}
          });
          const filterStatus = Object.hasOwn(observations.filterOutcomes, filters.status)
            ? filters.status : "UNKNOWN";
          const analysisStatus = Object.hasOwn(observations.analysisOutcomes, analysis.status)
            ? analysis.status : "UNKNOWN";
          observations.filterOutcomes[filterStatus] += 1;
          observations.analysisOutcomes[analysisStatus] += 1;
          const positions = session.snapshot().summary.openPositions;
          return Array.isArray(positions) ? {unresolvedPositions: positions} : {};
        },
        async checkpoint({cycleIndex, signal}) {
          if (signal?.aborted) throw new Error("checkpoint callback cancelled");
          const now = readWallClock();
          if (!Number.isSafeInteger(now) || now < config.startAt || now > config.endAt) {
            throw new Error("checkpoint time is outside the pinned run window");
          }
          const commandId = `pilot:${config.runId}:risk:${cycleIndex}`;
          const result = await session.riskSnapshot(commandId, {now, marks: []});
          const receipt = await commandReceipt(
            session, store, commandId, "riskSnapshot", result, receipts.length
          );
          if (receipt.commandId !== commandId || receipt.method !== "riskSnapshot") {
            throw new Error("risk snapshot receipt identity is inconsistent");
          }
          receipts.push(receipt);
          return {
            status: "ACKNOWLEDGED",
            sequence: session.metadata.sequence,
            hash: session.metadata.hash
          };
        },
        async report(payload) {
          if (payload?.mode !== READ_ONLY_PAPER ||
              payload?.evidenceSource !== "READ_ONLY_PROVIDER_CALLBACK") {
            throw new Error("controller terminal callback has an unsupported source label");
          }
          controllerReportObserved = true;
        }
      };
      for (const name of Object.keys(callbacks)) callbacks[name] = trackCallback(callbacks[name]);
      const durationMs = config.endAt - readWallClock();
      boundedInteger(durationMs, "remaining run duration", 1, EIGHT_HOURS_MS);
      control = assembly.createPilotRunControl({
        mode: READ_ONLY_PAPER,
        callbacks,
        clock: monotonicClock,
        scheduler,
        budgets: {
          requests: config.budgets.requests,
          events: config.budgets.events,
          cycles: config.budgets.cycles,
          durationMs,
          pollIntervalMs: config.budgets.pollIntervalMs,
          callbackSettlementMs: config.budgets.callbackSettlementMs
        }
      });
      if (!control || typeof control.start !== "function" || typeof control.stop !== "function") {
        throw new TypeError("pinned controller did not return start/stop lifecycle methods");
      }
      if (pendingStop) control.stop();
      let monitor = true;
      const monitorStopRequest = async () => {
        while (monitor) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (!monitor) return;
          try {
            const request = await readOptionalJson(paths.stop, 2048);
            if (request) {
              if (request.runId !== config.runId || request.configHash !== configHash ||
                  request.reason !== "OPERATOR_STOP") {
                failureCode = "STOP_REQUEST_IDENTITY_UNKNOWN";
              }
              control.stop();
              return;
            }
          } catch {
            failureCode = "STOP_REQUEST_READ_UNKNOWN";
            control.stop();
            return;
          }
        }
      };
      const watcher = monitorStopRequest();
      try {
        controllerSummary = await control.start();
      } finally {
        monitor = false;
        await watcher;
      }
      if (!(await settleCallbackWork())) {
        callbackWorkUnsettled = true;
        failureCode = "CALLBACK_WORK_UNSETTLED";
        observations.controllerStatus = summaryCode(controllerSummary?.status);
        observations.stopReason = summaryCode(controllerSummary?.reason);
        observations.failureCode = failureCode;
        return {
          status: "UNKNOWN",
          runId: config.runId,
          reason: "underlying callback work did not settle within the configured bound; session remains open and restart is forbidden"
        };
      }
      if (!controllerReportObserved && controllerSummary?.status === "FINISHED") {
        failureCode ??= "CONTROLLER_REPORT_CALLBACK_MISSING";
      }
      observations.controllerStatus = summaryCode(controllerSummary?.status);
      observations.stopReason = summaryCode(controllerSummary?.reason);
      observations.failureCode = summaryCode(failureCode ?? controllerSummary?.failureCode);
      if (isRecord(controllerSummary?.positionEvidence)) {
        observations.controllerPositionEvidence = {
          status: summaryCode(controllerSummary.positionEvidence.status),
          lastKnown: controllerSummary.positionEvidence.lastKnown ?? null
        };
      }

      const priorMetadata = session.metadata;
      const checkpointAck = controllerSummary?.checkpointAcknowledgement;
      const controllerAckBound = checkpointAck?.status === "ACKNOWLEDGED" &&
        checkpointAck.sequence === priorMetadata.sequence && checkpointAck.hash === priorMetadata.hash;
      let finishingReceipt = null;
      if (controllerSummary?.status === "FINISHED" && !failureCode && controllerAckBound) {
        const finalizedAt = readWallClock();
        const isDeadline = controllerSummary.reason === "DEADLINE";
        const callbackCompletion = controllerSummary.callbackCompletion;
        const deadlineCallbacksSettled = isRecord(callbackCompletion) &&
          ["acquire", "step"].every(name =>
            callbackCompletion[name] === "NOT_STARTED" || callbackCompletion[name] === "COMPLETED") &&
          (callbackCompletion.checkpoint === "NOT_STARTED" ||
            callbackCompletion.checkpoint === "COMPLETED" ||
            callbackCompletion.checkpoint === "COMPLETED_AFTER_STOP") &&
          Object.keys(callbackCompletion).every(name =>
            ["acquire", "step", "checkpoint"].includes(name));
        const deadlineEvidenceBound = !isDeadline || (
          controllerReportObserved &&
          controllerSummary.reportStatus === "EMITTED" &&
          controllerSummary.requestAccountingStatus === "KNOWN" &&
          deadlineCallbacksSettled &&
          priorMetadata.sequence === receipts.length
        );
        if (isDeadline && !deadlineEvidenceBound) {
          failureCode = "DEADLINE_FINALIZATION_EVIDENCE_UNKNOWN";
        } else if (wallClockFault || !Number.isSafeInteger(finalizedAt) ||
            finalizedAt < config.startAt ||
            (isDeadline
              ? finalizedAt < config.endAt ||
                finalizedAt - config.endAt > MAX_DEADLINE_FINALIZATION_DELAY_MS
              : finalizedAt > config.endAt)) {
          failureCode = isDeadline ? "DEADLINE_FINALIZATION_TIME_UNKNOWN" : "FINISH_TIME_UNKNOWN";
        } else {
          const effectiveEndAt = isDeadline ? config.endAt : finalizedAt;
          observations.windowFinalization = {
            basis: isDeadline ? "SETTLED_DEADLINE_EFFECTIVE_WINDOW_END" : "VALIDATED_ACTUAL_STOP_TIME",
            effectiveEndAt,
            finalizedAt,
            latenessMs: finalizedAt - effectiveEndAt
          };
          const commandId = `pilot:${config.runId}:finish`;
          const result = await session.finishRun(commandId, {now: effectiveEndAt, marks: []});
          finishingReceipt = await commandReceipt(
            session, store, commandId, "finishRun", result, receipts.length
          );
          receipts.push(finishingReceipt);
        }
      } else if (controllerSummary?.status === "FINISHED" && !failureCode) {
        failureCode = "CONTROLLER_CHECKPOINT_ACK_UNBOUND";
      }
      const finalHead = await verifyCheckpoint(session, store);
      if (finalHead.metadata.sequence !== receipts.length) {
        throw new Error("terminal checkpoint sequence does not match retained durable receipts");
      }
      const projected = await persistReport(
        assembly,
        paths,
        reportInput({session, receipts}),
        {runId: config.runId, configHash},
        {providerAccounting: totals, ...observations}
      );
      reportStatus = "PROJECTED";
      reportTradingStatus = projected.dto?.trading?.status ?? "UNKNOWN";
    } catch (error) {
      failureCode ??= typeof error?.code === "string" ? error.code : "PILOT_RUN_BLOCKED";
      observations.controllerStatus = summaryCode(controllerSummary?.status);
      observations.stopReason = summaryCode(controllerSummary?.reason);
      observations.failureCode = summaryCode(failureCode ?? controllerSummary?.failureCode);
      if (!lockCreated) throw error;
      if (callbackWork.size > 0) {
        control?.stop();
        callbackWorkUnsettled = !(await settleCallbackWork());
      }
      if (callbackWorkUnsettled) {
        failureCode = "CALLBACK_WORK_UNSETTLED";
        observations.failureCode = failureCode;
        return {
          status: "UNKNOWN",
          runId: config.runId,
          reason: "underlying callback work did not settle within the configured bound; session remains open and restart is forbidden"
        };
      }
      if (session) {
        try {
          const finalHead = await verifyCheckpoint(session, store);
          if (finalHead.metadata.sequence === receipts.length) {
            const projected = await persistReport(
              assembly,
              paths,
              reportInput({session, receipts}),
              {runId: config.runId, configHash},
              {providerAccounting: totals, ...observations}
            );
            reportStatus = "PROJECTED";
            reportTradingStatus = projected.dto?.trading?.status ?? "UNKNOWN";
          }
        } catch {
          reportStatus = "UNKNOWN";
        }
      }
    } finally {
      if (!callbackWorkUnsettled) {
        if (session) await session.close().catch(() => {});
        else if (store) await store.close().catch(() => {});
      }
    }
    if (lockCreated) {
      const terminalStatus = failureCode || controllerSummary?.status !== "FINISHED"
        ? "UNKNOWN" : "FINISHED";
      try {
        await writeExclusive(paths.terminal, {
          version: 1,
          runId: config.runId,
          configHash,
          status: terminalStatus,
          controllerStatus: controllerSummary?.status ?? "NOT_STARTED",
          stopReason: controllerSummary?.reason ?? null,
          failureCode,
          reportStatus,
          reportTradingStatus,
          providerAccounting: totals,
          observation: observations,
          observationOnly: true,
          executionStarted: false,
          terminalAt: readWallClock()
        });
      } catch {
        return {
          status: "UNKNOWN",
          runId: config.runId,
          reason: "terminal marker durability is unknown; persistent run lock prevents restart"
        };
      }
      return readPilotStatus(paths.root);
    }
    return DISABLED;
  }

  return Object.freeze(integration);
}

function parseArgs(argv) {
  const [command, ...args] = argv;
  const parsed = {command};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!["--data-dir", "--config", "--assembly", "--mode"].includes(key) ||
        typeof args[index + 1] !== "string" || Object.hasOwn(parsed, key.slice(2))) {
      throw new TypeError("expected command plus unique --data-dir, --config, --assembly, and --mode options");
    }
    parsed[key.slice(2)] = path.resolve(args[++index]);
    if (key === "--mode") parsed.mode = args[index];
  }
  return parsed;
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = argv.length ? parseArgs(argv) : {command: null};
  if (!parsed.command) {
    process.stdout.write(`${JSON.stringify(DISABLED)}\n`);
    return DISABLED;
  }
  if (parsed.command === "status") {
    const result = await readPilotStatus(parsed["data-dir"] ?? parsed.dataDir);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (parsed.command === "report") {
    const result = await readPilotReport(parsed["data-dir"] ?? parsed.dataDir);
    if (result.text) process.stdout.write(`${result.text}\n`);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (parsed.command === "stop") {
    const result = await requestPilotStop(parsed["data-dir"] ?? parsed.dataDir);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  }
  if (parsed.command !== "start" || parsed.mode !== READ_ONLY_PAPER ||
      !parsed["data-dir"] || !parsed.config || !parsed.assembly) {
    throw new TypeError("start requires --mode READ_ONLY_PAPER --config --assembly --data-dir");
  }
  const runner = createPilotOnline({
    mode: READ_ONLY_PAPER,
    dataDirectory: parsed["data-dir"],
    configPath: parsed.config,
    assemblyPath: parsed.assembly
  });
  const onSignal = () => { void runner.stop().catch(() => {}); };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  try {
    const result = await runner.start();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => {
    process.exitCode = ["BLOCKED", "UNKNOWN"].includes(result?.status) ? 2 : 0;
  }).catch(error => {
    process.stdout.write(`${JSON.stringify({status: "BLOCKED", reason: error.message})}\n`);
    process.exitCode = 1;
  });
}
