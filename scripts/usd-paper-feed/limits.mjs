import { PAPER_CAPITAL_CHALLENGE_POLICY as POLICY } from "../paper-capital-challenge/policy.mjs";

export const USD_PAPER_FEED_LIMITS = Object.freeze({
  pair: "BTC/USD",
  krakenPair: "XBTUSD",
  intervalMinutes: 1,
  maxEvents: POLICY.maxJournalObservations,
  maxRequests: POLICY.maxJournalObservations * 2,
  maxResponseBytes: 128 * 1024,
  maxBytes: 32 * 1024 * 1024,
  maxSpanMs: 24 * 60 * 60 * 1000,
  maxClosedMinuteAgeMs: 120_000,
  minSampleIntervalMs: 60_000,
  requestTimeoutMs: 5_000,
  maxQuoteAgeMs: POLICY.maxValuationAgeMs
});
