import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
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

test("import and default-disabled CLI have no side effects; invalid enable is sanitized", async t => {
  const dataRoot = await root(t);
  const signals = new EventEmitter();
  for (const [env, expectedCode, status] of [
    [{}, 0, "DISABLED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "false"}, 0, "DISABLED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "secret-invalid-enable"}, 2, "BLOCKED"],
    [{PAPER_SYNTHETIC_ACCEPTANCE_ENABLED: "true",
      PAPER_SYNTHETIC_ACCEPTANCE_HTTPS_ENABLED: "secret-invalid-https"}, 2, "BLOCKED"]
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

test("runbook host subshell fails on unexpected drill exit before receipt verification", async () => {
  const runbook = await readFile(
    path.resolve("docs/strategy-lab/memecoin-paper/HOST_ACCEPTANCE_RUNBOOK.txt"), "utf8"
  );
  const section = runbook.split("Exact host command (uses the already prepared private SYNTHETIC_ROOT above):")[1]
    ?.split("Expected: exit 2 and status UNKNOWN")[0];
  assert.ok(section);
  assert.ok(section.indexOf('test "$signal_rc" -eq 2 || exit 1') <
    section.indexOf("SIGNAL_RECEIPT="));
  const script = '( signal_rc=0; signal_receipt=$(exit "$CHILD_EXIT") || signal_rc=$?; ' +
    'test "$signal_rc" -eq 2 || exit 1; printf "VERIFIER_RAN\\n" )';
  const unexpected = spawnSync("bash", ["-c", script], {
    encoding: "utf8", env: {...process.env, CHILD_EXIT: "7"}
  });
  assert.equal(unexpected.status, 1);
  assert.equal(unexpected.stdout, "");
  const expected = spawnSync("bash", ["-c", script], {
    encoding: "utf8", env: {...process.env, CHILD_EXIT: "2"}
  });
  assert.equal(expected.status, 0);
  assert.equal(expected.stdout.trim(), "VERIFIER_RAN");
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
