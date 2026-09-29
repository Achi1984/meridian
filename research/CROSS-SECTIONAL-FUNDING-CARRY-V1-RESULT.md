# Cross-Sectional Funding Carry V1 — Frozen Transfer Validation Result

Workflow run: **36559488773**  
Artifact: **11028283118**  
Artifact ZIP SHA-256: `ecc088c4374684105ab727d755a201514120ee9f64dcdc95101af90f90388e4f`  
Summary SHA-256: `0ea4176cbd67157404daf1bccf71b8cc400c7be5f945ef1e627852b67725432d`  
Full evidence SHA-256: `b13415780cbad2618cdd4b969d9ab126e01ef4c79119efd2fcf5676aeaac0a6a`  
Markdown SHA-256: `dd0a0bf7a21b0490f4e2303c9adc1684ff63bb2f379a3590b19f7b3c808eca78`

This records the first independent transfer-universe evaluation of `CROSS-SECTIONAL-FUNDING-CARRY-V1-FROZEN`.

## Frozen transfer universe

- LTC
- BCH
- AVAX
- HBAR

Window:
- entry anchors: 2023-04-03 <= t < 2026-08-31
- final exit: 2026-08-31

Source:
- official Binance Vision USD-M 4h perpetual klines
- official Binance Vision funding-rate archives

Data-integrity failure: **false**

## Economic result

- completed periods: **178**
- active weeks: **178**
- compounded net return: **+158.2032%**
- compounded price-only return: **+117.7803%**
- cumulative funding contribution: **+16.9481%**
- modeled base-cost contribution: **-12.6400%**
- Profit Factor: **1.4539**
- annualized Sharpe: **0.8580**
- max drawdown: **48.8631%**
- positive chronological windows: **4/5**
- 32 bps stress return: **+76.6383%**
- positive-PnL assets: **3/4**
- positive-PnL concentration: **61.34%**
- flat-by-missing-input weeks: **0**

## Asset attribution

| Asset | Attribution |
|---|---:|
| LTC | +18.67% |
| BCH | **+92.54%** |
| AVAX | **-24.11%** |
| HBAR | +39.65% |

## Frozen gate result

**FAIL**

Reasons:
- `DD_GT_25.0`
- `POSITIVE_CONCENTRATION_GT_50.0`

All other frozen gates passed.

## Stress result

At 32 bps per unit turnover:
- net return: **+76.6383%**
- price-only return: **+48.9355%**
- PF: **1.3008**
- Sharpe: **0.6000**
- max drawdown: **49.4051%**
- positive windows: **3/5**

The strategy remains economically positive under high costs, but risk and concentration remain unacceptable under the frozen gate.

## Decision

**TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN**

No prospective Paper shadow is authorized.

## Interpretation

This is a strong economic result but not a valid promotion result.

The failure is not due to:
- sample size;
- activity;
- transaction-cost stress;
- price-only profitability;
- funding contribution;
- Profit Factor;
- Sharpe;
- breadth of positive assets.

It is specifically caused by:
1. excessive max drawdown;
2. excessive dependence on BCH contribution.

## Anti-overfitting decision

- no DD-limit increase;
- no concentration-limit increase;
- no BCH exclusion;
- no AVAX exclusion;
- no cost reduction;
- no date movement;
- no side-count change;
- no leverage reduction inside V1 after result;
- no Paper/live promotion.

A successor may use a **new preregistered risk-budget/diversification design**, but it must be validated on a new, previously unused asset universe or other genuinely independent dataset.
