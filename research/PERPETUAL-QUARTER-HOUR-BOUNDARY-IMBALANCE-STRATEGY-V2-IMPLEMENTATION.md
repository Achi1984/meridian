# Quarter-Hour Boundary Imbalance — Strategy V2 Deterministic Implementation

Status: **IMPLEMENTED FOR REVIEW — HISTORICAL V2 DEVELOPMENT RUN BLOCKED**  
Preregistration dependency: **frozen Strategy V2 via PR #457**  
V1 negative-control result: **frozen**  
Own V2 historical PnL observed before implementation: **false**  
Post-August-2026 holdout inspected: **false**  
Paper/live authorization: **false**

## Purpose

Implement the already-frozen Strategy V2 sample-and-hold hypothesis without changing its signal, cadence, costs, universe, caps, development gate or future holdout.

Pull-request CI executes synthetic deterministic invariants only. It must not execute the 2025-01 through 2026-08 historical development result.

A separate run-authorization commit on the dedicated `research/qh-boundary-strategy-v2-run` branch is required after exact-head CI and implementation review.

## Frozen source dependency

V2 consumes the 120 compact source shards produced by historical Strategy V1 run `37029699996`.

Those shards contain:
- exact Data V1.3 source-lock verification;
- quarter-hour OI values;
- frozen execution references;
- official funding rates and no-lookahead funding references;
- no forward-return field;
- no position state;
- no strategy PnL;
- Paper/live authorization false.

The V2 aggregator requires exactly 120 unique asset-month shards and fails closed if:
- a shard is missing or duplicated;
- source family/ruleset differs from frozen Strategy V1;
- the Data V1.3 source lock flag is not true;
- any source shard already contains positions or PnL;
- any execution authorization flag is true.

This makes V2 a deterministic transformation of the exact V1 information set, not a fresh upstream-data pull.

## Sample-and-hold implementation

The V2 core continuously reconstructs the unchanged V1 rolling target:

`cohort_weight = (1/6) * OI_t / 48`

All valid quarter-hour signals are processed for target state, but execution decisions are emitted only at:
- 00:00 UTC;
- 12:00 UTC.

The first eligible risk sample is 2025-01-01 12:00 UTC.

At a scheduled sample:
1. expire V1-equivalent 12h cohort contributions;
2. process the current boundary signal;
3. calculate the current V1 rolling target;
4. if the sample has a valid frozen execution reference, execute one net target transition;
5. otherwise keep the actually held position unchanged and wait until the next scheduled sample.

No intermediate quarter-hour target change creates a trade.

## Accounting parity

V2 has its own pure deterministic ledger implementation, but synthetic tests compare rebalance and funding transitions against the frozen V1 accounting reference.

Unchanged accounting:
- mark held quantity to the new execution/funding reference first;
- target notional uses marked current equity;
- cost applies to absolute net notional change once;
- one-way primary cost 6 bp;
- official funding sign convention;
- funding before rebalance when timestamps coincide;
- starting equity 100,000;
- asset cap 1/6;
- portfolio gross cap <=1.0x by construction.

## Right-edge behavior

The last new sampled risk interval starts 2026-08-31 00:00 UTC.

At 2026-08-31 12:00 UTC:
- the existing V2 position is flattened;
- target is forced to zero;
- no new 12h interval is opened;
- a missing terminal execution reference fails the run closed.

The final half-day of the development window is flat.

## Development gate

The implementation uses the frozen seven-gate V2 development contract:
- positive full-window net return;
- max drawdown <15%;
- >=3/4 positive chronological blocks;
- B4 positive;
- >=4/6 assets positive;
- <=40% positive-PnL concentration by one asset;
- turnover / starting equity <=61.7911513x, at least 90% below frozen V1.

A pass produces only:

`STRATEGY_V2_DEV_PASS_HOLDOUT_REQUIRED`

A failure produces:

`STRATEGY_V2_DEV_FAIL`

Neither state enables Paper or live trading.

## Robustness diagnostics

Only the preregistered cost diagnostics are calculated:
- 3 bp one-way;
- 6 bp primary;
- 10 bp one-way.

The lower-cost case cannot rescue primary failure.

## Synthetic reviewer invariants

The test suite locks:
- exact 00:00 / 12:00 schedule;
- first sample equals the V1 rolling target;
- no intermediate rebalances;
- missing scheduled execution does not catch up;
- V2 ledger parity with V1 for rebalance/funding transitions;
- seventh turnover gate;
- forced terminal flatten;
- terminal flatten fails closed without execution reference;
- all research authorization flags remain false.

## Historical execution authorization

This implementation PR must not run historical V2 PnL.

After merge, a dedicated run branch may add one documentation-only authorization file that:
- names the exact implementation commit;
- confirms exact-head CI green;
- confirms no V2 PnL has been inspected;
- authorizes only the 2025-01 through 2026-08 **development** run;
- keeps Paper/live false.

Even a development pass cannot promote to Paper. It only permits the separately locked 2026-09 through 2027-02 holdout package.
