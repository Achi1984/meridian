# MERIDIAN v7.55 — Signal Calibration Lab

Generated: 2026-09-02T13:15:40.788Z

Sampling: one candidate per symbol per 4h. Outcome: A_CURRENT normalized R, stop-first same candle, 14d horizon. Portfolio gates intentionally excluded.

## 30 days

### Confidence

| Bucket | Samples | Total R | Avg R | WR | PF |
|---|---:|---:|---:|---:|---:|
| <60 | 1290 | -524.392 | -0.407 | 38.2% | 0.507 |
| 65-69 | 161 | -34.195 | -0.212 | 43.5% | 0.703 |
| >=90 | 151 | -36.386 | -0.241 | 43% | 0.667 |
| 60-64 | 133 | -18.728 | -0.141 | 48.1% | 0.793 |
| 70-74 | 121 | -21.664 | -0.179 | 45.5% | 0.744 |
| 75-79 | 110 | -26.361 | -0.24 | 44.5% | 0.677 |
| 85-89 | 101 | -19.946 | -0.197 | 47.5% | 0.731 |
| 80-84 | 93 | -48.326 | -0.52 | 33.3% | 0.414 |

## 60 days

### Confidence

| Bucket | Samples | Total R | Avg R | WR | PF |
|---|---:|---:|---:|---:|---:|
| <60 | 2593 | -912.36 | -0.352 | 40.2% | 0.555 |
| 65-69 | 330 | -113.955 | -0.345 | 38.5% | 0.558 |
| >=90 | 285 | -79.476 | -0.279 | 41.4% | 0.625 |
| 70-74 | 246 | -81.081 | -0.33 | 39.4% | 0.572 |
| 60-64 | 241 | -59.681 | -0.248 | 43.6% | 0.663 |
| 85-89 | 210 | -51.006 | -0.243 | 44.8% | 0.673 |
| 80-84 | 210 | -72.765 | -0.346 | 40.5% | 0.561 |
| 75-79 | 205 | -26.243 | -0.128 | 48.8% | 0.81 |

## 90 days

### Confidence

| Bucket | Samples | Total R | Avg R | WR | PF |
|---|---:|---:|---:|---:|---:|
| <60 | 3839 | -1199.397 | -0.312 | 40.3% | 0.592 |
| 65-69 | 524 | -168.18 | -0.321 | 38.2% | 0.58 |
| >=90 | 475 | -104.469 | -0.22 | 42.3% | 0.691 |
| 70-74 | 384 | -113.828 | -0.296 | 39.8% | 0.606 |
| 60-64 | 373 | -82.787 | -0.222 | 43.2% | 0.69 |
| 85-89 | 304 | -57.808 | -0.19 | 45.7% | 0.731 |
| 80-84 | 296 | -84.076 | -0.284 | 41.6% | 0.623 |
| 75-79 | 285 | -22.237 | -0.078 | 49.5% | 0.879 |

## Decision-level conclusion

Across 30d, 60d and 90d, every confidence bucket remained negative in normalized R. Higher confidence was not monotonic with better outcomes. The current technical/candidate/distance/regime/status feature stack therefore does not justify another threshold-only Challenger revision. Portfolio-level positive windows must not be mistaken for calibrated signal-level edge because portfolio gates/path dependence can select a favorable subset.

Next research step: inspect raw feature/outcome relationships before defining Challenger V3.2. Preserve soft-scoring philosophy; do not convert this finding into a larger set of hard entry gates.
