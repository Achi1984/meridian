# MERIDIAN — Cross-Asset Funding Carry Portfolio V1 evidence

Status: ECONOMIC PASS / PORTFOLIO DRAWDOWN FAIL / NO PAPER SHADOW  
Valid evidence run: GitHub Actions 36271228579

## Frozen result

Evaluation: 2021-01-01 → 2026-06-01  
Portfolio reference capital: $60,000  
Architecture: three independent exact-V2 sleeves, BTC/ETH/SOL, up to three concurrent.

### Aggregate

- 30 completed cycles
- 30/30 profitable
- net P&L +$19,640.50
- dollar PF 99
- funding minus modeled costs +$19,610.21
- +$8/cycle friction stress +$19,400.50
- stressed PF 3478.13
- complete/reproducible data

### Primary / secondary

Primary:
- 18 cycles
- +$15,113.91
- PF 99

Secondary:
- 12 cycles
- +$4,526.59
- PF 99

### Assets

- BTC: 10 cycles, +$4,686.19
- ETH: 10 cycles, +$7,955.46
- SOL: 10 cycles, +$6,998.85

Positive-PnL concentration:
- BTC 23.86%
- ETH 40.51%
- SOL 35.63%

### Calendar years

- 2021: 12 cycles, +$13,686.25
- 2022: 4 cycles, +$723.84
- 2023: 2 cycles, +$703.82
- 2024: 10 cycles, +$3,757.89
- 2025: 2 cycles, +$768.70

Every year with closed cycles was positive.

### Marked portfolio risk

- ending equity: $79,640.50
- peak equity: $79,649.31
- maximum 4h marked drawdown: **$815.80**
- maximum marked drawdown: **1.36%** of $60,000 reference capital
- maximum simultaneous baskets: 3

Frozen limit: $600 / 1.00%.

## Gate decision

Passed every frozen gate except:
- marked portfolio drawdown: $815.80 > $600

Therefore:
- `pass = false`
- no Paper shadow
- the $600 limit is not raised after observing the result

## Decision

The carry edge is broad across assets, segments and years, but three-sleeve concurrency breaches the predeclared portfolio risk budget.

V1 is frozen as failed for Paper promotion. No asset, funding, basis, cost, date or exit parameter is changed from this result.

A separately predeclared portfolio-risk architecture may be tested as a distinct successor.
