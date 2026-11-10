import { createKrakenProvider } from "../spot-paper-pilot/provider.mjs";
import { SPOT_PAPER_PILOT_LIMITS } from "../spot-paper-pilot/core.mjs";

export const SPOT_PAPER_PAIRED_TRANSPORT_ADAPTER_VERSION =
  "SPOT_PAPER_PAIRED_KRAKEN_TRANSPORT_ADAPTER_V1";

function instrumentResponse(response, onTransportState) {
  onTransportState?.("BODY", 0);
  if (!response.body) {
    return {
      ok: response.ok, status: response.status,
      headers: response.headers, body: null
    };
  }
  const body = {
    getReader() {
      const reader = response.body.getReader();
      let bytes = 0;
      return {
        async read() {
          const result = await reader.read();
          if (result.done) {
            onTransportState?.("RESPONSE", bytes);
          } else {
            bytes += result.value.byteLength;
            onTransportState?.("BODY",
              Math.min(bytes, SPOT_PAPER_PILOT_LIMITS.maxResponseBytes));
          }
          return result;
        },
        cancel: reason => reader.cancel(reason),
        releaseLock: () => reader.releaseLock()
      };
    },
    cancel: reason => response.body.cancel(reason)
  };
  return {
    ok: response.ok, status: response.status,
    headers: response.headers, body
  };
}

export function createSpotPaperPairedKrakenProvider({
  signal, now, monotonicNow, deadlineAt, fetchImpl = globalThis.fetch,
  maxRequests, maxBytes, requestTimeoutMs
} = {}) {
  let activeTransportState = null;
  const provider = createKrakenProvider({
    signal, now, monotonicNow, deadlineAt,
    maxRequests, maxBytes, requestTimeoutMs,
    fetchImpl: async (url, options) => {
      const state = activeTransportState;
      state?.onTransportState?.("HEADERS", 0);
      const response = await fetchImpl(url, options);
      return instrumentResponse(response, state?.onTransportState);
    }
  });
  const fetch = method => runtime => {
    const state = {onTransportState: runtime?.onTransportState};
    activeTransportState = state;
    return provider[method](runtime).finally(() => {
      if (activeTransportState === state) activeTransportState = null;
    });
  };
  return Object.freeze({
    version: SPOT_PAPER_PAIRED_TRANSPORT_ADAPTER_VERSION,
    fetchOhlc: fetch("fetchOhlc"),
    fetchTicker: fetch("fetchTicker"),
    counters: provider.counters
  });
}
