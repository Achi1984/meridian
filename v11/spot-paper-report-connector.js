import {
  isSpotPaperReportEnvelope,
  readBoundedSpotPaperResponse,
  SPOT_PAPER_REPORT_TIMEOUT_MS
} from '../scripts/spot-paper-report-bridge/contract.mjs?v=B16-M11-FIX15';

function outcome(status, report = null, reason = null) {
  return {status, report, reason};
}

export function createSpotPaperReportConnector({
  transport,
  enabled = false,
  timeoutMs = SPOT_PAPER_REPORT_TIMEOUT_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (typeof enabled !== 'boolean' || (enabled && typeof transport !== 'function') ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
      typeof schedule !== 'function' || typeof cancelSchedule !== 'function') {
    throw new TypeError('spot-paper report connector dependencies are invalid');
  }
  let active = null;
  let disposed = false;

  function read() {
    if (disposed) return Promise.resolve(outcome('DISPOSED'));
    if (!enabled) return Promise.resolve(outcome('DISABLED'));
    if (active) return Promise.resolve(outcome('BUSY', null, 'READ_ALREADY_IN_PROGRESS'));
    const controller = new AbortController();
    const work = {controller, returned: false, settled: false, resolveDisposed: null};
    active = work;
    const release = () => {
      work.settled = true;
      if (work.returned && active === work) active = null;
    };
    const source = Promise.resolve().then(() => transport({signal: controller.signal}));
    const projected = source.then(async response => {
      try {
        const envelope = await readBoundedSpotPaperResponse(response, controller.signal);
        if (controller.signal.aborted || disposed) return outcome(disposed ? 'DISPOSED' : 'ABORTED');
        if (!isSpotPaperReportEnvelope(envelope)) {
          return outcome('REJECTED', null, 'INVALID_SPOT_PAPER_REPORT');
        }
        return outcome('AVAILABLE', envelope.report);
      } catch (error) {
        if (controller.signal.aborted || disposed) return outcome(disposed ? 'DISPOSED' : 'ABORTED');
        return outcome(error?.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' :
          error?.code === 'SOURCE_UNAVAILABLE' ? 'UNAVAILABLE' : 'REJECTED',
          null, error?.message || 'INVALID_RESPONSE');
      }
    }, error => outcome(error?.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UNAVAILABLE'));
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

  return Object.freeze({
    read,
    dispose,
    isBusy: () => active !== null,
    isDisposed: () => disposed
  });
}
