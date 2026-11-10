import {
  MAX_PROGRESS_BYTES, PROGRESS_ENDPOINT, canonicalJson, validIdentity, validateProgress
} from '../scripts/spot-paper-paired-progress/contract.mjs?v=B16-M11-FIX15';

export const SPOT_PAPER_PAIRED_PROGRESS_ENDPOINT = PROGRESS_ENDPOINT;
export const SPOT_PAPER_PAIRED_PROGRESS_TIMEOUT_MS = 8_000;

const outcome = (status, progress = null, ageMs = null) => ({status, progress, ageMs});

async function cancelResponse(response) {
  try { await response?.body?.cancel(); } catch {}
}

async function readJson(response, signal) {
  let reader;
  let cancellation;
  const cancel = () => {
    if (!cancellation) cancellation = Promise.resolve().then(() => reader.cancel()).catch(() => {});
    return cancellation;
  };
  const abort = () => { void cancel(); };
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(
      response.headers?.get?.('content-type') ?? '')) throw new Error();
    const length = response.headers?.get?.('content-length');
    if (length != null && (!/^\d+$/.test(length) ||
        Number(length) > MAX_PROGRESS_BYTES)) throw new Error();
    reader = response.body?.getReader?.();
    if (!reader) throw new Error();
    signal.addEventListener('abort', abort, {once: true});
    const chunks = [];
    let size = 0;
    while (true) {
      if (signal.aborted) throw new Error();
      const {done, value} = await reader.read();
      if (signal.aborted) throw new Error();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error();
      size += value.byteLength;
      if (size > MAX_PROGRESS_BYTES) throw new Error();
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
    signal.removeEventListener('abort', abort);
    if (reader) {
      await cancel();
      try { reader.releaseLock(); } catch {}
    } else await cancelResponse(response);
  }
}

export function createSpotPaperPairedProgressConnector({
  transport,
  expectedIdentity,
  enabled = false,
  now,
  staleAfterMs,
  timeoutMs = SPOT_PAPER_PAIRED_PROGRESS_TIMEOUT_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (typeof enabled !== 'boolean' || enabled && typeof transport !== 'function' ||
      !validIdentity(expectedIdentity) || typeof now !== 'function' ||
      !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
      typeof schedule !== 'function' || typeof cancelSchedule !== 'function') {
    throw new TypeError('Invalid paired-progress connector configuration');
  }
  const identity = JSON.parse(canonicalJson(expectedIdentity));
  let active = null;
  let disposed = false;

  async function project(response, signal, deadlineAt) {
    if (signal.aborted || disposed) {
      await cancelResponse(response);
      return outcome('ABORTED');
    }
    if (performance.now() >= deadlineAt) {
      await cancelResponse(response);
      return outcome('TIMEOUT');
    }
    if (response?.redirected || response?.type === 'opaqueredirect' ||
        response?.url && response.url !== PROGRESS_ENDPOINT) {
      await cancelResponse(response);
      return outcome('REJECTED');
    }
    if (response?.status !== 200 || response?.ok !== true) {
      await cancelResponse(response);
      return outcome(response?.status === 401 || response?.status === 403 ?
        'AUTH_REQUIRED' : response?.status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE');
    }
    const raw = await readJson(response, signal);
    if (signal.aborted || disposed) return outcome('ABORTED');
    if (performance.now() >= deadlineAt) return outcome('TIMEOUT');
    const progress = validateProgress(raw, identity);
    if (!progress) return outcome('REJECTED');
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0 ||
        [progress.valuationAt, progress.observedAt, progress.exportedAt,
          progress.latestEventAt].some(time => time > current)) return outcome('REJECTED');
    const ageMs = current - progress.valuationAt;
    return outcome(ageMs > staleAfterMs ? 'STALE' : 'AVAILABLE', progress, ageMs);
  }

  function read() {
    if (disposed) return Promise.resolve(outcome('DISPOSED'));
    if (!enabled) return Promise.resolve(outcome('DISABLED'));
    if (active) return Promise.resolve(outcome('BUSY'));
    const controller = new AbortController();
    const deadlineAt = performance.now() + timeoutMs;
    const work = {controller, returned: false, settled: false, resolveDisposed: null};
    active = work;
    const projected = Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      return transport({signal: controller.signal});
    }).then(response => project(response, controller.signal, deadlineAt))
      .catch(error => outcome(controller.signal.aborted ? 'ABORTED' :
        error?.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'REJECTED'));
    const release = () => {
      work.settled = true;
      if (work.returned && active === work) active = null;
    };
    projected.then(release, release);
    let timer;
    const timeout = new Promise(resolve => {
      try {
        timer = schedule(() => {
          controller.abort();
          resolve(outcome('TIMEOUT'));
        }, timeoutMs);
      } catch {}
      if (timer == null) {
        controller.abort();
        resolve(outcome('UNAVAILABLE'));
      }
    });
    const disposal = new Promise(resolve => { work.resolveDisposed = resolve; });
    return Promise.race([projected, timeout, disposal]).finally(() => {
      work.returned = true;
      if (timer != null) {
        try { cancelSchedule(timer); } catch {}
      }
      if (work.settled && active === work) active = null;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active?.controller.abort();
    active?.resolveDisposed?.(outcome('DISPOSED'));
  }

  return Object.freeze({read, dispose, isBusy: () => active !== null,
    isDisposed: () => disposed});
}
