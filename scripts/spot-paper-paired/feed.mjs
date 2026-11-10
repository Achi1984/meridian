import { createSpotPaperPairedKrakenProvider as createPairedProvider } from "./provider.mjs";
import {
  SPOT_PAPER_PAIRED, SPOT_PAPER_PAIRED_SOURCE_ID
} from "./forward.mjs";

export function createSpotPaperPairedKrakenProvider({
  signal, now, monotonicNow, deadlineAt, fetchImpl
} = {}) {
  const provider = createPairedProvider({
    signal, now, monotonicNow, deadlineAt, fetchImpl,
    maxRequests: SPOT_PAPER_PAIRED.maxRequests,
    maxBytes: SPOT_PAPER_PAIRED.maxBytes,
    requestTimeoutMs: SPOT_PAPER_PAIRED.requestTimeoutMs
  });
  return Object.freeze({
    sourceId: SPOT_PAPER_PAIRED_SOURCE_ID,
    transportAdapterVersion: provider.version,
    fetchOhlc: provider.fetchOhlc,
    fetchTicker: provider.fetchTicker,
    counters: provider.counters
  });
}
