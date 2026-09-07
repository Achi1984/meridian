# MERIDIAN v7.102 — Correlation-Cluster Portfolio Allocator

Status: PREDECLARED / RESEARCH ONLY / NO PROMOTION  
Declared: 2026-09-07, before the first v7.102 result

## One structural hypothesis

v7.101 proved that a single flat timestamp budget is too blunt: it scaled 398/419 trades and destroyed too much expectancy. v7.102 replaces the global bundle with decision-time correlation clusters. Simultaneous positions consume the same risk budget only when their recent returns and trade directions imply materially overlapping exposure.

## Frozen allocator

For every v7.97 timestamp bundle:

1. Load hourly Coinbase Exchange closes for the locked seven-asset universe.
2. At each decision timestamp use only the 30 complete calendar days ending at the latest fully closed 1h candle strictly before the decision.
3. Compute pairwise Pearson correlation from aligned hourly log returns. A pair is connected when `sideSignA × sideSignB × correlation >= 0.70`, where LONG is `+1` and SHORT is `-1`.
4. Connected components form exposure clusters. Within each cluster, proportionally scale incoming frozen v7.97 risk only when its sum exceeds `1.00` research-risk unit.
5. Singleton and unconnected positions remain unchanged. Missing or inadequate history is conservative: affected positions share one UNKNOWN cluster and may only be attenuated.

The 30-day lookback, hourly sampling, signed-correlation threshold `0.70`, minimum 80% aligned-return coverage and cluster budget `1.00` are locked before evidence. They will not be tuned after results.

## Leakage and safety invariants

- Correlation uses prices available before the decision; current/future returns and trade outcomes are forbidden.
- Frozen v7.97 determines side and incoming risk. v7.102 adds no alpha and changes no entry or exit.
- Every opportunity remains. No ranking, asset removal, cohort gate or winner selection.
- No outgoing trade risk may exceed its incoming risk.
- Relative incoming risk is preserved inside each scaled cluster.
- Baseline 6.2, Paper/live execution, Pionex, `server.js`, sizing, orders and ledgers remain untouched.
- The seven assets, costs, horizons, timestamps and v7.97 comparator remain frozen.

## Frozen evaluation

Compare v7.102 with frozen v7.97 and rejected v7.101 negative control on identical rows:

- primary horizon 24h; sensitivity 4h and 12h;
- 30d, 60d and 90d windows;
- three chronological 90d folds;
- PF, expectancy, net R, maximum drawdown, net-R/max-DD and unchanged trade count;
- LONG/SHORT × regime, asset concentration and sample adequacy;
- scaled trades/bundles/clusters, average scale, missing-history rate and realized cluster sizes.

## Decision rule

v7.102 survives only if all of the following hold:

1. opportunity count is unchanged and no position risk increases;
2. 60d and 90d max drawdown improve versus v7.97;
3. 60d and 90d net-R/max-DD improve versus v7.97;
4. PF declines by no more than `0.05` on every primary window;
5. expectancy retains at least 80% of v7.97 on 60d and 90d;
6. no chronological fold has a materially worse loss or drawdown profile;
7. scaling is materially more selective than v7.101 and the result is not created by shrinking nearly all exposure.

Failure closes this exact architecture. No lookback, threshold, coverage, budget or cluster-definition search follows. Passing permits review only and never automatic promotion.
