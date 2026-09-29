# Self-History Perpetual Factor V1 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #267

## Objective

Test one narrowly defined hypothesis motivated by 2026 perpetual-futures factor evidence:

> A simple momentum factor may be more robust when each contract is judged against its own trailing factor history rather than ranked only against other contracts at the same timestamp.

MERIDIAN does **not** claim an exact replication of Dhanya MD (2026), *Every Asset Its Own Benchmark: Market-Neutral Alpha in Perpetual Futures*. The paper tests a broader multi-factor framework across 112 contracts. V1 intentionally isolates a single, public-data momentum factor so the incremental value of own-history ranking can be measured cleanly.

## External evidence fixed before results

- Dhanya MD (2026), *Every Asset Its Own Benchmark: Market-Neutral Alpha in Perpetual Futures*, SSRN 7301919.
  - reports own-history ranking outperforming peer ranking in most tested factors;
  - reports robustness after removing carry;
  - reports held-out-universe and high-cost stress tests;
  - reports benefit from preserving factor independence.
- Existing MERIDIAN momentum research is treated only as implementation history. Its old parameters are not reused as a tuning source.

## Data source

Official Binance Vision USD-M perpetual public archives only:

- 8h perpetual klines
- monthly funding-rate archives

No account credentials, no private APIs and no synthetic data.

## Fixed universes

### Discovery / temporal-holdout universe

- BTCUSDT
- ETHUSDT
- BNBUSDT
- SOLUSDT
- XRPUSDT
- ADAUSDT
- DOGEUSDT
- LINKUSDT
- AVAXUSDT
- DOTUSDT
- LTCUSDT
- BCHUSDT

### Transfer-universe holdout

Reserved before discovery and never used for discovery selection:

- TRXUSDT
- ETCUSDT
- XLMUSDT
- ATOMUSDT
- UNIUSDT
- AAVEUSDT
- FILUSDT
- NEARUSDT

No asset may be substituted after seeing results.

## Time windows

Data collection begins 2021-01-01 UTC to provide factor warm-up.

### Discovery

- 2022-04-04 00:00 UTC through 2024-12-30 00:00 UTC
- weekly Monday 00:00 UTC rebalance anchors
- only completed 8h bars known before the rebalance may enter a signal

### Temporal holdout

Allowed only after a discovery pass:

- 2025-01-06 00:00 UTC through 2026-08-31 00:00 UTC
- exact same rules, universe, costs and signal thresholds
- no retuning

### Transfer-universe holdout

Allowed only after temporal holdout passes:

- reserved transfer universe above
- 2022-04-04 through 2026-08-31
- exact same rules and thresholds
- no asset substitution
- this stage tests cross-sectional transfer, not temporal independence

A transfer pass may authorize only a prospective Paper shadow.

## Raw factor

For asset i at weekly rebalance t:

- raw momentum = close(t-1 completed 8h bar) / close 12 weeks earlier - 1
- no current/rebalance bar information is used
- no market-cap, volume or future funding information enters the raw signal

## Own-history signal

For each asset independently:

- build the trailing **52 prior weekly raw-momentum observations**, excluding the current observation;
- compute the current raw momentum's empirical percentile against those 52 historical observations;
- LONG signal if percentile >= 80%;
- SHORT signal if percentile <= 20%;
- otherwise FLAT.

At least 52 prior valid weekly factor observations are required.

No threshold grid is searched in V1.

## Portfolio construction

At each weekly rebalance:

- require at least 2 LONG and at least 2 SHORT signals;
- if either side has fewer than 2 assets, the portfolio is flat for that week;
- gross exposure = 1.00;
- LONG gross = +0.50, equally split across active longs;
- SHORT gross = -0.50, equally split across active shorts;
- net dollar exposure = 0 by construction;
- no leverage beyond 1.0 gross;
- no pyramiding;
- no averaging down;
- no stop, take-profit or discretionary override;
- positions are held until the next weekly rebalance.

Weights change only at weekly rebalance.

## Cross-sectional benchmark

Run on the same timestamps and same eligible discovery universe:

- same 12-week raw momentum;
- rank eligible assets against one another at each rebalance;
- LONG top quartile;
- SHORT bottom quartile;
- gross = 1.00, 50/50 long-short;
- same weekly hold;
- same funding;
- same cost model;
- same data gate.

The cross-sectional benchmark is diagnostic **and gating**: the own-history strategy must outperform it on net compounded return in discovery and validation.

No market-cap weighting is required for V1; that remains a future diagnostic foundation.

## Price return

For weekly weight w_i:

- price contribution = w_i × (next rebalance price / entry price - 1)

Weights are frozen through the weekly holding period.

## Funding PnL

Funding is included from official Binance Vision funding archives.

For each asset/weekly position:

- funding contribution = -w_i × sum(realized funding rates during the holding interval)

Therefore:
- positive funding charges LONG positions;
- positive funding rewards SHORT positions.

Funding is reported separately from directional price return.

A separate **price-only** result is also calculated with funding removed.

## Transaction costs

Frozen base cost:

- **8 bps per unit of portfolio turnover**

Turnover at rebalance:
- sum absolute change in portfolio weights from prior weights

Examples:
- flat -> +0.25 long costs 0.25 × 8 bps;
- +0.25 -> -0.25 costs 0.50 × 8 bps.

This is a conservative aggregate execution model, not exchange-exact order-book replay.

### High-cost stress

Exactly **4× base cost**:

- 32 bps per unit turnover

This multiplier is frozen before results and mirrors the type of high-cost robustness test highlighted in the motivating paper.

## Data integrity

Per asset:

- 8h bars strictly increasing;
- exact 8h cadence required inside usable intervals;
- duplicate timestamps rejected;
- OHLC must be finite and positive;
- funding timestamps strictly increasing;
- funding duplicates rejected;
- max funding gap <= 12 hours;
- no synthetic bar or funding reconstruction.

A weekly portfolio period is valid only when all active positions have valid entry/exit prices and complete funding coverage.

If fewer than 8 discovery-universe assets are factor-eligible at a rebalance, that week is rejected for both own-history and cross-sectional benchmark.

## Discovery metrics

Report:

- completed weekly periods
- active weeks and flat weeks
- compounded net return
- price-only compounded return
- funding contribution
- modeled cost contribution
- Profit Factor
- annualized Sharpe using weekly returns
- max drawdown
- 5 chronological-window returns
- long-side contribution
- short-side contribution
- per-asset PnL attribution
- positive-PnL asset count
- max positive-PnL concentration
- turnover
- own-history vs cross-sectional benchmark return
- high-cost-stress return

## Frozen discovery gate

All must pass:

- >= 120 completed weekly periods
- >= 80 active weeks
- compounded net return > 0
- **price-only compounded return > 0**
- Profit Factor >= 1.15
- annualized Sharpe >= 0.75
- max drawdown <= 20%
- >= 4 of 5 chronological windows positive
- long-side contribution > 0
- short-side contribution > 0
- >= 7 discovery assets with positive PnL attribution
- no single positive asset contributes > 35% of total positive PnL
- 4× cost-stress compounded return > 0
- own-history compounded return > cross-sectional benchmark compounded return
- no data-integrity failure
- no auto-promotion

If discovery fails, decision = `DISCOVERY_FAIL_RESEARCH_REDESIGN`.

If discovery passes, decision = `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`.

## Frozen temporal-holdout gate

All must pass with unchanged parameters:

- >= 75 completed weekly periods
- >= 45 active weeks
- compounded net return > 0
- price-only return > 0
- Profit Factor >= 1.05
- annualized Sharpe >= 0.50
- max drawdown <= 20%
- >= 3 of 5 chronological windows positive
- long-side contribution > 0
- short-side contribution > 0
- >= 6 assets with positive PnL attribution
- 4× cost-stress return > 0
- own-history return > cross-sectional benchmark return

PASS => `TEMPORAL_HOLDOUT_PASS_TRANSFER_HOLDOUT_REQUIRED`.

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`.

## Frozen transfer-universe gate

On the reserved eight-asset universe:

- >= 120 completed weekly periods
- >= 70 active weeks
- compounded net return > 0
- price-only return > 0
- Profit Factor >= 1.05
- annualized Sharpe >= 0.50
- max drawdown <= 25%
- >= 3 of 5 chronological windows positive
- long-side contribution > 0
- short-side contribution > 0
- >= 4 transfer assets with positive PnL attribution
- 4× cost-stress return > 0
- own-history return > its same-universe cross-sectional benchmark

PASS => `TRANSFER_HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`.

Even this PASS does not authorize live execution.

## Anti-overfitting

- This protocol is committed before the first real strategy result.
- No percentile threshold may change after discovery.
- No momentum lookback may change after discovery.
- No own-history lookback may change after discovery.
- No asset may be removed or substituted after discovery.
- No cost reduction is allowed after discovery.
- No losing week may be excluded.
- No funding removal may be used to rescue the strategy; price-only is an additional gate, not a replacement result.
- No cross-sectional benchmark definition may change after discovery.
- No holdout date may change.
- Any redesign receives a new ruleset and new preregistration.

## Safety

Research only. No order functions, no exchange credentials, no leverage, no liquidation model, no Pionex/OKX/Binance account mutation and no automatic bot promotion.
