# MERIDIAN — Cross-Asset Funding Carry Rotation V1

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test whether the strongest robust MERIDIAN research effect so far — cost-amortized market-neutral funding carry — becomes more repeatable when capital can rotate prospectively among the original R35 carry universe instead of waiting only on BTC.

This is a new portfolio-selection hypothesis. It does not lower any BTC/ETH single-asset gate and does not retroactively promote Funding Carry V1/V2.

## Frozen universe

Exactly the original R35 universe:

- BTCUSDT
- ETHUSDT
- SOLUSDT

No asset may be removed after evidence. No additional asset may be added after evidence.

## Frozen per-asset eligibility

Each asset is evaluated independently using the exact Funding Carry V2 economic policy, with only `symbol` changed:

- long spot / short USD-M perpetual, equal base quantity
- $10,000 notional per leg; $20,000 conservative capital
- spot fee 10 bps/fill
- perp fee 5 bps/fill
- slippage 3 bps per leg/fill
- 30d funding history >= 80 periods
- 7d funding history >= 18 periods
- positive funding share >= 85%
- conservative projected 30d funding >= 2.0× modeled round-trip costs
- executable entry basis between -0.10% and +0.75%
- funding freshness <= 12h
- maximum funding cadence gap <= 12h
- forward carry checkpoint at 30d
- maximum hold 90d
- forward cost buffer 1.25×
- maximum basis change from entry 1.50%
- maximum marked loss 1.0% of conservative capital

No economic threshold is changed from Funding Carry V2.

## Frozen selector

At every matched confirmed 4h timestamp when no basket is open and the 24h research cooldown has elapsed:

1. Evaluate all three assets using only information known at that timestamp.
2. Discard every asset that fails any exact V2 eligibility rule.
3. Rank remaining assets by `grossCostCoverage`, highest first.
4. Tie break, if coverage is exactly equal after full internal precision: BTCUSDT, then ETHUSDT, then SOLUSDT.
5. Open exactly one basket in the selected asset at that timestamp.
6. While a basket is active, do not evaluate a replacement entry.
7. Manage the basket with the exact V2 funding, mark and exit functions.
8. After a completed cycle, wait exactly 24 hours before the selector may open another basket.

Only one basket may be active across the whole portfolio. There is no pyramiding or simultaneous asset exposure.

## Frozen evidence period

Funding warm-up starts: `2020-12-01T00:00:00Z`  
Evaluation starts: `2021-01-01T00:00:00Z`  
Primary/secondary split: `2023-07-01T00:00:00Z`  
Evaluation ends: `2026-06-01T00:00:00Z`

- Primary: 2021-01-01 → 2023-07-01
- Secondary: 2023-07-01 → 2026-06-01

Data source:
- official Binance Vision spot 4h archives
- official Binance Vision USD-M perpetual 4h archives
- official Binance Vision USD-M fundingRate archives

Only data available at or before the simulated timestamp may be used.

## Frozen data-repair policy

If an official 4h spot or perpetual candle is absent:

1. repair only that exact bucket from official Binance Vision 1h bars;
2. require exactly four contiguous 1h bars;
3. if 1h cannot reproduce it, use exactly 240 official 1m bars;
4. otherwise data adequacy fails.

Funding settlements are never interpolated. If a monthly official fundingRate ZIP is unavailable, the loader may use the official Binance Vision daily fundingRate ZIPs for exactly the missing calendar days. Any unresolved funding gap over 12h fails data adequacy.

## Accounting

All cycle P&L comes from the exact V2 state-machine accounting:
- actual historical funding settlements;
- spot/perpetual basis P&L;
- entry and exit fees;
- modeled slippage.

Report:
- total cycles and P&L;
- PF, profitable-cycle share and closed-equity drawdown;
- funding income minus modeled costs before basis P&L;
- per-asset cycles/P&L;
- per-calendar-year cycles/P&L;
- primary and secondary segment statistics;
- selected-asset concentration by cycle count and positive P&L;
- entry cost-coverage distribution;
- exit-reason distribution.

A separate fixed stress subtracts an additional $8 per completed cycle (8 bps of one $10k leg). This stress does not change selection or exits.

## Predeclared pass gate

All conditions must pass before a prospective Paper shadow can be created:

1. At least 12 completed non-overlapping cycles overall.
2. Aggregate closed-cycle net P&L > $0.
3. Aggregate dollar PF >= 1.50.
4. At least 65% of completed cycles profitable.
5. Funding income minus modeled fees/slippage > $0 before basis P&L.
6. Maximum closed-equity drawdown <= $300.
7. Primary has at least 5 cycles, net P&L > $0 and PF >= 1.25.
8. Secondary has at least 5 cycles, net P&L > $0 and PF >= 1.25.
9. At least two of BTC/ETH/SOL each have at least 2 completed cycles and positive net P&L.
10. No one asset contributes more than 70% of completed cycles.
11. No one asset contributes more than 70% of total positive cycle P&L.
12. At least four distinct calendar years contain completed cycles and every such year is net non-negative.
13. Under +$8 per-cycle friction stress, aggregate P&L remains > $0 and stressed PF >= 1.10.
14. Spot/perpetual 4h data are complete/reproducible for every asset over the evaluation interval; funding data are complete/reproducible from the 2020-12-01 warm-up start through the evaluation end, with no funding gap >12h.

## Decision

- PASS: permit a separate, isolated Cross-Asset Funding Carry Rotation V1 prospective Paper shadow with its own ledger.
- FAIL: no Paper shadow. Do not remove SOL, privilege ETH/BTC, alter the selector, dates, costs, funding thresholds, basis band or concentration gates based on the result.
- Passing never authorizes live or Pionex execution.

## Isolation

Research only. Funding Carry V1/V2 remain manage-only. Challenger/FIB/Elliott/Pionex/live execution are untouched.


## Evidence-run data QA correction

The first evidence execution is invalid for promotion because the loader mistakenly dropped funding rows from the December 2020 warm-up whenever no contemporaneous 4h perpetual mark existed. A mark price is not required for the V2 eligibility calculation; it is required only when applying funding settlements to an already-open basket.

The evidence loader is corrected to preserve every official funding rate for eligibility/data-adequacy checks and attach a mark price only where a settlement can actually belong to an evaluation-period open basket. This is a data-join correction only. No symbol, selector, threshold, cost, evidence date, exit rule or decision gate changes after the observed first-run P&L.
