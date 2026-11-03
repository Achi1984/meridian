import {createHash, randomBytes} from "node:crypto";
import {constants} from "node:fs";
import {chmod, link, lstat, mkdir, open, rm} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {evaluateMemecoinPaperRunExport} from "../memecoin-paper-simulated-evaluation/index.mjs";

export const TRANSFER_SCHEMA = "memecoin-paper-run-export-transfer/v1";
export const MAX_TRANSFER_BYTES = 16 * 1024 * 1024;
export const MAX_OPERATION_MS = 30_000;
export const MAX_STREAM_READS = 4096;

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const IDENTITY_FIELDS = ["runId", "configSha256", "producerRevision"];
const METADATA_FIELDS = ["schema", "identity", "exportSha256", "byteLength"];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length > 255) {
    throw new TypeError("private origin must be a fixed HTTPS origin");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("private origin must be a fixed HTTPS origin");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash) {
    throw new TypeError("private origin must be a fixed HTTPS origin");
  }
  return url.origin;
}

function normalizeIdentity(value) {
  if (!isRecord(value) ||
      Object.keys(value).sort().join(",") !== [...IDENTITY_FIELDS].sort().join(",")) {
    throw new TypeError("expected run, config, and producer identity");
  }
  const identity = {
    runId: value.runId,
    configSha256: value.configSha256,
    producerRevision: value.producerRevision
  };
  if (typeof identity.runId !== "string" || !SAFE_ID.test(identity.runId) ||
      typeof identity.configSha256 !== "string" || !HASH.test(identity.configSha256) ||
      typeof identity.producerRevision !== "string" || identity.producerRevision.length < 1 ||
      identity.producerRevision.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(identity.producerRevision)) {
    throw new TypeError("invalid run, config, or producer identity");
  }
  return identity;
}

function identityMatches(left, right) {
  return IDENTITY_FIELDS.every(key => left?.[key] === right?.[key]);
}

function deadlineError() {
  const error = new Error("operation deadline exceeded");
  error.code = "DEADLINE_EXCEEDED";
  return error;
}

function parseExport(bytes, expected) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
      bytes.byteLength > MAX_TRANSFER_BYTES) {
    throw new RangeError("export is empty or exceeds the 16 MiB transfer limit");
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch {
    throw new TypeError("export is not valid UTF-8 JSON");
  }
  if (!isRecord(value) || value.schemaVersion !== "memecoin-paper-run-export/v1" ||
      value.runId !== expected.runId || value.configSha256 !== expected.configSha256 ||
      value.producerRevision !== expected.producerRevision) {
    throw new TypeError("export identity does not match the independent expectation");
  }
  return value;
}

function checkOperation(signal, deadline, monotonicNow) {
  if (signal.aborted) throw signal.reason ?? new Error("operation aborted");
  if (monotonicNow() >= deadline) throw deadlineError();
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

async function nextWithAbort(iterator, signal, deadline, monotonicNow) {
  checkOperation(signal, deadline, monotonicNow);
  let abortListener;
  let deadlineTimer;
  const aborted = new Promise((resolve, reject) => {
    abortListener = () => reject(signal.reason ?? new Error("operation aborted"));
    signal.addEventListener("abort", abortListener, {once: true});
    if (signal.aborted) abortListener();
  });
  const deadlineExceeded = new Promise((resolve, reject) => {
    const remaining = deadline - monotonicNow();
    if (remaining <= 0) {
      reject(deadlineError());
      return;
    }
    deadlineTimer = setTimeout(() => reject(deadlineError()), remaining);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => iterator.next()),
      aborted,
      deadlineExceeded
    ]);
    checkOperation(signal, deadline, monotonicNow);
    return result;
  } finally {
    signal.removeEventListener("abort", abortListener);
    clearTimeout(deadlineTimer);
  }
}

async function collectBounded(source, signal, deadline, monotonicNow) {
  checkOperation(signal, deadline, monotonicNow);
  if (source instanceof Uint8Array) {
    if (source.byteLength === 0 || source.byteLength > MAX_TRANSFER_BYTES) {
      throw new RangeError("export is empty or exceeds the 16 MiB transfer limit");
    }
    return Buffer.from(source);
  }
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw new TypeError("export bytes must be a byte array or async byte stream");
  }
  const chunks = [];
  let length = 0;
  const iterator = source[Symbol.asyncIterator]();
  let reads = 0;
  try {
    while (true) {
      checkOperation(signal, deadline, monotonicNow);
      if (++reads > MAX_STREAM_READS) throw new RangeError("export stream exceeds the read limit");
      const {done, value} = await nextWithAbort(iterator, signal, deadline, monotonicNow);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("export stream yielded a non-byte chunk");
      length += value.byteLength;
      if (length > MAX_TRANSFER_BYTES) throw new RangeError("export exceeds the 16 MiB transfer limit");
      chunks.push(Buffer.from(value));
      if (reads % 64 === 0) {
        await yieldToEventLoop();
        checkOperation(signal, deadline, monotonicNow);
      }
    }
  } catch (error) {
    if (typeof iterator.return === "function") {
      try {
        Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        // Iterator cancellation is best-effort and must not extend operation time.
      }
    }
    throw error;
  }
  if (length === 0) throw new RangeError("export is empty");
  return Buffer.concat(chunks, length);
}

function boundedOperation(work, {timeoutMs, signal, monotonicNow}) {
  if (signal?.aborted) return Promise.resolve({stopped: true});
  const controller = new AbortController();
  const deadline = monotonicNow() + timeoutMs;
  let timer;
  let abortListener;
  const stopped = new Promise(resolve => {
    const stop = reason => {
      controller.abort(reason);
      resolve({stopped: true});
    };
    if (signal?.aborted) {
      stop(signal.reason ?? new Error("operation cancelled"));
      return;
    }
    if (signal) {
      abortListener = () => stop(signal.reason ?? new Error("operation cancelled"));
      signal.addEventListener("abort", abortListener, {once: true});
    }
    timer = setTimeout(() => stop(new Error("operation deadline exceeded")), timeoutMs);
  });
  const operation = Promise.resolve().then(() => work(controller.signal, deadline))
    .then(value => ({value}), error => ({
      stopped: controller.signal.aborted || monotonicNow() >= deadline ||
        error?.code === "DEADLINE_EXCEEDED",
      error
    }));
  return Promise.race([operation, stopped]).finally(() => {
    clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  });
}

function unknown(code) {
  return {status: "UNKNOWN", code};
}

function validAuthorization(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}

function validateAck(response, identity, exportSha256, byteLength) {
  return isRecord(response) && response.redirected === false &&
    ["STORED", "DUPLICATE"].includes(response.status) &&
    response.exportSha256 === exportSha256 && response.byteLength === byteLength &&
    identityMatches(response.identity, identity);
}

export function createExportTransfer({
  enabled = false,
  privateOrigin,
  transport,
  timeoutMs = 15_000,
  monotonicNow = () => performance.now()
} = {}) {
  if (typeof enabled !== "boolean") throw new TypeError("enabled must be boolean");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_OPERATION_MS) {
    throw new RangeError("operation deadline must be between 1 and 30000 ms");
  }
  if (typeof monotonicNow !== "function") throw new TypeError("monotonicNow must be a function");
  const origin = enabled ? normalizeOrigin(privateOrigin) : null;
  if (enabled && (!transport || typeof transport.put !== "function" ||
      typeof transport.get !== "function")) {
    throw new TypeError("enabled transfer requires an injected put/get transport");
  }
  let attempted = false;
  let targetIdentity = null;
  let targetExportSha256 = null;
  let targetByteLength = null;
  let writeAuthorizationDigest = null;

  return Object.freeze({
    async transfer({exportBytes, expected, writeAuthorization, explicitlyAuthorized = false, signal} = {}) {
      if (!enabled) return {status: "DISABLED"};
      if (attempted) return {status: "REJECTED", code: "ONE_SHOT_ALREADY_USED"};
      attempted = true;
      let identity;
      try {
        if (explicitlyAuthorized !== true) throw new TypeError("explicit one-shot authorization required");
        identity = normalizeIdentity(expected);
        if (!validAuthorization(writeAuthorization)) throw new TypeError("write authorization required");
        targetIdentity = identity;
        writeAuthorizationDigest = sha256(Buffer.from(writeAuthorization));
      } catch {
        return {status: "REJECTED", code: "INVALID_TRANSFER_REQUEST"};
      }

      const outcome = await boundedOperation(async (operationSignal, deadline) => {
        let bytes;
        try {
          bytes = await collectBounded(exportBytes, operationSignal, deadline, monotonicNow);
          parseExport(bytes, identity);
        } catch (error) {
          if (operationSignal.aborted || monotonicNow() >= deadline ||
              error?.code === "DEADLINE_EXCEEDED") throw error;
          return {invalid: true};
        }
        const exportSha256 = sha256(bytes);
        targetExportSha256 = exportSha256;
        targetByteLength = bytes.byteLength;
        try {
          const request = {
            schema: TRANSFER_SCHEMA,
            origin,
            identity,
            exportSha256,
            byteLength: bytes.byteLength,
            bytes,
            authorization: writeAuthorization,
            signal: operationSignal
          };
          const put = transport.put;
          checkOperation(operationSignal, deadline, monotonicNow);
          const response = await put.call(transport, request);
          return {response, exportSha256, byteLength: bytes.byteLength};
        } catch (error) {
          if (operationSignal.aborted || error?.code === "DEADLINE_EXCEEDED") throw error;
          return {transportError: true};
        }
      }, {timeoutMs, signal, monotonicNow});
      if (outcome.stopped) return unknown(signal?.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED");
      if (outcome.error) return unknown("WRITE_OUTCOME_UNKNOWN");
      if (outcome.value.invalid) return {status: "REJECTED", code: "INVALID_EXPORT"};
      if (outcome.value.transportError) return unknown("WRITE_OUTCOME_UNKNOWN");
      const {response, exportSha256, byteLength} = outcome.value;
      if (response?.redirected === true) return unknown("REDIRECT_REJECTED");
      if (response?.status === "REJECTED") return {status: "REJECTED", code: "WRITE_REJECTED"};
      if (response?.status === "CONFLICT") return {status: "REJECTED", code: "EXPORT_CONFLICT"};
      if (response?.status === "UNKNOWN") return unknown("WRITE_OUTCOME_UNKNOWN");
      if (!validateAck(response, identity, exportSha256, byteLength)) return unknown("WRITE_ACK_UNKNOWN");
      return {
        status: "TRANSFER_ACKNOWLEDGED",
        identity,
        exportSha256,
        byteLength,
        checkpointAcknowledged: false
      };
    },

    async readback({expected, readAuthorization, signal} = {}) {
      if (!enabled) return {status: "DISABLED"};
      let identity;
      try {
        identity = normalizeIdentity(expected);
        if (!attempted || !targetIdentity || !identityMatches(identity, targetIdentity) ||
            !targetExportSha256 || !Number.isSafeInteger(targetByteLength) ||
            !validAuthorization(readAuthorization) ||
            sha256(Buffer.from(readAuthorization)) === writeAuthorizationDigest) {
          throw new TypeError("separate read authorization and matching transfer identity required");
        }
      } catch {
        return {status: "REJECTED", code: "INVALID_READ_REQUEST"};
      }
      const outcome = await boundedOperation(async (operationSignal, deadline) => {
        let response;
        try {
          const request = {
            schema: TRANSFER_SCHEMA,
            origin,
            identity,
            authorization: readAuthorization,
            signal: operationSignal
          };
          const get = transport.get;
          checkOperation(operationSignal, deadline, monotonicNow);
          response = await get.call(transport, request);
        } catch (error) {
          if (operationSignal.aborted || error?.code === "DEADLINE_EXCEEDED") throw error;
          return {transportError: true};
        }
        if (response?.status !== "FOUND") return {response};
        try {
          const bytes = await collectBounded(response.bytes, operationSignal, deadline, monotonicNow);
          const downloadedSha256 = sha256(bytes);
          if (!identityMatches(response.identity, identity) || response.byteLength !== bytes.byteLength ||
              !HASH.test(response.exportSha256) || response.exportSha256 !== targetExportSha256 ||
              response.byteLength !== targetByteLength || downloadedSha256 !== response.exportSha256 ||
              downloadedSha256 !== targetExportSha256 || bytes.byteLength !== targetByteLength) {
            return {response, invalid: true};
          }
          const exportValue = parseExport(bytes, identity);
          const evaluation = evaluateMemecoinPaperRunExport(bytes, identity);
          return {response, bytes, exportValue, evaluation};
        } catch (error) {
          if (operationSignal.aborted || monotonicNow() >= deadline ||
              error?.code === "DEADLINE_EXCEEDED") throw error;
          return {response, invalid: true};
        }
      }, {timeoutMs, signal, monotonicNow});
      if (outcome.stopped) return unknown(signal?.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED");
      if (outcome.error) return unknown("READ_OUTCOME_UNKNOWN");
      if (outcome.value.transportError) return unknown("READ_OUTCOME_UNKNOWN");
      const response = outcome.value.response;
      if (response?.redirected === true) return unknown("REDIRECT_REJECTED");
      if (response?.status === "REJECTED") return {status: "REJECTED", code: "READ_REJECTED"};
      if (response?.status === "NOT_FOUND") return unknown("EXPORT_NOT_FOUND");
      if (response?.status !== "FOUND" || response.redirected !== false) {
        return unknown("READBACK_UNKNOWN");
      }
      if (outcome.value.invalid) return {status: "REJECTED", code: "READBACK_DIGEST_OR_IDENTITY_MISMATCH"};
      return {
        status: "READ_BACK",
        identity,
        exportSha256: response.exportSha256,
        byteLength: outcome.value.bytes.byteLength,
        bytes: Buffer.from(outcome.value.bytes),
        exportValue: outcome.value.exportValue,
        evaluation: outcome.value.evaluation
      };
    }
  });
}

function runDirectory(runId) {
  return sha256(Buffer.from(runId, "utf8"));
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, {recursive: true, mode: 0o700});
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("receiver storage must be a directory");
  await chmod(directory, 0o700);
}

async function readFileBounded(filename, maxBytes) {
  let handle;
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      return {status: "INVALID"};
    }
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size > maxBytes) return {status: "INVALID"};
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const {bytesRead} = await handle.read(buffer, length, Math.min(64 * 1024, buffer.byteLength - length), length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return length <= maxBytes ? {status: "OK", bytes: buffer.subarray(0, length)} : {status: "INVALID"};
  } catch (error) {
    return error.code === "ENOENT" ? {status: "ABSENT"} : {status: "INVALID"};
  } finally {
    await handle?.close().catch(() => {});
  }
}

function storedMetadata(identity, exportSha256, byteLength) {
  return {schema: TRANSFER_SCHEMA, identity, exportSha256, byteLength};
}

function validMetadata(value) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...METADATA_FIELDS].sort().join(",") &&
    value.schema === TRANSFER_SCHEMA && normalizeIdentity(value.identity) &&
    HASH.test(value.exportSha256) &&
    Number.isSafeInteger(value.byteLength) && value.byteLength > 0 &&
    value.byteLength <= MAX_TRANSFER_BYTES;
}

async function readStored(directory, identity) {
  const runPath = path.join(directory, runDirectory(identity.runId));
  try {
    const stat = await lstat(runPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return {status: "UNKNOWN"};
  } catch (error) {
    return error.code === "ENOENT" ? {status: "NOT_FOUND"} : {status: "UNKNOWN"};
  }
  const metadataRead = await readFileBounded(path.join(runPath, "metadata.json"), 4096);
  const bytesRead = await readFileBounded(path.join(runPath, "export.json"), MAX_TRANSFER_BYTES);
  if (metadataRead.status === "ABSENT" && bytesRead.status === "ABSENT") return {status: "NOT_FOUND"};
  if (metadataRead.status !== "OK" || bytesRead.status !== "OK") return {status: "UNKNOWN"};
  try {
    const metadata = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(metadataRead.bytes));
    if (!validMetadata(metadata) || metadata.identity.runId !== identity.runId ||
        metadata.byteLength !== bytesRead.bytes.byteLength ||
        sha256(bytesRead.bytes) !== metadata.exportSha256) return {status: "UNKNOWN"};
    return {status: "FOUND", metadata, bytes: bytesRead.bytes};
  } catch {
    return {status: "UNKNOWN"};
  }
}

async function writeSyncedFile(filename, bytes, signal) {
  const handle = await open(filename, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      if (signal?.aborted) throw signal.reason ?? new Error("operation aborted");
      const {bytesWritten} = await handle.write(bytes, offset, Math.min(64 * 1024, bytes.byteLength - offset));
      if (bytesWritten <= 0) throw new Error("storage write made no progress");
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function createFileReceiver({
  directory,
  privateOrigin,
  authorizeWrite,
  authorizeRead
} = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new TypeError("receiver storage directory must be absolute");
  }
  const root = path.resolve(directory);
  const origin = normalizeOrigin(privateOrigin);
  if (typeof authorizeWrite !== "function" || typeof authorizeRead !== "function") {
    throw new TypeError("separate write and read authorizers are required");
  }

  return Object.freeze({
    async put(request) {
      try {
        if (!isRecord(request) || request.schema !== TRANSFER_SCHEMA || request.origin !== origin ||
            !validAuthorization(request.authorization) || request.byteLength !== request.bytes?.byteLength ||
            !HASH.test(request.exportSha256)) return {status: "REJECTED", redirected: false};
        const identity = normalizeIdentity(request.identity);
        if (await authorizeWrite(request.authorization, identity) !== true) {
          return {status: "REJECTED", redirected: false};
        }
        const bytes = await collectBounded(
          request.bytes,
          request.signal ?? new AbortController().signal,
          performance.now() + MAX_OPERATION_MS,
          () => performance.now()
        );
        const exportValue = parseExport(bytes, identity);
        const exportSha256 = sha256(bytes);
        if (!identityMatches({
          runId: exportValue.runId,
          configSha256: exportValue.configSha256,
          producerRevision: exportValue.producerRevision
        }, identity) || bytes.byteLength !== request.byteLength || exportSha256 !== request.exportSha256) {
          return {status: "REJECTED", redirected: false};
        }
        await ensurePrivateDirectory(root);
        const existing = await readStored(root, identity);
        if (existing.status === "FOUND") {
          const same = existing.metadata.exportSha256 === exportSha256 &&
            existing.metadata.byteLength === bytes.byteLength &&
            identityMatches(existing.metadata.identity, identity);
          return {
            status: same ? "DUPLICATE" : "CONFLICT",
            identity: existing.metadata.identity,
            exportSha256: existing.metadata.exportSha256,
            byteLength: existing.metadata.byteLength,
            redirected: false
          };
        }
        if (existing.status !== "NOT_FOUND") return {status: "UNKNOWN", redirected: false};

        const stage = path.join(root, `.stage-${randomBytes(16).toString("hex")}`);
        const target = path.join(root, runDirectory(identity.runId));
        await mkdir(stage, {mode: 0o700});
        try {
          await writeSyncedFile(path.join(stage, "export.json"), bytes, request.signal);
          const metadata = storedMetadata(identity, exportSha256, bytes.byteLength);
          await writeSyncedFile(path.join(stage, "metadata.json"), Buffer.from(JSON.stringify(metadata)), request.signal);
          await syncDirectory(stage);
          if (request.signal?.aborted) return {status: "UNKNOWN", redirected: false};
          try {
            await mkdir(target, {mode: 0o700});
          } catch (error) {
            if (error.code === "EEXIST" || error.code === "ENOTEMPTY") {
              const raced = await readStored(root, identity);
              if (raced.status !== "FOUND") return {status: "UNKNOWN", redirected: false};
              const same = raced.metadata.exportSha256 === exportSha256 &&
                raced.metadata.byteLength === bytes.byteLength;
              return {
                status: same ? "DUPLICATE" : "CONFLICT",
                identity: raced.metadata.identity,
                exportSha256: raced.metadata.exportSha256,
                byteLength: raced.metadata.byteLength,
                redirected: false
              };
            }
            throw error;
          }
          await link(path.join(stage, "export.json"), path.join(target, "export.json"));
          await link(path.join(stage, "metadata.json"), path.join(target, "metadata.json"));
          await syncDirectory(target);
          await syncDirectory(root);
          return {
            status: "STORED",
            identity,
            exportSha256,
            byteLength: bytes.byteLength,
            redirected: false
          };
        } finally {
          await rm(stage, {recursive: true, force: true});
        }
      } catch (error) {
        return {
          status: error instanceof TypeError || error instanceof RangeError ? "REJECTED" : "UNKNOWN",
          redirected: false
        };
      }
    },

    async get(request) {
      try {
        if (!isRecord(request) || request.schema !== TRANSFER_SCHEMA || request.origin !== origin ||
            !validAuthorization(request.authorization)) return {status: "REJECTED", redirected: false};
        const identity = normalizeIdentity(request.identity);
        if (await authorizeRead(request.authorization, identity) !== true) {
          return {status: "REJECTED", redirected: false};
        }
        await ensurePrivateDirectory(root);
        const stored = await readStored(root, identity);
        if (stored.status === "NOT_FOUND") return {status: "NOT_FOUND", redirected: false};
        if (stored.status !== "FOUND") return {status: "UNKNOWN", redirected: false};
        if (!identityMatches(stored.metadata.identity, identity)) {
          return {status: "UNKNOWN", redirected: false};
        }
        return {
          status: "FOUND",
          identity: stored.metadata.identity,
          exportSha256: stored.metadata.exportSha256,
          byteLength: stored.metadata.byteLength,
          bytes: stored.bytes,
          redirected: false
        };
      } catch {
        return {status: "UNKNOWN", redirected: false};
      }
    }
  });
}

export function createInProcessTransport(receiver) {
  if (!receiver || typeof receiver.put !== "function" || typeof receiver.get !== "function") {
    throw new TypeError("receiver must implement put/get");
  }
  return Object.freeze({
    put: request => receiver.put(request),
    get: request => receiver.get(request)
  });
}
