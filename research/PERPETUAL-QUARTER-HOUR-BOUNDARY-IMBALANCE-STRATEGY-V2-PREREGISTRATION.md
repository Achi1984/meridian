# Quarter-Hour Boundary Imbalance — Strategy V2 Preregistration

Status: **FROZEN SUCCESSOR HYPOTHESIS — V2 PNL NOT YET INSPECTED**  
V1 result inspected: **yes, frozen negative control**  
V2 own historical PnL inspected: **false**  
Post-August-2026 holdout inspected: **false**  
Paper authorization: **false**  
Live authorization: **false**

## Purpose

Strategy V1 failed because a small positive pre-cost price/funding contribution was overwhelmed by continuous quarter-hour rebalancing. V2 tests one narrowly scoped successor hypothesis:

> The externally motivated quarter-hour imbalance signal may retain useful information when the V1 rolling target is **sampled and held**, instead of being rebalanced on every quarter-hour event.

V2 changes only execution cadence / overlap geometry. It does not cherry-pick the profitable side, winning assets, favorable blocks or a cheaper cost assumption.

## Frozen negative-control dependency

Strategy V1 evidence is frozen by:

- run `37029699996`;
- result artifact `11241728193`;
- result JSON SHA-256 `3b0a14d70067afb2bd429accdfa3079de4d16da9b58c7828b5f27a4c0d2cb9a7`;
- decision **STRATEGY_V1_FAIL**;
- primary turnover / starting equity **617.911513x**;
- primary rebalance count **350,202**;
- primary net return **-34.7463%**.

Those values are reference diagnostics only. V1 itself must never be rewritten.

## Data and signal

V2 uses exactly the same validated Data V1.3 corpus and exact source lock as V1:

- BTCUSDT, ETHUSDT, XRPUSDT, SOLUSDT, DOGEUSDT, ADAUSDT;
- 2025-01-01 through 2026-08-31;
- individual trades in the first 10 seconds after every 00/15/30/45 boundary;
- buyer initiated when `isBuyerMaker=false`;
- seller initiated when `isBuyerMaker=true`;
- normalized order imbalance `OI_t = signed_qty / total_qty`;
- continuation direction;
- no price, future return, funding outcome or later trade enters the signal.

No OI threshold is introduced.

## Frozen V2 target construction

V2 preserves the **same instantaneous target that V1 would have at a sampling boundary**.

For each asset and quarter-hour event, define the unchanged V1 cohort contribution:

`cohort_weight = (1/6) * OI_t / 48`

The V1 rolling target at boundary `t` is the sum of all valid cohort weights whose 12h life is active immediately after processing `t`.

V2 does **not** trade every change in that rolling target.

### Sampling schedule

Execution decisions occur only at fixed UTC boundaries:

- **00:00 UTC**
- **12:00 UTC**

A decision is eligible only after at least 48 quarter-hour boundaries exist in the evaluation sample, so the first possible V2 risk entry is **2025-01-01 12:00 UTC**.

At each eligible sampling boundary:

1. compute the V1 rolling target using only information available through that boundary's first-10-second signal window;
2. freeze that target for the next 12 hours;
3. ignore all intervening target changes for execution;
4. continue calculating all quarter-hour OI values because they determine the next scheduled snapshot.

Thus V2 changes **when** the existing target is executed, not how OI direction or rolling target arithmetic is defined.

## Position and gross-cap rules

At every scheduled sample:

- per-asset target remains bounded to `[-1/6,+1/6]`;
- six-asset gross cap remains mechanically <= 1.0x;
- no leverage multiplier;
- no pyramiding;
- no martingale;
- no winner/loser scaling;
- no side filter;
- no asset filter.

A direct change from one sampled target to the next is one net rebalance. V2 does not synthetically close and reopen the same asset when a single net transition is sufficient.

## Execution reference

At a scheduled sampling boundary `t`, the reference execution price is unchanged from V1:

- first valid individual trade at or after `t+10s`;
- strictly before `t+60s`.

If no valid reference exists:

- do not search further ahead;
- keep the actually held position unchanged;
- discard that scheduled target;
- recompute a fresh target at the next scheduled 12h sampling boundary.

No unscheduled catch-up rebalance is allowed.

## Right-edge rule

A new 12h sampled holding interval may be created only if its complete interval fits inside the validated evaluation window.

The last new 12h interval therefore starts at **2026-08-31 00:00 UTC** and ends at **2026-08-31 12:00 UTC**.

At **2026-08-31 12:00 UTC**:

- existing V2 exposure must be flattened;
- no new 12h risk interval is opened because its expiry would fall outside the validated corpus.

The remaining final half-day is flat.

If the required terminal flatten has no valid execution reference, the run fails closed.

## Funding and ledger ordering

Funding mechanics remain identical to V1:

- official Binance USD-M funding rates;
- actual held net perpetual quantity immediately before funding;
- latest valid individual-trade price <= funding timestamp;
- no post-funding valuation;
- funding event processed before rebalance when timestamps coincide.

## Transaction costs

Primary one-way all-in cost remains **6 bp**:

- 5 bp fee allowance;
- 1 bp slippage allowance.

Costs are charged only on absolute net notional turnover.

Predeclared diagnostics:
- 3 bp one-way;
- 10 bp one-way.

The 3 bp case cannot rescue a 6 bp failure.

## Capital and evaluation window

Starting equity: **100,000 normalized USD**.

Development / replication window:
- 2025-01-01 through 2026-08-31;
- same B1-B4 chronological blocks as V1.

Because V2 was designed after seeing V1, this window is explicitly **development evidence**, not an untouched promotion holdout.

## Primary V2 development gate

V2 may advance only to a separate prospective-holdout execution package if **all** of the following hold at 6 bp:

1. full-window net return > 0;
2. maximum drawdown < 15%;
3. at least 3 of 4 fixed blocks have positive net return;
4. final block B4 has positive net return;
5. at least 4 of 6 assets have positive net contribution;
6. no single asset contributes more than 40% of positive asset PnL;
7. turnover / starting equity <= **61.7911513x**, i.e. at least 90% below frozen V1 turnover.

The V1 rebalance count of 350,202 is reported as a reference. V2 must also report its rebalance-count reduction, but turnover is the formal churn gate because transaction cost is charged on notional rather than event count.

Decision labels are frozen:

- all development gates pass: **STRATEGY_V2_DEV_PASS_HOLDOUT_REQUIRED**
- any development gate fails: **STRATEGY_V2_DEV_FAIL**

Neither decision authorizes Paper or live trading.

## Frozen non-rescue rules

A failed V2 development gate may not be rescued under the V2 label by:

- switching to short-only despite V1 short attribution;
- removing BTC or any other losing asset;
- selecting only favorable B1-B4 periods;
- adding an OI cutoff;
- changing the 12h sample-and-hold cadence;
- moving the 00:00 / 12:00 sampling anchors;
- changing continuation to reversal;
- adding volatility/regime/ML filters;
- selecting 3 bp as the primary cost;
- increasing leverage or gross cap.

Any such successor requires Strategy V3 or another separately frozen family.

## Required reporting

At minimum report:

- net return;
- price PnL;
- funding PnL;
- transaction costs;
- max drawdown;
- daily profit factor;
- turnover and turnover reduction vs V1;
- rebalance count and reduction vs V1;
- average gross/net exposure;
- per-asset contribution;
- B1-B4 metrics;
- long/short price+funding attribution;
- distribution of sampled target weights;
- number of skipped scheduled samples due to missing execution references.

## Prospective holdout lock

If and only if V2 development passes, the same frozen mechanics may be tested on an untouched post-August-2026 holdout.

Primary future holdout window is locked now as:

**2026-09-01 through 2027-02-28 inclusive.**

No post-August-2026 V2 signal/position/PnL may be inspected before the development implementation and rules are frozen.

The future holdout requires a separately versioned data-quality package and run authorization. It may not change V2 mechanics after observing September 2026 or later outcomes.

A development pass is therefore only a permission to continue research; it is not Paper authorization.

## Implementation invariants

A V2 implementation PR must fail review if it:

- reads a future return while constructing the signal or sampled target;
- changes any V1 OI arithmetic;
- trades at quarter-hour boundaries other than the frozen 00:00 / 12:00 sample schedule;
- carries a missed sample target to a later unscheduled execution;
- exceeds 1/6 asset gross or 1.0x portfolio gross;
- removes costs or funding;
- reads post-August-2026 outcome data;
- enables Paper/live execution;
- mutates V1 result files.

Required deterministic tests include:

- sampled target equals V1 rolling target at sampling boundaries;
- no rebalance between scheduled boundaries;
- missing scheduled execution reference does not trigger catch-up;
- direct target-to-target turnover is netted once;
- terminal flatten at 2026-08-31 12:00;
- funding sign/order invariants;
- exact source-lock dependency;
- Paper/live authorization remains false.
