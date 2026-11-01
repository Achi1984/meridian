import {createHash, timingSafeEqual} from "node:crypto";
import {
  decodePaperReportEnvelope,
  MAX_PAPER_REPORT_BYTES,
  PAPER_REPORT_ENVELOPE_SCHEMA,
  PAPER_REPORT_SCHEMA
} from "./scripts/memecoin-paper-report-bridge/contract.mjs";

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const PAPER_REPORT_TRANSFER_SCHEMA = "MEMECOIN_PAPER_REPORT_TRANSFER_ENVELOPE_V1";
const MAX_BODY_BYTES = MAX_PAPER_REPORT_BYTES;
const BODY_TIMEOUT_MS = 5_000;
const MAX_ACTIVE_REPORT_REQUESTS = 4;
let activeReportRequests = 0;

export function reportTransferGatewayConfig(env = process.env) {
  return Object.freeze({
    enabled: env.MERIDIAN_PAPER_REPORT_UPLOAD_ENABLED === "true",
    expectedRunId: String(env.MERIDIAN_PAPER_REPORT_EXPECTED_RUN_ID ?? ""),
    expectedConfigHash: String(env.MERIDIAN_PAPER_REPORT_EXPECTED_CONFIG_SHA256 ?? "").toLowerCase(),
    uploadTokenHash: String(env.MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN_SHA256 ?? "").toLowerCase()
  });
}

function isConfigured(config) {
  return config?.enabled === true &&
    typeof config.expectedRunId === "string" && SAFE_RUN_ID.test(config.expectedRunId) &&
    typeof config.expectedConfigHash === "string" && HASH.test(config.expectedConfigHash) &&
    typeof config.uploadTokenHash === "string" && HASH.test(config.uploadTokenHash);
}

function tokenFromHeader(req) {
  const header = String(req.headers?.authorization ?? "");
  if (!header.startsWith("Bearer ")) return "";
  const token = header.slice(7);
  return token && !/\s/.test(token) ? token : "";
}

function authorizedUpload(req, hash) {
  const token = tokenFromHeader(req);
  if (!token || !HASH.test(hash)) return false;
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(hash, "hex");
  return timingSafeEqual(actual, expected);
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError("invalid_json_number");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("invalid_json_value");
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactKeys(value, expected) {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseEnvelope(bytes, config, now) {
  let text;
  let envelope;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    envelope = JSON.parse(text);
    if (canonicalJson(envelope) !== text) return null;
  } catch {
    return null;
  }
  if (!exactKeys(envelope, ["schema", "runId", "configHash", "report"]) ||
      envelope.schema !== PAPER_REPORT_TRANSFER_SCHEMA ||
      envelope.runId !== config.expectedRunId ||
      envelope.configHash !== config.expectedConfigHash) {
    return null;
  }
  const bridgeEnvelope = Buffer.from(canonicalJson({
    schema: PAPER_REPORT_ENVELOPE_SCHEMA,
    runId: envelope.runId,
    report: envelope.report
  }), "utf8");
  let decoded;
  try {
    decoded = decodePaperReportEnvelope(bridgeEnvelope, {now});
  } catch {
    return null;
  }
  if (decoded.report.schema !== PAPER_REPORT_SCHEMA ||
      decoded.report.experiment.reportStatus !== "FINISHED") return null;
  return {
    envelope: {
      schema: PAPER_REPORT_TRANSFER_SCHEMA,
      runId: decoded.runId,
      configHash: envelope.configHash,
      report: decoded.report
    },
    digest: digest(Buffer.from(canonicalJson(envelope), "utf8"))
  };
}

export async function readBoundedRequestBody(req, {
  maxBytes = MAX_BODY_BYTES,
  timeoutMs = BODY_TIMEOUT_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  signal
} = {}) {
  if (!req || typeof req[Symbol.asyncIterator] !== "function") {
    const error = new Error("invalid_request_body");
    error.code = "INVALID_BODY";
    throw error;
  }
  const iterator = req[Symbol.asyncIterator]();
  const chunks = [];
  let size = 0;
  let timer;
  let rejectDeadline;
  let removeAbort = () => {};
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const cancelled = new Promise((_, reject) => {
    if (!signal) return;
    const abort = () => {
      const error = new Error("request_cancelled");
      error.code = "REQUEST_CANCELLED";
      reject(error);
    };
    signal.addEventListener("abort", abort, {once: true});
    removeAbort = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
  });
  try {
    timer = schedule(() => {
      const error = new Error("request_body_timeout");
      error.code = "BODY_TIMEOUT";
      rejectDeadline(error);
    }, timeoutMs);
    if (timer === undefined || timer === null) {
      const error = new Error("request_body_deadline_unavailable");
      error.code = "BODY_TIMEOUT";
      throw error;
    }
    while (true) {
      const next = await Promise.race([iterator.next(), deadline, cancelled]);
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("request_body_too_large");
        error.code = "BODY_TOO_LARGE";
        throw error;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    req.pause?.();
    throw error;
  } finally {
    removeAbort();
    if (timer !== undefined && timer !== null) {
      try { cancelSchedule(timer); } catch { }
    }
  }
}

function enterReportRequest() {
  if (activeReportRequests >= MAX_ACTIVE_REPORT_REQUESTS) return null;
  activeReportRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeReportRequests -= 1;
  };
}

function queryPresent(req) {
  try {
    return new URL(req.url, "http://gateway.invalid").search.length > 0;
  } catch {
    return true;
  }
}

function response(status, body) {
  return {status, body};
}

function storeFailure(error, {write = false} = {}) {
  if (error?.code === "STORE_BUSY") return response(503, {error: "paper_report_busy"});
  if (error?.code === "PAPER_REPORT_OUTCOME_UNKNOWN") {
    return response(503, {error: "paper_report_outcome_unknown"});
  }
  if (error?.code === "STORE_TIMEOUT") {
    return response(503, {error: write ? "paper_report_outcome_unknown" : "paper_report_store_timeout"});
  }
  return response(503, {error: "paper_report_store_unavailable"});
}

export async function handlePaperReportUpload(req, {
  config,
  store,
  getStore,
  readBody = readBoundedRequestBody,
  now = Date.now,
  signal
} = {}) {
  if (!isConfigured(config)) return response(503, {error: "paper_report_upload_disabled"});
  if (req.method !== "POST") return response(405, {error: "method_not_allowed"});
  if (queryPresent(req)) return response(400, {error: "paper_report_query_not_supported"});
  if (!authorizedUpload(req, config.uploadTokenHash)) {
    return response(401, {error: "paper_report_upload_auth_required"});
  }
  const releaseAdmission = enterReportRequest();
  if (!releaseAdmission) return response(503, {error: "paper_report_busy"});
  try {
    if (typeof getStore === "function") {
      try { store = getStore(); } catch { store = null; }
    }
    if (!store || typeof store.insertImmutable !== "function") {
      return response(503, {error: "paper_report_store_unavailable"});
    }
    const contentType = String(req.headers?.["content-type"] ?? "");
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
      return response(415, {error: "unsupported_content_type"});
    }
    const contentLength = req.headers?.["content-length"];
    if (contentLength !== undefined &&
        (!/^(0|[1-9]\d*)$/.test(String(contentLength)))) {
      return response(400, {error: "invalid_content_length"});
    }
    if (contentLength !== undefined && Number(contentLength) > MAX_BODY_BYTES) {
      return response(413, {error: "request_body_too_large"});
    }
    let bytes;
    try {
      bytes = await readBody(req, {maxBytes: MAX_BODY_BYTES, timeoutMs: BODY_TIMEOUT_MS, signal});
    } catch (error) {
      if (error?.code === "BODY_TOO_LARGE") return response(413, {error: "request_body_too_large"});
      if (error?.code === "BODY_TIMEOUT") return response(408, {error: "request_body_timeout"});
      if (error?.code === "REQUEST_CANCELLED") return response(408, {error: "request_cancelled"});
      return response(400, {error: "invalid_request_body"});
    }
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
      return response(400, {error: "invalid_request_body"});
    }
    if (bytes.byteLength > MAX_BODY_BYTES) return response(413, {error: "request_body_too_large"});
    if (contentLength !== undefined && Number(contentLength) !== bytes.byteLength) {
      return response(400, {error: "invalid_content_length"});
    }
    const parsed = parseEnvelope(bytes, config, now());
    if (!parsed) return response(400, {error: "invalid_report_envelope"});

    try {
      const saved = await store.insertImmutable({
        runId: parsed.envelope.runId,
        configHash: parsed.envelope.configHash,
        digest: parsed.digest,
        envelope: parsed.envelope,
        signal
      });
      if (saved === "CONFLICT") return response(409, {error: "paper_report_conflict"});
      return response(saved === "IDENTICAL" ? 200 : 201, {
        ok: true,
        runId: parsed.envelope.runId,
        digest: parsed.digest,
        idempotent: saved === "IDENTICAL"
      });
    } catch (error) {
      return storeFailure(error, {write: true});
    }
  } finally {
    releaseAdmission();
  }
}

export async function handlePaperReportRead(req, {
  config,
  store,
  getStore,
  now = Date.now,
  signal
} = {}) {
  if (!config?.enabled || typeof config.expectedRunId !== "string" ||
      !SAFE_RUN_ID.test(config.expectedRunId) ||
      typeof config.expectedConfigHash !== "string" || !HASH.test(config.expectedConfigHash)) {
    return response(503, {error: "paper_report_disabled"});
  }
  if (req.method !== "GET") return response(405, {error: "method_not_allowed"});
  if (queryPresent(req)) return response(400, {error: "paper_report_query_not_supported"});
  const releaseAdmission = enterReportRequest();
  if (!releaseAdmission) return response(503, {error: "paper_report_busy"});
  try {
    if (typeof getStore === "function") {
      try { store = getStore(); } catch { store = null; }
    }
    if (!store || typeof store.get !== "function") {
      return response(503, {error: "paper_report_store_unavailable"});
    }
    let row;
    try {
      row = await store.get(config.expectedRunId, {signal});
    } catch (error) {
      return storeFailure(error);
    }
    if (!row) return response(404, {error: "paper_report_not_found"});
    if (row.run_id !== config.expectedRunId || row.config_hash !== config.expectedConfigHash ||
        !HASH.test(String(row.content_sha256 ?? ""))) {
      return response(503, {error: "paper_report_corrupt"});
    }
    let canonicalStored;
    try {
      canonicalStored = canonicalJson(row.envelope);
    } catch {
      return response(503, {error: "paper_report_corrupt"});
    }
    if (digest(Buffer.from(canonicalStored, "utf8")) !== row.content_sha256) {
      return response(503, {error: "paper_report_corrupt"});
    }
    const bytes = Buffer.from(canonicalStored, "utf8");
    const parsed = parseEnvelope(bytes, config, now());
    if (!parsed || parsed.digest !== row.content_sha256) {
      return response(503, {error: "paper_report_corrupt"});
    }
    const envelope = {
      schema: PAPER_REPORT_ENVELOPE_SCHEMA,
      runId: config.expectedRunId,
      report: parsed.envelope.report
    };
    const output = Buffer.from(canonicalJson(envelope), "utf8");
    if (output.length > MAX_BODY_BYTES) {
      return response(503, {error: "paper_report_corrupt"});
    }
    return response(200, envelope);
  } finally {
    releaseAdmission();
  }
}

export const PAPER_REPORT_MAX_BODY_BYTES = MAX_BODY_BYTES;

export async function handleReportGatewayRequest(req, {
  config,
  getStore,
  authorizedRead,
  readBody,
  now,
  signal
} = {}) {
  let pathname;
  try {
    pathname = new URL(req.url, "http://gateway.invalid").pathname;
  } catch {
    return null;
  }
  if (pathname === "/api/private/paper-report/upload") {
    return handlePaperReportUpload(req, {config, getStore, readBody, now, signal});
  }
  if (pathname === "/api/private/paper-report") {
    if (typeof authorizedRead !== "function" || !authorizedRead(req)) {
      return response(401, {error: "read_token_required"});
    }
    return handlePaperReportRead(req, {config, getStore, now, signal});
  }
  return null;
}
