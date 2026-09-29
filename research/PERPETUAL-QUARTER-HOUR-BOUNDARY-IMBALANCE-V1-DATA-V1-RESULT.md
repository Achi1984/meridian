# Quarter-Hour Boundary Imbalance V1 — Frozen Data V1 Result

Status: **FAIL — SOURCE QUALITY / NEW SOURCE PROTOCOL REQUIRED**  
Execution impact: **false**  
Signal observed: **false**  
Forward return observed: **false**  
Strategy PnL observed: **false**

## Full run

- protocol/full-run head: `78e8975b061b926733d66734ab409dcf56e11bfe`
- workflow run: **36613725640**
- expected shards: **120**
- observed shard manifests: **120**
- shard PASS: **119**
- shard FAIL: **1**
- aggregate artifact: **11055862490**
- aggregate ZIP SHA-256: `fbccf3ddf2b2f5057ed050e9802d94a51cc4a17a4ca4e0864923f436ab285787`

Aggregate decision:

`FOUNDATION_DATA_V1_FAIL_DATA_QUALITY`

The sole failed shard is:

**SOLUSDT / 2025-07**

## Root cause

The frozen V1 shard parser required aggregate-trade IDs to be strictly increasing.

The official Binance USD-M monthly archive passed its published checksum but contains one adjacent repeated aggregate-trade ID:

`926014272`

The V1 parser therefore correctly failed closed with:

`RuntimeError: aggTrades aggregate trade id not strictly increasing`

Failed-shard artifact:
- ID: **11055671455**
- digest: `sha256:b0ec38b4b84e10514d51cb9031e116712cf8422a78058e42c3c9265734d2497d`

## Source-provenance diagnosis

A separate read-only diagnostic was run without changing V1.

- diagnostic workflow: **36618234245**
- artifact: **11057041369**
- digest: `sha256:b55447bb9e953940863b00e59f9c2d740809c437ac4c3eeeb2ff672846b5e874`

### Monthly archive

Official archive SHA-256:

`07842c476aab159f008ffc4e95e421e181f75348610c23baeae1dc3799d4e89b`

Rows: **14,070,960**

Observed:
- duplicate aggregate IDs: **1**
- decreasing aggregate IDs: **0**
- timestamp decreases: **0**
- exact adjacent duplicate rows: **0**

The two rows sharing aggregate ID `926014272` are different records, 203 ms apart.

### Official daily aggTrades archive

The official Binance daily archive for **2025-07-16** contains the **same two records with the same repeated aggregate ID**.

Therefore the anomaly is not introduced by the monthly packaging process.

### Official individual trades archive

The corresponding official USD-M individual-trades archive contains a continuous individual trade-ID sequence around the event, including:

`2468302184 ... 2468302195`

including trade ID:

`2468302189`

The aggregate source's first repeated-ID row references trade 2188; the second references trade 2190. The individual trade 2189 exists in the canonical trades archive but is not represented by those aggregate metadata intervals.

Conclusion:

**This is a source-level aggTrades aggregation/metadata anomaly, not a runner timeout, checksum failure, monthly-archive corruption, or timestamp-order failure.**

## Why V1 is not patched in place

The Data V1 rules were frozen before the full quality run.

After observing the failed shard, MERIDIAN will not silently relax:
- strict aggregate-ID monotonicity;
- source choice;
- or the aggregate gate.

V1 remains an immutable failed data-quality protocol.

## Successor source direction

The next source foundation must be separately versioned.

Preferred candidate:

**official Binance USD-M individual `trades` archives**

Reasons:
1. the external Quarter-Hour study is trade-level;
2. the official individual archive contains the missing underlying trade;
3. it retains timestamp, quantity and buyer-maker direction needed for the later OI definition;
4. it avoids dependence on the observed aggTrades ID anomaly;
5. no strategy outcome has been observed, so this is a data-source correction rather than performance rescue.

Before downloading the full corpus, the successor must first run a strategy-neutral archive-availability/size audit for all 120 asset-months.

## Aggregate-manifest note

Because the failed shard wrote a fail-closed manifest before family-specific audits completed, the aggregate report also lists missing per-family coverage/timestamp-unit fields for that shard.

Those are downstream consequences of the root exception, not six independent source failures.

The canonical root cause is the official `aggTrades` identifier anomaly described above.

## Frozen decision

`FOUNDATION_DATA_V1_FAIL_SOURCE_ANOMALY_NEW_SOURCE_PROTOCOL_REQUIRED`

No strategy protocol, Paper bot or live execution is authorized.
