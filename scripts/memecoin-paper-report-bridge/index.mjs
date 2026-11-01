import {
  decodePaperReportEnvelope,
  MAX_PAPER_REPORT_BYTES,
  MAX_PAPER_REPORT_TIMEOUT_MS,
  PAPER_REPORT_ENVELOPE_SCHEMA,
  PAPER_REPORT_SCHEMA,
  PaperReportContractError
} from './contract.mjs';

export {
  decodePaperReportEnvelope,
  MAX_PAPER_REPORT_BYTES,
  MAX_PAPER_REPORT_TIMEOUT_MS,
  PAPER_REPORT_ENVELOPE_SCHEMA,
  PAPER_REPORT_SCHEMA,
  PaperReportContractError
};

const timeoutBounds = timeoutMs =>
  Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= MAX_PAPER_REPORT_TIMEOUT_MS;

function result(status, reason = null) {
  return {status, reason, runId: null, report: null, freshness: null};
}

export function createPaperReportBridge({
  readSource,
  enabled = false,
  timeoutMs = 5_000,
  staleAfterMs = null,
  now = Date.now,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (typeof readSource !== 'function') throw new TypeError('readSource must be an injected source reader');
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be an explicit boolean');
  if (!timeoutBounds(timeoutMs)) throw new RangeError('timeoutMs is outside the supported bound');
  if (typeof now !== 'function' || typeof schedule !== 'function' ||
      typeof cancelSchedule !== 'function') {
    throw new TypeError('clock and timer functions are required');
  }

  let disposed = false;
  let active = null;

  function read() {
    if (disposed) return Promise.resolve(result('DISPOSED'));
    if (!enabled) return Promise.resolve(result('DISABLED'));
    if (active) return Promise.resolve(result('BUSY', 'READ_ALREADY_IN_PROGRESS'));

    const controller = new AbortController();
    const work = {controller, sourceSettled: false, returned: false, resolveDisposed: null};
    active = work;
    const clearIfSettled = () => {
      work.sourceSettled = true;
      if (work.returned && active === work) active = null;
    };
    const source = Promise.resolve().then(() => readSource({signal: controller.signal}));
    source.then(clearIfSettled, clearIfSettled);

    let timer;
    let timerSet = false;
    const timeout = new Promise(resolve => {
      try {
        timer = schedule(() => {
          controller.abort();
          resolve(result('TIMEOUT', 'SOURCE_TIMEOUT'));
        }, timeoutMs);
        timerSet = timer !== undefined && timer !== null;
      } catch {
        controller.abort();
        resolve(result('UNAVAILABLE', 'TIMER_UNAVAILABLE'));
      }
      if (!timerSet) {
        controller.abort();
        resolve(result('UNAVAILABLE', 'TIMER_UNAVAILABLE'));
      }
    });
    const disposedResult = new Promise(resolve => { work.resolveDisposed = resolve; });
    const projected = source.then(input => {
      if (controller.signal.aborted || disposed) {
        return result(disposed ? 'DISPOSED' : 'TIMEOUT',
          disposed ? null : 'SOURCE_TIMEOUT');
      }
      if (input === null || input === undefined) return result('UNAVAILABLE', 'REPORT_MISSING');
      try {
        const currentTime = now();
        return decodePaperReportEnvelope(input, {now: currentTime, staleAfterMs});
      } catch (error) {
        const reason = error instanceof PaperReportContractError ? error.code : 'SOURCE_READ_FAILED';
        return result(error instanceof PaperReportContractError ? 'REJECTED' : 'UNAVAILABLE', reason);
      }
    }, error => {
      if (controller.signal.aborted || disposed) {
        return result(disposed ? 'DISPOSED' : 'TIMEOUT',
          disposed ? null : 'SOURCE_TIMEOUT');
      }
      const code = error instanceof PaperReportContractError ? error.code : 'SOURCE_READ_FAILED';
      const rejected = ['AUTH_REQUIRED', 'OVERSIZED', 'INVALID_CONTENT_TYPE', 'INVALID_RESPONSE_BODY',
        'INVALID_INPUT', 'INVALID_JSON', 'UNSUPPORTED_ENVELOPE', 'UNSUPPORTED_SCHEMA',
        'INVALID_DTO', 'DTO_LIMIT', 'RUN_ID_MISMATCH', 'INVALID_IDENTITY',
        'INVALID_PROVENANCE', 'FUTURE_OBSERVATION', 'INVALID_OBSERVATION_WINDOW',
        'INVALID_FRESHNESS_POLICY'].includes(code);
      return result(rejected ? 'REJECTED' : 'UNAVAILABLE', code);
    });

    return Promise.race([projected, timeout, disposedResult]).then(outcome => {
      if (!['AVAILABLE', 'STALE'].includes(outcome.status)) controller.abort();
      return outcome;
    }).finally(() => {
      work.returned = true;
      if (timerSet) {
        try { cancelSchedule(timer); } catch { }
      }
      if (work.sourceSettled && active === work) active = null;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (active) {
      active.controller.abort();
      active.resolveDisposed?.(result('DISPOSED'));
    }
  }

  return Object.freeze({read, dispose});
}

export async function readBoundedPaperResponse(response, signal) {
  const body = response?.body;
  let reader = null;
  let abort;
  const cancel = () => {
    try {
      const pending = reader ? reader.cancel() : body?.cancel?.();
      return Promise.resolve(pending).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };
  const chunks = [];
  let size = 0;
  try {
    if (body?.getReader) {
      try {
        reader = body.getReader();
      } catch {
        throw new PaperReportContractError('INVALID_RESPONSE_BODY');
      }
    }
    if (signal?.aborted) throw new PaperReportContractError('REQUEST_ABORTED');
    const status = response?.status;
    if (status === 401 || status === 403) throw new PaperReportContractError('AUTH_REQUIRED');
    if (status !== 200 || response?.ok !== true) {
      throw new PaperReportContractError('SOURCE_HTTP_UNAVAILABLE');
    }
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new PaperReportContractError('INVALID_CONTENT_TYPE');
    }
    const contentLength = response.headers?.get?.('content-length');
    if (contentLength !== null && contentLength !== undefined &&
        (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_PAPER_REPORT_BYTES)) {
      throw new PaperReportContractError('OVERSIZED');
    }
    if (!reader) throw new PaperReportContractError('INVALID_RESPONSE_BODY');

    abort = () => cancel();
    signal?.addEventListener('abort', abort, {once: true});
    while (true) {
      if (signal?.aborted) throw new PaperReportContractError('REQUEST_ABORTED');
      const {done, value} = await reader.read();
      if (signal?.aborted) throw new PaperReportContractError('REQUEST_ABORTED');
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new PaperReportContractError('INVALID_RESPONSE_BODY');
      size += value.byteLength;
      if (size > MAX_PAPER_REPORT_BYTES || chunks.length >= 1_024) {
        throw new PaperReportContractError('OVERSIZED');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    const cancellation = cancel();
    try { reader?.releaseLock(); } catch { }
    await cancellation;
  }
}
