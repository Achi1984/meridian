import {createHash, timingSafeEqual} from 'node:crypto';
import {readBoundedRequestBody} from './report-transfer-gateway.mjs';
import {
  PROGRESS_PATH, MAX_PROGRESS_BYTES, validIdentity, validateProgress
} from './scripts/spot-paper-paired-progress/contract.mjs';

export {PROGRESS_PATH, MAX_PROGRESS_BYTES};
export const PROGRESS_BODY_TIMEOUT_MS = 5_000;
const HASH = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
let active = 0;
const response = (status, body) => ({status, body});
const error = (status, reason, extra = {}) => response(status, {
  error: `spot_paper_paired_progress_${reason}`, ...extra
});

export function spotPaperPairedProgressGatewayConfig(env = process.env) {
  let expectedIdentity = null;
  const raw = String(env.MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_EXPECTED_IDENTITY_JSON ?? '');
  if (Buffer.byteLength(raw) <= 16_384) {
    try {
      const parsed = JSON.parse(raw);
      if (validIdentity(parsed)) expectedIdentity = parsed;
    } catch {}
  }
  const uploadTokenHash = String(
    env.MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256 ?? '').trim().toLowerCase();
  const reservedHashes = Object.entries(env)
    .filter(([name]) => name !== 'MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_UPLOAD_TOKEN_SHA256' &&
      /(?:READ|WRITE|UPLOAD).*TOKEN_SHA256$/.test(name))
    .map(([, value]) => String(value).trim().toLowerCase());
  for (const name of ['MERIDIAN_READ_TOKEN', 'MERIDIAN_WRITE_TOKEN',
    'MERIDIAN_PAPER_REPORT_UPLOAD_TOKEN', 'MERIDIAN_SPOT_PAPER_REPORT_UPLOAD_TOKEN']) {
    if (env[name]) reservedHashes.push(hash(String(env[name]).trim()));
  }
  const distinct = HASH.test(uploadTokenHash) && !reservedHashes.includes(uploadTokenHash);
  return Object.freeze({
    enabled: env.MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_ENABLED === 'true' &&
      env.MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_DEPLOYMENT_VERIFIED === 'true' &&
      expectedIdentity !== null && distinct,
    expectedIdentity,
    uploadTokenHash: distinct ? uploadTokenHash : null
  });
}

function authorizedUpload(req, config) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') ||
      !header.slice(7) || /\s/.test(header.slice(7)) ||
      !HASH.test(config?.uploadTokenHash ?? '')) return false;
  return timingSafeEqual(Buffer.from(hash(header.slice(7)), 'hex'),
    Buffer.from(config.uploadTokenHash, 'hex'));
}

async function storeCall(operation, write, release, signal, timeoutMs) {
  let timer;
  let rejectDeadline;
  const controller = new AbortController();
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const abort = () => {
    controller.abort();
    rejectDeadline(Object.assign(new Error('store deadline'), {
      code: write ? 'PAIRED_PROGRESS_OUTCOME_UNKNOWN' : 'STORE_TIMEOUT'
    }));
  };
  timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, {once: true});
  if (signal?.aborted) abort();
  const work = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw Object.assign(new Error('cancelled'), {
      code: write ? 'PAIRED_PROGRESS_OUTCOME_UNKNOWN' : 'STORE_TIMEOUT'
    });
    return operation(controller.signal);
  }).finally(release);
  try { return await Promise.race([work, deadline]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function handleSpotPaperPairedProgressGatewayRequest(req, {
  config, getStore, authorizedRead, signal,
  readBody = readBoundedRequestBody,
  storeTimeoutMs = 6_500
} = {}) {
  let url;
  try { url = new URL(req.url, 'http://gateway.invalid'); } catch { return null; }
  if (url.pathname !== PROGRESS_PATH) return null;
  const write = req.method === 'POST';
  if (!write && (typeof authorizedRead !== 'function' || !authorizedRead(req))) {
    return response(401, {error: 'read_token_required'});
  }
  if (!config?.enabled || !validIdentity(config.expectedIdentity) ||
      !HASH.test(config.uploadTokenHash ?? '')) return error(503, 'disabled');
  if (write && !authorizedUpload(req, config)) return error(401, 'upload_auth_required');
  if (!['GET', 'POST'].includes(req.method)) return response(405, {error: 'method_not_allowed'});
  if (url.search) return error(400, 'query_not_supported');
  if (!Number.isSafeInteger(storeTimeoutMs) || storeTimeoutMs < 1 ||
      storeTimeoutMs > 6_500) return error(503, 'store_unavailable');
  if (active >= 2) return error(503, 'busy');
  active++;
  let released = false;
  let transferred = false;
  const release = () => { if (!released) { released = true; active--; } };
  try {
    let store;
    try { store = getStore?.(); } catch {}
    if (!store || typeof store[write ? 'put' : 'get'] !== 'function') {
      return error(503, 'store_unavailable');
    }
    let payload;
    if (write) {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        String(req.headers?.['content-type'] ?? ''))) {
        return response(415, {error: 'unsupported_content_type'});
      }
      const length = req.headers?.['content-length'];
      if (length !== undefined && !/^(0|[1-9]\d*)$/.test(String(length))) {
        return response(400, {error: 'invalid_content_length'});
      }
      if (length !== undefined && Number(length) > MAX_PROGRESS_BYTES) {
        return response(413, {error: 'request_body_too_large'});
      }
      let bytes;
      try {
        bytes = await readBody(req, {
          maxBytes: MAX_PROGRESS_BYTES, timeoutMs: PROGRESS_BODY_TIMEOUT_MS, signal
        });
      } catch (cause) {
        if (cause?.code === 'BODY_TOO_LARGE') return response(413, {error: 'request_body_too_large'});
        if (['BODY_TIMEOUT', 'REQUEST_CANCELLED'].includes(cause?.code)) {
          return response(408, {error: 'request_body_timeout'});
        }
        return response(400, {error: 'invalid_request_body'});
      }
      if (!(bytes instanceof Uint8Array)) return response(400, {error: 'invalid_request_body'});
      if (bytes.byteLength > MAX_PROGRESS_BYTES) return response(413, {error: 'request_body_too_large'});
      if (length !== undefined && Number(length) !== bytes.byteLength) {
        return response(400, {error: 'invalid_content_length'});
      }
      try {
        payload = validateProgress(JSON.parse(
          new TextDecoder('utf-8', {fatal: true}).decode(bytes)), config.expectedIdentity);
      } catch {}
      if (!payload) return error(400, 'invalid');
    }
    transferred = true;
    const result = await storeCall(
      storeSignal => write ? store.put(payload, {signal: storeSignal}) :
        store.get(config.expectedIdentity, {signal: storeSignal}),
      write, release, signal, storeTimeoutMs);
    if (!write) {
      if (!result) return error(404, 'not_found');
      const clean = validateProgress(result, config.expectedIdentity);
      return clean ? response(200, clean) : error(503, 'corrupt');
    }
    if (result?.status === 'CONFLICT') return error(409, 'conflict');
    if (!['STORED', 'IDEMPOTENT'].includes(result?.status)) return error(503, 'outcome_unknown', {status: 'UNKNOWN'});
    return response(200, {
      schemaVersion: 'SPOT_PAPER_PAIRED_PROGRESS_RECEIPT_V1',
      status: 'ACCEPTED', journalSequence: payload.journalSequence,
      journalSha256: payload.journalSha256
    });
  } catch (cause) {
    if (cause?.code === 'STORE_BUSY') return error(503, 'busy');
    if (write) return error(503, 'outcome_unknown', {status: 'UNKNOWN'});
    return error(503, cause?.code === 'STORE_TIMEOUT' ? 'store_timeout' : 'store_unavailable');
  } finally {
    if (!transferred) release();
  }
}

export function writeSpotPaperPairedProgressRouteResponse(req, res, result, origin, writeJson) {
  if (!req.complete) {
    res.shouldKeepAlive = false;
    res.once('finish', () => { if (!req.complete) req.destroy(); });
  }
  return writeJson(res, result.status, result.body, origin || '');
}
