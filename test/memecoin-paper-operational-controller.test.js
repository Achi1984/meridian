import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {canonicalCheckpointBytes} from "../scripts/memecoin-paper/checkpoint-store.mjs";
import {
  evaluateMemecoinPaperRunExport
} from "../scripts/memecoin-paper-simulated-evaluation/index.mjs";
import {runOperationalController} from "../scripts/memecoin-paper/paper-operational-controller.mjs";

const CLI = fileURLToPath(new URL(
  "../scripts/memecoin-paper/paper-operational-controller.mjs", import.meta.url
));
const PRODUCER_REVISION = "paper-pilot-composition/3";
const BUDGETS = {
  requests: 12,
  bytes: 1_000_000,
  events: 128,
  candidates: 4,
  cycles: 4,
  durationMs: 20_000,
  callbackTimeoutMs: 1_000,
  maxWallClockUncertaintyMs: 10
};

function command(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    ...options
  });
}

function externalManifest(runId) {
  const startedAt = Date.now() - 5_000;
  const sampledAt = Date.now() - 100;
  return {
    schemaVersion: "memecoin-paper-operational-manifest/v1",
    config: {
      version: 1,
      mode: "EXTERNAL_READ_ONLY_INPUT",
      enabled: true,
      runId,
      startedAt,
      budgets: {...BUDGETS}
    },
    externalReadOnlyInput: {
      kind: "MEMECOIN_EXTERNAL_READ_ONLY_INPUT_V1",
      schemaVersion: 1,
      producerRevision: "caller-claimed-intake",
      sourceContracts: {candidateIntakeSha: null, evidenceSha: null, quotesSha: null},
      timing: {
        sourceTimestamp: sampledAt,
        receiptTimestamp: sampledAt,
        uncertaintyMs: 0,
        monotonicElapsedMs: 0,
        clockSource: "UNATTESTED"
      },
      payload: {
        candidate: {
          chainId: "solana",
          mint: "11111111111111111111111111111111",
          pool: "Vote111111111111111111111111111111111111111",
          quote: "Stake11111111111111111111111111111111111111",
          decimals: 6,
          sampledAt,
          source: "caller-claimed-source",
          evidence: {},
          analystEvidence: {}
        }
      }
    }
  };
}

async function harness(t, runId = "operational-export-test") {
  const root = await mkdtemp(path.join(os.tmpdir(), "paper-operational-"));
  const runsDirectory = path.join(root, "runs");
  await mkdir(runsDirectory);
  const manifestPath = path.join(root, "manifest.json");
  const manifest = externalManifest(runId);
  await writeFile(manifestPath, JSON.stringify(manifest), {mode: 0o600});
  t.after(() => rm(root, {recursive: true, force: true}));
  return {root, runsDirectory, manifestPath, manifest};
}

function parseOutput(result) {
  assert.equal(result.error, undefined, result.error?.message);
  return JSON.parse(result.stdout);
}

test("no arguments and read-only status do not start an operational run", async t => {
  const {root, runsDirectory} = await harness(t, "status-only-run");
  const disabled = parseOutput(command([]));
  assert.equal(disabled.status, "DISABLED");
  assert.equal(disabled.executionStarted, false);

  const status = command(["status", "--runs-dir", runsDirectory, "--run-id", "status-only-run"]);
  assert.equal(status.status, 2);
  assert.equal(parseOutput(status).executionStarted, false);
  assert.deepEqual(await readdir(runsDirectory), []);

  const relativePath = command([
    "start", "--enable", "--manifest", path.relative(root, path.join(root, "manifest.json")),
    "--runs-dir", runsDirectory
  ]);
  assert.equal(relativePath.status, 2);
  assert.equal(parseOutput(relativePath).executionStarted, false);
  assert.deepEqual(await readdir(runsDirectory), []);
});

test("explicit external-only run persists the exact report and read-only export verifies it", async t => {
  const {runsDirectory, manifestPath, manifest} = await harness(t);
  const started = command([
    "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
  ]);
  assert.equal(started.status, 2, `${started.stderr}\n${started.stdout}`);
  const result = parseOutput(started);
  assert.equal(result.status, "FINISHED");
  assert.equal(result.exportStatus, "ACKNOWLEDGED");
  assert.equal(result.evaluatorOverall, "UNKNOWN");

  const runDirectory = path.join(runsDirectory, manifest.config.runId);
  const exportPath = path.join(runDirectory, "run-export.json");
  const bytes = await readFile(exportPath);
  const report = JSON.parse(bytes);
  assert.deepEqual(bytes, canonicalCheckpointBytes(report));
  assert.equal(report.schemaVersion, "memecoin-paper-run-export/v1");
  assert.equal(report.exportBinding, "PRESTART_BOUND");
  assert.equal(report.persistence, "ACKNOWLEDGED");
  assert.equal(report.runnerReport.provenance, "UNVERIFIED_CALLER_INPUT");
  assert.equal(report.runnerReport.operationResults.some(item =>
    item.method === "executeEntry"), false);
  assert.equal(report.runnerReport.counters.quotes, 0);

  const configSha256 = createHash("sha256")
    .update(canonicalCheckpointBytes(manifest.config)).digest("hex");
  const evaluation = evaluateMemecoinPaperRunExport(bytes, {
    runId: manifest.config.runId,
    configSha256,
    producerRevision: PRODUCER_REVISION
  });
  assert.equal(evaluation.overall, "UNKNOWN");
  assert.equal(evaluation.evidence.entryFills, 0);
  assert.deepEqual(evaluation.claims, {
    liveExecution: false, profitability: false, activation: false, sourceReadiness: false
  });
  assert.equal(evaluation.checks.find(item => item.id === "historical_run_binding").status, "PASS");

  const downloaded = command([
    "export",
    "--runs-dir", runsDirectory,
    "--run-id", manifest.config.runId,
    "--config-sha256", configSha256,
    "--producer-revision", PRODUCER_REVISION
  ]);
  assert.equal(downloaded.status, 0, downloaded.stderr);
  assert.deepEqual(Buffer.from(downloaded.stdout), bytes);

  const status = parseOutput(command([
    "status", "--runs-dir", runsDirectory, "--run-id", manifest.config.runId
  ]));
  assert.equal(status.state, "FINISHED");
  assert.equal(status.exportStatus, "ACKNOWLEDGED");
  assert.equal(status.evaluatorOverall, "UNKNOWN");

  const saved = await readFile(exportPath);
  const checkpointPath = path.join(runDirectory, "checkpoint.json");
  const checkpoint = await readFile(checkpointPath);
  const restarted = command([
    "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
  ]);
  assert.equal(restarted.status, 2);
  assert.equal(parseOutput(restarted).code, "RESTART_NOT_ALLOWED");
  assert.deepEqual(await readFile(exportPath), saved);
  assert.deepEqual(await readFile(checkpointPath), checkpoint);

  const stopArgs = ["stop", "--runs-dir", runsDirectory, "--run-id", manifest.config.runId];
  assert.equal(parseOutput(command([...stopArgs, "--command-id", "stop-once"])).status, "STOP_REQUESTED");
  assert.equal(parseOutput(command([...stopArgs, "--command-id", "stop-once"])).status, "DUPLICATE_COMMAND");
  assert.equal(parseOutput(command([...stopArgs, "--command-id", "stop-twice"])).status,
    "STOP_ALREADY_REQUESTED");

  await writeFile(exportPath, Buffer.from("{"));
  const rejectedDownload = command([
    "export",
    "--runs-dir", runsDirectory,
    "--run-id", manifest.config.runId,
    "--config-sha256", configSha256,
    "--producer-revision", PRODUCER_REVISION
  ]);
  assert.equal(rejectedDownload.status, 2);
  assert.equal(parseOutput(rejectedDownload).status, "BLOCKED");
  assert.equal(await readFile(exportPath, "utf8"), "{");
});

test("SIGTERM is held at pre-initialization and confirmed-start phase barriers", async t => {
  for (const [runId, targetPhase] of [
    ["signal-after-directory-created", "RUN_DIRECTORY_CREATED"],
    ["signal-before-initialization", "BEFORE_COMPOSITION_START"],
    ["signal-after-confirmed-start", "COMPOSITION_STARTED"]
  ]) {
    const {runsDirectory, manifestPath, manifest} = await harness(t, runId);
    const observed = [];
    const response = await runOperationalController([
      "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
    ], {
      onPhase(phase, details) {
        observed.push(phase);
        if (phase === targetPhase) {
          if (targetPhase === "COMPOSITION_STARTED") assert.equal(details.state, "RUNNING");
          process.emit("SIGTERM");
        }
      }
    });
    const result = response.result;
    const runDirectory = path.join(runsDirectory, runId);
    const reportBytes = await readFile(path.join(runDirectory, "run-export.json"));
    const report = JSON.parse(reportBytes);
    const status = JSON.parse(await readFile(path.join(runDirectory, "controller-status.json"), "utf8"));

    assert.ok(observed.includes(targetPhase));
    assert.equal(response.exitCode, 2);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.runStatus, "STOPPED");
    assert.equal(result.runId, runId);
    assert.equal(result.runDirectory, runDirectory);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(status.state, "STOPPED");
    assert.equal(status.exportStatus, "UNKNOWN");
    assert.deepEqual(reportBytes, canonicalCheckpointBytes(report));
    assert.equal(report.persistence, "NOT_STARTED");
    assert.equal(report.runnerReport, null);
    assert.equal(report.checkpoint, null);
    await assert.rejects(access(path.join(runDirectory, "checkpoint.json")), {code: "ENOENT"});
    await assert.rejects(access(path.join(runDirectory, "start-binding.json")), {code: "ENOENT"});
  }
});

test("post-directory I/O failure returns UNKNOWN identity and forbids retry", async t => {
  const {runsDirectory, manifestPath, manifest} = await harness(t, "injected-start-failure");
  const response = await runOperationalController([
    "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
  ], {
    onPhase(phase) {
      if (phase === "RUN_DIRECTORY_CREATED") throw new Error("injected post-begin I/O failure");
    }
  });
  const result = response.result;
  const runDirectory = path.join(runsDirectory, manifest.config.runId);
  assert.equal(response.exitCode, 2);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.runStatus, "NOT_STARTED");
  assert.equal(result.executionStarted, "UNKNOWN");
  assert.equal(result.runDirectoryCreated, true);
  assert.equal(result.runId, manifest.config.runId);
  assert.equal(result.runDirectory, runDirectory);
  assert.equal(result.reconciliationRequired, true);
  assert.match(result.reconciliationInstruction, /Do not retry or overwrite/);
  const status = JSON.parse(await readFile(path.join(runDirectory, "controller-status.json"), "utf8"));
  assert.equal(status.state, "UNKNOWN");
  assert.equal(status.exportStatus, "UNKNOWN");
  assert.deepEqual(await readdir(runDirectory), ["controller-status.json"]);

  const retry = command([
    "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
  ]);
  assert.equal(retry.status, 2);
  assert.equal(parseOutput(retry).code, "RESTART_NOT_ALLOWED");
});

test("post-publication acknowledgement loss preserves exact export and blocks overwrite", async t => {
  const {runsDirectory, manifestPath, manifest} = await harness(t, "injected-export-ack-loss");
  const response = await runOperationalController([
    "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
  ], {
    onPhase(phase) {
      if (phase === "EXPORT_PUBLISHED") throw new Error("injected publication acknowledgement loss");
    }
  });
  const result = response.result;
  const runDirectory = path.join(runsDirectory, manifest.config.runId);
  const exportPath = path.join(runDirectory, "run-export.json");
  const bytes = await readFile(exportPath);
  const report = JSON.parse(bytes);
  assert.equal(response.exitCode, 2);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.runStatus, "FINISHED");
  assert.equal(result.executionStarted, true);
  assert.equal(result.exportStatus, "UNKNOWN");
  assert.equal(result.reconciliationRequired, true);
  assert.deepEqual(bytes, canonicalCheckpointBytes(report));
  assert.equal(report.schemaVersion, "memecoin-paper-run-export/v1");
  assert.equal(report.persistence, "ACKNOWLEDGED");

  const configSha256 = createHash("sha256")
    .update(canonicalCheckpointBytes(manifest.config)).digest("hex");
  const evaluation = evaluateMemecoinPaperRunExport(bytes, {
    runId: manifest.config.runId,
    configSha256,
    producerRevision: PRODUCER_REVISION
  });
  assert.equal(evaluation.checks.find(item => item.id === "historical_run_binding").status, "PASS");
  assert.equal(evaluation.checks.find(item => item.id === "checkpoint_digest").status, "PASS");
  assert.equal(evaluation.checks.find(item => item.id === "checkpoint_chain").status, "PASS");

  const retry = command([
    "start", "--enable", "--manifest", manifestPath, "--runs-dir", runsDirectory
  ]);
  assert.equal(retry.status, 2);
  assert.equal(parseOutput(retry).code, "RESTART_NOT_ALLOWED");
  assert.deepEqual(await readFile(exportPath), bytes);
});

test("manifest and control paths are bounded and non-symlinked", async t => {
  const {root, runsDirectory, manifestPath} = await harness(t, "path-limit-run");
  const longPath = `/${"x".repeat(4096)}`;
  const rejectedPath = command([
    "status", "--runs-dir", longPath, "--run-id", "path-limit-run"
  ]);
  assert.equal(rejectedPath.status, 2);
  assert.equal(parseOutput(rejectedPath).executionStarted, false);

  const symlinkedManifest = path.join(root, "manifest-link.json");
  await symlink(manifestPath, symlinkedManifest);
  const rejectedManifest = command([
    "start", "--enable", "--manifest", symlinkedManifest, "--runs-dir", runsDirectory
  ]);
  assert.equal(rejectedManifest.status, 2);
  assert.equal(parseOutput(rejectedManifest).executionStarted, false);
  assert.deepEqual(await readdir(runsDirectory), []);
});
