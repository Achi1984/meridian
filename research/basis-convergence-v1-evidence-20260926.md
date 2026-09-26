# MERIDIAN — Basis Convergence V1 evidence

Status: REJECTED / INSUFFICIENT OPPORTUNITY / NO PAPER SHADOW  
Valid evidence run: GitHub Actions 36271738243  
Artifact: 10915168486  
Artifact SHA256: `23419336c3f3b327cca563aed4407956bfad960ce010670598695db0591bf6dd`

## Frozen result

Evaluation: 2021-01-01 → 2026-06-01  
Universe: BTCUSDT / ETHUSDT / SOLUSDT  
One basket maximum, market-neutral long spot / short perp.

- 3 completed baskets
- 3/3 profitable
- net P&L +$747.80
- PF 99
- max marked drawdown $44.98 / 0.225%
- +$8/basket friction stress +$723.80
- complete/reproducible data

By asset:
- BTC: 1 basket, +$634.80
- ETH: 1 basket, +$71.55
- SOL: 1 basket, +$41.45

All three entries occurred in 2021.

Primary:
- 3 baskets, +$747.80

Secondary:
- 0 baskets

## Gate decision

Passed:
- aggregate net
- PF
- profitable share
- marked drawdown
- friction stress
- data adequacy

Failed:
- total sample 3 < 20
- primary sample 3 < 7
- secondary sample 0 < 7
- asset breadth
- PnL concentration (BTC 84.89%)
- calendar breadth

Therefore:
- `pass = false`
- no Paper shadow
- entry/exit basis thresholds are not relaxed after observing the sparse opportunity count

## Decision

Basis Convergence V1 is frozen as rejected for insufficient repeatable opportunity. Do not lower the 0.75% entry basis or extend the hold/date window from this result.
