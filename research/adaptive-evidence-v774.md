# MERIDIAN v7.74 — Adaptive Evidence Lab

## Status

Research-only implementation checkpoint. No Baseline 6.2, Shadow V1, Challenger V2, Regime V1, Paper execution, sizing, risk, exit, ledger or server behavior is changed.

## Purpose

Replace fixed context bonuses and repeated threshold tuning with a reusable evidence layer that scores raw observations from measured normalized-R cohorts.

The implementation lives in `adaptive-evidence.js` and is intentionally disconnected from Paper execution.

## Core design

### 1. Context observations

The lab derives side-aware observations from signal frames:

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

### 3. Research classification

The output is `TRADE`, `CAUTION`, `NEUTRAL`, `SKIP`, or `OBSERVE`, plus estimated edge-R, reliability, confidence and component attribution.

These labels are research annotations only. They do not open positions.

### 4. Market Capture / Opportunity Cost

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

`test/adaptive-evidence.test.js` verifies:

1. side-aware raw observations,
2. small-sample shrinkage,
3. no built-in LONG + RANGE bonus,
4. positive learned context can support a research TRADE label,
5. negative learned context can support a research SKIP label,
6. market capture exposes missed winners and avoided losers.

## Next implementation step

Build the historical cohort generator that feeds this module with normalized-R feature tables across 30d / 60d / 90d plus walk-forward windows. The generator must be portfolio-independent first, then portfolio replay can evaluate path effects separately.

Do not promote Challenger V3.2 until the evidence table demonstrates stable predictive relationships and acceptable opportunity coverage.
