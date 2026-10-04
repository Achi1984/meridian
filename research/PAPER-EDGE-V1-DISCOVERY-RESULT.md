# Paper Edge V1 — Frozen Discovery Result

Valid workflow run: **37232569779**  
Main commit: `a955fadecee8ac911fbecc12136c6a5eed99d50d`  
Evidence artifact: **11314706487**  
Artifact ZIP SHA-256: `01b69adf1192d35ca575a934513edc37f6653ae94b25bc17d683552e1a4f0227`  
Source digest: `d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08`  
Discovery result digest: `82093154584712c37ec0da9faf276f742e29f7e929976609d5e0f33bf258c3c8`

The earlier run from main `eeaac7ba301967c6df0d1b371aa7fbec95674cd8` was explicitly superseded before its PnL result was reviewed because an independent pre-result audit found an open-risk accounting bug. It is not valid V1 evidence and is not used below.

This document records the first valid inspected Discovery result of the already frozen `PAPER-EDGE-V1` ruleset after source, accounting, split isolation, daily-regime preservation and open-risk invariants were fixed and regression-tested before result review.

## Frozen Discovery result

- Common 4h timestamps: **12,594**
- Discovery timestamps: **7,556**
- Closed trades: **163**
- Net PnL on normalized 100,000 USDT research equity: **+$5,860.28**
- Baseline Profit Factor: **1.1426**
- Stress Profit Factor: **1.0493**
- Expectancy: **+0.07395R**
- Max marked-to-market drawdown: **8.6529%**
- Positive chronological windows: **3/5**
- Positive-PnL concentration: **94.83%**
- Data/accounting integrity: **PASS**

### Chronological windows

| Window | Net PnL | Positive |
|---|---:|---|
| 1 | +$5,165.14 | yes |
| 2 | +$1,818.82 | yes |
| 3 | -$3,573.02 | no |
| 4 | -$3,069.91 | no |
| 5 | +$5,519.25 | yes |

### Asset attribution

| Asset | Closed trades | Net PnL | Profit Factor |
|---|---:|---:|---:|
| BTCUSDT | 61 | +$438.35 | 1.0272 |
| ETHUSDT | 48 | -$2,615.79 | 0.8027 |
| SOLUSDT | 54 | +$8,037.72 | 1.6874 |

### Side attribution

| Side | Closed trades | Net PnL | Profit Factor |
|---|---:|---:|---:|
| LONG | 91 | +$7,237.34 | 1.3320 |
| SHORT | 72 | -$1,377.06 | 0.9286 |

## Frozen gate result

**EDGE_V1_DISCOVERY_FAIL**

Failed preregistered gates:

- `PF_LT_1_20`
- `STRESS_PF_LT_1_05`
- `POSITIVE_WINDOWS_LT_4`
- `NEGATIVE_ASSET`
- `CONCENTRATION_GT_50`

Passed gates include aggregate trade count, per-asset trade count, positive expectancy, drawdown <=12%, LONG/SHORT sample minimums, side PF >=0.90, and integrity.

## Decision

Validation is **not authorized**. Holdout remains **locked and untouched**. No Paper shadow or live execution is authorized.

The result is positive in aggregate but not robust enough for the frozen V1 gate. In particular, ETH is negative, two consecutive chronological windows are negative, baseline PF is below the required 1.20, stress PF is marginally below the required 1.05, and SOL supplies almost all positive asset PnL.

## Anti-overfitting lock

Do not:
- remove ETH;
- run SOL-only;
- switch to LONG-only;
- remove or weaken the short side;
- tune ADX/EMA/ATR/trigger thresholds;
- change exits, costs, split boundaries or gates;
- open Validation or Holdout;
- reinterpret the near-miss stress PF;
- rerun V1 as a rescue attempt.

Any successor directional hypothesis requires a newly preregistered ruleset and independent evidence.
