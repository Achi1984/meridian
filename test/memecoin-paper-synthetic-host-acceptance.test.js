import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {EventEmitter} from "node:events";
import {chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {
  main, runSyntheticHostAcceptance, transferSyntheticAcceptance
} from "../scripts/memecoin-paper/synthetic-host-acceptance.mjs";
import {
  createPaperPilotComposition, createSyntheticClock, offlineFixtureAdapters
} from "../scripts/memecoin-paper/paper-pilot-composition.mjs";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {evaluateMemecoinPaperRunExport} from "../scripts/memecoin-paper-simulated-evaluation/index.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

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
