# MERIDIAN v7.85 — Breakout / Expansion Bot V1

Status: **research-only design + historical R2 evidence track**. No Paper/live execution impact.

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

Primary timeframe: **15m**. Higher timeframe trend context uses **1h** as soft evidence.

A valid structural trigger requires a confirmed close outside the previous 20-bar high/low plus a small ATR buffer. This is the only intentional directional hard trigger in V1. The remaining evidence stays soft:

- volatility compression: fast ATR relative to slow ATR
- range expansion: current true range relative to slow ATR
- volume expansion: current volume relative to recent average
- candle decisiveness: body fraction + close location
- trend alignment: EMA20/EMA50 and price/EMA20 context

The score remains transparent: structure 35%, compression 15%, expansion 18%, volume 12%, candle quality 10%, trend 10%.

V1 decisions are `TRADE | OBSERVE | SKIP | WAIT`. Risk suggestions are bounded to 1.00%, 0.50% or 0.25% and are research metadata only.

## Fixed exit geometry

- initial SL: 1.20 ATR from entry
- TP1: 1.50R
- TP2: 2.50R

R2 keeps this geometry fixed for entry attribution instead of tuning entries and exits simultaneously.

## R2 historical evidence protocol — locked before results

- Universe: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ versus USDT.
- Windows: 30d / 60d / 90d.
- Signal cadence: every closed 15m candle.
- Context: 15m structure/expansion plus 1h trend context.
- Outcome horizon: 48 hours after each signal.
- Exit attribution: full TP1 vs SL; timeout at the last available 15m close.
- Same-candle SL + TP1 is conservatively resolved as SL.
- Costs: 5 bps fee per side plus 3 bps slippage per side in normalized-R attribution.
- Chronological stability: five sequential folds for TRADE decisions.
- Required splits: LONG/SHORT and asset.
- No threshold/weight tuning from the R2 run.
- No automatic promotion, even if one window is positive.

## Interpretation rules

A useful candidate needs more than one attractive full-window number. Cross-window expectancy/PF, chronological folds, side balance, asset concentration and trade frequency all matter. A tiny positive subset is a hypothesis, not a bot promotion.

## Promotion gate

No Paper bot until all of the following are true:

1. independent signal family remains independent from Baseline READY;
2. positive OOS expectancy/PF repeats across more than one window;
3. sample size and coverage are useful, not trivial;
4. results are not dominated by one asset or one short period;
5. portfolio-path replay remains acceptable;
6. explicit human approval.

## Planned sequence

- **v7.85 R1** — pure Breakout/Expansion decision engine + deterministic tests — complete/green
- **v7.85 R2** — 12-asset 30/60/90d signal-level evidence with fixed exits — running
- **v7.86** — isolated shadow ledger / portfolio-path replay only if R2 is promising
- **v7.87** — optional retest-entry variant, compared against close-break V1 on identical triggers
- dashboard exposure only after the engine has real telemetry worth displaying
