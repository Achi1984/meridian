# Quarter-Hour Boundary Order Imbalance V1 — Data V0 Result

Status: **PASS — FULL DATA QUALITY AUDIT REQUIRED**  
Workflow run: **36611778776**  
Workflow head: `434d8b39246a7f5ed6e8ab58ed0921c2b7aabe08`  
Artifact: **11053765060**  
Artifact ZIP SHA-256: `c58895b7d9e60fbde28c416116d3dd82cf1b44490451a09aacf801f3848448f9`

## Scope

Strategy-neutral publication audit only.

- Venue: Binance USD-M perpetual futures
- Assets: BTC, ETH, XRP, SOL, DOGE, ADA
- Months: 2025-01 through 2026-08
- Data families: monthly `aggTrades`, 1-minute `klines`, `fundingRate`

No market rows were parsed for predictive content.

## Result

| Data family | Expected | Available | Missing | Published archive bytes |
|---|---:|---:|---:|---:|
| aggTrades | 120 | 120 | 0 | 39,135,762,018 |
| 1m klines | 120 | 120 | 0 | 210,752,875 |
| fundingRate | 120 | 120 | 0 | 111,054 |
| **Total** | **360** | **360** | **0** | **39,346,625,947** |

Decision:

**FOUNDATION_V0_PASS_FULL_DATA_QUALITY_AUDIT_REQUIRED**

## Leakage / PnL controls

The V0 evidence explicitly records:

- signalCalculated = false
- forwardReturnsCalculated = false
- strategyPnlCalculated = false
- positionsCalculated = false
- executionImpact = false
- paperAuthorized = false
- liveAuthorized = false

Therefore this result is only an archive-availability gate.

## Engineering implication

The published `aggTrades` corpus alone is approximately **39.14 GB** across the selected six assets and twenty months.

MERIDIAN will not attempt a monolithic full-corpus CI job.

The next data foundation must use **sharded streaming extraction**:

- process bounded asset/time shards independently;
- validate each raw archive against its published checksum;
- parse the archive sequentially;
- validate schema, buyer-maker values, timestamp monotonicity and archive boundaries;
- emit only compact strategy-neutral quarter-hour coverage/quality metadata needed for later protocol design;
- delete the raw shard after its quality result is emitted;
- merge shard manifests only after every shard passes.

The next stage still must not calculate forward returns, signal-return relationships, positions or PnL.

## What this PASS does not authorize

It does not authorize:

- a trading rule;
- a holding horizon;
- a threshold;
- a long/short construction;
- a signal direction test;
- a backtest;
- the use of Paper or live capital.

Those remain blocked until a full data-quality foundation passes and a separate protocol is frozen before first PnL.
