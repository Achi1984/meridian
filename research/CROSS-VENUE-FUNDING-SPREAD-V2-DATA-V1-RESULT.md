# Cross-Venue Funding Spread V2 Data Foundation V1 — Frozen Result

Workflow run: **36562578899**  
Artifact: **11030268354**  
Artifact ZIP SHA-256: `b472eb1255c2c6a2a14a90950dfa009b46fd3aaf22ce6bb9e2846f20a142192e`  
Coverage JSON SHA-256: `5a0a1d77fdc587b9015e44145048450a8dc7203ea1ab651e82f642543e3f966b`

This records the first untouched coverage result of `CROSS-VENUE-FUNDING-SPREAD-V2-DATA-V1-FROZEN`.

## Frozen decision

**FOUNDATION_PASS**

Interval:
- 2024-09-01 through 2026-09-01
- 24 completed months

Sources:
- Binance Vision USD-M monthly markPriceKlines 8h + fundingRate
- Hyperliquid public meta, candleSnapshot 8h and fundingHistory

Unexpected transport errors: **0**

## Qualified assets

**7 / 8**

| Asset | Binance months | Hyperliquid listed | 8h candles | Early funding | Late funding | Qualified |
|---|---:|---|---:|---:|---:|---|
| BNB | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| ADA | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| DOT | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| LTC | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| BCH | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| TRX | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| ETC | 24/24 | yes | 2,191 | 720 | 744 | PASS |
| XLM | 24/24 | yes | 2,191 | **0** | 744 | FAIL |

## XLM failure

XLM is present in Hyperliquid metadata and has valid 8h candle coverage, but the frozen early funding anchor for September 2024 returned no qualifying funding history.

XLM therefore fails `CROSS_VENUE_DATA_QUALIFIED`.

It is not replaced by another asset.

## Implication

The objective data-qualified V2 strategy universe is:

- BNB
- ADA
- DOT
- LTC
- BCH
- TRX
- ETC

This subset is determined exclusively by the preregistered public-data gate, before any V2 strategy PnL.

## Non-implication

No strategy PnL was calculated.

This foundation does not authorize:
- Cross-Venue V2 execution;
- Paper shadow;
- live execution;
- leverage;
- account connectivity.

The next allowed step is a separately frozen V2 strategy protocol committed before any economic result.
