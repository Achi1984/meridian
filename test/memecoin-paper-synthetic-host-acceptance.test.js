import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {EventEmitter} from "node:events";
import {
  chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {
  isVerifiedRealSignalDrillReceipt, main, runSyntheticHostAcceptance, transferSyntheticAcceptance
} from "../scripts/memecoin-paper/synthetic-host-acceptance.mjs";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {evaluateMemecoinPaperRunExport} from "../scripts/memecoin-paper-simulated-evaluation/index.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return {promise, resolve};
}

function filesystemProbe(intercept) {
  const calls = [];
  const handles = new Set();
  const invoke = async (method, filename, action) => {
    calls.push({method, filename});
    return intercept({method, filename, action});
  };
  return {
    calls, handles,
    fileSystem: {
      lstat: filename => invoke("lstat", filename, () => lstat(filename)),
      realpath: filename => invoke("realpath", filename, () => realpath(filename)),
      mkdir: (filename, options) => invoke("mkdir", filename, () => mkdir(filename, options)),
      open: async (filename, ...args) => {
        const handle = await invoke("open", filename, () => open(filename, ...args));
        handles.add(handle);
        return Object.fromEntries(["writeFile", "sync", "stat", "read", "close"].map(method => [
          method, (...values) => invoke(method, filename, async () => {
            const value = await handle[method](...values);
            if (method === "close") handles.delete(handle);
            return value;
          })
        ]));
      }
    }
  };
}

async function drainProbe(probe) {
  const deadline = performance.now() + 2_000;
  while (probe.handles.size > 0 && performance.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(probe.handles.size, 0);
}

async function root(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synthetic-acceptance-"));
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

function startForegroundChild(dataRoot, claimId, waitTimeoutMs = 60_000, finalizationTimeoutMs = 60_000) {
  const child = spawn(process.execPath, [
    path.resolve("scripts/memecoin-paper/synthetic-host-acceptance.mjs")
  ], {
    env: {
      PATH: process.env.PATH,
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND_WAIT_TIMEOUT_MS: String(waitTimeoutMs),
      PAPER_SYNTHETIC_ACCEPTANCE_FINALIZATION_TIMEOUT_MS: String(finalizationTimeoutMs),
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", value => { stdout += value; });
  child.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({code, signal}));
  });
  closed.catch(() => {});
  return {child, closed, stdout: () => stdout, stderr: () => stderr};
}

async function armForegroundRoot(dataRoot, claimId, runId = `synthetic-${randomUUID()}`) {
  const arm = {
    protocol: "synthetic-platform-foreground-arm/v1",
    status: "ARMED",
    claimId,
    runId,
    armId: randomUUID(),
    dataRoot
  };
  const armPath = path.join(dataRoot, `foreground-arm-${claimId}.json`);
  const armBytes = canonicalCheckpointBytes(arm);
  await writeFile(armPath, armBytes, {flag: "wx", mode: 0o600});
  return {arm, armPath, armBytes};
}

async function waitForForegroundReadiness(dataRoot, claimId, timeoutMs = 10_000) {
  const deadline = performance.now() + timeoutMs;
  const claimPath = path.join(dataRoot, `foreground-claim-${claimId}.json`);
  while (performance.now() < deadline) {
    try {
      const claim = JSON.parse(await readFile(claimPath, "utf8"));
      const directory = path.join(dataRoot, claim.runId);
      const bytes = await readFile(path.join(directory, "readiness.json"));
      return {claim, directory, readiness: JSON.parse(bytes)};
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  throw new Error("foreground readiness timed out");
}

async function snapshotTree(directory) {
  const result = {};
  const visit = async current => {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const filename = path.join(current, entry.name);
      const relative = path.relative(directory, filename);
      if (entry.isDirectory()) await visit(filename);
      else result[relative] = (await readFile(filename)).toString("base64");
    }
  };
  await visit(directory);
  return result;
}

function foregroundOutputRecords(run) {
  return run.stdout().trim().split(/\r?\n/).map(line => JSON.parse(line));
}

async function waitForForegroundOutput(run, status, timeoutMs = 2_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const records = run.stdout().trim().split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    });
    const match = records.find(record => record?.status === status);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`foreground ${status} output timed out`);
}

async function waitForForegroundAnyOutput(run, statuses, timeoutMs = 5_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const records = run.stdout().trim().split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    });
    const match = records.find(record => statuses.includes(record?.status));
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`foreground ${statuses.join("/")} output timed out`);
}

test("import and default-disabled CLI have no side effects; invalid enable is sanitized", async t => {
  const dataRoot = await root(t);
  const signals = new EventEmitter();
  for (const [env, expectedCode, status] of [
    [{}, 0, "DISABLED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "false"}, 0, "DISABLED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "secret-invalid-enable"}, 2, "BLOCKED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED: "secret-invalid-https"}, 2, "BLOCKED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: "../unsafe"}, 2, "BLOCKED"]
  ]) {
    let output = "";
    assert.equal(await main({
      env, signalSource: signals, stdout: {write: value => { output += value; }}
    }), expectedCode);
    assert.equal(JSON.parse(output).status, status);
    assert.equal(output.includes("secret"), false);
  }
  assert.deepEqual(await readdir(dataRoot), []);
  assert.equal(signals.eventNames().length, 0);
  const cli = spawnSync(process.execPath, [
    path.resolve("scripts/memecoin-paper/synthetic-host-acceptance.mjs")
  ], {encoding: "utf8", env: {}});
  assert.equal(cli.status, 0);
  assert.equal(JSON.parse(cli.stdout).status, "DISABLED");
});

for (const proof of ["PIPELINE_QUOTE", "ACTIVE_STOP"]) {
  test(`${proof} proves the real pipeline, exact report, immutable readback and terminal restart denial`, async t => {
    const dataRoot = await root(t);
    const signals = new EventEmitter();
    const artifact = await runSyntheticHostAcceptance({enabled: true, dataRoot, proof, signalSource: signals});
    const {summary, result, exportBytes, directory} = artifact;
    assert.equal(summary.status, proof === "ACTIVE_STOP" ? "UNKNOWN" : "PASS");
    assert.equal(summary.contractChecks, "PASS");
    assert.equal(summary.evaluation, proof === "ACTIVE_STOP" ? "UNKNOWN" : "PASS");
    assert.equal(summary.proof, `SYNTHETIC_${proof}`);
    assert.equal(summary.entryFills, 1);
    assert.equal(summary.stopAccepted, proof === "ACTIVE_STOP");
    assert.equal(summary.exits, proof === "PIPELINE_QUOTE" ? 1 : 0);
    assert.equal(summary.hostAcceptance, "NOT_ASSESSED");
    assert.equal(summary.liveExecution, false);
    assert.deepEqual(summary.https, {status: "DISABLED"});
    assert.equal(summary.restartDenied, true);
    assert.equal(summary.immutableReadback, true);
    assert.equal(summary.exportSha256, hash(exportBytes));
    assert.deepEqual(exportBytes, canonicalCheckpointBytes(result.report));
    assert.deepEqual(await readFile(path.join(directory, "result.report.json")), exportBytes);
    assert.equal(hash(await readFile(path.join(directory, "config.json"))), summary.configSha256);
    assert.equal(result.report.producerRevision, summary.producerRevision);
    const audit = result.report.runnerReport.runtimeAudit.candidates[0];
    assert.equal(audit.pipeline.filtersStatus, "PASS");
    assert.equal(audit.pipeline.analystStatus, "PASS");
    assert.ok(audit.pipeline.acquisitionReceiptIds.length > 0);
    assert.ok(audit.quotes.some(item => item.disposition === "CHECKPOINT_CONSUMED_ENTRY"));
    assert.equal(result.report.persistence, "ACKNOWLEDGED");
    if (proof === "ACTIVE_STOP") {
      assert.equal(result.status, "STOPPED");
      assert.equal(result.report.runnerReport.reason, "SHUTDOWN");
      assert.equal(result.report.runnerReport.terminalResult.openPositions.length, 1);
    }
    for (const name of ["config.json", "result.report.json", "summary.json"]) {
      assert.equal((await lstat(path.join(directory, name))).mode & 0o777, 0o600);
    }
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    assert.equal(signals.eventNames().length, 0);
    const expected = {
      runId: summary.runId, configSha256: summary.configSha256, producerRevision: summary.producerRevision
    };
    for (const wrong of [
      {...expected, configSha256: "0".repeat(64)},
      {...expected, producerRevision: "wrong-producer"},
      {...expected, runId: "wrong-run"}
    ]) {
      assert.equal(evaluateMemecoinPaperRunExport(exportBytes, wrong).overall, "FAIL");
    }
  });
}

test("fresh invocations never reuse identity or directories and reject unsafe roots", async t => {
  const dataRoot = await root(t);
  const first = await runSyntheticHostAcceptance({enabled: true, dataRoot});
  const second = await runSyntheticHostAcceptance({enabled: true, dataRoot});
  assert.notEqual(first.summary.runId, second.summary.runId);
  assert.notEqual(first.directory, second.directory);
  const linked = `${dataRoot}-link`;
  await symlink(dataRoot, linked);
  t.after(() => rm(linked));
  await assert.rejects(runSyntheticHostAcceptance({enabled: true, dataRoot: linked}));
  await assert.rejects(runSyntheticHostAcceptance({enabled: true, dataRoot, proof: "SOURCE_BACKED_PAPER"}));
  await chmod(dataRoot, 0o750);
  await assert.rejects(runSyntheticHostAcceptance({enabled: true, dataRoot}));
});

test("active SIGTERM after a durable fill uses the existing stop API; observer is synthetic-only", async t => {
  const dataRoot = await root(t);
  const clock = createSyntheticClock();
  const config = {
    version: 1, mode: "SYNTHETIC_TEST_ONLY", enabled: true, runId: "signal-entry",
    startedAt: clock.wallClock(),
    budgets: {requests: 40, bytes: 1_000_000, events: 128, candidates: 4, cycles: 8,
      durationMs: 20_000, callbackTimeoutMs: 1_000, maxWallClockUncertaintyMs: 10}
  };
  const controller = new AbortController();
  const signals = new EventEmitter();
  signals.once("SIGTERM", () => controller.abort());
  const pilot = createPaperPilotComposition({
    config, clock, dataDirectory: path.join(dataRoot, "signal-state"),
    adapters: offlineFixtureAdapters({clock, fault: "PIPELINE_QUOTE"}),
    signal: controller.signal, onTestEntry: () => signals.emit("SIGTERM")
  });
  const result = await pilot.start();
  assert.equal(result.status, "STOPPED");
  assert.equal(result.report.persistence, "ACKNOWLEDGED");
  assert.ok(result.report.runnerReport.operationResults.some(item => item.status === "FILLED_PAPER"));
  assert.throws(() => createPaperPilotComposition({
    config: {...config, mode: "EXTERNAL_READ_ONLY_INPUT"}, onTestEntry() {}
  }), /synthetic-only/);
  assert.throws(() => createPaperPilotComposition({config, onTestEntry: true}), /function/);
});

test("real SIGTERM drill targets its dedicated child after a durable fill", {timeout: 65_000}, async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "synthetic-real-signal-"));
  let verified = false;
  t.after(async () => {
    if (verified) await rm(dataRoot, {recursive: true, force: true});
    else t.diagnostic(`preserved ambiguous real-signal evidence at ${dataRoot}`);
  });
  const child = spawn(process.execPath, [
    path.resolve("scripts/memecoin-paper/synthetic-host-acceptance.mjs")
  ], {
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", value => { stdout += value; });
  child.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({code, signal}));
  });
  assert.equal(exit.code, 2, stderr);
  assert.equal(exit.signal, null);
  const summary = JSON.parse(stdout.trim());
  assert.equal(summary.status, "UNKNOWN");
  assert.equal(summary.contractChecks, "PASS");
  assert.equal(summary.proof, "SYNTHETIC_REAL_SIGTERM");
  assert.equal(summary.signalDrill.status, "VERIFIED");
  assert.equal(summary.signalDrill.signal, "SIGTERM");
  assert.equal(summary.signalDrill.signalSentExactlyOnce, true);
  assert.equal(summary.signalDrill.signalObservedAfterFill, true);
  assert.equal(summary.signalDrill.fillAcknowledged, true);
  assert.ok(Number.isSafeInteger(summary.signalDrill.fillCheckpointSequence));
  assert.match(summary.signalDrill.fillCheckpointSha256, /^[0-9a-f]{64}$/);
  assert.match(summary.signalDrill.fillReceiptSha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isFinite(summary.signalDrill.sendToExitMs));
  assert.ok(summary.signalDrill.sendToExitMs >= 0);
  assert.deepEqual(summary.signalDrill.childExit, {code: 2, signal: null});
  assert.equal(summary.signalDrill.checkpointPersistence, "ACKNOWLEDGED");
  assert.equal(summary.signalDrill.restartDenied, true);
  assert.equal(summary.signalDrill.immutableReadback, true);
  assert.equal(summary.signalDrill.openUnvaluedPositions, 1);
  assert.equal(summary.hostAcceptance, "NOT_ASSESSED");
  assert.equal(summary.liveExecution, false);
  assert.equal(isVerifiedRealSignalDrillReceipt(summary), true);
  assert.equal(isVerifiedRealSignalDrillReceipt({
    ...summary, contractChecks: "UNKNOWN"
  }), false);
  assert.equal(isVerifiedRealSignalDrillReceipt({
    ...summary, signalDrill: {...summary.signalDrill, status: "UNKNOWN"}
  }), false);

  const [drillName] = await readdir(dataRoot);
  assert.match(drillName, /^real-signal-/);
  const drillDirectory = path.join(dataRoot, drillName);
  const result = JSON.parse(await readFile(path.join(drillDirectory, "signal-drill-result.json"), "utf8"));
  assert.deepEqual(result, summary);
  assert.equal(JSON.parse(await readFile(path.join(drillDirectory, "signal-request.json"), "utf8")).status, "READY");
  assert.equal(JSON.parse(await readFile(path.join(drillDirectory, "signal-sent.json"), "utf8")).attempts, 1);
  const childRunId = summary.runId;
  const childDirectory = path.join(drillDirectory, childRunId);
  const acknowledgement = JSON.parse(await readFile(
    path.join(childDirectory, "fill-acknowledged.json"), "utf8"
  ));
  assert.equal(acknowledgement.status, "FILLED_PAPER");
  assert.equal(acknowledgement.runId, childRunId);
  assert.equal(acknowledgement.checkpointSequence, summary.signalDrill.fillCheckpointSequence);
  assert.equal(acknowledgement.checkpointSha256, summary.signalDrill.fillCheckpointSha256);
  verified = true;
});

test("foreground SIGTERM records readiness and an identical replacement only reads the original evidence",
  {timeout: 20_000}, async t => {
    const dataRoot = await root(t);
    const claimId = "foreground-success-001";
    await armForegroundRoot(dataRoot, claimId);
    const run = startForegroundChild(dataRoot, claimId);
    t.after(async () => {
      if (run.child.exitCode === null && run.child.signalCode === null) {
        run.child.kill("SIGKILL");
        await run.closed;
      }
    });
    const {claim, directory, readiness} = await waitForForegroundReadiness(dataRoot, claimId);
    assert.equal(readiness.status, "READY");
    assert.equal(readiness.claimId, claimId);
    assert.equal(readiness.runId, claim.runId);
    assert.match(readiness.checkpointSha256, /^[0-9a-f]{64}$/);
    const readyOutput = await waitForForegroundOutput(run, "READY");
    assert.equal(readyOutput.status, "READY");
    assert.equal(readyOutput.runId, claim.runId);
    assert.equal(readyOutput.checkpointSha256, readiness.checkpointSha256);
    assert.equal(run.child.kill("SIGTERM"), true);
    assert.deepEqual(await run.closed, {code: 2, signal: null}, run.stderr());
    const summary = foregroundOutputRecords(run).at(-1);
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.proof, "SYNTHETIC_PLATFORM_FOREGROUND");
    assert.equal(summary.runId, claim.runId);
    assert.equal(summary.entryFills, 1);
    assert.equal(summary.exits, 0);
    assert.equal(summary.stopAccepted, true);
    assert.equal(summary.restartDenied, true);
    assert.equal(summary.immutableReadback, true);
    assert.equal(summary.signalObservation.status, "OBSERVED");
    assert.equal(summary.signalObservation.afterReady, true);
    assert.equal(summary.signalObservation.platformProvenance, "NOT_ASSESSED");
    assert.equal(Object.hasOwn(summary.signalObservation, "signalToExitMs"), false);
    assert.equal(summary.signalProof.fillCheckpointSha256, readiness.checkpointSha256);
    assert.equal(summary.signalProof.fillCheckpointSequence, readiness.checkpointSequence);
    assert.equal(summary.hostAcceptance, "NOT_ASSESSED");
    assert.equal(summary.liveExecution, false);
    assert.equal(summary.networkAccessed, false);
    const exportBytes = await readFile(path.join(directory, "result.report.json"));
    assert.equal(summary.exportSha256, hash(exportBytes));
    assert.deepEqual(await readFile(path.join(
      directory, "receiver", hash(Buffer.from(claim.runId)), "export.json"
    )), exportBytes);
    const originalTree = await snapshotTree(dataRoot);
    const replacement = startForegroundChild(dataRoot, claimId);
    t.after(async () => {
      if (replacement.child.exitCode === null && replacement.child.signalCode === null) {
        replacement.child.kill("SIGTERM");
        await replacement.closed;
      }
    });
    const readback = await waitForForegroundOutput(replacement, "UNKNOWN");
    assert.equal(readback.status, "UNKNOWN");
    assert.equal(readback.mode, "READ_ONLY_REPLACEMENT");
    assert.equal(readback.readback, "VERIFIED");
    assert.equal(readback.runId, claim.runId);
    assert.equal(readback.fillCount, 1);
    assert.equal(readback.readinessSha256, readyOutput.readinessSha256);
    assert.equal(readback.checkpointSha256, readiness.checkpointSha256);
    assert.equal(readback.checkpointSequence, readiness.checkpointSequence);
    assert.equal(readback.restartDenied, true);
    assert.equal(readback.immutableReadback, true);
    assert.equal(readback.exportSha256, summary.exportSha256);
    assert.equal(replacement.child.exitCode, null, "replacement must hold inertly after readback");
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(await snapshotTree(dataRoot), originalTree);
    assert.equal(replacement.child.kill("SIGTERM"), true);
    assert.deepEqual(await replacement.closed, {code: 0, signal: null}, replacement.stderr());

    const changedDeviceSignals = new EventEmitter();
    const changedDeviceProbe = filesystemProbe(async call => {
      const info = await call.action();
      if (call.method !== "lstat" || call.filename !== dataRoot) return info;
      return {
        dev: info.dev + 1,
        uid: info.uid,
        mode: info.mode,
        isDirectory: () => info.isDirectory(),
        isSymbolicLink: () => info.isSymbolicLink()
      };
    });
    let changedDeviceOutput = "";
    let outputReceived;
    const outputReady = new Promise(resolve => { outputReceived = resolve; });
    const changedDeviceReadback = main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
      },
      signalSource: changedDeviceSignals, fileSystem: changedDeviceProbe.fileSystem,
      stdout: {write(value) { changedDeviceOutput += value; outputReceived(); }}
    });
    await outputReady;
    const changedDeviceReceipt = JSON.parse(changedDeviceOutput.trim());
    assert.equal(changedDeviceReceipt.readback, "VERIFIED");
    assert.equal(changedDeviceReceipt.platformProvenance, "NOT_ASSESSED");
    assert.deepEqual(await snapshotTree(dataRoot), originalTree);
    changedDeviceSignals.emit("SIGTERM");
    assert.equal(await changedDeviceReadback, 0);
    assert.deepEqual(await snapshotTree(dataRoot), originalTree);
  });

test("the same command on a different unarmed root remains inert without creating artifacts",
  {timeout: 15_000}, async t => {
    const originalRoot = await root(t);
    const replacementRoot = await root(t);
    const claimId = "foreground-root-bound-arm";
    await armForegroundRoot(originalRoot, claimId);
    const original = startForegroundChild(originalRoot, claimId);
    const replacement = startForegroundChild(replacementRoot, claimId);
    for (const run of [original, replacement]) {
      t.after(async () => {
        if (run.child.exitCode === null && run.child.signalCode === null) {
          run.child.kill("SIGTERM");
          await run.closed;
        }
      });
    }
    const {claim, directory} = await waitForForegroundReadiness(originalRoot, claimId);
    const replacementOutput = await waitForForegroundOutput(replacement, "UNKNOWN");
    assert.equal(replacementOutput.mode, "INERT_UNARMED");
    assert.equal(replacementOutput.readback, "NOT_ATTEMPTED");
    assert.deepEqual(await readdir(replacementRoot), []);
    assert.equal(replacement.child.exitCode, null);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(await readdir(replacementRoot), []);
    assert.equal(replacement.child.kill("SIGTERM"), true);
    assert.deepEqual(await replacement.closed, {code: 0, signal: null}, replacement.stderr());

    assert.equal(original.child.kill("SIGTERM"), true);
    assert.deepEqual(await original.closed, {code: 2, signal: null}, original.stderr());
    const summary = foregroundOutputRecords(original).at(-1);
    assert.equal(summary.runId, claim.runId);
    assert.equal(summary.entryFills, 1);
    assert.equal(await readFile(path.join(directory, "result.report.json")).then(() => true), true);
  });

test("missing, unsafe, or unreadable replacement roots hold inertly without writes", async t => {
  for (const kind of ["missing", "unsafe", "unreadable"]) {
    await t.test(kind, async subtest => {
      const base = await root(subtest);
      const dataRoot = kind === "missing" ? path.join(base, "missing-root") : base;
      if (kind === "unsafe") await chmod(dataRoot, 0o755);
      const before = await snapshotTree(base);
      const signals = new EventEmitter();
      const probe = filesystemProbe(async call => {
        if (kind === "unreadable" && call.method === "lstat" && call.filename === dataRoot) {
          const error = new Error("private root is unavailable");
          error.code = "EACCES";
          throw error;
        }
        return call.action();
      });
      let output = "";
      const outputReady = deferred();
      const pending = main({
        env: {
          PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
          PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
          PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: `root-${kind}`,
          PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
        },
        signalSource: signals, fileSystem: probe.fileSystem,
        stdout: {write(value) { output += value; outputReady.resolve(); }}
      });
      await outputReady.promise;
      const receipt = JSON.parse(output.trim());
      assert.equal(receipt.status, "UNKNOWN");
      assert.equal(receipt.mode, "INERT_ROOT_UNAVAILABLE");
      assert.equal(receipt.platformProvenance, "NOT_ASSESSED");
      assert.equal(probe.calls.some(call =>
        ["open", "mkdir", "writeFile", "sync"].includes(call.method)), false);
      assert.deepEqual(await snapshotTree(base), before);
      signals.emit("SIGTERM");
      assert.equal(await pending, 0);
      assert.equal(signals.eventNames().length, 0);
      assert.deepEqual(await snapshotTree(base), before);
    });
  }
});

test("stalled initial root lookup times out into an inert hold", async t => {
  const dataRoot = await root(t);
  const before = await snapshotTree(dataRoot);
  const signals = new EventEmitter();
  const entered = deferred();
  const release = deferred();
  t.after(() => {
    release.resolve();
    signals.emit("SIGTERM");
  });
  const probe = filesystemProbe(async call => {
    if (call.method === "lstat" && call.filename === dataRoot) {
      entered.resolve();
      await release.promise;
    }
    return call.action();
  });
  let output = "";
  const outputReady = deferred();
  let settled = false;
  const pending = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_READBACK_TIMEOUT_MS: "500",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: "stalled-root-lookup",
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals, fileSystem: probe.fileSystem,
    stdout: {write(value) { output += value; outputReady.resolve(); }}
  }).finally(() => { settled = true; });
  await entered.promise;
  await outputReady.promise;
  assert.equal(JSON.parse(output.trim()).status, "UNKNOWN");
  assert.equal(settled, false);
  assert.equal(probe.calls.some(call =>
    ["open", "mkdir", "writeFile", "sync"].includes(call.method)), false);
  release.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await snapshotTree(dataRoot), before);
  signals.emit("SIGTERM");
  assert.equal(await pending, 0);
  assert.equal(settled, true);
  assert.equal(signals.eventNames().length, 0);
  assert.deepEqual(await snapshotTree(dataRoot), before);
});

test("stalled arm open stays within discovery deadline and late completion cannot consume it",
  async t => {
    const dataRoot = await root(t);
    const claimId = "stalled-arm-open";
    await armForegroundRoot(dataRoot, claimId);
    const armPath = path.join(dataRoot, `foreground-arm-${claimId}.json`);
    const before = await snapshotTree(dataRoot);
    const signals = new EventEmitter();
    const entered = deferred();
    const release = deferred();
    t.after(() => {
      release.resolve();
      signals.emit("SIGTERM");
    });
    const probe = filesystemProbe(async call => {
      if (call.method === "open" && call.filename === armPath) {
        entered.resolve();
        await release.promise;
      }
      return call.action();
    });
    let output = "";
    const outputReady = deferred();
    let settled = false;
    const pending = main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_READBACK_TIMEOUT_MS: "500",
        PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
      },
      signalSource: signals, fileSystem: probe.fileSystem,
      stdout: {write(value) { output += value; outputReady.resolve(); }}
    }).finally(() => { settled = true; });
    await entered.promise;
    await outputReady.promise;
    const receipt = JSON.parse(output.trim());
    assert.equal(receipt.status, "UNKNOWN");
    assert.equal(receipt.code, "SYNTHETIC_ACCEPTANCE_FAILED");
    assert.equal(settled, false, "timed-out arm acquisition must keep the process inert");
    assert.equal(probe.calls.some(call =>
      ["mkdir", "writeFile", "sync"].includes(call.method)), false);
    assert.deepEqual(await snapshotTree(dataRoot), before);

    release.resolve();
    await drainProbe(probe);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(probe.calls.some(call =>
      ["mkdir", "writeFile", "sync"].includes(call.method)), false);
    assert.deepEqual(await snapshotTree(dataRoot), before);

    signals.emit("SIGTERM");
    assert.equal(await pending, 0);
    assert.equal(settled, true);
    assert.equal(signals.eventNames().length, 0);
    assert.deepEqual(await snapshotTree(dataRoot), before);
  });

test("concurrent foreground starts consume one arm exclusively and execute at most one fill",
  {timeout: 15_000}, async t => {
    const dataRoot = await root(t);
    const claimId = "foreground-concurrent-claim";
    await armForegroundRoot(dataRoot, claimId);
    const runs = [startForegroundChild(dataRoot, claimId), startForegroundChild(dataRoot, claimId)];
    for (const run of runs) {
      t.after(async () => {
        if (run.child.exitCode === null && run.child.signalCode === null) {
          run.child.kill("SIGTERM");
          await run.closed;
        }
      });
    }
    const receipts = await Promise.all(runs.map(run =>
      waitForForegroundAnyOutput(run, ["READY", "UNKNOWN"])));
    assert.equal(receipts.filter(item => item.status === "READY").length, 1);
    assert.equal(receipts.filter(item => item.status === "UNKNOWN").length, 1);
    const activeIndex = receipts.findIndex(item => item.status === "READY");
    const loserIndex = 1 - activeIndex;
    assert.equal(runs[loserIndex].child.exitCode, null);
    const beforeHold = await snapshotTree(dataRoot);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(await snapshotTree(dataRoot), beforeHold);
    assert.equal(runs[activeIndex].child.kill("SIGTERM"), true);
    assert.deepEqual(await runs[activeIndex].closed, {code: 2, signal: null}, runs[activeIndex].stderr());
    const summary = foregroundOutputRecords(runs[activeIndex]).at(-1);
    assert.equal(summary.entryFills, 1);
    assert.equal(runs[loserIndex].child.exitCode, null);
    assert.equal(runs[loserIndex].child.kill("SIGTERM"), true);
    assert.deepEqual(await runs[loserIndex].closed, {code: 0, signal: null}, runs[loserIndex].stderr());
    const claim = JSON.parse(await readFile(path.join(
      dataRoot, `foreground-claim-${claimId}.json`
    ), "utf8"));
    const report = JSON.parse(await readFile(path.join(dataRoot, claim.runId, "result.report.json"), "utf8"));
    assert.equal(report.runnerReport.operationResults.filter(
      item => item.method === "executeEntry" && item.status === "FILLED_PAPER"
    ).length, 1);
  });

test("failure after arm consumption cannot rearm or start a fill on replacement", async t => {
  const dataRoot = await root(t);
  const claimId = "foreground-consumed-before-claim";
  await armForegroundRoot(dataRoot, claimId);
  const signals = new EventEmitter();
  const probe = filesystemProbe(async call => {
    if (call.method === "open" && path.basename(call.filename) ===
        `foreground-claim-${claimId}.json`) {
      const error = new Error("simulated crash after arm consumption");
      error.code = "EIO";
      throw error;
    }
    return call.action();
  });
  let output = "";
  const outputReady = deferred();
  const failedStart = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals, fileSystem: probe.fileSystem,
    stdout: {write(value) { output += value; outputReady.resolve(); }}
  });
  await outputReady.promise;
  const failedReceipt = JSON.parse(output.trim());
  assert.equal(failedReceipt.status, "UNKNOWN");
  assert.equal(failedReceipt.mode, "INERT_CLAIM_NOT_ACQUIRED");
  signals.emit("SIGTERM");
  assert.equal(await failedStart, 0);
  await assert.rejects(readFile(path.join(
    dataRoot, `foreground-claim-${claimId}.json`
  )), {code: "ENOENT"});
  const beforeReplacement = await snapshotTree(dataRoot);
  assert.ok(beforeReplacement[`foreground-arm-consumed-${claimId}.json`]);
  const replacement = startForegroundChild(dataRoot, claimId);
  const receipt = await waitForForegroundOutput(replacement, "UNKNOWN");
  assert.equal(receipt.mode, "INERT_CONSUMED_ARM");
  assert.equal(replacement.child.exitCode, null);
  assert.deepEqual(await snapshotTree(dataRoot), beforeReplacement);
  replacement.child.kill("SIGTERM");
  assert.deepEqual(await replacement.closed, {code: 0, signal: null}, replacement.stderr());
  assert.deepEqual(await snapshotTree(dataRoot), beforeReplacement);
});

test("delayed operator SIGTERM starts a fresh bounded finalization phase", {timeout: 10_000}, async t => {
  const dataRoot = await root(t);
  const claimId = "foreground-delayed-signal";
  await armForegroundRoot(dataRoot, claimId);
  const signals = new EventEmitter();
  const finalWriteEntered = deferred();
  const releaseFinalWrite = deferred();
  t.after(() => releaseFinalWrite.resolve());
  const probe = filesystemProbe(async call => {
    if (path.basename(call.filename) === "result.report.json" && call.method === "writeFile") {
      finalWriteEntered.resolve();
      await releaseFinalWrite.promise;
    }
    return call.action();
  });
  let output = "";
  const started = performance.now();
  const pending = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND_WAIT_TIMEOUT_MS: "3000",
      PAPER_SYNTHETIC_ACCEPTANCE_FINALIZATION_TIMEOUT_MS: "1500",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals, fileSystem: probe.fileSystem,
    stdout: {write(value) {
      output += value;
      if (value.includes('"status":"READY"')) {
        setTimeout(() => signals.emit("SIGTERM"), 2_500);
      }
    }}
  });
  await finalWriteEntered.promise;
  await new Promise(resolve => setTimeout(resolve, 900));
  releaseFinalWrite.resolve();
  assert.equal(await pending, 2);
  assert.ok(performance.now() - started > 3_000,
    "finalization must succeed even when total time exceeds the operator-wait phase");
  const [ready, summary] = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(ready.status, "READY");
  assert.equal(summary.proof, "SYNTHETIC_PLATFORM_FOREGROUND");
  assert.equal(summary.signalObservation.afterReady, true);
  assert.equal(summary.stopAccepted, true);
  await drainProbe(probe);
});

test("injected monotonic expiry at synchronous SIGTERM cannot start finalization", async t => {
    const dataRoot = await root(t);
    const claimId = "foreground-late-operator-signal";
    await armForegroundRoot(dataRoot, claimId);
    const signals = new EventEmitter();
    let monotonicNow = 0;
    let output = "";
    const code = await main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND_WAIT_TIMEOUT_MS: "1000",
        PAPER_SYNTHETIC_ACCEPTANCE_FINALIZATION_TIMEOUT_MS: "1000",
        PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
      },
      monotonicNow: () => monotonicNow,
      signalSource: signals,
      stdout: {write(value) {
        output += value;
        if (value.includes('"status":"READY"')) {
          monotonicNow = 1_001;
          signals.emit("SIGTERM");
        }
      }}
    });
    assert.equal(code, 2);
    const [ready, summary] = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(ready.status, "READY");
    assert.equal(summary.status, "UNKNOWN");
    assert.equal(summary.signalObservation, undefined);
    assert.equal(summary.code, "SYNTHETIC_ACCEPTANCE_FAILED");
    const claim = JSON.parse(await readFile(
      path.join(dataRoot, `foreground-claim-${claimId}.json`), "utf8"
    ));
    await assert.rejects(readFile(path.join(dataRoot, claim.runId, "summary.json")), {code: "ENOENT"});
  });

test("readback transition rejects injected expiry before replacing discovery deadline", async t => {
  const dataRoot = await root(t);
  const claimId = "foreground-readback-transition-expiry";
  await armForegroundRoot(dataRoot, claimId);
  const claimPath = path.join(dataRoot, `foreground-claim-${claimId}.json`);
  await writeFile(claimPath, "{}", {mode: 0o600});
  const signals = new EventEmitter();
  let monotonicNow = 0;
  let claimLookupReturned = false;
  let skippedPostLookupCheck = false;
  const probe = filesystemProbe(async call => {
    const value = await call.action();
    if (call.method === "lstat" && call.filename === claimPath) claimLookupReturned = true;
    return value;
  });
  let output = "";
  const outputReady = deferred();
  const pending = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_READBACK_TIMEOUT_MS: "1000",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    monotonicNow: () => {
      if (!claimLookupReturned) return monotonicNow;
      if (!skippedPostLookupCheck) {
        skippedPostLookupCheck = true;
        return monotonicNow;
      }
      return 1_001;
    },
    signalSource: signals, fileSystem: probe.fileSystem,
    stdout: {write(value) { output += value; outputReady.resolve(); }}
  });
  await outputReady.promise;
  const receipt = JSON.parse(output.trim());
  assert.equal(receipt.status, "UNKNOWN");
  assert.equal(receipt.code, "SYNTHETIC_ACCEPTANCE_FAILED");
  assert.equal(probe.calls.some(call => ["open", "mkdir", "writeFile", "sync"].includes(call.method)), false);
  const beforeStop = await snapshotTree(dataRoot);
  signals.emit("SIGTERM");
  assert.equal(await pending, 0);
  assert.deepEqual(await snapshotTree(dataRoot), beforeStop);
});

test("post-SIGTERM finalization phase timeout returns UNKNOWN and preserves partial evidence",
  {timeout: 8_000}, async t => {
    const dataRoot = await root(t);
    const claimId = "foreground-finalization-timeout";
    await armForegroundRoot(dataRoot, claimId);
    const signals = new EventEmitter();
    const finalWriteEntered = deferred();
    const releaseFinalWrite = deferred();
    t.after(() => releaseFinalWrite.resolve());
    const probe = filesystemProbe(async call => {
      if (path.basename(call.filename) === "result.report.json" && call.method === "writeFile") {
        finalWriteEntered.resolve();
        await releaseFinalWrite.promise;
      }
      return call.action();
    });
    let output = "";
    const pending = main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND_WAIT_TIMEOUT_MS: "5000",
        PAPER_SYNTHETIC_ACCEPTANCE_FINALIZATION_TIMEOUT_MS: "200",
        PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
      },
      signalSource: signals, fileSystem: probe.fileSystem,
      stdout: {write(value) {
        output += value;
        if (value.includes('"status":"READY"')) signals.emit("SIGTERM");
      }}
    });
    await finalWriteEntered.promise;
    const result = await pending;
    assert.equal(result, 2);
    assert.equal(JSON.parse(output.trim().split(/\r?\n/).at(-1)).status, "UNKNOWN");
    releaseFinalWrite.resolve();
    await drainProbe(probe);
    const claim = JSON.parse(await readFile(path.join(
      dataRoot, `foreground-claim-${claimId}.json`
    ), "utf8"));
    const runDirectory = path.join(dataRoot, claim.runId);
    assert.equal(await readFile(path.join(runDirectory, "readiness.json")).then(() => true), true);
    assert.equal(await readFile(path.join(runDirectory, "summary.json")).then(() => true).catch(() => false), false);
  });

test("bounded replacement claim-discovery timeout holds inertly without writes until SIGTERM",
  {timeout: 8_000}, async t => {
    const dataRoot = await root(t);
    const claimId = "foreground-readback-timeout";
    await armForegroundRoot(dataRoot, claimId);
    const original = startForegroundChild(dataRoot, claimId);
    t.after(async () => {
      if (original.child.exitCode === null && original.child.signalCode === null) {
        original.child.kill("SIGKILL");
        await original.closed;
      }
    });
    const {directory} = await waitForForegroundReadiness(dataRoot, claimId);
    await waitForForegroundOutput(original, "READY");
    original.child.kill("SIGTERM");
    await original.closed;

    const signals = new EventEmitter();
    const entered = deferred();
    const release = deferred();
    t.after(() => {
      release.resolve();
      signals.emit("SIGTERM");
    });
    const probe = filesystemProbe(async call => {
      if (call.method === "lstat" &&
          path.basename(call.filename) === `foreground-claim-${claimId}.json`) {
        entered.resolve();
        await release.promise;
      }
      return call.action();
    });
    let output = "";
    let outputReceived;
    const outputReady = new Promise(resolve => { outputReceived = resolve; });
    let settled = false;
    const pending = main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_READBACK_TIMEOUT_MS: "1000",
        PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
      },
      signalSource: signals, fileSystem: probe.fileSystem,
      stdout: {write(value) { output += value; outputReceived(); }}
    }).finally(() => { settled = true; });
    await entered.promise;
    await outputReady;
    assert.equal(JSON.parse(output.trim()).status, "UNKNOWN");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(settled, false, "timed-out replacement must remain alive in inert hold");
    const beforeRelease = await snapshotTree(dataRoot);
    release.resolve();
    await drainProbe(probe);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await snapshotTree(dataRoot), beforeRelease);
    signals.emit("SIGTERM");
    assert.equal(await pending, 0);
    assert.equal(settled, true);
    assert.deepEqual(await snapshotTree(dataRoot), beforeRelease);
    assert.equal(await readFile(path.join(directory, "result.report.json")).then(() => true), true);
  });

test("SIGTERM during readiness durability is never reported as post-ready", async t => {
  const dataRoot = await root(t);
  const claimId = "foreground-signal-during-ready";
  await armForegroundRoot(dataRoot, claimId);
  const signals = new EventEmitter();
  let signalInjected = false;
  const probe = filesystemProbe(async call => {
    const result = await call.action();
    if (!signalInjected && call.method === "sync" &&
        path.basename(call.filename) === "readiness.json") {
      signalInjected = true;
      signals.emit("SIGTERM");
    }
    return result;
  });
  let output = "";
  const code = await main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals, fileSystem: probe.fileSystem,
    stdout: {write: value => { output += value; }}
  });
  assert.equal(code, 2);
  assert.equal(signalInjected, true);
  const receipt = JSON.parse(output.trim());
  assert.equal(receipt.status, "UNKNOWN");
  assert.equal(receipt.signalObservation, undefined);
  assert.equal(output.includes('"status":"READY"'), false);
  const claimRecord = JSON.parse(await readFile(
    path.join(dataRoot, `foreground-claim-${claimId}.json`), "utf8"
  ));
  const runDirectory = path.join(dataRoot, claimRecord.runId);
  assert.equal(await readFile(path.join(runDirectory, "readiness.json")).then(() => true), true);
  const beforeReplacement = await snapshotTree(dataRoot);
  const replacement = startForegroundChild(dataRoot, claimId);
  t.after(async () => {
    if (replacement.child.exitCode === null && replacement.child.signalCode === null) {
      replacement.child.kill("SIGTERM");
      await replacement.closed;
    }
  });
  const readback = await waitForForegroundOutput(replacement, "UNKNOWN");
  assert.equal(readback.status, "UNKNOWN");
  assert.equal(readback.mode, "READ_ONLY_REPLACEMENT");
  assert.equal(readback.readback, "UNKNOWN");
  assert.equal(replacement.child.exitCode, null);
  assert.equal(replacement.child.kill("SIGTERM"), true);
  assert.deepEqual(await replacement.closed, {code: 0, signal: null}, replacement.stderr());
  assert.deepEqual(await snapshotTree(dataRoot), beforeReplacement);
});

test("foreground SIGTERM before the pilot listener is installed is latched and cannot be lost", async t => {
  const dataRoot = await root(t);
  const claimId = `early-signal-${randomUUID()}`;
  const {arm} = await armForegroundRoot(dataRoot, claimId);
  const consumedPath = path.join(dataRoot, `foreground-arm-consumed-${claimId}.json`);
  const signals = new EventEmitter();
  const probe = filesystemProbe(async ({method, filename, action}) => {
    const value = await action();
    if (method === "sync" && filename === consumedPath) signals.emit("SIGTERM");
    return value;
  });
  let output = "";
  const code = await main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_FOREGROUND: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_CLAIM_ID: claimId,
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals, stdout: {write: value => { output += value; }},
    fileSystem: probe.fileSystem, timeoutMs: 10_000
  });
  assert.equal(code, 2);
  assert.equal(JSON.parse(output.trim()).status, "UNKNOWN");
  assert.equal(JSON.parse(await readFile(path.join(dataRoot,
    `foreground-claim-${claimId}.json`), "utf8")).runId, arm.runId);
  assert.equal(await readdir(path.join(dataRoot, arm.runId)).then(entries =>
    entries.includes("readiness.json")), false);
  assert.equal(signals.eventNames().length, 0);
  await drainProbe(probe);
});

test("foreground timeout leaves a permanent claim; replacement does not replay incomplete work",
  {timeout: 15_000}, async t => {
    const dataRoot = await root(t);
    const claimId = "foreground-timeout-001";
    await armForegroundRoot(dataRoot, claimId);
    const run = startForegroundChild(dataRoot, claimId, 1_500);
    t.after(async () => {
      if (run.child.exitCode === null && run.child.signalCode === null) {
        run.child.kill("SIGKILL");
        await run.closed;
      }
    });
    const {claim, directory} = await waitForForegroundReadiness(dataRoot, claimId);
    await waitForForegroundOutput(run, "READY");
    assert.deepEqual(await run.closed, {code: 2, signal: null}, run.stderr());
    assert.equal(foregroundOutputRecords(run).at(-1).status, "UNKNOWN");
    assert.equal(await readFile(path.join(directory, "readiness.json")).then(() => true), true);
    await assert.rejects(readFile(path.join(directory, "summary.json")), {code: "ENOENT"});
    const beforeReplacement = await snapshotTree(dataRoot);

    const replacement = startForegroundChild(dataRoot, claimId);
    t.after(async () => {
      if (replacement.child.exitCode === null && replacement.child.signalCode === null) {
        replacement.child.kill("SIGTERM");
        await replacement.closed;
      }
    });
    const readback = await waitForForegroundOutput(replacement, "UNKNOWN");
    assert.equal(readback.status, "UNKNOWN");
    assert.equal(readback.mode, "READ_ONLY_REPLACEMENT");
    assert.equal(readback.readback, "UNKNOWN");
    assert.equal(readback.runId, claim.runId);
    assert.equal(replacement.child.exitCode, null);
    assert.equal(replacement.child.kill("SIGTERM"), true);
    assert.deepEqual(await replacement.closed, {code: 0, signal: null}, replacement.stderr());
    assert.deepEqual(await snapshotTree(dataRoot), beforeReplacement);
  });

test("foreground replacement reports UNKNOWN and preserves tampered or missing evidence",
  {timeout: 25_000}, async t => {
    for (const mutation of ["tampered-export", "missing-readiness"]) {
      await t.test(mutation, async subtest => {
        const dataRoot = await root(subtest);
        const claimId = `foreground-${mutation}`;
        await armForegroundRoot(dataRoot, claimId);
        const run = startForegroundChild(dataRoot, claimId);
        subtest.after(async () => {
          if (run.child.exitCode === null && run.child.signalCode === null) {
            run.child.kill("SIGKILL");
            await run.closed;
          }
        });
        const {directory} = await waitForForegroundReadiness(dataRoot, claimId);
        await waitForForegroundOutput(run, "READY");
        assert.equal(run.child.kill("SIGTERM"), true);
        assert.deepEqual(await run.closed, {code: 2, signal: null}, run.stderr());
        if (mutation === "tampered-export") {
          const filename = path.join(directory, "result.report.json");
          const bytes = await readFile(filename);
          bytes[0] ^= 1;
          await writeFile(filename, bytes);
        } else {
          await rm(path.join(directory, "readiness.json"));
        }
        const beforeReplacement = await snapshotTree(dataRoot);
        const replacement = startForegroundChild(dataRoot, claimId);
        subtest.after(async () => {
          if (replacement.child.exitCode === null && replacement.child.signalCode === null) {
            replacement.child.kill("SIGTERM");
            await replacement.closed;
          }
        });
        const readback = await waitForForegroundOutput(replacement, "UNKNOWN");
        assert.equal(readback.status, "UNKNOWN");
        assert.equal(readback.mode, "READ_ONLY_REPLACEMENT");
        assert.equal(readback.readback, "UNKNOWN");
        assert.equal(replacement.child.exitCode, null);
        assert.equal(replacement.child.kill("SIGTERM"), true);
        assert.deepEqual(await replacement.closed, {code: 0, signal: null}, replacement.stderr());
        assert.deepEqual(await snapshotTree(dataRoot), beforeReplacement);
      });
    }
  });

test("real SIGTERM drill refuses a child that exited before its one-shot signal", {timeout: 10_000}, async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "synthetic-real-signal-early-exit-"));
  t.after(() => rm(dataRoot, {recursive: true, force: true}));
  const signals = new EventEmitter();
  const requestSynced = deferred();
  let child;
  let harnessKillCalls = 0;
  const probe = filesystemProbe(async call => {
    const result = await call.action();
    if (call.method === "sync" && path.basename(call.filename) === "signal-request.json") {
      child.once("exit", () => requestSynced.resolve());
      assert.equal(child.kill("SIGTERM"), true);
      await requestSynced.promise;
    }
    return result;
  });
  let output = "";
  const code = await main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals,
    fileSystem: probe.fileSystem,
    spawnChild: (...args) => {
      child = spawn(...args);
      return child;
    },
    killChild: (...args) => {
      harnessKillCalls += 1;
      return child.kill(...args);
    },
    stdout: {write: value => { output += value; }}
  });
  assert.equal(code, 2);
  assert.equal(harnessKillCalls, 0);
  assert.equal(JSON.parse(output).status, "UNKNOWN");
  assert.equal(JSON.parse(output).signalDrill, undefined);
  const [drillName] = await readdir(dataRoot);
  assert.equal(JSON.parse(await readFile(
    path.join(dataRoot, drillName, "signal-request.json"), "utf8"
  )).status, "READY");
  await assert.rejects(readFile(path.join(dataRoot, drillName, "signal-sent.json")), {code: "ENOENT"});
  assert.equal(signals.eventNames().length, 0);
});

test("startup child exit during delayed start receipt publication stays UNKNOWN under strict rejection mode", async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "synthetic-real-signal-startup-reject-"));
  t.after(() => rm(dataRoot, {recursive: true, force: true}));
  const moduleUrl = new URL(
    "../scripts/memecoin-paper/synthetic-host-acceptance.mjs", import.meta.url
  ).href;
  const script = `
    import {spawn} from "node:child_process";
    import {lstat, mkdir, open, readdir, realpath} from "node:fs/promises";
    import path from "node:path";
    const {main} = await import(${JSON.stringify(moduleUrl)});
    let child;
    let releaseStartedSync;
    const childExited = new Promise(resolve => { releaseStartedSync = resolve; });
    const fileSystem = {
      lstat, mkdir, realpath,
      async open(filename, ...args) {
        const handle = await open(filename, ...args);
        return {
          writeFile: (...values) => handle.writeFile(...values),
          async sync() {
            await handle.sync();
            if (path.basename(filename) === "child-started.json") await childExited;
          },
          stat: (...values) => handle.stat(...values),
          read: (...values) => handle.read(...values),
          close: (...values) => handle.close(...values)
        };
      }
    };
    let killCalls = 0;
    let output = "";
    const code = await main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: process.env.SIGNAL_ROOT
      },
      fileSystem,
      spawnChild() {
        child = spawn(process.execPath, ["-e", "process.exit(17)"], {
          stdio: ["ignore", "ignore", "ignore", "ipc"]
        });
        child.once("exit", releaseStartedSync);
        return child;
      },
      killChild(target, signal) {
        killCalls += 1;
        return target.kill(signal);
      },
      stdout: {write(value) { output += value; }}
    });
    console.log(JSON.stringify({
      code, killCalls, childExitCode: child.exitCode, output,
      files: await readdir(path.join(process.env.SIGNAL_ROOT, (await readdir(process.env.SIGNAL_ROOT))[0]))
    }));
  `;
  const execution = spawnSync(process.execPath, [
    "--unhandled-rejections=strict", "--input-type=module", "-e", script
  ], {
    encoding: "utf8", env: {...process.env, SIGNAL_ROOT: dataRoot}
  });
  assert.equal(execution.error, undefined);
  assert.equal(execution.status, 0, execution.stderr);
  const result = JSON.parse(execution.stdout.trim());
  assert.equal(result.code, 2);
  assert.equal(result.killCalls, 0);
  assert.equal(result.childExitCode, 17);
  assert.equal(JSON.parse(result.output).status, "UNKNOWN");
  assert.ok(result.files.includes("child-started.json"));
  assert.ok(result.files.includes("signal-drill-result.json"));
  assert.equal(result.files.includes("signal-request.json"), false);
  const [drillName] = await readdir(dataRoot);
  assert.deepEqual(JSON.parse(await readFile(
    path.join(dataRoot, drillName, "signal-drill-result.json"), "utf8"
  )), JSON.parse(result.output));
});

test("parent deadline includes delayed child-started receipt publication", {timeout: 10_000}, async t => {
  const dataRoot = await root(t);
  const receiptSyncEntered = deferred();
  const releaseReceiptSync = deferred();
  t.after(() => releaseReceiptSync.resolve());
  const signals = new EventEmitter();
  const probe = filesystemProbe(async call => {
    const result = await call.action();
    if (call.method === "sync" && path.basename(call.filename) === "child-started.json") {
      receiptSyncEntered.resolve();
      await releaseReceiptSync.promise;
    }
    return result;
  });
  const fakeChild = Object.assign(new EventEmitter(), {
    pid: 12345, exitCode: null, signalCode: null, connected: false, unref() {}
  });
  let childEnv;
  let killCalls = 0;
  let output = "";
  const pending = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    timeoutMs: 750, signalSource: signals, fileSystem: probe.fileSystem,
    spawnChild(_executable, _args, options) {
      childEnv = options.env;
      return fakeChild;
    },
    killChild() {
      killCalls += 1;
      return true;
    },
    stdout: {write: value => { output += value; }}
  });
  let enteredTimer;
  try {
    await Promise.race([
      receiptSyncEntered.promise,
      new Promise((_, reject) => {
        enteredTimer = setTimeout(() => reject(new Error("child start receipt was not published")), 5_000);
      })
    ]);
  } finally {
    clearTimeout(enteredTimer);
  }
  let operationTimer;
  try {
    assert.equal(await Promise.race([
      pending,
      new Promise((_, reject) => {
        operationTimer = setTimeout(() => reject(new Error("parent exceeded its bounded deadline")), 5_000);
      })
    ]), 2);
  } finally {
    clearTimeout(operationTimer);
  }
  releaseReceiptSync.resolve();
  await drainProbe(probe);

  assert.equal(JSON.parse(output).status, "UNKNOWN");
  assert.equal(killCalls, 0);
  const childDeadline = BigInt(childEnv.PAPER_SYNTHETIC_ACCEPTANCE_DEADLINE_HR_NS);
  assert.ok(childDeadline <= process.hrtime.bigint(),
    "the deadline forwarded at spawn must already be exhausted after delayed parent setup");
  const [drillName] = await readdir(dataRoot);
  const files = await readdir(path.join(dataRoot, drillName));
  assert.ok(files.includes("child-started.json"));
  assert.equal(files.includes("signal-request.json"), false);
  assert.equal(files.includes("signal-sent.json"), false);
  assert.equal(signals.eventNames().length, 0);
});

test("real IPC child enforces its inherited deadline after fill instead of receiving a fresh budget",
  {timeout: 30_000}, async t => {
    const entrypoint = path.resolve("scripts/memecoin-paper/synthetic-host-acceptance.mjs");
    const children = [];
    const shortBudgetMs = 3_000;
    const startChild = (dataRoot, deadlineNs) => {
      const child = spawn(process.execPath, [entrypoint], {
        env: {
          ...process.env,
          PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
          PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot,
          PAPER_SYNTHETIC_ACCEPTANCE_PROOF: "REAL_SIGNAL_CHILD",
          PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_CHILD: "true",
          PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL: "false",
          PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED: "false",
          PAPER_SYNTHETIC_ACCEPTANCE_DEADLINE_HR_NS: deadlineNs
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", value => { stdout += value; });
      child.stderr.setEncoding("utf8").on("data", value => { stderr += value; });
      const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({code, signal}));
      });
      closed.catch(() => {});
      children.push({child, closed});
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await Promise.race([
            closed,
            new Promise(resolve => setTimeout(resolve, 2_000))
          ]);
        }
      });
      return {child, closed, stderr: () => stderr, stdout: () => stdout};
    };
    const receiveFill = (child, timeoutMs) => new Promise((resolve, reject) => {
      const finish = (action, value) => {
        clearTimeout(timer);
        child.removeListener("message", onMessage);
        child.removeListener("exit", onExit);
        action(value);
      };
      const onMessage = message => finish(resolve, message);
      const onExit = (code, signal) => finish(reject,
        new Error(`child exited before fill acknowledgement (${code}, ${signal})`));
      const timer = setTimeout(() => finish(reject, new Error("fill acknowledgement timed out")), timeoutMs);
      child.once("message", onMessage);
      child.once("exit", onExit);
    });
    const closeWithin = (child, timeoutMs) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.removeListener("close", onClose);
        reject(new Error("child did not exit within the inherited deadline watchdog"));
      }, timeoutMs);
      const onClose = (code, signal) => {
        clearTimeout(timer);
        resolve({code, signal});
      };
      child.once("close", onClose);
    });
    const assertFillHandshake = async run => {
      const handshake = await receiveFill(run.child, 10_000);
      assert.equal(handshake.status, "FILLED_PAPER");
      assert.equal(handshake.pid, run.child.pid);
      assert.match(handshake.receiptSha256, /^[0-9a-f]{64}$/);
      return handshake;
    };

    const dataRoot = await root(t);
    const startedAt = process.hrtime.bigint();
    const inheritedDeadline = startedAt + BigInt(shortBudgetMs) * 1_000_000n;
    const run = startChild(dataRoot, inheritedDeadline.toString());
    await assertFillHandshake(run);
    assert.ok(process.hrtime.bigint() < inheritedDeadline,
      "the child must reach its fill handshake while the inherited budget remains valid");
    assert.equal(run.child.exitCode, null, "the child must wait after fill when no SIGTERM is sent");
    const exit = await closeWithin(run.child, 10_000);
    const exitedAt = process.hrtime.bigint();
    assert.deepEqual(exit, {code: 2, signal: null}, run.stderr());
    assert.ok(exitedAt <= inheritedDeadline + 1_000_000_000n,
      "the child must exit near the parent's deadline, not after a new 60-second window");
    assert.deepEqual(JSON.parse(run.stdout()), {
      status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"
    });
    const [runId] = await readdir(dataRoot);
    const childFiles = await readdir(path.join(dataRoot, runId));
    assert.ok(childFiles.includes("fill-acknowledged.json"));
    assert.equal(childFiles.includes("summary.json"), false);

    const freshBudgetRoot = await root(t);
    const freshBudgetStartedAt = process.hrtime.bigint();
    const freshBudgetDeadline = freshBudgetStartedAt + 60_000_000_000n;
    const freshBudgetRun = startChild(freshBudgetRoot, freshBudgetDeadline.toString());
    await assertFillHandshake(freshBudgetRun);
    const originalBudgetCutoff = freshBudgetStartedAt + BigInt(shortBudgetMs) * 1_000_000n;
    const remainingMs = Number((originalBudgetCutoff - process.hrtime.bigint()) / 1_000_000n);
    if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, remainingMs));
    assert.equal(freshBudgetRun.child.exitCode, null,
      "working IPC does not make a fresh child deadline equivalent to inheriting the parent's deadline");
    freshBudgetRun.child.kill("SIGKILL");
    const killed = await closeWithin(freshBudgetRun.child, 2_000);
    assert.deepEqual(killed, {code: null, signal: "SIGKILL"});

    for (const [label, invalidDeadline] of [
      ["expired", (process.hrtime.bigint() - 1_000_000n).toString()],
      ["malformed", "invalid-deadline"],
      ["overlong", "9".repeat(33)]
    ]) {
      const invalidRoot = await root(t);
      const invalidRun = startChild(invalidRoot, invalidDeadline);
      const invalidExit = await closeWithin(invalidRun.child, 2_000);
      assert.deepEqual(invalidExit, {code: 2, signal: null}, label);
      assert.deepEqual(JSON.parse(invalidRun.stdout()), {
        status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"
      }, label);
      assert.deepEqual(await readdir(invalidRoot), [], `${label} metadata must not start child work`);
    }
    assert.equal(children.length, 5);
  });

test("real SIGTERM send-to-exit timing excludes delayed signal receipt fsync", {timeout: 10_000}, async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "synthetic-real-signal-delayed-receipt-"));
  t.after(() => rm(dataRoot, {recursive: true, force: true}));
  const signals = new EventEmitter();
  const childExited = deferred();
  const receiptSyncEntered = deferred();
  const releaseReceiptSync = deferred();
  let child;
  let sendAt;
  let exitAt;
  const signalClockReads = [];
  let signalClock = 10_000;
  let signalReceiptSyncCompletedAt;
  const probe = filesystemProbe(async call => {
    const result = await call.action();
    if (call.method === "sync" && path.basename(call.filename) === "signal-sent.json") {
      receiptSyncEntered.resolve();
      await releaseReceiptSync.promise;
      signalReceiptSyncCompletedAt = performance.now();
    }
    return result;
  });
  let output = "";
  const drill = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_SIGNAL_DRILL: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot
    },
    signalSource: signals,
    fileSystem: probe.fileSystem,
    spawnChild: (...args) => {
      child = spawn(...args);
      return child;
    },
    killChild: (target, signal) => {
      sendAt = performance.now();
      target.once("exit", () => {
        exitAt = performance.now();
        childExited.resolve();
      });
      return target.kill(signal);
    },
    signalMonotonicNow: () => {
      const observedAt = signalClock;
      signalClock += 25;
      signalClockReads.push(observedAt);
      return observedAt;
    },
    stdout: {write: value => { output += value; }}
  });
  await receiptSyncEntered.promise;
  await childExited.promise;
  releaseReceiptSync.resolve();
  const code = await drill;
  const summary = JSON.parse(output);
  assert.equal(code, 2);
  assert.equal(summary.signalDrill.status, "VERIFIED");
  assert.deepEqual(signalClockReads, [10_000, 10_025]);
  assert.equal(summary.signalDrill.sendToExitMs, signalClockReads[1] - signalClockReads[0]);
  assert.ok(exitAt > sendAt);
  assert.ok(exitAt < signalReceiptSyncCompletedAt);
});

test("runbook host subshell gates verifier on the actual drill exit code", async () => {
  const runbook = await readFile(
    path.resolve("docs/strategy-lab/memecoin-paper/HOST_ACCEPTANCE_RUNBOOK.txt"), "utf8"
  );
  const section = runbook.split("Exact host command (uses the already prepared private SYNTHETIC_ROOT above):")[1]
    ?.split("Expected: exit 2 and status UNKNOWN")[0];
  assert.ok(section);
  const command = section.match(/^  \(\n([\s\S]*?)^  \)$/m)?.[0];
  assert.ok(command, "documented host subshell must be present");
  const script = command.split("\n").map(line => line.replace(/^  /, "")).join("\n");
  const shim = `
    node() {
      case " $* " in
        *" --input-type=module "*) printf 'VERIFIER\\n'; return 0 ;;
        *) printf 'CASE\\n'; return "$CASE" ;;
      esac
    }
    export REPO="$PWD" SYNTHETIC_ROOT=/tmp/synthetic-runbook-test
    ${script}
  `;
  for (const [childExit, expectedStatus, expectedOutput] of [
    ["0", 1, "CASE"],
    ["7", 1, "CASE"],
    ["2", 0, "CASE\nVERIFIER"]
  ]) {
    const result = spawnSync("bash", ["-c", shim], {
      encoding: "utf8", env: {...process.env, CASE: childExit}
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(result.stdout.trim(), expectedOutput);
  }
});

test("runbook receipt gate rejects ambiguous or incomplete drill results", () => {
  const verified = {
    status: "UNKNOWN", contractChecks: "PASS", proof: "SYNTHETIC_REAL_SIGTERM",
    evaluation: "UNKNOWN", outcome: "OPEN_UNVALUED_TERMINAL_POSITION",
    hostAcceptance: "NOT_ASSESSED", providerTrust: "NOT_ASSESSED",
    liveExecution: false, networkAccessed: false,
    signalDrill: {
      status: "VERIFIED", signal: "SIGTERM", targetPid: 123,
      signalSentExactlyOnce: true, signalObservedAfterFill: true, fillAcknowledged: true,
      sendToExitMs: 1, fillCheckpointSequence: 3, fillCheckpointSha256: "a".repeat(64),
      fillReceiptSha256: "b".repeat(64), childExit: {code: 2, signal: null},
      checkpointPersistence: "ACKNOWLEDGED", restartDenied: true,
      immutableReadback: true, openUnvaluedPositions: 1
    }
  };
  assert.equal(isVerifiedRealSignalDrillReceipt(verified), true);
  for (const invalid of [
    {...verified, contractChecks: "FAIL"},
    {...verified, signalDrill: {...verified.signalDrill, status: "UNKNOWN"}},
    {...verified, signalDrill: {...verified.signalDrill, signalSentExactlyOnce: false}},
    {...verified, signalDrill: {...verified.signalDrill, immutableReadback: false}}
  ]) {
    assert.equal(isVerifiedRealSignalDrillReceipt(invalid), false);
  }
});

test("HTTPS UNKNOWN never retries or reads; wrong scope and digest cannot pass", async t => {
  const {exportBytes, summary} = await runSyntheticHostAcceptance({enabled: true, dataRoot: await root(t)});
  const expected = {
    runId: summary.runId, configSha256: summary.configSha256, producerRevision: summary.producerRevision
  };
  let puts = 0;
  let gets = 0;
  const options = {
    exportBytes, expected, privateOrigin: "https://synthetic.invalid",
    attemptDirectory: await root(t),
    writeAuthorization: "synthetic-write", readAuthorization: "synthetic-read",
    transport: {
      async put() { puts += 1; return {status: "UNKNOWN"}; },
      async get() { gets += 1; throw new Error("must not read after UNKNOWN"); }
    }
  };
  assert.deepEqual(await transferSyntheticAcceptance(options), {status: "UNKNOWN"});
  assert.equal(puts, 1);
  assert.equal(gets, 0);
  assert.deepEqual(await transferSyntheticAcceptance(options), {status: "UNKNOWN"});
  assert.equal(puts, 1);
  assert.equal(gets, 0);
  await assert.rejects(transferSyntheticAcceptance({...options, readAuthorization: "synthetic-write"}));
  assert.deepEqual(await transferSyntheticAcceptance({
    ...options, expected: {...expected, configSha256: "0".repeat(64)}
  }), {status: "REJECTED"});
  assert.equal(puts, 1);
});

test("HTTPS file-backed auth rejects newline and equal scopes before starting; output is sanitized", async t => {
  const dataRoot = await root(t);
  const caFile = path.join(dataRoot, "ca.pem");
  const writeAuthFile = path.join(dataRoot, "write-auth");
  const readAuthFile = path.join(dataRoot, "read-auth");
  await writeFile(caFile, "test-ca-placeholder", {mode: 0o600});
  await writeFile(writeAuthFile, "private-write-value", {mode: 0o600});
  for (const value of ["private-read-value\n", "private-write-value"]) {
    await writeFile(readAuthFile, value, {mode: 0o600});
    let output = "";
    const code = await main({
      env: {
        PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot,
        PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED: "true",
        PAPER_SYNTHETIC_ACCEPTANCE_ORIGIN: "https://synthetic.invalid",
        PAPER_SYNTHETIC_ACCEPTANCE_CA_FILE: caFile,
        PAPER_SYNTHETIC_ACCEPTANCE_WRITE_AUTH_FILE: writeAuthFile,
        PAPER_SYNTHETIC_ACCEPTANCE_READ_AUTH_FILE: readAuthFile
      },
      stdout: {write: text => { output += text; }}
    });
    assert.equal(code, 2);
    assert.deepEqual(JSON.parse(output), {status: "BLOCKED", code: "SYNTHETIC_ACCEPTANCE_FAILED"});
    assert.equal(output.includes("private-"), false);
    assert.equal(output.includes(dataRoot), false);
  }
  assert.deepEqual((await readdir(dataRoot)).sort(), ["ca.pem", "read-auth", "write-auth"]);
});

test("one deadline bounds a stalled preparation write and cleanup without late continuation", async t => {
  const dataRoot = await root(t);
  const gate = deferred();
  const closing = deferred();
  const probe = filesystemProbe(async ({method, filename, action}) => {
    if (path.basename(filename) === "config.json" && method === "writeFile") {
      await gate.promise;
      return;
    }
    if (path.basename(filename) === "config.json" && method === "close") {
      await closing.promise;
    }
    return action();
  });
  const started = performance.now();
  const result = await runSyntheticHostAcceptance({
    enabled: true, dataRoot, timeoutMs: 500, fileSystem: probe.fileSystem
  });
  assert.ok(performance.now() - started < 2_000, "write/cleanup extended the deadline");
  assert.deepEqual(result, {summary: {status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"}});
  const callsBeforeRelease = probe.calls.filter(item => item.method !== "close");
  gate.resolve();
  closing.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await drainProbe(probe);
  assert.deepEqual(probe.calls.filter(item => item.method !== "close"), callsBeforeRelease);
  assert.equal(probe.calls.some(item => item.method === "sync" &&
    path.basename(item.filename) === "config.json"), false);
  const [runId] = await readdir(dataRoot);
  assert.deepEqual(await readdir(path.join(dataRoot, runId)), ["config.json"]);
});

for (const [filename, method] of [
  ["result.report.json", "writeFile"],
  ["result.report.json", "sync"],
  ["result.report.json", "read"],
  ["checkpoint.json", "read"],
  ["summary.json", "sync"]
]) {
  for (const interruption of ["expiry", "SIGTERM", "SIGINT"]) {
    test(`${interruption} during ${filename} ${method} fences finalization and late success`, async t => {
      const dataRoot = await root(t);
      const signals = new EventEmitter();
      const entered = deferred();
      const release = deferred();
      let now = 0;
      let blocked = false;
      let puts = 0;
      let gets = 0;
      const probe = filesystemProbe(async call => {
        if (!blocked && path.basename(call.filename) === filename && call.method === method) {
          blocked = true;
          entered.resolve();
          await release.promise;
          if (interruption === "expiry") now = 60_000;
        }
        return call.action();
      });
      const pending = runSyntheticHostAcceptance({
        enabled: true, dataRoot, signalSource: signals, fileSystem: probe.fileSystem,
        monotonicNow: () => now,
        httpsOptions: filename === "summary.json" ? undefined : {
          privateOrigin: "https://synthetic.invalid",
          writeAuthorization: "private-write-value", readAuthorization: "private-read-value",
          transport: {
            async put() { puts += 1; throw new Error("late upload"); },
            async get() { gets += 1; throw new Error("late readback"); }
          }
        }
      });
      await entered.promise;
      assert.equal(signals.listenerCount("SIGINT"), 1);
      assert.equal(signals.listenerCount("SIGTERM"), 1);
      if (interruption !== "expiry") signals.emit(interruption);
      else release.resolve();
      const result = await pending;
      assert.deepEqual(result, {summary: {status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"}});
      assert.equal(puts, 0);
      assert.equal(gets, 0);
      const fencedCalls = probe.calls.filter(item => item.method !== "close");
      release.resolve();
      await new Promise(resolve => setImmediate(resolve));
      await drainProbe(probe);
      assert.deepEqual(probe.calls.filter(item => item.method !== "close"), fencedCalls);
      assert.equal(signals.eventNames().length, 0);
      const [runId] = await readdir(dataRoot);
      const files = await readdir(path.join(dataRoot, runId));
      assert.ok(files.includes("config.json"), "partial evidence must be preserved");
      assert.equal(files.includes("https-attempt.json"), false);
      if (filename !== "summary.json") assert.equal(files.includes("summary.json"), false);
    });
  }
}

test("a real deadline releases a stalled finalization read before it settles", async t => {
  const dataRoot = await root(t);
  const gate = deferred();
  const entered = deferred();
  const probe = filesystemProbe(async call => {
    if (path.basename(call.filename) === "result.report.json" && call.method === "read") {
      entered.resolve();
      await gate.promise;
    }
    return call.action();
  });
  const started = performance.now();
  const pending = runSyntheticHostAcceptance({
    enabled: true, dataRoot, timeoutMs: 5_000, fileSystem: probe.fileSystem
  });
  await entered.promise;
  const result = await pending;
  assert.equal(result.summary.status, "UNKNOWN");
  assert.ok(performance.now() - started < 8_000, "read extended the deadline");
  const calls = probe.calls.filter(item => item.method !== "close");
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await drainProbe(probe);
  assert.deepEqual(probe.calls.filter(item => item.method !== "close"), calls);
});

test("late open completion is closed without starting a write", async t => {
  const dataRoot = await root(t);
  const gate = deferred();
  const entered = deferred();
  const signals = new EventEmitter();
  const probe = filesystemProbe(async call => {
    const value = await call.action();
    if (call.method === "open" && path.basename(call.filename) === "config.json") {
      entered.resolve();
      await gate.promise;
    }
    return value;
  });
  const pending = runSyntheticHostAcceptance({
    enabled: true, dataRoot, signalSource: signals, fileSystem: probe.fileSystem
  });
  await entered.promise;
  signals.emit("SIGTERM");
  assert.equal((await pending).summary.status, "UNKNOWN");
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await drainProbe(probe);
  assert.equal(probe.calls.some(call => call.method === "writeFile"), false);
});

test("CLI secret preparation shares the deadline and returns sanitized UNKNOWN on cancellation", async t => {
  const dataRoot = await root(t);
  const caFile = path.join(dataRoot, "ca.pem");
  await writeFile(caFile, "private-ca-value", {mode: 0o600});
  const entered = deferred();
  const release = deferred();
  const signals = new EventEmitter();
  const probe = filesystemProbe(async call => {
    if (call.method === "read") {
      entered.resolve();
      await release.promise;
    }
    return call.action();
  });
  let output = "";
  const pending = main({
    env: {
      PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_DATA_ROOT: dataRoot,
      PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_ORIGIN: "https://synthetic.invalid",
      PAPER_SYNTHETIC_ACCEPTANCE_CA_FILE: caFile
    },
    signalSource: signals, fileSystem: probe.fileSystem,
    stdout: {write: value => { output += value; }}
  });
  await entered.promise;
  signals.emit("SIGINT");
  assert.equal(await pending, 2);
  assert.deepEqual(JSON.parse(output), {status: "UNKNOWN", code: "SYNTHETIC_ACCEPTANCE_FAILED"});
  release.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await drainProbe(probe);
  assert.deepEqual(await readdir(dataRoot), ["ca.pem"]);
  assert.equal(signals.eventNames().length, 0);
});

test("the budget is shared across preparation and evidence, not restarted per stage", async t => {
  const dataRoot = await root(t);
  let now = 0;
  const probe = filesystemProbe(async call => {
    if (path.basename(call.filename) === "config.json" && call.method === "writeFile") {
      now = 30_000;
    }
    if (path.basename(call.filename) === "result.report.json" && call.method === "writeFile") {
      now += 30_000;
    }
    return call.action();
  });
  const result = await runSyntheticHostAcceptance({
    enabled: true, dataRoot, monotonicNow: () => now, fileSystem: probe.fileSystem
  });
  assert.equal(result.summary.status, "UNKNOWN");
  await drainProbe(probe);
  assert.equal(probe.calls.some(call =>
    call.method === "sync" && path.basename(call.filename) === "result.report.json"), false);
  assert.equal(probe.calls.some(call => path.basename(call.filename) === "summary.json"), false);
});

test("expiry while syncing the HTTPS marker fences dispatch and retains the one-shot claim", async t => {
  const {exportBytes, summary} = await runSyntheticHostAcceptance({enabled: true, dataRoot: await root(t)});
  const attemptDirectory = await root(t);
  const expected = {
    runId: summary.runId, configSha256: summary.configSha256, producerRevision: summary.producerRevision
  };
  let now = 0;
  let puts = 0;
  const probe = filesystemProbe(async call => {
    const result = await call.action();
    if (path.basename(call.filename) === "https-attempt.json" && call.method === "sync") {
      now = 60_000;
    }
    return result;
  });
  const options = {
    exportBytes, expected, attemptDirectory,
    privateOrigin: "https://synthetic.invalid",
    writeAuthorization: "private-write-value", readAuthorization: "private-read-value",
    transport: {
      async put() { puts += 1; throw new Error("late upload"); },
      async get() { throw new Error("late readback"); }
    }
  };
  assert.deepEqual(await transferSyntheticAcceptance({
    ...options, monotonicNow: () => now, fileSystem: probe.fileSystem
  }), {status: "UNKNOWN"});
  await drainProbe(probe);
  assert.deepEqual(await readdir(attemptDirectory), ["https-attempt.json"]);
  assert.deepEqual(await transferSyntheticAcceptance(options), {status: "UNKNOWN"});
  assert.equal(puts, 0);
});

test("cancellation during upload aborts transport, never reads or retries after late ACK", async t => {
  const {exportBytes, summary} = await runSyntheticHostAcceptance({enabled: true, dataRoot: await root(t)});
  const signals = new EventEmitter();
  const gate = deferred();
  const entered = deferred();
  let signal;
  let puts = 0;
  let gets = 0;
  const options = {
    exportBytes,
    expected: {runId: summary.runId, configSha256: summary.configSha256,
      producerRevision: summary.producerRevision},
    attemptDirectory: await root(t), signalSource: signals,
    privateOrigin: "https://synthetic.invalid",
    writeAuthorization: "private-write-value", readAuthorization: "private-read-value",
    transport: {
      async put(request) {
        puts += 1;
        signal = request.signal;
        entered.resolve();
        await gate.promise;
        return {status: "STORED", identity: request.identity,
          exportSha256: request.exportSha256, byteLength: request.byteLength, redirected: false};
      },
      async get() { gets += 1; throw new Error("late readback"); }
    }
  };
  const pending = transferSyntheticAcceptance(options);
  await entered.promise;
  signals.emit("SIGTERM");
  assert.deepEqual(await pending, {status: "UNKNOWN"});
  assert.equal(signal.aborted, true);
  gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(puts, 1);
  assert.equal(gets, 0);
  assert.deepEqual(await transferSyntheticAcceptance(options), {status: "UNKNOWN"});
  assert.equal(puts, 1);
  assert.equal(signals.eventNames().length, 0);
});
