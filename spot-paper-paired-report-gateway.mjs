import {createHash} from 'node:crypto';
import {isValidSpotPaperPairedExpectedIdentity} from './scripts/spot-paper-paired-report/evaluate.mjs';
import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA
} from './scripts/spot-paper-paired-report/contract.mjs';

export const SPOT_PAPER_PAIRED_REPORT_PATH = '/api/private/spot-paper-paired-report';
export const SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA =
  'SPOT_PAPER_PAIRED_REPORT_ENVELOPE_V1';
export const SPOT_PAPER_PAIRED_REPORT_MAX_BYTES = 256 * 1024;

const HASH = /^[a-f0-9]{64}$/;
const MAX_ACTIVE_REQUESTS = 2;
const UNSUPPORTED_MODEL_IDS = new Set([
  'BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1'
]);
let activeRequests = 0;

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError('invalid_json_number');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new TypeError('invalid_json_value');
  return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function publicIdentity(identity) {
  return {
    runId: identity.runId,
    pair: identity.pair,
    sourceSha256: identity.sourceSha256,
    configSha256: identity.configSha256,
    researchSourceSha256: identity.researchSourceSha256,
    models: identity.models.map(({role, modelId}) => ({role, modelId}))
  };
}

function response(status, body) {
  return {status, body};
}

export function spotPaperPairedReportGatewayConfig(env = process.env) {
  const rawExpected = String(env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON ?? '');
  let expectedIdentity = null;
  if (Buffer.byteLength(rawExpected) <= 16 * 1024) {
    try {
      const parsed = JSON.parse(rawExpected);
      if (isValidSpotPaperPairedExpectedIdentity(parsed)) expectedIdentity = parsed;
    } catch {}
  }
  return Object.freeze({
    enabled: env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED === 'true' &&
      env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED === 'true' &&
      expectedIdentity !== null,
    expectedIdentity,
    unsupportedIdentity: expectedIdentity?.models.some(model =>
      UNSUPPORTED_MODEL_IDS.has(model.modelId)) ?? false,
    expectedRunId: expectedIdentity?.runId ?? null,
    expectedConfigHash: expectedIdentity?.configSha256 ?? null
  });
}

function configured(config) {
  return config?.enabled === true &&
    isValidSpotPaperPairedExpectedIdentity(config.expectedIdentity) &&
    config.expectedRunId === config.expectedIdentity.runId &&
    config.expectedConfigHash === config.expectedIdentity.configSha256;
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
  if (error?.code === 'STORE_BUSY') {
    return response(503, {error: 'spot_paper_paired_report_busy'});
  }
  if (error?.code === 'STORE_TIMEOUT') {
    return response(503, {error: 'spot_paper_paired_report_store_timeout'});
  }
  return response(503, {error: 'spot_paper_paired_report_store_unavailable'});
}

function queryPresent(req) {
  try {
    return new URL(req.url, 'http://gateway.invalid').search.length > 0;
  } catch {
    return true;
  }
}

function decodeRow(row, config) {
  if (row.run_id !== config.expectedRunId ||
      row.config_hash !== config.expectedConfigHash) {
    return response(409, {error: 'spot_paper_paired_identity_mismatch'});
  }
  if (!HASH.test(String(row.content_sha256 ?? ''))) {
    return response(503, {error: 'spot_paper_paired_report_corrupt'});
  }
  let envelope;
  try {
    envelope = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
    const canonical = canonicalJson(envelope);
    if (Buffer.byteLength(canonical, 'utf8') > SPOT_PAPER_PAIRED_REPORT_MAX_BYTES ||
        digest(Buffer.from(canonical, 'utf8')) !== row.content_sha256) {
      return response(503, {error: 'spot_paper_paired_report_corrupt'});
    }
  } catch {
    return response(503, {error: 'spot_paper_paired_report_corrupt'});
  }
  if (!exactKeys(envelope, ['schema', 'runId', 'report']) ||
      envelope.schema !== SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA ||
      envelope.report?.schemaVersion !== SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA) {
    return response(422, {error: 'spot_paper_paired_schema_unsupported'});
  }
  const report = projectSpotPaperPairedDashboard(envelope.report);
  if (!report) return response(422, {error: 'spot_paper_paired_report_invalid'});
  if (envelope.runId !== config.expectedRunId ||
      canonicalJson(report.identity) !== canonicalJson(publicIdentity(config.expectedIdentity))) {
    return response(409, {error: 'spot_paper_paired_identity_mismatch'});
  }
  return response(200, {
    schema: SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
    runId: config.expectedRunId,
    report
  });
}

async function read(req, {config, getStore, authorizedRead, signal}) {
  if (typeof authorizedRead !== 'function' || !authorizedRead(req)) {
    return response(401, {error: 'read_token_required'});
  }
  if (!configured(config)) {
    return response(503, {error: 'spot_paper_paired_transport_not_provisioned'});
  }
  if (config.unsupportedIdentity) {
    return response(422, {error: 'spot_paper_paired_identity_unsupported'});
  }
  if (req.method !== 'GET') return response(405, {error: 'method_not_allowed'});
  if (queryPresent(req)) {
    return response(400, {error: 'spot_paper_paired_report_query_not_supported'});
  }
  const release = enterRequest();
  if (!release) return response(503, {error: 'spot_paper_paired_report_busy'});
  try {
    let store;
    try { store = getStore?.(); } catch { store = null; }
    if (!store || typeof store.get !== 'function') {
      return response(503, {error: 'spot_paper_paired_report_store_unavailable'});
    }
    let row;
    try {
      row = await store.get(config.expectedRunId, {signal});
    } catch (error) {
      return unavailable(error);
    }
    if (!row) return response(404, {error: 'spot_paper_paired_report_not_found'});
    return decodeRow(row, config);
  } finally {
    release();
  }
}

export async function handleSpotPaperPairedReportGatewayRequest(req, {
  config, getStore, authorizedRead, signal
} = {}) {
  let pathname;
  try { pathname = new URL(req.url, 'http://gateway.invalid').pathname; }
  catch { return null; }
  if (pathname !== SPOT_PAPER_PAIRED_REPORT_PATH) return null;
  return read(req, {config, getStore, authorizedRead, signal});
}

export function writeSpotPaperPairedReportRouteResponse(req, res, result, origin, writeJson) {
  if (!req.complete) {
    res.shouldKeepAlive = false;
    res.once('finish', () => {
      if (!req.complete) req.destroy();
    });
  }
  return writeJson(res, result.status, result.body, origin || '');
}
