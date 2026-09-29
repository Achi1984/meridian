# Self-History Perpetual Factor V2 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #269  
Data foundation: `PERPETUAL-FACTOR-DATA-V1`

## Why V2

The earlier `SELF-HISTORY-PERP-FACTOR-V1-FROZEN` lineage failed closed before economic evaluation because its 8h data assumption encountered archive gaps. That result remains immutable.

V2 is a new ruleset using the separately audited canonical 4h + premium + funding foundation. It is not a repair of V1 and does not reuse V1's failed data assumptions.

## Objective

Test whether **own-history factor ranking** is more robust than conventional same-timestamp cross-sectional ranking for a small, transparent set of perpetual-futures factors.

Motivating external evidence: Dhanya MD (2026), *Every Asset Its Own Benchmark: Market-Neutral Alpha in Perpetual Futures* (SSRN 7301919), which reports that own-history ranking outperformed peer ranking in most tested factors and that combining independently constructed factor books was stronger than blending raw factor scores.

MERIDIAN treats that paper as motivation only. V2 does not claim exact replication.

## Fixed universe

Frozen candidate universe from Perpetual Factor Data V1:

- BTC
- ETH
- BNB
- SOL
- XRP
- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX
- HBAR
- SUI

### Discovery / temporal-holdout universe

Fixed assets:
- BTC
- ETH
- BNB
- SOL
- XRP
- ADA
- DOGE
- LINK
- DOT
- SUI

Dynamic eligibility still applies. SUI therefore remains unavailable until the foundation's objective eligibility date.

### Reserved transfer universe

Never used for discovery selection:
- LTC
- BCH
- AVAX
- HBAR

No asset may move between these groups after results are observed.

## Objective eligibility

Use the exact Perpetual Factor Data V1 rule.

An asset may be traded at weekly rebalance t only when, before t:
- at least 24 completed CORE_COMPLETE calendar months exist;
- the most recent 12 completed months are CORE_COMPLETE;
- no synthetic backfill is used.

Frozen first eligible months from the canonical foundation:
- BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX: 2023-01
- HBAR: 2023-03
- SUI: 2025-05

## Official data

Binance Vision public USD-M monthly archives:
- 4h perpetual klines
- 4h premiumIndexKlines
- fundingRate

No authenticated API, private account data or synthetic reconstruction.

## Time windows

Raw collection begins 2021-01-01 UTC.

### Discovery

- weekly Monday 00:00 UTC anchors
- entry anchors: 2023-04-03 <= t < 2024-12-30
- final discovery exit/rebalance mark: 2024-12-30 00:00 UTC
- only information timestamped strictly before t may enter the signal

### Temporal holdout

Allowed only after discovery passes:
- entry anchors: 2025-01-06 <= t < 2026-08-31
- final exit/rebalance mark: 2026-08-31
- no retuning

### Transfer-universe holdout

Allowed only after temporal holdout passes:
- reserved universe: LTC, BCH, AVAX, HBAR
- entry anchors: 2023-04-03 <= t < 2026-08-31
- final exit/rebalance mark: 2026-08-31
- exact same factor definitions, thresholds, costs and portfolio rules
- no asset substitution

A transfer pass may authorize only a prospective Paper shadow.

## Factor books

Three factor books are frozen before results. Each is constructed and traded independently.

### F1 — MOMENTUM_12W

Raw factor at rebalance t:
- most recent completed 4h close strictly before t divided by the completed 4h close 12 weeks earlier minus 1.

Direction:
- high factor = LONG
- low factor = SHORT

### F2 — FUNDING_CARRY_7D

Raw factor:
- negative of the sum of realized funding rates timestamped in [t-7d, t).

Direction:
- more negative realized funding produces a higher score and favors LONG;
- more positive realized funding produces a lower score and favors SHORT.

This direction matches the direct cash-flow sign of perpetual funding: positive funding charges longs and rewards shorts.

### F3 — PREMIUM_REVERSION_7D

Raw factor:
- negative of the arithmetic mean of completed 4h premium-index close values in [t-7d, t).

Direction:
- unusually negative premium favors LONG;
- unusually positive premium favors SHORT.

This is a simple mean-reversion hypothesis, not a claim of an exact basis-arbitrage replication.

## Own-history ranking

For each factor and asset independently:

- compute a weekly raw factor observation at every valid Monday anchor;
- current observation is excluded from its own reference history;
- reference window = previous **52 valid weekly observations** for that same asset and same factor;
- empirical percentile = fraction of those 52 historical observations <= current observation;
- LONG if percentile >= 0.80;
- SHORT if percentile <= 0.20;
- otherwise FLAT.

At least 52 prior valid factor observations are required.

No threshold grid is searched.

## Factor-book portfolio construction

At each weekly rebalance, separately for F1/F2/F3:

Discovery/temporal universe:
- require >=2 LONG and >=2 SHORT signals;
- otherwise that factor book is flat for the week.

Reserved four-asset transfer universe:
- require >=1 LONG and >=1 SHORT signal;
- otherwise that factor book is flat.

When active:
- factor-book gross exposure = 1.00 of that book's capital;
- LONG gross = +0.50 equally across active longs;
- SHORT gross = -0.50 equally across active shorts;
- net dollar exposure = 0.

No leverage beyond 1.0 gross within a factor book.
No stops, take-profits, pyramiding, averaging down or discretionary overrides.
Weights change only on weekly anchors.

## Combining factor books

The three books remain independent.

Combined V2 return for a week:
- 1/3 × F1 return
- + 1/3 × F2 return
- + 1/3 × F3 return

Equivalently, one third of strategy capital is allocated to each 1.0-gross factor book. This keeps aggregate gross capital usage bounded rather than stacking three full-size books.

Raw factor scores are never averaged together.

## Cross-sectional benchmark

For every factor, run a matched peer-ranking book on the exact same timestamp and objectively eligible universe.

At each rebalance:
- same raw factor definition;
- rank eligible assets by current raw factor;
- discovery/temporal side count = max(2, floor(N/5));
- transfer side count = 1;
- LONG highest-ranked assets;
- SHORT lowest-ranked assets;
- 50/50 long-short gross;
- identical weekly holding period;
- identical funding and costs;
- identical data gate.

The three cross-sectional books are then combined 1/3 each.

Own-history V2 must beat this matched combined cross-sectional benchmark in every promotion stage.

## Weekly price return

For weight w_i set at t:
- price contribution = w_i × (P_i(t+1w) / P_i(t) - 1)

Entry/exit marks:
- first completed 4h close whose close timestamp equals the weekly anchor;
- if no exact mark exists, fail the affected weekly book closed;
- no forward-looking substitution.

## Funding contribution

For an active weekly weight w_i:
- funding contribution = -w_i × sum(realized funding rates with timestamps in (t, t+1w].

Positive funding therefore charges longs and rewards shorts.

Funding is reported separately from price PnL.

A price-only compounded result is also calculated with funding removed and must independently pass its gate.

## Costs

Base modeled cost:
- **8 bps per unit turnover**

Book turnover at rebalance:
- sum absolute change in asset weights versus the immediately prior weekly weights of that same factor book.

Cost contribution:
- -turnover × 0.0008

When a factor book moves from active to flat or flat to active, the corresponding weight change is fully charged.

### High-cost stress

Exactly 4× base cost:
- **32 bps per unit turnover**

No rebates, maker assumptions, VIP tiers or fee-token discounts.

## Data integrity

For all raw data used in a weekly decision:

4h perpetual klines:
- timestamps strictly increasing;
- no duplicates;
- finite positive OHLC;
- exact 4h cadence inside required lookback/holding intervals.

4h premium-index klines:
- timestamps strictly increasing;
- no duplicates;
- finite values;
- exact 4h cadence inside required 7d windows.

Funding:
- timestamps strictly increasing;
- no duplicates;
- finite rates;
- max gap <= 12 hours inside active holding intervals;
- cadence is observed, not assumed.

No interpolation or synthetic reconstruction.

A weekly factor-book period fails closed when any active position lacks a valid entry mark, exit mark or required funding coverage.

A discovery/temporal rebalance requires at least 8 objectively eligible assets before either own-history or cross-sectional books are evaluated.

## Discovery metrics

Report for own-history and matched cross-sectional benchmark:

- completed weekly periods
- active combined weeks
- active weeks by factor book
- compounded net return
- compounded price-only return
- funding contribution
- modeled cost contribution
- Profit Factor
- annualized Sharpe using weekly returns
- max drawdown
- 5 chronological-window returns
- gross long-side contribution before shared costs
- gross short-side contribution before shared costs
- per-asset PnL attribution
- positive-PnL asset count
- maximum positive-PnL concentration
- turnover
- 4× cost-stress compounded return
- factor-book net returns
- number of factor books with positive return
- number of factor books where own-history beats its matched cross-sectional book

## Frozen discovery gate

All conditions must pass:

- >= 85 completed weekly periods
- >= 55 active combined weeks
- each factor book active in >= 40 weeks
- combined compounded net return > 0
- combined price-only compounded return > 0
- Profit Factor >= 1.15
- annualized Sharpe >= 0.75
- max drawdown <= 20%
- >=4 of 5 chronological windows positive
- gross long-side contribution > 0
- gross short-side contribution > 0
- >=6 discovery-universe assets with positive PnL attribution
- no single positive asset contributes >35% of total positive PnL
- 4× cost-stress compounded return > 0
- at least 2 of 3 own-history factor books have positive net return
- own-history combined return > matched cross-sectional combined return
- own-history beats cross-sectional in at least 2 of 3 matched factor books
- no data-integrity failure

PASS => `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`.

FAIL => `DISCOVERY_FAIL_RESEARCH_REDESIGN`.

## Frozen temporal-holdout gate

With unchanged rules:

- >=75 completed weekly periods
- >=45 active combined weeks
- each factor book active in >=30 weeks
- combined net return >0
- combined price-only return >0
- Profit Factor >=1.05
- annualized Sharpe >=0.50
- max drawdown <=20%
- >=3 of 5 chronological windows positive
- gross long-side contribution >0
- gross short-side contribution >0
- >=6 positive-PnL assets
- 4× cost-stress return >0
- at least 2 of 3 factor books positive
- own-history combined return > matched cross-sectional combined return
- own-history beats cross-sectional in at least 2 of 3 factor books

PASS => `TEMPORAL_HOLDOUT_PASS_TRANSFER_HOLDOUT_REQUIRED`.

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`.

## Frozen transfer-universe gate

On LTC/BCH/AVAX/HBAR only:

- >=150 completed weekly periods
- >=70 active combined weeks
- each factor book active in >=45 weeks
- combined net return >0
- combined price-only return >0
- Profit Factor >=1.05
- annualized Sharpe >=0.50
- max drawdown <=25%
- >=3 of 5 chronological windows positive
- gross long-side contribution >0
- gross short-side contribution >0
- >=3 of 4 assets with positive PnL attribution
- 4× cost-stress return >0
- at least 2 of 3 factor books positive
- own-history combined return > matched cross-sectional combined return
- own-history beats cross-sectional in at least 2 of 3 factor books

PASS => `TRANSFER_HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`.

Even a transfer pass does not authorize live execution.

## Anti-overfitting

- This V2 protocol is committed before its first real strategy result.
- V1 remains immutable and is never overwritten.
- No factor is added or removed after seeing results.
- No factor direction is flipped after seeing results.
- No percentile threshold changes after discovery.
- No raw-factor lookback changes after discovery.
- No own-history lookback changes after discovery.
- No asset moves between discovery and transfer universes.
- No cost reduction after discovery.
- No losing week is removed.
- No factor-score blending may replace independent factor books.
- No validation date may move.
- Any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage, liquidation model, account mutation or automatic bot promotion.
