# Cross-Venue Funding Spread V1 — Frozen Discovery Result

Workflow run: **36526460897**  
Artifact: **11014199375**  
Artifact ZIP SHA-256: `31e4f1e5e1b0d07b41467a6eb5faf326be24c6973134f746a71ddcee4d889506`

This records the first valid untouched result of `CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN`. The protocol, direction, costs, data gates and discovery gates were committed before this result was observed.

## Frozen result

- Direction: LONG Binance USD-M perpetual / SHORT Hyperliquid perpetual
- Assets: BTC, ETH, SOL
- Valid asset-month cycles: 105
- Rejected cycles: 30
- Net return: **+6.3018%**
- Net PnL: **+$3,682.43**
- Profit Factor: **5.6119**
- Max closed-equity drawdown: **0.6612%**
- Funding PnL: **+$7,073.22**
- Cross-venue basis PnL: **-$30.79**
- Modeled base costs: **$3,360.00**
- Stress return (+5 bps/fill): **+2.6501%**
- Positive chronological windows: **4/5**
- Positive-PnL concentration: **43.85%**
- Frozen gate: **PASS**

### Asset attribution

| Asset | Cycles | Net PnL | Stress PnL | Funding PnL | Basis PnL | Costs |
|---|---:|---:|---:|---:|---:|---:|
| BTC | 35 | +$1,118.15 | +$418.15 | +$2,247.67 | -$9.51 | $1,120 |
| ETH | 35 | +$949.50 | +$249.50 | +$2,090.05 | -$20.54 | $1,120 |
| SOL | 35 | +$1,614.77 | +$914.77 | +$2,735.50 | -$0.73 | $1,120 |

## Decision

**DISCOVERY_PASS_HOLDOUT_REQUIRED**

This is a research discovery pass only. It does **not** authorize Paper shadow, live execution, venue funding, leverage changes or any Pionex/OKX action.

The next allowed step is an independently frozen holdout. No discovery parameter, direction, cost assumption, gate or asset result may be tuned from this outcome.
