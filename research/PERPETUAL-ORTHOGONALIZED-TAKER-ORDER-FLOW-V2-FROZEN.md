# Perpetual Orthogonalized Taker Order Flow V2 — Frozen Protocol

Status: **FROZEN BEFORE FIRST V2 STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-TAKER-ORDER-FLOW-V1-DATA-FROZEN`
- `PERPETUAL-TAKER-ORDER-FLOW-V1-FROZEN` — immutable DEVELOPMENT failure

## Objective

Test the externally documented **orthogonalized order-flow** specification on a genuinely untouched time window.

V1 remains immutable and failed its frozen development gate despite positive aggregate economics. V2 is not a parameter rescue of V1. It implements a distinct specification reported in Anastasopoulos et al. (2026), *Order flow and cryptocurrency returns*, Journal of Financial Markets.

The paper defines orthogonalized weekly order flow as the last residual from a recursively estimated expanding regression of lagged order flow on lagged returns. Weekly portfolios sorted on that orthogonalized flow remained strongly positive out of sample in the paper.

MERIDIAN V2 adapts that idea to public Binance USD-M aggressive taker quote flow. It is not claimed as an exact replication because the paper uses international/world order flow rather than exchange-specific taker flow.

## Frozen universe

Exactly the same 12 assets inherited from the strategy-neutral data foundation:

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

No asset may be added, removed or substituted after results.

## Public data

Binance Vision USD-M monthly archives only:
- 1h perpetual trade klines
- fundingRate

No private API, credentials, synthetic backfill, interpolation or nearest-neighbor substitution.

## Frozen first independent validation

The first and only V2 strategy test before any transfer stage is:

- weekly Saturday 00:00 UTC anchors;
- `2025-01-11 <= t < 2026-08-29`;
- expected periods: **85**;
- final exit: 2026-08-29 00:00 UTC.

This window was never loaded or evaluated by V1.

Once V2 evaluates this window, it is no longer considered untouched for any future successor.

## Raw weekly flow — unchanged from V1

At anchor t, use exactly the 168 completed 1h bars in `[t-168h,t)`.

For each hour:
- Q = total quote asset volume;
- B = taker buy quote asset volume.

`RAW_FLOW_i,t = (2*sum(B)-sum(Q))/sum(Q)`

Require exactly 168 hourly bars and total quote volume >0.

## Same-period lagged weekly return

For the same information interval known at t:

`LAG_RETURN_i,t = OPEN_i(t) / OPEN_i(t-7d) - 1`

Both prices are known at the anchor.

No holding-period return enters the signal.

## Frozen recursive orthogonalization

For each asset separately:

- estimator anchors begin at **2023-01-14 00:00 UTC**;
- use every Saturday anchor s from 2023-01-14 through the current anchor t inclusive;
- for each s, construct the known pair `(LAG_RETURN_i,s, RAW_FLOW_i,s)`;
- require at least **52** valid historical pairs;
- estimate by OLS with intercept on the expanding sample:

`RAW_FLOW_i,s = alpha_i,t + beta_i,t * LAG_RETURN_i,s + epsilon_i,s`

- require finite coefficients and positive variance of lagged returns;
- define the current signal as the last residual:

`ORTHO_FLOW_i,t = RAW_FLOW_i,t - alpha_i,t - beta_i,t * LAG_RETURN_i,t`

This mirrors the paper's recursive last-residual construction while using MERIDIAN's exchange-specific flow measure.

No rolling-window search.
No alternate estimator.
No ridge/lasso/ML.
No residual standardization.
No clipping or winsorization.
No coefficient constraints.

## Cross-sectional ranking

At every validation anchor:
- require all 12 assets to have valid ORTHO_FLOW and exact entry/exit opens;
- sort ORTHO_FLOW descending;
- tie-break symbol ascending;
- side count = **2**.

LONG:
- top 2 highest ORTHO_FLOW assets.

SHORT:
- bottom 2 lowest ORTHO_FLOW assets.

Weights:
- each long = +0.25;
- each short = -0.25;
- long gross = +0.50;
- short gross = -0.50;
- net exposure = 0;
- gross exposure = 1.00.

No leverage above 1.0 gross.
No volatility scaling.
No threshold.
No stop loss.
No take profit.
No discretionary filter.

## Execution and holding

Entry:
- exact 1h open at t.

Exit:
- exact 1h open at t+7d.

Holding:
- exactly one week.

For signed weight w:

`PRICE_RETURN = w * (OPEN(t+7d)/OPEN(t)-1)`

## Funding

Use all realized Binance USD-M funding events in `(t,t+7d]`.

`FUNDING_RETURN = -w * sum(funding_rates)`

Selected active positions require maximum boundary/inter-event funding gap <=12h.

## Transaction costs

Preserve the already frozen assumptions:

- base: **8 bps** per unit portfolio turnover;
- stress: **13 bps** per unit portfolio turnover;
- full terminal close turnover charged.

No fee optimization, rebates or VIP discounts.

## Data integrity

Hourly data must have:
- finite positive OHLC;
- internally consistent OHLC;
- exact 1h cadence;
- no duplicate/non-monotonic timestamps;
- finite non-negative quote volume;
- finite non-negative taker-buy quote volume <= quote volume.

Every validation week requires:
- all 12 valid ORTHO_FLOW signals;
- exact entry and exit opens;
- complete selected-position funding.

If any condition fails, validation fails closed.

No reconstruction.

## Metrics

Report base and stress:
- 85 weekly periods
- eligible count
- side count
- net return
- price-only return
- funding contribution
- cost contribution
- Profit Factor
- annualized weekly Sharpe × sqrt(52)
- max drawdown
- five chronological-window returns
- turnover
- long/short gross contribution
- per-asset attribution
- positive asset count/concentration
- mean raw FLOW by selected side
- mean ORTHO_FLOW by selected side
- mean next-week long/short returns
- mean next-week high-minus-low ORTHO_FLOW spread
- mean estimator observation count
- mean absolute contemporaneous correlation diagnostic between ORTHO_FLOW and LAG_RETURN across assets

## Frozen independent-validation gate

All conditions must pass:

- exactly **85** completed weekly periods
- no data-integrity failure
- every week has exactly 12 eligible assets
- side count exactly 2 every week
- compounded net return >0
- compounded price-only return >0
- Profit Factor >= **1.10**
- annualized Sharpe >= **0.50**
- max drawdown <= **25%**
- >= **3 of 5** chronological windows positive
- stress compounded return >0
- long-side gross contribution >0
- short-side gross contribution >0
- >= **7 of 12** assets have positive net attribution
- no single positive asset contributes > **35%** of total positive PnL
- mean next-week high-minus-low selected price spread >0

PASS => `INDEPENDENT_VALIDATION_PASS_ASSET_TRANSFER_REQUIRED`

FAIL => `INDEPENDENT_VALIDATION_FAIL_RESEARCH_REDESIGN`

A PASS does not authorize Paper. It authorizes only a separately frozen validation on a new asset universe.

## Anti-overfitting

After the first V2 result, do not:
- change the 168h raw-flow window;
- change the lag-return definition;
- change estimator start;
- change expanding OLS to another estimator;
- remove current anchor from the recursive estimator;
- standardize or winsorize residuals;
- change Saturday anchors;
- change 1-week hold;
- remove the short side;
- remove assets;
- change costs;
- change gates;
- reuse the V2 validation window as a supposedly untouched successor holdout.

Any redesign receives a new ruleset and new independent evidence.

## Safety

Research only. No exchange credentials, live orders, leverage automation, wallet mutation or automatic promotion.
