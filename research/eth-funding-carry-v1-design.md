# MERIDIAN — ETH Funding Carry V1 independent historical validation

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first result from this validation is inspected.

## Research question

Can the conservative, cost-amortized Funding Carry policy that showed promising BTC economics transfer to ETHUSDT and remain profitable across an older, temporally disjoint period?

ETH was previously only a WATCH comparator in a short recent 30/60/90-day funding screen. This test uses an older period ending in 2024 and does not reuse those recent windows as validation evidence.

## Frozen ETH policy

The BTC V2 policy is transferred without tuning any economic threshold. Only the instrument changes from BTCUSDT to ETHUSDT.

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

The 24-hour re-arm after a completed historical cycle is sampling-only and never allows overlapping cycles.

## Frozen validation period

- funding warm-up starts: 2020-01-01T00:00:00Z
- evaluation starts: 2020-02-01T00:00:00Z
- evaluation ends: 2024-01-01T00:00:00Z
- official Binance Vision ETHUSDT spot 4h, USD-M perpetual 4h and fundingRate archives
- only data timestamped at or before each simulated decision point may be used

This period predates the recent 2026 ETH carry screen used as discovery context.

## Accounting

Use the existing Funding Carry V2 state-machine functions with a copied frozen config whose only change is `symbol: ETHUSDT`.

For each cycle record:
- entry/exit timestamps
- hold days
- funding income
- basis P&L
- modeled fees/slippage
- net P&L
- entry funding-cost coverage
- positive funding share
- exit reason

Primary friction uses the frozen V2 fee/slippage model. A separate stress subtracts another 8 bps of one-leg notional ($8 per $10,000 cycle).

## Predeclared validation gate

ETH Funding Carry V1 may become an isolated prospective Paper shadow only if **all** conditions pass:

1. At least 8 completed non-overlapping cycles.
2. Aggregate closed-cycle net P&L > $0.
3. Dollar PF >= 1.50.
4. At least 65% of completed cycles are profitable.
5. Aggregate funding income minus modeled fees/slippage is > $0 before basis P&L.
6. Maximum closed-equity drawdown <= $250.
7. At least three distinct calendar years contain completed cycles and every such year is net positive.
8. No single profitable cycle contributes more than 40% of total positive cycle P&L.
9. Under +8 bps additional friction per cycle, aggregate net P&L remains > $0 and stressed PF >= 1.10.
10. Spot/perpetual 4h and funding coverage are complete for the required warm-up/evaluation period, with no funding gap > 12h.

## Decision

- PASS: implement a separate ETH Funding Carry V1 prospective Paper shadow with its own ledger. No live/Pionex execution.
- FAIL: no ETH Paper bot; do not tune thresholds, dates or cohorts from the result.
- BTC Funding Carry V2 remains manage-only regardless of this ETH result.

## Isolation

Research only. No existing Paper state, BTC V2 state, Pionex account, exchange account or live execution path is modified by this validation.


## Evidence-run data QA note

The first validation run produced favorable cycle economics but failed the predeclared data-adequacy gate because the official Binance Vision ETHUSDT spot 4h archive contains exactly one missing evaluation bar. That run is invalid for promotion regardless of P&L.

To satisfy the already-frozen completeness gate, the evidence loader may reconstruct only the missing 4h spot bar from official Binance Vision lower-timeframe archives for the exact affected UTC day:

1. Prefer complete 1h bars and aggregate exactly four contiguous 1h bars.
2. If the 1h archive cannot reproduce the missing 4h bucket, use complete 1m bars and aggregate exactly 240 one-minute bars.
3. No interpolation, neighboring-price substitution or external venue data is allowed.

No strategy rule, validation date, gate, fee, slippage, entry, exit or re-arm policy is changed. Only a final run with complete reproducible data may pass.
