# MERIDIAN v0.4.7 — joint Long/Short Dynamic-Margin stress test

Research-only survival/capital-flow model. The long liquidation sensitivity is calibrated from the current Pionex long-grid snapshot; exact grid inventory/PnL is not reconstructed. Historical funding uses the v0.4.6 hybrid Binance COIN-M/USD-M proxy. Fees: 10 bps; adverse slippage: 5 bps.

## Current live-style short ladder used
- Short reference entry: 75,784.8.
- TP1 74,800, TP2 72,500, TP3 70,000.
- 25% of initial short face closed at each TP; 25% runner remains.
- Stop ratio based on 83,200 / 75,784.8 (~+9.78%).
- Tested effective short leverage: 7x, 8x, and ~8.89x (current snapshot equivalent).

## Historical paired stress result, 2020–2025
The frozen v0.4.1 market trigger produced 8 long cycles. In this specific sample, even the no-transfer long snapshot analogue had 0 long liquidations; 7 cycles reached the long TP and one remained open at period end. Thus historical survival alone does not prove the value of Dynamic Margin because no baseline liquidation event occurred.

Across all leverage settings, the current-style short ladder hit TP1/TP2/TP3 11/7/6 times. Effective short leverage changed released margin, not the pre-liquidation PnL path.

| Policy | Long liquidations | Total transferred to long | Max dynamic margin in one cycle | Re-hedge external top-up (full period) |
|---|---:|---:|---:|---:|
| No transfer | 0 | 0 BTC | 0 BTC | 0 BTC |
| PnL/funding only, target grid floor | 0 | 0.05460 BTC | 0.01276 BTC | 0 BTC |
| Released short margin + PnL, target grid floor | 0 | 0.10211 BTC | 0.01276 BTC | 0.05123 BTC |
| Released short margin + PnL, target 5% below grid floor | 0 | 0.16151 BTC | 0.02019 BTC | ~0.080 BTC |

The important trade-off is that immediately transferring released short margin improves long liquidation safety but consumes capital that would otherwise fund the next hedge. In the untouched 2023–2025 period, transferring all released margin to the grid-floor target achieved that target in all 4 long cycles, but required about 0.02103 BTC of additional re-hedge capital. PnL/funding-only transfer achieved the grid-floor target in only 1 of 4 cycles but required no re-hedge top-up.

## Current snapshot ladder effect
Using the current long snapshot (entry 75,966.1; liq 46,837.5; base margin 0.0492 BTC; grid floor 42,600) and immediately transferring freed short margin plus realised TP PnL:

| Effective short leverage | TP step | BTC from step | Cumulative BTC | Estimated long liquidation |
|---:|---|---:|---:|---:|
| 8x | TP1 @ 74,800 | 0.00683 | 0.00683 | 44,470 |
| 8x | TP2 @ 72,500 | 0.00844 | 0.01527 | 41,856 |
| 8x | TP3 @ 70,000 | 0.01030 | 0.02557 | 39,055 |
| 8.89x | TP1 @ 74,800 | 0.00621 | 0.00621 | 44,676 |
| 8.89x | TP2 @ 72,500 | 0.00781 | 0.01402 | 42,224 |
| 8.89x | TP3 @ 70,000 | 0.00968 | 0.02370 | 39,536 |

These liquidation estimates are local snapshot sensitivities, not exact future Pionex liquidation values. Grid inventory and maintenance margin change as orders fill.

## Interpretation
For the current live ladder, released short margin is large enough that by TP2 the modeled long liquidation moves below the 42,600 grid floor at both 8x and ~8.89x effective short leverage; by TP3 it moves to roughly 39.1k–39.5k. PnL alone is much less powerful than PnL plus released margin.

However, transferring all released short margin immediately creates a capital-reuse problem for future hedges. A more capital-efficient next policy is therefore to keep freed short capital in a dedicated reserve and inject it into Long Dynamic Margin only when the long approaches a predefined danger zone, rather than immediately after every TP.
