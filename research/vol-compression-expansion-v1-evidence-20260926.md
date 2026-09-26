# MERIDIAN — Volatility Compression Expansion V1 evidence

Status: REJECTED / NO PAPER SHADOW / NO PARAMETER TUNING  
Evidence run: GitHub Actions 36265693190  
Artifact: 10914351801  
Artifact SHA256: `421b5e6a7bf4d25c615b0630752e18a926ae69d4b8434dc836b5fc063d1951d7`

## Data integrity

The original Binance evidence source returned HTTP 451 before any performance metric was produced. Before the first result, the source was changed to OKX public confirmed 4h spot candles while keeping strategy logic, universe, costs, windows and gates unchanged.

OKX coverage is complete for all seven assets in both evaluation windows.

## Frozen primary result — 2022-09-06 to 2024-09-06

- 405 closed trades
- PF 0.92
- expectancy -0.046R
- net -18.674R
- win rate 21.0%
- max drawdown 46.307R

Chronological equal-calendar folds:
- Fold 1: n 102, PF 0.60, EXP -0.225R
- Fold 2: n 117, PF 0.75, EXP -0.167R
- Fold 3: n 87, PF 1.93, EXP +0.366R
- Fold 4: n 99, PF 0.85, EXP -0.082R

Side split:
- LONG: n 188, PF 0.93, EXP -0.039R
- SHORT: n 217, PF 0.90, EXP -0.052R

Only two adequately sampled assets were positive:
- ETH: PF 1.31 / +0.176R
- LINK: PF 1.13 / +0.064R

Positive primary net R was highly concentrated:
- ETH 76.9%
- LINK 23.1%

## Frozen secondary result — 2024-09-06 to 2026-09-06

- 436 closed trades
- PF 1.22
- expectancy +0.107R
- net +46.822R
- win rate 25.2%
- max drawdown 28.917R

Secondary SHORT was materially stronger than LONG, but this is descriptive only and cannot be used to rescue V1 after seeing the result.

## Gate decision

Passed:
- primary sample
- secondary edge
- data adequacy

Failed:
- primary aggregate edge
- primary drawdown
- chronological stability
- both-side robustness
- asset breadth
- concentration
- secondary drawdown

**historicallyPromising = false**  
**paperShadowPermitted = false**

## Stopping rule

V1 is frozen as rejected. Do not:
- switch to SHORT-only because the secondary SHORT cohort was stronger;
- isolate ETH/LINK;
- change compression percentile/lookback/streak;
- alter box width/expiry, expansion multiple, stop, target, break-even trigger, max hold, costs or evidence dates;
- select only the strong third primary fold or secondary window.

Any successor must start from a distinct predeclared hypothesis.
