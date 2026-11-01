import {
  createPaperReportBridge,
  readBoundedPaperResponse
} from '../scripts/memecoin-paper-report-bridge/index.mjs?v=B16-M11-FIX12';

export function createPaperReportConnector({
  transport,
  enabled = false,
  timeoutMs = 5_000,
  staleAfterMs = null,
  freshnessPolicy = null,
  now = Date.now,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (enabled && typeof transport !== 'function') {
    throw new TypeError('enabled transport must be an injected authenticated reader');
  }
  if (freshnessPolicy !== null &&
      (typeof freshnessPolicy !== 'object' ||
       typeof freshnessPolicy.now !== 'function' ||
       !(freshnessPolicy.staleAfterMs === null ||
         (Number.isSafeInteger(freshnessPolicy.staleAfterMs) && freshnessPolicy.staleAfterMs >= 0)))) {
    throw new TypeError('freshnessPolicy must provide a clock and display threshold');
  }
  let sourcePending = false;
  let disposed = false;
  const bridge = createPaperReportBridge({
    readSource: async ({signal}) => {
      if (typeof transport !== 'function') return null;
      sourcePending = true;
      try {
        return await readBoundedPaperResponse(await transport({signal}), signal);
      } finally {
        sourcePending = false;
      }
    },
    enabled,
    timeoutMs,
    staleAfterMs: freshnessPolicy ? freshnessPolicy.staleAfterMs : staleAfterMs,
    now: freshnessPolicy?.now ?? now,
    schedule,
    cancelSchedule
  });
  return Object.freeze({
    read: () => bridge.read(),
    dispose() {
      if (disposed) return;
      disposed = true;
      bridge.dispose();
    },
    isBusy: () => sourcePending,
    isDisposed: () => disposed
  });
}
