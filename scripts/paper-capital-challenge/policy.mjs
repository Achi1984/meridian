export const PAPER_CAPITAL_CHALLENGE_POLICY = Object.freeze({
  schemaVersion: "PAPER_CAPITAL_CHALLENGE_POLICY_V3",
  version: "USD1000_BTC_USD_PAPER_CHALLENGE_V3",
  campaignId: "USD1000_BTC_USD_PAPER_CHALLENGE_V3",
  currency: "USD",
  monetaryUnit: "USD_CENTS",
  marketPair: "BTC/USD",
  initialCapitalCents: 100_000,
  maxDrawdownCents: 10_000,
  maxJournalObservations: 256,
  maxValuationAgeMs: 10_000,
  enabled: false,
  executionMode: "PAPER_ONLY",
  leverageAllowed: false,
  borrowingAllowed: false,
  topUpsAllowed: false,
  resetsAllowed: false,
  executionEnabled: false
});
