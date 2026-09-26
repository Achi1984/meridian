# MERIDIAN — ETH Funding Carry V2 later disjoint holdout

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first result from this holdout is inspected.

## Purpose

ETH Funding Carry V1 showed strong economics from 2020-02-01 through 2024-01-01, but failed its predeclared data-adequacy gate because one official Binance Vision ETHUSDT spot 4h candle could not be reproduced even from official 1h/1m archives.

This V2 holdout does not waive that failure and does not reuse the invalid V1 sample for promotion. It tests the **same frozen ETH carry policy** on a later, disjoint interval with its own data-integrity gate.

Passing this holdout permits a new isolated prospective ETH Funding Carry V2 Paper shadow. It never permits live or Pionex execution.

## Frozen ETH policy

Only the instrument differs from BTC Funding Carry V2; all economic rules remain unchanged:

- ETHUSDT only
- long ETH spot / short ETH USD-M perpetual, equal base quantity
- $10,000 notional per leg; $20,000 conservative capital
- spot fee 10 bps/fill
- perp fee 5 bps/fill
- slippage 3 bps per leg/fill
- 30d funding history >= 80 periods
- 7d funding history >= 18 periods
- positive funding share >= 85%
- conservative projected 30d funding >= 2.0× modeled round-trip costs
- entry basis -0.10% to +0.75%
- funding freshness <= 12h
- funding cadence gap <= 12h
- first forward-carry checkpoint at 30d
- maximum hold 90d
- forward cost buffer 1.25×
- maximum basis change from entry 1.50%
- maximum marked loss 1.0% of conservative capital

The 24-hour re-arm after a closed historical cycle is a sampling harness only. Cycles never overlap.

## Frozen holdout

- funding warm-up starts: 2023-12-01T00:00:00Z
- evaluation starts: 2024-01-01T00:00:00Z
- evaluation ends: 2026-06-01T00:00:00Z
- official Binance Vision ETHUSDT spot 4h, USD-M perpetual 4h and fundingRate archives
- only information timestamped at or before each simulated decision point may be used

This interval is disjoint from ETH Funding Carry V1's evaluation period and ends before the recent 2026 discovery screen used as current-context research.

## Accounting

Use the existing Funding Carry V2 state-machine functions with a copied config whose only instrument change is `symbol: ETHUSDT`.

For every completed cycle report:
- opened/closed timestamps
- holding days
- entry basis
- entry cost coverage
- positive funding share
- funding income
- basis P&L
- modeled fees/slippage
- net P&L
- exit reason
- maximum observed funding cadence gap

Primary accounting uses the frozen V2 fee/slippage model. A separate stress subtracts an additional 8 bps of one-leg notional ($8 per $10,000 cycle).

## Predeclared holdout gate

ETH Funding Carry V2 may become an isolated prospective Paper shadow only if **all** conditions pass:

1. At least 8 completed non-overlapping cycles.
2. Aggregate closed-cycle net P&L > $0.
3. Dollar profit factor >= 1.50.
4. At least 65% of completed cycles are profitable.
5. Aggregate funding income minus modeled fees/slippage is > $0 before basis P&L.
6. Maximum closed-equity drawdown <= $250.
7. At least two distinct calendar years contain completed cycles and every such year is net positive.
8. No single profitable cycle contributes more than 40% of total positive cycle P&L.
9. Under +8 bps additional friction per completed cycle, aggregate net P&L remains > $0 and stressed PF >= 1.10.
10. Spot/perpetual 4h and funding coverage are complete for the required warm-up/evaluation interval, with no funding gap > 12h.

## Decision

- PASS: implement a **separate ETH Funding Carry V2 prospective Paper shadow** with its own state/ledger and no live execution.
- FAIL: no ETH Paper bot; do not alter dates, sample threshold, funding gate, basis band, costs, exits or cohorts after observing the result.
- BTC Funding Carry V2 remains manage-only regardless of this result.
- ETH Funding Carry V1 remains a historical data-gate failure regardless of this result.

## Isolation

Research only. No existing Paper state, BTC Funding Carry state, Pionex integration, exchange account or live execution path is changed by this holdout.
