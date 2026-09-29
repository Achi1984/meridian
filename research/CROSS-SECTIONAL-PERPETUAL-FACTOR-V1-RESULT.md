# Cross-Sectional Perpetual Factor V1 — Frozen Temporal Validation Result

Workflow run: **36558302684**  
Artifact: **11028421243**  
Artifact ZIP SHA-256: `e041d85e75cd071ac4abffe314ef6c16bd396cf7c8fcf1966f72bd61fe6bd669`  
Summary SHA-256: `11e6d785d6bfc1f9e2fdd436cbadd471b577b9aed90eab4969ba1cbd550d1384`  
Full evidence SHA-256: `bebbf621e1301c47aa30a1372a4443b2e3e496a6136ca4de06f4b6559eb24b63`  
Markdown SHA-256: `e16fcc63b6e18506dbbb79cf2594f5e757918a5cbbdf18da2ff396fd3e3485dd`

This records the first independent gating evaluation of `CROSS-SECTIONAL-PERPETUAL-FACTOR-V1-FROZEN`.

## Frozen temporal-validation window

- entry anchors: 2025-01-06 <= t < 2026-08-31
- final exit/rebalance mark: 2026-08-31
- assets: BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, SUI
- factors: MOMENTUM_12W, FUNDING_CARRY_7D, PREMIUM_REVERSION_7D
- source: official Binance Vision USD-M 4h perpetual, premium-index and funding archives

Data-integrity failure: **false**

## Result

- completed periods: **86**
- active combined weeks: **86**
- compounded net return: **-1.9775%**
- compounded price-only return: **-4.6386%**
- Profit Factor: **0.9778**
- annualized Sharpe: **-0.0624**
- max drawdown: **10.1410%**
- positive chronological windows: **2/5**
- 4x-cost stress return: **-17.7144%**
- positive-PnL assets: **6**
- positive-PnL concentration: **34.90%**
- long-side contribution: **negative**
- short-side contribution: **positive**

## Factor books

| Factor | Net return | Active weeks | PF |
|---|---:|---:|---:|
| MOMENTUM_12W | **-15.8165%** | 86 | 0.861 |
| FUNDING_CARRY_7D | **+23.9214%** | 86 | 1.351 |
| PREMIUM_REVERSION_7D | **-15.3698%** | 85 | 0.843 |

Funding Carry remained positive, while Momentum and Premium Reversion failed on the unseen period.

## Seen development evidence vs independent validation

The matched benchmark observed inside V3 on 2023-04 through 2024-12 produced:
- +34.0556% net return
- PF 1.4621
- Sharpe 0.835
- max DD 13.0427%
- 5/5 positive windows

Those development results do **not** replicate on the independent 2025-2026 temporal validation.

## Frozen gate reasons

- RETURN_NOT_POSITIVE
- PRICE_ONLY_NOT_POSITIVE
- PF_LT_1.05
- SHARPE_LT_0.5
- POSITIVE_WINDOWS_LT_3
- LONG_CONTRIBUTION_NOT_POSITIVE
- STRESS_RETURN_NOT_POSITIVE
- POSITIVE_FACTOR_BOOKS_LT_2

## Decision

**TEMPORAL_VALIDATION_FAIL_RESEARCH_REDESIGN**

No transfer-universe validation is authorized.

## Anti-overfitting decision

- no Momentum removal;
- no Premium-Reversion removal;
- no Funding-only rescue inside V1;
- no factor reweighting;
- no side-count change;
- no cost reduction;
- no universe reduction;
- no date movement;
- no transfer validation;
- no Paper/live promotion.

The positive Funding Carry book may motivate a **new separately frozen strategy**, but this already-observed temporal result may not be reused as independent validation for that successor.
