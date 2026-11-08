#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SPOT_PAPER_PILOT_LIMITS, SPOT_PAPER_PILOT_VERSION } from "./core.mjs";
import { readRunJournal } from "./journal.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_PATH = join(ROOT, "scripts/spot-paper-pilot/cli.mjs");
const MANIFEST_PATH = join(ROOT, "scripts/spot-paper-pilot/host-launch-manifest.json");
const RUNTIME_SOURCE_FILES = [
  "scripts/spot-paper-pilot/core.mjs",
  "scripts/spot-paper-pilot/runner.mjs",
  "scripts/spot-paper-pilot/cli.mjs",
  "scripts/spot-paper-pilot/provider.mjs",
  "scripts/spot-paper-pilot/journal.mjs"
];
const HOST_STATE_FILE = "host-state.json";
const HOST_LOCK_FILE = "host.lock";
const JOURNAL_READ_TIMEOUT_MS = 5_000;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_BYTES = 256 * 1024;
const MAX_PENDING_BYTES = 16 * 1024;
const CHILD_SHUTDOWN_GRACE_MS = 7_000;
const CHILD_REAP_GRACE_MS = 1_000;

let bundledManifest = null;
try {
  const manifestBytes = await readBoundedRegularFile(MANIFEST_PATH, 16_384,
    "INVALID_LAUNCH_MANIFEST_FILE", "LAUNCH_MANIFEST_TOO_LARGE");
  bundledManifest = JSON.parse(manifestBytes.toString("utf8"));
} catch {}
export const HOST_LAUNCH_MANIFEST = bundledManifest;

export async function runtimeSourceDigest(root = ROOT) {
  const hash = createHash("sha256");
  for (const relativePath of RUNTIME_SOURCE_FILES) {
    hash.update(relativePath).update("\0");
    hash.update(await readFile(join(root, relativePath)));
  }
  return hash.digest("hex");
}

async function readBoundedRegularFile(path, maxBytes, invalidCode, largeCode) {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  let handle;
  try {
    handle = await open(path, flags);
  } catch (error) {
    if (error.code === "ELOOP") throw new Error(invalidCode);
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(invalidCode);
    if (info.size > maxBytes) throw new Error(largeCode);
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, length,
        buffer.byteLength - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error(largeCode);
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function sameCanonicalManifest(candidate) {
  return HOST_LAUNCH_MANIFEST !== null &&
    JSON.stringify(candidate) === JSON.stringify(HOST_LAUNCH_MANIFEST);
}

export async function validateLaunchManifest(candidate, root = ROOT) {
  if (HOST_LAUNCH_MANIFEST === null) {
    throw new Error("PACKAGED_LAUNCH_MANIFEST_UNAVAILABLE");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
      !sameCanonicalManifest(candidate)) {
    throw new Error("UNTRUSTED_OR_MALFORMED_LAUNCH_MANIFEST");
  }
  const limits = SPOT_PAPER_PILOT_LIMITS;
  const expected = {
    schemaVersion: "SPOT_PAPER_HOST_LAUNCH_V1",
    model: SPOT_PAPER_PILOT_VERSION,
    mode: "paper",
    pair: limits.pair,
    maxCycles: limits.maxCycles,
    maxRequests: limits.maxRequests,
    maxDurationMs: limits.maxDurationMs,
    pollIntervalMs: limits.minPollIntervalMs,
    maxBytes: limits.maxBytes,
    maxResponseBytes: limits.maxResponseBytes,
    requestTimeoutMs: limits.requestTimeoutMs
  };
  for (const [field, value] of Object.entries(expected)) {
    if (candidate[field] !== value) throw new Error(`INVALID_LAUNCH_MANIFEST:${field}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate.runId ?? "") ||
      !/^[a-f0-9]{64}$/.test(candidate.runtimeSourceSha256 ?? "")) {
    throw new Error("INVALID_LAUNCH_MANIFEST_IDENTITY");
  }
  if (await runtimeSourceDigest(root) !== candidate.runtimeSourceSha256) {
    throw new Error("RUNTIME_SOURCE_DIGEST_MISMATCH");
  }
  return candidate;
}

export async function readLaunchManifest(path = MANIFEST_PATH, root = ROOT) {
  let bytes;
  try {
    bytes = await readBoundedRegularFile(path, 16_384,
      "INVALID_LAUNCH_MANIFEST_FILE", "LAUNCH_MANIFEST_TOO_LARGE");
  } catch (error) {
    if (error.message === "LAUNCH_MANIFEST_TOO_LARGE" ||
        error.message === "INVALID_LAUNCH_MANIFEST_FILE") throw error;
    throw new Error("LAUNCH_MANIFEST_UNAVAILABLE");
  }
  if (bytes.byteLength > 16_384) throw new Error("LAUNCH_MANIFEST_TOO_LARGE");
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("MALFORMED_LAUNCH_MANIFEST");
  }
  return validateLaunchManifest(manifest, root);
}

function parseArguments(argv) {
  const [command = "disabled", ...rest] = argv;
  if (!["disabled", "preflight", "status", "report", "launch"].includes(command)) {
    throw new Error("UNKNOWN_HOST_COMMAND");
  }
  const values = {};
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index];
    if (!["--manifest", "--evidence-dir"].includes(option)) {
      throw new Error(`UNKNOWN_ARGUMENT:${option}`);
    }
    if (Object.hasOwn(values, option)) throw new Error(`DUPLICATE_ARGUMENT:${option}`);
    const value = rest[++index];
    if (!value || value.startsWith("--")) throw new Error(`VALUE_REQUIRED:${option}`);
    values[option] = value;
  }
  if (command === "disabled" && rest.length) throw new Error("DISABLED_TAKES_NO_ARGUMENTS");
  if (["preflight", "launch"].includes(command) && !values["--manifest"]) {
    throw new Error("--manifest is required.");
  }
  if (command !== "disabled" && !values["--evidence-dir"]) {
    throw new Error("--evidence-dir is required.");
  }
  if (["status", "report"].includes(command) && values["--manifest"]) {
    throw new Error(`--manifest is not valid for ${command}.`);
  }
  return {
    command,
    manifestPath: values["--manifest"],
    evidenceDir: values["--evidence-dir"] ? resolve(values["--evidence-dir"]) : null
  };
}

async function ensureEvidencePathAvailable(evidenceDir) {
  if (!evidenceDir || !evidenceDir.startsWith("/") || evidenceDir === "/") {
    throw new Error("ABSOLUTE_EVIDENCE_DIRECTORY_REQUIRED");
  }
  try {
    await lstat(evidenceDir);
    throw new Error("EVIDENCE_DIRECTORY_ALREADY_EXISTS");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = await lstat(dirname(evidenceDir));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error("INVALID_EVIDENCE_PARENT");
  }
  await access(dirname(evidenceDir), constants.W_OK | constants.X_OK);
}

async function writeState(evidenceDir, state) {
  const path = join(evidenceDir, HOST_STATE_FILE);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
}

function childAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function readHostState(evidenceDir) {
  const dir = await lstat(evidenceDir);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error("INVALID_EVIDENCE_DIRECTORY");
  const statePath = join(evidenceDir, HOST_STATE_FILE);
  const bytes = await readBoundedRegularFile(statePath, 16_384,
    "INVALID_HOST_STATE_FILE", "HOST_STATE_TOO_LARGE");
  const state = JSON.parse(bytes.toString("utf8"));
  if (state?.schemaVersion !== "SPOT_PAPER_HOST_STATE_V1" ||
      state.runId !== HOST_LAUNCH_MANIFEST.runId ||
      state.runtimeSourceSha256 !== HOST_LAUNCH_MANIFEST.runtimeSourceSha256 ||
      !["PREPARED", "RUNNING", "CHILD_EXITED", "CHILD_SPAWN_FAILED"].includes(state.status)) {
    throw new Error("INVALID_HOST_STATE");
  }
  return state;
}

async function readBoundedRunJournal(evidenceDir) {
  const runDirectory = join(evidenceDir, "runtime", HOST_LAUNCH_MANIFEST.runId);
  const journalPath = join(runDirectory, "journal.json");
  for (const directory of [dirname(runDirectory), runDirectory]) {
    try {
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        throw new Error("INVALID_JOURNAL_DIRECTORY");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const journalInfo = await lstat(journalPath);
    if (!journalInfo.isFile() || journalInfo.isSymbolicLink() ||
        journalInfo.size > MAX_JOURNAL_BYTES) {
      throw new Error("JOURNAL_SIZE_LIMIT");
    }
    let envelope;
    try {
      envelope = JSON.parse((await readFile(journalPath)).toString("utf8"));
    } catch {
      throw new Error("INVALID_JOURNAL_JSON");
    }
    const events = envelope?.payload?.events;
    if (Array.isArray(events)) {
      if (events.length > HOST_LAUNCH_MANIFEST.maxCycles + 2) {
        throw new Error("JOURNAL_EVENT_LIMIT");
      }
      const responses = new Map();
      for (const event of events) {
        for (const response of [event.ohlc, event.ticker, event.acceptedOhlc, event.acceptedTicker]) {
          if (!response?.path) continue;
          if (!Number.isSafeInteger(response.bytes) || response.bytes < 0 ||
              response.bytes > HOST_LAUNCH_MANIFEST.maxResponseBytes) {
            throw new Error("JOURNAL_RESPONSE_SIZE_LIMIT");
          }
          if (typeof response.sha256 !== "string" ||
              response.path !== `responses/${response.sha256}.json` ||
              !/^responses\/[a-f0-9]{64}\.json$/.test(response.path)) {
            throw new Error("INVALID_RESPONSE_REFERENCE");
          }
          const responseInfo = await lstat(join(runDirectory, response.path));
          if (!responseInfo.isFile() || responseInfo.isSymbolicLink() ||
              responseInfo.size !== response.bytes) {
            throw new Error("INVALID_RESPONSE_FILE");
          }
          responses.set(response.path, response.bytes);
        }
      }
      const responseBytes = [...responses.values()].reduce((sum, bytes) => sum + bytes, 0);
      if (responses.size > HOST_LAUNCH_MANIFEST.maxRequests ||
          responseBytes > HOST_LAUNCH_MANIFEST.maxBytes) {
        throw new Error("JOURNAL_RESPONSE_BUDGET_EXCEEDED");
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    const pendingInfo = await lstat(join(runDirectory, "journal.pending"));
    if (!pendingInfo.isFile() || pendingInfo.size > MAX_PENDING_BYTES) {
      throw new Error("JOURNAL_PENDING_SIZE_LIMIT");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return readRunJournal({
    dataRoot: join(evidenceDir, "runtime"),
    runId: HOST_LAUNCH_MANIFEST.runId,
    deadlineAt: performance.now() + JOURNAL_READ_TIMEOUT_MS,
    monotonicNow: () => performance.now()
  });
}

function journalMatchesLaunch(journal) {
  const limits = journal?.manifest?.limits;
  const report = journal?.events?.at(-1)?.report;
  const terminal = journal?.events?.at(-1);
  const start = journal?.events?.[0];
  const counters = journal?.checkpoint?.counters;
  return journal?.runId === HOST_LAUNCH_MANIFEST.runId &&
    journal.manifest?.schemaVersion === "SPOT_PAPER_PILOT_MANIFEST_V1" &&
    journal.manifest?.model === HOST_LAUNCH_MANIFEST.model &&
    journal.manifest?.mode === "paper" &&
    journal.manifest?.pair === HOST_LAUNCH_MANIFEST.pair &&
    limits?.maxCycles === HOST_LAUNCH_MANIFEST.maxCycles &&
    limits?.maxRequests === HOST_LAUNCH_MANIFEST.maxRequests &&
    limits?.maxDurationMs === HOST_LAUNCH_MANIFEST.maxDurationMs &&
    limits?.pollIntervalMs === HOST_LAUNCH_MANIFEST.pollIntervalMs &&
    limits?.maxBytes === HOST_LAUNCH_MANIFEST.maxBytes &&
    limits?.maxResponseBytes === HOST_LAUNCH_MANIFEST.maxResponseBytes &&
    limits?.requestTimeoutMs === HOST_LAUNCH_MANIFEST.requestTimeoutMs &&
    start?.id === "run-start" && start?.type === "start" &&
    terminal?.id === "run-terminal" && terminal?.type === "terminal" &&
    terminal.at === report?.endedAt &&
    journal.checkpoint?.stopReason === report?.stopReason &&
    report?.schemaVersion === "SPOT_PAPER_PILOT_REPORT_V1" &&
    report.runId === HOST_LAUNCH_MANIFEST.runId &&
    report.model === HOST_LAUNCH_MANIFEST.model &&
    report.mode === "paper" && report.pair === HOST_LAUNCH_MANIFEST.pair &&
    report.operationalStatus === "COMPLETED_BOUNDED" &&
    ["CYCLE_LIMIT", "DURATION_LIMIT"].includes(report.stopReason) &&
    report.profitability === "NOT_ASSESSED" &&
    report.executionImpact === false && report.liveTrading === false &&
    report.autoPromotion === false &&
    Number.isSafeInteger(report.startedAt) && Number.isSafeInteger(report.endedAt) &&
    report.startedAt === start.at && report.endedAt >= report.startedAt &&
    Number.isSafeInteger(report.observations) && report.observations >= 0 &&
    Number.isSafeInteger(report.dataGaps) && report.dataGaps >= 0 &&
    Number.isSafeInteger(report.requests) && report.requests >= 0 &&
    report.requests <= HOST_LAUNCH_MANIFEST.maxRequests &&
    report.requests === counters?.requests &&
    Number.isSafeInteger(report.deliveredBytes) && report.deliveredBytes >= 0 &&
    report.deliveredBytes <= HOST_LAUNCH_MANIFEST.maxBytes &&
    report.deliveredBytes === counters?.bytes &&
    Number.isSafeInteger(journal.checkpoint?.cycle) &&
    journal.checkpoint.cycle <= HOST_LAUNCH_MANIFEST.maxCycles &&
    Buffer.byteLength(JSON.stringify(report)) <= MAX_REPORT_BYTES;
}

export async function inspectHostRun(evidenceDir, { includeReport = false } = {}) {
  const absent = { status: "DISABLED", verifiedTerminal: false };
  try {
    await lstat(evidenceDir);
  } catch (error) {
    if (error.code === "ENOENT") return absent;
    return { status: "INCOMPLETE_UNKNOWN", verifiedTerminal: false, reason: "EVIDENCE_DIRECTORY_UNREADABLE" };
  }
  let state;
  let journal;
  let journalError = null;
  try {
    state = await readHostState(evidenceDir);
  } catch (error) {
    return { status: "INCOMPLETE_UNKNOWN", verifiedTerminal: false, reason: error.message };
  }
  if (await runtimeSourceDigest() !== state.runtimeSourceSha256) {
    return {
      status: "INCOMPLETE_UNKNOWN",
      verifiedTerminal: false,
      runId: state.runId,
      reason: "RUNTIME_SOURCE_DIGEST_MISMATCH"
    };
  }
  if (state.status === "RUNNING" && childAlive(state.childPid)) {
    return {
      status: "RUNNING_OBSERVED",
      verifiedTerminal: false,
      runId: state.runId,
      note: "Process presence is observed only; execution health and terminal evidence are unverified."
    };
  }
  try {
    journal = await readBoundedRunJournal(evidenceDir);
  } catch (error) {
    journalError = error.message;
  }
  const terminalVerified = state.status === "CHILD_EXITED" &&
    state.childExitCode === 0 && state.childSignal === null &&
    state.interruptedBy === null && journal?.reconciliationStatus === "READ_ONLY_VERIFIED" &&
    journalMatchesLaunch(journal);
  if (terminalVerified) {
    return {
      status: "VERIFIED_TERMINAL",
      verifiedTerminal: true,
      runId: state.runId,
      reconciliation: journal.reconciliationStatus,
      report: includeReport ? journal.events.at(-1).report : undefined
    };
  }
  return {
    status: "INCOMPLETE_UNKNOWN",
    verifiedTerminal: false,
    runId: state.runId,
    reconciliation: journal?.reconciliationStatus ?? "UNKNOWN",
    reason: state.interruptedBy ? `INTERRUPTED_${state.interruptedBy}` :
      journalError ?? (journal && !journalMatchesLaunch(journal) ?
        "TERMINAL_EVIDENCE_MISMATCH" : "CHILD_OR_JOURNAL_INCOMPLETE"),
    report: includeReport && journal?.events?.at(-1)?.report ? journal.events.at(-1).report : undefined
  };
}

export async function launchHostRun({
  manifest, evidenceDir, spawnImpl = spawn, signalSource = process,
  shutdownGraceMs = CHILD_SHUTDOWN_GRACE_MS
}) {
  await validateLaunchManifest(manifest);
  await ensureEvidencePathAvailable(evidenceDir);
  await mkdir(evidenceDir, { mode: 0o700 });
  const lock = await open(join(evidenceDir, HOST_LOCK_FILE), "wx", 0o600);
  try {
    await lock.writeFile(`${JSON.stringify({ runId: manifest.runId, pid: process.pid })}\n`);
    await lock.sync();
  } finally {
    await lock.close();
  }
  let state = {
    schemaVersion: "SPOT_PAPER_HOST_STATE_V1",
    runId: manifest.runId,
    runtimeSourceSha256: manifest.runtimeSourceSha256,
    status: "PREPARED",
    parentPid: process.pid,
    childPid: null,
    childExitCode: null,
    childSignal: null,
    interruptedBy: null
  };
  await writeState(evidenceDir, state);

  let child;
  let stopTimer;
  let reapTimer;
  let exitResolved = false;
  let settleExit;
  const exitPromise = new Promise(resolvePromise => {
    settleExit = resolvePromise;
  });
  const onExit = result => {
    if (exitResolved) return;
    exitResolved = true;
    settleExit(result);
  };
  let childStopSent = false;
  const requestChildShutdown = () => {
    if (!child || exitResolved || childStopSent) return;
    childStopSent = true;
    try { child.kill("SIGTERM"); } catch {}
    stopTimer = setTimeout(() => {
      if (!exitResolved) {
        try { child.kill("SIGKILL"); } catch {}
        reapTimer = setTimeout(() => {
          onExit({ error: new Error("CHILD_TERMINATION_UNCONFIRMED") });
        }, CHILD_REAP_GRACE_MS);
      }
    }, shutdownGraceMs);
  };
  const onSignal = signal => {
    if (state.interruptedBy) return;
    state = { ...state, interruptedBy: signal };
    requestChildShutdown();
  };
  const onInterrupt = () => onSignal("SIGINT");
  const onTerminate = () => onSignal("SIGTERM");
  signalSource.once("SIGINT", onInterrupt);
  signalSource.once("SIGTERM", onTerminate);
  const args = [
    CLI_PATH, "--mode", "paper", "--network",
    "--data-root", join(evidenceDir, "runtime"),
    "--run-id", manifest.runId,
    "--max-cycles", String(manifest.maxCycles),
    "--max-duration-ms", String(manifest.maxDurationMs),
    "--poll-interval-ms", String(manifest.pollIntervalMs)
  ];
  try {
    child = spawnImpl(process.execPath, args, {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        HOME: evidenceDir
      },
      stdio: "ignore",
      shell: false
    });
    child.once("error", error => onExit({ error }));
    child.once("close", (code, signal) => onExit({ code, signal }));
    state = { ...state, status: "RUNNING", childPid: child.pid ?? null };
    await writeState(evidenceDir, state);
    if (state.interruptedBy) requestChildShutdown();
    const exitResult = exitResolved ? await Promise.resolve(exitPromise) : await exitPromise;
    if (stopTimer) clearTimeout(stopTimer);
    state = {
      ...state,
      status: exitResult.error && !child.pid ? "CHILD_SPAWN_FAILED" : "CHILD_EXITED",
      childExitCode: exitResult.code ?? null,
      childSignal: exitResult.signal ?? null,
      childError: exitResult.error?.message ?? null
    };
    await writeState(evidenceDir, state);
    return inspectHostRun(evidenceDir, { includeReport: true });
  } catch (error) {
    if (child && !exitResolved) {
      try { child.kill("SIGTERM"); } catch {}
      await new Promise(resolvePromise => {
        const timer = setTimeout(() => {
          if (!exitResolved) {
            try { child.kill("SIGKILL"); } catch {}
          }
          resolvePromise();
        }, shutdownGraceMs);
        child.once("close", () => {
          clearTimeout(timer);
          resolvePromise();
        });
      });
    }
    throw error;
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
    if (reapTimer) clearTimeout(reapTimer);
    signalSource.removeListener("SIGINT", onInterrupt);
    signalSource.removeListener("SIGTERM", onTerminate);
  }
}

async function preflight(evidenceDir, manifest) {
  await validateLaunchManifest(manifest);
  await ensureEvidencePathAvailable(evidenceDir);
  return {
    status: "READY_FOR_EXPLICIT_LAUNCH",
    authorization: "NOT_ASSESSED",
    networkRequests: 0,
    childProcesses: 0,
    runId: manifest.runId
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const output = dependencies.stdout ?? process.stdout;
  const { command, manifestPath, evidenceDir } = parseArguments(argv);
  let result;
  if (command === "disabled") {
    result = { status: "DISABLED", networkRequests: 0, childProcesses: 0 };
  } else if (command === "preflight") {
    const manifest = await readLaunchManifest(manifestPath);
    result = await preflight(evidenceDir, manifest);
  } else if (command === "launch") {
    const manifest = await readLaunchManifest(manifestPath);
    result = await launchHostRun({
      manifest, evidenceDir, spawnImpl: dependencies.spawnImpl ?? spawn,
      signalSource: dependencies.signalSource ?? process,
      shutdownGraceMs: dependencies.shutdownGraceMs ?? CHILD_SHUTDOWN_GRACE_MS
    });
  } else {
    result = await inspectHostRun(evidenceDir, { includeReport: command === "report" });
  }
  output.write(`${JSON.stringify(result, null, 2)}\n`);
  if (["INCOMPLETE_UNKNOWN", "DISABLED"].includes(result.status) && command === "launch") {
    process.exitCode = 1;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
