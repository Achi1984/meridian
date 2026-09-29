# Quarter-Hour Boundary Imbalance — Individual Trades Source V0.1 Result

Status: **PASS — SEPARATE DATA V1.1 QUALITY PROTOCOL REQUIRED**  
Execution impact: **false**  
Market rows parsed: **false**  
Signal / returns / positions / PnL: **not calculated**

## Why this source audit exists

The first sharded `aggTrades` Data V1 failed on an official Binance source anomaly in SOLUSDT / 2025-07.

MERIDIAN does not relax that failed V1 rule in place.

Instead, this separately versioned source audit evaluates official Binance USD-M **individual `trades`** archives as the next candidate input.

This is also closer to the trade-level input described by the external Quarter-Hour study.

## Run evidence

- workflow run: **36618967045**
- artifact: **11057721043**
- artifact ZIP SHA-256: `8feaf8e446bd7444fa73b1f8e2f27102518470d638389467f6fb9ef8d6c6ab14`

## Scope

Assets:
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Months:
- 2025-01 through 2026-08 inclusive

Expected monthly archives:
- **120**

## Result

- available archives/checksums: **120/120**
- missing: **0**
- total published compressed bytes: **92,920,074,879** (~92.9 GB)

By asset:

| Asset | Months | Published bytes |
|---|---:|---:|
| BTCUSDT | 20/20 | 17,691,556,174 |
| ETHUSDT | 20/20 | 33,217,384,723 |
| XRPUSDT | 20/20 | 13,116,853,172 |
| SOLUSDT | 20/20 | 12,603,645,841 |
| DOGEUSDT | 20/20 | 11,124,296,512 |
| ADAUSDT | 20/20 | 5,166,338,457 |

Decision:

`INDIVIDUAL_TRADES_SOURCE_V0_1_PASS_DATA_QUALITY_PROTOCOL_REQUIRED`

## Engineering implication

The corpus is much larger than the failed aggTrades source.

The successor quality foundation therefore must remain sharded:
- one asset-month per job;
- bounded concurrency;
- one archive at a time;
- checksum verification;
- sequential CSV parsing;
- compact quality manifest only;
- raw archive deleted after each shard.

A monolithic ~93 GB job is forbidden.

## Required Data V1.1 checks

Before any directional OI calculation, the individual-trades source must validate at minimum:

- official checksum match;
- exact schema;
- valid trade ID;
- strictly increasing or otherwise source-documented trade-ID behavior;
- nondecreasing trade timestamp;
- target-month boundaries;
- finite positive price;
- finite positive quantity;
- finite non-negative quote quantity;
- strict buyer-maker Boolean;
- full UTC quarter-hour coverage;
- source-unit consistency;
- cross-check of trade quantity × price against quote quantity within an explicit tolerance;
- 1-minute kline continuity;
- funding continuity.

The SOLUSDT July 2025 anomaly window should be included as a mandatory canary.

## Explicitly forbidden

V0.1 and the future Data V1.1 quality stage must not calculate:
- signed order imbalance;
- future returns;
- signal/return correlation;
- asset ranking;
- position direction;
- turnover;
- funding PnL;
- strategy PnL.

## Next gate

A separately frozen **individual-trades Data V1.1** protocol may now be designed.

Only a full Data V1.1 PASS can authorize the later strategy preregistration step.

No Paper/live authorization is created by this result.
