# Spot-Perp Funding Persistence V2 — Frozen Independent Validation Protocol

Status: **FROZEN BEFORE FIRST V2 PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `SPOT-PERP-FUNDING-HARVEST-V1-FROZEN`
- `SPOT-PERP-FUNDING-HARVEST-V1-DATA-V2-FROZEN`

## Why V2 exists

V1 produced strong discovery economics but failed its preregistered sample-breadth gates:

- net return: +0.7581%
- Profit Factor: 11.2281
- max drawdown: 0.0740%
- stress return: +0.4569%
- positive assets: 8/8
- funding/base-cost ratio: 2.1496
- active cycles: 24 < 32 required
- positive windows: 3/5 < 4/5 required

V1 remains immutable and its holdout is not authorized.

V2 tests a genuinely different **stateful persistence** hypothesis. It does **not** lower the 77.5 bps V1 entry threshold.

## External motivation fixed before V2 result

Recent perpetual-futures research reports:
- economically meaningful spot/perp funding carry;
- out-of-sample predictability/persistence in funding levels;
- time-varying persistence and the need for conservative cost treatment;
- frequent failure of over-engineered timing refinements versus simpler baselines.

MERIDIAN uses this only as motivation for a simple state machine.

## Frozen universe

Exactly:
- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

No asset substitution.

## Public data

Binance Vision monthly archives only:
- Spot 8h trade klines
- USD-M perpetual 8h trade klines
- USD-M realized fundingRate

No authenticated API, private account state or synthetic backfill.

## First independent validation window

V2 does not reuse the seen V1 discovery interval as independent evidence.

Signal warm-up only:
- 2025-08

Independent validation:
- state/return months: 2025-09 through 2026-08 inclusive
- exactly 12 calendar months
- maximum 96 asset-month state slots

Initial state on 2025-09-01:
- all eight assets are **INACTIVE**
- no state is carried forward from the seen V1 discovery interval

This prevents contamination from the already-observed V1 period.

## Direction

The only active direction remains:

- LONG Binance Spot
- SHORT matching Binance USD-M perpetual

No reverse direction.
No long-perp state.
No intramonth direction change.

## Signal

For asset i and state month m:

- p = previous completed calendar month
- `F_p` = sum of all valid realized USD-M funding rates in p

Only `F_p` may determine the state transition at the m boundary.

## Entry rule — unchanged from V1

If state is INACTIVE:

- enter ACTIVE for month m only if `F_p >= 0.00775`
- otherwise remain INACTIVE

The V1 entry threshold is exactly unchanged:
- **0.00775 = 77.5 bps**

No threshold search.

## Persistence / exit rule

If state is already ACTIVE:

- if `F_p > 0`: remain ACTIVE
- if `F_p <= 0`: EXIT and become INACTIVE before taking month-m carry exposure

Thus V2 changes only state persistence after a valid V1-style entry.

No secondary threshold.
No percentile.
No ranking.
No discretionary exception.

## State-transition execution marks

To avoid artificial monthly close/reopen behavior:

At the transition into month m, use the **last valid completed 8h close of prior month p** for both Spot and Perp.

That mark is used for:
- new ENTRY when inactive and `F_p >= 0.00775`;
- EXIT when active and `F_p <= 0`;
- no transaction when active and `F_p > 0`.

The prior-month funding signal is fully observed by this boundary.

Data requirements:
- exact prior-month 8h cadence;
- valid final 8h close inside the frozen boundary lag;
- no nearest-neighbor repair;
- no synthetic marks.

## Position sizing and state persistence

On ENTRY:
- Spot long entry notional = $10,000
- Perp short entry notional = $10,000
- Spot quantity = $10,000 / Spot transition mark
- Perp quantity = -$10,000 / Perp transition mark

Quantities remain fixed through continuation months.

No monthly full close/reopen.
No pyramiding.
No averaging down.
No leverage multiplier.
No dynamic notional compounding.

## Monthly mark-to-market

For each ACTIVE month m:

- month start mark = last valid completed 8h close of prior month p
- month end mark = last valid completed 8h close of month m

For a newly entered state:
- quantities are created at the start mark.

For a continuation state:
- the same quantities remain open.

Monthly Spot price PnL:
- `q_spot × (spot_end - spot_start)`

Monthly Perp price PnL:
- `q_perp × (perp_end - perp_start)`

Combined price/basis PnL:
- Spot PnL + Perp PnL

After an ACTIVE month, the end marks become the next month's start marks.

## Funding PnL convention

To isolate the state-persistence hypothesis from V1's funding model, retain the V1 funding convention:

For every ACTIVE calendar month:
- funding PnL = `$10,000 × sum(realized funding rates in month m)`

Positive funding pays the short.
Negative funding charges the short.

The funding notional convention remains fixed at $10,000 for comparability with V1.

## Transaction costs

Same V1 fee/slippage assumptions.

Spot taker:
- 10 bps/fill

Perp taker:
- 5 bps/fill

Base slippage:
- 3 bps/fill on each venue

Stress:
- +5 bps adverse slippage/fill

### ENTRY transition

Two fills:
- Spot buy
- Perp short

Base ENTRY cost:
- Spot fee $10
- Perp fee $5
- base slippage $6
- total = **$21**

Stress ENTRY cost:
- +$10
- total = **$31**

### EXIT transition

Two fills:
- Spot sell
- Perp buy-to-cover

Base EXIT cost:
- **$21**

Stress EXIT cost:
- **$31**

### Continuation month

If state remains ACTIVE:
- no full monthly roundtrip
- no transition fee
- no transition slippage

## Final forced exit

At the last valid completed 8h close of 2026-08:

- any remaining ACTIVE state is forcibly closed;
- charge full EXIT transition cost;
- no position remains open beyond the validation window.

## Portfolio capital denominator

Dedicated conservative capital per asset opportunity:
- $20,000

Monthly portfolio denominator:
- **$160,000 = 8 × $20,000**

This denominator is used every month regardless of state.

INACTIVE:
- PnL = 0
- capital remains reserved in denominator

This prevents persistence/selectivity from inflating returns through changing capital denominators.

## Data-integrity rules

Signal-month funding:
- finite
- strictly increasing
- no duplicates
- >=60 observations
- max inter-event/boundary gap <=12h

Spot/Perp 8h tapes for every prior/current month needed by state logic:
- finite positive OHLC
- strictly increasing
- no duplicates
- exact 8h cadence
- >=84 rows
- V1/Data-V2 boundary rules
- no interpolation

ACTIVE current-month funding:
- same funding integrity rules

If signal month is invalid:
- state slot is REJECTED, not INACTIVE

If an active month's price/funding data are invalid:
- validation fails closed identically in base/stress

No synthetic reconstruction.

## Metrics

Report:

- 96 state slots
- valid/rejected slots
- active state-months
- inactive state-months
- entry transitions
- exit transitions
- forced terminal exits
- continuation state-months
- assets with >=1 entry
- assets with >=3 active months
- assets with >=1 continuation month
- compounded net return
- net PnL
- funding PnL
- Spot+Perp price/basis PnL
- base modeled transition costs
- stress return
- Profit Factor
- max drawdown
- five chronological-window returns
- per-asset PnL
- positive-PnL asset count
- positive-PnL concentration
- funding/base-cost ratio
- mean active-state duration
- maximum active-state duration

## Frozen independent-validation gate

All must pass:

- exactly **96 state slots**
- zero data-integrity failure
- >= **32 active state-months**
- >= **6 of 8 assets** with at least 3 active months
- >= **6 entry transitions** across the portfolio
- >= **12 continuation state-months**
- >= **4 assets** with at least one continuation month
- compounded net return >0
- net PnL >0
- Profit Factor >= **1.10**
- max drawdown <= **12.5%**
- >= **3 of 5** chronological windows positive
- stress return >0
- funding PnL > base modeled transition costs
- funding/base-cost ratio >= **1.15**
- >= **5 of 8 assets** positive net PnL
- no single positive asset contributes > **45%** of total positive PnL

PASS => `VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

A PASS authorizes only a separate prospective Paper shadow.
It does not authorize live trading.

## Anti-overfitting

- protocol committed before first V2 PnL;
- V1 remains immutable;
- V1 77.5 bps entry threshold is unchanged;
- continuation threshold is exactly >0 and may not change after result;
- no asset removal;
- no state carried from the seen V1 discovery period;
- no direction flip;
- no fee/slippage reduction;
- no monthly full-roundtrip rescue;
- no date movement;
- no losing month removal;
- no gate relaxation;
- no reuse of 2024-10..2025-08 as independent V2 evidence;
- any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation automation, account mutation or automatic promotion.
