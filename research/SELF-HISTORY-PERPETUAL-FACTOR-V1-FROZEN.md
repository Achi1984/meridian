# Self-History Perpetual Factor V1 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Exact replication: **false**  
Parent foundation: `PERPETUAL-FACTOR-DATA-V1`

## Objective

Test one specific hypothesis:

> A perpetual-futures factor portfolio that standardizes each asset's signal against its **own trailing history** can outperform an otherwise identical conventional **cross-sectional peer-ranking** portfolio.

The motivation is Dhanya MD (2026), *Every Asset Its Own Benchmark: Market-Neutral Alpha in Perpetual Futures*. MERIDIAN does not claim exact replication because the complete paper implementation and exact original data panel are not reproduced.

## Frozen universe and eligibility

Fixed source universe inherited from Perpetual Factor Data V1:

- BTC, ETH, BNB, SOL, XRP, ADA, DOGE
- LINK, DOT, LTC, BCH, AVAX, HBAR, SUI

USD-M perpetual symbols are `<ASSET>USDT`.

Dynamic eligibility is **not** based on strategy performance.

An asset is strategy-eligible only when the already frozen data-foundation rule is satisfied:
- >=24 completed CORE_COMPLETE monthly archives before the timestamp;
- most recent 12 completed months CORE_COMPLETE;
- no synthetic pre-listing history.

Frozen earliest eligibility from the audited foundation:
- 2023-01: BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX
- 2023-03: HBAR
- 2025-05: SUI

## Official data

Binance Vision public USD-M archives only:

- perpetual `klines`, 4h
- `premiumIndexKlines`, 4h
- `fundingRate`

No authenticated API, account data or private venue data.

## Time split

### Discovery
- calendar boundary: 2023-01-01 <= data < 2026-01-01 UTC
- a weekly period is included only when both its entry anchor and its one-week exit anchor are inside that boundary
- therefore no discovery holding period consumes a 2026 price or funding event

### Frozen temporal holdout
Allowed only if discovery passes:
- calendar boundary: 2026-01-01 <= data <= 2026-08-31 00:00 UTC
- a weekly period is included only when both entry and exit lie inside the boundary
- no parameter changes

## Rebalance

Primary:
- weekly
- Monday 00:00 UTC
- only completed 4h bars/funding events strictly before the rebalance timestamp may form signals

Anchor robustness:
- independently rerun the exact strategy for all seven UTC weekday anchors
- no anchor selection after results
- Monday remains the primary reported series

Holding period:
- rebalance timestamp through the same UTC anchor one week later

## Frozen raw factor primitives

All factors are sign-aligned so **higher means stronger LONG signal**.

### F1 · Risk-adjusted medium momentum

Using completed 4h closes:
- trailing horizon = 7 days = 42 bars
- skip the most recent completed 4h return
- signal numerator = log close return from bar `t-42` to `t-1`
- denominator = realized standard deviation of the trailing 42 completed 4h log returns
- annualization is not needed for ranking

At a rebalance anchor let `c[-1]` be the close of the latest completed 4h bar and `c[-2]` the prior completed close.

The latest completed 4h return `log(c[-1]/c[-2])` is skipped.

Frozen implementation:
- numerator = `log(c[-2]/c[-44])`, exactly 42 completed 4h returns ending one bar before the latest close;
- denominator = sample standard deviation (n-1) of those same 42 log returns.

If volatility is zero/non-finite, signal is missing.

### F2 · Short-term reversal

Using the latest completed 4h return and trailing 24h volatility:

`REV4H = -log(c[-1]/c[-2]) / sample_sd(last 6 completed 4h returns)`

### F3 · Funding crowding

Sum realized funding rates over the trailing 7 completed days:

`FUND_CROWD = -sum(fundingRate trailing 7d)`

High positive funding is treated as crowded long positioning, therefore sign is inverted.

### F4 · Premium mean reversion

Mean completed 4h premium-index close over trailing 24h:

`PREMIUM_MR = -mean(premiumClose last 6 completed bars)`

A positive premium is therefore a negative forward signal.

## Self-history construction

For each asset and factor independently:

- compute one raw factor observation at each weekly anchor;
- current observation is never included in its own normalization history;
- history window = prior **52 valid weekly factor observations**;
- standardized score = z-score versus those 52 own-history observations using sample standard deviation (n-1);
- require finite standard deviation > 0.

Position rule per factor-book:
- LONG if z-score >= +1.0
- SHORT if z-score <= -1.0
- otherwise flat

A factor-book is active only when:
- at least 2 LONG assets;
- at least 2 SHORT assets.

Active factor-book weights:
- total LONG gross = +0.50
- total SHORT gross = -0.50
- equal weight within each side
- gross exposure = 1.0
- net exposure = 0

If breadth fails, that factor-book is flat for the week.

## Factor independence

F1–F4 remain separate books.

Portfolio return = simple average of the four factor-book returns.

A flat factor-book contributes zero and its 25% capital sleeve is **not** reallocated to other factors.

No factor-score averaging is permitted in V1.

If the same asset is long in one factor and short in another, the books are still accounted independently; positions/costs are not netted across factor books. This is conservative and preserves factor independence.

## Conventional cross-sectional benchmark

For every factor, on the exact same eligible assets and timestamp:

- rank the same raw factor values across assets;
- long top 30%;
- short bottom 30%;
- exact side count = max(2, floor(number of eligible assets × 0.30));
- minimum 2 assets per side;
- +0.50 long gross / -0.50 short gross;
- equal weight within each side;
- same holding return;
- same funding treatment;
- same transaction costs;
- same four independent factor-books;
- same equal-weight combination across factor-books.

The benchmark differs only in **signal normalization/selection**.

## Perpetual return accounting

Signals use only completed information strictly before rebalance.

Execution-price proxy:
- entry = perpetual 4h kline **open** exactly at rebalance timestamp `t`;
- exit = perpetual 4h kline **open** exactly at `t+1w`;
- if either exact anchor open is unavailable, the affected factor-book period fails closed.

For an asset held from rebalance `t` to `t+1w`:

`priceReturn = Open[t+1w] / Open[t] - 1`

Funding over the holding interval uses realized funding events. Funding timestamps must be strictly increasing with no duplicates; a gap greater than 12 hours is a data-gate failure:

`fundingSum = sum(fundingRate where t < fundingTime <= t+1w)`

Signed position contribution:

`weight × (priceReturn - fundingSum)`

Thus:
- positive funding is a cost to LONGs;
- positive funding is income to SHORTs.

Funding and price contribution are reported separately.

## Transaction costs

Base modeled turnover cost:
- **8 bps per unit of absolute portfolio-weight turnover**

Turnover is measured separately inside each factor-book:
- entries;
- resizing;
- side changes;
- exits;
- final close.

Factor-book costs are then averaged with the factor-book returns.

No cross-factor netting of turnover.

Stress:
- **32 bps per unit turnover** = 4× base modeled cost.

No fee rebates or VIP assumptions.

## Price-only diagnostic

Run the exact same positions while setting realized funding PnL to zero.

This is a diagnostic of whether the result is only realized carry.

Discovery requires the primary Self-History portfolio to remain positive price-only after base costs.

## Discovery gate

Monday primary series must satisfy all:

- >=100 completed weekly portfolio periods after warm-up;
- net compounded return > 0;
- annualized Sharpe >= 0.75;
- Profit Factor >= 1.15;
- max closed-equity drawdown <= 25%;
- >=4 of 5 chronological windows positive;
- 32-bps stress compounded return > 0;
- price-only compounded return > 0;
- >=3 of 4 factor-books have positive net compounded return;
- no single positive factor-book contributes >60% of total positive factor-book PnL;
- Self-History net return > Cross-Sectional benchmark net return;
- Self-History annualized Sharpe > Cross-Sectional benchmark Sharpe;
- >=5 of 7 weekday-anchor Self-History runs have positive net return;
- no look-ahead/data-gate failure.

A discovery pass permits only the frozen temporal holdout.

## Holdout gate

Same rules, factors, z-history, thresholds, costs and portfolio construction.

Primary Monday:
- >=26 completed weekly periods;
- net compounded return > 0;
- annualized Sharpe > 0;
- Profit Factor >= 1.05;
- max drawdown <=25%;
- 32-bps stress return >0;
- price-only return >0;
- >=2 of 4 factor-books positive;
- Self-History net return > Cross-Sectional benchmark net return;
- Self-History Sharpe > Cross-Sectional benchmark Sharpe;
- >=4 of 7 weekday anchors positive.

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a pass does not authorize live execution.

## Anti-overfitting

- This protocol is committed before the first strategy result.
- No factor is added/dropped after results.
- No factor sign may be reversed after results.
- 52-week normalization, +/-1 z thresholds, weekly cadence and Monday primary anchor are frozen.
- No asset removal after results.
- Eligibility dates remain those produced by the prior independent data foundation.
- No cost reduction.
- No benchmark weakening.
- No gate relaxation.
- No discovery/holdout date change.
- Any redesign gets a new ruleset.

## Safety

Research only. No credentials, no orders, no live/Pionex/OKX/Binance account mutation, no leverage, no liquidation path and no automatic promotion.
