# BTCUSDT 2025-01 monthly/daily source-consistency diagnostic V1

Status: **DIAGNOSTIC ONLY — NO DATA GATE AUTHORIZATION**  
Execution impact: **false**

## Trigger

Frozen individual-trades Data V1.1 failed both canaries on sparse malformed `quoteQty` rows. The independent full-month quote-semantics diagnostic then found a second issue specifically in BTCUSDT/2025-01: monthly individual trades did not reconcile with the official monthly 1m kline trade count, base volume or derived quote volume.

SOLUSDT/2025-07 did reconcile exactly once economic quote notional was derived from `price * qty`; therefore the BTC discrepancy must be isolated separately rather than hidden by a tolerance change.

## Frozen diagnostic

This diagnostic compares, by UTC day:

1. official monthly BTCUSDT individual trades;
2. official monthly BTCUSDT 1m klines;
3. all 31 official daily BTCUSDT 1m kline archives.

All downloaded objects are verified against their published SHA-256 CHECKSUMs.

The monthly trade archive is scanned once. Direction is not used. Economic quote notional is derived as `price * qty` only for source reconciliation. Sparse malformed raw `quoteQty` rows are counted but do not authorize normalization or repair.

## Classification

Each day is classified as one of:
- all sources reconcile;
- daily kline matches monthly trades while monthly kline differs;
- monthly and daily klines agree while monthly trades differ;
- three-way divergence;
- missing/other divergence.

No classification itself authorizes a successor Data gate. If monthly and daily klines agree while monthly trades differ, a later separately frozen diagnostic may compare only the affected **daily trades** archives against the monthly trade archive. If daily klines match trades and monthly klines differ, the monthly kline archive is not a suitable completeness reference for that day.

No signal, return, position, PnL, Paper promotion or live action may be calculated or authorized.
