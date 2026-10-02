# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.3

Status: **FROZEN STRATEGY-NEUTRAL DATA QUALITY PROTOCOL**  
Parent source foundation: **official Binance USD-M monthly individual-trades archives + published CHECKSUMs**  
Parent decisions: **Data V1 / V1.1 / V1.2 remain immutable failures**  
Execution impact: **false**  
Signal / forward returns / positions / PnL allowed: **false**

## Why V1.3 exists

Data V1.2 failed its frozen 120-shard gate because three August-2025 shards violated the assumptions that source trade IDs are strictly increasing/unique and that source row order is timestamp-nondecreasing:

- ETHUSDT / 2025-08
- XRPUSDT / 2025-08
- ADAUSDT / 2025-08

Follow-up diagnostics #356 and #357 were completed before this protocol was written.

### Established source facts

1. The same duplicate-ID anomalies occur in both official monthly and official daily individual-trades archives for 2025-08-29.
2. ETH reproduces the same source-row timestamp decreases in the daily package.
3. The repeated IDs are **not literal duplicate rows**.
4. Every known repeated ID maps to two distinct primary rows with different source timestamps and/or price/qty/isBuyerMaker fields.
5. Therefore source `tradeId` alone is not a globally unique event key for this corpus.
6. Dropping a second row merely because its `tradeId` repeats would delete a distinct observed source record.

V1.2 is not patched. V1.3 freezes a separately versioned source-record identity policy before new canaries.

## Fixed scope

Universe:
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Window:
- 2025-01 through 2026-08 inclusive;
- exactly 120 asset-month shards.

Each shard downloads and CHECKSUM-verifies:
- monthly individual `trades`;
- monthly 1m klines;
- monthly fundingRate.

## Source-record identity

V1.3 distinguishes **source-record identity** from exchange-provided trade-ID metadata.

Each record is identified deterministically by:

`archive SHA-256 + ZIP member name + 1-based data-row ordinal`

This key identifies the exact CHECKSUM-verified source record. It does **not** claim that the row is a globally unique matching-engine trade identifier.

Hard requirements:
- one ZIP member only;
- published archive CHECKSUM must match exactly;
- every non-empty data row receives exactly one monotonically increasing source-row ordinal;
- no source record is removed, deduplicated, merged or synthesized.

No sorting or deduplication is performed in the data-quality stage.

## Primary fields

Hard-validated per source row:
- `price`: finite and positive;
- `qty`: finite and positive;
- `time`: valid source timestamp, inside the target month, millisecond source unit;
- `isBuyerMaker`: strict Boolean schema validation;
- `tradeId`: parseable integer metadata.

### tradeId policy

`tradeId` is **not** a V1.3 record identity and is not a temporal-order gate.

The following are diagnostic only:
- adjacent equal IDs;
- adjacent decreasing IDs;
- numeric ID gaps;
- total non-increasing-ID events.

V1.3 never discards a record because an ID repeats.

### Source-row timestamp-order policy

Source row order is not required to be timestamp-nondecreasing.

Every row timestamp must:
- parse successfully;
- be in the target month;
- use the expected millisecond source unit.

Timestamp decreases in physical source-row order are counted and reported as diagnostics.

All temporal coverage calculations use each record's timestamp value directly, never source-row position.

## Temporal binning

Quarter-hour and first-10-second coverage are calculated from each source record's timestamp.

The source archive does not need to be physically sorted for a record to be assigned to its correct UTC time bin.

Hard gate:
- every UTC 15-minute bin in the target month must contain at least one valid source record.

Diagnostic only:
- empty first-10-second windows.

## quoteQty

`quoteQty` must parse as finite and non-negative, but remains non-authoritative.

V1.3 records mismatch counts/examples against `price * qty`. Derived `price * qty` is used only for strategy-neutral source diagnostics.

Raw quoteQty does not participate in the hard data-quality gate.

## 1m klines

Kline structure remains hard-validated:
- exact one-minute cadence;
- exact first/last minute;
- valid OHLC;
- non-negative volume/taker fields;
- millisecond timestamps.

Exact trade-count/base/quote reconciliation against individual trades remains diagnostic only because already-established official archive outages make klines unsuitable as a universal completeness oracle.

## Funding

Hard requirements:
- strictly increasing funding events;
- timestamps inside the target month;
- millisecond unit;
- no leading/trailing/inter-event gap above 12 hours.

## V1.3 hard shard gate

A shard PASS requires:
- trades, klines and funding CHECKSUM verification;
- exactly one ZIP member per downloaded archive;
- at least one valid individual-trades data row;
- valid source-record ordinal construction;
- valid tradeId integer schema;
- valid price/qty/quoteQty/isBuyerMaker schema;
- every individual-trade timestamp inside the target month;
- millisecond individual-trade timestamp unit;
- complete quarter-hour source-record coverage;
- complete structural 1m-kline cadence;
- complete funding coverage;
- all anti-leakage/execution flags false.

The following do **not** fail V1.3:
- repeated trade IDs;
- decreasing trade IDs;
- numeric trade-ID gaps;
- source-row timestamp decreases;
- raw quoteQty mismatches;
- exact kline trade-count/base/quote mismatches;
- empty first-10-second windows.

These remain explicit diagnostics and cannot be retrospectively promoted into thresholds after seeing results.

## Frozen canary plan

### Known anomaly fixtures

These are not independent evidence. They verify that V1.3 implements the already-established source semantics without deleting distinct source records:

- ETHUSDT / 2025-08
- XRPUSDT / 2025-08
- ADAUSDT / 2025-08

Expected behavior:
- shard may PASS despite duplicate IDs;
- ETH may PASS despite source-row timestamp decreases;
- all records remain counted by their own timestamps;
- no row may be discarded due to repeated ID.

### Independent parser/regression canaries

These were not used to design the V1.3 identity rule and are frozen here before V1.3 is run:

- BTCUSDT / 2026-07
- SOLUSDT / 2025-04
- DOGEUSDT / 2026-06

These canaries are parser/regression evidence only. Full-corpus authorization still requires all six canaries and invariant tests to pass unchanged.

## Full-run authorization rule

The 120-shard V1.3 run is forbidden until:
- invariant tests PASS;
- all three known-anomaly fixtures PASS;
- all three independent parser/regression canaries PASS;
- no protocol/gate code changes after those canary results;
- the exact canary head is independently reviewed;
- a documentation-only full-run authorization commit is added.

## Full-run PASS

PASS requires:
- exactly 120 unique expected shards;
- 120/120 shard PASS;
- zero missing/duplicate/unexpected shard artifacts;
- quarter-hour source-record coverage in every shard;
- expected millisecond timestamp semantics;
- complete 1m structural cadence;
- complete funding coverage;
- all execution/strategy flags false.

PASS decision:

`INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED`

FAIL decision:

`INDIVIDUAL_TRADES_DATA_V1_3_FAIL_DATA_QUALITY`

## Explicitly forbidden

Data V1.3 must not calculate or inspect:
- buyer-minus-seller flow;
- signed order imbalance;
- forward returns;
- signal-return relationships;
- asset rankings;
- position direction or sizing;
- turnover;
- fee/funding strategy PnL;
- strategy PnL.

`isBuyerMaker` remains schema-validated only.

## What PASS would authorize

Only a separately frozen strategy preregistration or restoration of an already frozen preregistration onto the validated V1.3 dependency.

It would **not** authorize Paper promotion or live execution.
