# MERIDIAN v7.61 — Raw Feature Edge Map / Feature Attribution Lab

Status: research-only infrastructure implemented. Baseline 6.2 and Paper execution are unchanged.

## Purpose

The v7.55 Signal Calibration Lab showed that the existing compressed confidence stack was not calibrated: all confidence buckets were negative across 30d/60d/90d and higher confidence was not monotonic with better normalized R. v7.61 therefore moves one level lower and measures raw observations directly before any Challenger V3.2 scoring model is defined.

## Implemented

- `feature-attribution.js`
  - side-aware raw feature extraction
  - 15m/1h/4h directional alignment
  - MACD agreement across timeframes
  - ADX buckets
  - RSI buckets
  - volume participation buckets
  - EMA20/EMA50 structure by final side
  - price-vs-EMA20 alignment
  - 15m price-to-EMA20 distance normalized by ATR
  - side × regime
  - Baseline status retained as evidence only
  - normalized-R bucket summaries with sample count, total R, average R, win rate and PF
  - minimum-sample adequacy flag
  - cross-window direction stability for 30d/60d/90d
- `scripts/feature-edge-map.mjs`
  - offline JSON cohort runner
  - accepts one or more 30d/60d/90d raw cohorts
  - emits machine-readable feature maps and stability report
- `test/feature-attribution.test.js`
  - verifies side-aware interpretation
  - verifies bucket aggregation
  - verifies cross-window stability handling

## Method constraints

1. Cohorts must remain portfolio-independent. Max-open-position, daily-loss, drawdown and other portfolio path gates are excluded from signal-quality attribution.
2. Outcome remains normalized R using the same A_CURRENT convention used by Signal Calibration unless a separately named experiment changes that convention.
3. No single winning bucket is enough. Evidence should have adequate sample size and repeat across windows, assets and regimes where possible.
4. A weak bucket is not automatically converted into a hard entry gate. The goal is calibrated soft evidence.
5. LONG and SHORT features are interpreted relative to the final trade side; SHORT must not reuse LONG-direction semantics.

## Next execution step

Generate/export raw portfolio-independent signal cohorts containing the original 15m/1h/4h frame metrics and normalized outcomes for 30d, 60d and 90d, then run:

`node scripts/feature-edge-map.mjs --30 <30d.json> --60 <60d.json> --90 <90d.json> --out <report.json>`

Only after the resulting feature map identifies repeatable signal-level relationships should Challenger V3.2 weights or architecture be proposed.
