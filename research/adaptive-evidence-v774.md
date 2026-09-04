# MERIDIAN v7.74 — Adaptive Evidence Lab

## Status

Research-only implementation and evidence checkpoint. No Baseline 6.2, Shadow V1, Challenger V2, Regime V1, Paper execution, sizing, risk, exit, ledger or server behavior is changed.

The first real 12-asset calibration run is complete. **Adaptive Evidence V1 does not show positive predictive signal-level edge and must not be promoted.**

## Purpose

Replace fixed context bonuses and repeated threshold tuning with a reusable evidence layer that scores raw observations from measured normalized-R cohorts and validates them out of sample.

The implementation is intentionally disconnected from Paper execution.

## Implemented pipeline

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

No context combination has a built-in positive bonus. In particular, LONG + RANGE is neutral unless measured evidence supports it.

### 2. Reliability-weighted evidence

Each cohort supplies `n`, `avgR` and window-level stability. The lab shrinks small samples toward zero, reduces reliability when evidence is sparse, uses cross-window sign agreement, caps extreme estimates and aggregates available evidence by measured reliability.

Missing evidence is neutral rather than another hard gate.

### 3. Portfolio-independent cohorts

`adaptive-evidence-cohorts.js` builds normalized-R signal cohorts using the existing `A_CURRENT` Exit Lab outcome model.

Method guards:

- one signal per symbol per 4h by default,
- only candles strictly after the signal timestamp are replayed,
- 14-day full outcome horizon,
- right-censored recent signals excluded,
- no max-position, daily-loss, drawdown or other portfolio-path gate,
- exact dimensions match the evaluator.

### 4. Leakage-safe walk-forward

`adaptive-evidence-walkforward.js` uses expanding train-before-test validation. Training observations must end strictly before each evaluated slice begins. An explicit overlap guard rejects leakage.

### 5. Canonical research source

`adaptive-evidence-source.js` loads 15m / 1h / 4h public Binance data and delegates final candidate construction to the canonical `cloud-backtest.js` candidate function. It includes a public market-data fallback for geo-blocked runners.

### 6. Reproducible reporting

`adaptive-evidence-report.js` builds one master cohort anchored to the widest requested window and slices that same cohort for 30d / 60d / 90d. This avoids changing the 4h sampling phase between comparison windows.

The dedicated GitHub Actions workflow `MERIDIAN Adaptive Evidence Research` runs the 12-asset report and stores the full JSON/Markdown evidence as an artifact.

## Real 12-asset evidence

Definitive run:

- GitHub Actions run id: `33911834647`
- Source commit: `37e569f5d03ea579126017f10fabe5f2d69eeb6b`
- Artifact id: `9951674418`
- Artifact SHA-256: `9c2066fa4d5ef2da6bbd342d553f08b306c3f6e64323cf9d47ddc0b1db2010c4`
- Assets: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ
- Master cohort: 6,480 signals
- Method: portfolio-independent, one signal/symbol/4h, A_CURRENT/full TP1, 14-day full horizon, expanding OOS.

| Window | Signals | Avg R | Win rate | OOS selected | Selected Avg R | Selected PF | Coverage | Market Capture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30d | 2,160 | -0.403R | 39.7% | 0 | — | 0 | 0.0% | 0.0% |
| 60d | 4,320 | -0.314R | 41.3% | 3 | -1.133R | 0 | 0.1% | 0.0% |
| 90d | 6,480 | -0.270R | 41.7% | 397 | -0.203R | 0.711 | 7.7% | 8.4% |

The master 90d cohort has avg -0.2697R, median -1.1296R and total -1747.3782R. LONG averages -0.3006R and SHORT -0.2440R.

A recurring positive marginal candidate, `LONG | NORMAL volatility`, appears in 30d and 60d but does not remain a strong positive feature in 90d. The strongest 90d positive marginal estimate is effectively neutral. Most reliable marginal buckets are negative.

Full concise evidence is preserved in `research/adaptive-evidence-live-v774.md`; the large raw JSON remains in the GitHub Actions artifact rather than the repository.

## Interpretation

The result is useful precisely because it is negative:

- do not lower thresholds to create trades,
- do not promote Challenger V3.2,
- do not convert negative marginal buckets directly into more hard gates,
- the broad sampled universe itself has negative expectancy under A_CURRENT,
- the current marginal aggregator may double-count correlated base-rate effects.

The next research step should test **predefined contextual interactions and hierarchical/base-rate-centered residual evidence**, with stronger sample-size guards, shrinkage and the same strict walk-forward methodology.

Candidate interactions:

- side × regime × MTF alignment
- side × regime × momentum
- side × regime × volatility
- asset × side × regime
- side × MTF alignment × momentum
- volume × volatility where samples are adequate

## Promotion status

**NO PROMOTION.** Adaptive Evidence V1 remains research infrastructure and a negative-evidence checkpoint. Challenger V3.2 portfolio behavior must not be implemented until a revised signal model demonstrates repeatable positive out-of-sample edge with acceptable opportunity coverage.
