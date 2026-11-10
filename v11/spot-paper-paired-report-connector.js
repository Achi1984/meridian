import {
  projectSpotPaperPairedDashboard,
  SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA
} from '../scripts/spot-paper-paired-report/contract.mjs?v=B16-M11-FIX15';

export const SPOT_PAPER_PAIRED_REPORT_ENDPOINT =
  'https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/spot-paper-paired-report';
export const SPOT_PAPER_PAIRED_REPORT_TIMEOUT_MS = 8_000;
export const SPOT_PAPER_PAIRED_REPORT_MAX_BYTES = 256 * 1024;
export const SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA =
  'SPOT_PAPER_PAIRED_REPORT_ENVELOPE_V1';

const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value);

function outcome(status, report = null, reason = null) {
  return {status, report, reason};
}

async function readJson(response, signal) {
  if (!/^application\/json(?:\s*;|$)/i.test(
    response.headers?.get?.('content-type') ?? '')) {
    throw new Error('INVALID_CONTENT_TYPE');
  }
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined &&
      (!/^\d+$/.test(length) || Number(length) > SPOT_PAPER_PAIRED_REPORT_MAX_BYTES)) {
    throw new Error('RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('INVALID_RESPONSE_BODY');
  let size = 0;
  const chunks = [];
  let abort;
  const cancel = async () => {
    try { await reader.cancel(); } catch {}
  };
  try {
    abort = () => { void cancel(); };
    signal?.addEventListener('abort', abort, {once: true});
    while (true) {
      if (signal?.aborted) throw new Error('REQUEST_ABORTED');
      const {done, value} = await reader.read();
      if (signal?.aborted) throw new Error('REQUEST_ABORTED');
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('INVALID_RESPONSE_BODY');
      size += value.byteLength;
      if (size > SPOT_PAPER_PAIRED_REPORT_MAX_BYTES) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    await cancel();
    try { reader.releaseLock(); } catch {}
  }
}

async function readResponse(response, signal) {
  if (response?.status === 401 || response?.status === 403) {
    try { await response.body?.cancel(); } catch {}
    return outcome('AUTH_REQUIRED');
  }
  if (response?.status === 404) {
    try { await response.body?.cancel(); } catch {}
    return outcome('NOT_FOUND');
  }
  let envelope;
  try {
    envelope = await readJson(response, signal);
  } catch (error) {
    if (signal?.aborted) return outcome('ABORTED');
    return outcome('REJECTED', null, error?.message || 'INVALID_RESPONSE');
  }
  if (response?.status === 503) {
    return outcome(envelope?.error === 'spot_paper_paired_transport_not_provisioned' ?
      'TRANSPORT_UNAVAILABLE' : 'UNAVAILABLE', null, envelope?.error || null);
  }
  if (response?.status === 409 ||
      envelope?.error === 'spot_paper_paired_identity_mismatch') {
    return outcome('IDENTITY_MISMATCH', null, envelope?.error || null);
  }
  if (envelope?.error === 'spot_paper_paired_identity_unsupported') {
    return outcome('UNSUPPORTED_IDENTITY', null, envelope.error);
  }
  if (response?.status === 422 &&
      envelope?.error === 'spot_paper_paired_schema_unsupported') {
    return outcome('UNSUPPORTED_SCHEMA', null, envelope.error);
  }
  if (response?.status === 422 ||
      envelope?.error === 'spot_paper_paired_report_invalid') {
    return outcome('REJECTED', null, envelope?.error || 'PAIRED_REPORT_INVALID');
  }
  if (response?.status !== 200 || response?.ok !== true) {
    return outcome('UNAVAILABLE', null, envelope?.error || null);
  }
  if (!record(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'report,runId,schema' ||
      envelope.schema !== SPOT_PAPER_PAIRED_REPORT_ENVELOPE_SCHEMA ||
      envelope.report?.schemaVersion !== SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA) {
    return outcome('UNSUPPORTED_SCHEMA', null, 'PAIRED_REPORT_SCHEMA_UNSUPPORTED');
  }
  const report = projectSpotPaperPairedDashboard(envelope.report);
  if (!report) return outcome('REJECTED', null, 'PAIRED_REPORT_INVALID');
  if (report.identity.runId !== envelope.runId || report.identity.pair !== 'BTC/EUR') {
    return outcome('IDENTITY_MISMATCH', null, 'PAIRED_REPORT_IDENTITY_MISMATCH');
  }
  return outcome('AVAILABLE', report);
}

export function createSpotPaperPairedReportConnector({
  transport,
  enabled = false,
  timeoutMs = SPOT_PAPER_PAIRED_REPORT_TIMEOUT_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (typeof enabled !== 'boolean' || enabled && typeof transport !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
      typeof schedule !== 'function' || typeof cancelSchedule !== 'function') {
    throw new TypeError('spot-paper paired report connector dependencies are invalid');
  }
  let active = null;
  let disposed = false;

  function read() {
    if (disposed) return Promise.resolve(outcome('DISPOSED'));
    if (!enabled) return Promise.resolve(outcome('TRANSPORT_UNAVAILABLE'));
    if (active) return Promise.resolve(outcome('BUSY'));
    const controller = new AbortController();
    const work = {controller, returned: false, settled: false, resolveDisposed: null};
    active = work;
    const release = () => {
      work.settled = true;
      if (work.returned && active === work) active = null;
    };
    const source = Promise.resolve().then(() => transport({signal: controller.signal}));
    const projected = source.then(response => readResponse(response, controller.signal),
      error => outcome(controller.signal.aborted ? 'ABORTED' : 'UNAVAILABLE',
        null, error?.message || null));
    projected.then(release, release);
    let timer;
    let timerSet = false;
    const timeout = new Promise(resolve => {
      try {
        timer = schedule(() => {
          controller.abort();
          resolve(outcome('TIMEOUT'));
        }, timeoutMs);
        timerSet = timer !== undefined && timer !== null;
      } catch {}
      if (!timerSet) {
        controller.abort();
        resolve(outcome('UNAVAILABLE', null, 'TIMER_UNAVAILABLE'));
      }
    });
    const disposedResult = new Promise(resolve => { work.resolveDisposed = resolve; });
    return Promise.race([projected, timeout, disposedResult]).finally(() => {
      work.returned = true;
      if (timerSet) {
        try { cancelSchedule(timer); } catch {}
      }
      if (work.settled && active === work) active = null;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (!active) return;
    active.controller.abort();
    active.resolveDisposed?.(outcome('DISPOSED'));
  }

  return Object.freeze({read, dispose, isBusy: () => active !== null,
    isDisposed: () => disposed});
}
