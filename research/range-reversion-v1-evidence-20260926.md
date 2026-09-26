# MERIDIAN — Range Reversion V1 evidence

Status: REJECTED / NO PAPER SHADOW  
Valid evidence run: GitHub Actions 36264892871  
Artifact: 10913590942  
Artifact SHA256: `3c30a103ee5b41eacff1445f05b8765051b535ee1afff5c5d7d49d78fbe3b937`

## Primary 2022-09-06 → 2024-09-06

- 569 closed trades
- PF 0.89
- expectancy -0.054R
- net -30.514R
- max DD 51.339R

Folds:
1. PF 1.05 / +0.021R
2. PF 1.10 / +0.046R
3. PF 0.76 / -0.124R
4. PF 0.69 / -0.168R

Sides:
- LONG: PF 0.81 / -0.095R
- SHORT: PF 0.97 / -0.013R

Only ETH and SOL were positive; ETH contributed 84.9% of positive net R.

## Secondary 2024-09-06 → 2026-09-06

- 636 closed trades
- PF 0.81
- expectancy -0.102R
- net -64.708R
- max DD 84.800R

## Decision

All economic robustness gates fail except sample and data adequacy.

Range Reversion V1 is frozen as rejected. Do not isolate ETH/SOL, switch side, or tune SMA/z-score/ADX/ATR/hold/cost/date parameters from this result.

No Paper shadow is created.
