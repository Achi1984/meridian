# MERIDIAN Bull Compound v0.4 — 1 BTC Core + inverse COIN-M hedge

Research-only. The 1 BTC core is never sold. Hedge PnL is modeled in BTC using inverse-futures PnL. Funding is excluded; fees and slippage are included.

## Method
- Data: Binance Data Vision BTCUSDT daily OHLC.
- Parameter selection / training: 2020-05-12 through 2022-12-31 only.
- Untouched out-of-sample validation: 2023-01-01 through 2025-12-31.
- 5,832 parameter variants tested.
- Core: 1.0 BTC, never sold.
- Hedge: inverse short; PnL = face_usd * (1/exit - 1/entry).
- Costs: 10 bps fee + 5 bps adverse slippage per transaction.
- Conservative intraday sequencing: when stop and TP are both touched in the same daily candle, stop is assumed first.
- Funding is not modeled and must be stress-tested separately.

## Locked rule selected from 2020–2022 training only
- Breakout structure: prior 60-day high; Fibonacci projection from trailing 180-day impulse.
- Fib triggers: 1.618, 2.0, 2.618.
- Overextension: RSI14 >= 62 and close / EMA200 >= 1.00.
- Hedge notional: 20% of BTC-equivalent at entry.
- TP drawdowns from hedge entry: -4%, -8%, -12%, closing 25% / 30% / 25%; final 20% remains as runner.
- Stop: +12% above hedge entry.
- New setup rearms after a 15% drawdown from setup peak.

## Results
| Period | Total BTC end | vs 1 BTC HODL | Hedge PnL BTC | Trades | Profitable | Stops | Max DD strategy | Max DD HODL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TRAIN 2020-05-12 → 2022-12-31 | 1.01863 BTC | +1.86% | +0.01863 | 4 | 3 | 1 | 76.20% | 76.63% |
| OOS 2023-01-01 → 2025-12-31 | 0.98438 BTC | -1.56% | -0.01562 | 9 | 5 | 5 | 30.69% | 32.02% |
| Continuous 2020-05-12 → 2025-12-31 | 1.03912 BTC | +3.91% | +0.03912 | 15 | 10 | 6 | 76.20% | 76.63% |

2021-11-10 bull checkpoint: 1.00769 BTC, +0.77% versus 1 BTC HODL.

Robustness check: none of the top 20 models selected only on 2020–2022 beat 1 BTC HODL in the untouched 2023–2025 validation period. Their median out-of-sample result was 0.98850 BTC.

## Comparison with v0.3 Sell-&-Reload
| Model | OOS 2023–2025 | Continuous 2020–2025 |
|---|---:|---:|
| Sell-&-Reload v0.3 | 0.96801 BTC-equivalent | 0.97003 BTC-equivalent |
| Core + Hedge v0.4 | 0.98438 BTC | 1.03912 BTC |

## Interpretation
Keeping the BTC core untouched removes the main failure mode of Sell-&-Reload: missing a continued bull move while reserve cash waits for a retracement. The hedge model was substantially better than Sell-&-Reload and improved drawdown in the 2023–2025 test, but the locked hedge rule still did not beat pure HODL out-of-sample. The key failure mode was repeated stopped shorts during persistent upside: five of nine OOS hedges stopped, consuming 0.01562 BTC net. This suggests the next research step should focus on smarter hedge activation / sizing rather than larger hedge leverage or more aggressive profit-taking.
