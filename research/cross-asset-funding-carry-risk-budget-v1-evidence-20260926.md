# MERIDIAN — Cross-Asset Funding Carry Risk Budget V1 evidence

Status: ULTRA-CLOSE RISK FAIL / NO PAPER SHADOW  
Valid evidence run: GitHub Actions 36271400535  
Artifact: 10916070831  
Artifact SHA256: `dac4a83c656d16b0a4a939627678bdd5601662a8dfa8e21f9bb1d277a63a8285`

## Frozen result

Evaluation: 2021-01-01 → 2026-06-01  
Universe: BTCUSDT / ETHUSDT / SOLUSDT  
Architecture: exact Funding Carry V2 economics, max two concurrent sleeves, deterministic round-robin admission, $60,000 reference capital.

### Overall

- 21 completed cycles
- 21/21 profitable
- net P&L +$15,938.55
- dollar PF 99
- funding income minus modeled costs +$15,655.21
- +$8 per-cycle friction stress +$15,770.55
- stressed PF 2827.54
- complete/reproducible data

### Primary / secondary

Primary:
- 13 cycles
- +$12,691.56
- PF 99

Secondary:
- 8 cycles
- +$3,246.99
- PF 99

### Asset breadth

- BTC: 7 cycles, +$3,142.38
- ETH: 7 cycles, +$6,329.43
- SOL: 7 cycles, +$6,466.74

Positive-PnL concentration:
- BTC 19.72%
- ETH 39.71%
- SOL 40.57%

### Calendar breadth

- 2021: +$11,351.61
- 2022: +$636.14
- 2023: +$703.82
- 2024: +$2,478.29
- 2025: +$768.70

Every year with completed cycles was positive.

### Marked portfolio risk

- ending marked equity: $75,938.55
- peak marked equity: $75,947.36
- maximum 4h marked drawdown: **$601.73**
- maximum marked drawdown: **1.003%**
- maximum simultaneous baskets: 2

Frozen maximum: **$600.00 / 1.000%**.

The strategy missed the predeclared portfolio drawdown limit by **$1.73**. The result is not rounded down and the risk limit is not moved.

## Gate decision

Passed:
- overall sample
- aggregate net P&L
- PF
- profitable-cycle share
- funding pays modeled costs
- primary
- secondary
- per-asset sample
- per-asset net P&L
- P&L concentration
- calendar breadth
- friction stress
- data adequacy
- concurrency

Failed:
- marked portfolio drawdown: $601.73 > $600.00

Therefore:
- `pass = false`
- no Paper shadow
- no post-hoc reduction/rounding of the measured drawdown
- no increase of the $600 risk gate
- no same-family notional or concurrency tweak from this result

## Decision

Risk Budget V1 is frozen as an ultra-close near-pass. The evidence strongly supports the underlying carry effect, but the predeclared Paper-promotion protocol was not fully satisfied.

No Paper shadow is created from this result. A future carry candidate must obtain genuinely new prospective evidence or begin from a independently predeclared architecture, not shave parameters around this $1.73 miss.
