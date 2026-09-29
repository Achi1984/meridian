# Cross-Sectional Funding Carry Risk-Budget V2 — Frozen Validation Protocol

Status: **FROZEN BEFORE FIRST STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `CROSS-SECTIONAL-FUNDING-CARRY-V1-FROZEN`
- `FUNDING-CARRY-RISK-BUDGET-V2-DATA-V1-FROZEN`

## Why V2 exists

V1 produced strong economics on LTC/BCH/AVAX/HBAR but failed its preregistered risk/concentration gates:
- max drawdown 48.86% > 25%;
- positive-PnL concentration 61.34% > 50%.

V2 does **not** change the Funding Carry signal. It tests a separately preregistered diversification/risk architecture on a previously unused universe.

## Independent validation universe

Frozen and data-audited before any V2 PnL:

- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR

All 8 passed the V2 data foundation and are objectively eligible from 2023-01.

No asset may be added, removed or substituted after results.

## Validation window

Weekly Monday anchors:
- entry anchors: 2023-04-03 00:00 UTC <= t < 2026-08-31 00:00 UTC
- final exit/rebalance mark: 2026-08-31 00:00 UTC

No strategy PnL from this eight-asset universe has been used to choose V2 parameters.

## Official data

Binance Vision public USD-M monthly archives only:
- 4h perpetual klines
- fundingRate

No private API, account data, synthetic rows or interpolation.

## Funding factor — unchanged from V1

For asset i at weekly rebalance t:

`FUNDING_CARRY_7D = -sum(realized funding rates in [t-7d,t))`

Frozen direction:
- higher factor => LONG candidate
- lower factor => SHORT candidate

No direction flip.

## Legacy history-availability filter — unchanged

For each asset/week:
- current Funding Carry factor must be valid;
- inspect at most the prior 60 weekly anchors;
- require at least 52 valid prior Funding Carry observations;
- current observation is excluded from the history requirement.

The history filter qualifies availability only. Current cross-sectional rank uses only the current Funding Carry factor.

## Funding validity — unchanged

A signal window [t-7d,t) is valid only when:
- all rates are finite;
- timestamps strictly increase;
- no duplicates;
- no boundary/inter-event funding gap >12 hours.

No funding event is inferred or synthesized.

## Breadth gate

A week may trade only when at least **6 of 8** objectively eligible assets pass current-factor plus legacy-history availability.

Otherwise the complete strategy is FLAT for that week and normal turnover to zero is charged.

## Cross-sectional selection

On an active week:
- rank all valid assets by current `FUNDING_CARRY_7D`;
- LONG the top **2** assets;
- SHORT the bottom **2** assets.

Pre-risk weights are fixed:
- each LONG = +0.25
- each SHORT = -0.25
- pre-risk gross exposure = 1.00
- pre-risk net dollar exposure = 0

There is no inverse-volatility asset weighting, no ranking threshold and no discretionary skip.

## Ex-ante 28-day portfolio-volatility estimate

After the four assets are selected at t:

For each selected asset:
- use exact completed 4h closes from [t-28d,t];
- require **169 exact 4h closes**, yielding 168 consecutive 4h log returns;
- any missing exact 4h close makes the **whole V2 strategy FLAT for that week**;
- do not replace the affected selected asset with the next-ranked asset.

Build 168 pre-risk portfolio log returns using the fixed signed weights:
- +0.25, +0.25, -0.25, -0.25.

Portfolio ex-ante annualized volatility:
- sample standard deviation (n-1) of those 168 portfolio returns
- multiplied by `sqrt(6 × 365)`.

The estimate must be finite and >0.

No EWMA, no volatility floor and no future data.

## Frozen risk budget

Target:
- **10% annualized ex-ante portfolio volatility**

Risk scale:
- `risk_scale = min(1.0, 0.10 / estimated_portfolio_vol)`

Rules:
- the scalar may only reduce exposure;
- no leverage;
- final gross exposure <=1.00;
- residual capital remains cash;
- if the risk estimate is invalid, the strategy is FLAT for that week.

Final asset weights:
- pre-risk weight × risk_scale.

No minimum risk scale and no result-dependent rescaling.

## Holding-period integrity

For every non-zero selected position:
- exact entry 4h close at t;
- exact exit 4h close at t+1w;
- funding coverage in (t,t+1w] with finite rates and no gap >12h.

If a non-zero selected position lacks holding-period inputs, the **entire validation stage** fails closed with `DATA_INTEGRITY_FAILURE`.

## Weekly PnL

Price contribution:
- `w_i × (P_i(t+1w)/P_i(t)-1)`

Funding contribution:
- `-w_i × sum(realized funding in (t,t+1w])`

Net weekly return:
- price contribution
- + funding contribution
- - transaction cost.

## Costs — unchanged

Base:
- **8 bps per unit turnover**

Turnover:
- sum absolute change in final scaled weights versus prior weekly final weights.

Stress:
- **32 bps per unit turnover**

At the final validation exit:
- force all weights to zero;
- charge full terminal turnover.

No maker rebates, VIP discounts or fee-token assumptions.

## Metrics

Report:
- completed weekly periods
- active weeks (at least one final post-scale asset weight is non-zero)
- flat-by-breadth weeks
- flat-by-risk-data weeks
- compounded net return
- compounded price-only return
- cumulative funding contribution
- cumulative cost contribution
- Profit Factor
- annualized Sharpe = mean weekly return / sample stdev × sqrt(52)
- max drawdown
- 5 chronological-window returns
- long-side contribution
- short-side contribution
- per-asset attribution
- positive-PnL asset count
- max positive-PnL concentration
- turnover
- 32 bps stress return
- mean/median final gross exposure across active weeks only
- mean risk scale across active weeks only
- mean estimated pre-scale portfolio annualized volatility across active weeks only

## Frozen validation gate

All conditions must pass:

- >=150 completed weekly periods
- >=100 active weeks
- compounded net return >0
- compounded price-only return >0
- cumulative funding contribution >0
- Profit Factor >=1.10
- annualized Sharpe >=0.75
- max drawdown <=20%
- >=4 of 5 chronological windows positive
- long-side contribution >0
- short-side contribution >0
- >=5 of 8 assets with positive PnL attribution
- no single positive asset contributes >35% of total positive PnL
- 32 bps stress compounded return >0
- mean final gross exposure >=0.25
- no data-integrity failure

PASS => `VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

Even a PASS authorizes only a separately reviewed prospective Paper shadow, never live execution.

## Anti-overfitting

- protocol committed before first V2 PnL;
- V1 remains immutable;
- no asset substitution;
- no factor definition/direction change;
- no 7d lookback change;
- no 52-of-60 change;
- no top-2/bottom-2 change;
- no 28d risk window change;
- no 10% volatility-target change;
- no gross-cap change;
- no cost reduction;
- no date movement;
- no losing-week removal;
- no fallback to the parallel 20%-target/inverse-vol draft;
- LTC/BCH/AVAX/HBAR are not independent V2 validation data;
- any redesign receives a new ruleset.

## Safety

Research only. No credentials, live orders, leverage, liquidation model, account mutation or automatic promotion.
