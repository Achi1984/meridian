# MERIDIAN — Funding Carry V3 older disjoint holdout

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first result from this holdout is inspected.

## Why this test exists

Funding Carry V2 produced favorable economics in its frozen 2022-01-01 → 2026-09-01 repeatability audit, but failed its predeclared minimum sample gate because only 6 completed cycles were admitted versus 8 required. V2 therefore remains retired for new entries.

This V3 research line does **not** lower that gate or reopen V2. Instead it asks whether the exact same carry mechanism also works in a genuinely disjoint, older market period that was not part of the V2 repeatability audit.

Passing this test permits creation of a new prospective **Funding Carry V3 Paper shadow** only. It does not retroactively turn V2 into a pass and never authorizes live or Pionex execution.

## Frozen strategy

Import the exact Funding Carry V2 production policy without changing any economic rule:

- BTCUSDT only
- long BTC spot / short BTC USD-M perpetual, equal base quantity
- $10,000 notional per leg, $20,000 conservative capital
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
- 30d forward-carry checkpoint
- 90d maximum hold
- forward-cost buffer 1.25×
- maximum basis change 1.50%
- maximum marked loss 1.0% of conservative capital

No policy parameter may be altered after seeing this holdout.

## Frozen holdout

- Funding warm-up starts: 2019-12-01T00:00:00Z
- Evaluation starts: 2020-01-01T00:00:00Z
- Evaluation ends: 2021-12-01T00:00:00Z
- This ends exactly where the V2 repeatability audit funding warm-up begins, so no evaluation cycle overlaps the prior audit.
- Data: official Binance Vision BTCUSDT spot 4h, USD-M perpetual 4h, and USD-M fundingRate archives.
- Only archive data available at or before each simulated timestamp may be used.

## Frozen replay harness

The production V2 state machine intentionally stops for review after each closed cycle. For historical sampling only:

1. Start in WAITING_ENTRY.
2. Evaluate exact V2 eligibility on each matched confirmed 4h timestamp.
3. Open only if the exact V2 gate passes.
4. Apply actual funding settlements and exact V2 mark/exit functions.
5. Close only for the exact V2 exit reason.
6. After a completed cycle, wait a fixed 24 hours, instantiate a fresh state with the same frozen policy, and allow another non-overlapping cycle.
7. Never overlap cycles.

The 24h re-arm is research sampling only and does not modify V3's eventual Paper policy.

## Frozen costs and sensitivity

Primary accounting uses the exact V2 fee/slippage model.

A separate post-simulation friction stress subtracts an additional 8 bps of one-leg notional ($8 for a $10,000 leg) per completed cycle. It does not alter eligibility or exits.

## Predeclared holdout gate

The older holdout is supportive enough to permit a new prospective V3 Paper shadow only if **all** conditions pass:

1. At least 3 completed non-overlapping cycles.
2. Aggregate closed-cycle net P&L > $0.
3. Dollar profit factor >= 1.25.
4. At least two-thirds of completed cycles are profitable.
5. Aggregate funding income minus modeled fees/slippage is > $0 before basis P&L.
6. Maximum closed-equity drawdown <= $250.
7. Both calendar years 2020 and 2021 contain at least one completed cycle and each year is net non-negative.
8. No single profitable cycle contributes more than 50% of total positive cycle P&L.
9. Under the +8 bps per-cycle friction stress, aggregate net P&L remains > $0 and stressed PF >= 1.05.
10. Spot/perpetual 4h coverage and funding coverage are complete over the frozen period, with no funding gap > 12h.

## Decision

- PASS: V2 remains retired. A separate Funding Carry V3 **prospective Paper shadow** may be implemented with the same frozen economics and a new independent ledger.
- FAIL: do not create V3. Keep V2 manage-only and stop this carry promotion path.
- No gate, date, side, asset, cost, cooldown, basis band, funding threshold or exit rule may be modified from the observed result.

## Isolation

Research only. No existing Paper state, V2 state, Pionex account, exchange account, live-trading path or API integration is changed by this holdout.
