# Proposed candidate score v1

This is a deterministic, predeclared experiment heuristic. It is not owner
approval of efficacy, validated alpha, or an operating setting. Hard filters
run first and cannot be offset by score.

| Component | Window and unit | Score mapping | Weight |
| --- | --- | --- | ---: |
| Momentum | 15-minute price return, percent | −10% → 0; +20% → 100; linear clamp | 25 |
| Unique buyers | Distinct buyer wallet addresses, trailing 1 hour, count | 0 → 0; 100+ → 100; linear clamp | 20 |
| Buy/sell ratio | Buy USD volume ÷ sell USD volume, trailing 1 hour | 0.5 → 0; 2.5+ → 100; linear clamp | 15 |
| Holder growth | Change in unique-owner count over trailing 1 hour, percent | −5% → 0; +15% → 100; linear clamp | 15 |
| Liquidity / market cap | Pool USD liquidity ÷ actual USD market cap × 100 | 0.2% → 0; 5%+ → 100; linear clamp | 15 |
| Qualified smart wallets | Distinct, provenance-qualified allowlisted wallets, trailing 1 hour, count | 0 → 0; 5+ → 100; linear clamp | 10 |

Weights total 100. Component scores are clamped to 0–100 and floored to whole
points. The weighted total is floored to an integer; the proposed threshold is
70. No component is reweighted when evidence is missing.

`uniqueBuyers1h` and `qualifiedSmartWallets` are distinct wallet counts, not
transaction counts. Buy/sell ratio is based on USD volumes, not buy/sell
transaction counts, and requires positive, independently evidenced buy and
sell denominators. Holder growth uses unique owners under the same complete,
documented aggregation policy as the hard concentration gate.

For this experiment, a "qualified smart wallet" means a public Solana wallet
whose allowlist record has (1) at least 10 independently verified, completed
token round trips over the preceding 90 days, (2) activity across at least
five unrelated mints, (3) positive aggregate realized result after explicit
cost assumptions, and (4) attributable transaction evidence and a dated
independent review. The calculation must exclude self-transfers, same-mint
bundled launch behavior, and the candidate mint; overlapping wallets count
once. These are proposed screening parameters, not a claim that the wallets
are expert or predictive. No qualification dataset, validated cost source, or
allowlist is configured, so real smart-wallet scoring remains
`SCORE_UNAVAILABLE`.

All six input measures require fresh, verified, complete evidence bound to the
selected chain/pool/quote. The candidate must already pass every hard gate.
The checked-in all-high synthetic score is fixture plumbing, not performance
evidence. Changing windows, weights, bounds, or qualification requires a new
score-spec version and review before any experiment.

## Offline wallet qualification diagnostics

`evaluateWalletQualificationDiagnostics` in
`scripts/memecoin-paper/analyst-window-evidence.mjs` is a pure, bounded,
offline calculation over explicitly supplied completed round trips and an
explicitly supplied, versioned `proposed: true` policy. The parameters above
are not adopted as defaults; no policy means `UNAVAILABLE`. Costs, proceeds
and basis are exact safe integers in one accounting unit. Missing/partial
costs, mixed units, unsafe numbers, ambiguous self-transfer/bundle/mint
relationship facts, future or incomplete round trips, conflicting duplicates
or oversized input yield `UNAVAILABLE` or `REVIEW_REQUIRED`. Evidence
references are presence-checked only, not authenticated. Output is always
`UNVERIFIED` with `allowlistAdmitted: false`; it never emits `VERIFIED` or
`EXTERNALLY_REVIEWED` and does not replace as-of membership approval or the
dated independent review.
