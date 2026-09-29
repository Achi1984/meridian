# Quarter-Hour Boundary Order Imbalance V1 — Sharded Data V1 Protocol

Status: **FROZEN STRATEGY-NEUTRAL DATA QUALITY PROTOCOL**  
Execution impact: **false**  
Signal/PnL allowed: **false**

Parent:
- `PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1-DATA-V0`
- V0 result: 360/360 required public Binance USD-M monthly archives published.

## Objective

Validate the complete raw public-data foundation required for a later Quarter-Hour Boundary Order Imbalance strategy without calculating the strategy signal or any forward-return relationship.

## Fixed universe and calendar

Assets:
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Months:
- 2025-01 through 2026-08 inclusive

Total independent shards:
- **120 asset-month shards**

Every shard contains exactly:
- one monthly USD-M `aggTrades` archive;
- one monthly USD-M 1-minute kline archive;
- one monthly USD-M `fundingRate` archive.

## Why sharded

V0 observed approximately 39.14 GB of compressed `aggTrades` archives alone.

The full corpus must therefore not be processed in one monolithic job.

Each asset-month is isolated:
1. download checksum;
2. stream-download one archive to temporary disk while calculating SHA-256;
3. require exact checksum match;
4. stream-parse the single ZIP member;
5. emit compact quality metadata;
6. delete the raw archive before the next family;
7. upload only the compact shard manifest.

Maximum parallelism is capped at six jobs.

## Canary gate

Before the full 120-shard run, the pull request must pass:

- parser invariant tests;
- BTCUSDT / 2025-01 real-data shard;
- ADAUSDT / 2026-08 real-data shard.

This deliberately covers:
- the largest/liquid benchmark at the beginning of the window;
- a different contract at the end of the window.

A canary failure blocks the full run.

## Raw archive integrity

Every archive must:
- have a corresponding official Binance `.CHECKSUM`;
- produce an exact SHA-256 match;
- contain exactly one non-directory ZIP member.

No archive may be silently substituted or reconstructed.

## aggTrades quality rules

The parser validates only data quality.

Required fields:
- aggregate trade ID;
- price;
- quantity;
- first underlying trade ID;
- last underlying trade ID;
- timestamp;
- buyer-maker Boolean.

Checks:
- finite positive price and quantity;
- first trade ID <= last trade ID;
- aggregate trade IDs must never decrease;
- equal consecutive aggregate trade IDs are permitted only as a source-archive identifier anomaly; they are counted explicitly and do not cause row removal;
- underlying trade-ID ranges must strictly advance without overlap (`current first_trade_id > previous last_trade_id`);
- timestamps never decrease;
- all timestamps are inside the target UTC month;
- buyer-maker field parses strictly as true/false or 1/0;
- one consistent timestamp unit within the archive.

Quarter-hour coverage:
- the calendar month is divided into exact UTC 15-minute bins;
- at least one aggregate trade must exist in every bin;
- only counts/coverage are retained;
- buyer-maker direction is **not aggregated**.

The shard output may contain:
- total aggregate-trade rows;
- first/last timestamp;
- first/last aggregate-trade ID;
- count of equal consecutive aggregate-trade IDs;
- timestamp unit;
- empty/non-empty quarter-hour bin count;
- min/max trade count per non-empty bin.

It must not contain directional buyer/seller aggregates.

## Source anomaly clarification after first full Data V1 run

The first full run on head `78e8975b061b926733d66734ab409dcf56e11bfe` processed 119/120 shards successfully and failed only `SOLUSDT / 2025-07` because the original parser required the aggregate trade ID itself to be strictly increasing.

An isolated, strategy-neutral source diagnostic then re-read the exact official Binance archive with its published checksum:

- diagnostic workflow: **36617946382**
- diagnostic artifact: **11055503695**
- artifact digest: `sha256:af95dd62ab821410ea14a3ea0cec665ead8b28ba60f1e448d34451f8ad5eb73c`
- official archive SHA-256: `07842c476aab159f008ffc4e95e421e181f75348610c23baeae1dc3799d4e89b`
- rows: **14,070,960**
- non-increasing aggregate-ID events: **1**
- decreases: **0**
- equal IDs: **1**

The two equal-ID rows are distinct:
- aggregate ID: `926014272` on both rows;
- timestamps differ by 203 ms;
- prices and quantities differ;
- buyer-maker side differs;
- underlying trade IDs advance from `2468302188` to `2468302190`;
- no underlying trade-ID overlap is present.

Binance documents aggregate trade ID, first trade ID and last trade ID as separate fields. For MERIDIAN's data-quality purpose, uniqueness of the aggregate identifier is not required to construct the later trade-level order-flow variable; preserving non-overlapping underlying trade ranges and time ordering is the stronger integrity condition.

Therefore this pre-signal/pre-PnL correction changes only the source-quality invariant:

- **forbidden:** aggregate ID decreases;
- **allowed and counted:** aggregate ID equality when underlying trade ranges still strictly advance and timestamps do not decrease;
- **forbidden:** overlapping or non-advancing underlying trade-ID ranges.

No directional imbalance, return, position or PnL was observed before this correction. No row is dropped or deduplicated.

## 1-minute kline quality rules

Require:
- exact one-minute cadence for the complete UTC month;
- exact expected row count;
- first open at month start;
- last open at one minute before next month;
- finite positive OHLC;
- internally consistent OHLC;
- non-negative volume/trade fields;
- taker-buy base <= total base volume;
- taker-buy quote <= total quote volume;
- one consistent timestamp unit.

## Funding quality rules

Require:
- at least one event;
- finite funding rate;
- strictly increasing event timestamps;
- all events inside the target month;
- one consistent timestamp unit;
- first event no more than 12 hours from month start;
- final event no more than 12 hours before month end;
- no inter-event gap greater than 12 hours.

The funding rates themselves are not ranked, transformed into a signal, or related to returns.

## Timestamp policy

Binance's official public-data documentation currently documents USD-M futures `aggTrades` and klines using millisecond timestamps. The parser can detect and normalize a different unit so an unexpected source-format change is diagnosed rather than mis-bucketed.

The aggregate Data V1 gate requires the observed USD-M `aggTrades` and 1-minute kline unit to remain **MILLISECOND**. A different unit causes a data-quality fail and requires a separately reviewed parser/source update before research continues.

## Full aggregate gate

PASS requires all of the following:

- exactly **120** unique expected asset-month manifests;
- no missing shard;
- no duplicate shard;
- no unexpected shard;
- every shard gate PASS;
- every `aggTrades` quarter-hour coverage check PASS;
- every 1-minute kline coverage check PASS;
- every funding coverage check PASS;
- expected millisecond timestamp convention for `aggTrades` and 1-minute klines;
- all anti-leakage flags false.

PASS decision:

`FOUNDATION_DATA_V1_PASS_PROTOCOL_PREREGISTRATION_REQUIRED`

FAIL decision:

`FOUNDATION_DATA_V1_FAIL_DATA_QUALITY`

## Explicitly forbidden during Data V1

Data V1 must never calculate:

- signed or directional order imbalance;
- buy-minus-sell volume;
- first-10-second directional flow;
- forward return;
- signal/return correlation or regression;
- asset ranking;
- threshold;
- trading position;
- turnover;
- transaction-cost PnL;
- funding PnL;
- strategy PnL.

The machine-readable shard and aggregate manifests carry explicit false flags for these operations.

## What a PASS authorizes

A Data V1 PASS authorizes only a **separate strategy preregistration step**.

That later step must freeze, before first strategy PnL:
- exact event window;
- exact order-imbalance definition;
- signal direction;
- holding horizon;
- entry/exit convention;
- portfolio construction;
- costs;
- funding treatment;
- development/validation/holdout boundaries;
- promotion gates.

No Paper or live execution is authorized by Data V1.
