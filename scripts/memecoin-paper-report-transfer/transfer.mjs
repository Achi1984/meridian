import {createHash} from "node:crypto";
import {lstat, readFile, realpath} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {readPilotReport, readPilotStatus, canonicalJson} from "../memecoin-paper/pilot-online.mjs";
import {
  PAPER_REPORT_SCHEMA
} from "../memecoin-paper-report-bridge/contract.mjs";

export const PAPER_REPORT_TRANSFER_SCHEMA = "MEMECOIN_PAPER_REPORT_TRANSFER_ENVELOPE_V1";
export const PAPER_REPORT_UPLOAD_PATH = "/api/private/paper-report/upload";
export const PAPER_REPORT_MAX_BYTES = 256 * 1024;
export const PAPER_REPORT_TIMEOUT_MS = 10_000;

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_CONFIG_BYTES = 64 * 1024;

function failure(reason) {
  return {status: "REJECTED", reason};
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validOrigin(value) {
  if (typeof value !== "string" || value.length > 255) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.origin !== value.replace(/\/$/, "")) {
    return null;
  }
  return url.origin;
}

async function assertSafeRunDirectory(root, runId) {
  if (typeof root !== "string" || !path.isAbsolute(root) ||
      typeof runId !== "string" || !SAFE_RUN_ID.test(runId)) {
    throw new TypeError("invalid_run_selector");
  }
  const rootPath = path.resolve(root);
  const rootStat = await lstat(rootPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() ||
      await realpath(rootPath) !== rootPath) {
    throw new TypeError("unsafe_data_root");
  }
  const runPath = path.resolve(rootPath, runId);
  const relative = path.relative(rootPath, runPath);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." ||
      path.isAbsolute(relative)) {
    throw new TypeError("invalid_run_selector");
  }
  const runStat = await lstat(runPath);
  if (!runStat.isDirectory() || runStat.isSymbolicLink() ||
      await realpath(runPath) !== runPath) {
    throw new TypeError("unsafe_run_directory");
  }
  for (const name of ["run.lock", "terminal.json", "run-config.json", "operator-report.json"]) {
    const file = path.join(runPath, name);
    const stat = await lstat(file);
    const resolved = await realpath(file);
    const fileRelative = path.relative(runPath, resolved);
    if (!stat.isFile() || stat.isSymbolicLink() ||
        !fileRelative || fileRelative.startsWith(`..${path.sep}`) ||
        fileRelative === ".." || path.isAbsolute(fileRelative) ||
        stat.size > (name === "run-config.json" ? MAX_CONFIG_BYTES
          : name === "operator-report.json" ? PAPER_REPORT_MAX_BYTES : 16 * 1024)) {
      throw new TypeError("unsafe_run_file");
    }
  }
  return runPath;
}

async function readConfig(runPath) {
  const filename = path.join(runPath, "run-config.json");
  if ((await lstat(filename)).size > MAX_CONFIG_BYTES) {
    throw new RangeError("run_config_too_large");
  }
  const bytes = await readFile(filename);
  if (bytes.length > MAX_CONFIG_BYTES) throw new RangeError("run_config_too_large");
  const text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  const config = JSON.parse(text);
  if (canonicalJson(config) !== text) throw new TypeError("run_config_not_canonical");
  return {config, hash: sha256(bytes)};
}

function canonicalTransferEnvelope(runId, configHash, report) {
  return {
    schema: PAPER_REPORT_TRANSFER_SCHEMA,
    runId,
    configHash,
    report
  };
}

export async function transferPostRunReport({
  enabled = false,
  root,
  runId,
  expectedRunId,
  expectedConfigHash,
  gatewayOrigin,
  uploadToken,
  readStatus = readPilotStatus,
  readReport = readPilotReport,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = PAPER_REPORT_TIMEOUT_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (enabled !== true) return failure("transfer_disabled");
  if (typeof expectedRunId !== "string" || !SAFE_RUN_ID.test(expectedRunId) ||
      runId !== expectedRunId) return failure("run_scope_mismatch");
  if (typeof expectedConfigHash !== "string" || !HASH.test(expectedConfigHash)) {
    return failure("config_scope_missing");
  }
  const origin = validOrigin(gatewayOrigin);
  if (!origin) return failure("gateway_origin_invalid");
  if (typeof uploadToken !== "string" || !/^[A-Za-z0-9._~-]{32,512}$/.test(uploadToken)) {
    return failure("upload_credential_missing");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > PAPER_REPORT_TIMEOUT_MS || typeof fetchImpl !== "function" ||
      typeof now !== "function" || typeof schedule !== "function" ||
      typeof cancelSchedule !== "function") return failure("transfer_configuration_invalid");

  let runPath;
  try {
    runPath = await assertSafeRunDirectory(root, runId);
  } catch {
    return failure("run_directory_unsafe_or_missing");
  }

  let status;
  let config;
  try {
    [status, config] = await Promise.all([
      readStatus(runPath),
      readConfig(runPath)
    ]);
  } catch {
    return failure("run_state_unavailable");
  }
  if (status?.status !== "FINISHED" || status.runId !== runId ||
      status.configHash !== expectedConfigHash ||
      config.hash !== expectedConfigHash || config.config?.runId !== runId ||
      config.config?.mode !== "READ_ONLY_PAPER") {
    return failure("terminal_or_config_mismatch");
  }

  const terminal = await readFile(path.join(runPath, "terminal.json")).then(bytes => {
    if (bytes.length > 16 * 1024) throw new RangeError();
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  }).catch(() => null);
  const lock = await readFile(path.join(runPath, "run.lock")).then(bytes => {
    if (bytes.length > 16 * 1024) throw new RangeError();
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  }).catch(() => null);
  if (terminal?.version !== 1 || terminal.status !== "FINISHED" ||
      terminal.runId !== runId || terminal.configHash !== expectedConfigHash ||
      lock?.version !== 1 || lock.runId !== runId ||
      lock.configHash !== expectedConfigHash) {
    return failure("terminal_or_config_mismatch");
  }

  let source;
  try {
    source = await readReport(runPath);
  } catch {
    return failure("report_unavailable");
  }
  if (source?.status !== "AVAILABLE" || source.runStatus !== "FINISHED" ||
      source.report?.schema !== PAPER_REPORT_SCHEMA ||
      source.report?.experiment?.id !== runId ||
      source.report?.experiment?.reportStatus !== "FINISHED") {
    return failure("report_not_finished");
  }

  const envelope = canonicalTransferEnvelope(runId, expectedConfigHash, source.report);
  let body;
  try {
    body = Buffer.from(canonicalJson(envelope), "utf8");
  } catch {
    return failure("report_invalid");
  }
  if (body.length > PAPER_REPORT_MAX_BYTES) return failure("report_too_large");

  const controller = new AbortController();
  let timer;
  try {
    timer = schedule(() => controller.abort(), timeoutMs);
    if (timer === undefined || timer === null) return failure("deadline_unavailable");
    const response = await fetchImpl(`${origin}${PAPER_REPORT_UPLOAD_PATH}`, {
      method: "POST",
      headers: {
        authorization: "Bearer " + uploadToken,
        "content-type": "application/json",
        "content-length": String(body.length)
      },
      body,
      redirect: "error",
      signal: controller.signal
    });
    if (controller.signal.aborted) return failure("transfer_timeout");
    if (response?.status === 201 || response?.status === 200) {
      return {status: "TRANSFERRED", httpStatus: response.status};
    }
    if (response?.status === 409) return failure("report_conflict");
    return failure("gateway_rejected");
  } catch {
    return failure(controller.signal.aborted ? "transfer_timeout" : "transfer_unavailable");
  } finally {
    controller.abort();
    if (timer !== undefined && timer !== null) {
      try { cancelSchedule(timer); } catch { }
    }
  }
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === "--help") return {help: true};
  if (args.length !== 2 || args[0] !== "--run-id" ||
      typeof args[1] !== "string" || !SAFE_RUN_ID.test(args[1])) {
    throw new TypeError("usage: transfer.mjs --run-id <validated-run-id>");
  }
  return {runId: args[1]};
}

export async function main(args = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch {
    console.error("Paper report transfer rejected: invalid arguments");
    return 2;
  }
  if (parsed.help) {
    console.log("Usage: transfer.mjs --run-id <validated-run-id>");
    return 0;
  }
  const outcome = await transferPostRunReport({
    enabled: env.MERIDIAN_PAPER_REPORT_TRANSFER_ENABLED === "true",
    root: env.MERIDIAN_PAPER_REPORT_DATA_ROOT,
    runId: parsed.runId,
    expectedRunId: env.MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID,
    expectedConfigHash: env.MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256,
    gatewayOrigin: env.MERIDIAN_PAPER_REPORT_GATEWAY_ORIGIN,
    uploadToken: env.MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN
  });
  console.log(`Paper report transfer: ${outcome.status} (${outcome.reason ?? "ok"})`);
  return outcome.status === "TRANSFERRED" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
