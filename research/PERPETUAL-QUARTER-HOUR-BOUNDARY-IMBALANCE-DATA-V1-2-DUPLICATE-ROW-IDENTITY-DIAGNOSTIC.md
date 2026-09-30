# Quarter-Hour Data V1.2 — Duplicate Trade-ID Row Identity Diagnostic

Status: **PREDECLARED STRATEGY-NEUTRAL SOURCE DIAGNOSTIC**  
Parent result: **Data V1.2 frozen FAIL**  
Execution impact: **false**  
Signal / returns / positions / PnL allowed: **false**

## Trigger

The completed August-2025 ID-order diagnostic proved that the official Binance USD-M individual-trades source itself reuses trade IDs on 2025-08-29:

- ETHUSDT: `6299136398`, `6299136399`, `6299136400`
- XRPUSDT: `2634782464`
- ADAUSDT: `1691866636`

The same duplicate-ID pattern appears in both monthly and official daily archives. ETH additionally reproduces two source timestamp decreases.

This invalidates the assumption that the source trade ID is globally unique and strictly monotone for every row, but it does **not** yet establish whether the repeated IDs represent literal duplicate rows or distinct trades that share an ID.

## Frozen question

For each known repeated trade ID, determine whether the official daily archive contains:

1. literal duplicate rows;
2. distinct primary rows that share the same ID;
3. rows that differ only in non-authoritative raw quoteQty;
4. or insufficient occurrences.

The diagnostic is limited to the already identified IDs and date. It does not scan for new strategy outcomes and does not select a successor protocol.

## Source

Official Binance Vision USD-M daily individual-trades archives for **2025-08-29**, with published SHA-256 CHECKSUM verification.

## Identity definitions

The diagnostic records two fingerprints.

**Full source row fingerprint**
- trade ID
- price
- qty
- raw quoteQty
- source timestamp
- isBuyerMaker

**Primary event fingerprint**
- trade ID
- price
- qty
- source timestamp
- isBuyerMaker

Raw quoteQty remains non-authoritative per the frozen V1.2 findings.

## Predeclared per-ID classifications

- `LITERAL_DUPLICATE_ROW`
- `DISTINCT_PRIMARY_ROWS_SHARE_ID`
- `RAW_ROW_DIFFERS_PRIMARY_IDENTITY_SAME`
- `INSUFFICIENT_OCCURRENCES`

Asset-level classifications:

- `SOURCE_ID_REUSE_WITH_DISTINCT_PRIMARY_ROWS`
- `SOURCE_LITERAL_DUPLICATE_ROWS`
- `SOURCE_IDENTITY_MIXED`
- `SOURCE_IDENTITY_INCOMPLETE`

## Interpretation boundary

A finding of distinct primary rows sharing an ID would prove only that trade ID alone cannot be used as the unique event key.

A finding of literal duplicate rows would prove only that exact duplicate suppression must be considered in a separately versioned successor protocol.

Neither finding authorizes sorting, deduplication, a new event key, or any V1.3 rule by itself. A successor rule must be frozen in a separate version before successor canaries.

## Explicitly forbidden

This diagnostic must not calculate:
- directional order imbalance;
- signed flow;
- forward returns;
- signal-return relationships;
- positions;
- sizing;
- turnover;
- strategy fees/funding;
- strategy PnL.

Paper and live authorization remain false.
