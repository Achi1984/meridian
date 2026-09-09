# MERIDIAN R34 — Trend Pullback V1 evidence

Generated: 2026-09-09T19:27:03.695Z

Decision: **REJECTED — no Paper launch and no production execution impact.**

## Frozen hypothesis

- Independent from Baseline READY.
- 4h and 1h EMA20/EMA50 trend alignment.
- Minimum ADX: 4h 20, 1h 18.
- Entry within 0.65 ATR of the 15m EMA20, with 1h momentum confirmation.
- Risk 0.50%, one open position, 1.5 ATR stop, full exit at 2R.
- Twelve Meridian assets, 90 calendar days, 5 bps fees and 3 bps slippage.

## Result

The full portfolio reached the 8% drawdown gate after 22 trades: 3 wins, 13.64% win rate, PF 0.212, expectancy -$38.41, P&L -$845.07 and max drawdown 8.451% on $10,000 model capital.

| Fresh 20% calendar window | Trades | P&L | PF | Expectancy | Max DD |
|---:|---:|---:|---:|---:|---:|
| 1 | 22 | -$845.07 | 0.212 | -$38.41 | 8.451% |
| 2 | 60 | -$80.25 | 0.962 | -$1.34 | 7.663% |
| 3 | 23 | -$703.95 | 0.342 | -$30.61 | 8.322% |
| 4 | 25 | -$763.21 | 0.382 | -$30.53 | 8.026% |
| 5 | 33 | -$755.69 | 0.461 | -$22.90 | 8.465% |

Positive windows: 0/5. Severe windows: 4/5. Stability score: 29/100.

Both sides lost in the full run: LONG -$260.57 and SHORT -$584.50. BTC was positive on only two trades (+$145.82), which is not enough evidence for an asset-specific successor. SUI, ADA and XRP were especially weak, but excluding them after observing this result would be post-hoc selection rather than prospective validation.

## Interpretation

Higher-timeframe trend alignment plus proximity to EMA20 is not a sufficient entry edge for this universe. A 2R target did not compensate for the low hit rate. No threshold tuning, asset pruning or Paper restart is justified from this failed sample.

Challenger V3 remains unchanged and continues its prospective cost-aware phase. The next distinct research track should test a non-directional funding-carry hypothesis rather than another score or EMA variation.
