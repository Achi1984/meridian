import {
  SYNTHETIC_MINT,
  SYNTHETIC_POOL,
  SYNTHETIC_QUOTE,
  SYNTHETIC_SOURCE,
  syntheticCandidate
} from "../../../scripts/memecoin-paper/synthetic-fixtures.mjs";

export const DEFAULT_NOW = Date.parse("2026-11-02T16:00:00Z");
export const IDENTITY = Object.freeze({
  chainId: "solana",
  mint: SYNTHETIC_MINT,
  pool: SYNTHETIC_POOL,
  quote: SYNTHETIC_QUOTE
});
export const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function address(prefix, index) {
  return prefix.repeat(31) + BASE58[index];
}

export function reviewed(source, value, {
  identity = IDENTITY,
  observedAt = DEFAULT_NOW,
  slot = 1,
  coverage = {complete: true},
  sourceVersion = "fixture-v1",
  review = {},
  now = DEFAULT_NOW
} = {}) {
  return {
    source,
    sourceVersion,
    identity: {...identity},
    observedAt,
    slot,
    coverage,
    review: {
      status: "REVIEWED",
      reviewerId: "fixture-reviewer",
      reviewId: "fixture-review-1",
      reviewedAt: now,
      ...review
    },
    value
  };
}

export function fixtureInput(now = DEFAULT_NOW) {
  const providerCandidate = syntheticCandidate(now);
  providerCandidate.tokenSupplyAtoms = "1000";
  providerCandidate.evidence.tokenDecimals.coverage = {
    complete: true,
    amountAtoms: "1000",
    mintAccountMatch: true,
    accountSlot: 1
  };
  const review = (source, value, options = {}) =>
    reviewed(source, value, {observedAt: now, ...options, now});
  const ownerAccounts = Array.from({length: 40}, (_, index) => ({
    account: address("B", index),
    owner: address("A", index),
    amountAtoms: "20",
    classification: "holder"
  }));
  ownerAccounts.push(
    {account: address("P", 1), owner: address("C", 1), amountAtoms: "100", classification: "selected_pool"},
    {account: address("Q", 2), owner: address("D", 2), amountAtoms: "100", classification: "burned_supply"}
  );
  const evidence = {
    lpProtection: review(SYNTHETIC_SOURCE, {
      model: "burn", pool: IDENTITY.pool, burnEvidenceId: "fixture-lp-burn"
    }),
    ownerCensus: review(SYNTHETIC_SOURCE, {
      pool: IDENTITY.pool,
      supplyAtoms: "1000",
      context: {...IDENTITY, slot: 1, observedAt: now, commitment: "finalized"},
      selectedPoolTokenAccounts: [address("P", 1)],
      burnedTokenAccounts: [address("Q", 2)],
      accounts: ownerAccounts
    }, {
      coverage: {
        complete: true,
        ownerResolutionComplete: true,
        accountCoverageComplete: true,
        burnedSupplyAtoms: "100",
        supplyContextPolicy: "same-finalized-slot",
        exclusions: ["selected_pool", "burned_supply"]
      }
    }),
    developerAttribution: review(SYNTHETIC_SOURCE, {
      method: "documented",
      developerOwners: [address("A", 0)],
      evidenceIds: ["fixture-developer-attribution"]
    }),
    priorRug: review(SYNTHETIC_SOURCE, {
      found: false, historyCoverage: "complete"
    }),
    bundledLaunch: review(SYNTHETIC_SOURCE, {
      bundledSupplyAtoms: "50"
    }, {
      coverage: {complete: true, bundleDetectionComplete: true}
    })
  };
  const analystEvidence = {
    momentum15m: review(SYNTHETIC_SOURCE, {percent: 20}, {
      coverage: {complete: true, windowMs: 15 * 60 * 1000}
    }),
    uniqueBuyers1h: review(SYNTHETIC_SOURCE, {count: 100}, {
      coverage: {
        complete: true,
        windowMs: 60 * 60 * 1000,
        uniqueAddressesDeduplicated: true
      }
    }),
    buySellUsdRatio1h: review(SYNTHETIC_SOURCE, {
      buyVolumeUsd: 250, sellVolumeUsd: 100
    }, {
      coverage: {complete: true, windowMs: 60 * 60 * 1000}
    }),
    holderGrowthPct1h: review(SYNTHETIC_SOURCE, {
      startHolders: 100, endHolders: 115
    }, {
      coverage: {complete: true, windowMs: 60 * 60 * 1000}
    }),
    liquidityMarketCapPct: review(SYNTHETIC_SOURCE, {
      liquidityUsd: 50_000, marketCapUsd: 1_000_000
    }),
    qualifiedSmartWallets: review(SYNTHETIC_SOURCE, {
      count: 5,
      allowlistId: "fixture-wallet-list",
      evidenceIds: ["fixture-wallet-provenance"]
    })
  };
  return {providerCandidate, evidence, analystEvidence};
}
