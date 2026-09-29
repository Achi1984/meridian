# Selective Static Cross-Venue Funding V4 — Frozen Independent Validation Result

Workflow run: **36581477138**  
Artifact: **11038904829**  
Artifact ZIP SHA-256: `7403b52f06dda0fad0c6af2c686df9234d4e5a5912ad090af532d997ec5d25e2`  
Summary prehash SHA-256: `d0bfb4b90a0b58591b771d784cc155fbaeaa8a3b3c51e4d70456cba2732b1eee`  
Full evidence SHA-256: `ef0f18bbfcc7fcad89ae8ea9f4537e276ee192df4128f4d3cbfb5ae9dfd6b028`  
Markdown SHA-256: `11c1df4e3d34f1a2bfaf5a9dcb04381cb42bc0dcea1f76ebeb2e5659aa69f7bb`

This records the first and only independent validation of `SELECTIVE-STATIC-CROSS-VENUE-FUNDING-V4-FROZEN`.

## Frozen validation scope

Warm-up:
- 2025-08

Trade months:
- 2025-09 through 2026-08

Universe:
- HBAR
- SUI
- NEAR
- FIL
- UNI
- AAVE
- ATOM
- ARB

Rule:
- LONG Binance / SHORT Hyperliquid only when prior-month Hyperliquid-minus-Binance realized funding spread >= 0.78%
- otherwise NO TRADE
- no reverse trades

## Result

- decision slots: **96**
- active cycles: **5**
- no-trade cycles: **90**
- data-integrity failure: **true**
- compounded net return: **+0.0744%**
- net PnL: **+$119.09**
- Profit Factor: **99.0**
- max drawdown: **0.0%**
- positive windows: **2/5**
- funding PnL: **+$264.06**
- basis PnL: **+$15.03**
- modeled base costs: **$160**
- funding/base-cost ratio: **1.6503**
- stress return: **+0.0119%**
- positive assets: **3/8**
- positive-PnL concentration: **44.18%**
- prior/current spread sign agreement: **100%**

## Data-integrity failure

One selected active cycle failed its frozen execution-data rule:

- asset: **NEAR**
- month: **2026-06**
- reason: `CURRENT_BINANCE_MARK_GAP`

The stage therefore fails closed exactly as preregistered.

## Asset attribution

| Asset | Active | Net PnL | Stress PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|
| HBAR | 2 | +$35.05 | -$4.95 | +$101.83 | -$2.78 |
| SUI | 0 | $0.00 | $0.00 | $0.00 | $0.00 |
| NEAR | 1 | -$3.32 | -$23.32 | +$24.30 | +$4.38 |
| FIL | 0 | $0.00 | $0.00 | $0.00 | $0.00 |
| UNI | 1 | +$54.08 | +$34.08 | +$71.18 | +$14.90 |
| AAVE | 0 | $0.00 | $0.00 | $0.00 | $0.00 |
| ATOM | 1 | +$33.27 | +$13.27 | +$66.75 | -$1.48 |
| ARB | 0 | $0.00 | $0.00 | $0.00 | $0.00 |

## Frozen gate result

**FAIL**

Reasons:
- `DATA_INTEGRITY_FAILURE`
- `ACTIVE_CYCLES_LT_32`
- `ACTIVE_ASSET_BREADTH_LT_6`
- `POSITIVE_WINDOWS_LT_3`
- `POSITIVE_ASSETS_LT_5`

## Decision

**VALIDATION_FAIL_RESEARCH_REDESIGN**

No prospective Paper shadow and no live promotion are authorized.

## Interpretation

The one-direction 0.78% cost-gated hypothesis remained net positive and stress positive on the independent holdout, but it almost never traded. Five active cycles across 96 decision slots are far below the preregistered activity and breadth requirements.

The positive result is therefore not sufficient evidence of a durable deployable strategy. The threshold cannot be reduced after seeing this holdout, and the data-integrity failure cannot be ignored.

## Anti-overfitting decision

- no threshold reduction;
- no threshold increase;
- no NEAR exception;
- no data-gap repair or synthetic mark;
- no asset removal;
- no addition of reverse trades;
- no validation-window extension;
- no cost reduction;
- no gate relaxation;
- no second V4 holdout;
- no Paper/live promotion.

Any successor must use a new ruleset and independent evidence.
