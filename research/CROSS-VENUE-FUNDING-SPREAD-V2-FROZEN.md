# Cross-Venue Funding Spread V2 — Frozen Independent Validation Protocol

Status: **FROZEN BEFORE FIRST V2 PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`
- `CROSS-VENUE-FUNDING-SPREAD-V2-DATA-V1-FROZEN`

## Objective

Independently validate the already-motivated static cross-venue funding-spread mechanism on a new, objectively data-qualified universe.

V2 does not tune or rescue V1. It preserves the same economic direction and monthly static holding logic.

External motivation remains Tony Lau (2026), *The Funding Carry and a Cross-Venue Spread on Perpetual Futures*, which reports a persistent Hyperliquid-versus-centralized-venue funding spread and finds that several smarter timing refinements fail to improve the simple static baseline.

## V1 status

V1 is immutable.

It produced:
- positive aggregate discovery on BTC/ETH/SOL;
- positive aggregate transfer economics on DOGE/XRP/LINK/AVAX;
- low drawdown and positive cost stress;
- transfer failure because XRP net PnL was negative under the frozen all-assets-positive gate.

V2 does not remove or reinterpret that failure.

## Frozen V2 universe

Objectively data-qualified before any V2 strategy PnL:

- BNB
- ADA
- DOT
- LTC
- BCH
- TRX
- ETC

XLM remains excluded solely because the preregistered V2 data foundation found no qualifying Hyperliquid funding history in the September-2024 anchor. XLM is not replaced.

No V2 asset may be removed or substituted after results.

## Frozen validation interval

- 2024-09-01 00:00 UTC through 2026-09-01 00:00 UTC
- completed monthly cycles: 2024-09 through 2026-08
- 24 possible cycles per asset
- 168 possible asset-month cycles

No date movement after results.

## Direction — unchanged from V1

For every valid asset-month cycle:

- **LONG Binance USD-M perpetual**
- **SHORT Hyperliquid perpetual**

No post-result direction flip.

## Position model — unchanged from V1

Per valid asset-month:
- $10,000 notional LONG Binance perpetual
- $10,000 notional SHORT Hyperliquid perpetual
- conservative capital denominator: $20,000
- entry at first valid 8h mark near month start
- exit at final valid 8h mark near month end
- fixed base quantity per leg from its own entry mark
- no leverage credit
- no collateral yield
- no intramonth timing
- no stop
- no rotation
- no funding forecast

Each asset-month is an independent research cycle.

## Funding PnL — unchanged

Using realized historical funding:

- Hyperliquid SHORT contribution = +$10,000 × sum(Hyperliquid realized funding)
- Binance LONG contribution = -$10,000 × sum(Binance realized funding)
- net funding = Hyperliquid contribution + Binance contribution

Funding is reported separately from basis and costs.

## Basis PnL — unchanged

At entry:
- Binance base quantity = $10,000 / Binance entry mark
- Hyperliquid base quantity = $10,000 / Hyperliquid entry mark

PnL:
- Binance long basis = q_binance × (exit_binance - entry_binance)
- Hyperliquid short basis = q_hyperliquid × (entry_hyperliquid - exit_hyperliquid)

Cross-venue basis risk is included rather than assumed away.

## Costs — unchanged

Per fill:
- fee = 5 bps
- slippage = 3 bps

Four fills per monthly cycle:
- open + close on two venues
- base modeled cost = $32 per asset-month

Stress:
- +5 bps adverse cost per fill
- stressed cost = $52 per asset-month

No rebates, VIP discounts, maker assumptions or fee-token discounts.

## Full-data gate

The foundation proved broad accessibility only. V2 must fetch and validate the complete strategy interval.

### Binance
Official Binance Vision USD-M:
- fundingRate
- markPriceKlines 8h

Monthly requirements:
- realized funding observations >=60
- max funding gap <=12 hours
- 8h mark max gap <=16 hours
- boundary mark lag <=16 hours

### Hyperliquid
Public info API:
- fundingHistory
- candleSnapshot 8h

Monthly requirements:
- realized funding observations >=500
- max funding gap <=2 hours
- 8h mark max gap <=16 hours
- boundary mark lag <=16 hours

For both venues:
- timestamps strictly increasing
- duplicates fail closed
- finite values required
- cycle duration >=25 days
- no interpolation
- no synthetic reconstruction

Any invalid asset-month is rejected identically in base and stress results.

## Metrics

Report:
- valid/rejected asset-month cycles
- aggregate compounded monthly return
- aggregate net PnL
- Profit Factor
- max closed-equity drawdown
- five chronological-window returns
- funding PnL
- basis PnL
- modeled costs
- stress return
- per-asset cycle count
- per-asset net PnL
- per-asset stressed PnL
- positive-PnL concentration
- data-gap diagnostics

## Frozen independent-validation gate

All must pass:

- >=140 valid asset-month cycles total
- >=20 valid cycles for each of the seven assets
- aggregate net return >0
- Profit Factor >=1.15
- max drawdown <=10%
- >=4 of 5 chronological windows positive
- BNB net PnL >0
- ADA net PnL >0
- DOT net PnL >0
- LTC net PnL >0
- BCH net PnL >0
- TRX net PnL >0
- ETC net PnL >0
- no single positive asset contributes >60% of total positive PnL
- aggregate stress return >0
- no synthetic reconstruction
- no stage-level data-integrity failure

PASS => `VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `VALIDATION_FAIL_RESEARCH_REDESIGN`

A PASS authorizes only a separate prospective Paper-shadow step. It never authorizes live execution.

## Anti-overfitting

- This protocol is committed before the first V2 PnL.
- V1 remains immutable.
- No asset removal after V2 result.
- No XLM replacement.
- No direction flip.
- No date-window change.
- No funding/basis formula change.
- No fee/slippage reduction.
- No gate relaxation.
- No timing filter.
- No asset-specific exception to the all-assets-positive gate.
- Any redesign receives a new ruleset.

## Safety

Research only. No credentials, live orders, leverage, liquidation model, account mutation or automatic promotion.
