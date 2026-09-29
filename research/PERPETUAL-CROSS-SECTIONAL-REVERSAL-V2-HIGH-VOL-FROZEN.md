# Perpetual Cross-Sectional Reversal V2 High-Vol — Frozen Protocol

Status: **FROZEN BEFORE FIRST V2 STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN` — immutable discovery failure
- `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-DATA-V1-FROZEN` — immutable data foundation
- MERIDIAN main after PR #314

## Objective

Test one externally motivated successor to V1: preserve the V1 reversal strategy and exclude the lowest-volatility tercile before the cross-sectional reversal ranking.

This is a new ruleset. V1 is not retuned, rescued or overwritten.

External motivation used before V2 results:
- Kiefer & Nowotny (2026), *Reversal in Cryptocurrency Returns*: reversal over 8–10 week formation windows is reported as stronger among relatively volatile cryptocurrencies and outside the largest tokens.
- Zaremba et al. (2021), *Up or down? Short-term reversal, momentum, and liquidity effects in cryptocurrency markets*: crypto reversal strength is cross-sectionally related to market structure/liquidity and is weaker among the largest, most tradeable coins.

MERIDIAN does not claim exact replication because V2 uses Binance USD-M perpetuals, realized funding and explicit retail-style execution costs.

## Frozen universe

Exactly the same 23 V1 assets:

ADA, DOGE, LINK, DOT, LTC, BCH, AVAX, HBAR, TRX, ETC, XLM, ATOM, UNI, AAVE, FIL, NEAR, OP, INJ, APT, CRV, LDO, GALA, IMX.

No asset may be added, removed or substituted after V2 results.

BTC, ETH, BNB, SOL and XRP remain excluded as mega-caps.

ARB remains excluded because it was not 2024-discovery-ready in the parent foundation.

## Public data

Binance Vision USD-M monthly archives only:
- 1d perpetual trade klines
- fundingRate

No private API, credentials, synthetic backfill, interpolation or nearest-neighbor substitution.

## Frozen first independent validation

Weekly entry anchors:
- Monday 00:00 UTC
- `2025-01-06 <= t < 2026-08-31`

Final exit:
- 2026-08-31 00:00 UTC

Expected weekly periods:
- **86**

This window was never loaded by Reversal V1 because V1 failed discovery.

No V2 strategy data from this window may be inspected before this protocol and its invariants are committed.

## Information timing

Daily Binance klines use UTC open timestamps.

At anchor t:
- formation endpoint information ends at the completed close known at `t-7d`;
- no observation from the skipped week `[t-7d, t)` enters formation return or volatility;
- entry price = exact daily open at t;
- exit price = exact daily open at `t+7d`.

No current-day close or future data may affect selection.

## V1 signal preserved

Formation:
- exact 8-week price return from completed close known at `t-63d` to completed close known at `t-7d`.

`FORMATION_RETURN_i,t = CLOSE_i(t-7d) / CLOSE_i(t-63d) - 1`

Skip:
- 1 week.

Hold:
- 1 week.

No funding, volume, basis, open interest, market-cap or future information enters the reversal ranking.

## V2 high-volatility condition — only strategy change

For each otherwise eligible asset at anchor t:

1. Build the exact sequence of completed daily closes from `t-63d` through `t-7d`.
2. Compute the **56 one-day log returns** inside that interval.
3. Compute sample standard deviation with n-1 denominator:
   `VOL_i,t = stdev(log(CLOSE_d / CLOSE_{d-1}))`.
4. Rank eligible assets by `VOL` ascending; ties by asset symbol ascending.
5. Exclude exactly the lowest-volatility tercile:
   - `LOW_COUNT = floor(N / 3)`
   - keep the remaining `N - LOW_COUNT` assets.
6. No volatility threshold value is estimated from PnL.
7. No volatility scaling or inverse-volatility weighting is used.

With all 23 assets eligible:
- exclude 7 lowest-volatility assets;
- retain 16 high-/mid-volatility assets.

The filter is cross-sectional and recalculated weekly using only pre-anchor information.

## Ranking and portfolio

Within the retained V2 universe:
- rank by `FORMATION_RETURN` ascending;
- ties by asset symbol ascending;
- `SIDE_COUNT = floor(HIGH_VOL_COUNT / 5)`;
- require `SIDE_COUNT >= 3`.

LONG:
- bottom SIDE_COUNT recent losers.

SHORT:
- top SIDE_COUNT recent winners.

Weights:
- LONG gross = +0.50, equal weight;
- SHORT gross = -0.50, equal weight;
- net exposure = 0;
- gross exposure = 1.00.

No leverage beyond 1.0 gross.
No volatility scaling.
No inverse-volatility weighting.
No stop loss.
No take profit.
No pyramiding.
No averaging down.
No discretionary filter.

Rebalance once per week.

## Funding PnL

Use realized Binance USD-M funding events with timestamps in `(t, t+7d]`.

For signed portfolio weight `w_i,t`:
`FUNDING_RETURN_i,t = -w_i,t × sum(funding_rates_i)`.

Positive funding charges longs and rewards shorts.

Funding is reported separately.

## Transaction costs

Preserve V1:
- base one-way cost = **8 bps per unit portfolio turnover**
- stress one-way cost = **13 bps per unit portfolio turnover**

Turnover:
`sum(abs(new_weight_i - prior_weight_i))`.

Full terminal close turnover is charged.

No maker rebates, VIP discounts, fee-token discounts or fee optimization.

## Data integrity

Price data used by V2 must have:
- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 24-hour cadence across every required formation, volatility and holding interval.

Funding used by an active holding must have:
- finite rates;
- strictly increasing timestamps;
- no duplicates;
- max inter-event/boundary gap <=12h.

At every week:
- require all 23 parent-universe assets to be strategy-eligible before the volatility filter;
- otherwise fail closed.

No reconstruction.

## Metrics

Report base and stress:
- completed weekly periods
- high-volatility retained count
- side count
- compounded net return
- compounded price-only return
- funding contribution
- transaction-cost contribution
- Profit Factor
- annualized Sharpe from weekly net returns using sample stdev × sqrt(52)
- max drawdown
- five chronological-window returns
- turnover
- long-side gross contribution
- short-side gross contribution
- per-asset net attribution
- positive-PnL asset count
- maximum positive-PnL concentration
- mean loser-minus-winner next-week price spread
- weekly excluded low-volatility assets

## Frozen independent-validation gate

All conditions must pass:
- exactly **86** completed weekly periods
- no data-integrity failure
- exactly 23 pre-filter eligible assets every week
- retained high-vol count exactly 16 every week
- side count exactly 3 every week
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

PASS => `INDEPENDENT_VALIDATION_PASS_TRANSFER_REQUIRED`

FAIL => `INDEPENDENT_VALIDATION_FAIL_RESEARCH_REDESIGN`

A PASS does not authorize Paper or live execution.

## Required transfer validation before Paper

If and only if the first independent validation passes:
- freeze a separate transfer universe and window before its first PnL;
- no V2 parameter changes;
- require a separate transfer gate;
- only a transfer PASS can make V2 eligible for prospective Paper shadow review.

## Anti-overfitting

After first V2 result, do not:
- change the 8-week formation horizon;
- change the 1-week skip;
- change the 1-week hold;
- change the low-volatility tercile exclusion;
- change the volatility estimator or lookback;
- change the quintile side-count rule;
- remove the short side;
- change equal weighting;
- remove losing assets;
- reduce costs;
- relax gates;
- move the validation window;
- load a transfer set unless the first independent gate passes.

Any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
