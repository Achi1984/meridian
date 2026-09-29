# Cross-Venue Funding Spread V2 — Frozen Validation Result

Workflow run: **36563826168**  
Artifact: **11031542226**  
Artifact ZIP SHA-256: `b3e25b5fc0a185a0fc128d7de1a2a7b30c839d224bcba014b90a0e41ec0ecd04`  
Summary SHA-256: `e4589713cfe92f5ceb7e8231175c2f6685c3e341f5f8c063ad7d64c73eb0751c`  
Full evidence SHA-256: `369fad81be9e8f0a7027ec9b86914dbd348eb0c9d1b50fe0e4afb98a12c58791`  
Markdown SHA-256: `1b11500d63fa9b81198e082c77259aa9f490e7cf0f93a34f1b6677b1eece525c`

This records the first independent validation of `CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN`.

## Frozen universe and window

Assets:
- BNB
- ADA
- DOT
- LTC
- BCH
- TRX
- ETC

Validation interval:
- 2024-09-01 through 2026-09-01
- 23 valid monthly cycles per asset
- 161 valid asset-month cycles total
- 14 rejected cycles
- no synthetic reconstruction

Direction remained frozen:
- LONG Binance USD-M perpetual
- SHORT Hyperliquid perpetual

## Result

- compounded net return: **-0.2409%**
- net PnL: **-$331.81**
- Profit Factor: **0.8659**
- max closed-equity drawdown: **1.0597%**
- funding PnL: **+$4,793.44**
- cross-venue basis PnL: **+$26.75**
- modeled base costs: **$5,152.00**
- stress return (+5 bps/fill): **-2.5105%**
- positive chronological windows: **2/5**
- positive-PnL concentration: **34.07%**

## Asset attribution

| Asset | Net PnL | Stress PnL | Funding PnL | Basis PnL | Costs |
|---|---:|---:|---:|---:|---:|
| BNB | +$306.66 | -$153.34 | +$1,045.45 | -$2.78 | $736 |
| ADA | **-$954.53** | -$1,414.53 | -$219.89 | +$1.37 | $736 |
| DOT | **-$378.84** | -$838.84 | +$420.57 | -$63.41 | $736 |
| LTC | +$539.26 | +$79.26 | +$1,226.54 | +$48.72 | $736 |
| BCH | +$329.37 | -$130.63 | +$1,087.59 | -$22.22 | $736 |
| TRX | +$407.32 | -$52.68 | +$1,122.75 | +$20.57 | $736 |
| ETC | **-$581.07** | -$1,041.07 | +$110.42 | +$44.51 | $736 |

## Frozen gate reasons

- `RETURN_NOT_POSITIVE`
- `PF_LT_1.15`
- `POSITIVE_WINDOWS_LT_4`
- `ADA_PNL_NOT_POSITIVE`
- `DOT_PNL_NOT_POSITIVE`
- `ETC_PNL_NOT_POSITIVE`
- `STRESS_RETURN_NOT_POSITIVE`

## Decision

**VALIDATION_FAIL_RESEARCH_REDESIGN**

No Paper shadow and no live promotion are authorized.

## Interpretation

The cross-venue market structure still generated positive gross funding cash flow and very low drawdown, but the fixed venue direction was not robust across assets. Total modeled costs exceeded aggregate funding plus basis gains.

The failure is therefore not a drawdown or basis-explosion problem. It is an edge-direction/cost-efficiency problem.

## Anti-overfitting decision

- no ADA/DOT/ETC exclusion after result;
- no fee/slippage reduction;
- no direction flip inside V2;
- no asset substitution;
- no validation-window movement;
- no gate relaxation;
- no Paper/live promotion.

Any successor must use a separately frozen adaptive-direction or no-trade market-structure hypothesis with independent data qualification before any PnL.
