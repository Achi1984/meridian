# MERIDIAN v7.102 — Correlation-Cluster Evidence

Status: RESEARCH ONLY — REJECTED — NO PROMOTION.

Initial decision evidence: GitHub Actions `Hybrid Alpha v7.102 Correlation Cluster Evidence` #1.  
Run ID: `34140314419`.  
Artifact: `10025662094`.  
Digest: `sha256:ecfc7272e7a780381e8d6b619d1314a45e4324b38300cb43889a71f007d9b832`.  
Evidence logic head: `9aaf8fb0b3d3cb7fbff82276f19017aaf2f8da79`.  
Comparator: frozen v7.97; primary horizon: 24h.

## Primary result

| Window | PF v7.97 → v7.102 | EXP v7.97 → v7.102 | DD v7.97 → v7.102 | Net-R/DD v7.97 → v7.102 | Trades |
|---|---:|---:|---:|---:|---:|
| 30d | 2.29 → 2.66 | +1.845R → +1.204R | 32.595R → 20.020R | 7.415 → 7.876 | 131 → 131 |
| 60d | 1.29 → 1.48 | +0.513R → +0.410R | 85.043R → 50.561R | 1.648 → 2.213 | 273 → 273 |
| 90d | 1.44 → 1.47 | +0.653R → +0.337R | 99.298R → 58.085R | 2.755 → 2.431 | 419 → 419 |

PF and drawdown improve on every primary window and opportunity count is unchanged. The allocator nevertheless fails the locked decision rule:

- 90d expectancy retains only 51.6% of v7.97, far below the required 80%.
- 60d retention is approximately 79.9%, marginally below the fixed 80% gate.
- 90d Net-R/max-DD declines from 2.755 to 2.431.
- 301/419 trades are still scaled on 90d; average scale is 0.545. This is more selective than v7.101 but still compresses too much edge.

## 90d chronological folds

- Fold 1: PF 1.48, EXP +0.219R, DD 19.803R, n 145.
- Fold 2: PF 0.65, EXP -0.358R, DD 67.429R, n 139.
- Fold 3: PF 2.52, EXP +1.129R, DD 41.928R, n 135.

The persistent negative middle fold is not solved. The allocator reduces loss magnitude but does not create chronological robustness.

## Structure

- LONG: PF 1.95, EXP +0.760R, n 210.
- SHORT: PF 0.86, EXP -0.088R, n 209.
- TRANSITION: PF 1.96, EXP +0.618R, n 201.
- RANGE: PF 0.80, EXP -0.206R, n 57.
- AVAX: PF 0.49, EXP -0.833R, n 47.

These remain descriptive cohorts only. No asset, side or regime becomes a gate.

## Decision

Reject v7.102. Correlation clustering is less destructive than the flat v7.101 cap and improves drawdown, but fails expectancy retention and 90d portfolio efficiency. Do not tune lookback, threshold, coverage, cluster budget or missing-data behavior.

Return strategy-level research to frozen v7.97. No Baseline, Paper/live execution, Pionex, `server.js`, entries, exits, sizing, orders or ledgers changed.
