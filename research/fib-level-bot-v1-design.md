# MERIDIAN FIB Level Bot V1 — Predeclared Research Design

Status: RESEARCH ONLY — NO PROMOTION — NO EXECUTION IMPACT.

This specification is committed before any V1 evidence run. The bot is a separate research strand and does not modify Hybrid Alpha, Baseline 6.2, Paper/live execution, Pionex bots or `server.js`.

## Hypothesis

A price-only ladder placed on fixed Fibonacci retracement levels of objectively confirmed swings may produce positive expectancy without indicator-based entry confirmation.

## Locked universe and evaluation

- Symbols: BTCUSDT, ETHUSDT, SOLUSDT.
- Timeframes: 15m, 1h, 4h.
- Evidence windows: 90d, 180d, 365d.
- Primary evaluation: 1h / 365d. Other horizons remain required robustness diagnostics.
- Walk-forward: three chronological folds of closed baskets for the primary window.
- Public source: Binance Spot klines.
- Metrics: PF, expectancy in R, net R, max drawdown R, win rate, closed baskets, active/open baskets, setup count, touch/fill rate and time in market.
- Concentration: LONG/SHORT, regime, symbol, first/deepest touched FIB level and chronological fold.
- Sample adequacy: descriptive below 30 closed baskets per aggregate slice and below 12 per cohort.

## Leakage-safe swing construction

- Pivot definition: exactly 3 completed bars left and 3 completed bars right.
- A pivot at bar `i` becomes knowable only after bar `i+3` closes. No earlier decision may use it.
- Confirmed pivots must alternate. A same-type replacement is allowed only when it is more extreme and still untraded.
- A valid impulse leg connects the latest alternating confirmed pivot pair.
- Minimum leg size: 1.50 × ATR(14), measured using information available when the second pivot becomes confirmed.
- ATR is used only to reject micro-swings and normalize comparability. It never confirms an entry or changes a FIB price.
- LONG map: confirmed low → later confirmed higher high.
- SHORT map: confirmed high → later confirmed lower low.
- All FIB prices are frozen at setup creation. They do not repaint.

## Pure FIB ladder

Equal 25% tranches at retracements:

- 0.382
- 0.500
- 0.618
- 0.786

Each level may fill only once per setup.

- Entry trigger: first price touch/cross of the frozen level.
- If a bar gaps beyond a level, fill at the less favorable bar open rather than the untouched limit price.
- No RSI, MACD, EMA, volume, funding, order-flow, candle-pattern or regime gate is allowed.
- Regime is descriptive telemetry only and cannot affect setup, side, entry, sizing or exit.

## Exit and invalidation

- Hard stop/invalidation: frozen 1.000 swing origin.
- TP1: frozen 0.236 level; close 50% of the open basket.
- TP2: frozen 0.000 impulse extreme; close the remainder.
- If stop and target are both reachable inside one candle, apply stop first.
- A same-candle entry and stop is permitted and resolved conservatively at the stop.
- A target cannot be credited on the same candle as a new fill; target processing starts on the next candle. The stop is active immediately.
- After TP1, all still-unfilled ladder levels are cancelled; the remaining open basket alone continues to TP2 or stop.
- Before the first fill, a newer valid confirmed swing may replace the pending map.
- After the first fill, anchors and levels remain frozen until TP2 or stop.
- Open baskets at the evidence cutoff are reported separately and excluded from closed-trade PF/expectancy. No invented terminal mark-to-market exit.

## Costs and accounting

- Fixed round-trip friction: 0.10% of traded notional, charged proportionally on realized exits.
- Basket PnL is normalized by the actual maximum loss from filled tranches to the frozen stop.
- Multiple filled levels form one basket, not independent overlapping trades.
- One active setup/basket per symbol and timeframe.
- Opportunity count must not be inferred from PnL alone: report created setups, filled baskets, closed baskets, unfilled replacements and open baskets.

## Predeclared decision rule

V1 is not promotionsfähig unless the primary 1h/365d result has PF > 1, positive expectancy, tolerable drawdown, both LONG and SHORT are not materially structurally broken, results are not dominated by one asset or one FIB level, and all three chronological folds are credible. Aggregate success with a negative middle fold or inadequate breadth is a failure.

No parameter, pivot width, ATR multiple, level, tranche weight, stop, target, cost, symbol or timeframe may be changed after evidence is observed. Any later variant must be a new predeclared research version.

## Deterministic implementation clarifications locked before evidence

- A pivot high must be strictly higher than all six surrounding comparison highs; a pivot low must be strictly lower than all six surrounding lows.
- Same-type confirmed pivots retain only the more extreme price before an alternating leg is accepted.
- Descriptive regime telemetry uses only information known at setup creation: EMA(50), EMA(200) and ATR(14) of the same symbol/timeframe. RANGE means EMA spread <= 0.50 ATR; otherwise aligned close/EMA structure labels BULL or BEAR, with remaining cases TRANSITION. This label never changes a decision.
- Multi-symbol equity and drawdown are ordered by basket close time.
