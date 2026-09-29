# Cross-Sectional Funding Carry Risk-Budget V2 — Frozen Validation Protocol

Status: **FROZEN BEFORE FIRST STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `CROSS-SECTIONAL-FUNDING-CARRY-V1-FROZEN`
- `FUNDING-CARRY-RISK-BUDGET-V2-DATA-V1-FROZEN`

## Why V2 exists

V1 produced strong economics on LTC/BCH/AVAX/HBAR but failed the preregistered promotion gate because:
- max drawdown = 48.86% > 25%;
- positive-PnL concentration = 61.34% > 50%.

All other V1 gates passed.

V2 changes only the ex-ante portfolio-risk construction. The Funding Carry factor, factor direction, weekly cadence, funding cash-flow treatment, turnover-cost model and fail-closed data rules remain unchanged.

## Independent validation universe

Previously unused and frozen before any V2 strategy result:

- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR

All eight passed the independent V2 data-foundation audit and are objectively eligible from 2023-01.

No asset may be added, removed or substituted after V2 results.

## Validation window

Weekly Monday anchors:
- entry anchors: 2023-04-03 00:00 UTC <= t < 2026-08-31 00:00 UTC
- final exit/rebalance mark: 2026-08-31 00:00 UTC

No strategy PnL from this eight-asset universe has been used to tune V2.

## Official data

Binance Vision public USD-M monthly archives only:
- 4h perpetual klines
- fundingRate

No authenticated API, private account data, synthetic rows or interpolation.

## Funding factor — unchanged

For asset i at weekly rebalance t:

`FUNDING_CARRY_7D = -sum(realized funding rates in [t-7d,t))`

Direction remains frozen:
- higher factor => LONG candidate
- lower factor => SHORT candidate

No direction flip.

## Legacy history-availability filter — unchanged

For each asset/week:
- current Funding Carry factor must be valid;
- inspect at most the prior 60 weekly anchors;
- require at least 52 valid prior Funding Carry observations;
- current observation is excluded from the 52-history requirement.

The 52 historical values qualify availability only. They do not affect the current cross-sectional rank.

## Current funding validity — unchanged

Signal window [t-7d,t) is valid only when:
- all funding values are finite;
- timestamps strictly increase;
- no duplicates;
- no boundary/inter-event gap >12 hours.

No funding event is inferred or synthesized.

## Breadth gate

A V2 week may trade only when at least **6 of 8** objectively eligible assets pass current-factor plus legacy-history availability.

Otherwise the strategy is FLAT for that week and normal turnover to zero is charged.

## Cross-sectional selection

On an active week:
- rank all valid assets by current `FUNDING_CARRY_7D`;
- LONG the top **2** assets;
- SHORT the bottom **2** assets.

No ranking threshold, skip rule, discretionary filter or second-stage signal.

## Ex-ante volatility estimate

For each selected asset at anchor t:

- use exact completed 4h closes from [t-28d, t];
- require **169 exact 4h closes**, yielding 168 consecutive 4h log returns;
- any missing exact 4h mark makes that selected asset unavailable for the V2 week;
- sample standard deviation (n-1) of the 168 log returns;
- annualized volatility = sample stdev × sqrt(6 × 365).

Volatility must be finite and >0.

No EWMA half-life, volatility floor or future data.

## Side-level inverse-volatility risk budget

LONG and SHORT sides are budgeted independently.

For the two selected assets on one side:
1. raw risk weight = inverse annualized volatility;
2. normalize raw weights to side gross 0.50;
3. constrain each absolute asset weight to **[0.15, 0.35]**;
4. with exactly two assets, the companion weight is 0.50 minus the first, so side gross remains exactly 0.50 before portfolio-level scaling.

This guarantees four selected positions before portfolio-level risk scaling and prevents a single asset from receiving more than 35% gross weight.

## Portfolio-level volatility downscaler

After the preliminary four weights are formed:

- build the trailing 28-day 4h portfolio-return series using the same 168 timestamps and the preliminary fixed weights;
- portfolio return per 4h interval = sum(weight_i × asset log return_i);
- ex-ante portfolio annualized vol = sample stdev × sqrt(6 × 365).

Frozen target:
- **20% annualized portfolio volatility**

Scale:
- `risk_scale = min(1.0, 0.20 / estimated_portfolio_vol)`

Rules:
- scaling may only reduce exposure;
- scaling may never increase exposure above the preliminary 1.00 gross;
- no leverage;
- if portfolio vol is non-finite or <=0, the week fails closed to FLAT.

Final weights:
- preliminary weight × risk_scale.

Final gross exposure:
- <=1.00.

## Holding-period integrity

For every selected/scaled position:
- exact entry 4h close at t;
- exact exit 4h close at t+1w;
- funding coverage in (t,t+1w] with finite values and no gap >12h.

If any active selected position lacks these inputs, the entire validation stage fails closed with `DATA_INTEGRITY_FAILURE`.

## Weekly PnL

Price contribution:
- `w_i × (P_i(t+1w)/P_i(t)-1)`

Funding contribution:
- `-w_i × sum(realized funding in (t,t+1w])`

Net weekly return:
- price contribution
- + funding contribution
- - modeled transaction costs

## Costs — unchanged

Base:
- **8 bps per unit turnover**

Turnover:
- sum absolute change in final scaled asset weights versus prior weekly final weights.

Stress:
- **32 bps per unit turnover**

At final validation exit:
- all positions forced flat;
- full terminal turnover charged.

No maker rebates, VIP discounts or fee-token assumptions.

## Metrics

Report:
- completed weekly periods
- active weeks
- flat-by-breadth/risk-data weeks
- compounded net return
- compounded price-only return
- cumulative funding contribution
- cumulative modeled cost contribution
- Profit Factor
- annualized Sharpe = mean weekly return / sample stdev × sqrt(52)
- max drawdown
- five chronological-window returns
- long-side gross contribution
- short-side gross contribution
- per-asset PnL attribution
- positive-PnL asset count
- max positive-PnL concentration
- turnover
- 32 bps stress return
- mean final gross exposure
- median final gross exposure
- mean risk_scale
- mean selected-asset annualized vol
- mean estimated portfolio annualized vol before scaling

## Frozen validation gate

All conditions must pass:

- >=150 completed weekly periods
- >=100 active weeks
- compounded net return >0
- compounded price-only return >0
- cumulative funding contribution >0
- Profit Factor >=1.05
- annualized Sharpe >=0.50
- max drawdown <=25%
- >=3 of 5 chronological windows positive
- long-side contribution >0
- short-side contribution >0
- >=5 of 8 assets with positive PnL attribution
- no single positive asset contributes >35% of total positive PnL
- 32 bps stress compounded return >0
- mean final gross exposure >=0.35
- no data-integrity failure

PASS => `VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

Even a PASS authorizes only a future prospective Paper shadow, never live execution.

## Anti-overfitting

- This protocol is committed before the first V2 strategy result.
- V1 remains immutable.
- No asset substitution.
- No factor definition/direction change.
- No 7d funding lookback change.
- No 52-of-60 history filter change.
- No top-2/bottom-2 change.
- No 28d volatility window change.
- No 15%-35% asset-weight bounds change.
- No 20% volatility target change.
- No cost reduction.
- No validation-date movement.
- No losing week removal.
- No use of LTC/BCH/AVAX/HBAR as independent V2 validation.
- Any redesign receives a new ruleset.

## Safety

Research only. No credentials, live orders, leverage, liquidation model, account mutation or automatic promotion.
