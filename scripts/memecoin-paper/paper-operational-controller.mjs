import {createHash, randomBytes} from "node:crypto";
import {constants} from "node:fs";
import {link, lstat, mkdir, open, rename, unlink} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalCheckpointBytes, MAX_CHECKPOINT_BYTES} from "./checkpoint-store.mjs";
import {createPaperPilotComposition} from "./paper-pilot-composition.mjs";
import {
  evaluateMemecoinPaperRunExport,
  EXPORT_SCHEMA,
  MAX_EXPORT_BYTES
} from "../memecoin-paper-simulated-evaluation/index.mjs";
import {createBoundedExternalReadOnlyInput} from "./execution-runner.mjs";

const MANIFEST_SCHEMA = "memecoin-paper-operational-manifest/v1";
const CONTROL_SCHEMA = "memecoin-paper-operational-control/v1";
const PRODUCER_REVISION = "paper-pilot-composition/3";
const MAX_MANIFEST_BYTES = MAX_CHECKPOINT_BYTES;
const MAX_STATUS_BYTES = 16 * 1024;
const MAX_STOP_BYTES = 4 * 1024;
const MAX_PATH_LENGTH = 4096;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/;
const DISABLED = Object.freeze({
  status: "DISABLED",
  enabled: false,
  executionStarted: false,
  reason: "Operational paper controller requires `start --enable` and a reviewed manifest"
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...expected].sort().join(",") &&
    expected.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && "value" in descriptor;
    });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function absolutePath(value, label) {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_PATH_LENGTH ||
      !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new TypeError(`${label} must be a normalized absolute path within its byte limit`);
  }
  return value;
}

async function assertDirectory(directory, label) {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new TypeError(`${label} must be a real directory`);
  }
}

async function readBoundedFile(filename, maximum) {
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    throw new Error("safe nonblocking file flags are unavailable");
  }
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximum) {
      throw new RangeError("file is not regular or exceeds its byte limit");
    }
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const {bytesRead} = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maximum) throw new RangeError("file exceeds its byte limit");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

async function readJsonFile(filename, maximum) {
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(
    await readBoundedFile(filename, maximum)
  ));
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomic(directory, filename, bytes, replace) {
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.pending-${randomBytes(12).toString("hex")}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (replace) await rename(temporary, destination);
    else {
      await link(temporary, destination);
      await unlink(temporary);
    }
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function parseManifest(value) {
  if (!exactKeys(value, ["schemaVersion", "config", "externalReadOnlyInput"]) ||
      value.schemaVersion !== MANIFEST_SCHEMA ||
      !isRecord(value.config) ||
      value.config.mode !== "EXTERNAL_READ_ONLY_INPUT" ||
      value.config.enabled !== true ||
      typeof value.config.runId !== "string" || !SAFE_ID.test(value.config.runId)) {
    throw new TypeError("manifest must be the exact reviewed external-read-only v1 contract");
  }
  const externalReadOnlyInput = createBoundedExternalReadOnlyInput(value.externalReadOnlyInput);
  if (Buffer.byteLength(canonicalCheckpointBytes(externalReadOnlyInput)) >= value.config.budgets?.bytes) {
    throw new RangeError("manifest input must leave bytes within the configured runner budget");
  }
  return {config: value.config, externalReadOnlyInput};
}

function statusRecord(runId, state, exportStatus, updatedAt, evaluatorOverall = null) {
  return {
    schemaVersion: CONTROL_SCHEMA,
    runId,
    state,
    exportStatus,
    evaluatorOverall,
    updatedAt
  };
}

async function persistStatus(directory, record) {
  const bytes = Buffer.from(JSON.stringify(record));
  if (bytes.byteLength > MAX_STATUS_BYTES) throw new RangeError("controller status exceeds its byte limit");
  await writeAtomic(directory, "controller-status.json", bytes, true);
}

async function readStatus(directory, runId) {
  const value = await readJsonFile(path.join(directory, "controller-status.json"), MAX_STATUS_BYTES);
  if (!exactKeys(value, [
        "schemaVersion", "runId", "state", "exportStatus", "evaluatorOverall", "updatedAt"
      ]) ||
      value.schemaVersion !== CONTROL_SCHEMA || value.runId !== runId) {
    throw new TypeError("controller status is invalid or bound to another run");
  }
  return value;
}

async function hasStopRequest(directory) {
  try {
    await readBoundedFile(path.join(directory, "stop-request.json"), MAX_STOP_BYTES);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    return true;
  }
}

async function readStopRequest(directory) {
  try {
    return await readJsonFile(path.join(directory, "stop-request.json"), MAX_STOP_BYTES);
  } catch {
    return null;
  }
}

async function publishAndVerifyReport(directory, report, config) {
  const bytes = canonicalCheckpointBytes(report);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXPORT_BYTES) {
    throw new RangeError("canonical run export exceeds its byte limit");
  }
  await writeAtomic(directory, "run-export.json", bytes, false);
  const readback = await readBoundedFile(path.join(directory, "run-export.json"), MAX_EXPORT_BYTES);
  if (!readback.equals(bytes)) throw new Error("run export readback differs from canonical result.report");
  const evaluation = evaluateMemecoinPaperRunExport(readback, {
    runId: config.runId,
    configSha256: sha256(canonicalCheckpointBytes(config)),
    producerRevision: PRODUCER_REVISION
  });
  if (evaluation.overall === "FAIL" || report.schemaVersion !== EXPORT_SCHEMA) {
    throw new Error("actual evaluator rejected the persisted run export");
  }
  const check = id => evaluation.checks.find(item => item.id === id)?.status;
  if ((report.bindingReceipt && check("historical_run_binding") !== "PASS") ||
      (report.checkpoint &&
       ["checkpoint_digest", "checkpoint_chain"].some(id => check(id) !== "PASS"))) {
    throw new Error("actual evaluator could not verify the available binding and full checkpoint");
  }
  return evaluation.overall;
}

async function launch(manifestPath, runsDirectory) {
  absolutePath(manifestPath, "manifest path");
  absolutePath(runsDirectory, "runs directory");
  await assertDirectory(runsDirectory, "runs directory");
  const manifest = parseManifest(await readJsonFile(manifestPath, MAX_MANIFEST_BYTES));
  const {config, externalReadOnlyInput} = manifest;
  const runDirectory = path.join(runsDirectory, config.runId);
  const abort = new AbortController();
  const pilot = createPaperPilotComposition({
    config,
    dataDirectory: runDirectory,
    externalReadOnlyInput,
    signal: abort.signal
  });
  await mkdir(runDirectory, {mode: 0o700});
  const lock = await open(path.join(runDirectory, "controller.lock"), "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({runId: config.runId, pid: process.pid}));
    await lock.sync();
    await syncDirectory(runDirectory);
  } catch (error) {
    await lock.close();
    throw error;
  }

  const requestStop = () => {
    if (!pilot.stop()) abort.abort();
  };
  const onSignal = () => requestStop();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  let exportStatus = "NOT_STARTED";
  let evaluatorOverall = null;
  let state = "INITIALIZING";
  let settled = false;
  let pending;
  let statusWriteFailed = false;
  try {
    await persistStatus(runDirectory, statusRecord(
      config.runId, state, exportStatus, Date.now()
    ));
    if (await hasStopRequest(runDirectory)) requestStop();
    pending = pilot.start().finally(() => { settled = true; });
    let lastStatusWrite = Date.now();
    while (!settled) {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (await hasStopRequest(runDirectory)) requestStop();
      const compositionState = pilot.status().state;
      state = compositionState === "CREATED" ? "INITIALIZING" : compositionState;
      if (!statusWriteFailed && Date.now() - lastStatusWrite >= 100) {
        try {
          await persistStatus(runDirectory, statusRecord(
            config.runId, state, exportStatus, Date.now()
          ));
          lastStatusWrite = Date.now();
        } catch {
          statusWriteFailed = true;
          requestStop();
        }
      }
    }
    const result = await pending;
    state = result.status;
    if (result.report) {
      try {
        evaluatorOverall = await publishAndVerifyReport(runDirectory, result.report, config);
        exportStatus = "ACKNOWLEDGED";
      } catch {
        exportStatus = "UNKNOWN";
      }
    }
    if (!statusWriteFailed) {
      await persistStatus(runDirectory, statusRecord(
        config.runId, state, exportStatus, Date.now(), evaluatorOverall
      )).catch(() => {});
    }
    return {
      status: state,
      runId: config.runId,
      exportStatus,
      evaluatorOverall,
      runDirectory
    };
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    if (pending) {
      if (!settled) requestStop();
      await pending.catch(() => {});
    }
    await lock.close();
    await unlink(path.join(runDirectory, "controller.lock")).catch(() => {});
  }
}

function parseFlags(argv, allowed) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) throw new TypeError("expected named command flags");
    const name = flag.slice(2);
    if (!allowed.includes(name) || Object.hasOwn(result, name)) {
      throw new TypeError("unknown or duplicate command flag");
    }
    if (name === "enable") {
      result[name] = true;
      continue;
    }
    const value = argv[++index];
    if (typeof value !== "string" || value.startsWith("--")) {
      throw new TypeError(`--${name} requires one value`);
    }
    result[name] = value;
  }
  return result;
}

function validRunId(value) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) throw new TypeError("run id is invalid");
  return value;
}

async function stopCommand(runsDirectory, runId, commandId) {
  absolutePath(runsDirectory, "runs directory");
  validRunId(runId);
  validRunId(commandId);
  await assertDirectory(runsDirectory, "runs directory");
  const directory = path.join(runsDirectory, runId);
  await assertDirectory(directory, "run directory");
  const existing = await readStopRequest(directory);
  if (existing) {
    return {
      status: existing.commandId === commandId ? "DUPLICATE_COMMAND" : "STOP_ALREADY_REQUESTED",
      runId,
      executionStarted: false
    };
  }
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: CONTROL_SCHEMA,
    commandId,
    requestedAt: Date.now()
  }));
  if (bytes.byteLength > MAX_STOP_BYTES) throw new RangeError("stop request exceeds its byte limit");
  try {
    const handle = await open(path.join(directory, "stop-request.json"), "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(directory);
    return {status: "STOP_REQUESTED", runId, executionStarted: false};
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const raced = await readStopRequest(directory);
    return {
      status: raced?.commandId === commandId ? "DUPLICATE_COMMAND" : "STOP_ALREADY_REQUESTED",
      runId,
      executionStarted: false
    };
  }
}

async function statusCommand(runsDirectory, runId) {
  absolutePath(runsDirectory, "runs directory");
  validRunId(runId);
  await assertDirectory(runsDirectory, "runs directory");
  const directory = path.join(runsDirectory, runId);
  await assertDirectory(directory, "run directory");
  return readStatus(directory, runId);
}

async function exportCommand(runsDirectory, runId, configSha256, producerRevision) {
  absolutePath(runsDirectory, "runs directory");
  validRunId(runId);
  if (!HASH.test(configSha256) || producerRevision !== PRODUCER_REVISION) {
    throw new TypeError("independent export expectations are invalid");
  }
  await assertDirectory(runsDirectory, "runs directory");
  const directory = path.join(runsDirectory, runId);
  await assertDirectory(directory, "run directory");
  const bytes = await readBoundedFile(path.join(directory, "run-export.json"), MAX_EXPORT_BYTES);
  const evaluation = evaluateMemecoinPaperRunExport(bytes, {
    runId, configSha256, producerRevision
  });
  if (evaluation.overall === "FAIL") {
    throw new TypeError("persisted export does not match the independent evaluator expectations");
  }
  return bytes;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    process.stdout.write(`${JSON.stringify(DISABLED)}\n`);
    return 0;
  }
  const command = argv[0];
  try {
    if (command === "start") {
      const flags = parseFlags(argv.slice(1), ["enable", "manifest", "runs-dir"]);
      if (flags.enable !== true || Object.keys(flags).length !== 3 ||
          !flags.manifest || !flags["runs-dir"]) {
        throw new TypeError("start requires --enable, --manifest, and --runs-dir");
      }
      const result = await launch(flags.manifest, flags["runs-dir"]);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.status === "FINISHED" && result.exportStatus === "ACKNOWLEDGED" &&
        result.evaluatorOverall === "PASS" ? 0 : 2;
    }
    if (command === "status") {
      const flags = parseFlags(argv.slice(1), ["runs-dir", "run-id"]);
      if (Object.keys(flags).length !== 2) throw new TypeError("status requires --runs-dir and --run-id");
      process.stdout.write(`${JSON.stringify(await statusCommand(flags["runs-dir"], flags["run-id"]))}\n`);
      return 0;
    }
    if (command === "stop") {
      const flags = parseFlags(argv.slice(1), ["runs-dir", "run-id", "command-id"]);
      if (Object.keys(flags).length !== 3) {
        throw new TypeError("stop requires --runs-dir, --run-id, and --command-id");
      }
      const result = await stopCommand(flags["runs-dir"], flags["run-id"], flags["command-id"]);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.status === "STOP_REQUESTED" ? 0 : 2;
    }
    if (command === "export") {
      const flags = parseFlags(argv.slice(1), [
        "runs-dir", "run-id", "config-sha256", "producer-revision"
      ]);
      if (Object.keys(flags).length !== 4) {
        throw new TypeError("export requires --runs-dir, --run-id, --config-sha256, and --producer-revision");
      }
      const bytes = await exportCommand(
        flags["runs-dir"], flags["run-id"], flags["config-sha256"], flags["producer-revision"]
      );
      process.stdout.write(bytes);
      return 0;
    }
    throw new TypeError("unknown command");
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: "BLOCKED",
      code: error.code === "EEXIST" ? "RESTART_NOT_ALLOWED" : "INVALID_OR_UNAVAILABLE",
      executionStarted: false
    })}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
