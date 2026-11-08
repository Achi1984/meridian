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
const CHILD_SHUTDOWN_GRACE_MS = 7_000;

const manifestBytes = await readFile(MANIFEST_PATH);
export const HOST_LAUNCH_MANIFEST = JSON.parse(manifestBytes.toString("utf8"));

export async function runtimeSourceDigest(root = ROOT) {
  const hash = createHash("sha256");
  for (const relativePath of RUNTIME_SOURCE_FILES) {
    hash.update(relativePath).update("\0");
    hash.update(await readFile(join(root, relativePath)));
  }
  return hash.digest("hex");
}

function sameCanonicalManifest(candidate) {
  return JSON.stringify(candidate) === JSON.stringify(HOST_LAUNCH_MANIFEST);
}

export async function validateLaunchManifest(candidate, root = ROOT) {
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
    bytes = await readFile(path);
  } catch {
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
  const bytes = await readFile(join(evidenceDir, HOST_STATE_FILE));
  if (bytes.byteLength > 16_384) throw new Error("HOST_STATE_TOO_LARGE");
  const state = JSON.parse(bytes.toString("utf8"));
  if (state?.schemaVersion !== "SPOT_PAPER_HOST_STATE_V1" ||
      state.runId !== HOST_LAUNCH_MANIFEST.runId ||
      state.runtimeSourceSha256 !== HOST_LAUNCH_MANIFEST.runtimeSourceSha256 ||
      !["PREPARED", "RUNNING", "CHILD_EXITED", "CHILD_SPAWN_FAILED"].includes(state.status)) {
    throw new Error("INVALID_HOST_STATE");
  }
  return state;
}

function journalMatchesLaunch(journal) {
  const limits = journal?.manifest?.limits;
  const report = journal?.events?.at(-1)?.report;
  const terminal = journal?.events?.at(-1);
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
    terminal?.id === "run-terminal" && terminal?.type === "terminal" &&
    report?.schemaVersion === "SPOT_PAPER_PILOT_REPORT_V1" &&
    report.runId === HOST_LAUNCH_MANIFEST.runId &&
    report.model === HOST_LAUNCH_MANIFEST.model &&
    report.mode === "paper" && report.pair === HOST_LAUNCH_MANIFEST.pair &&
    report.operationalStatus === "COMPLETED_BOUNDED" &&
    report.stopReason === terminal.report?.stopReason &&
    ["CYCLE_LIMIT", "DURATION_LIMIT"].includes(report.stopReason) &&
    report.profitability === "NOT_ASSESSED" &&
    report.executionImpact === false && report.liveTrading === false &&
    report.autoPromotion === false &&
    Number.isSafeInteger(report.startedAt) && Number.isSafeInteger(report.endedAt) &&
    report.endedAt >= report.startedAt &&
    Number.isSafeInteger(report.requests) && report.requests <= HOST_LAUNCH_MANIFEST.maxRequests &&
    Number.isSafeInteger(report.deliveredBytes) && report.deliveredBytes <= HOST_LAUNCH_MANIFEST.maxBytes &&
    Number.isSafeInteger(journal.checkpoint?.cycle) &&
    journal.checkpoint.cycle <= HOST_LAUNCH_MANIFEST.maxCycles;
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
  if (state.status === "RUNNING" && childAlive(state.childPid)) {
    return {
      status: "RUNNING_OBSERVED",
      verifiedTerminal: false,
      runId: state.runId,
      note: "Process presence is observed only; execution health and terminal evidence are unverified."
    };
  }
  try {
    journal = await readRunJournal({
      dataRoot: join(evidenceDir, "runtime"),
      runId: HOST_LAUNCH_MANIFEST.runId,
      deadlineAt: performance.now() + JOURNAL_READ_TIMEOUT_MS,
      monotonicNow: () => performance.now()
    });
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
  await lock.writeFile(`${JSON.stringify({ runId: manifest.runId, pid: process.pid })}\n`);
  await lock.sync();
  await lock.close();
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
      status: exitResult.error ? "CHILD_SPAWN_FAILED" : "CHILD_EXITED",
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
