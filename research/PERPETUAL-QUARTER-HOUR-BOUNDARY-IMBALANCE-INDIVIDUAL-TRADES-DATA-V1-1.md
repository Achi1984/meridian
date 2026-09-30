# Quarter-Hour Boundary Imbalance — Individual Trades Data V1.1

Status: **FROZEN STRATEGY-NEUTRAL DATA QUALITY PROTOCOL**  
Parent source gate: `INDIVIDUAL_TRADES_SOURCE_V0_1_PASS_DATA_QUALITY_PROTOCOL_REQUIRED`  
Execution impact: **false**  
Signal/returns/positions/PnL allowed: **false**

## Purpose

Replace the failed `aggTrades` Data V1 source with official Binance USD-M individual `trades` archives under a new version. The failed V1 remains immutable.

## Fixed scope

Universe:
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Window:
- 2025-01 through 2026-08 inclusive
- 120 asset-month shards

Each shard validates:
- monthly individual `trades`;
- monthly 1-minute klines;
- monthly fundingRate.

Official USD-M `trades` schema:
- trade Id
- price
- qty
- quoteQty
- time
- isBuyerMaker

## Shard invariants

### Individual trades

Require:
- official CHECKSUM exact match;
- exactly one ZIP member;
- finite positive price;
- finite positive quantity;
- finite non-negative quoteQty;
- strict Boolean buyer-maker field;
- timestamps inside the target UTC month;
- timestamps nondecreasing;
- one timestamp unit;
- trade IDs strictly increasing;
- trade IDs contiguous inside the monthly archive;
- `lastTradeId - firstTradeId + 1 == rows`;
- `quoteQty ~= price * qty` with fixed relative tolerance `1e-8`;
- every UTC quarter-hour bin contains at least one trade.

### 1-minute klines

Require exact complete one-minute cadence over the month, exact first/last minute, valid OHLC, non-negative volume fields and consistent millisecond timestamps.

### Funding

Require strictly increasing events, all events in target month, millisecond timestamps and no boundary/inter-event gap above 12 hours.

## Canary gate

Before full 120-shard execution:

1. **SOLUSDT / 2025-07**
   - mandatory because this is the exact month that invalidated aggTrades V1;
   - individual-trades source must show clean trade-ID continuity and quarter-hour coverage.

2. **BTCUSDT / 2025-01**
   - high-volume beginning-of-window stress canary.

Both plus parser invariants must PASS before the full run is authorized.

## Full gate

PASS requires:
- exactly 120 unique expected shards;
- 120/120 shard PASS;
- no missing/duplicate/unexpected shard;
- continuous individual trade IDs in every month;
- zero empty quarter-hour bins;
- complete 1m kline coverage;
- complete funding coverage;
- all anti-leakage flags false.

PASS decision:

`INDIVIDUAL_TRADES_DATA_V1_1_PASS_PROTOCOL_PREREGISTRATION_REQUIRED`

FAIL decision:

`INDIVIDUAL_TRADES_DATA_V1_1_FAIL_DATA_QUALITY`

## Explicitly forbidden

Data V1.1 must not calculate:
- buy-minus-sell flow;
- signed order imbalance;
- forward returns;
- signal-return relationships;
- rankings;
- position direction;
- exposure;
- turnover;
- fee/funding PnL;
- strategy PnL.

The buyer-maker field is parsed only to validate schema.

## Engineering

The source V0.1 corpus is ~92.9 GB compressed, so:
- one asset-month per job;
- max parallelism 6;
- raw archives temporary only;
- compact shard manifests retained;
- no monolithic full-corpus job.

## What PASS authorizes

Only a later strategy preregistration. It does not authorize a backtest, Paper bot or live execution.
