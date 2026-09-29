# Perpetual Factor Data Foundation V1 — Frozen Coverage Result

Workflow run: **36548535155**  
Artifact: **11023567737**  
Artifact ZIP SHA-256: `e5efb09d7a17f056b3305d9c345feeb1bc75427aeda6d593af6757a3082d93c8`  
Coverage JSON SHA-256: `cb9895098713794e7e95f2fe82758c3406734a7b9f8e2ae428c7970f9f13db50`

This records the first untouched coverage audit of `PERPETUAL-FACTOR-DATA-V1`.

## Frozen decision

**FOUNDATION_PASS**

Official source:
- Binance Vision public USD-M monthly archives

Required monthly datasets:
- 4h perpetual klines
- 4h premium-index klines
- funding-rate archives

Audit interval:
- 2021-01 through 2026-08

Transport errors:
- **0**

Frozen breadth requirement:
- BTC and ETH >=24 CORE_COMPLETE months
- >=8 of 14 fixed assets >=24 CORE_COMPLETE months through 2025-12

Observed:
- **14 / 14 assets qualify through 2025-12**

## Objective factor-eligibility start

Eligibility requires:
- >=24 completed CORE_COMPLETE months before decision time;
- most recent 12 completed months CORE_COMPLETE;
- no synthetic backfill.

| Asset | CORE months | Through 2025-12 | First CORE month | First eligible month |
|---|---:|---:|---|---|
| BTC | 68 | 60 | 2021-01 | 2023-01 |
| ETH | 68 | 60 | 2021-01 | 2023-01 |
| BNB | 68 | 60 | 2021-01 | 2023-01 |
| SOL | 68 | 60 | 2021-01 | 2023-01 |
| XRP | 68 | 60 | 2021-01 | 2023-01 |
| ADA | 68 | 60 | 2021-01 | 2023-01 |
| DOGE | 68 | 60 | 2021-01 | 2023-01 |
| LINK | 68 | 60 | 2021-01 | 2023-01 |
| DOT | 68 | 60 | 2021-01 | 2023-01 |
| LTC | 68 | 60 | 2021-01 | 2023-01 |
| BCH | 68 | 60 | 2021-01 | 2023-01 |
| AVAX | 68 | 60 | 2021-01 | 2023-01 |
| HBAR | 66 | 58 | 2021-03 | 2023-03 |
| SUI | 40 | 32 | 2023-05 | 2025-05 |

## Implication

The public-data foundation is broad enough to support a separately frozen Self-History Perpetual Factor V1 without:
- historical market-cap weighting;
- synthetic pre-listing history;
- private API credentials;
- post-result universe selection.

SUI joins later under the exact same predeclared eligibility rule instead of being backfilled.

## Non-implication

This is a data-foundation pass only.

It does **not** show that any factor is profitable and does not authorize:
- strategy promotion;
- Paper shadow;
- live execution;
- leverage;
- account connectivity.

The next allowed step is a separately frozen factor protocol committed before any strategy result is observed.
