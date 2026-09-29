# Spot-Perp Funding Harvest V2 Persistent Carry — Frozen Protocol

Status: **FROZEN BEFORE FIRST V2 PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `SPOT-PERP-FUNDING-HARVEST-V1-FROZEN`
- `SPOT-PERP-FUNDING-HARVEST-V1-DATA-V2-FROZEN`

## Why V2 exists

V1 showed strong net economics, low drawdown, positive stress and 8/8 positive assets, but failed only:
- active-cycle breadth;
- chronological-window breadth.

V1 remains immutable. V2 is not a threshold rescue.

V2 tests a genuinely different state hypothesis:

> after a strong funding month triggers entry, a Spot-long / Perp-short hedge may remain economically useful while the previous completed month's funding remains positive, instead of forcibly closing and reopening every month.

## Frozen universe and data

Exactly:
- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

Public Binance Vision only:
- Spot 8h trade klines
- USD-M perpetual 8h trade klines
- realized fundingRate

No private data, interpolation or synthetic backfill.

## Seen development / independent validation split

### Seen development qualification
- warm-up: 2024-09
- stateful trade months: 2024-10 through 2025-08
- 88 asset-month decision slots

This interval was already observed through V1 and therefore is **not independent evidence**.

A V2 development PASS authorizes only the first independent validation.

### First independent temporal validation
- signal warm-up: 2025-08
- trade months: 2025-09 through 2026-08
- 96 decision slots
- exact same rules and costs
- no retuning

Only an independent validation PASS may authorize a prospective Paper shadow.

## Position direction

Only:
- LONG Spot
- SHORT USD-M perpetual

No reverse direction.

## Entry rule — unchanged from V1

When inactive at the start of trade month m:

- previous completed month funding sum `F_p`
- ENTER only if `F_p >= 0.00775`

The 77.5 bps threshold is unchanged from V1.

## Persistent hold / exit rule

When already active at the start of trade month m:

- if previous-month funding `F_p > 0`: REMAIN ACTIVE
- if `F_p <= 0`: EXIT at the first valid 8h marks of month m and remain flat for the rest of that month

Rationale is structural cash-flow sign:
- positive funding pays a short perp;
- non-positive funding removes the core carry rationale.

No second tuned positive threshold is introduced.

## Re-entry

After any exit:
- strategy remains inactive until a later previous-month funding sum again satisfies the original `>=0.00775` V1 entry threshold.

## Position sizing and state

At ENTER:

- Spot long notional = $10,000
- Perp short notional = $10,000
- Spot quantity fixed from entry price
- Perp quantity fixed from entry price

Across consecutive HOLD months:

- quantities remain unchanged;
- no monthly forced close/reopen;
- no monthly target-notional reset;
- no rebalance trade.

At EXIT:

- both legs are closed at the first valid 8h marks of the exit month.

At the final stage end:

- any still-open position is forcibly closed using the final valid 8h marks of the final trade month;
- exit costs are charged.

## Capital denominator

Conservative reserved capital:
- $20,000 per asset-month opportunity
- fixed eight-asset monthly denominator = $160,000

This applies whether:
- inactive;
- entering;
- holding;
- exiting.

No leverage credit is taken.

## Price PnL while active

Within every month where the position is held:

- Spot PnL = fixed Spot quantity × (month last mark - month first mark)
- Perp PnL = fixed short quantity × (month last mark - month first mark)

This preserves fixed quantities across a persistent streak.

## Funding PnL while active

For each held month:

- approximate monthly short-perp funding notional = absolute fixed perp quantity × first valid Perp price of the month
- funding PnL = monthly perp notional × sum(realized funding rates in the current month)

Observed funding cadence is used exactly as archived.

## Costs

Same frozen Regular-user taker assumptions as V1:

- Spot taker fee: 10 bps/fill
- USD-M Perp taker fee: 5 bps/fill
- base slippage: 3 bps/fill
- stress extra slippage: +5 bps/fill

No VIP/BNB discount.

### Entry cost
Two fills:
- Spot buy
- Perp short

Base entry cost at $10k per leg:
- $21

Stress entry cost:
- $31

### Hold month cost
- $0

### Exit cost
Two fills:
- Spot sell
- Perp buy-to-close

Cost is based on actual exit notional of the fixed quantities.

Base fee/slippage rates are identical to entry.
Stress adds +5 bps/fill.

## Data integrity

Same V1/Data Foundation V2 fail-closed rules.

Previous-month signal funding:
- finite;
- strictly increasing;
- no duplicates;
- >=60 observations;
- max inter-event/boundary gap <=12h.

Current month:
- valid Spot 8h tape;
- valid Perp 8h tape;
- valid realized funding if position is held.

No nearest-neighbor repair.
No synthetic marks.
No synthetic funding.

Invalid required state data => stage data-integrity failure.

## Development metrics

Report:

- 88 decision slots
- exposure months
- entry events
- exit events
- persistent hold months
- average holding streak length
- active months per asset
- compounded return
- net PnL
- funding PnL
- Spot+Perp price/basis PnL
- modeled costs
- Profit Factor
- max drawdown
- 5 chronological-window returns
- stress return
- funding/base-cost ratio
- per-asset PnL
- positive asset count
- positive concentration

## Frozen development gate

All must pass:

- exactly 88 decision slots
- zero data-integrity failure
- >=32 exposure months
- >=8 entry events
- >=6 of 8 assets have >=3 exposure months
- compounded net return >0
- net PnL >0
- Profit Factor >=1.20
- max drawdown <=10%
- >=4 of 5 chronological windows positive
- stress return >0
- funding PnL > modeled base costs
- funding/base-cost ratio >=1.25
- >=6 of 8 assets positive net PnL
- positive-PnL concentration <=40%

PASS => `DEVELOPMENT_PASS_INDEPENDENT_VALIDATION_REQUIRED`

FAIL => `DEVELOPMENT_FAIL_RESEARCH_REDESIGN`

## Frozen independent validation gate

On 2025-09 through 2026-08, unchanged:

- exactly 96 decision slots
- zero data-integrity failure
- >=32 exposure months
- >=8 entry events
- >=6 of 8 assets have >=3 exposure months
- compounded net return >0
- Profit Factor >=1.10
- max drawdown <=12.5%
- >=3 of 5 chronological windows positive
- stress return >0
- funding PnL > modeled base costs
- funding/base-cost ratio >=1.15
- >=5 of 8 assets positive
- positive-PnL concentration <=45%

PASS => `VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

## Anti-overfitting

- V1 remains immutable;
- V2 protocol committed before first V2 PnL;
- 77.5 bps entry threshold unchanged;
- exit condition fixed at previous-month funding <=0;
- no asset removal;
- no rebalancing tweak after results;
- no fee/slippage reduction;
- no date movement;
- no gate relaxation;
- no losing month removal;
- any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, account mutation, leverage automation, liquidation automation or auto-promotion.
