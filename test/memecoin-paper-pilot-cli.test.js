import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {canonicalJson, createRunConfig} from "./fixtures/memecoin-paper-pilot-online/generate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts/memecoin-paper/pilot-online.mjs");
const ASSEMBLY = path.join(ROOT, "test/fixtures/memecoin-paper-pilot-cli/assembly.mjs");

async function createHarness(t, mode = "success") {
  const root = await mkdtemp(path.join(os.tmpdir(), "meridian-paper-cli-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const dataDirectory = path.join(root, "volume");
  await mkdir(dataDirectory);
  const configPath = path.join(root, "run-config.json");
  await writeFile(configPath, canonicalJson(createRunConfig({startAt: Date.now() - 1_000})));
  return {
    root,
    dataDirectory,
    configPath,
    importMarker: path.join(root, "assembly-imported"),
    providerCounter: path.join(root, "provider-calls"),
    mode
  };
}

function launchCli(args, harness, timeoutMs = 5_000) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: harness?.root ?? os.tmpdir(),
      TMPDIR: harness?.root ?? os.tmpdir(),
      ...(harness ? {
        PILOT_ONLINE_CLI_FIXTURE_MODE: harness.mode,
        PILOT_ONLINE_CLI_IMPORT_MARKER: harness.importMarker,
        PILOT_ONLINE_CLI_PROVIDER_COUNTER: harness.providerCounter
      } : {})
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI child exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({code, signal, stdout, stderr});
    });
  });
  return {child, result};
}

function startArgs(harness) {
  return [
    "start", "--mode", "READ_ONLY_PAPER",
    "--config", harness.configPath,
    "--assembly", ASSEMBLY,
    "--data-dir", harness.dataDirectory
  ];
}

async function waitForActiveRun(harness, child) {
  const lockPath = path.join(harness.dataDirectory, "run.lock");
  const checkpointPath = path.join(harness.dataDirectory, "checkpoint", "checkpoint.json");
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await Promise.all([access(lockPath), access(checkpointPath)]);
      assert.equal(await fileExists(path.join(harness.dataDirectory, "terminal.json")), false);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (child.exitCode !== null) throw new Error("CLI exited before reaching its stop wait");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("CLI did not reach its bounded stop wait");
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readJsonOutput(result) {
  const lines = result.stdout.trim().split("\n");
  assert.ok(lines.length > 0 && lines.at(-1), `expected stdout JSON; stderr=${result.stderr}`);
  return JSON.parse(lines.at(-1));
}

test("no arguments stays disabled without loading the assembly or creating state", async t => {
  const harness = await createHarness(t);
  const result = await launchCli([], harness).result;
  assert.equal(result.code, 0);
  assert.deepEqual(await readJsonOutput(result), {
    status: "DISABLED",
    mode: "DISABLED",
    acquisitionStarted: false,
    executionStarted: false,
    reason: "READ_ONLY_PAPER mode was not explicitly selected"
  });
  assert.equal(await fileExists(harness.importMarker), false);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(harness.dataDirectory), []);
});

test("invalid options produce structured failure output and a nonzero exit", async t => {
  const harness = await createHarness(t);
  const result = await launchCli(["start", "--invalid"], harness).result;
  assert.equal(result.code, 1);
  assert.equal((await readJsonOutput(result)).status, "BLOCKED");
  assert.match(result.stdout, /expected command plus unique/);
});

test("offline start, status, and report commands expose their outputs", async t => {
  const harness = await createHarness(t);
  const started = await launchCli(startArgs(harness), harness).result;
  assert.equal(started.code, 0);
  assert.equal((await readJsonOutput(started)).status, "FINISHED");

  const status = await launchCli(["status", "--data-dir", harness.dataDirectory], harness).result;
  assert.equal(status.code, 0);
  assert.equal((await readJsonOutput(status)).status, "FINISHED");

  const report = await launchCli(["report", "--data-dir", harness.dataDirectory], harness).result;
  assert.equal(report.code, 0);
  assert.match(report.stdout, /Observation only: NO_ENTRY_OBSERVED; fills=0/);
  assert.equal((await readFile(path.join(harness.dataDirectory, "terminal.json"), "utf8"))
    .includes('"executionStarted":false'), true);
});

test("controller UNKNOWN results retain UNKNOWN and use a failing exit code", async t => {
  const harness = await createHarness(t, "unknown");
  const result = await launchCli(startArgs(harness), harness).result;
  assert.equal(result.code, 2);
  assert.equal((await readJsonOutput(result)).status, "UNKNOWN");
  const terminal = JSON.parse(await readFile(path.join(harness.dataDirectory, "terminal.json"), "utf8"));
  assert.equal(terminal.status, "UNKNOWN");
  assert.notEqual(terminal.status, "FINISHED");
});

test("controller start rejection leaves no monitor timer or orphaned child", async t => {
  const harness = await createHarness(t, "reject-start");
  const launchedAt = Date.now();
  const result = await launchCli(startArgs(harness), harness, 2_000).result;
  assert.ok(Date.now() - launchedAt < 2_000);
  assert.equal(result.code, 2);
  assert.equal((await readJsonOutput(result)).status, "UNKNOWN");
  const terminal = JSON.parse(await readFile(path.join(harness.dataDirectory, "terminal.json"), "utf8"));
  assert.equal(terminal.status, "UNKNOWN");
  assert.equal(terminal.failureCode, "PILOT_RUN_BLOCKED");
});

test("operator stop command requests stop and the active child finishes once", async t => {
  const harness = await createHarness(t, "stop");
  const active = launchCli(startArgs(harness), harness, 4_000);
  await waitForActiveRun(harness, active.child);
  const stop = await launchCli(["stop", "--data-dir", harness.dataDirectory], harness).result;
  assert.equal(stop.code, 0);
  assert.equal((await readJsonOutput(stop)).status, "STOP_REQUESTED");
  const finished = await active.result;
  assert.equal(finished.code, 0);
  const terminal = await readJsonOutput(finished);
  assert.equal(terminal.status, "FINISHED");
  assert.equal(terminal.stopReason, "OPERATOR_STOP");
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`${signal} requests a graceful stop and exits without replay`, async t => {
    const harness = await createHarness(t, "signal");
    const active = launchCli(startArgs(harness), harness, 4_000);
    await waitForActiveRun(harness, active.child);
    active.child.kill(signal);
    const finished = await active.result;
    assert.equal(finished.code, 0);
    assert.equal(finished.signal, null);
    assert.equal((await readJsonOutput(finished)).stopReason, "OPERATOR_STOP");
    assert.equal((await readFile(harness.providerCounter, "utf8")).trim().split("\n").length, 1);
  });
}

test("blocked status, report, and stop operations use nonzero exit codes", async t => {
  const harness = await createHarness(t);
  const missingReport = await launchCli(["report", "--data-dir", harness.dataDirectory], harness).result;
  assert.equal(missingReport.code, 2);
  assert.equal((await readJsonOutput(missingReport)).status, "BLOCKED");

  const blockedStop = await launchCli(["stop", "--data-dir", harness.dataDirectory], harness).result;
  assert.equal(blockedStop.code, 2);
  assert.equal((await readJsonOutput(blockedStop)).status, "BLOCKED");

  await writeFile(path.join(harness.dataDirectory, "run.lock"), "{");
  const unknownStatus = await launchCli(["status", "--data-dir", harness.dataDirectory], harness).result;
  assert.equal(unknownStatus.code, 2);
  assert.equal((await readJsonOutput(unknownStatus)).status, "UNKNOWN");
});

test("existing durable state refuses another start without replaying acquisition", async t => {
  const harness = await createHarness(t);
  const first = await launchCli(startArgs(harness), harness).result;
  assert.equal(first.code, 0);
  assert.equal((await readFile(harness.providerCounter, "utf8")).trim().split("\n").length, 1);
  const checkpoint = await readFile(path.join(harness.dataDirectory, "checkpoint", "checkpoint.json"));

  const second = await launchCli(startArgs(harness), harness).result;
  assert.equal(second.code, 1);
  assert.equal((await readJsonOutput(second)).status, "BLOCKED");
  assert.match(second.stdout, /persistent run state already exists/);
  assert.deepEqual(
    await readFile(path.join(harness.dataDirectory, "checkpoint", "checkpoint.json")),
    checkpoint
  );
  assert.equal((await readFile(harness.providerCounter, "utf8")).trim().split("\n").length, 1);
});
