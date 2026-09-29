# Cross-Venue Funding Spread V1 — Frozen Transfer-Asset Holdout

Status: **FROZEN BEFORE HOLDOUT RESULT**  
Parent discovery: `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`  
Execution impact: **false**  
Auto-promotion: **false**

## Independence boundary

This is a **cross-sectional holdout**. It reuses the frozen venue direction and historical interval but trades a completely disjoint asset universe.

Discovery assets are excluded:
- BTC
- ETH
- SOL

Fixed holdout assets:
- DOGE
- XRP
- LINK
- AVAX

No holdout asset may be removed or replaced after the result is observed.

Because the time period and venues are shared with discovery, a holdout pass is not treated as final live validation. It can only authorize a later prospective Paper-shadow stage.

## Frozen methodology

Exactly preserve the V1 discovery methodology:
- LONG Binance USD-M perpetual
- SHORT Hyperliquid perpetual
- 2023-01-01 UTC through 2026-09-01 UTC
- completed calendar months only
- $10,000 notional per leg
- $20,000 conservative capital denominator per asset cycle
- first valid 8h mark for entry and final valid 8h mark for exit
- fixed base quantity per leg
- Hyperliquid short funding contribution = +$10,000 × realized funding-rate sum
- Binance long funding contribution = -$10,000 × realized funding-rate sum
- basis PnL from fixed entry quantity
- fee 5 bps/fill
- slippage 3 bps/fill
- stress adds 5 bps/fill
- no maker rebates, VIP discounts, collateral yield, leverage credit, funding forecast, timing filter, rotation or stop

## Frozen data gate

Unchanged from discovery:
- cycle duration >= 25 days
- Binance funding observations >= 60/month
- Hyperliquid funding observations >= 500/month
- max Binance funding gap <= 12 hours
- max Hyperliquid funding gap <= 2 hours
- max 8h mark gap <= 16 hours on either venue
- boundary marks within 16 hours
- no synthetic reconstruction

## Frozen holdout acceptance gate

All conditions must pass:
- >= 32 valid asset-month cycles in aggregate
- >= 8 valid cycles for each DOGE, XRP, LINK and AVAX
- aggregate net return > 0
- Profit Factor >= 1.15
- max closed-equity drawdown <= 10%
- >= 4 of 5 chronological windows positive
- DOGE, XRP, LINK and AVAX each have positive net PnL
- no single positive asset contributes > 60% of positive holdout PnL
- aggregate stressed result remains positive under +5 bps/fill
- data gate passes without synthetic reconstruction

## Decision ladder

- FAIL → `HOLDOUT_FAIL_RESEARCH_REDESIGN`; do not rescue V1.
- PASS → `HOLDOUT_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`.

Even a PASS does **not** authorize live execution. The next stage would be a prospective Paper shadow using future observations with no parameter changes.

## Anti-overfitting

- This file is committed before the first holdout run.
- No asset substitution after seeing availability/performance.
- No venue-direction change.
- No cost reduction.
- No gate relaxation.
- No date-window selection.
- No filtering of losing months.
- No smart timing layer may be added to this holdout.

Research only. No order functions and no account credentials.
