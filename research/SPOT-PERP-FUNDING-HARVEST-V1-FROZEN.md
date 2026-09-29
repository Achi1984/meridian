# Spot-Perp Funding Harvest V1 — Frozen Strategy Protocol

Status: **FROZEN BEFORE FIRST STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `SPOT-PERP-FUNDING-HARVEST-V1-DATA-V2-FROZEN`

## Objective

Test a single-venue, approximately delta-neutral funding-harvest strategy:

- LONG Binance Spot;
- SHORT the matching Binance USD-M perpetual;
- hold only when the previous completed calendar month's realized perpetual funding was high enough to clear conservative round-trip costs with a fixed safety buffer.

This removes cross-venue direction risk and uses only public Binance data.

## Frozen universe

Exactly the eight assets qualified by Data Foundation V2:

- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

No substitutions after results.

## Public data

Binance Vision monthly archives only:

- Spot 8h trade klines
- USD-M perpetual 8h trade klines
- USD-M realized fundingRate

No authenticated API, private account state or synthetic backfill.

## Frozen time split

### Signal warm-up only
- 2024-09
- no strategy PnL counted

### Discovery
- trade months: 2024-10 through 2025-08 inclusive
- 11 completed calendar months
- maximum 88 asset-month decision slots

### Temporal holdout
Authorized only after discovery PASS:
- trade months: 2025-09 through 2026-08 inclusive
- 12 completed months
- maximum 96 decision slots
- no retuning

## Direction

Only one active direction is allowed:

- LONG Spot
- SHORT USD-M perpetual

No reverse trade.
No long-perp state.
No intramonth direction change.

## Pre-trade funding signal

For asset i and trade month m:

- p = previous completed calendar month
- `F_p` = sum of all valid realized Binance funding rates in p

Signal uses only information timestamped in p.

If `F_p` is below the frozen threshold => NO TRADE.

## Frozen cost model

Checked against Binance official fee schedules on 2026-09-29.

Regular-user taker fees modeled conservatively:

- Spot taker fee: **10 bps per fill**
- USD-M futures taker fee: **5 bps per fill**

No BNB discount.
No VIP discount.
No maker rebate.

Base slippage:
- **3 bps per fill** on Spot
- **3 bps per fill** on Perp

One monthly round trip has four fills:
- Spot entry
- Perp entry
- Spot exit
- Perp exit

Per $10,000 notional per leg:

Base cost:
- Spot fees: $20
- Perp fees: $10
- slippage: $12
- total = **$42**

Stress:
- add **5 bps adverse slippage per fill**
- additional $20
- stressed total = **$62**

## Cost-derived funding threshold

Stress breakeven on the $10,000 short-perp leg:

- $62 / $10,000 = 0.0062 = 62 bps

Frozen safety buffer:
- **1.25 × stress breakeven**

Frozen monthly entry threshold:
- **0.00775 = 77.5 bps**

For implementation, threshold is exactly `0.00775`.

No threshold grid is searched.

## Entry rule

At the beginning of month m:

- if previous-month cumulative realized funding `F_p >= 0.00775` => ACTIVE
- otherwise => NO TRADE

The previous month is signal-only.
Current-month funding is PnL-only.

## Position sizing

For every ACTIVE asset-month:

- Spot long notional at entry = **$10,000**
- Perp short notional at entry = **$10,000**
- dedicated conservative capital denominator = **$20,000**

No leverage multiplier.
No notional compounding.
No dynamic resizing.
No pyramiding.
No averaging down.

For NO TRADE:
- PnL = 0
- costs = 0
- the same $20,000 opportunity capital remains in the monthly portfolio denominator.

Monthly portfolio denominator:
- **$160,000 = 8 × $20,000**

This prevents selective inactivity from inflating reported return.

## Monthly entry and exit marks

For Spot and Perp separately:

- entry = first valid 8h close in the trade month;
- exit = last valid 8h close in the trade month;
- boundary lag and cadence must satisfy Data Foundation V2 rules;
- no nearest-neighbor repair;
- no synthetic marks.

## Spot PnL

Spot quantity:
- `q_s = 10000 / spot_entry`

Spot price PnL:
- `q_s × (spot_exit - spot_entry)`

## Perp price PnL

Perp short quantity:
- `q_p = -10000 / perp_entry`

Perp price PnL:
- `q_p × (perp_exit - perp_entry)`

## Funding PnL

For the short perpetual position:

- `funding_pnl = +10000 × sum(realized funding rates in current trade month)`

Observed funding cadence is used exactly as archived.
No fixed 8h cadence is assumed for cash-flow calculation.

Positive funding pays the short.
Negative funding charges the short.

## Combined monthly PnL

For ACTIVE asset-month:

- gross price/basis PnL = Spot price PnL + Perp price PnL
- gross PnL = price/basis PnL + funding PnL
- base net PnL = gross PnL - $42
- stress net PnL = gross PnL - $62

For NO TRADE:
- all PnL fields = 0

## Data-integrity rules

Signal month funding:
- finite rates;
- strictly increasing timestamps;
- no duplicates;
- >=60 observations;
- first/last boundary gap <=12h;
- max inter-event/boundary gap <=12h.

Current trade month funding:
- same funding requirements.

Spot and Perp execution tape:
- finite positive OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 8h cadence;
- >=84 rows;
- month-boundary rules inherited from Data Foundation V2.

Invalid signal month:
- asset-month is REJECTED, not NO TRADE.

Invalid active trade month:
- asset-month is REJECTED from base and stress identically.

No interpolation or synthetic reconstruction.

## Portfolio accounting

Every valid asset-month opportunity contributes $20,000 capital whether ACTIVE or NO TRADE.

Monthly portfolio return:
- sum active net PnL / ($20,000 × number of valid asset opportunities)

Stress return:
- same active/no-trade decisions with stressed cost only.

## Discovery metrics

Report:

- decision slots
- valid slots
- rejected slots
- active cycles
- no-trade cycles
- active rate
- per-asset active cycles
- compounded net return
- net PnL
- funding PnL
- Spot+Perp price/basis PnL
- base modeled costs
- stress return
- Profit Factor
- max drawdown
- 5 chronological-window returns
- per-asset PnL
- positive-PnL asset count
- positive-PnL concentration
- funding/base-cost ratio
- prior-month signal vs current-month realized-funding sign agreement

## Frozen discovery gate

All must pass:

- exactly **88 decision slots**
- zero data-integrity failure
- >= **32 active cycles**
- >= **6 of 8 assets** with at least 2 active cycles
- compounded net return >0
- net PnL >0
- Profit Factor >= **1.20**
- max drawdown <= **10%**
- >= **4 of 5** chronological windows positive
- stress return >0
- funding PnL > base modeled costs
- funding/base-cost ratio >= **1.25**
- >= **6 of 8 assets** positive net PnL
- no single positive asset contributes > **40%** of total positive PnL

PASS => `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`

FAIL => `DISCOVERY_FAIL_RESEARCH_REDESIGN`

## Frozen temporal-holdout gate

If and only if discovery passes, run 2025-09 through 2026-08 unchanged.

All must pass:

- exactly **96 decision slots**
- zero data-integrity failure
- >= **32 active cycles**
- >= **6 of 8 assets** with at least 2 active cycles
- compounded net return >0
- Profit Factor >= **1.10**
- max drawdown <= **12.5%**
- >= **3 of 5** chronological windows positive
- stress return >0
- funding PnL > base modeled costs
- funding/base-cost ratio >= **1.15**
- >= **5 of 8 assets** positive
- positive-PnL concentration <= **45%**

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a holdout PASS does not authorize live trading.

## Anti-overfitting

- protocol committed before first strategy PnL;
- 77.5 bps threshold may not change after results;
- no asset removal;
- no reverse direction;
- no monthly threshold ranking;
- no intramonth timing;
- no fee/slippage reduction;
- no BNB/VIP discount rescue;
- no discovery/holdout date movement;
- no losing month removal;
- no gate relaxation;
- any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage automation, liquidation automation, account mutation or automatic promotion.
