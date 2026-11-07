import {createHash, timingSafeEqual} from 'node:crypto';
import {readBoundedRequestBody} from './report-transfer-gateway.mjs';
import {
  getAcceptedSpotPaperIdentity,
  isSpotPaperDashboardDto,
  SPOT_PAPER_REPORT_MAX_BYTES,
  SPOT_PAPER_REPORT_TIMEOUT_MS,
  SPOT_PAPER_REPORT_TRANSFER_SCHEMA,
  SPOT_PAPER_REPORT_ENVELOPE_SCHEMA
} from './scripts/spot-paper-report-bridge/contract.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_ACTIVE_REQUESTS = 4;
let activeRequests = 0;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError('invalid_json_number');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new TypeError('invalid_json_value');
  return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function exactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export function spotPaperReportGatewayConfig(env = process.env) {
  const identity = getAcceptedSpotPaperIdentity();
  const readTokenHashes = [];
  const readHash = String(env.MERIDIAN_READ_TOKEN_SHA256 ?? '').trim().toLowerCase();
  if (readHash) readTokenHashes.push(readHash);
  const readToken = String(env.MERIDIAN_READ_TOKEN ?? '').trim();
  if (readToken) readTokenHashes.push(digest(Buffer.from(readToken, 'utf8')));
  return Object.freeze({
    enabled: env.MERIDIAN_SPOT_PAPER_REPORT_ENABLED === 'true' &&
      env.MERIDIAN_SPOT_PAPER_REPORT_DEPLOYMENT_VERIFIED === 'true' &&
      env.MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED === 'true',
    uploadApproved: env.MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_APPROVED === 'true',
    expectedRunId: identity.runId,
    expectedConfigHash: digest(Buffer.from(canonicalJson(identity), 'utf8')),
    uploadTokenHash: String(env.MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN_SHA256 ?? '')
      .trim().toLowerCase(),
    readTokenHashes: Object.freeze([...new Set(readTokenHashes)])
  });
}

function configured(config) {
  return config?.enabled === true &&
    config.uploadApproved === true &&
    config.expectedRunId === getAcceptedSpotPaperIdentity().runId &&
    HASH.test(config.expectedConfigHash ?? '') &&
    HASH.test(config.uploadTokenHash ?? '') &&
    Array.isArray(config.readTokenHashes) && config.readTokenHashes.length > 0 &&
    config.readTokenHashes.every(hash => HASH.test(hash) && hash !== config.uploadTokenHash);
}

function requestToken(req) {
  const header = String(req.headers?.authorization ?? '');
  if (!header.startsWith('Bearer ')) return '';
  const token = header.slice(7);
  return token && !/\s/.test(token) ? token : '';
}

function authorizedUpload(req, config) {
  const token = requestToken(req);
  if (!token || !HASH.test(config?.uploadTokenHash ?? '')) return false;
  const actual = createHash('sha256').update(token).digest();
  if ((config.readTokenHashes ?? []).some(hash =>
    HASH.test(hash) && timingSafeEqual(actual, Buffer.from(hash, 'hex')))) return false;
  return timingSafeEqual(actual, Buffer.from(config.uploadTokenHash, 'hex'));
}

function response(status, body) {
  return {status, body};
}

function queryPresent(req) {
  try {
    return new URL(req.url, 'http://gateway.invalid').search.length > 0;
  } catch {
    return true;
  }
}

function enterRequest() {
  if (activeRequests >= MAX_ACTIVE_REQUESTS) return null;
  activeRequests++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRequests--;
  };
}

function storeFailure(error, write = false) {
  if (error?.code === 'STORE_BUSY') return response(503, {error: 'spot_paper_report_busy'});
  if (error?.code === 'PAPER_REPORT_OUTCOME_UNKNOWN') {
    return response(503, {error: 'spot_paper_report_outcome_unknown'});
  }
  if (error?.code === 'STORE_TIMEOUT') {
    return response(503, {error: write ? 'spot_paper_report_outcome_unknown' :
      'spot_paper_report_store_timeout'});
  }
  return response(503, {error: 'spot_paper_report_store_unavailable'});
}

function parseTransfer(bytes, config, now) {
  let text;
  let envelope;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    envelope = JSON.parse(text);
    if (canonicalJson(envelope) !== text) return null;
  } catch {
    return null;
  }
  if (!exactKeys(envelope, ['schema', 'runId', 'report']) ||
      envelope.schema !== SPOT_PAPER_REPORT_TRANSFER_SCHEMA ||
      envelope.runId !== config.expectedRunId || !isSpotPaperDashboardDto(envelope.report) ||
      envelope.report.identity.runId !== envelope.runId ||
      Date.parse(envelope.report.snapshot.completedAt) > now) return null;
  const canonical = canonicalJson(envelope);
  return {
    envelope,
    digest: digest(Buffer.from(canonical, 'utf8')),
    configHash: config.expectedConfigHash
  };
}

async function upload(req, {config, getStore, readBody, now, signal}) {
  if (!configured(config)) return response(503, {error: 'spot_paper_report_upload_disabled'});
  if (req.method !== 'POST') return response(405, {error: 'method_not_allowed'});
  if (queryPresent(req)) return response(400, {error: 'spot_paper_report_query_not_supported'});
  if (!authorizedUpload(req, config)) return response(401, {error: 'spot_paper_report_upload_auth_required'});
  const release = enterRequest();
  if (!release) return response(503, {error: 'spot_paper_report_busy'});
  try {
    let store;
    try { store = getStore?.(); } catch { store = null; }
    if (!store || typeof store.insertImmutable !== 'function') {
      return response(503, {error: 'spot_paper_report_store_unavailable'});
    }
    const contentType = String(req.headers?.['content-type'] ?? '');
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
      return response(415, {error: 'unsupported_content_type'});
    }
    const length = req.headers?.['content-length'];
    if (length !== undefined && !/^(0|[1-9]\d*)$/.test(String(length))) {
      return response(400, {error: 'invalid_content_length'});
    }
    if (length !== undefined && Number(length) > SPOT_PAPER_REPORT_MAX_BYTES) {
      return response(413, {error: 'request_body_too_large'});
    }
    let bytes;
    try {
      bytes = await readBody(req, {
        maxBytes: SPOT_PAPER_REPORT_MAX_BYTES,
        timeoutMs: SPOT_PAPER_REPORT_TIMEOUT_MS,
        signal
      });
    } catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') return response(413, {error: 'request_body_too_large'});
      if (error?.code === 'BODY_TIMEOUT') return response(408, {error: 'request_body_timeout'});
      if (error?.code === 'REQUEST_CANCELLED') return response(408, {error: 'request_cancelled'});
      return response(400, {error: 'invalid_request_body'});
    }
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) ||
        bytes.byteLength > SPOT_PAPER_REPORT_MAX_BYTES ||
        (length !== undefined && Number(length) !== bytes.byteLength)) {
      return response(bytes?.byteLength > SPOT_PAPER_REPORT_MAX_BYTES ? 413 : 400,
        {error: bytes?.byteLength > SPOT_PAPER_REPORT_MAX_BYTES ?
          'request_body_too_large' : 'invalid_request_body'});
    }
    const parsed = parseTransfer(bytes, config, now());
    if (!parsed) return response(400, {error: 'invalid_spot_paper_report_envelope'});
    try {
      const saved = await store.insertImmutable({
        runId: parsed.envelope.runId,
        configHash: parsed.configHash,
        digest: parsed.digest,
        envelope: parsed.envelope,
        signal
      });
      if (saved === 'CONFLICT') return response(409, {error: 'spot_paper_report_conflict'});
      return response(saved === 'IDENTICAL' ? 200 : 201, {
        ok: true, runId: parsed.envelope.runId, digest: parsed.digest,
        idempotent: saved === 'IDENTICAL'
      });
    } catch (error) {
      return storeFailure(error, true);
    }
  } finally {
    release();
  }
}

async function read(req, {config, getStore, authorizedRead, now, signal}) {
  if (typeof authorizedRead !== 'function' || !authorizedRead(req)) {
    return response(401, {error: 'read_token_required'});
  }
  if (!configured(config)) return response(503, {error: 'spot_paper_report_disabled'});
  if (req.method !== 'GET') return response(405, {error: 'method_not_allowed'});
  if (queryPresent(req)) return response(400, {error: 'spot_paper_report_query_not_supported'});
  const release = enterRequest();
  if (!release) return response(503, {error: 'spot_paper_report_busy'});
  try {
    let store;
    try { store = getStore?.(); } catch { store = null; }
    if (!store || typeof store.get !== 'function') {
      return response(503, {error: 'spot_paper_report_store_unavailable'});
    }
    let row;
    try { row = await store.get(config.expectedRunId, {signal}); }
    catch (error) { return storeFailure(error); }
    if (!row) return response(404, {error: 'spot_paper_report_not_found'});
    if (row.run_id !== config.expectedRunId || row.config_hash !== config.expectedConfigHash ||
        !HASH.test(String(row.content_sha256 ?? ''))) {
      return response(503, {error: 'spot_paper_report_corrupt'});
    }
    let canonical;
    try { canonical = canonicalJson(row.envelope); }
    catch { return response(503, {error: 'spot_paper_report_corrupt'}); }
    if (digest(Buffer.from(canonical, 'utf8')) !== row.content_sha256) {
      return response(503, {error: 'spot_paper_report_corrupt'});
    }
    const parsed = parseTransfer(Buffer.from(canonical, 'utf8'), config, now());
    if (!parsed || parsed.digest !== row.content_sha256) {
      return response(503, {error: 'spot_paper_report_corrupt'});
    }
    return response(200, {
      schema: SPOT_PAPER_REPORT_ENVELOPE_SCHEMA,
      runId: config.expectedRunId,
      report: parsed.envelope.report
    });
  } finally {
    release();
  }
}

export async function handleSpotPaperReportGatewayRequest(req, {
  config,
  getStore,
  authorizedRead,
  readBody = readBoundedRequestBody,
  now = Date.now,
  signal
} = {}) {
  let pathname;
  try { pathname = new URL(req.url, 'http://gateway.invalid').pathname; }
  catch { return null; }
  const dependencies = {config, getStore, authorizedRead, readBody, now, signal};
  if (pathname === '/api/private/spot-paper-report/upload') {
    if (typeof authorizedRead === 'function' && authorizedRead(req)) {
      return response(401, {error: 'spot_paper_report_upload_auth_required'});
    }
    return upload(req, dependencies);
  }
  if (pathname === '/api/private/spot-paper-report') return read(req, dependencies);
  return null;
}

export function writeSpotPaperReportRouteResponse(req, res, result, origin, writeJson) {
  if (!req.complete) {
    res.shouldKeepAlive = false;
    res.once('finish', () => {
      if (!req.complete) req.destroy();
    });
  }
  return writeJson(res, result.status, result.body, origin || '');
}
