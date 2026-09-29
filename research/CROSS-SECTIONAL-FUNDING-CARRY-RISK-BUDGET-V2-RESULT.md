# Cross-Sectional Funding Carry Risk-Budget V2 — Frozen Validation Result

Workflow run: **36561547509**  
Artifact: **11030006643**  
Artifact ZIP SHA-256: `14c51128df0036a6dc564d49f60ca043b93b6f8c4649c866aa8ab42cd8f10440`  
Summary SHA-256: `67f3979f28008685550961344e76f18f27159af8419781812a82960ffebde19d`  
Full evidence SHA-256: `fa6406fde324d43f698679b6095bb9376c311225eeefd008967e1b385c01b486`  
Markdown SHA-256: `02497e32f10e2f3e231f44a319580b4d722cd8a2bf404a2f7d6721cfb71305c6`

This records the first independent validation of `CROSS-SECTIONAL-FUNDING-CARRY-RISK-BUDGET-V2-FROZEN`.

## Frozen independent universe

- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR

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
- compounded net return: **-9.4489%**
- compounded price-only return: **-21.9417%**
- cumulative funding contribution: **+14.7898%**
- modeled base-cost contribution: **-10.2624%**
- Profit Factor: **1.0075**
- annualized Sharpe: **0.0187**
- max drawdown: **48.1907%**
- positive chronological windows: **2/5**
- 32 bps stress return: **-33.4966%**
- positive-PnL assets: **5/8**
- positive-PnL concentration: **49.39%**
- mean gross exposure: **0.7906**
- median gross exposure: **0.8073**
- mean risk scale: **0.7906**
- mean selected-asset annualized vol: **77.40%**
- mean pre-scale portfolio annualized vol: **26.38%**

## Side economics

- long-side gross contribution: **positive**
- short-side gross contribution: **negative**

The positive funding cash flow did not overcome adverse price selection and turnover costs.

## Asset attribution

| Asset | Attribution |
|---|---:|
| TRX | +21.11% |
| ETC | -2.54% |
| XLM | **+45.79%** |
| ATOM | +2.52% |
| UNI | +12.56% |
| AAVE | +10.74% |
| FIL | -23.97% |
| NEAR | **-64.51%** |

## Frozen gate result

**FAIL**

Reasons:
- `RETURN_NOT_POSITIVE`
- `PRICE_ONLY_NOT_POSITIVE`
- `PF_LT_1.05`
- `SHARPE_LT_0.5`
- `DD_GT_25.0`
- `POSITIVE_WINDOWS_LT_3`
- `SHORT_CONTRIBUTION_NOT_POSITIVE`
- `POSITIVE_CONCENTRATION_GT_35.0`
- `STRESS_RETURN_NOT_POSITIVE`

The deployment gate itself passed:
- mean gross exposure >= 0.35

## Decision

**VALIDATION_FAIL_RESEARCH_REDESIGN**

No prospective Paper shadow is authorized.

## Interpretation

The V2 redesign did not solve the V1 risk problem on a genuinely new asset universe.

Top-2/bottom-2 diversification, inverse-vol side weighting and a 20% ex-ante volatility downscaler reduced gross exposure on average but did not produce a stable edge. Max drawdown remained near 48%, concentration remained high, and the short side lost money.

This is evidence against further tuning of the same single-venue Cross-Sectional Funding Carry family.

## Anti-overfitting decision

- no volatility-target change;
- no weight-bound change;
- no NEAR exclusion;
- no XLM cap after result;
- no long-only rescue inside V2;
- no factor-direction flip;
- no cost reduction;
- no date movement;
- no gate relaxation;
- no Paper/live promotion.

Any successor must be a genuinely different strategy family or use an independently motivated market structure.
