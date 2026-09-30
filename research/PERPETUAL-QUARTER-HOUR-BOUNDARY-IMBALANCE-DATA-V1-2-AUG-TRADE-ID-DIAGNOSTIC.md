# Quarter-Hour Data V1.2 — August 2025 Trade-ID Order Diagnostic

Status: **PREDECLARED STRATEGY-NEUTRAL DIAGNOSTIC**  
Parent result: **Data V1.2 frozen FAIL**  
Execution impact: **false**  
Signal / returns / positions / PnL allowed: **false**

## Trigger

The exact-head Data V1.2 full run `36664484586` produced all 120 expected shard artifacts but failed the frozen strict-monotone trade-ID invariant in exactly three shards:

- ETHUSDT / 2025-08
- XRPUSDT / 2025-08
- ADAUSDT / 2025-08

The aggregate artifact `qh-individual-trades-data-v1-2` (artifact ID `11078467580`, digest `sha256:e5dc7ce9020eabd66a2754a94c04728543722cfc918a7baa6c38a2b82d08496d`) records the final decision:

`INDIVIDUAL_TRADES_DATA_V1_2_FAIL_DATA_QUALITY`

Data V1.2 is immutable and is not modified by this diagnostic.

## Questions frozen before running

For each failed August-2025 monthly individual-trades archive, determine:

1. Does the non-increasing event consist of an exact duplicate ID or a lower/reversed ID?
2. What are the immediately adjacent source rows, UTC timestamps and ID deltas?
3. Does source timestamp order also decrease at the same or other rows?
4. Which UTC dates contain the observed ID-order anomaly?
5. Does the official daily individual-trades archive for the affected date reproduce the same adjacent ID pair?

## Method

For the three known failed shards only:

- download the official Binance USD-M **monthly individual-trades** archive;
- verify its published SHA-256 CHECKSUM;
- stream the original row order without sorting or repair;
- count adjacent `current_trade_id <= previous_trade_id` events;
- classify each event as:
  - `DUPLICATE`, or
  - `REVERSAL`;
- record bounded row-neighborhood evidence for the first events;
- independently record timestamp decreases;
- derive the affected UTC dates;
- download and CHECKSUM-verify the corresponding official **daily individual-trades** archives;
- scan those daily archives with the same unchanged adjacency rule;
- compare the bounded monthly anomaly ID pairs with the daily anomaly ID pairs.

Raw archives are deleted after each scan. Only compact JSON evidence is retained.

## Predeclared diagnostic classification

Possible classifications are:

- `DAILY_PACKAGE_REPRODUCES_MONTHLY_ID_ORDER_ANOMALY`
- `MONTHLY_ONLY_ID_ORDER_ANOMALY`
- `DAILY_HAS_DIFFERENT_ID_ORDER_ANOMALY`
- `MONTHLY_ANOMALY_NOT_REPRODUCED`

These are source-diagnostic labels only. None constitutes a Data PASS.

## Interpretation boundaries

This diagnostic may establish whether the frozen V1.2 failure reflects:

- a repeated source-level anomaly present in both monthly and daily packages;
- a monthly-package ordering anomaly not present in the daily package;
- a different daily anomaly;
- or a failure that cannot be reproduced by the dedicated diagnostic.

It does **not** authorize changing the frozen V1.2 invariant.

Any successor protocol must be separately versioned and must define its ordering/canonicalization rule **before** successor canaries or strategy results are viewed.

## Explicitly forbidden

The diagnostic must not calculate or inspect:

- buyer/seller directional flow;
- signed imbalance;
- forward returns;
- signal-return relationship;
- asset ranking;
- positions or sizing;
- fees/funding strategy accounting;
- strategy PnL.

Paper and live authorization remain false.
