# MERIDIAN — Breakout Trend V1 evidence

Status: REJECTED / NO PAPER SHADOW / NO PARAMETER TUNING  
Evidence run: GitHub Actions 36264309309  
Artifact: 10913322168  
Artifact SHA256: `54035322f9688807fc00b2f4714aeceb9a53aeaafff4f1ff29e308bac8aff06e`

## Frozen primary result — 2022-09-06 to 2024-09-06

- 472 closed trades
- PF 1.29
- expectancy +0.135R
- net +63.524R
- win rate 34.1%
- max drawdown 24.469R

Chronological equal-calendar folds:
- Fold 1: n 118, PF 0.70, EXP -0.154R
- Fold 2: n 114, PF 1.04, EXP +0.021R
- Fold 3: n 112, PF 2.92, EXP +0.778R
- Fold 4: n 128, PF 0.87, EXP -0.061R

Side split:
- LONG: n 213, PF 1.85, EXP +0.383R
- SHORT: n 259, PF 0.85, EXP -0.070R

Primary asset breadth:
- BTC PF 1.72 / +0.355R
- ETH PF 0.65 / -0.203R
- SOL PF 2.16 / +0.385R
- XRP PF 0.49 / -0.247R
- ADA PF 1.27 / +0.131R
- AVAX PF 1.27 / +0.119R
- LINK PF 1.44 / +0.197R

Positive-net-R concentration stayed below the 40% cap; SOL was highest at 31.2%.

## Frozen secondary result — 2024-09-06 to 2026-09-06

- 542 closed trades
- PF 0.97
- expectancy -0.018R
- net -9.608R
- win rate 29.3%
- max drawdown 52.140R

## Gate decision

Passed:
- primary sample
- primary aggregate edge
- asset breadth
- concentration

Failed:
- primary drawdown
- chronological stability
- both-side robustness
- secondary edge
- secondary drawdown
- strict data-adequacy gate

The data-adequacy failure does not rescue the strategy: the observed performance already fails multiple independent economic/stability gates. XRP also lacks Coinbase coverage before its 2023 relisting, so a later data-source repair must not be used to reopen or tune this V1 decision.

**historicallyPromising = false**  
**paperShadowPermitted = false**

## Stopping rule

V1 is frozen as rejected. Do not:
- switch to LONG-only because the observed LONG cohort was stronger;
- remove ETH or XRP;
- change Donchian length, EMA lengths, ATR multiple, trailing length, cost model or evidence windows;
- select only the strong third fold.

Any successor must be a genuinely different, predeclared hypothesis.
