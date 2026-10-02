# Quarter-Hour Boundary Imbalance — Strategy V1 Deterministic Implementation

Status: **IMPLEMENTED FOR REVIEW — HISTORICAL EVIDENCE RUN BLOCKED**  
Data dependency: **Individual-Trades Data V1.3 120/120 PASS**  
Preregistration dependency: **canonical Strategy V1 via PR #435**  
Own historical Strategy V1 PnL observed before this implementation: **false**  
Paper/live authorization: **false**

## Purpose

Implement the already-frozen Strategy V1 preregistration without changing any signal rule, horizon, threshold, cost, sizing rule, accounting convention, robustness diagnostic or primary research gate.

This work package is implementation-only. Pull-request CI runs synthetic deterministic tests. It must not launch the 20-month historical evidence run.

The historical run requires a later documentation-only authorization commit on the dedicated run branch after exact-head CI and independent implementation review.

## Frozen dependencies

Data V1.3:
- full run: `36690368732`
- aggregate artifact: `11090766829`
- aggregate digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`
- exactly 120/120 data-quality shards PASS
- zero hard-gate reasons

Strategy V1:
- original preregistration: PR #354
- Data-V1.3 rebind: PR #435
- continuation direction
- first 10 seconds after each 00/15/30/45 UTC boundary
- primary 12h / 48-cohort horizon
- fixed per-asset max target 1/6 equity
- total mechanical gross cap 1.0x
- execution reference first valid individual trade in `[t+10s,t+60s)`
- 6 bp one-way primary cost
- 3 bp and 10 bp cost diagnostics
- 4h and 8h horizon diagnostics
- funding-coincidence diagnostic
- fixed 2025-01 through 2026-08 evaluation window
- fixed B1-B4 blocks
- unchanged six primary research gates

## Exact Data V1.3 source lock

The historical Strategy V1 run must not merely accept whatever archives are current at run time.

Before source extraction, the workflow downloads the compact shard evidence from successful Data V1.3 full run `36690368732` and builds a 120-record checksum lock.

For every asset-month, Strategy V1 must match the exact V1.3-validated:
- individual-trades SHA-256 and byte count;
- funding-rate SHA-256 and byte count.

A new official CHECKSUM is not sufficient if it differs from the V1.3 source lock. Any mismatch fails closed before signal or PnL aggregation.

This prevents a silently republished upstream archive from changing the strategy sample after the Data V1.3 PASS was frozen.

## Source extraction

Each asset-month shard independently re-downloads only the official Binance USD-M source fields required by Strategy V1:
- monthly individual trades;
- monthly funding rates.

Archives are verified against the published SHA-256 CHECKSUM through the frozen Data V1.3 source helper.

Raw archives are temporary and deleted after compact event evidence is written.

No 1m-kline input enters the strategy signal, execution model, funding valuation or PnL. Kline structural integrity already belongs to the upstream Data V1.3 PASS gate.

## Exact source-row semantics

Every individual-trade source row is retained according to Data V1.3.

The exchange `tradeId` is schema-validated metadata only. Repeated or decreasing IDs do not delete or reorder source records.

Physical source-row order is not used as temporal order.

Quarter-hour signal bins, execution selection and funding references are determined by the timestamp carried by each retained source record.

For equal timestamps, the Data V1.3 source-record ordinal is the deterministic tie-breaker.

## Frozen signal implementation

For each UTC quarter-hour boundary `t`:
- include all individual trades with timestamp in `[t,t+10s)`;
- buyer-initiated when `isBuyerMaker=false`;
- seller-initiated when `isBuyerMaker=true`;
- signed quantity `OF_t = sum(qty * direction)`;
- total quantity `TV_t = sum(qty)`;
- normalized imbalance `OI_t = OF_t / TV_t`.

If `TV_t <= 0`, no new cohort is created. No imputation is allowed.

## Execution reference

For each boundary, the executable reference is the earliest source record by `(timestamp, source-record ordinal)` satisfying:

`timestamp in [t+10s,t+60s)`

If none exists:
- the virtual cohort state still changes according to the frozen signal/expiry rules;
- no rebalance occurs;
- the actually held position remains unchanged;
- the next valid rebalance uses the then-current net target.

No later price is searched to rescue the missing event.

## Cohorts and target weights

For the 12h primary:
- horizon = 48 quarter-hour events;
- each new valid signal creates `cohort_weight = (1/6) * OI_t / 48`;
- a cohort expires exactly 12h after its boundary;
- expiry is processed before a new cohort is added at the same boundary;
- target weight is the sum of active cohort weights.

The same construction is used for the predeclared 4h/16-cohort and 8h/32-cohort diagnostics.

No fitted signal threshold exists.

## Right-edge completeness

The frozen evaluation data end at 2026-09-01 00:00 UTC. A primary 12h cohort must never be opened if its scheduled expiry would fall beyond the final executable quarter-hour boundary available inside that validated window.

Therefore:
- a new cohort is admitted only when its full frozen horizon can expire no later than the final 2026-08-31 23:45 UTC boundary;
- later signals are still measured and reported as right-censored diagnostics but do not create positions;
- existing cohorts continue to expire normally;
- the terminal target must decay to exactly zero at the final executable boundary;
- that terminal flatten must have a valid preregistered execution reference or the run fails closed.

The same complete-horizon rule applies to the 4h and 8h robustness diagnostics.

This is a pre-result anti-censoring implementation rule. It prevents partially observed final cohorts from being treated as if they completed their frozen holding horizon.

## Event-driven portfolio ledger

Starting equity is exactly `100,000` normalized USD units.

The portfolio is updated only on:
- valid asset rebalance references;
- funding events.

No synthetic cross-asset interpolation price is introduced.

At an asset rebalance:
1. mark that asset's currently held quantity from its previous valid mark to the new execution reference;
2. update current portfolio equity by that price PnL;
3. compute target notional as `target_weight * marked_current_equity`;
4. compute turnover as the absolute difference between target notional and the old position valued at the new reference;
5. charge transaction cost on that absolute net turnover;
6. update position quantity to target notional / execution price.

This follows the ordering frozen in the preregistration: target notional uses current marked equity before the newly charged transaction cost.

## Funding

Funding is applied using actual net perpetual quantity immediately before the funding timestamp.

Reference price:
- latest valid individual-trade timestamp `<= funding timestamp`;
- if timestamps tie, later source-record ordinal is the deterministic tie-breaker;
- no post-funding trade is permitted.

For month-boundary funding, a missing local reference is carried from the prior validated month’s last source trade.

At the very first portfolio timestamp in 2025-01, an unresolved funding reference is allowed only while position quantity is exactly zero, making funding cash flow exactly zero.

Funding cash flow:

`-position_qty * funding_reference_price * funding_rate`

Positive rates therefore debit longs and credit shorts.

Funding is ordered before a rebalance if two ledger events share a timestamp.

## UTC daily PnL

Daily PnL is the sum of event-ledger equity changes in the half-open UTC interval:

`[00:00 UTC, next 00:00 UTC)`

This is the deterministic event-ledger equivalent of the preregistered 00:00-to-00:00 marked-equity definition and includes price marks, funding and transaction costs occurring in that interval.

Daily profit factor:
- numerator = sum of positive UTC daily net PnL;
- denominator = absolute sum of negative UTC daily net PnL;
- no negative days => `+Infinity` when positive PnL exists;
- no positive days => zero.

## Fixed blocks

The implementation uses exactly:
- B1: 2025-01 through 2025-05
- B2: 2025-06 through 2025-10
- B3: 2025-11 through 2026-03
- B4: 2026-04 through 2026-08

No result from an earlier block can modify later computation.

## Primary metrics

The implementation reports:
- full-window net return;
- gross price PnL/return before funding and costs;
- transaction costs;
- funding PnL;
- event/funding-updated maximum drawdown;
- UTC daily profit factor;
- absolute notional turnover and turnover / starting equity;
- time-weighted gross and net exposure on the event ledger;
- closed cohort-equivalent count;
- per-asset price PnL, funding, costs and net contribution;
- B1-B4 net PnL/return and daily profit factor;
- positive-PnL asset concentration;
- positive/negative/zero/missing OI counts;
- OI distributions by asset;
- absolute target-weight distributions;
- average absolute rebalance size.

Side attribution reports actual-strategy long and short **price + funding** PnL by the sign of the quantity held during the interval. Shared net-turnover transaction costs are reported separately rather than arbitrarily allocated between sides. Neither side is turned off.

## Frozen primary gate

The implementation evaluates exactly the six preregistered rules under 6 bp one-way cost:
1. full-window net return > 0;
2. maximum drawdown < 15%;
3. at least 3 of 4 fixed blocks positive;
4. B4 positive;
5. at least 4 of 6 assets positive;
6. no single asset > 40% of total positive asset PnL.

No extra primary gate is added.

The result decision is:
- `STRATEGY_V1_PASS_PAPER_RESEARCH_PROPOSAL_REQUIRED`, or
- `STRATEGY_V1_FAIL`.

Even a PASS does not authorize Paper trading. It authorizes only a separate Paper-research proposal.

## Preregistered diagnostics

The same frozen implementation additionally reports:
- 4h / 16-cohort horizon;
- 8h / 32-cohort horizon;
- 3 bp one-way cost;
- 10 bp one-way cost;
- suppression of new cohorts at 00:00, 08:00 and 16:00 UTC;
- long/short contribution attribution without disabling either side.

These diagnostics cannot rescue the primary result.

## Synthetic invariants required before authorization

PR CI must prove at minimum:
- `isBuyerMaker` direction mapping;
- normalized imbalance;
- 48-cohort 1/6 cap;
- complete-horizon right-edge censoring and terminal zero target;
- missing execution reference does not erase virtual cohort state;
- absolute net-turnover cost at 6 bp;
- long/short funding sign;
- no missing funding reference when non-zero exposure exists;
- fixed block boundaries;
- exact six-rule primary gate;
- timestamp-based execution selection despite out-of-order source rows;
- no-lookahead funding reference;
- exact V1.3 source checksum mismatch fails closed;
- the V1.3 source-lock builder requires exactly 120 PASS shard records;
- cross-month funding reference uses only the prior month’s last valid trade.

## Historical-run lock

The workflow is pull-request safe:
- PR events run only compilation + synthetic invariants;
- the 120-shard source extraction and aggregate Strategy V1 computation are skipped on PRs;
- a historical run can start only from the dedicated `research/qh-boundary-strategy-v1-run` branch after a later documentation-only authorization file is added.

Before that authorization:
- exact-head Strategy V1 invariants must PASS;
- MERIDIAN Release Safety must PASS;
- an independent implementation review must confirm no deviation from the frozen preregistration;
- no historical Strategy V1 result may be inspected.

Paper and live execution remain disabled regardless of the historical result.
