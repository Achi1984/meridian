# Adaptive Cross-Venue Funding Spread V3 — Frozen Discovery / Holdout Protocol

Status: **FROZEN BEFORE FIRST V3 PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`
- `CROSS-VENUE-FUNDING-SPREAD-V2-FROZEN`
- `ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-DATA-V1-FROZEN`

## Objective

Test one narrowly defined successor hypothesis:

> Cross-venue funding dispersion may remain economically useful when venue direction is chosen only from the immediately preceding completed month's realized funding differential, and the strategy stays flat when the observed spread does not exceed a cost-derived safety threshold.

V3 is not a retuning of V2. V2's fixed direction is immutable and failed independent validation.

## External motivation fixed before results

- Lau (2026), *The Funding Carry and a Cross-Venue Spread on Perpetual Futures*: cross-venue CEX/Hyperliquid funding dispersion can be structural, while several smarter timing refinements fail out of sample.
- Pindza (2026), *Centralized–decentralized exchange funding rate arbitrage as a basis trade*: funding spread is time-varying and must be evaluated jointly with basis and execution friction.
- Binance and Hyperliquid official funding documentation define venue-specific realized funding cash flows and different settlement cadences.

MERIDIAN treats these sources as motivation only. V3 does not claim exact replication.

## Frozen qualified universe

From the 8/8 full-history foundation pass:

- HBAR
- SUI
- NEAR
- FIL
- UNI
- AAVE
- ATOM
- ARB

No asset may be removed, replaced or substituted after PnL is observed.

## Frozen raw interval

- 2024-09-01 00:00 UTC through 2026-09-01 00:00 UTC
- completed calendar months 2024-09 through 2026-08

September 2024 is **signal warm-up only** and may not contribute strategy PnL.

## Discovery and holdout

### Discovery

Trade months:
- 2024-10 through 2025-08 inclusive
- 11 completed calendar months
- 88 possible asset-month decision slots

### Temporal holdout

Allowed only after discovery passes:
- 2025-09 through 2026-08 inclusive
- 12 completed calendar months
- 96 possible asset-month decision slots
- exact same signal, costs, threshold and gates except the separately frozen holdout thresholds below
- no retuning

A holdout PASS may authorize only a later prospective Paper shadow.

## Public data

### Binance
Official Binance Vision USD-M monthly archives:
- 8h `markPriceKlines`
- `fundingRate`

### Hyperliquid
Public `/info` API:
- `candleSnapshot` 8h
- `fundingHistory`

No credentials, account data or private endpoints.

## Pre-trade signal

For asset i and trade month m:

1. use **only the immediately preceding completed calendar month m-1**;
2. sum all realized Hyperliquid funding rates in m-1;
3. sum all realized Binance funding rates in m-1;
4. compute

`trailingSpread = sum(Hyperliquid funding) - sum(Binance funding)`

No current-month funding, mark movement, future data, volatility, open interest, price trend, basis filter or other variable enters the signal.

### Direction

If `trailingSpread > 0`:
- LONG Binance USD-M perpetual
- SHORT Hyperliquid perpetual

If `trailingSpread < 0`:
- SHORT Binance USD-M perpetual
- LONG Hyperliquid perpetual

The direction is fixed for the entire current calendar month.

No intramonth reversal.

## No-trade threshold — cost-derived, not optimized

V1/V2 frozen execution assumptions:

- notional per leg = $10,000
- 4 fills per round trip
- fee = 5 bps per fill
- base slippage = 3 bps per fill
- stress adds +5 bps per fill

Therefore stressed round-trip execution cost is:

- 13 bps × 4 × $10,000 = **$52**
- expressed against one-leg notional: **0.52%**

V3 safety factor is frozen at **1.50× stressed break-even**.

Thus:

`NO_TRADE_THRESHOLD = 0.52% × 1.50 = 0.78%`

Decision:
- if `abs(trailingSpread) < 0.0078` => **NO TRADE**
- otherwise take the direction defined above

The 0.78% threshold is derived only from previously frozen stress costs. It is not selected from V3 PnL.

## Position model

Per active asset-month:

- $10,000 notional on Binance
- $10,000 notional on Hyperliquid
- conservative reserved capital = $20,000 per asset
- no leverage credit
- no collateral yield
- entry at first valid 8h mark near current-month start
- exit at final valid 8h mark near current-month end
- each leg's base quantity fixed from its own entry mark
- no stop
- no TP
- no rotation
- no position resize
- no funding forecast beyond the prior-month signal

## Portfolio capital treatment

Every one of the eight frozen assets reserves $20,000 of strategy capital each calendar month whether it trades or not.

Therefore monthly strategy capital denominator is always:

- 8 × $20,000 = **$160,000**

A NO-TRADE asset contributes:
- zero PnL;
- zero cost;
- zero return contribution;
- but its reserved capital remains in the portfolio denominator.

This prevents sparse trading from artificially inflating reported returns.

## Funding PnL

Define direction `d`:

- `d = +1` for LONG Binance / SHORT Hyperliquid
- `d = -1` for SHORT Binance / LONG Hyperliquid

For the current trade month:

`fundingUsd = d × $10,000 × (sum(Hyperliquid funding) - sum(Binance funding))`

Funding is reported separately.

## Basis PnL

Let the V1/V2 long-Binance/short-Hyperliquid basis result be:

`basisBase = qB × (B_exit - B_entry) + qH × (H_entry - H_exit)`

V3 basis:

`basisUsd = d × basisBase`

Thus reversing the funding direction also reverses the two price legs.

Basis PnL is never assumed away.

## Costs

Base:
- 5 bps fee + 3 bps slippage per fill
- 4 fills
- **$32 per active asset-month**

Stress:
- +5 bps adverse per fill
- **$52 per active asset-month**

NO-TRADE slots pay no trading cost.

No maker rebate, VIP discount, fee-token discount or transfer-income assumption.

## Full-data gate

For every signal month and active trade month:

### Binance
- prior-month realized funding observations >=60
- active-month realized funding observations >=60
- funding max gap <=12 hours
- 8h mark max gap <=16 hours
- entry/exit boundary lag <=16 hours

### Hyperliquid
- prior-month realized funding observations >=500
- active-month realized funding observations >=500
- funding max gap <=2 hours
- 8h mark max gap <=16 hours
- entry/exit boundary lag <=16 hours

For both venues:
- timestamps strictly increasing
- duplicates fail closed
- finite rates/marks
- active cycle duration >=25 days
- no interpolation
- no synthetic reconstruction

Because the foundation passed full-history coverage, any missing required signal/holding input in a gating stage is a **stage-level data-integrity failure**, not a selectively rejected losing cycle.

## Metrics

Report separately for discovery and holdout:

- 88/96 total decision slots
- active cycles
- NO-TRADE cycles
- active cycles by asset
- direction counts: Binance-long vs Hyperliquid-long
- aggregate reserved-capital compounded return
- net PnL
- Profit Factor on monthly reserved-capital returns
- max closed-equity drawdown
- five chronological-window returns
- funding PnL
- basis PnL
- modeled costs
- funding-PnL / base-cost ratio
- stress return
- per-asset net/stress/funding/basis PnL
- positive-PnL active assets
- positive-PnL concentration
- prior-spread sign agreement with current realized spread
- mean and median absolute trailing spread
- mean and median active trailing spread

## Frozen discovery gate

All must pass:

- exactly 88 decision slots represented
- no stage-level data-integrity failure
- >=32 active asset-month cycles
- >=6 of 8 assets have at least 2 active cycles
- aggregate reserved-capital net return >0
- Profit Factor >=1.20
- max drawdown <=8%
- >=4 of 5 chronological windows positive
- total funding PnL >0
- funding-PnL / base-cost ratio >=1.25
- aggregate stress return >0
- >=5 of 8 assets have positive net PnL across their active cycles
- no single positive asset contributes >50% of total positive PnL

PASS => `DISCOVERY_PASS_TEMPORAL_HOLDOUT_REQUIRED`

FAIL => `DISCOVERY_FAIL_RESEARCH_REDESIGN`

No discovery result may directly authorize Paper trading.

## Frozen temporal-holdout gate

With zero rule changes:

- exactly 96 decision slots represented
- no stage-level data-integrity failure
- >=32 active asset-month cycles
- >=6 of 8 assets have at least 2 active cycles
- aggregate reserved-capital net return >0
- Profit Factor >=1.15
- max drawdown <=8%
- >=3 of 5 chronological windows positive
- total funding PnL >0
- funding-PnL / base-cost ratio >=1.15
- aggregate stress return >0
- >=5 of 8 assets have positive net PnL
- no single positive asset contributes >50% of total positive PnL

PASS => `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `HOLDOUT_FAIL_RESEARCH_REDESIGN`

Even a PASS does not authorize live execution.

## Anti-overfitting

- This protocol is committed before first V3 PnL.
- V1 and V2 remain immutable.
- No asset removal or substitution.
- No threshold search.
- No alternate lookback.
- No signal blending.
- No basis filter.
- No volatility filter.
- No current-month funding in the signal.
- No intramonth switching.
- No leverage optimization.
- No fee/slippage reduction.
- No date movement.
- No gate relaxation.
- No post-result direction exception.
- Any redesign gets a new ruleset.

## Safety

Research only. No credentials, live orders, account mutation, leverage credit, liquidation automation or automatic Paper/live promotion.
