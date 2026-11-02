import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat, open} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {canonicalJson} from "../memecoin-paper/pilot-online.mjs";
import {
  PAPER_REPORT_SCHEMA
} from "../memecoin-paper-report-bridge/contract.mjs";

export const PAPER_REPORT_TRANSFER_SCHEMA = "MEMECOIN_PAPER_REPORT_TRANSFER_ENVELOPE_V1";
export const PAPER_REPORT_UPLOAD_PATH = "/api/private/paper-report/upload";
export const PAPER_REPORT_MAX_BYTES = 256 * 1024;
export const PAPER_REPORT_TIMEOUT_MS = 10_000;
export const PAPER_REPORT_RECEIPT_MAX_BYTES = 2_048;

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 16 * 1024;
const PROC_FD = "/proc/self/fd";
let activeTransfer = null;

function failure(reason) {
  return {status: "REJECTED", reason};
}

function unknown(reason) {
  return {status: "UNKNOWN", reason};
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareStat(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev &&
    left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function descriptorPath(directoryHandle, name) {
  return `${PROC_FD}/${directoryHandle.fd}/${name}`;
}

function secureOpenFlags(directory = false) {
  if (process.platform !== "linux" || !constants.O_NOFOLLOW ||
      !constants.O_DIRECTORY || (!directory && !constants.O_NONBLOCK)) {
    throw new Error("secure_directory_handles_unavailable");
  }
  return constants.O_RDONLY | constants.O_NOFOLLOW |
    (directory ? constants.O_DIRECTORY : constants.O_NONBLOCK);
}

async function openDirectoryPath(root) {
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new TypeError("invalid_data_root");
  }
  const absolute = path.resolve(root);
  const directoryFlags = secureOpenFlags(true);
  let directory = await open(path.parse(absolute).root, directoryFlags);
  try {
    const components = absolute.slice(path.parse(absolute).root.length)
      .split(path.sep).filter(Boolean);
    for (const component of components) {
      const next = await open(descriptorPath(directory, component), directoryFlags);
      await directory.close();
      directory = next;
    }
    if (!(await directory.stat()).isDirectory()) throw new TypeError("unsafe_data_root");
    const result = directory;
    directory = null;
    return result;
  } finally {
    await directory?.close().catch(() => {});
  }
}

async function openDirectoryAt(parent, name) {
  const handle = await open(descriptorPath(parent, name), secureOpenFlags(true));
  if (!(await handle.stat()).isDirectory()) {
    await handle.close();
    throw new TypeError("unsafe_run_directory");
  }
  return handle;
}

async function readFileSnapshot(directory, name, maximum) {
  const filename = descriptorPath(directory, name);
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size > maximum) {
    throw new TypeError("unsafe_run_file");
  }
  const handle = await open(filename, secureOpenFlags());
  try {
    const opened = await handle.stat();
    if (!compareStat(before, opened) || opened.size > maximum) {
      throw new TypeError("run_file_changed_during_open");
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(16 * 1024, maximum + 1 - size));
      const {bytesRead} = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > maximum) throw new RangeError("run_file_too_large");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const current = await lstat(filename);
    if (!compareStat(opened, after) || !compareStat(after, current)) {
      throw new TypeError("run_file_changed_during_read");
    }
    return {name, bytes: Buffer.concat(chunks, size), handle, stat: after};
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function captureRunFiles(runDirectory) {
  const files = [];
  try {
    for (const [name, maximum] of [
      ["run.lock", MAX_STATE_BYTES],
      ["terminal.json", MAX_STATE_BYTES],
      ["run-config.json", MAX_CONFIG_BYTES],
      ["operator-report.json", PAPER_REPORT_MAX_BYTES]
    ]) {
      files.push(await readFileSnapshot(runDirectory, name, maximum));
    }
    return files;
  } catch (error) {
    await Promise.all(files.map(file => file.handle.close().catch(() => {})));
    throw error;
  }
}

async function verifyRunSnapshot(rootPath, root, runId, runDirectory, files) {
  const namedRoot = await openDirectoryPath(rootPath);
  let openedRootStat;
  let namedRootStat;
  try {
    openedRootStat = await root.stat();
    namedRootStat = await namedRoot.stat();
  } finally {
    await namedRoot.close();
  }
  if (openedRootStat.dev !== namedRootStat.dev || openedRootStat.ino !== namedRootStat.ino) {
    throw new TypeError("data_root_changed");
  }
  const openedRun = await runDirectory.stat();
  const currentRun = await lstat(descriptorPath(root, runId));
  if (!openedRun.isDirectory() || currentRun.isSymbolicLink() ||
      !currentRun.isDirectory() || openedRun.dev !== currentRun.dev ||
      openedRun.ino !== currentRun.ino) {
    throw new TypeError("run_directory_changed");
  }
  for (const file of files) {
    const opened = await file.handle.stat();
    const current = await lstat(descriptorPath(runDirectory, file.name));
    if (!compareStat(file.stat, opened) || !compareStat(opened, current)) {
      throw new TypeError("run_file_changed");
    }
  }
}

function parseCanonicalSnapshot(file) {
  const text = new TextDecoder("utf-8", {fatal: true}).decode(file.bytes);
  const value = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new TypeError("run_file_not_canonical");
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readReportSnapshot(file, status) {
  const record = parseCanonicalSnapshot(file);
  const accounting = record.observation?.providerAccounting;
  if (record.runId !== status.runId || record.configHash !== status.configHash ||
      !isRecord(record.dto) || !isRecord(record.dto.experiment) ||
      record.dto.experiment.source !== "READ_ONLY_PAPER_CHECKPOINT" ||
      record.dto.experiment.evidenceKind !== "READ_ONLY_PAPER_CHECKPOINT_RECEIPTS" ||
      record.dto.experiment.sourceProvenance !== "CALLER_LABEL_ONLY_NOT_AUTHENTICATED" ||
      !isRecord(accounting) || !isRecord(status.providerAccounting) ||
      canonicalJson(accounting) !== canonicalJson(status.providerAccounting) ||
      !isRecord(record.observation) ||
      record.observation.entryAuthorizations !== 0 ||
      record.observation.simulatedFills !== 0 ||
      record.observation.executableQuoteAndCostEvidence !== "UNAVAILABLE") {
    return {status: "UNKNOWN", reason: "report failed its provenance or durable identity contract"};
  }
  return {
    status: "AVAILABLE",
    runStatus: status.status,
    report: record.dto,
    observation: record.observation,
    text: record.text
  };
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
  readStatus,
  readReport,
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
  if (activeTransfer) return failure("transfer_busy");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > PAPER_REPORT_TIMEOUT_MS || typeof fetchImpl !== "function" ||
      typeof now !== "function" || typeof schedule !== "function" ||
      typeof cancelSchedule !== "function") return failure("transfer_configuration_invalid");

  const owner = {};
  activeTransfer = owner;
  const controller = new AbortController();
  let timeoutResolve;
  let timedOut = false;
  let timer;
  const deadline = new Promise(resolve => { timeoutResolve = resolve; });
  try {
    timer = schedule(() => {
      timedOut = true;
      controller.abort();
      timeoutResolve(unknown("transfer_outcome_unknown"));
    }, timeoutMs);
  } catch {
    if (activeTransfer === owner) activeTransfer = null;
    return failure("deadline_unavailable");
  }
  if (timer === undefined || timer === null) {
    if (activeTransfer === owner) activeTransfer = null;
    return failure("deadline_unavailable");
  }

  const operation = (async () => {
    let rootHandle;
    let runDirectory;
    let files = [];
    try {
      if (timedOut) return unknown("transfer_outcome_unknown");
      try {
        rootHandle = await openDirectoryPath(root);
        runDirectory = await openDirectoryAt(rootHandle, runId);
        files = await captureRunFiles(runDirectory);
      } catch {
        return timedOut ? unknown("transfer_outcome_unknown") :
          failure("run_directory_unsafe_or_missing");
      }
      if (timedOut) return unknown("transfer_outcome_unknown");

      const byName = new Map(files.map(file => [file.name, file]));
      let config;
      let lock;
      let terminal;
      try {
        config = parseCanonicalSnapshot(byName.get("run-config.json"));
        lock = parseCanonicalSnapshot(byName.get("run.lock"));
        terminal = parseCanonicalSnapshot(byName.get("terminal.json"));
      } catch {
        return failure("run_state_unavailable");
      }
      if (timedOut) return unknown("transfer_outcome_unknown");
      const configHash = sha256(byName.get("run-config.json").bytes);
      if (configHash !== expectedConfigHash || config?.runId !== runId ||
          config?.mode !== "READ_ONLY_PAPER" || lock?.version !== 1 ||
          lock.runId !== runId || lock.configHash !== expectedConfigHash ||
          terminal?.version !== 1 || terminal.status !== "FINISHED" ||
          terminal.runId !== runId || terminal.configHash !== expectedConfigHash) {
        return failure("terminal_or_config_mismatch");
      }

      const runPath = path.resolve(root, runId);
      let status = terminal;
      if (typeof readStatus === "function") {
        try {
          status = await readStatus(runPath);
        } catch {
          return timedOut ? unknown("transfer_outcome_unknown") :
            failure("run_state_unavailable");
        }
      }
      if (timedOut) return unknown("transfer_outcome_unknown");
      if (status?.status !== "FINISHED" || status.runId !== runId ||
          status.configHash !== expectedConfigHash) {
        return failure("terminal_or_config_mismatch");
      }

      let source;
      try {
        source = typeof readReport === "function" ? await readReport(runPath) :
          readReportSnapshot(byName.get("operator-report.json"), status);
      } catch {
        return timedOut ? unknown("transfer_outcome_unknown") : failure("report_unavailable");
      }
      if (timedOut) return unknown("transfer_outcome_unknown");
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
      const expectedDigest = sha256(body);

      if (timedOut) return unknown("transfer_outcome_unknown");
      try {
        await verifyRunSnapshot(root, rootHandle, runId, runDirectory, files);
      } catch {
        return failure("run_snapshot_changed");
      }
      if (timedOut) return unknown("transfer_outcome_unknown");
      try {
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
        if (timedOut || controller.signal.aborted) {
          await cancelResponseBody(response);
          return unknown("transfer_outcome_unknown");
        }
        if (response?.status === 409) {
          await cancelResponseBody(response);
          return failure("report_conflict");
        }
        if (response?.status !== 200 && response?.status !== 201) {
          await cancelResponseBody(response);
          if (response?.status >= 500) return unknown("gateway_outcome_unknown");
          return failure("gateway_rejected");
        }
        let receipt;
        try {
          receipt = await readBoundedReceipt(response, {
            signal: controller.signal,
            runId,
            configHash: expectedConfigHash,
            digest: expectedDigest
          });
        } catch {
          return unknown(timedOut ? "transfer_outcome_unknown" : "upload_receipt_unverified");
        }
        if (timedOut || controller.signal.aborted) return unknown("transfer_outcome_unknown");
        if (!receipt) return unknown("upload_receipt_unverified");
        const expectedIdempotent = response.status === 200;
        if (receipt.ok !== true || receipt.runId !== runId ||
            receipt.configHash !== expectedConfigHash || receipt.digest !== expectedDigest ||
            receipt.idempotent !== expectedIdempotent) {
          return unknown("upload_receipt_unverified");
        }
        return {status: "TRANSFERRED", httpStatus: response.status, digest: expectedDigest};
      } catch {
        return unknown(timedOut ? "transfer_outcome_unknown" : "transfer_unavailable");
      }
    } finally {
      await Promise.all(files.map(file => file.handle.close().catch(() => {})));
      await runDirectory?.close().catch(() => {});
      await rootHandle?.close().catch(() => {});
    }
  })().catch(() => unknown(timedOut ? "transfer_outcome_unknown" : "transfer_unavailable"));

  owner.settlement = operation.finally(() => {
    if (activeTransfer === owner) activeTransfer = null;
  });
  try {
    return await Promise.race([owner.settlement, deadline]);
  } finally {
    try { cancelSchedule(timer); } catch { }
  }
}

async function cancelResponseBody(response) {
  const body = response?.body;
  if (!body) return;
  let reader;
  try {
    if (typeof body.getReader === "function") {
      reader = body.getReader();
      await reader.cancel();
    } else if (typeof body.cancel === "function") {
      await body.cancel();
    }
  } catch {
  } finally {
    try { reader?.releaseLock(); } catch { }
  }
}

async function readBoundedReceipt(response, {signal, runId, configHash, digest}) {
  const body = response?.body;
  if (!body || typeof body.getReader !== "function") {
    await cancelResponseBody(response);
    return null;
  }
  const contentType = response.headers?.get?.("content-type") ?? "";
  const contentLength = response.headers?.get?.("content-length");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
      (contentLength !== null && contentLength !== undefined &&
        (!/^(0|[1-9]\d*)$/.test(contentLength) ||
          Number(contentLength) > PAPER_REPORT_RECEIPT_MAX_BYTES))) {
    await cancelResponseBody(response);
    return null;
  }

  let reader;
  let abort;
  let cancelled;
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    reader = body.getReader();
    abort = () => {
      cancelReader();
    };
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) abort();
    while (true) {
      if (signal.aborted) return null;
      const next = await reader.read();
      if (signal.aborted) return null;
      if (next.done) {
        complete = true;
        break;
      }
      if (!(next.value instanceof Uint8Array)) return null;
      if (next.value.byteLength === 0) continue;
      size += next.value.byteLength;
      if (size > PAPER_REPORT_RECEIPT_MAX_BYTES) return null;
      chunks.push(next.value);
    }
    if (contentLength !== null && contentLength !== undefined &&
        Number(contentLength) !== size) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let receipt;
    try {
      receipt = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch {
      return null;
    }
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
        Object.keys(receipt).sort().join(",") !== "configHash,digest,idempotent,ok,runId" ||
        receipt.runId !== runId || receipt.configHash !== configHash ||
        receipt.digest !== digest || typeof receipt.idempotent !== "boolean" ||
        receipt.ok !== true) return null;
    return receipt;
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
    if (!complete) cancelReader();
    if (cancelled) await cancelled;
    try { reader?.releaseLock(); } catch { }
  }

  function cancelReader() {
    if (cancelled) return cancelled;
    try {
      cancelled = Promise.resolve(reader?.cancel()).catch(() => {});
    } catch {
      cancelled = Promise.resolve();
    }
    return cancelled;
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
