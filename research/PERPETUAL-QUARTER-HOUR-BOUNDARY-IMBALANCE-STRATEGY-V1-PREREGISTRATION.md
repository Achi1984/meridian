# Quarter-Hour Boundary Imbalance — Strategy V1 Preregistration

Status: **FROZEN DESIGN PREWORK — EXECUTION BLOCKED UNTIL DATA V1.2 120/120 PASS**  
Own MERIDIAN directional signal inspected: **false**  
Own MERIDIAN forward returns inspected: **false**  
Own MERIDIAN strategy PnL inspected: **false**  
Paper/live authorization: **false**

## Purpose

Freeze one parsimonious translation of the external Quarter-Hour evidence into a testable portfolio **before** inspecting MERIDIAN's own directional signal/return relationship or strategy PnL.

This document does not authorize a strategy run. It becomes executable only after the separately frozen Individual-Trades Data V1.2 corpus passes 120/120 hard data-quality shards.

A failed Data V1.2 gate invalidates this execution path until a separately versioned data protocol is established. Strategy rules must not be edited to rescue a data failure.

## Evidence basis

The design follows the externally locked evidence:
- Binance USD-M perpetual futures;
- BTC, ETH, XRP, SOL, DOGE, ADA;
- quarter-hour boundaries at minute 00/15/30/45;
- first 10 seconds after the boundary;
- buyer-initiated when `isBuyerMaker=false`, seller-initiated when `isBuyerMaker=true`;
- normalized order imbalance;
- continuation direction;
- primary 12-hour horizon;
- 4h and 8h used only as robustness diagnostics;
- explicit costs and realized funding;
- no model-complexity rescue.

## Frozen signal

For quarter-hour event time `t`, use individual trades with timestamps in:

`[t, t + 10 seconds)`

For each trade `k`:
- `D_k = +1` when `isBuyerMaker=false`;
- `D_k = -1` when `isBuyerMaker=true`;
- `V_k = qty_k`.

Signed flow:

`OF_t = sum(V_k * D_k)`

Total volume:

`TV_t = sum(V_k)`

Normalized imbalance:

`OI_t = OF_t / TV_t`

No price, return, funding outcome, future bar or later trade may enter the signal.

If `TV_t <= 0`, the event is non-executable and must be reported. No imputation is allowed.

## Direction and sizing

Direction is **continuation**:
- `OI_t > 0` contributes long exposure;
- `OI_t < 0` contributes short exposure.

Sizing is continuous and linear in the externally defined variable. No sign-only threshold and no fitted cutoff is used.

Each asset has a fixed maximum absolute gross target of **1/6 of portfolio equity**.

The primary horizon is **12 hours = 48 quarter-hour cohorts**.

A new event creates a virtual cohort weight:

`cohort_weight = (1/6) * OI_t / 48`

The live target weight for an asset is the sum of all unexpired 12-hour cohort weights.

Consequences:
- each asset target is mechanically bounded to `[-1/6, +1/6]`;
- total six-asset gross exposure is mechanically bounded to 1.0x equity;
- no leverage multiplier is introduced;
- no martingale, pyramiding or winner/loser scaling exists;
- opposite cohorts naturally net.

Virtual cohorts are accounting objects only. Execution is modeled as one net target position per asset.

## Entry and rebalance convention

The signal window closes at `t + 10s`.

At that point:
1. expire the cohort that reached exactly 12 hours;
2. add the new cohort;
3. calculate the new net target weight;
4. rebalance only the difference between prior and new target.

Reference execution price is the **first valid individual trade at or after `t+10s` and before `t+60s`**.

If no valid trade exists in that interval:
- do not look further ahead for a favorable fill;
- skip that event's rebalance;
- record `EXECUTION_PRICE_UNAVAILABLE`;
- keep the previously established target until the next valid rebalance.

The same convention applies when cohort expiry changes the target.

## Funding

Official Binance USD-M funding data is included at every funding event.

Funding PnL uses the actual net perpetual exposure immediately before the funding timestamp:
- positive funding rate: longs pay, shorts receive;
- negative funding rate: longs receive, shorts pay.

No funding-time signals are removed from the primary strategy.

A secondary diagnostic may report results excluding quarter-hour events at 00:00, 08:00 and 16:00 UTC, but it cannot replace the primary result.

## Transaction costs

Costs apply to **absolute net turnover**, not to every virtual cohort independently.

Primary all-in one-way cost:
- fee allowance: **5 bp**
- slippage allowance: **1 bp**
- total: **6 bp per one-way notional change**

Therefore a full close-and-reopen round trip at unchanged size carries 12 bp before funding.

Predeclared cost diagnostics:
- low-cost diagnostic: 3 bp one-way;
- primary: 6 bp one-way;
- high-cost stress: 10 bp one-way.

Only the 6 bp case controls the primary pass/fail decision. The low-cost case cannot rescue a primary failure.

## Capital and accounting

Starting equity: **100,000 normalized USD units**.

At every rebalance:
- target notional equals target weight times current equity;
- transaction cost is charged on absolute notional change;
- mark-to-market uses individual-trades-derived execution/valuation prices under a deterministic no-lookahead convention;
- funding is added at the recorded funding timestamp;
- equity compounds through time.

No borrowing beyond the 1.0x gross cap is allowed.

## Fixed evaluation window

Universe:
- BTCUSDT
- ETHUSDT
- XRPUSDT
- SOLUSDT
- DOGEUSDT
- ADAUSDT

Window:
- 2025-01-01 through 2026-08-31 inclusive, constrained by the frozen Data V1.2 corpus.

This entire period is treated as an external-evidence replication window. No parameter is fitted on it.

Fixed chronological stability blocks:
- B1: 2025-01 through 2025-05
- B2: 2025-06 through 2025-10
- B3: 2025-11 through 2026-03
- B4: 2026-04 through 2026-08

All blocks are calculated in one run. Results from an earlier block may not be used to alter the protocol before later blocks are calculated.

## Primary metrics

Report at minimum:
- net return;
- gross return before costs/funding;
- transaction costs;
- funding PnL;
- maximum drawdown;
- profit factor;
- turnover;
- average gross and net exposure;
- closed cohort-equivalent count;
- per-asset net return/PnL;
- each fixed block's net return and PF;
- concentration of positive PnL by asset.

Because exposure is continuous and netted, also report:
- percent of quarter-hour events with positive/negative/zero OI;
- OI distribution by asset;
- absolute target-weight distribution;
- average absolute rebalance size.

## Frozen primary research gate

Strategy V1 may advance only to a separate Paper-research proposal if **all** of the following hold under the primary 6 bp one-way cost case:

1. full-window net return > 0;
2. full-window profit factor > 1.00;
3. maximum drawdown < 15%;
4. at least 3 of 4 chronological blocks have positive net return;
5. final block B4 has positive net return;
6. at least 4 of 6 assets have positive net contribution;
7. no single asset contributes more than 40% of total positive asset PnL.

Failure of any primary gate freezes **STRATEGY V1 FAIL**.

No failed gate may be rescued by:
- changing the 12h horizon;
- switching to 4h/8h after seeing results;
- removing a losing asset;
- using LONG-only or SHORT-only exposure;
- adding an OI threshold;
- clipping losing signals differently;
- adding regime filters;
- adding machine learning;
- changing the cost assumption;
- changing overlap geometry;
- changing the evaluation blocks.

Any successor requires a separately versioned hypothesis frozen before its results are observed.

## Predeclared robustness diagnostics

These do not select the winner and cannot rescue a primary failure.

### Horizon
Recompute the same construction at:
- 4h = 16 cohorts;
- 8h = 32 cohorts.

All other rules remain unchanged except the cohort count/horizon.

### Cost
Report:
- 3 bp one-way;
- 6 bp one-way primary;
- 10 bp one-way stress.

### Funding coincidence
Report the primary result again with new cohorts suppressed at 00:00, 08:00 and 16:00 UTC.

### Side decomposition
Report long-contribution and short-contribution attribution without turning either side off.

## Reviewer invariants before implementation

A later implementation PR must be rejected if it:
- reads any forward return while constructing `OI_t`;
- uses kline volume as a substitute for the individual-trade signal;
- changes continuation to reversal;
- introduces a fitted threshold;
- exceeds the fixed 1.0x gross portfolio cap;
- stacks real positions outside the net-target accounting rule;
- uses 4h/8h as parameter-selection alternatives;
- omits transaction costs or funding;
- changes any primary gate after results are available;
- enables Paper/live execution in the research run.

## Execution authorization

Even after Data V1.2 passes, this preregistration requires a separate implementation PR with:
- deterministic tests for direction, cohort expiry, netting, turnover costs and funding sign;
- no-lookahead tests around the 10-second boundary;
- exact-head Release Safety;
- an independent reviewer confirming the implementation matches this frozen document.

Only then may the historical Strategy V1 evidence run execute.

Paper and live trading remain disabled regardless of the historical result.
