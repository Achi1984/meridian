# MERIDIAN — Funding Carry V2 historical repeatability audit

Status: PREDECLARED AUDIT / RESEARCH ONLY / NO POLICY CHANGE  
Declared: 2026-09-26 before this audit result is inspected.

## Purpose

Funding Carry V2 already exists with a frozen BTC-only policy. This audit does **not** tune or replace that policy. It asks a narrower question:

> If the exact V2 entry/exit policy had been re-armed after each completed cycle, did the carry edge repeat across multiple market regimes after realistic costs?

This is a robustness audit, not an independent holdout. Funding Carry V1/V2 was designed using earlier funding evidence, so historical results below may support or reject repeatability but cannot by themselves justify live capital.

## Frozen production policy under audit

The audit imports `FUNDING_CARRY_V2_CONFIG` and the production V2 state-machine functions directly.

Current frozen policy:
- symbol: BTCUSDT
- long spot / short USD-M-style perpetual, equal base quantity
- $10,000 notional per leg; $20,000 conservative capital
- spot fee 10 bps/fill
- perp fee 5 bps/fill
- slippage 3 bps/leg/fill
- estimated round-trip cost: 42 bps of one-leg notional = $42 at $10,000/leg
- 30d funding history >= 80 periods
- 7d funding history >= 18 periods
- positive funding share >= 85%
- conservative projected 30d funding must cover estimated round-trip costs by >= 2.0x
- entry basis between -0.10% and +0.75%
- funding freshness <= 12h
- funding cadence gap <= 12h
- first carry checkpoint at 30d
- maximum hold 90d
- forward cost buffer 1.25x
- maximum basis change from entry 1.50%
- maximum marked loss 1.0% of conservative capital

No production threshold may be changed from this audit result.

## Historical data and timing

- Source: official Binance Vision public archives: BTCUSDT spot 4h klines, BTCUSDT USD-M perpetual 4h klines, and BTCUSDT USD-M fundingRate archives.
- Audit market window: 2022-01-01T00:00:00Z through 2026-09-01T00:00:00Z.
- Funding warm-up begins 2021-12-01T00:00:00Z.
- Only data timestamped at or before the simulated decision time may be used.
- Evaluation/marking occurs at matched confirmed 4h bar opens. The bar open is treated as the contemporaneous executable reference; V2's frozen slippage/fee model is charged separately.
- Funding settlements are applied only after their published funding timestamp has passed.
- No candle high/low is used for an intrabar exit. This intentionally makes historical risk checks coarser than production monitoring.

### Pre-performance data-source correction

The first audit execution used OKX public funding history and produced **no eligible cycles because the endpoint only returned 227 recent settlements (2026-06-22 onward)**. That run therefore contained no usable strategy-performance sample. Before any cycle P&L was observed, the historical source was corrected to Binance Vision bulk archives, which provide multi-year official fundingRate and kline files and match the venue used by the production Funding Carry V2 runtime.

No V2 policy threshold, cooldown, cost, decision gate or accounting rule changed.

A second data-QA pass found two archive mechanics before any completed strategy cycle existed: some official funding timestamps are offset by 1 ms from the corresponding 4h kline boundary, so mark-price enrichment must map each settlement to its containing 4h bar rather than require exact timestamp equality. Binance Vision also had no daily fundingRate ZIPs for 2026-09-01 through 2026-09-05 at audit time. To keep the evidence fully archive-reproducible, the audit end was moved back five days to 2026-09-01T00:00:00Z. This was done before observing any cycle P&L.

## Repeatability harness

Production V2 intentionally stops for review after one cycle. To obtain a repeatability sample **without changing its trading policy**, the audit uses this research-only harness:

1. Begin in `WAITING_ENTRY`.
2. At each matched 4h timestamp, compute the exact V2 eligibility gate using only trailing funding data and current spot/swap reference prices.
3. If eligible, open with the production V2 open function.
4. While active, apply actual funding settlements, mark spot/perp basis, and call the exact production exit function.
5. When an exit fires, close using the production V2 close function.
6. After a fixed 24-hour research cooldown, instantiate a fresh V2 state with the **same frozen configuration** and allow the next eligible cycle.
7. Cycles never overlap.

The 24-hour re-arm is an audit sampling rule only. It does not modify production behavior.

## Accounting

For every cycle record:
- entry/exit timestamps and hold days
- funding income
- basis P&L
- all modeled fees/slippage
- net P&L
- exit reason
- entry cost coverage and basis
- positive funding share at entry

Portfolio statistics use closed-cycle P&L only. Calendar-year attribution uses each cycle's close timestamp.

A friction stress is computed **after** the frozen simulation by subtracting an extra 8 bps of one-leg notional ($8 per $10,000 cycle) from every completed cycle. This is a sensitivity check only; it does not alter the production gate.

## Predeclared audit gate

Funding Carry V2 is considered historically repeatable only if **all** conditions pass:

1. At least 8 completed non-overlapping cycles.
2. Aggregate net P&L > $0.
3. Dollar profit factor >= 1.50.
4. At least 65% of completed cycles are profitable.
5. Aggregate funding income minus modeled fees/slippage is > $0 even before basis P&L.
6. Maximum closed-equity drawdown <= $250 (1.25% of conservative capital).
7. At least 3 distinct calendar years contain completed cycles and each such year is net positive.
8. No single profitable cycle contributes more than 40% of the sum of all positive cycle P&L.
9. Under the +8 bps round-trip friction stress, aggregate net P&L remains > $0 and stressed dollar PF >= 1.10.
10. Spot/perpetual 4h coverage is complete over the audit market window; funding history covers the full 30-day warm-up through the audit end; and no funding gap exceeds 12 hours.

## Decision rule

- **PASS:** keep V2 as an active prospective Paper candidate under its existing frozen entry gate. Historical pass does not auto-open a cycle and does not permit live execution.
- **FAIL:** retire V2 as a new-entry candidate. Any already-open frozen Paper cycle is managed to its existing exit rule, then sealed.
- No threshold, asset, side, fee, slippage, cooldown, basis band, funding persistence rule, hold period or exit rule may be altered using this result.

## Isolation

This audit changes no Paper ledger, no live execution, no Pionex integration, no exchange account and no existing V2 production state.
