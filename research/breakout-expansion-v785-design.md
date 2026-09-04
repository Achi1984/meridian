# MERIDIAN v7.85 — Breakout / Expansion Bot V1

Status: **research-only design + first pure signal engine**. No Paper/live execution impact.

## Why this bot exists

The existing Baseline/Shadow/Challenger/Regime family shares substantial technical ancestry. v7.85 intentionally tests a different source of edge: structural breakouts after volatility compression followed by measurable expansion.

The hypothesis is not that another confidence score will rescue the same opportunity set. The hypothesis is that a dedicated expansion strategy can discover a different opportunity class.

## Non-negotiable separation

- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- `server.js` stays unchanged.
- no Paper/live order execution.
- no dependency on Baseline `READY`.
- no auto-promotion.
- Meta Allocator and v7.79 prospective holdout remain separate research tracks.

## V1 signal anatomy

Primary timeframe: **15m**. Higher timeframe trend context may use **1h** as soft evidence.

A valid structural trigger requires a confirmed close outside the previous 20-bar high/low plus a small ATR buffer. This is the only intentional directional hard trigger in V1. The remaining evidence stays soft:

- volatility compression: fast ATR relative to slow ATR
- range expansion: current true range relative to slow ATR
- volume expansion: current volume relative to recent average
- candle decisiveness: body fraction + close location
- trend alignment: EMA20/EMA50 and price/EMA20 context

The score is deliberately transparent rather than an opaque model:

- structure 35%
- compression 15%
- expansion 18%
- volume 12%
- candle quality 10%
- trend 10%

V1 decisions are `TRADE | OBSERVE | SKIP | WAIT`. Risk suggestions are bounded to 1.00%, 0.50% or 0.25% and are research metadata only.

## Initial exit geometry

V1 fixes the exit geometry for attribution instead of optimizing entries and exits simultaneously:

- initial SL: 1.20 ATR from entry
- TP1: 1.50R
- TP2: 2.50R

This is not a promotion recommendation. Exit tuning belongs in a later isolated experiment if the entry family first shows positive OOS expectancy.

## What we must measure

The first evidence run must compare Breakout V1 against the same 12-asset historical universe and chronologically separated windows. Required outputs:

- trade count / frequency
- total and average normalized R
- PF and win rate
- max drawdown on an isolated research ledger
- LONG/SHORT split
- regime split
- asset concentration
- compression/expansion/volume cohort attribution
- Market Capture and missed-winner / avoided-loser R where a comparable opportunity pool exists
- walk-forward OOS stability

A lower drawdown caused only by very low trade count is not sufficient.

## Promotion gate

No Paper bot until all of the following are true:

1. independent signal family remains independent from Baseline READY;
2. positive OOS expectancy/PF repeats across more than one window;
3. sample size and coverage are useful, not trivial;
4. results are not dominated by one asset or one short period;
5. portfolio-path replay remains acceptable;
6. explicit human approval.

## Planned sequence

- **v7.85 R1** — pure Breakout/Expansion decision engine + deterministic tests (current checkpoint)
- **v7.85 R2** — historical 12-asset signal-level evidence, fixed exits
- **v7.86** — isolated shadow ledger / portfolio-path replay only if R2 is promising
- **v7.87** — optional retest-entry variant, compared against close-break V1 on identical triggers
- dashboard exposure only after the engine has real telemetry worth displaying
