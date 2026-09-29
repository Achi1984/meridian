# Spot-Perp Basis-Volatility Regime V1 — Frozen Feature Protocol

Status: **FEATURE FOUNDATION — NO STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `SPOT-PERP-BASIS-DISLOCATION-V1-FROZEN` — immutable zero-trade discovery failure
- `SPOT-PERP-BASIS-DISLOCATION-V1-DATA-V1-FROZEN` — synchronized 8/8 data foundation

## Objective

Test one feature hypothesis before designing any new trading strategy:

> The absolute Spot-vs-Perpetual log basis observed before a daily anchor contains positive information about the next 24 hours of realized USD-M Perpetual volatility, beyond information already contained in the previous 24 hours of realized volatility.

This is motivated by 2026 perpetual-basis research reporting predictive information for forward realized volatility.

This protocol does **not** test trade direction, entry profitability, breakout returns, mean reversion, leverage, liquidation or Paper performance.

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

No asset substitution.

## Data

Binance Vision public archives only:
- Spot 8h trade klines
- USD-M Perpetual 8h trade klines

Funding is not used in this feature test.

Only exact synchronized Spot/Perp 8h timestamps are permitted.

No interpolation, nearest-neighbor matching or synthetic rows.

## Frozen time split

### Warm-up
- 2024-06-01 through 2024-08-31
- used only for lagged-volatility inputs

### Feature discovery
Daily anchors:
- 2024-09-01 00:00 UTC through 2025-08-30 00:00 UTC inclusive

No observation may use price information timestamped after 2025-08-31 00:00 UTC.

### Temporal feature holdout
Authorized only after Feature Discovery PASS:
- daily anchors 2025-09-01 00:00 UTC through 2026-08-30 00:00 UTC inclusive
- unchanged definitions and gates
- no retuning

A holdout PASS authorizes only a separately frozen trading-strategy protocol.

## Daily anchor construction

For each daily anchor `t` at 00:00 UTC:

### Last known synchronized price
Use the synchronized Spot and Perp 8h bar whose open time is exactly `t - 8h`.

Its close is known immediately before `t`.

Define:
- `S_t` = Spot close from that completed bar
- `P_t` = Perp close from that completed bar

### Basis feature
`log_basis_t = ln(P_t / S_t)`

Frozen feature:
`abs_log_basis_t = abs(log_basis_t)`

No sign-based direction inference is allowed.

## Lagged 24h realized volatility control

Use four Perp closes known by anchor `t`:
- close at t-24h
- close at t-16h
- close at t-8h
- close immediately before t

Compute three log returns.

Frozen lagged realized-volatility proxy:
`lag_rv24_t = sqrt(r1^2 + r2^2 + r3^2)`

No annualization is required for correlation tests.

## Forward 24h realized volatility outcome

Use the Perp close immediately before t and the next three completed 8h Perp closes ending by t+24h.

Compute three future log returns.

Frozen outcome:
`fwd_rv24_t = sqrt(fr1^2 + fr2^2 + fr3^2)`

Future data are used only as the measured outcome and never as a feature.

## Observation integrity

An asset/day observation is valid only if:
- exact synchronized Spot/Perp signal bar exists;
- all four lagged Perp closes exist on exact 8h cadence;
- all three forward Perp closes exist on exact 8h cadence;
- all required prices are finite and >0;
- no duplicate timestamp exists.

Invalid observation:
- rejected from all feature metrics;
- never reconstructed;
- recorded as a data-integrity error. Any missing expected daily anchor therefore sets the stage-level data-integrity flag and fails the gate.

## Per-asset ranks

Within each stage and each asset independently:

- rank `abs_log_basis` from lowest to highest;
- rank `fwd_rv24` from lowest to highest;
- rank `lag_rv24` from lowest to highest;
- average ranks are used for ties;
- normalized rank percentile = `(average_rank - 1) / (n - 1)` for n>1.

Top basis quartile is frozen as the highest `ceil(0.25 × n)` observations per asset, ordered by `abs_log_basis`; ties at the cutoff are broken only by timestamp ascending so the selected count is deterministic.

This prevents high-volatility assets from dominating the pooled relationship solely because of scale.

## Metrics

### Per asset
Report:
- valid daily observations
- Spearman correlation: abs basis vs forward RV
- Spearman correlation: lagged RV vs forward RV
- partial Spearman correlation between abs basis and forward RV controlling lagged RV
- mean forward RV in top basis quartile
- mean forward RV outside top basis quartile
- top-quartile uplift ratio
- median abs basis
- median forward RV

### Pooled within-asset-rank metrics
Concatenate each asset's normalized/ranked observations after ranking within asset.

Report:
- pooled Spearman(abs basis, forward RV)
- pooled partial Spearman controlling lagged RV
- pooled top-quartile forward-RV uplift ratio

### Stability
Split chronological daily anchors into five contiguous windows.

For each window, recompute ranks independently within each asset using only observations in that window, then calculate pooled within-asset Spearman(abs basis, forward RV).

Report number of positive windows.

## Frozen Discovery gate

All must pass:

- all 8 frozen assets represented
- >=340 valid daily observations per asset
- zero data-integrity failure at the stage level
- pooled Spearman(abs basis, forward RV) >= **0.10**
- pooled partial Spearman controlling lagged RV >= **0.05**
- pooled top-quartile forward-RV uplift ratio >= **1.10**
- >=6 of 8 assets have positive Spearman(abs basis, forward RV)
- >=5 of 8 assets have positive partial Spearman controlling lagged RV
- >=6 of 8 assets have top-quartile uplift ratio >1.00
- >=4 of 5 chronological windows have positive pooled Spearman

PASS => `FEATURE_DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`

FAIL => `FEATURE_DISCOVERY_FAIL_RESEARCH_REDESIGN`

No trading-strategy design is authorized by Discovery alone.

## Frozen temporal holdout gate

If and only if Feature Discovery passes, run the untouched temporal feature holdout unchanged.

All must pass:

- all 8 assets represented
- >=340 valid daily observations per asset
- zero data-integrity failure
- pooled Spearman(abs basis, forward RV) >= **0.05**
- pooled partial Spearman controlling lagged RV > **0**
- pooled top-quartile forward-RV uplift ratio >= **1.05**
- >=5 of 8 assets have positive Spearman
- >=5 of 8 assets have positive partial Spearman
- >=5 of 8 assets have top-quartile uplift ratio >1.00
- >=3 of 5 chronological windows have positive pooled Spearman

PASS => `FEATURE_HOLDOUT_PASS_STRATEGY_PREREGISTRATION_ONLY`

FAIL => `FEATURE_HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even Feature Holdout PASS does not authorize Paper or live execution.

## Anti-overfitting

- feature protocol committed before first feature result;
- absolute log basis definition fixed;
- 24h lagged-RV control fixed;
- 24h forward-RV outcome fixed;
- daily 00:00 UTC anchors fixed;
- rank transformation fixed;
- discovery and holdout dates fixed;
- 0.10 / 0.05 Discovery correlation gates fixed;
- 1.10 Discovery uplift gate fixed;
- no alternative horizon after results;
- no signed-basis rescue;
- no asset removal;
- no trading PnL in this stage;
- no directional strategy until temporal feature holdout passes;
- any redesign receives a new ruleset.

## Safety

Feature research only. No orders, credentials, leverage, liquidation model, wallet state or exchange mutation.
