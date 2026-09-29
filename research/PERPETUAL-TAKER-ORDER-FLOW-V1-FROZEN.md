# Perpetual Taker Order Flow V1 — Frozen Strategy Protocol

Status: **FROZEN BEFORE FIRST STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `PERPETUAL-TAKER-ORDER-FLOW-V1-DATA-FROZEN` — 12/12 complete, 2023-01..2026-08

## Objective

Test whether lagged aggressive taker flow in Binance USD-M perpetual futures predicts the cross-section of next-week returns in the same direction.

External motivation fixed before first PnL:
- Anastasopoulos et al. (2026), *Order flow and cryptocurrency returns*, Journal of Financial Markets, reports positive out-of-sample predictive power of lagged order flow for cryptocurrency returns, with the weekly relation stronger than the daily relation and weekly high-minus-low order-flow portfolios economically meaningful.
- MERIDIAN deliberately uses a slower weekly horizon rather than seconds-scale execution because recent microstructure evidence shows very short-horizon order-flow predictability can be fragile after costs.

This is not an exact replication: the paper's primary flow measure is international/world order flow, whereas MERIDIAN V1 uses public Binance USD-M aggressive taker quote flow.

## Frozen universe

Exactly the 12 assets qualified by the parent foundation:

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

## Weekly calendar

All anchors are **Saturday 00:00 UTC**.

This aligns the test with a Saturday-to-Friday crypto week while ensuring the signal uses only completed hours before entry.

### Development

Entry anchors:
- `2023-01-14 <= t < 2024-12-28`

Expected periods:
- **102**

Last development entry:
- 2024-12-21 00:00 UTC

Final development exit:
- 2024-12-28 00:00 UTC

### Temporal holdout

Authorized only after a development PASS.

Entry anchors:
- `2025-01-11 <= t < 2026-08-29`

Expected periods:
- **85**

Last holdout entry:
- 2026-08-22 00:00 UTC

Final holdout exit:
- 2026-08-29 00:00 UTC

No holdout signal, ranking, position or PnL may be calculated before a development PASS.

## Frozen lagged taker-flow signal

At weekly anchor t, for asset i:

Use exactly the **168 completed 1-hour bars** with open timestamps in:

- `[t-168h, t)`

For each hour h:
- `Q_i,h` = total quote asset volume
- `B_i,h` = taker buy quote asset volume
- implied aggressive sell quote volume = `Q_i,h - B_i,h`

Aggregate signed aggressive quote flow:

`SIGNED_FLOW_i,t = sum_h(B_i,h - (Q_i,h - B_i,h))`

Equivalent:

`SIGNED_FLOW_i,t = 2 * sum_h(B_i,h) - sum_h(Q_i,h)`

Normalize by total quote volume:

`FLOW_i,t = SIGNED_FLOW_i,t / sum_h(Q_i,h)`

Requirements:
- exactly 168 hourly bars;
- exact 1-hour cadence;
- every quote volume finite and >=0;
- every taker-buy quote volume finite and >=0 and <= quote volume;
- total quote volume >0.

No price return, funding, volatility, basis, open interest or future information enters the V1 ranking signal.

The signal direction is fixed **before PnL**:
- higher FLOW is expected to predict higher next-week return;
- lower FLOW is expected to predict lower next-week return.

No sign flip is allowed after results.

## Cross-sectional ranking

At every anchor:
- require all **12** assets to have a valid signal and exact entry/exit open;
- sort by FLOW descending;
- tie-break by symbol ascending;
- side count = `floor(12/5) = 2`.

LONG:
- top 2 highest FLOW assets.

SHORT:
- bottom 2 lowest FLOW assets.

Weights:
- each long = +0.25
- each short = -0.25
- long gross = +0.50
- short gross = -0.50
- net exposure = 0
- gross exposure = 1.00.

No leverage above 1.0 gross.
No volatility scaling.
No inverse-volatility weighting.
No threshold.
No stop loss.
No take profit.
No pyramiding.
No averaging down.
No discretionary filter.

## Execution

Entry:
- exact 1h kline open at t.

Exit:
- exact 1h kline open at `t+7d`.

Holding:
- exactly one week.

For signed portfolio weight `w_i,t`:

`PRICE_RETURN_i,t = w_i,t * (OPEN_i(t+7d) / OPEN_i(t) - 1)`

No current holding-week information can affect the entry decision.

## Funding

Use all realized Binance USD-M funding events with timestamps in:

- `(t, t+7d]`

For signed weight w:

`FUNDING_RETURN_i,t = -w_i,t * sum(funding_rates_i)`

Therefore:
- positive funding charges longs;
- positive funding rewards shorts.

Selected active positions require complete funding coverage with maximum boundary/inter-event gap <=12h.

## Transaction costs

Frozen base one-way cost:
- **8 bps per unit portfolio turnover**

Frozen stress one-way cost:
- **13 bps per unit portfolio turnover**

Turnover:
- `sum(abs(new_weight_i - prior_weight_i))`

Full terminal turnover is charged when the stage is forced flat.

No maker rebates, VIP discounts, fee-token discounts or execution optimization.

## Data integrity

Hourly price/order-flow data used by the strategy must have:
- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 1-hour cadence through every signal and holding interval;
- finite non-negative quote volume;
- finite non-negative taker-buy quote volume;
- taker-buy quote volume <= quote volume.

Every weekly ranking requires all 12 assets.

If any of the 12 lacks:
- any of the 168 signal hours;
- exact entry open;
- exact exit open;

the stage fails closed as a data-integrity failure.

If any selected position lacks valid funding coverage:
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
- annualized Sharpe = mean weekly net return / sample stdev × sqrt(52)
- max drawdown
- five chronological-window returns
- turnover

Breadth:
- long-side gross contribution before shared transaction costs
- short-side gross contribution before shared transaction costs
- per-asset net attribution
- positive-PnL asset count
- maximum positive-PnL concentration
- long/short week count by asset

Signal diagnostics:
- mean FLOW of long basket
- mean FLOW of short basket
- mean next-week price return of long basket
- mean next-week price return of short basket
- mean next-week high-flow-minus-low-flow price spread

## Frozen development gate

All conditions must pass:

- exactly **102** completed weekly periods
- no data-integrity failure
- every week has exactly 12 eligible assets
- side count exactly 2 every week
- compounded net return >0
- compounded price-only return >0
- Profit Factor >= **1.15**
- annualized Sharpe >= **0.75**
- max drawdown <= **25%**
- >= **4 of 5** chronological windows positive
- stress compounded return >0
- long-side gross contribution >0
- short-side gross contribution >0
- >= **8 of 12** assets have positive net PnL attribution
- no single positive asset contributes > **30%** of total positive PnL
- mean next-week high-flow-minus-low-flow price spread >0

PASS => `DEVELOPMENT_PASS_TEMPORAL_HOLDOUT_REQUIRED`

FAIL => `DEVELOPMENT_FAIL_RESEARCH_REDESIGN`

## Frozen temporal-holdout gate

Run only if development passes, unchanged.

All conditions must pass:

- exactly **85** completed weekly periods
- no data-integrity failure
- every week has exactly 12 eligible assets
- side count exactly 2 every week
- compounded net return >0
- compounded price-only return >0
- Profit Factor >= **1.05**
- annualized Sharpe >= **0.50**
- max drawdown <= **30%**
- >= **3 of 5** chronological windows positive
- stress compounded return >0
- long-side gross contribution >0
- short-side gross contribution >0
- >= **7 of 12** assets have positive net PnL attribution
- no single positive asset contributes > **35%** of total positive PnL
- mean next-week high-flow-minus-low-flow price spread >0

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a holdout PASS authorizes only prospective Paper review, never automatic Paper or live execution.

## Anti-overfitting

After first development PnL, do not:
- change the 168-hour signal window;
- change the Saturday anchor;
- change normalization;
- orthogonalize the flow measure;
- replace quote flow with base flow;
- add price, funding, volatility, basis or OI to the signal;
- flip continuation to reversal;
- change the 1-week hold;
- change side count;
- remove losing assets;
- change equal weighting;
- reduce costs;
- move development/holdout dates;
- relax gates;
- inspect holdout after development FAIL.

Daily variants, shorter horizons, ML variants, thresholds or alternate flow definitions require separately frozen successor rulesets.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
