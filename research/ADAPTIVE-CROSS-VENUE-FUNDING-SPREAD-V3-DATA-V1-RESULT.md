# Adaptive Cross-Venue Funding Spread V3 Data Foundation V1 — Frozen Result

Workflow run: **36574653311**  
Artifact: **11038236184**  
Artifact ZIP SHA-256: `08b745d2c2be33c7a0e673dbda95184f1101f7ec32787cf4b59a742211be9504`  
Evidence JSON SHA-256: `5c6ffde13959b0be55c5297e7303e836b62030f5c00d209d773fd29be68c989f`

This records the first untouched coverage result of `ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-DATA-V1-FROZEN`.

## Frozen interval

- 2024-09-01 00:00 UTC through 2026-09-01 00:00 UTC
- 24 completed calendar months
- no strategy PnL
- no trade-direction inference
- no synthetic reconstruction

## Foundation result

**FOUNDATION_PASS**

Qualified: **8 / 8**

| Asset | Binance core months | Hyperliquid 8h candles | Hyperliquid funding observations | Max funding gap | Qualified |
|---|---:|---:|---:|---:|---|
| HBAR | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| SUI | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| NEAR | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| FIL | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| UNI | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| AAVE | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| ATOM | 24/24 | 2,191 | 17,520 | 1.247h | PASS |
| ARB | 24/24 | 2,191 | 17,520 | 1.247h | PASS |

Unexpected transport errors: **0**

## Decision

The preregistered breadth gate required at least 5/8 candidates. All eight passed.

A separately frozen Adaptive Cross-Venue Funding Spread V3 strategy protocol is therefore authorized.

This result does **not** authorize:
- any V3 PnL yet;
- any threshold chosen from these assets' outcomes;
- any Paper shadow;
- any live execution.

The future V3 strategy must freeze its pre-trade direction/no-trade signal, costs and promotion gates before first PnL.
