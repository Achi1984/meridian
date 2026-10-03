# Cross-Sectional Reversal V1 — Frozen Feature Validation Contract

Status: **IMPLEMENTATION CONTRACT — HISTORICAL FEATURE RESULT FORBIDDEN IN THIS PR**

Dependency: preregistration merged by PR #484 at `642c57f606b776c958d3a45a4876a3c4d043432f`.

## Frozen source and universe

- public Binance Spot daily klines only
- symbols: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, LINKUSDT, AVAXUSDT, DOTUSDT, HBARUSDT, SUIUSDT, NEARUSDT, INJUSDT
- fixed evaluation source interval: 2024-01-06T00:00:00Z through 2026-08-29T00:00:00Z
- weekly anchors: Saturday 00:00 UTC
- an anchor is valid only when all 12 assets have the exact required formation and forward open references
- incomplete anchors fail closed; no imputation, constituent substitution or survivorship-based removal

## Frozen feature

For each valid weekly anchor t:
- formation return = open(t) / open(t - 8 weeks) - 1
- reversal score = negative formation return
- outcome return = open(t + 1 week) / open(t) - 1
- cross-sectional Spearman Rank IC = correlation(reversal score, outcome return)
- spread = equal-weight mean outcome of bottom-3 formation-return assets minus equal-weight mean outcome of top-3 formation-return assets
- ranks are formed only from information available at t
- no volatility, liquidity, trend, funding, flow, sentiment, regime, FIB or ML conditioning

## Frozen validation window

The implementation must derive the exact first/last eligible anchor from the source contract and report the exact count before evaluation. Every eligible anchor must contain all 12 assets.

No post-2026-08-29 source row may enter V1 validation.

## Frozen statistics

Across all eligible weeks:
- mean and median weekly Rank IC
- positive Rank IC week count
- Newey-West t-statistic of mean weekly Rank IC, lag 4
- mean and median weekly bottom-3 minus top-3 spread
- positive spread week count
- Newey-West t-statistic of mean spread, lag 4
- five chronological blocks, split deterministically as evenly as possible by eligible anchor count
- number of blocks with positive mean Rank IC
- number of blocks with positive mean spread

## Frozen PASS gate

All must pass:
1. data integrity complete and exact;
2. mean Rank IC > 0;
3. Rank IC Newey-West(4) t >= 1.645;
4. mean bottom-3 minus top-3 spread > 0;
5. spread Newey-West(4) t >= 1.645;
6. at least 3/5 chronological blocks have positive mean Rank IC;
7. at least 3/5 chronological blocks have positive mean spread.

PASS => `REVERSAL_V1_FEATURE_PASS_STRATEGY_DESIGN_ALLOWED`.
FAIL => `REVERSAL_V1_FEATURE_FAIL_RESEARCH_STOP`.

The decision is conjunctive. A strong spread cannot rescue failed Rank IC and vice versa.

## Isolation

Pull-request CI may run only syntax and synthetic invariants. It must not download/evaluate the historical candidate source or calculate candidate metrics.

The first historical validation requires a later documentation-only authorization commit on a dedicated run branch after this exact implementation/contract passes Release Safety and independent review.

## Anti-tuning and safety

No changing the 8-week formation, 1-week outcome, 3-vs-3 spread, 12-asset universe, sample endpoint, NW lag, thresholds or block gates after historical results are observed.

No long-only, volatility/liquidity/regime-conditioned, asset-selected or period-selected rescue within V1.

researchOnly=true
executionImpact=false
strategyPnlCalculated=false
autoPromotion=false
paperAuthorized=false
liveAuthorized=false
