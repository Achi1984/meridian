# MERIDIAN — Multi-Timeframe Pullback Continuation V1 evidence

Status: REJECTED / NO PAPER SHADOW / NO PARAMETER TUNING  
Evidence run: GitHub Actions 36266181398  
Artifact: 10914146928  
Artifact SHA256: `d8a262f09304208704f80d36fa91d9cf07acec036434584b962bef2a28308c78`

## Frozen primary result — 2022-09-06 to 2024-09-06

- 329 closed trades
- PF 0.82
- expectancy -0.097R
- net -31.914R
- win rate 18.5%
- max drawdown 50.860R

Chronological equal-calendar folds:
- Fold 1: n 68, PF 1.51, EXP +0.222R
- Fold 2: n 78, PF 0.55, EXP -0.256R
- Fold 3: n 118, PF 0.82, EXP -0.109R
- Fold 4: n 65, PF 0.55, EXP -0.217R

Side split:
- LONG: n 169, PF 0.76, EXP -0.142R
- SHORT: n 160, PF 0.90, EXP -0.050R

Only three adequately sampled assets were positive:
- BTC PF 1.28 / +0.120R
- SOL PF 1.05 / +0.024R
- AVAX PF 1.35 / +0.140R

Positive-net-R concentration was above the locked limit:
- AVAX 51.3%
- BTC 40.4%
- SOL 8.3%

## Frozen secondary result — 2024-09-06 to 2026-09-06

- 338 closed trades
- PF 0.88
- expectancy -0.073R
- net -24.726R
- win rate 21.6%
- max drawdown 45.554R

## Gate decision

Passed:
- primary sample
- data adequacy

Failed:
- primary aggregate edge
- primary drawdown
- chronological stability
- both-side robustness
- asset breadth
- concentration
- secondary edge
- secondary drawdown

**historicallyPromising = false**  
**paperShadowPermitted = false**

## Stopping rule

V1 is frozen as rejected. Do not:
- keep only Fold 1;
- isolate BTC/SOL/AVAX;
- switch to SHORT-only;
- tune EMA lengths, pullback band, validity window, confirmation rule, ATR stop, target, break-even trigger, max hold, costs or evidence dates.

Any successor must start from a distinct predeclared hypothesis.
