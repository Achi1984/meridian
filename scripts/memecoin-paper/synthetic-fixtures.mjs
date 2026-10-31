export const SYNTHETIC_SOURCE = "SYNTHETIC_FIXTURE_ONLY";
export const SYNTHETIC_MINT = "So11111111111111111111111111111111111111112";
export const SYNTHETIC_POOL = "11111111111111111111111111111111";
export const SYNTHETIC_QUOTE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function syntheticCandidate(now = Date.now(), overrides = {}) {
  const identity = {
    chainId: "solana",
    mint: SYNTHETIC_MINT,
    pool: SYNTHETIC_POOL,
    quote: SYNTHETIC_QUOTE,
    source: SYNTHETIC_SOURCE,
    sampledAt: now,
    pairCreatedAt: now - 60 * 60 * 1000,
    marketCapUsd: 1_000_000,
    decimals: 6
  };
  const evidence = {};
  const put = (key, value, coverage = {complete: true}) => {
    evidence[key] = {
      value,
      source: SYNTHETIC_SOURCE,
      observedAt: now,
      slot: 1,
      verified: true,
      coverage,
      binding: {chainId: identity.chainId, mint: identity.mint, pool: identity.pool, quote: identity.quote}
    };
  };
  put("pairCreatedAt", identity.pairCreatedAt);
  put("marketCapUsd", identity.marketCapUsd);
  put("tokenDecimals", identity.decimals);
  put("mintAuthorityRevoked", true);
  put("freezeAuthorityRevoked", true);
  put("lpProtection", {
    verified: true, model: "burn", pool: identity.pool, burnEvidenceId: "synthetic-burn-proof"
  });
  put("liquidityUsd", 50_000);
  put("volume1hUsd", 60_000);
  put("top10OwnerPct", 20, {
    complete: true, aggregation: "owner", denominatorAtoms: "1000000000",
    exclusions: ["selected_pool", "burned_supply"]
  });
  put("devAssociatedPct", 2, {complete: true, associationMethod: "documented"});
  put("crediblePriorRug", {found: false, reviewed: true, historyCoverage: "complete"});
  put("bundledLaunchPct", 5);
  put("priceChange1hPct", 25);
  put("tokenExtensions", {
    transferFee: false, transferHook: false, defaultFrozen: false, permanentDelegate: false
  });
  const analystEvidence = {};
  const metric = (key, value, coverage = {complete: true}) => {
    analystEvidence[key] = {
      value,
      source: SYNTHETIC_SOURCE,
      observedAt: now,
      slot: 1,
      verified: true,
      coverage,
      binding: {chainId: identity.chainId, mint: identity.mint, pool: identity.pool, quote: identity.quote}
    };
  };
  metric("momentum15m", 20);
  metric("uniqueBuyers1h", 100);
  metric("buySellUsdRatio1h", null, {complete: true, buyVolumeUsd: 250, sellVolumeUsd: 100});
  metric("holderGrowthPct1h", 15);
  metric("liquidityMarketCapPct", 5);
  metric("qualifiedSmartWallets", 5);
  return {
    ...identity,
    ...overrides,
    evidence: {...evidence, ...overrides.evidence},
    analystEvidence: {...analystEvidence, ...overrides.analystEvidence}
  };
}

export const SYNTHETIC_SMART_WALLET_ALLOWLIST = Object.freeze({
  status: "VERIFIED",
  provenance: "SYNTHETIC_FIXTURE_ONLY"
});
