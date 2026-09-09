# MERIDIAN R35 — Funding Carry V1 evidence

Generated: 2026-09-09T19:36:06.262Z

Research only. No Paper or live execution. Long spot and short USD-M perpetual with equal base quantity. Results include funding, start/end basis change, four fills, 5 bps fee and 3 bps slippage per fill. Return uses conservative capital of $20,000 for $10,000 on each leg.

## Decision

- **BTCUSDT: PAPER CANDIDATE.** Positive after costs in all three overlapping windows and the strongest minimum result. It is the only asset admitted to prospective Paper validation.
- **ETHUSDT: WATCH.** Positive in all windows, but the conservative annualized result remained below BTC. It is retained as a comparator, not started in Paper.
- **SOLUSDT: REJECT.** Negative over 30 days and only marginally positive over 60/90 days. The edge is too close to execution-cost assumptions.

| Window | Asset | Funding | Basis P&L | Costs | Net | Capital return | Annualized | Decision |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 30d | BTCUSDT | $70.64 | $1.18 | $35.63 | $36.19 | 0.181% | 2.201% | PROSPECTIVE_CANDIDATE |
| 30d | ETHUSDT | $62.32 | $1.33 | $37.19 | $26.47 | 0.132% | 1.610% | PROSPECTIVE_CANDIDATE |
| 30d | SOLUSDT | $31.09 | $2.64 | $37.79 | -$4.06 | -0.020% | -0.247% | REJECT |
| 60d | BTCUSDT | $119.14 | $0.35 | $35.50 | $83.99 | 0.420% | 2.555% | PROSPECTIVE_CANDIDATE |
| 60d | ETHUSDT | $92.99 | $1.20 | $37.73 | $56.47 | 0.282% | 1.717% | PROSPECTIVE_CANDIDATE |
| 60d | SOLUSDT | $54.86 | $1.28 | $37.15 | $18.98 | 0.095% | 0.577% | PROSPECTIVE_CANDIDATE |
| 90d | BTCUSDT | $155.03 | -$0.72 | $35.76 | $118.55 | 0.593% | 2.404% | PROSPECTIVE_CANDIDATE |
| 90d | ETHUSDT | $124.28 | $3.62 | $39.57 | $88.33 | 0.442% | 1.791% | PROSPECTIVE_CANDIDATE |
| 90d | SOLUSDT | $68.89 | $0.00 | $40.73 | $28.16 | 0.141% | 0.571% | PROSPECTIVE_CANDIDATE |

A positive historical window is only a screening result. Prospective Paper eligibility requires positive net carry after costs, adequate margin buffer, a rule for funding reversal, basis divergence limits and no post-hoc asset selection.

The 30/60/90-day windows overlap and are therefore robustness views, not three independent experiments. The next stage must keep BTC rules frozen and assess only new funding settlements prospectively.

Sources: [Binance funding-rate history API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) and [Binance funding-rate arbitrage explanation and risks](https://www.binance.com/en/support/faq/detail/f330e17d6fc04679b9b21d6f9350e787).
