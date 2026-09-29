# Spot-Perp Basis-Volatility Regime V1 — Frozen Feature Foundation

Status: **FROZEN BEFORE FEATURE RESULT**  
Execution impact: **false**  
Strategy PnL: **forbidden in this stage**  
Auto-promotion: **false**

Parent:
- `SPOT-PERP-BASIS-DISLOCATION-V1-FROZEN` immutable zero-trade failure
- `SPOT-PERP-BASIS-DISLOCATION-V1-DATA-V1-FROZEN` synchronized public data foundation

## Objective

Test one strategy-neutral hypothesis:

> The absolute Spot/Perpetual basis observed before a forecasting anchor contains incremental information about the next 24 hours of realized Spot volatility beyond the immediately preceding 24 hours of realized Spot volatility.

This is motivated by 2026 evidence that absolute perpetual basis can contain forward volatility information. MERIDIAN does **not** claim an exact replication of any paper.

This stage does not test a trading return and may not generate a trade signal.

## Frozen universe

Exactly:
- APT
- APE
- CRV
- SUSHI
- DYDX
- LDO
- GALA
- IMX

No asset substitution after results.

## Public data

Binance Vision only:
- Spot 8h klines
- USD-M Perpetual trade 8h klines

Funding is not used.

No private API, credentials, synthetic rows, interpolation or nearest-neighbor substitution.

## Frozen raw interval

- 2024-06-01 00:00 UTC through 2026-09-01 00:00 UTC
- exact synchronized 8h Spot/Perpetual timestamps required

## Daily forecast anchors

Only daily anchors at **00:00 UTC** are evaluated.

At forecast anchor t:
- the latest usable market observation is the completed 8h candle with `openTime + 8h = t`;
- no candle beginning at or after t may enter the feature or lagged-volatility baseline;
- future target data begin strictly after t.

Daily anchors ensure adjacent 24h targets do not overlap.

## Frozen feature

At anchor t:

`basis_t = ln(perp_close_t / spot_close_t)`

where both closes are from the exact completed 8h candle ending immediately before t.

Primary feature:

`ABS_LOG_BASIS_t = abs(basis_t)`

No sign flip, percentile signal, threshold or basis floor is used.

## Frozen baseline predictor

Trailing 24h Spot realized volatility at t:

- use exact Spot closes at t-24h, t-16h, t-8h, t;
- form three consecutive log returns;
- `LAG_RV24_t = sqrt(sum(return^2))`

All inputs are known by t.

## Frozen target

Forward 24h Spot realized volatility:

- use exact Spot closes at t, t+8h, t+16h, t+24h;
- form three consecutive future log returns;
- `FWD_RV24_t = sqrt(sum(return^2))`

No annualization is required because baseline and target share the same 24h horizon.

## Frozen temporal split

### Discovery fit
- anchors: 2024-09-01 <= t < 2025-09-01

### Independent feature holdout
- anchors: 2025-09-01 <= t < 2026-08-31
- the final anchor must still have an exact t+24h target inside the raw interval

The holdout is not used to fit coefficients, scaling, quantiles or thresholds.

Once this feature holdout is observed, it may **not** later be represented as independent strategy-PnL evidence. Any future strategy requires a new asset universe or prospective forward period.

## Per-asset preprocessing

For each asset independently, using discovery observations only:

- calculate discovery mean and sample standard deviation of `LAG_RV24`;
- calculate discovery mean and sample standard deviation of `ABS_LOG_BASIS`;
- z-score both predictors using these discovery statistics;
- freeze those statistics for holdout transformation.

If either predictor has non-positive/non-finite discovery standard deviation, the asset fails closed.

Target `FWD_RV24` remains in raw 24h realized-volatility units.

## Frozen models

Fit separately for each asset on discovery only.

### Baseline
`FWD_RV24 = a + b × z(LAG_RV24)`

### Augmented
`FWD_RV24 = a + b × z(LAG_RV24) + c × z(ABS_LOG_BASIS)`

Ordinary least squares only.

No regularization, feature selection, interaction, nonlinear transformation, tree model or ML search.

The augmented model's basis coefficient `c` must be estimated only once from discovery and is frozen for holdout prediction.

## Frozen monotonicity diagnostic

For each asset:

- calculate discovery 20th and 80th percentiles of `ABS_LOG_BASIS`;
- freeze those two cutoffs;
- in holdout, define LOW as basis <= discovery q20;
- define HIGH as basis >= discovery q80;
- compare mean `FWD_RV24` in HIGH vs LOW.

No holdout quantile fitting.

## Metrics

Per asset:
- discovery observations
- holdout observations
- augmented discovery basis coefficient c
- baseline holdout MSE
- augmented holdout MSE
- holdout MSE improvement %
- baseline holdout MAE
- augmented holdout MAE
- holdout MAE improvement %
- discovery q20/q80 basis
- holdout LOW count / HIGH count
- holdout LOW mean forward RV
- holdout HIGH mean forward RV
- HIGH/LOW forward-RV ratio
- Pearson correlation between holdout ABS_LOG_BASIS and FWD_RV24

Pooled:
- total discovery observations
- total holdout observations
- pooled baseline MSE
- pooled augmented MSE
- pooled MSE improvement %
- pooled baseline MAE
- pooled augmented MAE
- pooled MAE improvement %
- pooled HIGH/LOW forward-RV ratio
- assets with positive discovery c
- assets with positive holdout MSE improvement
- assets with HIGH mean RV > LOW mean RV

## Frozen feature-foundation gate

All must pass:

- all 8 frozen assets represented;
- no data-integrity failure;
- each asset has >=330 discovery observations;
- each asset has >=330 holdout observations;
- each asset has >=40 LOW and >=40 HIGH holdout observations;
- discovery augmented basis coefficient `c > 0` for >=6 of 8 assets;
- augmented model improves holdout MSE for >=5 of 8 assets;
- pooled holdout MSE improvement >= **2.0%**;
- pooled holdout MAE improvement > **0%**;
- HIGH holdout mean forward RV > LOW mean forward RV for >=5 of 8 assets;
- pooled HIGH/LOW forward-RV ratio >= **1.10**;
- no strategy PnL calculated.

PASS => `FEATURE_FOUNDATION_PASS_STRATEGY_PREREGISTRATION_ALLOWED`

FAIL => `FEATURE_FOUNDATION_FAIL_RESEARCH_REDESIGN`

## Anti-overfitting

- protocol committed before feature results;
- no basis threshold relaxation from Basis Dislocation V1;
- no use of Basis Dislocation V1's untouched holdout as trading-PnL evidence;
- no predictor addition after results;
- no horizon change after results;
- no daily-anchor change after results;
- no model-family change after results;
- no asset removal;
- no holdout refit;
- no holdout quantile refit;
- no gate relaxation;
- any successor receives a new ruleset.

## Safety

Feature research only. No orders, no Paper bot, no live execution, no leverage, no liquidation model, no account mutation.
