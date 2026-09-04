# MERIDIAN v7.74 — Adaptive Evidence Live Evidence

## Status

**Research-only negative evidence checkpoint. No promotion. No Paper/live execution change.**

This report preserves the first real 12-asset Adaptive Evidence run generated from public Binance 15m/1h/4h market data through the MERIDIAN research candidate source.

## Provenance

- GitHub Actions workflow: `MERIDIAN Adaptive Evidence Research`
- Definitive run: `#2` / run id `33911834647`
- Source commit: `37e569f5d03ea579126017f10fabe5f2d69eeb6b`
- Artifact: `meridian-adaptive-evidence-v774`
- Artifact id: `9951674418`
- Artifact SHA-256: `9c2066fa4d5ef2da6bbd342d553f08b306c3f6e64323cf9d47ddc0b1db2010c4`
- Raw artifact contains the full JSON and Markdown report and is retained by GitHub Actions; the 48 MB raw JSON is intentionally not committed to the repository.

## Method

- Assets: BTC, ETH, SOL, XRP, ADA, SUI, HBAR, AVAX, NEAR, DOT, FET, INJ
- Sampling: one signal per symbol per 4h
- One master cohort is anchored across the widest comparison interval, so 30d / 60d / 90d use the same sampling phase.
- Master signal interval: 2026-05-23 19:34 UTC through 2026-08-21 19:34 UTC
- Market-data end: 2026-09-04 19:34 UTC
- Outcome horizon: 14 days
- Outcome model: `A_CURRENT` / full TP1
- Portfolio gates excluded from signal calibration
- Walk-forward: expanding train strictly before test
- Recent signals without a complete 14-day horizon are excluded.

## Main result

The current Adaptive Evidence V1 **does not establish positive predictive signal-level edge**. The broad master cohort is negative, marginal one-dimensional evidence is predominantly negative, and the out-of-sample selector does not produce a profitable selected cohort.

| Window | Signals | Avg R | Win rate | OOS selected | Selected Avg R | Selected PF | Coverage | Market Capture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30d | 2,160 | -0.403R | 39.7% | 0 | — | 0 | 0.0% | 0.0% |
| 60d | 4,320 | -0.314R | 41.3% | 3 | -1.133R | 0 | 0.1% | 0.0% |
| 90d | 6,480 | -0.270R | 41.7% | 397 | -0.203R | 0.711 | 7.7% | 8.4% |

### Master 90-day cohort

- Signals: 6,480
- Average R: -0.2697R
- Median R: -1.1296R
- Win rate: 41.74%
- Total R: -1747.3782R
- LONG: 2,939 signals, avg -0.3006R, win rate 40.59%
- SHORT: 3,541 signals, avg -0.2440R, win rate 42.70%

## Opportunity cost / market capture

### 30d
- Missed winners: 714.008R
- Avoided losers: 1457.902R
- Net skipped-opportunity metric: -743.894R

### 60d
- Missed winners: 1511.207R
- Avoided losers: 2750.239R
- Net skipped-opportunity metric: -1239.032R

### 90d
- Positive opportunity R: 2351.745R
- Captured positive R: 197.693R
- Missed winners: 2154.052R
- Avoided losers: 3703.282R
- Net skipped-opportunity metric: -1549.230R

The negative skipped-opportunity metric means the skipped universe lost more R than the winners that were missed. It **does not** mean the Adaptive Evidence selector is profitable: selected OOS expectancy remains negative and coverage is very low.

## Feature findings

A recurring marginal candidate was `LONG | NORMAL volatility`:
- 30d: n=71, avg +0.586R, reliability 66.7%, estimated shrunk edge +0.233R
- 60d: n=143, avg +0.186R, reliability 60.0%, estimated shrunk edge +0.084R
- 90d: it does not remain a leading positive feature.

At 90d the strongest positive marginal feature is only `SHORT | NORMAL volatility` with an estimated edge of about +0.002R, effectively neutral.

Several large-sample negative marginals are stable enough to be noteworthy, including BTC LONG, LONG in BEAR, LONG NO_SETUP, LONG STRONG momentum, LONG MTF=1, SHORT MTF=0 and LONG RANGE. These are observations for attribution, **not automatic hard filters**.

## Research interpretation

1. Do **not** lower Adaptive Evidence thresholds to manufacture trade frequency.
2. Do **not** promote Challenger V3.2 from this evidence.
3. The broad 4h-sampled candidate universe itself has negative expectancy under the current A_CURRENT outcome model.
4. Marginal evidence alone is insufficient. The next research axis should test predefined contextual interactions such as:
   - side × regime × MTF alignment
   - side × regime × momentum
   - side × regime × volatility
   - asset × side × regime
   - side × MTF alignment × momentum
   - volume × volatility where sample size permits
5. Interaction research must use stronger sample-size guards, shrinkage and the same strict train-before-test validation to avoid fragmentation/overfitting.
6. The current evaluator combines correlated marginals and may double-count a common negative base rate. A future model should test hierarchical or base-rate-centered **residual evidence** rather than simply summing raw marginal avgR estimates.

## Decision

Adaptive Evidence V1 is retained as a useful research infrastructure and negative-evidence checkpoint, but its current signal selector is **not a promotion candidate**. The next implementation should be a Context Interaction / Hierarchical Evidence Lab, still research-only and still disconnected from Baseline 6.2 and Paper execution.
