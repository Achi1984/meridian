import {createHash, timingSafeEqual} from 'node:crypto';
import {readBoundedRequestBody} from './report-transfer-gateway.mjs';
import {
  isSpotPaperHost8hEnvelope,
  normalizeSpotPaperHost8hReport,
  SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
  SPOT_PAPER_HOST8H_MAX_BYTES,
  SPOT_PAPER_HOST8H_REPORT_SCHEMA,
  SPOT_PAPER_HOST8H_RUN_ID,
  SPOT_PAPER_HOST8H_SOURCE_SHA,
  SPOT_PAPER_HOST8H_PROFILE_ID,
  SPOT_PAPER_HOST8H_TRANSFER_SCHEMA
} from './scripts/spot-paper-report-bridge/host8h-contract.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_ACTIVE_REQUESTS = 2;
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

function configHash() {
  return digest(Buffer.from(canonicalJson({
    runId: SPOT_PAPER_HOST8H_RUN_ID,
    profileId: SPOT_PAPER_HOST8H_PROFILE_ID,
    sourceSha: SPOT_PAPER_HOST8H_SOURCE_SHA,
    reportSchema: SPOT_PAPER_HOST8H_REPORT_SCHEMA
  }), 'utf8'));
}

export function spotPaperHost8hReportGatewayConfig(env = process.env) {
  const readHash = String(env.MERIDIAN_READ_TOKEN_SHA256 ?? '').trim().toLowerCase();
  const uploadTokenHash = String(
    env.MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_TOKEN_SHA256 ?? ''
  ).trim().toLowerCase();
  return Object.freeze({
    enabled: env.MERIDIAN_SPOT_PAPER_HOST8H_REPORT_ENABLED === 'true' &&
      env.MERIDIAN_SPOT_PAPER_HOST8H_REPORT_DEPLOYMENT_VERIFIED === 'true' &&
      env.MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_APPROVED === 'true',
    uploadApproved: env.MERIDIAN_SPOT_PAPER_HOST8H_REPORT_UPLOAD_APPROVED === 'true',
    expectedRunId: SPOT_PAPER_HOST8H_RUN_ID,
    expectedConfigHash: configHash(),
    uploadTokenHash,
    readTokenHashes: Object.freeze(readHash ? [readHash] : [])
  });
}

function configured(config) {
  return config?.enabled === true && config.uploadApproved === true &&
    config.expectedRunId === SPOT_PAPER_HOST8H_RUN_ID &&
    config.expectedConfigHash === configHash() &&
    HASH.test(config.uploadTokenHash ?? '') &&
    config.readTokenHashes?.every(hash => HASH.test(hash) && hash !== config.uploadTokenHash) &&
    config.readTokenHashes?.length > 0;
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

function unavailable(error) {
  if (error?.code === 'STORE_BUSY') return response(503, {error: 'host8h_report_busy'});
  if (error?.code === 'STORE_TIMEOUT') return response(503, {error: 'host8h_report_store_timeout'});
  return response(503, {error: 'host8h_report_store_unavailable'});
}

async function upload(req, {config, getStore, readBody, now, signal}) {
  if (!configured(config)) return response(503, {error: 'host8h_transport_not_provisioned'});
  if (req.method !== 'POST') return response(405, {error: 'method_not_allowed'});
  if (queryPresent(req)) return response(400, {error: 'host8h_report_query_not_supported'});
  if (!authorizedUpload(req, config)) return response(401, {error: 'host8h_upload_auth_required'});
  const release = enterRequest();
  if (!release) return response(503, {error: 'host8h_report_busy'});
  try {
    let store;
    try { store = getStore?.(); } catch { store = null; }
    if (!store || typeof store.putLatest !== 'function') {
      return response(503, {error: 'host8h_report_store_unavailable'});
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      String(req.headers?.['content-type'] ?? ''))) {
      return response(415, {error: 'unsupported_content_type'});
    }
    const length = req.headers?.['content-length'];
    if (length !== undefined && (!/^(0|[1-9]\d*)$/.test(String(length)) ||
        Number(length) > SPOT_PAPER_HOST8H_MAX_BYTES)) {
      return response(Number(length) > SPOT_PAPER_HOST8H_MAX_BYTES ? 413 : 400,
        {error: 'invalid_content_length'});
    }
    let bytes;
    try {
      bytes = await readBody(req, {
        maxBytes: SPOT_PAPER_HOST8H_MAX_BYTES, timeoutMs: 5_000, signal
      });
    } catch (error) {
      return response(error?.code === 'BODY_TOO_LARGE' ? 413 : 400,
        {error: error?.code === 'BODY_TOO_LARGE' ? 'request_body_too_large' :
          'invalid_request_body'});
    }
    if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) ||
        bytes.byteLength > SPOT_PAPER_HOST8H_MAX_BYTES ||
        (length !== undefined && Number(length) !== bytes.byteLength)) {
      return response(bytes?.byteLength > SPOT_PAPER_HOST8H_MAX_BYTES ? 413 : 400,
        {error: 'invalid_request_body'});
    }
    let text;
    let envelope;
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      envelope = JSON.parse(text);
      if (canonicalJson(envelope) !== text) return response(400, {error: 'invalid_host8h_envelope'});
    } catch {
      return response(400, {error: 'invalid_host8h_envelope'});
    }
    if (!envelope || Object.keys(envelope).sort().join(',') !== 'report,runId,schema' ||
        envelope.schema !== SPOT_PAPER_HOST8H_TRANSFER_SCHEMA ||
        envelope.runId !== config.expectedRunId ||
        !isSpotPaperHost8hEnvelope({
          schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
          runId: envelope.runId,
          report: envelope.report
        }, {now: now()})) {
      return response(400, {error: 'invalid_host8h_report'});
    }
    const report = normalizeSpotPaperHost8hReport(envelope.report, {now: now()});
    const storedEnvelope = {
      schema: SPOT_PAPER_HOST8H_ENVELOPE_SCHEMA,
      runId: envelope.runId,
      report
    };
    const canonicalStoredEnvelope = canonicalJson(storedEnvelope);
    let saved;
    try {
      saved = await store.putLatest({
        runId: envelope.runId,
        configHash: config.expectedConfigHash,
        digest: digest(Buffer.from(canonicalStoredEnvelope, 'utf8')),
        envelope: storedEnvelope,
        observedAt: report.observedAt,
        journalSequence: report.sourceEvidence.journalSequence,
        signal
      });
    } catch (error) {
      return unavailable(error);
    }
    if (saved === 'STALE') return response(409, {error: 'host8h_snapshot_out_of_order'});
    if (saved === 'TERMINAL_REGRESSION') {
      return response(409, {error: 'host8h_terminal_regression_rejected'});
    }
    if (saved === 'CONFLICT') {
      return response(409, {error: 'host8h_snapshot_conflict'});
    }
    if (saved !== 'IDENTICAL' && saved !== 'INSERTED') {
      return unavailable(new Error('STORE_OUTCOME_UNKNOWN'));
    }
    return response(saved === 'IDENTICAL' ? 200 : 201, {
      ok: true, runId: envelope.runId, observedAt: report.observedAt,
      idempotent: saved === 'IDENTICAL'
    });
  } finally {
    release();
  }
}

async function read(req, {config, getStore, authorizedRead, now, signal}) {
  if (typeof authorizedRead !== 'function' || !authorizedRead(req)) {
    return response(401, {error: 'read_token_required'});
  }
  if (!configured(config)) return response(503, {error: 'host8h_transport_not_provisioned'});
  if (req.method !== 'GET') return response(405, {error: 'method_not_allowed'});
  if (queryPresent(req)) return response(400, {error: 'host8h_report_query_not_supported'});
  const release = enterRequest();
  if (!release) return response(503, {error: 'host8h_report_busy'});
  try {
    let store;
    try { store = getStore?.(); } catch { store = null; }
    if (!store || typeof store.get !== 'function') {
      return response(503, {error: 'host8h_report_store_unavailable'});
    }
    let row;
    try { row = await store.get(config.expectedRunId, {signal}); }
    catch (error) { return unavailable(error); }
    if (!row) return response(404, {error: 'host8h_report_not_found'});
    if (row.run_id !== config.expectedRunId || row.config_hash !== config.expectedConfigHash ||
        !HASH.test(String(row.content_sha256 ?? ''))) {
      return response(503, {error: 'host8h_report_corrupt'});
    }
    let canonical;
    try { canonical = canonicalJson(row.envelope); } catch {
      return response(503, {error: 'host8h_report_corrupt'});
    }
    if (digest(Buffer.from(canonical, 'utf8')) !== row.content_sha256 ||
        !isSpotPaperHost8hEnvelope(row.envelope, {now: now()})) {
      return response(503, {error: 'host8h_report_corrupt'});
    }
    return response(200, row.envelope);
  } finally {
    release();
  }
}

export async function handleSpotPaperHost8hReportGatewayRequest(req, {
  config, getStore, authorizedRead, readBody = readBoundedRequestBody,
  now = Date.now, signal
} = {}) {
  let pathname;
  try { pathname = new URL(req.url, 'http://gateway.invalid').pathname; }
  catch { return null; }
  const dependencies = {config, getStore, authorizedRead, readBody, now, signal};
  if (pathname === '/api/private/spot-paper-host8h-report/upload') {
    if (typeof authorizedRead === 'function' && authorizedRead(req)) {
      return response(401, {error: 'host8h_upload_auth_required'});
    }
    return upload(req, dependencies);
  }
  if (pathname === '/api/private/spot-paper-host8h-report') return read(req, dependencies);
  return null;
}

export function writeSpotPaperHost8hReportRouteResponse(req, res, result, origin, writeJson) {
  if (!req.complete) {
    res.shouldKeepAlive = false;
    res.once('finish', () => {
      if (!req.complete) req.destroy();
    });
  }
  return writeJson(res, result.status, result.body, origin || '');
}
