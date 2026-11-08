import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_LAUNCH_MANIFEST, inspectHostRun, launchHostRun, main, readLaunchManifest,
  validateLaunchManifest
} from "../scripts/spot-paper-pilot/host-entrypoint.mjs";
import { SPOT_PAPER_PILOT_LIMITS } from "../scripts/spot-paper-pilot/core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "scripts/spot-paper-pilot/host-launch-manifest.json");
const RUNNER_URL = new URL("../scripts/spot-paper-pilot/runner.mjs", import.meta.url).href;

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "spot-paper-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function runInline(source, options) {
  return spawn(process.execPath, ["--input-type=module", "-e", source], options);
}

function syntheticTerminalSource(evidenceDir) {
  return `
    import { runSpotPaperPilot } from ${JSON.stringify(RUNNER_URL)};
    let monotonic = 0;
    await runSpotPaperPilot({
      dataRoot: ${JSON.stringify(join(evidenceDir, "runtime"))},
      runId: ${JSON.stringify(HOST_LAUNCH_MANIFEST.runId)},
      mode: "paper",
      maxCycles: 480,
      maxDurationMs: 28800000,
      pollIntervalMs: 60000,
      requestTimeoutMs: 5000,
      now: () => 1800000000000,
      monotonicNow: () => monotonic,
      provider: {
        fetchOhlc: async () => {
          monotonic = 28800000;
          throw new Error("REQUEST_TIMEOUT");
        },
        fetchTicker: async () => { throw new Error("UNEXPECTED_TICKER_REQUEST"); }
      }
    });
  `;
}

function launchWithInline(evidenceDir, source, spawnImplOptions = {}) {
  return launchHostRun({
    manifest: HOST_LAUNCH_MANIFEST,
    evidenceDir,
    spawnImpl: (executable, args, options) => {
      assert.equal(executable, process.execPath);
      assert.ok(args[0].endsWith("/scripts/spot-paper-pilot/cli.mjs"));
      assert.deepEqual(args.slice(1), [
        "--mode", "paper", "--network",
        "--data-root", join(evidenceDir, "runtime"),
        "--run-id", HOST_LAUNCH_MANIFEST.runId,
        "--max-cycles", "480",
        "--max-duration-ms", "28800000",
        "--poll-interval-ms", "60000"
      ]);
      assert.equal(options.shell, false);
      assert.deepEqual(Object.keys(options.env).sort(), ["HOME", "NODE_ENV", "PATH"]);
      const child = runInline(source, options);
      spawnImplOptions.onChild?.(child);
      return child;
    },
    ...spawnImplOptions
  });
}

test("default host invocation stays disabled without network or child execution", async () => {
  let output = "";
  const result = await main([], {
    stdout: { write: value => { output += value; } },
    spawnImpl: () => { throw new Error("CHILD_MUST_NOT_START"); }
  });
  assert.deepEqual(result, {
    status: "DISABLED", networkRequests: 0, childProcesses: 0
  });
  assert.deepEqual(JSON.parse(output), result);
  assert.deepEqual(await inspectHostRun("/tmp/spot-paper-host-does-not-exist"), {
    status: "DISABLED", verifiedTerminal: false
  });
});

test("reviewed manifest pins source, identity, and existing upper bounds", async t => {
  const manifest = await readLaunchManifest(MANIFEST_PATH);
  assert.equal(manifest.runtimeSourceSha256, HOST_LAUNCH_MANIFEST.runtimeSourceSha256);
  assert.deepEqual({
    model: manifest.model, mode: manifest.mode, pair: manifest.pair,
    maxCycles: manifest.maxCycles, maxRequests: manifest.maxRequests,
    maxDurationMs: manifest.maxDurationMs, pollIntervalMs: manifest.pollIntervalMs,
    maxBytes: manifest.maxBytes, maxResponseBytes: manifest.maxResponseBytes,
    requestTimeoutMs: manifest.requestTimeoutMs
  }, {
    model: "BTC_EUR_SMA5_SMA20_V1", mode: "paper", pair: "BTC/EUR",
    maxCycles: 480, maxRequests: 960, maxDurationMs: 28_800_000,
    pollIntervalMs: 60_000, maxBytes: 64 * 1024 * 1024,
    maxResponseBytes: 256 * 1024, requestTimeoutMs: 5_000
  });
  assert.equal(manifest.maxCycles, SPOT_PAPER_PILOT_LIMITS.maxCycles);
  assert.equal(manifest.maxRequests, SPOT_PAPER_PILOT_LIMITS.maxRequests);
  assert.equal(manifest.maxDurationMs, SPOT_PAPER_PILOT_LIMITS.maxDurationMs);
  for (const field of ["source", "maxCycles", "maxRequests", "maxDurationMs",
    "mode", "pair", "model"]) {
    const untrusted = structuredClone(manifest);
    if (field === "source") untrusted.runtimeSourceSha256 = "f".repeat(64);
    else if (field === "maxDurationMs") untrusted[field] = 28_800_001;
    else if (field === "maxRequests") untrusted[field] = 961;
    else if (field === "maxCycles") untrusted[field] = 481;
    else untrusted[field] = "untrusted";
    await assert.rejects(validateLaunchManifest(untrusted), /UNTRUSTED|MISMATCH/);
  }
  const parent = await temporaryDirectory(t);
  const malformedPath = join(parent, "malformed.json");
  await writeFile(malformedPath, "{not-json");
  await assert.rejects(readLaunchManifest(malformedPath), /MALFORMED_LAUNCH_MANIFEST/);
  const oversizedPath = join(parent, "oversized.json");
  await writeFile(oversizedPath, Buffer.alloc(16_385));
  await assert.rejects(readLaunchManifest(oversizedPath), /LAUNCH_MANIFEST_TOO_LARGE/);
});

test("preflight is read-only and never starts a child", async t => {
  const parent = await temporaryDirectory(t);
  const evidenceDir = join(parent, "new-run");
  let output = "";
  const result = await main([
    "preflight", "--manifest", MANIFEST_PATH, "--evidence-dir", evidenceDir
  ], {
    stdout: { write: value => { output += value; } },
    spawnImpl: () => { throw new Error("CHILD_MUST_NOT_START"); }
  });
  assert.equal(result.status, "READY_FOR_EXPLICIT_LAUNCH");
  assert.equal(result.authorization, "NOT_ASSESSED");
  assert.equal(result.networkRequests, 0);
  assert.equal(result.childProcesses, 0);
  assert.deepEqual(JSON.parse(output), result);
  await assert.rejects(readFile(evidenceDir), { code: "ENOENT" });
});

test("synthetic no-network child terminates with reconciled bounded evidence; restart is refused", async t => {
  const parent = await temporaryDirectory(t);
  const evidenceDir = join(parent, "run");
  const result = await launchWithInline(evidenceDir, syntheticTerminalSource(evidenceDir));
  assert.equal(result.status, "VERIFIED_TERMINAL");
  assert.equal(result.verifiedTerminal, true);
  assert.equal(result.report.operationalStatus, "COMPLETED_BOUNDED");
  assert.equal(result.report.stopReason, "DURATION_LIMIT");
  assert.equal(result.report.requests, 1);
  assert.equal(result.report.liveTrading, false);
  assert.equal(result.report.autoPromotion, false);
  await assert.rejects(
    launchHostRun({ manifest: HOST_LAUNCH_MANIFEST, evidenceDir,
      spawnImpl: () => { throw new Error("CHILD_MUST_NOT_START"); } }),
    /EVIDENCE_DIRECTORY_ALREADY_EXISTS/
  );
  const status = await inspectHostRun(evidenceDir);
  assert.equal(status.status, "VERIFIED_TERMINAL");
  assert.equal(status.verifiedTerminal, true);
  const journalPath = join(evidenceDir, "runtime", HOST_LAUNCH_MANIFEST.runId, "journal.json");
  const journalBefore = await readFile(journalPath, "utf8");
  let output = "";
  const report = await main(["report", "--evidence-dir", evidenceDir], {
    stdout: { write: value => { output += value; } }
  });
  assert.equal(report.status, "VERIFIED_TERMINAL");
  assert.equal(JSON.parse(output).report.stopReason, "DURATION_LIMIT");
  assert.equal(await readFile(journalPath, "utf8"), journalBefore);
});

test("live PID is only running-observed and signal shutdown remains incomplete", async t => {
  const parent = await temporaryDirectory(t);
  const evidenceDir = join(parent, "run");
  const signals = new EventEmitter();
  const childSource = `
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1000);
  `;
  const launch = launchWithInline(evidenceDir, childSource, { signalSource: signals });
  await new Promise(resolve => setTimeout(resolve, 150));
  const observed = await inspectHostRun(evidenceDir);
  assert.equal(observed.status, "RUNNING_OBSERVED");
  assert.equal(observed.verifiedTerminal, false);
  signals.emit("SIGTERM");
  const result = await launch;
  assert.equal(result.status, "INCOMPLETE_UNKNOWN");
  assert.equal(result.verifiedTerminal, false);
  assert.equal(result.reason, "INTERRUPTED_SIGTERM");
});

test("parent escalates an unresponsive child within the bounded shutdown window", async t => {
  const parent = await temporaryDirectory(t);
  const evidenceDir = join(parent, "run");
  const signals = new EventEmitter();
  const sentSignals = [];
  const childSource = `
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `;
  const launch = launchWithInline(evidenceDir, childSource, {
    signalSource: signals,
    shutdownGraceMs: 50,
    onChild: child => {
      const kill = child.kill.bind(child);
      child.kill = signal => {
        sentSignals.push(signal);
        return kill(signal);
      };
    }
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const startedAt = Date.now();
  signals.emit("SIGTERM");
  const result = await launch;
  assert.ok(Date.now() - startedAt < 2_000);
  assert.deepEqual(sentSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(result.status, "INCOMPLETE_UNKNOWN");
});

test("child failure and pending or corrupt journals remain unknown and read-only", async t => {
  const parent = await temporaryDirectory(t);
  const failedDir = join(parent, "failed");
  const failed = await launchWithInline(failedDir, "process.exit(7);");
  assert.equal(failed.status, "INCOMPLETE_UNKNOWN");
  assert.equal(failed.verifiedTerminal, false);

  const pendingDir = join(parent, "pending");
  const pendingSource = `
    import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    const directory = join(${JSON.stringify(join(pendingDir, "runtime"))},
      ${JSON.stringify(HOST_LAUNCH_MANIFEST.runId)});
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "journal.pending"), "{");
  `;
  const pending = await launchWithInline(pendingDir, pendingSource);
  assert.equal(pending.status, "INCOMPLETE_UNKNOWN");
  assert.equal(pending.reconciliation, "UNKNOWN_PENDING_PUBLICATION");
  const pendingPath = join(pendingDir, "runtime", HOST_LAUNCH_MANIFEST.runId, "journal.pending");
  const before = await readFile(pendingPath, "utf8");
  const report = await inspectHostRun(pendingDir, { includeReport: true });
  assert.equal(report.status, "INCOMPLETE_UNKNOWN");
  assert.equal(report.reconciliation, "UNKNOWN_PENDING_PUBLICATION");
  assert.equal(await readFile(pendingPath, "utf8"), before);

  const corruptDir = join(parent, "corrupt");
  const corruptSource = `
    import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    const directory = join(${JSON.stringify(join(corruptDir, "runtime"))},
      ${JSON.stringify(HOST_LAUNCH_MANIFEST.runId)});
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "journal.json"), "{not-json");
  `;
  const corrupt = await launchWithInline(corruptDir, corruptSource);
  assert.equal(corrupt.status, "INCOMPLETE_UNKNOWN");
  assert.match(corrupt.reason, /INVALID_JOURNAL_JSON/);
  const corruptPath = join(corruptDir, "runtime", HOST_LAUNCH_MANIFEST.runId, "journal.json");
  const corruptBefore = await readFile(corruptPath, "utf8");
  const status = await inspectHostRun(corruptDir);
  assert.equal(status.status, "INCOMPLETE_UNKNOWN");
  assert.equal(await readFile(corruptPath, "utf8"), corruptBefore);
});

test("existing evidence directory or lock is refused without spawning", async t => {
  const parent = await temporaryDirectory(t);
  const evidenceDir = join(parent, "existing");
  await mkdir(evidenceDir);
  await writeFile(join(evidenceDir, "host.lock"), "prior\n");
  await assert.rejects(launchHostRun({
    manifest: HOST_LAUNCH_MANIFEST,
    evidenceDir,
    spawnImpl: () => { throw new Error("CHILD_MUST_NOT_START"); }
  }), /EVIDENCE_DIRECTORY_ALREADY_EXISTS/);
});
