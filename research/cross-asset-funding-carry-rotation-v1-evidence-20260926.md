# MERIDIAN — Cross-Asset Funding Carry Rotation V1 evidence

Status: STRONG NEAR-PASS / NO PAPER SHADOW  
Valid evidence run: GitHub Actions 36271020789  
Artifact: 10915303934  
Artifact SHA256: `6fd7e54a5b242d708bbaf9b1a2393866d9f3d1ea997b50f411a14e5f3dad8757`

## Frozen result

Evaluation: 2021-01-01 → 2026-06-01  
Primary/secondary split: 2023-07-01  
Universe: BTCUSDT / ETHUSDT / SOLUSDT  
Selection: highest exact-V2 gross cost coverage among eligible assets, one basket total.

### Overall

- 11 completed cycles
- 11/11 profitable
- net P&L +$9,376.30
- dollar PF 99
- max closed-equity drawdown $0
- funding minus modeled costs +$9,122.01
- +$8/cycle stress +$9,288.30, stressed PF 2552.78
- complete/reproducible data for all three assets

### Segments

Primary:
- 7 cycles
- +$7,566.35
- PF 99

Secondary:
- 4 cycles
- +$1,809.95
- PF 99

### Asset breadth

- ETH: 5 cycles, +$5,660.15
- SOL: 4 cycles, +$3,698.02
- BTC: 2 cycles, +$18.12

Cycle share:
- ETH 45.45%
- SOL 36.36%
- BTC 18.18%

Positive-PnL share:
- ETH 60.37%
- SOL 39.44%
- BTC 0.19%

### Calendar breadth

- 2021: +$6,663.36
- 2022: +$481.13
- 2023: +$421.86
- 2024: +$1,376.71
- 2025: +$433.23

All years with completed cycles were positive.

## Gate decision

Passed:
- aggregate net
- PF
- profitable share
- carry pays modeled costs
- drawdown
- primary segment
- asset breadth
- cycle concentration
- PnL concentration
- calendar breadth
- friction stress
- data adequacy

Failed:
- total sample: 11 < 12
- secondary sample: 4 < 5 (secondary economics themselves were positive/PF 99)

Therefore:
- `pass = false`
- no Paper shadow
- sample gates are not lowered after observing favorable P&L

## Decision

V1 is frozen as a strong near-pass. Do not extend the date, lower sample gates, remove BTC, change selector thresholds or alter costs based on this result.

A distinct portfolio architecture may be predeclared separately.
