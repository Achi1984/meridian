import {syntheticCandidate, SYNTHETIC_SMART_WALLET_ALLOWLIST} from "../../../scripts/memecoin-paper/synthetic-fixtures.mjs";

export const START = Date.parse("2026-01-01T19:00:00Z");
export const END = START + 8 * 60 * 60 * 1000;
export const RUN = "execution-step-test";

export function candidate(now = START, index = 0) {
  const mint = index === 0 ? "So11111111111111111111111111111111111111112"
    : `${"1".repeat(31)}${index + 1}`;
  const result = syntheticCandidate(now, {mint});
  for (const item of [...Object.values(result.evidence), ...Object.values(result.analystEvidence)]) {
    item.binding.mint = mint;
  }
  return result;
}

export function authorization(eventId = "authorize", options = {}) {
  return {
    eventId, tickId: eventId, candidate: candidate(),
    smartWalletAllowlist: {...SYNTHETIC_SMART_WALLET_ALLOWLIST},
    now: START + 1000, marks: [], ...options
  };
}

export function quote(token, eventId, observedAt, priceMicros = 10_000) {
  return {
    eventId, mint: token.mint, chainId: token.chainId, pool: token.pool, quote: token.quote,
    source: token.source, decimals: token.decimals, observedAt, priceMicros,
    mode: "HYPOTHETICAL", executable: true,
    costs: {feeCents: 0, spreadCents: 0, slippageCents: 0, priceImpactCents: 0, networkCents: 0}
  };
}

export function entry(auth, token = candidate(), eventId = "entry", now = START + 2000) {
  return {eventId, authorizationId: auth.authorizationId, quote: quote(token, eventId, now), now, marks: []};
}
