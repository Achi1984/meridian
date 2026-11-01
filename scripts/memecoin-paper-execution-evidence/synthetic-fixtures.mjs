import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE,
  SYNTHETIC_SOURCE
} from "../memecoin-paper/synthetic-fixtures.mjs";

export function syntheticProviderQuote(observedAt, overrides = {}) {
  const identity = {
    chainId: "solana",
    mint: SYNTHETIC_MINT,
    pool: SYNTHETIC_POOL,
    quote: SYNTHETIC_QUOTE,
    decimals: 6
  };
  const costs = {
    source: SYNTHETIC_SOURCE,
    binding: {...identity},
    observedAt,
    microUsd: {
      fee: "0",
      spread: "0",
      slippage: "0",
      priceImpact: "0",
      network: "0"
    }
  };
  return {
    provider: "synthetic-route-provider",
    schemaVersion: "synthetic-v1",
    source: SYNTHETIC_SOURCE,
    fixtureOnly: true,
    eventId: "synthetic-entry-quote",
    ...identity,
    observedAt,
    priceMicros: 10_000,
    mode: "HYPOTHETICAL",
    executable: true,
    costs,
    ...overrides
  };
}
