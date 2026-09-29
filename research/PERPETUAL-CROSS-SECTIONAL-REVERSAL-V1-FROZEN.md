# Perpetual Cross-Sectional Reversal V1 — Frozen Strategy Protocol

Status: **FROZEN BEFORE FIRST STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-DATA-V1-FROZEN`
- MERIDIAN main after PR #312

## Objective

Test a simple perpetual-futures adaptation of the externally documented intermediate-horizon cryptocurrency reversal effect.

External motivation:
- cryptocurrency cross-sectional reversal is reported at roughly 8–10 week formation horizons;
- an 8-week formation / 1-week skip / 1-week hold specification is publicly described;
- reversal is reported as stronger outside mega-caps and among more volatile assets.

V1 intentionally tests only the **core 8-week contrarian signal**.

V1 does **not** use:
- volatility conditioning;
- inverse-volatility weighting;
- a 10-week alternative;
- multiple skip periods;
- multiple holding periods;
- parameter grids.

This is not claimed as an exact replication because MERIDIAN uses Binance USD-M perpetuals and explicitly includes realized funding and retail-style execution costs.

## Frozen strategy universe

Exactly the 23 assets labeled `2024_DISCOVERY_READY` by the frozen data foundation:

- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX
- HBAR
- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR
- OP
- INJ
- APT
- CRV
- LDO
- GALA
- IMX

ARB is retained in the data-foundation evidence but excluded from V1 strategy evaluation because it failed the preregistered 2024-discovery-ready label before strategy PnL.

No asset may be added, removed or substituted after results.

BTC, ETH, BNB, SOL and XRP remain excluded as mega-caps by the parent foundation.

## Public data

Binance Vision USD-M monthly archives only:
- 1d perpetual trade klines
- fundingRate

No private API, credentials, synthetic backfill, interpolation or nearest-neighbor substitution.

## Frozen time split

### Discovery

Weekly entry anchors:
- Monday 00:00 UTC
- `2024-01-08 <= t < 2024-12-30`

Final discovery exit:
- 2024-12-30 00:00 UTC

Expected weekly periods:
- **51**

No data from 2025-01-01 onward may be used to alter V1 after the first discovery result.

### Temporal holdout

Authorized only after discovery PASS:

Weekly entry anchors:
- Monday 00:00 UTC
- `2025-01-06 <= t < 2026-08-31`

Final holdout exit:
- 2026-08-31 00:00 UTC

No retuning.

## Weekly price marks

Daily Binance klines use UTC open timestamps.

For information known at anchor t:
- the last completed daily close is from the daily bar with `openTime = t - 1 day`;
- that close is mapped to the mark timestamp t.

For execution:
- entry price = exact daily **open** at t;
- exit price = exact daily **open** at t + 7 days.

No current-day close may enter an entry decision.

## Formation signal

At weekly anchor t:

Skip:
- exclude the immediately preceding week `[t-7d, t)`.

Formation:
- exact 8-week price return from the completed close known at `t-63d` to the completed close known at `t-7d`.

For asset i:

`FORMATION_RETURN_i,t = CLOSE_i(t-7d) / CLOSE_i(t-63d) - 1`

No funding is included in the ranking signal.

No volatility, volume, basis, funding, OI or market-cap variable enters the V1 ranking.

## Ranking and portfolio

At each weekly anchor:
- require at least **15** valid eligible assets;
- rank valid assets by `FORMATION_RETURN`, ascending;
- ties are broken by asset symbol ascending;
- side count = `floor(N / 5)`;
- require side count >=3.

LONG:
- bottom side count recent losers.

SHORT:
- top side count recent winners.

Weights:
- LONG gross = +0.50, equal weight across selected losers;
- SHORT gross = -0.50, equal weight across selected winners;
- portfolio net exposure = 0;
- portfolio gross exposure = 1.00.

No leverage beyond 1.0 gross.
No volatility scaling.
No inverse-volatility weighting.
No stop loss.
No take profit.
No pyramiding.
No averaging down.
No discretionary filter.

Positions are rebalanced once per week.

## Price PnL

For signed weight `w_i,t`:

`PRICE_RETURN_i,t = w_i,t × (OPEN_i(t+7d) / OPEN_i(t) - 1)`

Weekly portfolio price return is the sum across selected assets.

## Funding PnL

Use all realized Binance USD-M funding events with timestamps in `(t, t+7d]`.

For signed portfolio weight `w_i,t`:

`FUNDING_RETURN_i,t = -w_i,t × sum(funding_rates_i)`

Therefore:
- positive funding charges longs;
- positive funding rewards shorts.

Funding is reported separately from price return.

## Transaction costs

Frozen one-way base cost:
- **8 bps per unit portfolio turnover**
  - 5 bps fee proxy
  - 3 bps slippage proxy

Turnover:
- `sum(abs(new_weight_i - prior_weight_i))`

Base weekly cost:
- turnover × 0.0008

Frozen stress one-way cost:
- **13 bps per unit turnover**
  - base 8 bps
  - +5 bps adverse stress

Stress weekly cost:
- turnover × 0.0013

When positions are forced flat at the final stage exit, full terminal turnover is charged.

No maker rebates, VIP discounts, fee-token discounts or fee optimization.

## Data integrity

Daily price data used by V1 must have:
- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 24-hour cadence through every required formation and holding interval.

Funding used by an active holding must have:
- finite rates;
- strictly increasing timestamps;
- no duplicates;
- max inter-event/boundary gap <=12h.

A weekly ranking universe contains only assets with exact formation endpoints and exact entry/exit opens.

If fewer than 15 assets qualify:
- the week fails closed as a data-integrity failure rather than being treated as a strategy flat.

If any selected active position lacks valid hold-period funding:
- the stage fails closed.

No reconstruction.

## Metrics

Report base and stress variants.

Portfolio:
- completed weekly periods
- eligible asset count by week
- side count by week
- compounded net return
- compounded price-only return
- cumulative funding contribution
- modeled transaction-cost contribution
- Profit Factor
- annualized Sharpe using weekly returns and sample stdev
- max drawdown
- five chronological-window returns
- turnover

Breadth:
- long-side gross contribution before shared costs
- short-side gross contribution before shared costs
- per-asset PnL attribution
- positive-PnL asset count
- maximum positive-PnL concentration
- number of weeks each asset is long
- number of weeks each asset is short

Signal diagnostics:
- mean/median formation return of long basket
- mean/median formation return of short basket
- mean next-week price return of long basket
- mean next-week price return of short basket
- mean next-week loser-minus-winner spread

## Frozen discovery gate

All conditions must pass:

- exactly **51** completed weekly periods
- no data-integrity failure
- every week has >=15 eligible assets
- compounded net return >0
- compounded price-only return >0
- Profit Factor >= **1.15**
- annualized Sharpe >= **0.75**
- max drawdown <= **20%**
- >= **4 of 5** chronological windows positive
- stress compounded return >0
- long-side gross contribution >0
- short-side gross contribution >0
- >= **14 of 23** assets have positive net PnL attribution
- no single positive asset contributes > **20%** of total positive PnL
- mean next-week loser-minus-winner price spread >0

PASS => `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`

FAIL => `DISCOVERY_FAIL_RESEARCH_REDESIGN`

## Frozen temporal-holdout gate

If and only if discovery passes, run the untouched 2025-01-06 through 2026-08-31 holdout unchanged.

All conditions must pass:

- >= **85** completed weekly periods
- no data-integrity failure
- every week has >=15 eligible assets
- compounded net return >0
- compounded price-only return >0
- Profit Factor >= **1.05**
- annualized Sharpe >= **0.50**
- max drawdown <= **25%**
- >= **3 of 5** chronological windows positive
- stress compounded return >0
- long-side gross contribution >0
- short-side gross contribution >0
- >= **12 of 23** assets have positive net PnL attribution
- no single positive asset contributes > **25%** of total positive PnL
- mean next-week loser-minus-winner price spread >0

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a holdout PASS does not authorize live execution.

## Anti-overfitting

- this protocol is committed before first V1 strategy PnL;
- 8-week formation is fixed;
- 1-week skip is fixed;
- 1-week holding is fixed;
- quintile-style `floor(N/5)` side count is fixed;
- equal weighting is fixed;
- no volatility conditioning may be added after results;
- no inverse-volatility weighting may be added after results;
- no 10-week rescue;
- no alternate skip/holding horizon;
- no asset removal;
- no fee/slippage reduction;
- no losing week exclusion;
- no discovery/holdout date movement;
- no gate relaxation;
- any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
