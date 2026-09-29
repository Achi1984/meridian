# AdaptiveTrend Sharpe Proxy V1 — Frozen Research Protocol

Status: **FROZEN BEFORE RESULT**  
Ruleset: `ADAPTIVE-TREND-SHARPE-PROXY-V1-FROZEN`  
Execution impact: **false**  
Auto-promotion: **false**

## Purpose

Test a publication-inspired AdaptiveTrend challenger as a new research family after:
- canonical V1/V2 directional research failed its frozen gates;
- the non-canonical r69 6h long-only V3 remained unvalidated;
- Cross-Venue Funding Spread V1 passed discovery but failed its independent transfer holdout.

This is **not** a rescue or retune of any prior strategy.

## External basis fixed before result

Bui & Nguyen (2026), *Systematic Trend-Following with Adaptive Portfolio Construction*, describes:
- 6-hour momentum signals;
- ATR-based dynamic trailing stops;
- monthly Sharpe-based asset selection;
- asymmetric 70/30 long-short allocation;
- transaction costs plus perpetual funding;
- strict non-overlapping calibration/evaluation windows.

The paper reports α=2.5 and λ=0.70 as its default/central configuration and reports materially weaker performance when adaptive components are removed.

## Exact-replication boundary

`exactReplication=false`.

The accessible paper text does not fully expose the original monthly parameter-search grid or a historical market-cap dataset suitable for exact reconstruction. V1 therefore freezes a transparent proxy rather than inventing those missing details.

No result may be described as a replication of the paper.

## Frozen traded universe

This universe is intentionally disjoint from the r69 V3 discovery assets BTC/ETH/SOL/XRP/HBAR/LINK/AVAX/SUI.

Trade assets:
- BNB
- DOGE
- ADA
- DOT
- LTC
- BCH
- TRX
- XLM
- ETC
- FIL
- ATOM
- NEAR

BTC is loaded only as a benchmark and is not traded.

No asset may be dropped or substituted after result inspection.

## Data

Source:
- official Binance Vision USD-M futures archives;
- completed 6h OHLCV bars;
- official historical funding-rate archives.

Load window:
- warm-up/calibration data from 2021-10-01 UTC;
- evaluation from 2022-01-01 UTC through 2026-09-01 UTC;
- completed bars/months only.

No synthetic history or interpolation.

An asset is unavailable until it has all required lookback/ATR/selection history. Missing data fails closed for that asset/bar.

## Frozen signal parameters

Timeframe: 6h

Momentum:
- lookback `L = 24` completed 6h bars (~6 days);
- momentum = close / close[L] - 1;
- LONG entry signal when momentum > +3%;
- SHORT entry signal when momentum < -3%;
- no entry otherwise.

These fixed center parameters are a preregistered proxy. They are **not** claimed to be the paper's exact optimized parameters.

ATR:
- Wilder ATR period = 14 completed 6h bars;
- trailing multiplier `α = 2.5`.

Trailing exits, evaluated only on completed 6h closes:
- LONG stop = max(previous stop, close - 2.5×ATR);
- close LONG when close < stop;
- SHORT stop = min(previous stop, close + 2.5×ATR);
- close SHORT when close > stop.

No intra-candle fill ordering is invented.

## Monthly walk-forward selection

At each UTC calendar-month boundary:
- use only data strictly prior to the new month;
- impose a 24-hour buffer: the final four 6h bars before the new month are excluded from the selection sample;
- selection sample = preceding calendar month before that buffer;
- evaluate the same frozen signal separately as a long-only and short-only standalone strategy;
- include flat bars as zero returns;
- use realized 6h net returns including modeled turnover cost and realized funding;
- annualize Sharpe with `sqrt(4×365)`;
- risk-free rate = 0 for the monthly selector.

Eligibility:
- LONG eligible if preceding-month long-only Sharpe >= 1.3;
- SHORT eligible if preceding-month short-only Sharpe >= 1.7.

No parameter search is performed in V1. This isolates the Sharpe-selection + trailing-stop + asymmetric-allocation hypothesis without reconstructing an undocumented grid.

## Portfolio construction

At each completed 6h bar:
- selected assets may hold a position only if their frozen signal/state is active;
- long capital budget = 70%;
- short capital budget = 30%;
- equal weight among active assets within each side;
- an unused side remains cash;
- no reallocation of unused short budget to longs or vice versa;
- maximum gross exposure = 100%;
- no leverage;
- no pyramiding;
- no averaging down;
- no martingale.

## Funding

Funding is mandatory, not optional.

For every official Binance funding settlement while a position is active:
- LONG contribution = `-abs(weight) × fundingRate`;
- SHORT contribution = `+abs(weight) × fundingRate`.

Funding settlements must be timestamp-monotonic and deduplicated. Missing required funding data fails closed for that asset interval.

## Costs

Base one-way turnover cost:
- 8 bps per absolute weight change.

This conservatively combines trading fee + slippage versus the paper's 4 bps fee plus variable slippage model.

Stress:
- 12 bps per absolute weight change.

Costs apply to entries, exits, side changes and monthly weight changes.

## Benchmarks

Report over the same evaluation timestamps:
- BTC buy-and-hold;
- equal-weight buy-and-hold of the 12 frozen trade assets.

Benchmarks do not affect the frozen pass/fail gate.

## Frozen discovery gate

A discovery PASS requires all:
- >= 4,000 valid 6h portfolio evaluation bars;
- net compounded return > 0;
- Profit Factor >= 1.20;
- max closed-equity drawdown <= 20%;
- annualized Sharpe >= 1.00;
- >= 4 of 5 chronological windows positive;
- >= 6 of 12 assets with positive net contribution;
- no single positive asset contributes > 35% of total positive PnL;
- stressed 12-bps result remains positive;
- complete funding/cost accounting for every included position interval;
- no synthetic reconstruction.

A PASS is **discovery only** and requires an independent frozen holdout before any prospective Paper shadow.

## Mandatory diagnostics

Report:
- long contribution;
- short contribution;
- funding contribution by side;
- turnover and modeled costs;
- active long/short share;
- monthly selected-asset counts;
- per-asset contribution;
- benchmark returns;
- rejected/unavailable asset intervals;
- base vs 12-bps stress performance.

Diagnostics are non-gating unless explicitly listed above.

## Anti-overfitting

- This protocol must be committed before first result.
- No parameter, threshold, asset, cost, date or gate may change after result inspection.
- No losing asset may be removed.
- No side may be disabled after seeing contributions.
- No market-regime filter may be added to rescue V1.
- If V1 fails, any redesign receives a new ruleset and preregistration.
- No live/Pionex/OKX execution changes.

## Sources frozen with the hypothesis

- Bui & Nguyen (2026), arXiv:2602.11708.
- Binance Vision official public historical USD-M data archives.

Research only. No account credentials. No order functions.
