# MERIDIAN — Quarter-Hour Boundary Order Imbalance V1 Research Selection

Status: **SELECTED FOR STRATEGY-NEUTRAL DATA V0 ONLY**  
Strategy PnL allowed: **false**  
Signal calculation allowed: **false**  
Paper/live authorization: **false**

## Why this family is selected

MERIDIAN's weekly cross-sectional Taker Order Flow V1 is closed after an immutable DEVELOPMENT failure. Its observed asymmetry must not be rescued by deleting the short leg or retuning the same rules.

The next candidate is therefore a distinct clock-time microstructure hypothesis:

**PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1**

The selection is based on evidence that existed independently of MERIDIAN's failed V1 result.

### Primary external evidence

Chan Kim and Peter Reinhard Hansen, *The Quarter-Hour Effect: Periodic Algorithmic Trading and Return Predictability in Cryptocurrency Futures*, arXiv:2607.09426v2, August 24 2026.

Relevant pre-existing findings:

- six Binance USDT-margined perpetual contracts: BTC, ETH, XRP, SOL, DOGE, ADA;
- quarter-hour opening activity has a distinct clock-phase structure;
- opening returns are forecastable out of sample;
- quarter-hour opening order imbalance predicts cumulative returns over approximately 4–12 hours;
- the medium-horizon order-imbalance association is positive in all six studied markets and is much weaker at generic/finer clock-time frequencies;
- the result remains when funding-settlement openings are excluded.

Important limitation: the paper does **not** present a net-of-cost trading strategy for the medium-horizon order-imbalance result. MERIDIAN therefore treats it as a hypothesis source, not as evidence that a tradable strategy is profitable.

Source: https://arxiv.org/abs/2607.09426

### Independent caution / second source

Edson Pindza, *Microstructure alpha: hierarchical learning and cross-asset transfer in cryptocurrency markets*, Frontiers in Blockchain 9 (2026), DOI 10.3389/fbloc.2026.1811716.

That study finds genuine but weak short-horizon microstructure predictability under leakage controls; asset heterogeneity is material and no tested strategy survives realistic standard retail fees. This argues **against** a generic always-on order-flow strategy and supports testing the narrower quarter-hour-conditioned hypothesis with hard cost gates.

Source: https://doi.org/10.3389/fbloc.2026.1811716

### Rejected nearby direction

Nadav A. Kitron and Jonathan M. Wengrowicz, *Short-horizon mean reversion in cryptocurrency markets: a matched cross-market measurement*, arXiv:2608.21888.

The paper reports pervasive 15-minute reversal, especially after aggressive-taker-flow moves, but its abstract states the gross edge peaks near 1.3 bp per trade against a 5 bp round-trip cost. MERIDIAN therefore rejects that direction as the next candidate before spending research budget on it.

Source: https://arxiv.org/abs/2608.21888

### Not selected now

Dhanya MD, *Every Asset Its Own Benchmark: Market-Neutral Alpha in Perpetual Futures*, SSRN 7301919, motivates own-history normalization and includes an aggressor-side factor. MERIDIAN already has an immutable failed self-history lineage, and the abstract alone does not define a sufficiently specific new aggressor-side protocol. It remains background evidence, not the selected next family.

## V0 objective

V0 asks only:

> Are the exact public data needed to study this family independently available across the intended post-paper period?

No predictive variable is calculated.

## Frozen V0 universe

Exact six contracts used by the primary source:

- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Venue: Binance USD-M perpetual futures.

## Frozen V0 calendar

Audit window:

- start month: **2025-01**
- end month: **2026-08**

The primary paper's market-data sample ends on 2024-10-31. This V0 window is therefore chronologically later than the external study.

V0 does not yet allocate development/validation/holdout trading windows. That split must be preregistered only after data quality is known and before any signal or PnL is calculated.

## Required public archives

For every asset-month V0 checks publication availability for:

1. USD-M monthly `aggTrades`
   - required later for trade timestamp, price, quantity and buyer-maker direction;
2. USD-M monthly 1-minute `klines`
   - independent price/continuity reference only;
3. USD-M monthly `fundingRate`
   - required later for correct perpetual-futures economics.

The official Binance public-data documentation states that USD-M futures aggregate-trade archives reproduce `/fapi/v1/aggTrades` fields including timestamp and buyer-maker direction.

## V0 actions explicitly forbidden

V0 must not calculate or inspect:

- signed order imbalance;
- first-10-second quarter-hour flow;
- forward returns;
- predictive regressions;
- correlations between flow and returns;
- rankings;
- trading positions;
- strategy turnover;
- strategy costs;
- strategy funding PnL;
- any strategy PnL.

V0 is archive availability/schema planning only.

## V0 pass gate

PASS only if all expected archive/checksum objects are published for:

- 6 assets
- 20 months
- 3 data families

Expected objects per data family: **120**  
Expected total archive objects: **360**

Any missing archive or checksum => **FOUNDATION_V0_FAIL_DATA_AVAILABILITY**.

PASS => **FOUNDATION_V0_PASS_FULL_DATA_QUALITY_AUDIT_REQUIRED**.

A PASS does not authorize signal construction or PnL.

## Next stage after V0 PASS

Build a separate full-data quality foundation that validates archive contents, timestamp monotonicity, buyer-maker field validity, monthly coverage, and data gaps without computing predictive relationships.

Only after that foundation passes may MERIDIAN freeze the actual Quarter-Hour strategy protocol and invariants before first PnL.
