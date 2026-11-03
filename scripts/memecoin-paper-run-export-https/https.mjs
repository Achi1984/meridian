import {createHash} from "node:crypto";
import https from "node:https";
import {performance} from "node:perf_hooks";
import {evaluateMemecoinPaperRunExport} from "../memecoin-paper-simulated-evaluation/index.mjs";
import {
  MAX_OPERATION_MS,
  MAX_STREAM_READS,
  MAX_TRANSFER_BYTES,
  TRANSFER_SCHEMA
} from "../memecoin-paper-run-export-transfer/index.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_HEADER_COUNT = 64;

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
  if (!isRecord(value) || Object.keys(value).sort().join(",") !==
      "configSha256,producerRevision,runId") {
    throw new TypeError("expected run, config, and producer identity");
  }
  const identity = {
    runId: value.runId,
    configSha256: value.configSha256,
    producerRevision: value.producerRevision
  };
  if (typeof identity.runId !== "string" || !SAFE_ID.test(identity.runId) ||
      typeof identity.configSha256 !== "string" || !HASH.test(identity.configSha256) ||
      typeof identity.producerRevision !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(identity.producerRevision)) {
    throw new TypeError("invalid run, config, or producer identity");
  }
  return identity;
}

function identityMatches(left, right) {
  return left?.runId === right.runId && left?.configSha256 === right.configSha256 &&
    left?.producerRevision === right.producerRevision;
}

function validAuthorization(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !/[\r\n]/.test(value);
}

function routePath(runId) {
  if (!SAFE_ID.test(runId)) throw new TypeError("invalid run ID");
  return `/private/run-exports/v1/${encodeURIComponent(runId)}`;
}

function headerSizeIsBounded(rawHeaders) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length > MAX_HEADER_COUNT * 2) return false;
  let size = 0;
  for (const value of rawHeaders) {
    if (typeof value !== "string") return false;
    size += Buffer.byteLength(value);
    if (size > MAX_HEADER_BYTES) return false;
  }
  return true;
}

function singleHeader(rawHeaders, name) {
  const matches = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === name) matches.push(rawHeaders[index + 1]);
  }
  if (matches.length !== 1) return null;
  return matches[0];
}

function integerHeader(value, maximum = MAX_TRANSFER_BYTES) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function responseHeader(response, name) {
  return singleHeader(response.rawHeaders ?? [], name);
}

function requestHeaders({identity, authorization, exportSha256, byteLength}) {
  if (!validAuthorization(authorization)) throw new TypeError("authorization is required");
  return {
    authorization: "Bearer " + authorization,
    "x-paper-transfer-schema": TRANSFER_SCHEMA,
    "x-paper-run-id": identity.runId,
    "x-paper-config-sha256": identity.configSha256,
    "x-paper-producer-revision": identity.producerRevision,
    ...(exportSha256 ? {"x-paper-export-sha256": exportSha256} : {}),
    ...(byteLength !== undefined ? {"x-paper-byte-length": String(byteLength)} : {})
  };
}

function openHttpsResponse({url, method, headers, body, ca, signal}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("request cancelled"));
      return;
    }
    const request = https.request(url, {
      method,
      headers,
      maxHeaderSize: MAX_HEADER_BYTES,
      rejectUnauthorized: true,
      ...(ca ? {ca} : {})
    });
    let response;
    let requestFinished = false;
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const resolveIfComplete = () => {
      if (!response || !requestFinished || settled) return;
      settled = true;
      resolve({request, response, cleanup});
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      request.destroy();
      response?.destroy();
      reject(error);
    };
    const onAbort = () => {
      const error = signal.reason ?? new Error("request cancelled");
      request.destroy(error);
      response?.destroy(error);
      fail(error);
    };
    signal?.addEventListener("abort", onAbort, {once: true});
    request.once("error", fail);
    request.once("finish", () => {
      requestFinished = true;
      resolveIfComplete();
    });
    request.once("response", incoming => {
      response = incoming;
      if (!headerSizeIsBounded(incoming.rawHeaders)) {
        fail(new Error("response headers exceed their bound"));
        return;
      }
      resolveIfComplete();
    });
    if (body === undefined) {
      request.end();
      return;
    }
    let offset = 0;
    const writeNext = () => {
      if (signal?.aborted) return onAbort();
      while (offset < body.byteLength) {
        const end = Math.min(offset + 64 * 1024, body.byteLength);
        const chunk = body.subarray(offset, end);
        offset = end;
        if (!request.write(chunk)) {
          request.once("drain", writeNext);
          return;
        }
      }
      request.end();
    };
    writeNext();
  });
}

async function readSmallBody(response, limit, signal) {
  const declared = responseHeader(response, "content-length");
  if (declared !== null && integerHeader(declared, limit) === null) {
    throw new Error("HTTP response body exceeds its bound");
  }
  const chunks = [];
  let length = 0;
  let reads = 0;
  for await (const chunk of response) {
    if (signal?.aborted) throw signal.reason ?? new Error("request cancelled");
    if (++reads > MAX_STREAM_READS || !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      throw new Error("HTTP response stream is invalid");
    }
    length += chunk.byteLength;
    if (length > limit) throw new Error("HTTP response body exceeds its bound");
    chunks.push(Buffer.from(chunk));
  }
  if (declared !== null && Number(declared) !== length) {
    throw new Error("HTTP response length does not match its header");
  }
  return Buffer.concat(chunks, length);
}

function streamResponse(response, request, cleanup) {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        let reads = 0;
        for await (const chunk of response) {
          if (++reads > MAX_STREAM_READS) throw new Error("HTTP response stream exceeds its read bound");
          yield chunk;
        }
      } finally {
        cleanup();
        if (!response.complete) {
          const error = new Error("response body consumption stopped");
          response.destroy(error);
          request.destroy(error);
        }
      }
    }
  };
}

function parsePutAcknowledgement(body) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(body));
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.status !== "string" ||
      !isRecord(value.identity) || !HASH.test(value.exportSha256) ||
      !Number.isSafeInteger(value.byteLength)) return null;
  return value;
}

export function createHttpsExportTransport({privateOrigin, ca} = {}) {
  const origin = normalizeOrigin(privateOrigin);
  if (ca !== undefined && typeof ca !== "string" && !Buffer.isBuffer(ca) &&
      !(Array.isArray(ca) && ca.every(item => typeof item === "string" || Buffer.isBuffer(item)))) {
    throw new TypeError("test or private CA must be PEM data");
  }
  let lastWrite = null;
  const base = new URL(origin);

  return Object.freeze({
    async put(request) {
      let cleanup = () => {};
      let outgoing;
      let response;
      try {
        const identity = normalizeIdentity(request.identity);
        if (request.schema !== TRANSFER_SCHEMA || request.origin !== origin ||
            !(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0 ||
            request.bytes.byteLength > MAX_TRANSFER_BYTES ||
            request.byteLength !== request.bytes.byteLength || !HASH.test(request.exportSha256)) {
          return {status: "REJECTED", redirected: false};
        }
        lastWrite = {
          identity,
          exportSha256: request.exportSha256,
          byteLength: request.byteLength
        };
        const url = new URL(routePath(identity.runId), base);
        const headers = requestHeaders({...request, identity});
        headers["content-type"] = "application/octet-stream";
        headers["content-length"] = String(request.byteLength);
        const opened = await openHttpsResponse({
          url, method: "PUT", headers, body: Buffer.from(request.bytes), ca, signal: request.signal
        });
        outgoing = opened.request;
        response = opened.response;
        cleanup = opened.cleanup;
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.destroy();
          outgoing.destroy();
          cleanup();
          return {status: "UNKNOWN", redirected: true};
        }
        if (response.statusCode === 401 || response.statusCode === 403) {
          response.destroy();
          cleanup();
          return {status: "REJECTED", redirected: false};
        }
        if (response.statusCode === 409) {
          response.destroy();
          cleanup();
          return {status: "CONFLICT", redirected: false};
        }
        if (response.statusCode !== 200 && response.statusCode !== 201) {
          response.destroy();
          cleanup();
          return {status: "UNKNOWN", redirected: false};
        }
        const body = await readSmallBody(response, 4096, request.signal);
        cleanup();
        const acknowledgement = parsePutAcknowledgement(body);
        if (!acknowledgement) return {status: "UNKNOWN", redirected: false};
        return {...acknowledgement, redirected: false};
      } catch {
        response?.destroy();
        outgoing?.destroy();
        cleanup();
        return {status: "UNKNOWN", redirected: false};
      }
    },

    async get(request) {
      try {
        const identity = normalizeIdentity(request.identity);
        const binding = request.expectedExportSha256 && request.expectedByteLength !== undefined
          ? {identity, exportSha256: request.expectedExportSha256, byteLength: request.expectedByteLength}
          : lastWrite;
        if (request.schema !== TRANSFER_SCHEMA || request.origin !== origin ||
            !validAuthorization(request.authorization) || !binding ||
            !identityMatches(binding.identity, identity) || !HASH.test(binding.exportSha256) ||
            !Number.isSafeInteger(binding.byteLength) || binding.byteLength < 1 ||
            binding.byteLength > MAX_TRANSFER_BYTES) {
          return {status: "REJECTED", redirected: false};
        }
        const url = new URL(routePath(identity.runId), base);
        const headers = requestHeaders({
          identity,
          authorization: request.authorization,
          exportSha256: binding.exportSha256,
          byteLength: binding.byteLength
        });
        const {request: outgoing, response, cleanup} = await openHttpsResponse({
          url, method: "GET", headers, ca, signal: request.signal
        });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.destroy();
          outgoing.destroy();
          cleanup();
          return {status: "UNKNOWN", redirected: true};
        }
        if (response.statusCode === 401 || response.statusCode === 403) {
          response.destroy();
          cleanup();
          return {status: "REJECTED", redirected: false};
        }
        if (response.statusCode === 404) {
          response.destroy();
          cleanup();
          return {status: "NOT_FOUND", redirected: false};
        }
        if (response.statusCode !== 200) {
          response.destroy();
          cleanup();
          return {status: "UNKNOWN", redirected: false};
        }
        const receivedIdentity = {
          runId: responseHeader(response, "x-paper-run-id"),
          configSha256: responseHeader(response, "x-paper-config-sha256"),
          producerRevision: responseHeader(response, "x-paper-producer-revision")
        };
        const exportSha256 = responseHeader(response, "x-paper-export-sha256");
        const byteLength = integerHeader(responseHeader(response, "content-length"));
        const metadataLength = integerHeader(responseHeader(response, "x-paper-byte-length"));
        const contentType = responseHeader(response, "content-type");
        if (!identityMatches(receivedIdentity, identity) || exportSha256 !== binding.exportSha256 ||
            byteLength === null || metadataLength !== byteLength || byteLength !== binding.byteLength ||
            contentType !== "application/octet-stream") {
          response.destroy();
          outgoing.destroy();
          cleanup();
          return {status: "UNKNOWN", redirected: false};
        }
        return {
          status: "FOUND",
          identity: receivedIdentity,
          exportSha256,
          byteLength,
          bytes: streamResponse(response, outgoing, cleanup),
          redirected: false
        };
      } catch {
        return {status: "UNKNOWN", redirected: false};
      }
    }
  });
}

function sendJson(response, statusCode, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json",
    "content-length": String(bytes.byteLength)
  });
  response.end(bytes);
}

function parseRoute(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.includes("?") || rawUrl.includes("#")) return null;
  const match = /^\/private\/run-exports\/v1\/([^/]+)$/.exec(rawUrl);
  if (!match) return null;
  let runId;
  try {
    runId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!SAFE_ID.test(runId) || encodeURIComponent(runId) !== match[1]) return null;
  return runId;
}

function parseIdentity(rawHeaders, runId) {
  const identity = {
    runId: singleHeader(rawHeaders, "x-paper-run-id"),
    configSha256: singleHeader(rawHeaders, "x-paper-config-sha256"),
    producerRevision: singleHeader(rawHeaders, "x-paper-producer-revision")
  };
  const normalized = normalizeIdentity(identity);
  if (normalized.runId !== runId) throw new TypeError("route and request identities differ");
  return normalized;
}

function parseAuthorization(rawHeaders) {
  const value = singleHeader(rawHeaders, "authorization");
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const authorization = value.slice(7);
  return validAuthorization(authorization) ? authorization : null;
}

function abortError(signal) {
  return signal.reason ?? new Error("request cancelled");
}

async function awaitReceiverOperation(operation, signal) {
  if (signal.aborted) throw abortError(signal);
  let onAbort;
  const cancelled = new Promise((resolve, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, {once: true});
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([Promise.resolve(operation), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function boundedIncoming(request, expectedLength, signal) {
  return {
    byteLength: expectedLength,
    async *[Symbol.asyncIterator]() {
      let total = 0;
      let reads = 0;
      for await (const chunk of request) {
        if (signal.aborted) throw abortError(signal);
        if (++reads > MAX_STREAM_READS || !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
          throw new RangeError("request body stream exceeds its bounds");
        }
        total += chunk.byteLength;
        if (total > MAX_TRANSFER_BYTES || total > expectedLength) {
          throw new RangeError("request body exceeds its declared length");
        }
        yield chunk;
      }
      if (total !== expectedLength) throw new RangeError("request body is partial");
    }
  };
}

function sendStoredBytes(response, bytes, identity, exportSha256, signal) {
  return new Promise((resolve, reject) => {
    let offset = 0;
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, {once: true});
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const writeNext = () => {
      if (signal.aborted) {
        cleanup();
        reject(abortError(signal));
        return;
      }
      while (offset < bytes.byteLength) {
        const end = Math.min(offset + 64 * 1024, bytes.byteLength);
        const chunk = bytes.subarray(offset, end);
        offset = end;
        if (!response.write(chunk)) {
          response.once("drain", writeNext);
          return;
        }
      }
      response.end();
      cleanup();
      resolve();
    };
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "x-paper-run-id": identity.runId,
      "x-paper-config-sha256": identity.configSha256,
      "x-paper-producer-revision": identity.producerRevision,
      "x-paper-export-sha256": exportSha256,
      "x-paper-byte-length": String(bytes.byteLength)
    });
    writeNext();
  });
}

export function createPrivateReceiverHandler({receiver, privateOrigin, timeoutMs = 15_000} = {}) {
  if (!receiver || typeof receiver.put !== "function" || typeof receiver.get !== "function") {
    throw new TypeError("a createFileReceiver instance is required");
  }
  const origin = normalizeOrigin(privateOrigin);
  const originHost = new URL(origin).host;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_OPERATION_MS) {
    throw new RangeError("receiver deadline must be between 1 and 30000 ms");
  }

  return async function handlePrivateReceiverRequest(request, response) {
    if (!request.socket?.encrypted) {
      sendJson(response, 426, {status: "REJECTED"});
      return;
    }
    if (!headerSizeIsBounded(request.rawHeaders)) {
      sendJson(response, 431, {status: "REJECTED"});
      return;
    }
    if (singleHeader(request.rawHeaders, "host") !== originHost) {
      sendJson(response, 421, {status: "REJECTED"});
      return;
    }
    const runId = parseRoute(request.url);
    if (!runId || singleHeader(request.rawHeaders, "x-paper-transfer-schema") !== TRANSFER_SCHEMA) {
      sendJson(response, 404, {status: "REJECTED"});
      return;
    }
    if (request.method !== "PUT" && request.method !== "GET") {
      response.setHeader("allow", "GET, PUT");
      sendJson(response, 405, {status: "REJECTED"});
      return;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("receiver operation deadline exceeded"));
      if (!response.headersSent) sendJson(response, 504, {status: "UNKNOWN"});
      request.destroy();
    }, timeoutMs);
    const onAborted = () => controller.abort(new Error("request cancelled"));
    const onClose = () => {
      if (!response.writableEnded) controller.abort(new Error("response cancelled"));
    };
    request.once("aborted", onAborted);
    response.once("close", onClose);

    try {
      const identity = parseIdentity(request.rawHeaders, runId);
      const authorization = parseAuthorization(request.rawHeaders);
      if (!authorization ||
          singleHeader(request.rawHeaders, "x-paper-transfer-schema") !== TRANSFER_SCHEMA) {
        sendJson(response, 403, {status: "REJECTED"});
        return;
      }
      if (request.method === "PUT") {
        const exportSha256 = singleHeader(request.rawHeaders, "x-paper-export-sha256");
        const byteLength = integerHeader(singleHeader(request.rawHeaders, "x-paper-byte-length"));
        const contentLength = integerHeader(singleHeader(request.rawHeaders, "content-length"));
        if (!HASH.test(exportSha256 ?? "") || byteLength === null || byteLength < 1 ||
            contentLength !== byteLength ||
            singleHeader(request.rawHeaders, "content-type") !== "application/octet-stream") {
          sendJson(response, 400, {status: "REJECTED"});
          return;
        }
        const outcome = await awaitReceiverOperation(receiver.put({
          schema: TRANSFER_SCHEMA,
          origin,
          identity,
          exportSha256,
          byteLength,
          bytes: boundedIncoming(request, byteLength, controller.signal),
          authorization,
          signal: controller.signal
        }), controller.signal);
        if (timedOut || response.destroyed) return;
        if (["STORED", "DUPLICATE"].includes(outcome.status)) {
          sendJson(response, outcome.status === "STORED" ? 201 : 200, outcome);
        } else if (outcome.status === "CONFLICT") {
          sendJson(response, 409, outcome);
        } else if (outcome.status === "REJECTED") {
          sendJson(response, 403, outcome);
        } else {
          sendJson(response, 503, {status: "UNKNOWN"});
        }
        return;
      }

      if (request.rawHeaders.some((value, index) =>
        index % 2 === 0 && ["content-length", "transfer-encoding"].includes(value.toLowerCase()))) {
        sendJson(response, 400, {status: "REJECTED"});
        return;
      }
      const expectedDigest = singleHeader(request.rawHeaders, "x-paper-export-sha256");
      const expectedLength = integerHeader(singleHeader(request.rawHeaders, "x-paper-byte-length"));
      if (!HASH.test(expectedDigest ?? "") || expectedLength === null || expectedLength < 1) {
        sendJson(response, 400, {status: "REJECTED"});
        return;
      }
      const outcome = await awaitReceiverOperation(receiver.get({
        schema: TRANSFER_SCHEMA,
        origin,
        identity,
        authorization,
        signal: controller.signal
      }), controller.signal);
      if (timedOut || response.destroyed) return;
      if (outcome.status === "REJECTED") {
        sendJson(response, 403, outcome);
      } else if (outcome.status === "NOT_FOUND") {
        sendJson(response, 404, outcome);
      } else if (outcome.status !== "FOUND" ||
          !identityMatches(outcome.identity, identity) ||
          outcome.exportSha256 !== expectedDigest || outcome.byteLength !== expectedLength) {
        sendJson(response, outcome.status === "FOUND" ? 409 : 503, {status: "UNKNOWN"});
      } else {
        await sendStoredBytes(response, outcome.bytes, outcome.identity, outcome.exportSha256,
          controller.signal);
      }
    } catch {
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, timedOut ? 504 : 400, {status: timedOut ? "UNKNOWN" : "REJECTED"});
      } else if (!response.destroyed) {
        response.destroy();
      }
    } finally {
      clearTimeout(timer);
      request.removeListener("aborted", onAborted);
      response.removeListener("close", onClose);
    }
  };
}

function deadlineError() {
  const error = new Error("operation deadline exceeded");
  error.code = "DEADLINE_EXCEEDED";
  return error;
}

async function awaitWithDeadline(promise, signal, deadline, monotonicNow) {
  if (signal.aborted) throw abortError(signal);
  let timer;
  let abortListener;
  const cancelled = new Promise((resolve, reject) => {
    abortListener = () => reject(abortError(signal));
    signal.addEventListener("abort", abortListener, {once: true});
    if (signal.aborted) abortListener();
  });
  const timedOut = new Promise((resolve, reject) => {
    const remaining = deadline - monotonicNow();
    if (remaining <= 0) {
      reject(deadlineError());
      return;
    }
    timer = setTimeout(() => reject(deadlineError()), remaining);
  });
  try {
    const value = await Promise.race([Promise.resolve(promise), cancelled, timedOut]);
    if (signal.aborted) throw abortError(signal);
    if (monotonicNow() >= deadline) throw deadlineError();
    return value;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortListener);
  }
}

async function collectBounded(source, signal, deadline, monotonicNow) {
  const chunks = [];
  let length = 0;
  let reads = 0;
  const iterator = source?.[Symbol.asyncIterator]?.();
  if (!iterator) throw new TypeError("HTTP response body is not a byte stream");
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      if (monotonicNow() >= deadline) throw deadlineError();
      const next = await awaitWithDeadline(iterator.next(), signal, deadline, monotonicNow);
      if (signal.aborted) throw abortError(signal);
      if (monotonicNow() >= deadline) throw deadlineError();
      if (next.done) break;
      if (++reads > MAX_STREAM_READS || !(next.value instanceof Uint8Array)) {
        throw new RangeError("HTTP response stream exceeds its bounds");
      }
      length += next.value.byteLength;
      if (length > MAX_TRANSFER_BYTES) throw new RangeError("HTTP response exceeds 16 MiB");
      chunks.push(Buffer.from(next.value));
    }
  } catch (error) {
    try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch { }
    throw error;
  }
  if (!length) throw new RangeError("HTTP response is empty");
  return Buffer.concat(chunks, length);
}

export async function readExportOverHttps({
  transport,
  privateOrigin,
  expected,
  expectedExportSha256,
  expectedByteLength,
  readAuthorization,
  timeoutMs = 15_000,
  signal,
  monotonicNow = () => performance.now(),
  evaluate = evaluateMemecoinPaperRunExport
} = {}) {
  let identity;
  try {
    identity = normalizeIdentity(expected);
    normalizeOrigin(privateOrigin);
    if (!transport || typeof transport.get !== "function" ||
        !HASH.test(expectedExportSha256 ?? "") ||
        !Number.isSafeInteger(expectedByteLength) || expectedByteLength < 1 ||
        expectedByteLength > MAX_TRANSFER_BYTES || !validAuthorization(readAuthorization) ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_OPERATION_MS ||
        typeof monotonicNow !== "function" || typeof evaluate !== "function") {
      throw new TypeError("invalid independent readback request");
    }
  } catch {
    return {status: "REJECTED", code: "INVALID_READ_REQUEST"};
  }

  const controller = new AbortController();
  let timedOut = false;
  let deadlineExpired = false;
  let lastMonotonic = monotonicNow();
  if (!Number.isFinite(lastMonotonic)) {
    return {status: "REJECTED", code: "INVALID_READ_REQUEST"};
  }
  const readMonotonic = () => {
    const current = monotonicNow();
    if (!Number.isFinite(current)) throw new TypeError("monotonic clock returned an invalid value");
    lastMonotonic = Math.max(lastMonotonic, current);
    return lastMonotonic;
  };
  const deadline = lastMonotonic + timeoutMs;
  const checkDeadline = () => {
    if (readMonotonic() >= deadline) {
      deadlineExpired = true;
      throw deadlineError();
    }
  };
  const onAbort = () => controller.abort(signal.reason ?? new Error("readback cancelled"));
  signal?.addEventListener("abort", onAbort, {once: true});
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("readback deadline exceeded"));
  }, timeoutMs);
  try {
    if (signal?.aborted) return {status: "UNKNOWN", code: "CANCELLED"};
    checkDeadline();
    const responsePromise = transport.get({
      schema: TRANSFER_SCHEMA,
      origin: normalizeOrigin(privateOrigin),
      identity,
      expectedExportSha256,
      expectedByteLength,
      authorization: readAuthorization,
      signal: controller.signal
    });
    const response = await awaitWithDeadline(responsePromise, controller.signal, deadline, readMonotonic);
    checkDeadline();
    if (controller.signal.aborted) return {status: "UNKNOWN", code: "CANCELLED"};
    if (response?.redirected === true) return {status: "UNKNOWN", code: "REDIRECT_REJECTED"};
    if (response?.status === "REJECTED") return {status: "REJECTED", code: "READ_REJECTED"};
    if (response?.status !== "FOUND" || response.redirected !== false) {
      return {status: "UNKNOWN", code: response?.status === "NOT_FOUND"
        ? "EXPORT_NOT_FOUND" : "READBACK_UNKNOWN"};
    }
    const bytes = await collectBounded(response.bytes, controller.signal, deadline, readMonotonic);
    checkDeadline();
    const digest = createHash("sha256").update(bytes).digest("hex");
    checkDeadline();
    if (!identityMatches(response.identity, identity) ||
        response.exportSha256 !== expectedExportSha256 ||
        response.byteLength !== expectedByteLength ||
        bytes.byteLength !== expectedByteLength || digest !== expectedExportSha256) {
      return {status: "REJECTED", code: "READBACK_DIGEST_OR_IDENTITY_MISMATCH"};
    }
    let exportValue;
    try {
      exportValue = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    } catch {
      return {status: "REJECTED", code: "INVALID_EXPORT"};
    }
    checkDeadline();
    if (!isRecord(exportValue) || exportValue.schemaVersion !== "memecoin-paper-run-export/v1" ||
        !identityMatches({
          runId: exportValue.runId,
          configSha256: exportValue.configSha256,
          producerRevision: exportValue.producerRevision
        }, identity)) {
      return {status: "REJECTED", code: "READBACK_DIGEST_OR_IDENTITY_MISMATCH"};
    }
    checkDeadline();
    const evaluation = evaluate(bytes, identity);
    checkDeadline();
    if (controller.signal.aborted) return {status: "UNKNOWN", code: "CANCELLED"};
    return {
      status: "READ_BACK",
      identity,
      exportSha256: digest,
      byteLength: bytes.byteLength,
      bytes,
      exportValue,
      evaluation
    };
  } catch (error) {
    const deadlineReached = deadlineExpired || error?.code === "DEADLINE_EXCEEDED" || timedOut;
    if (deadlineReached && !controller.signal.aborted) {
      controller.abort(error?.code === "DEADLINE_EXCEEDED" ? error : deadlineError());
    }
    return {
      status: "UNKNOWN",
      code: deadlineReached ? "DEADLINE_EXCEEDED" : signal?.aborted ? "CANCELLED" : "READ_OUTCOME_UNKNOWN"
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
