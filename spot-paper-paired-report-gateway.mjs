import {SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY as diagnosticIdentity}
  from './v11/spot-paper-paired-progress-config.js';
import {isValidSpotPaperPairedExpectedIdentity} from './scripts/spot-paper-paired-report/evaluate.mjs';
import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR,
  SPOT_PAPER_PAIRED_NEXT_RUN_MODELS
} from './scripts/spot-paper-paired-report/contract.mjs';
import {
  canonicalSpotPaperPairedReportJson,
  SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  SPOT_PAPER_PAIRED_REPORT_MAX_BYTES,
  spotPaperPairedReportDigest
} from './scripts/spot-paper-paired-report/envelope.mjs';

export const SPOT_PAPER_PAIRED_REPORT_PATH = '/api/private/spot-paper-paired-report';
export {
  SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA,
  SPOT_PAPER_PAIRED_REPORT_MAX_BYTES
};

const HASH = /^[a-f0-9]{64}$/;
const MAX_ACTIVE_REQUESTS = 2;
const MAX_CONFIGURED_IDENTITIES = 2;
const INTERRUPTED_RUN_ID = 'btc-eur-trend-host-8h-002';
const REPORT_LOOKUP_TIMEOUT_MS = 6_500;
const diagnosticConfig = Object.freeze({
  expectedIdentity: diagnosticIdentity,
  expectedRunId: diagnosticIdentity.runId,
  expectedConfigHash: diagnosticIdentity.configSha256
});
let activeRequests = 0;

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
    ...(identity.modelPairId ? {modelPairId: identity.modelPairId} : {}),
    models: identity.models.map(({role, modelId}) => ({role, modelId}))
  };
}

function response(status, body) {
  return {status, body};
}

export function spotPaperPairedReportGatewayConfig(env = process.env) {
  const rawExpected = String(env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITY_JSON ?? '');
  let expectedIdentity = null;
  let unsupportedIdentity = false;
  if (Buffer.byteLength(rawExpected) <= 16 * 1024) {
    try {
      const parsed = JSON.parse(rawExpected);
      unsupportedIdentity =
        parsed?.modelPairId !== undefined &&
          parsed.modelPairId !== SPOT_PAPER_PAIRED_NEXT_RUN_MODEL_PAIR ||
        parsed?.modelPairId === undefined &&
          parsed?.models?.some?.(model =>
            model.modelId === SPOT_PAPER_PAIRED_NEXT_RUN_MODELS[1]) === true;
      if (isValidSpotPaperPairedExpectedIdentity(parsed)) expectedIdentity = parsed;
    } catch {}
  }
  const featureEnabled =
    env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_ENABLED === 'true' &&
    env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_DEPLOYMENT_VERIFIED === 'true';
  let expectedIdentities = [];
  let invalidExpectedIdentities = false;
  const rawIdentities = String(
    env.MERIDIAN_SPOT_PAPER_PAIRED_REPORT_EXPECTED_IDENTITIES_JSON ?? '');
  if (rawIdentities) {
    try {
      if (Buffer.byteLength(rawIdentities) > 32 * 1024) {
        throw new Error('configured identity list too large');
      }
      const parsed = JSON.parse(rawIdentities);
      if (!Array.isArray(parsed) || parsed.length === 0 ||
          parsed.length > MAX_CONFIGURED_IDENTITIES ||
          parsed.some(identity => !isValidSpotPaperPairedExpectedIdentity(identity)) ||
          new Set(parsed.map(identity => identity.runId)).size !== parsed.length) {
        invalidExpectedIdentities = true;
      } else {
        expectedIdentities = parsed;
      }
    } catch {
      invalidExpectedIdentities = true;
    }
  }
  return Object.freeze({
    enabled: featureEnabled && expectedIdentity !== null,
    expectedIdentity,
    unsupportedIdentity: featureEnabled && unsupportedIdentity,
    expectedRunId: expectedIdentity?.runId ?? null,
    expectedConfigHash: expectedIdentity?.configSha256 ?? null,
    selectionEnabled: featureEnabled && !invalidExpectedIdentities &&
      expectedIdentities.length > 0,
    expectedIdentities: Object.freeze(expectedIdentities),
    invalidExpectedIdentities: featureEnabled && invalidExpectedIdentities
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

function selectedRunId(req) {
  let url;
  try { url = new URL(req.url, 'http://gateway.invalid'); }
  catch { return {malformed: true}; }
  if (!url.search) return {requested: false};
  const values = url.searchParams.getAll('runId');
  if ([...url.searchParams.keys()].length !== 1 || values.length !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(values[0])) {
    return {malformed: true};
  }
  return {requested: true, runId: values[0]};
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
    if (spotPaperPairedReportDigest(envelope) !== row.content_sha256) {
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
      canonicalSpotPaperPairedReportJson(report.identity) !==
        canonicalSpotPaperPairedReportJson(publicIdentity(config.expectedIdentity))) {
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
  const selection = selectedRunId(req);
  if (selection.malformed) {
    return response(400, {error: 'spot_paper_paired_report_query_not_supported'});
  }
  if (!selection.requested && config?.unsupportedIdentity === true) {
    return response(422, {error: 'spot_paper_paired_identity_unsupported'});
  }
  let selectedConfig = config;
  if (selection.requested) {
    if (req.method !== 'GET') return response(405, {error: 'method_not_allowed'});
    if (config?.selectionEnabled !== true ||
        !Array.isArray(config.expectedIdentities)) {
      return response(400, {error: 'spot_paper_paired_report_query_not_supported'});
    }
    const expectedIdentity = config.expectedIdentities.find(identity =>
      identity.runId === selection.runId);
    if (!expectedIdentity || !isValidSpotPaperPairedExpectedIdentity(expectedIdentity)) {
      return response(404, {error: 'spot_paper_paired_report_not_found'});
    }
    selectedConfig = {
      enabled: true,
      expectedIdentity,
      expectedRunId: expectedIdentity.runId,
      expectedConfigHash: expectedIdentity.configSha256
    };
  } else if (!configured(config)) {
    return response(503, {error: 'spot_paper_paired_transport_not_provisioned'});
  }
  if (req.method !== 'GET') return response(405, {error: 'method_not_allowed'});
  const release = enterRequest();
  if (!release) return response(503, {error: 'spot_paper_paired_report_busy'});
  try {
    let store;
    try { store = getStore?.(); } catch { store = null; }
    if (!store || typeof store.get !== 'function') {
      return response(503, {error: 'spot_paper_paired_report_store_unavailable'});
    }
    const useDiagnosticFallback = !selection.requested &&
      config.expectedRunId === INTERRUPTED_RUN_ID;
    const deadline = useDiagnosticFallback
      ? AbortSignal.timeout(REPORT_LOOKUP_TIMEOUT_MS) : null;
    const lookupSignal = deadline && signal ? AbortSignal.any([signal, deadline])
      : deadline ?? signal;
    try {
      const row = await store.get(selectedConfig.expectedRunId, {signal: lookupSignal});
      if (row) return decodeRow(row, selectedConfig);

      if (useDiagnosticFallback) {
        lookupSignal.throwIfAborted();
        // This interrupted run has no final report. Use only the reviewed diagnostic identity.
        const diagnosticRow = await store.get(diagnosticConfig.expectedRunId, {signal: lookupSignal});
        if (diagnosticRow) {
          const result = decodeRow(diagnosticRow, diagnosticConfig);
          if (result.status === 200 && (result.body.report.evidenceStatus !== 'VERIFIED_COMPLETE' ||
              result.body.report.syntheticFixture !== false)) {
            return response(422, {error: 'spot_paper_paired_report_invalid'});
          }
          return result;
        }
      }
      return response(404, {error: 'spot_paper_paired_report_not_found'});
    } catch (error) {
      if (deadline?.aborted) return response(503, {error: 'spot_paper_paired_report_store_timeout'});
      return unavailable(error);
    }
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
