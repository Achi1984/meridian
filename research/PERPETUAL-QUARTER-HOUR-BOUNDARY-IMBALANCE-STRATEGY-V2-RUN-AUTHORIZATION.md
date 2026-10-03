# Quarter-Hour Boundary Imbalance — Strategy V2 Development Run Authorization

Status: **AUTHORIZED — DEVELOPMENT EVIDENCE ONLY**  
Paper authorization: **false**  
Live authorization: **false**  
Future holdout authorization: **false**

## Exact implementation lock

This run is authorized only for the frozen implementation merged by:

- implementation PR: **#459**
- implementation PR exact head: `6b1abb80120c1d7a267cc6bb930ea512c7962c8d`
- implementation merge commit: `07ffa7a2e3f60dac31006cc1ef122fc06ae643e8`
- V2 invariant run: `37101322238` — PASS
- Release Safety run: `37101322233` — PASS
- Frozen Research Lineage: PASS

The run branch is created directly from merge commit `07ffa7a2e3f60dac31006cc1ef122fc06ae643e8`.

No V2 Core, Aggregator, Workflow, Test or Implementation file may change on this branch. The historical workflow must fail if the Frozen Research Guard detects any drift.

## Preregistration lock

Strategy V2 was frozen before implementation and before any V2 development PnL was inspected:

- preregistration/result-lock PR: **#457**
- V1 decision: **STRATEGY_V1_FAIL**
- V2 hypothesis: sample the unchanged V1 rolling target only at 00:00 / 12:00 UTC and hold between samples
- primary one-way cost: **6 bp**
- development turnover gate: **<=61.7911513x starting equity**
- Paper/live remain false regardless of development result

## Source authorization

The development run may consume only the exact 120 compact source shards produced by Strategy V1 historical run:

- Strategy V1 run: `37029699996`
- expected artifact prefix: `qh-strategy-v1-shard-`
- expected unique source shards: **120**
- V1 source shards must still report exact Data V1.3 source-lock verification
- source shards must contain no positions or strategy PnL

No fresh upstream source selection is authorized.

## Development evidence window

Authorized window:

**2025-01-01 through 2026-08-31**

This window is development/replication evidence because Strategy V2 was designed after observing the frozen V1 failure.

The run may calculate:
- V2 sampled positions;
- price/funding PnL;
- 6 bp primary transaction costs;
- preregistered 3 bp / 10 bp cost diagnostics;
- B1-B4 metrics;
- turnover and rebalance reductions versus frozen V1;
- the frozen seven-gate V2 development decision.

## Decision boundary

Only two development decisions are permitted:

- `STRATEGY_V2_DEV_PASS_HOLDOUT_REQUIRED`
- `STRATEGY_V2_DEV_FAIL`

A development pass does **not** authorize Paper or live trading.

It only permits a separately versioned post-August-2026 holdout package.

## Untouched holdout

The preregistered future holdout remains:

**2026-09-01 through 2027-02-28 inclusive**

This development run is not authorized to inspect, download, calculate or summarize V2 outcomes from that holdout.

## Pre-run declaration

At the time this authorization is committed:

- Strategy V1 result has been inspected: **true**
- Strategy V2 development PnL has been inspected: **false**
- Strategy V2 development decision is known: **false**
- post-August-2026 V2 outcomes have been inspected: **false**
- Paper execution is authorized: **false**
- live execution is authorized: **false**
