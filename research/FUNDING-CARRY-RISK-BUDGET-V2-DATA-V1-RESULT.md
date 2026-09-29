# Funding Carry Risk-Budget V2 Data Foundation V1 — Frozen Coverage Result

Workflow run: **36560534543**  
Artifact: **11028384301**  
Artifact ZIP SHA-256: `37d4cb974971da293b3e5d8ff20f1ed4deb2638a712074e75ae5231dcf7aa745`  
Coverage JSON SHA-256: `225355dc85831c1227f14443131d1d052fc09a1ae7ec0a1c9d61db50eaafff10`

This records the first untouched coverage audit of `FUNDING-CARRY-RISK-BUDGET-V2-DATA-V1-FROZEN`.

## Frozen decision

**FOUNDATION_PASS**

Official source:
- Binance Vision public USD-M monthly archives

Required monthly datasets:
- 4h perpetual klines
- fundingRate

Audit interval:
- 2021-01 through 2026-08

Transport errors:
- **0**

## Frozen universe result

All 8/8 assets satisfy the predeclared foundation breadth gate:

| Asset | CORE months through 2025-12 | First CORE month | First eligible month | Last CORE month |
|---|---:|---|---|---|
| TRX | 60 | 2021-01 | 2023-01 | 2026-08 |
| ETC | 60 | 2021-01 | 2023-01 | 2026-08 |
| XLM | 60 | 2021-01 | 2023-01 | 2026-08 |
| ATOM | 60 | 2021-01 | 2023-01 | 2026-08 |
| UNI | 60 | 2021-01 | 2023-01 | 2026-08 |
| AAVE | 60 | 2021-01 | 2023-01 | 2026-08 |
| FIL | 60 | 2021-01 | 2023-01 | 2026-08 |
| NEAR | 60 | 2021-01 | 2023-01 | 2026-08 |

Frozen acceptance requirements:
- all 8 assets recorded: **PASS**
- unexpected transport errors = 0: **PASS**
- >=6/8 with >=24 CORE_COMPLETE months through 2025-12: **8/8 PASS**
- >=6/8 objectively eligible by 2026-01: **8/8 PASS**
- official source URLs recorded for each availability decision: **PASS**
- synthetic/inferred archive availability: **none**

## Implication

The new eight-asset universe is broad enough to support a separately preregistered Cross-Sectional Funding Carry Risk-Budget V2 without reusing LTC/BCH/AVAX/HBAR as independent validation.

## Non-implication

This foundation contains **no strategy PnL** and does not authorize:
- Risk-Budget V2 execution;
- Paper shadow;
- live execution;
- leverage;
- account connectivity.

The next allowed step is a separately frozen V2 strategy protocol committed before any economic result is observed.
