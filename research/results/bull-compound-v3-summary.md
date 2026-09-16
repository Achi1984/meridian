# MERIDIAN Bull Compound v0.3 — Binance OHLC walk-forward result

Research-only MERIDIAN interpretation; not a claim about Bastian Keller's exact rules.

## Method
- Data: Binance Data Vision BTCUSDT daily OHLC, 2019–2025 (2019 used as indicator warmup).
- Training / parameter selection: 2020-05-12 through 2022-12-31 only.
- Untouched out-of-sample validation: 2023-01-01 through 2025-12-31.
- 2,187 parameter variants tested.
- Transaction model: sell signal confirmed on daily close and executed at next-day open; pre-placed reload limits fill when daily low reaches the limit.
- Costs: 10 bps fee + 5 bps slippage per side.
- Cash/reload reserve capped at 20% of total equity.

## Locked rule selected from training only
- Breakout: prior 60-day high; Fibonacci projection frozen from the trailing 180-day impulse.
- Fib extensions: 1.618, 2.0, 2.618.
- Overextension gate: RSI14 >= 62; close / EMA200 >= 1.00.
- Sell 5.0% of current BTC per triggered Fib level.
- Reload each sale at -10%, -15%, -20%, with 30% / 35% / 35% of that sale reserve.
- Rearm a new setup after a 15% drawdown from the setup peak.

## Results
| Period | End BTC-equivalent | vs 1 BTC HODL | BTC held | Cash | Sells / reloads | Max DD strategy | Max DD HODL |
|---|---:|---:|---:|---:|---:|---:|---:|
| TRAIN 2020-05-12 → 2022-12-31 | 1.04139 BTC | +4.14% | 1.04139 BTC | $0 | 5 / 15 | 74.38% | 76.63% |
| OOS 2023-01-01 → 2025-12-31 | 0.96801 BTC | -3.20% | 0.82190 BTC | $12,806 | 10 / 16 | 27.29% | 32.02% |
| Continuous 2020-05-12 → 2025-12-31 | 0.97003 BTC | -3.00% | 0.80642 BTC | $14,340 | 18 / 36 | 74.38% | 76.63% |

At the 2021-11-10 bull checkpoint the selected model retained 0.95382 BTC-equivalent, or -4.62% versus HODL at that checkpoint.

Robustness check: none of the top 20 models selected exclusively on the 2020–2022 training period beat 1 BTC HODL in the untouched 2023–2025 validation period. Their median out-of-sample result was 0.96801 BTC-equivalent.

## Interpretation
The partial-profit/reload concept did add BTC in the 2020–2022 training cycle and modestly reduced drawdown, but the same locked rule did not generalize to 2023–2025. The main failure mode was unfilled or only partly filled reload reserve during persistent upward phases, leaving too much value in cash while BTC continued higher. The drawdown reduction was real, but the BTC-accumulation edge was not robust across cycles.
