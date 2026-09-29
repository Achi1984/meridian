# AdaptiveTrend Sharpe Proxy V1 — Frozen Discovery Result

Workflow run: **36530251276**  
Artifact: **11016700963**  
Artifact ZIP SHA-256: `b4b7db863425c4d14badc4d7015445daa87a46e11a616bc6ba1fd7e64de5265b`  
Summary SHA-256: `62d41408f781c9d86b27efb93c7c43fe5ce7e91dc340fea8a5c8c0473fa937ce`  
Full evidence SHA-256: `a4f043792dcde1ccfca681153db6643628a56d36c1a68b51a1f61a9478882209`

This records the first untouched historical discovery result of `ADAPTIVE-TREND-SHARPE-PROXY-V1-FROZEN`.

## Frozen result

- Evaluation bars: 6,815
- Net compounded return: **-62.97%**
- Profit Factor: **0.971**
- Max drawdown: **82.50%**
- Annualized Sharpe: **-0.318**
- Stress return at 12 bps turnover cost: **-69.18%**
- Positive chronological windows: **1/5**
- Positive assets: **3/12**
- Positive-PnL concentration: **83.97%**
- Frozen gate: **FAIL**

## Gate failures

- `RETURN_NOT_POSITIVE`
- `PF_LT_1.2`
- `DD_GT_20PCT`
- `SHARPE_LT_1`
- `POSITIVE_WINDOWS_LT_4`
- `POSITIVE_ASSETS_LT_6`
- `POSITIVE_PNL_CONCENTRATION_GT_35PCT`
- `STRESS_RETURN_NOT_POSITIVE`

## Contribution diagnostics

- Long contribution: **-44.81%**
- Short contribution: **-15.83%**
- Long funding contribution: **-8.30%**
- Short funding contribution: **-0.48%**
- Total turnover: **459.34**
- Base modeled cost: **36.75%**
- Stress modeled cost: **55.12%**
- BTC buy-and-hold benchmark: **+66.47%**
- Frozen-universe equal-weight buy-and-hold benchmark: **-30.73%**

Positive asset contributions were concentrated in:
- DOGE: +40.01%
- LTC: +5.64%
- ADA: +1.99%

No losing asset is removed from the frozen result.

## Chronological diagnostics

The failure is not explained by modeled costs alone. Approximate annual compounded portfolio returns from the untouched run were:
- 2022: -24.01%
- 2023: -23.45%
- 2024: +11.53%
- 2025: -51.09%
- 2026 through August: +16.70%

The gross signal contribution was already negative in 2022, 2023 and 2025. Therefore lowering fees/slippage would not rescue the hypothesis without violating the preregistered anti-overfitting rules.

## Decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

No holdout is authorized. No threshold, universe, long/short side, cost assumption or date interval is changed after observing the result. This strategy remains research-only with `executionImpact=false`.
