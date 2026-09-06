# MERIDIAN v7.94 — 7-Asset Robustness Gate

Status: RESEARCH ONLY. No promotion, no execution impact, no Pionex changes.

## Locked universe
BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.

## Locked candidate
Hybrid Alpha v7.93, including the predeclared TRANSITION × SHORT risk attenuation of 0.60. No further factor tuning is allowed before this robustness gate is read.

## Evidence gate
Run the existing deterministic Coinbase public 15m harness on 30d / 60d / 90d windows and 4h / 12h / 24h horizons. Primary decision horizon remains 24h. Compare v7.93 with v7.92 and V1 using identical samples, costs and walk-forward segmentation.

## Required evaluation
- PF, expectancy, max drawdown and trade count for 30d / 60d / 90d.
- 3 chronological 90d folds.
- SIDE, REGIME and SYMBOL concentration.
- Asset breadth: the result must not be carried by one or two assets alone.
- No promotion if any material robustness criterion fails.

## Interpretation discipline
Do not tune the 0.60 factor, drop losing assets, add gates, or change thresholds after seeing this run. A failure is evidence, not a prompt to overfit.
