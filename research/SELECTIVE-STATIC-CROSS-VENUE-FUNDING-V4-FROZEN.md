# Selective Static Cross-Venue Funding V4 — Frozen Independent Validation Protocol

Status: **FROZEN BEFORE FIRST V4 PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`
- `CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN`
- `ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-FROZEN`

## Why V4 exists

Adaptive V3 produced strong discovery economics, but failed its preregistered bidirectional hypothesis gate because 34 of 35 active cycles were LONG Binance / SHORT Hyperliquid and only one cycle used the reverse direction.

V3 remains immutable and receives no holdout.

V4 is a new hypothesis generated from that discovery:

> Trade LONG Binance / SHORT Hyperliquid only when the immediately preceding completed month's realized Hyperliquid-minus-Binance funding differential exceeds the same V3 cost-derived threshold; otherwise remain flat.

This protocol is frozen before any 2025-09 through 2026-08 strategy PnL is read.

## Frozen universe

HBAR, SUI, NEAR, FIL, UNI, AAVE, ATOM, ARB.

No removal or substitution.

## Seen evidence

V3 discovery 2024-10 through 2025-08 is hypothesis-generating only and is not independent V4 evidence.

## First independent validation

Signal warm-up:
- 2025-08 only

Trade months:
- 2025-09 through 2026-08 inclusive
- exactly 96 asset-month decision slots

There is no V4 tuning/discovery stage before this validation.

## Public data

Binance Vision USD-M:
- 8h markPriceKlines
- fundingRate

Hyperliquid public /info:
- 8h candleSnapshot
- fundingHistory

No credentials, wallet state, private API or synthetic backfill.

## Frozen signal

For asset i and trade month m:
- p = immediately preceding completed month;
- B_p = sum realized Binance funding in p;
- H_p = sum realized Hyperliquid funding in p;
- trailingSpread = H_p - B_p.

No current-month funding, price, basis, volatility or other feature enters the signal.

## Frozen direction / no-trade rule

- if trailingSpread >= **0.0078**:
  - LONG Binance
  - SHORT Hyperliquid
- otherwise:
  - NO TRADE

Negative spread never triggers a reverse trade.

## Frozen threshold

Inherited unchanged from V3 and derived before V3 PnL:
- stressed round-trip cost = $52 per active asset-month;
- one-leg notional = $10,000;
- stress breakeven = 0.52%;
- safety factor = 1.50×;
- threshold = **0.78%**.

No threshold search or adjustment.

## Position model

Per active asset-month:
- $10,000 long Binance;
- $10,000 short Hyperliquid;
- $20,000 reserved capital per asset;
- no leverage credit;
- fixed quantity from each venue entry mark;
- no stop, TP, resize or intramonth switch.

Monthly portfolio reserved capital:
- 8 × $20,000 = **$160,000**, regardless of active count.

NO TRADE:
- zero PnL;
- zero cost;
- reserved capital remains in denominator.

## Funding PnL

For active month:

`fundingUsd = $10,000 × (sum(Hyperliquid current-month funding) - sum(Binance current-month funding))`

## Basis PnL

- Binance long quantity = $10,000 / Binance entry mark
- Hyperliquid short quantity = $10,000 / Hyperliquid entry mark

Basis PnL equals Binance long price PnL plus Hyperliquid short price PnL.

## Costs

Base:
- 5 bps fee + 3 bps slippage per fill
- 4 fills
- **$32 per active asset-month**

Stress:
- +5 bps adverse per fill
- **$52 per active asset-month**

NO TRADE pays no trading cost.

## Data integrity

Signal month:
- Binance funding >=60 observations
- Hyperliquid funding >=500 observations
- Binance funding max gap <=12h
- Hyperliquid funding max gap <=2h
- finite rates
- strictly increasing timestamps
- no duplicates

Active trade month additionally:
- current funding passes same rules
- Binance/Hyperliquid 8h mark max gap <=16h
- entry/exit boundary lag <=16h
- active duration >=25 days
- finite positive marks
- no interpolation/reconstruction

Any required-data failure => stage-level `DATA_INTEGRITY_FAILURE`.

## Portfolio accounting

Each of 96 decision slots reserves $20,000.

Monthly return:
- sum active net PnL / $160,000

Stress uses identical decisions with stress costs.

## Metrics

Report:
- decision slots
- active/no-trade cycles
- active cycles by asset
- net return and net PnL
- Profit Factor
- max drawdown
- 5 chronological-window returns
- funding PnL
- basis PnL
- modeled costs
- funding/cost ratio
- stress return
- per-asset attribution
- positive asset count
- positive-PnL concentration
- prior/current spread sign agreement
- mean/median active trailing spread

## Frozen independent-validation gate

All must pass:

- exactly 96 decision slots
- no data-integrity failure
- >=24 active cycles
- >=6 of 8 assets have at least 2 active cycles
- aggregate reserved-capital net return >0
- net PnL >0
- Profit Factor >=1.15
- max drawdown <=8%
- >=3 of 5 chronological windows positive
- total funding PnL >0
- funding-PnL / base-cost ratio >=1.15
- aggregate stress return >0
- >=5 of 8 assets positive
- no single positive asset contributes >50% of total positive PnL

PASS => `VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

A PASS does not authorize live trading.

## Prospective Paper after PASS

Only a separately configured forward Paper shadow:
- no historical backfill into Paper performance;
- same 0.78% threshold;
- same direction;
- same cost model;
- stale data fail closed;
- no automatic live promotion.

## Anti-overfitting

- protocol committed before first V4 PnL;
- V3 remains immutable;
- no threshold change;
- no asset removal;
- no reverse trade added;
- no current-month signal input;
- no basis/volatility filter;
- no cost reduction;
- no date movement;
- no losing month removal;
- no gate relaxation;
- any redesign gets a new ruleset.

## Safety

Research only. No credentials, live orders, leverage credit, liquidation automation, account mutation or automatic live promotion.
