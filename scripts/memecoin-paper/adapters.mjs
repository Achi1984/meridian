export const NETWORK_ENABLED = false;
export const DEXSCREENER_SOURCE = "DexScreener public API";
export const ALLOWED_SOLANA_RPC_METHODS = Object.freeze([
  "getAccountInfo",
  "getTokenLargestAccounts",
  "getTokenSupply"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validTime(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isSafeInteger(parsed);
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function assertAllowedSolanaRpcMethod(method) {
  if (!ALLOWED_SOLANA_RPC_METHODS.includes(method)) {
    throw new Error("RPC method is not in the read-only allowlist");
  }
  return method;
}

export function parseDexScreenerPair(pair, {sampledAt, observedAt = sampledAt} = {}) {
  if (!isRecord(pair) || pair.chainId !== "solana" || !isRecord(pair.baseToken) ||
      !isRecord(pair.quoteToken) || !isRecord(pair.liquidity) ||
      !isRecord(pair.volume) || !isRecord(pair.txns) || !isRecord(pair.txns.h1)) {
    return {status: "UNKNOWN", reason: "pair response lacks supported Solana pair fields"};
  }
  if (!BASE58.test(pair.baseToken.address ?? "") || !BASE58.test(pair.pairAddress ?? "") ||
      !BASE58.test(pair.quoteToken.address ?? "") || !validTime(sampledAt) ||
      !validTime(observedAt)) {
    return {status: "UNKNOWN", reason: "pair identity or sample timestamp is invalid"};
  }
  const actualMarketCap = finite(pair.marketCap) ? pair.marketCap : null;
  const pairCreatedAt = finite(pair.pairCreatedAt) ? pair.pairCreatedAt : null;
  return {
    status: "PARTIAL",
    source: DEXSCREENER_SOURCE,
    chainId: pair.chainId,
    mint: typeof pair.baseToken.address === "string" ? pair.baseToken.address : null,
    pool: typeof pair.pairAddress === "string" ? pair.pairAddress : null,
    quote: typeof pair.quoteToken.address === "string" ? pair.quoteToken.address : null,
    sampledAt: sampledAt ?? null,
    pairCreatedAt,
    marketCapUsd: actualMarketCap,
    liquidityUsd: finite(pair.liquidity.usd) ? pair.liquidity.usd : null,
    volume1hUsd: finite(pair.volume.h1) ? pair.volume.h1 : null,
    priceChange1hPct: finite(pair.priceChange?.h1) ? pair.priceChange.h1 : null,
    transactions1h: {
      buys: finite(pair.txns.h1.buys) ? pair.txns.h1.buys : null,
      sells: finite(pair.txns.h1.sells) ? pair.txns.h1.sells : null
    },
    evidence: {
      source: DEXSCREENER_SOURCE,
      observedAt: observedAt ?? null,
      coverage: ["pairCreatedAt", "marketCap", "liquidity.usd", "volume.h1", "txns.h1", "priceChange.h1"],
      fdvObservedButNotUsed: finite(pair.fdv)
    },
    unsupportedRequiredEvidence: [
      "mint/freeze authority state and Token-2022 extensions",
      "pool-specific LP burn or lock duration",
      "complete owner-aggregated holder concentration",
      "developer-associated holdings and complete attributed rug history",
      "bundled-launch supply and qualified smart-wallet provenance",
      "depth/executable quote and validated costs"
    ],
    note: "A missing marketCap remains null; FDV is never substituted. Pair profiles/boosts are not exhaustive discovery."
  };
}

export function parseSolanaLargestAccounts(response, {observedAt = null, slot = null} = {}) {
  const value = response?.result?.value;
  if (!Array.isArray(value)) {
    return {
      status: "UNKNOWN",
      source: "Solana JSON-RPC getTokenLargestAccounts",
      observedAt,
      slot,
      coverage: {complete: false, kind: "unavailable"}
    };
  }
  return {
    status: "UNKNOWN",
    source: "Solana JSON-RPC getTokenLargestAccounts",
    observedAt,
    slot: response?.result?.context?.slot ?? slot,
    accountsObserved: value.length,
    coverage: {
      complete: false,
      kind: "top20-token-accounts-only",
      ownerAggregation: false,
      denominator: null
    },
    note: "Token accounts are not unique owners and the top-20 response is not a complete owner distribution."
  };
}

export function createReadOnlyAdapterInterface() {
  return Object.freeze({
    enabled: false,
    async request() {
      throw new Error("network adapter is disabled; only offline parsers are available");
    },
    parseDexScreenerPair,
    parseSolanaLargestAccounts,
    assertAllowedSolanaRpcMethod
  });
}
