# Cross-Sectional Low-Volatility V1 — Preregistration

Status: **PREREGISTERED / RESEARCH ONLY / NO HISTORICAL RESULT INSPECTED UNDER THIS RULESET**  
Ruleset: `CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN`  
Parent main: `dcf034d65f312b99e6baf30558d28e858cb664a2`  
Execution impact: **false**  
Paper/live authorization: **false**

## Purpose

Test one orthogonal cross-sectional hypothesis without retuning:

> Within a fixed liquid crypto-perpetual universe, lower trailing realized volatility predicts higher next-week cross-sectional return than higher trailing realized volatility.

This document freezes the complete V1 feature-validation design before any historical V1 result is inspected.

## Fixed public data source

Only official Binance Vision USD-M monthly 1h perpetual kline archives may be used.

No:
- private exchange/account data;
- funding data;
- synthetic history;
- interpolation/backfill;
- alternate venue substitution;
- post-hoc asset selection.

Required hourly fields are timestamp and OHLC values only.

## Frozen universe

Exactly 12 assets:

`BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX`

An anchor is invalid unless all 12 assets have the complete required formation and outcome windows. Missing-data anchors fail closed; assets are never dropped to rescue a week.

## Anchor schedule

All anchors are Saturday 00:00:00 UTC.

### Discovery
- first anchor: **2025-02-01T00:00:00Z**
- last anchor: **2025-12-27T00:00:00Z**
- expected anchors: **48**

### Untouched holdout
- first anchor: **2026-01-03T00:00:00Z**
- last feature anchor: **2026-08-22T00:00:00Z**
- final outcome open: **2026-08-29T00:00:00Z**
- expected anchors: **34**

The holdout may not be evaluated unless the frozen discovery gate passes.

## Frozen feature

For each asset and anchor `t`:

1. Use exactly the preceding **28 days / 672 hourly returns**.
2. The last formation observation must end before the anchor; no bar beginning at `t` may enter the feature.
3. Hourly log returns are calculated from consecutive hourly closes.
4. Realized volatility is:
   `RV28 = sqrt(sum(r_h^2))`
   over exactly 672 hourly log returns.
5. Feature score is:
   `LOWVOL = -RV28`
   so a larger score means lower realized volatility.
6. Cross-sectional ranking is performed across exactly the 12 frozen assets.
7. Ties use deterministic alphabetical asset-symbol order only.

No alternative volatility estimator, lookback, winsorization, standardization, cap, regime filter, market-beta adjustment or asset-specific parameter is allowed in V1.

## Frozen forward outcome

For anchor `t`, the next-week asset return is calculated from:

- entry: hourly kline **open at t**;
- exit: hourly kline **open at t + 7 days**.

This keeps the formation window strictly prior to the forward-return window.

## Frozen validation statistics

For every valid anchor calculate only:

1. Spearman cross-sectional Rank IC between `LOWVOL` and next-week asset return.
2. Equal-weight **Low-2 minus High-2** next-week return spread:
   - long the two highest `LOWVOL` scores;
   - short the two lowest `LOWVOL` scores;
   - arithmetic mean long return minus arithmetic mean short return.
3. Newey-West t-statistics with fixed lag **4** for:
   - weekly Rank IC series;
   - weekly Low-2 minus High-2 spread series.
4. Four chronological discovery blocks of exactly 12 anchors each.
5. Holdout block diagnostics only after discovery authorization.

No compounded strategy equity curve, Sharpe, Sortino, drawdown, Profit Factor or strategy PnL is authorized at the feature-validation stage.

## Frozen cost policy

V1 feature validation is based on raw forward returns and does **not** calculate strategy PnL.

If and only if feature validation later authorizes a separately preregistered strategy-design stage, that stage must use a minimum frozen transaction-cost floor of:

- **10 bps per one-way unit of notional turnover**;
- no zero-cost rescue;
- no cost reduction after seeing results.

Any later strategy document may choose a higher cost assumption, but never a lower one.

## Discovery gate — fail closed

Discovery passes only if **all** of the following are true:

- exactly **48** valid anchors;
- exactly **12** assets at every anchor;
- no private/synthetic/backfilled data;
- mean weekly Rank IC **> 0**;
- Rank IC Newey-West(4) t-statistic **>= 1.645**;
- mean Low-2 minus High-2 spread **> 0**;
- spread Newey-West(4) t-statistic **>= 1.645**;
- at least **3 of 4** chronological discovery blocks have positive mean Rank IC;
- at least **3 of 4** chronological discovery blocks have positive mean spread;
- no invariant or source-integrity failure.

Possible discovery decisions are exactly:

- `DISCOVERY_PASS_HOLDOUT_ALLOWED`
- `DISCOVERY_FAIL_RESEARCH_STOP`

A discovery FAIL closes V1. No retuning, threshold relaxation, universe change, date extension, basket-size change or lookback change is allowed.

## Holdout gate — independent and untouched

Only a discovery PASS authorizes exactly one untouched holdout evaluation using the frozen V1 implementation.

Holdout passes only if **all** are true:

- exactly **34** valid anchors;
- exactly **12** assets at every anchor;
- mean weekly Rank IC **> 0**;
- Rank IC Newey-West(4) t-statistic **>= 1.645**;
- mean Low-2 minus High-2 spread **> 0**;
- spread Newey-West(4) t-statistic **>= 1.645**;
- no invariant or source-integrity failure.

Possible holdout decisions are exactly:

- `HOLDOUT_PASS_STRATEGY_DESIGN_ALLOWED`
- `HOLDOUT_FAIL_RESEARCH_STOP`

Even a holdout PASS authorizes only a new, separately named and separately preregistered strategy-design stage. It does not authorize Paper or live trading.

## Anti-overfitting / lineage rules

After the first discovery result is inspected:

- V1 parameters are immutable;
- failed gates cannot be rescued by alternative subperiods or metrics;
- no asset may be removed because of an unfavorable contribution;
- no alternative basket size, lag, threshold or volatility estimator may be tested under the V1 name;
- holdout remains sealed unless discovery passes;
- all implementation, source and result artifacts must be hash-pinned before any downstream promotion.

## Current authorization

Authorized now:
- this docs-only preregistration;
- implementation of the frozen calculations after this preregistration is merged;
- synthetic/invariant tests that do not reveal historical V1 outcomes.

Not authorized now:
- historical discovery evaluation before implementation/release-safety is frozen;
- holdout evaluation;
- strategy PnL;
- portfolio optimization;
- Paper bots;
- live execution.
