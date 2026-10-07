# MERIDIAN v7.86 — Retest / Hold Breakout V2

Status: **research-only hypothesis + first signal engine**. No Paper/live execution impact.

## Why V2 exists

v7.85 Breakout / Expansion V1 failed broadly across 30/60/90d. The failure was not isolated to one asset, one side or one fold. V2 therefore does **not** tune V1 thresholds. It changes market mechanics.

Hypothesis: the first breakout candle is often too late / too noisy. A better opportunity class may be:

**structure break -> pullback/retest -> level holds -> renewed impulse -> entry**

V1 stays preserved as a negative control.

## Separation

- Baseline `6.2.0 / 6.2-SIGNAL-V1` remains frozen.
- `server.js` remains unchanged.
- no Paper/live execution.
- no Baseline READY dependency.
- no automatic promotion.
- Meta Allocator and v7.79 holdout remain separate.

## V2 sequence

Primary timeframe: 15m. Optional 1h trend context is soft evidence only.

Hard mechanics are intentionally few:
1. confirmed break of prior 20-bar structure with ATR buffer;
2. retest within max 8 bars;
3. no material close back through the broken level;
4. current candle must hold the level for TRADE consideration.

Soft evidence:
- renewed directional impulse/body quality;
- close location;
- volume support;
- 1h trend alignment;
- retest freshness.

No mega-score rescues an invalidated level.

## Fixed initial geometry

- retest tolerance: 0.30 ATR
- max retest wait: 8 x 15m bars
- SL: around 1.0 ATR / beyond held level, whichever is safer
- TP1: 1.50R
- TP2: 2.50R
- risk metadata only: 1.00 / 0.50 / 0.25%

## Research gate

Before any Paper bot:
- deterministic engine tests green;
- 12-asset 30/60/90d historical evidence;
- chronological folds;
- LONG/SHORT and asset attribution;
- positive OOS expectancy/PF in more than one window;
- useful sample/frequency;
- no single-asset domination;
- explicit human approval.

If V2 is also broadly negative, do not threshold-tune it into survival. Preserve the result and move to a different strategy family.
