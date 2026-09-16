# MERIDIAN Bull Compound v0.4.4 — regime-gated hedge

Research-only. Core BTC is never sold. The base Fib/RSI/EMA trigger, 20% inverse hedge size, TP ladder and +12% stop are frozen from v0.4.1. Only the hedge ON/OFF gate is changed. Daily OHLC comes from Binance Data Vision; completed-week features use only fully closed prior ISO weeks. Funding is excluded; 10 bps fee and 5 bps adverse slippage are included.

## Training-selected gate
- Gate: higher-timeframe bull regime only.
- Daily bull condition: EMA50 > EMA200.
- Weekly bull condition: completed-week EMA10 > EMA30.
- No additional momentum-loss confirmation was selected.
- Candidate window for momentum variants: 14 days after the base trigger.
- Effective short leverage diagnostic remains 8x.

## Selected-gate results
| Period | BTC end | vs HODL | Trades | Profitable | Stops | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| TRAIN 2020–2022 | 1.02833 BTC | +2.83% | 4 | 3 | 1 | 76.20% |
| OOS 2023–2025 | 0.96584 BTC | -3.42% | 9 | 4 | 5 | 31.12% |
| Continuous 2020–2025 | 1.01188 BTC | +1.19% | 14 | 8 | 6 | 76.20% |

2021-11-10 bull checkpoint: 1.01632 BTC (+1.63% versus HODL).

## Baseline comparison
The frozen static 20% v0.4.1-style baseline remained stronger out of sample: 0.98438 BTC in 2023–2025 versus 0.96584 BTC for the training-selected bull-regime gate. Baseline OOS max drawdown was 30.69% versus 31.12% for the gate.

The stricter daily/weekly momentum-loss variants did not produce at least two qualifying trades in the 2020–2022 training window under the frozen base trigger, so they were not eligible for training selection. The only non-baseline gate with enough training trades was the higher-timeframe bull-regime gate, and it failed to generalize out of sample.

## Interpretation
Regime gating did not improve robustness. It improved the in-sample 2020–2022 result by filtering one poor base trigger, but worsened the untouched 2023–2025 endpoint and slightly worsened drawdown. This is a classic sign that further signal-filter optimization risks overfitting the small number of hedge events.

Current evidence therefore favors the simpler v0.4.1 architecture: keep the BTC core untouched, use a simple 20% hedge when the base extension trigger occurs, and control survivability with effective short leverage/margin rather than stacking additional predictive filters. The unresolved real-world variables are funding, Pionex maintenance-margin/liquidation mechanics, and live grid inventory behavior.
