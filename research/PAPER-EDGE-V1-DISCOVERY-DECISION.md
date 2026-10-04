# PAPER EDGE V1 — FINAL DISCOVERY DECISION

Status: **DISCOVERY FAILED — V1 CLOSED**  
Ruleset: `PAPER-EDGE-V1`  
Execution impact: `false`  
Validation: **LOCKED**  
Holdout: **LOCKED**  
Paper/Live promotion: **NOT PERMITTED**

## Authoritative evidence

Only the final authorized run below is decision evidence:

- workflow run: `37233479311`
- authorization commit: `a5db40d73f30b99d397004d4903b60ea5fc31fd3`
- reviewed base main: `e0ba3a210a08ce5c0d9573181524604e14b3fe8d`
- source run: `37231163461`
- source artifact: `11313901895`
- source receipt: `d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08`
- Discovery evidence artifact: `11314304791`
- Discovery artifact ZIP digest: `sha256:48c8d01aed0e10e84965dcd21334da99055c919524bd877e2a3927f7d5c967e7`
- canonical result digest: `e04e812ab59b5b084dcdd8f15fa7aa58c55df15e22f028c2f6cf2266b06f1abd`

Superseded/pre-fix runs are excluded. In particular, the result discussed in closed unmerged PR #518 is not strategy evidence.

## Frozen Discovery result

- closed trades: **164**
- net PnL: **+4,351.7157 USDT** on normalized 100,000 USDT starting equity
- baseline Profit Factor: **1.10428106**
- stress Profit Factor: **1.01367242**
- expectancy: **+0.05602976 R/trade**
- max drawdown: **9.19462501%**
- positive chronological windows: **3 / 5**
- positive-PnL concentration: **98.83724421%**
- integrity: **PASS**

### By asset

| Asset | Trades | Net PnL | PF |
| --- | ---: | ---: | ---: |
| BTCUSDT | 61 | +83.8542 | 1.0052 |
| ETHUSDT | 48 | -2,859.9582 | 0.7846 |
| SOLUSDT | 55 | +7,127.8198 | 1.5779 |

### By side

| Side | Trades | Net PnL | PF |
| --- | ---: | ---: | ---: |
| LONG | 91 | +5,639.8859 | 1.2505 |
| SHORT | 73 | -1,288.1702 | 0.9330 |

### Five chronological windows

1. +5,093.7068
2. +1,752.1943
3. -3,409.0201
4. -3,855.9628
5. +4,770.7975

## Gate decision

Final decision: **`EDGE_V1_DISCOVERY_FAIL`**

Failed preregistered gates:

- `PF_LT_1_20`
- `STRESS_PF_LT_1_05`
- `POSITIVE_WINDOWS_LT_4`
- `NEGATIVE_ASSET`
- `CONCENTRATION_GT_50`

The trade-count, expectancy, drawdown, per-asset sample, side-count/side-PF and integrity gates did not cause the failure.

## Accounting integrity

Baseline ending cash: `104351.71571355`  
Baseline expected cash: `104351.71571356`  
Baseline reconciliation delta: `8.8e-09`

Stress ending cash: `100594.91418587`  
Stress expected cash: `100594.91418594`  
Stress reconciliation delta: `6.61e-08`

Trade IDs are unique and all entry/final-exit timestamps remain inside the authorized Discovery split.

## Consequence

PAPER-EDGE-V1 is permanently closed as a failed ruleset. Validation and Holdout must not be opened. No asset deletion, SOL-only selection, LONG-only selection, parameter adjustment, threshold change, exit change, or cost change is permitted inside V1 to rescue the observed result.

Any future directional trend/pullback redesign requires a new preregistered ruleset. Independent research strands that were preregistered before this result remain eligible for separate evaluation.
