# Spot-Perp Funding Harvest V1 — Frozen Discovery Result

Workflow run: **36591020395**  
Artifact: **11043249496**  
Artifact ZIP SHA-256: `da43d6defa0f67c95ded93af8133c9765e2b0cb73d3551978c5fc71d42cb2a2b`  
Summary JSON SHA-256: `2a456b9ad2f6fdb9818923a5c186eac246e35dc25cfdcc8fb4fc29f367f95610`  
Full evidence SHA-256: `69d7acb14111fc938b998055dc1823e93445a5c4b105d6fd90f97d8edea602a4`  
Markdown SHA-256: `08c24d2d5b4d6f736bf93952ee4bf4d98ad8235deb939c08ffa0bea073e5ab06`

This records the first untouched discovery result of `SPOT-PERP-FUNDING-HARVEST-V1-FROZEN`.

## Frozen discovery scope

Raw data:
- 2024-09 through 2025-08
- September 2024 signal warm-up only

Trade months:
- 2024-10 through 2025-08 inclusive

Assets:
- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

Signal:
- previous completed month's realized Binance USD-M funding
- ACTIVE only when prior-month cumulative funding >= 0.00775
- LONG Spot / SHORT USD-M perpetual
- otherwise NO TRADE

## Data integrity

- decision slots: **88/88**
- rejected slots: **0**
- data-integrity failure: **false**

## Economic result

- active cycles: **24**
- no-trade cycles: **64**
- reserved-capital compounded net return: **+0.7581%**
- net PnL: **+$1,211.34**
- Profit Factor: **11.2281**
- max drawdown: **0.0740%**
- positive chronological windows: **3/5**
- funding PnL: **+$2,166.79**
- Spot+Perp price/basis PnL: **+$52.55**
- modeled base costs: **$1,008.00**
- funding/base-cost ratio: **2.1496**
- stress return: **+0.4569%**
- positive assets: **8/8**
- positive-PnL concentration: **23.40%**
- prior-signal/current-funding sign agreement: **95.83%**

## Asset attribution

| Asset | Active | Net PnL | Stress PnL | Funding PnL | Basis PnL |
|---|---:|---:|---:|---:|---:|
| OP | 3 | +$152.68 | +$92.68 | +$269.33 | +$9.35 |
| INJ | 3 | +$64.13 | +$4.13 | +$185.16 | +$4.97 |
| WLD | 3 | +$121.32 | +$61.32 | +$252.91 | -$5.59 |
| SEI | 2 | +$37.50 | -$2.50 | +$116.26 | +$5.24 |
| TIA | 2 | +$175.93 | +$135.93 | +$254.34 | +$5.59 |
| PENDLE | 5 | +$283.49 | +$183.49 | +$492.55 | +$0.94 |
| RUNE | 3 | +$212.79 | +$152.79 | +$329.29 | +$9.50 |
| ICP | 3 | +$163.49 | +$103.49 | +$266.94 | +$22.54 |

## Frozen gate result

**FAIL**

Gate reasons:
- `ACTIVE_CYCLES_LT_32`
- `POSITIVE_WINDOWS_LT_4`

All economic, drawdown, stress, funding-cost, asset-breadth and concentration requirements otherwise passed.

## Decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

The frozen temporal holdout remains **unauthorized**.

## Interpretation

The core Spot-Perp funding-harvest economics are promising in discovery:

- every frozen asset was positive;
- funding covered modeled costs by more than 2x;
- basis contribution was slightly positive in aggregate;
- drawdown was extremely low;
- stress remained positive.

However, the cost-derived 77.5 bps monthly entry threshold produced too few active observations and insufficient chronological-window breadth for the preregistered gate.

This observation may motivate a new stateful/persistent carry hypothesis, but it must not rescue V1.

## Anti-overfitting decision

- no threshold reduction inside V1;
- no active-cycle gate relaxation;
- no positive-window gate relaxation;
- no asset removal;
- no fee/slippage reduction;
- no holdout run for V1;
- no Paper/live promotion.

A successor must be separately preregistered as a genuinely different strategy rule set before any new PnL.
