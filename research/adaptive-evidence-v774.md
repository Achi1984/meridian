# MERIDIAN v7.74 — Adaptive Evidence Lab

## Status

Research-only implementation checkpoint. No Baseline 6.2, Shadow V1, Challenger V2, Regime V1, Paper execution, sizing, risk, exit, ledger or server behavior is changed.

## Purpose

Replace fixed context bonuses and repeated threshold tuning with a reusable evidence layer that scores raw observations from measured normalized-R cohorts and validates them out of sample.

The implementation is intentionally disconnected from Paper execution.

## Core design

### 1. Context observations

`adaptive-evidence.js` derives side-aware observations from signal frames:

- Side: LONG / SHORT
- Regime
- 15m / 1h / 4h alignment count
- Momentum state from RSI + MACD
- Volume participation bucket
- Volatility bucket from ATR / price
- Asset × side
- Baseline status as evidence only

No context combination has a built-in positive bonus. In particular, LONG + RANGE is neutral unless historical evidence supports it.

### 2. Reliability-weighted cohort evidence

Each cohort supplies at minimum `n` and `avgR`, optionally window-level results. The lab:

- shrinks small samples toward zero,
- reduces reliability when window evidence is sparse,
- rewards cross-window sign agreement,
- caps extreme edge estimates,
- aggregates available dimensions by measured reliability.

Missing evidence is neutral rather than a reason to add another hard gate.

`evaluateAdaptiveObservations()` lets historical cohort rows be scored directly without reconstructing a signal and is used by walk-forward validation.

### 3. Portfolio-independent normalized-R cohorts

`adaptive-evidence-cohorts.js` builds signal cohorts from prepared research events using the existing `A_CURRENT` Exit Lab outcome model.

Method guards:

- default sampling cadence is one signal per symbol per 4h,
- only candles strictly after the signal timestamp are replayed,
- default outcome horizon is 14 days,
- no max-position, daily-loss, drawdown or other portfolio-path gate is applied,
- exact evidence dimensions match the Adaptive Evidence evaluator,
- cohort tables include n, avg/median R, win rate, positive/negative R totals and per-window avgR.

This keeps signal-quality calibration separate from portfolio-path selection.

### 4. Leakage-safe walk-forward validation

`adaptive-evidence-walkforward.js` adds expanding-window validation. For every out-of-sample slice:

- training observations must end strictly before the test slice begins,
- an overlap guard throws on training/test leakage,
- evidence maps are built only from prior observations,
- test signals are classified as TRADE / CAUTION / NEUTRAL / SKIP / OBSERVE,
- selected and all-opportunity R statistics are retained separately.

This is the required bridge between feature attribution and a future Challenger V3.2 portfolio replay.

### 5. Market Capture / Opportunity Cost

`summarizeMarketCapture()` measures:

- opportunity coverage,
- realized normalized R,
- positive opportunity R,
- captured positive R,
- market-capture percentage,
- missed-winner R,
- avoided-loser R,
- net opportunity cost of skipped signals.

This prevents a low-drawdown / low-frequency model from looking superior merely because it stopped trading.

## Tests added

The v7.74 research tests verify:

- side-aware raw observations,
- small-sample shrinkage,
- no built-in LONG + RANGE bonus,
- learned positive/negative context behavior,
- market-capture accounting,
- strict post-entry candle replay,
- 4h signal sampling cadence,
- exact evidence-map dimensions,
- LONG/SHORT cohort separation,
- explicit train/test leakage rejection,
- expanding walk-forward train-before-test ordering.

GitHub Release Safety passed on the cohort-builder checkpoint commit `458b52e4ade75ba83916b45f6954449bc3a0d1ea`.

## Next implementation step

Add a reproducible report/orchestration layer that consumes prepared MERIDIAN research events and produces 30d / 60d / 90d cohort maps plus expanding walk-forward results in JSON/Markdown. The report must surface feature stability, sample adequacy, Market Capture and opportunity cost before any V3.2 portfolio behavior is written.

Do not promote Challenger V3.2 until the evidence table demonstrates stable predictive relationships, adequate samples, acceptable opportunity coverage and out-of-sample behavior.
