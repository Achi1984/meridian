# MERIDIAN — Elliott ABC Reversal V1 evidence

Status: REJECTED / NO PAPER SHADOW  
Valid evidence run: GitHub Actions 36270290625  
Artifact: 10915766230  
Artifact SHA256: `a6f97209871ccb0061624a48ac3244a832aa67089c9ba96c39c7a2f00b558c35`

## Primary 2022-09-06 → 2024-09-06

- 126 closed baskets
- PF 1.12
- expectancy +0.059R
- net +7.489R
- max DD 16.134R
- LONG PF 1.12 / +0.059R
- SHORT PF 1.13 / +0.060R

Chronological folds:
1. n20, PF 2.19, EXP +0.438R
2. n34, PF 1.29, EXP +0.124R
3. n41, PF 1.44, EXP +0.214R
4. n31, PF 0.25, EXP -0.460R

Six adequately sampled assets were positive. Positive-R concentration stayed within the frozen 40% ceiling, with XRP highest at 39.6%.

## Secondary 2024-09-06 → 2026-09-06

- 149 closed baskets
- PF 1.32
- expectancy +0.134R
- net +20.039R
- max DD 13.503R
- LONG PF 1.21 / +0.095R
- SHORT PF 1.49 / +0.180R

## Frozen gate

Passed:
- primary sample
- both sides
- asset breadth
- concentration
- secondary edge
- secondary drawdown
- data adequacy

Failed:
- primary aggregate edge (PF 1.12 < 1.15; EXP 0.059R < 0.08R)
- primary drawdown (16.134R > 15R)
- chronological stability (Fold 4 PF 0.25)

Therefore:
- historicallyPromising = false
- paperShadowPermitted = false

## Decision

V1 is frozen as rejected. Do not remove ETH, isolate XRP/AVAX/BTC, select the stronger secondary period, alter ratios, pivot widths, Daily context, cost or dates from this result.

No Paper shadow is created.
