import {
  createPaperReportBridge,
  readBoundedPaperResponse
} from '../scripts/memecoin-paper-report-bridge/index.mjs';

export function createPaperReportConnector({
  transport,
  enabled = false,
  timeoutMs = 5_000,
  staleAfterMs = null,
  now = Date.now,
  schedule = setTimeout,
  cancelSchedule = clearTimeout
} = {}) {
  if (enabled && typeof transport !== 'function') {
    throw new TypeError('enabled transport must be an injected authenticated reader');
  }
  const bridge = createPaperReportBridge({
    readSource: typeof transport === 'function'
      ? async ({signal}) => readBoundedPaperResponse(await transport({signal}), signal)
      : async () => null,
    enabled,
    timeoutMs,
    staleAfterMs,
    now,
    schedule,
    cancelSchedule
  });
  return Object.freeze({
    read: () => bridge.read(),
    dispose: () => bridge.dispose()
  });
}
