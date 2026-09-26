# MERIDIAN — Cross-Asset Funding Carry Portfolio V1

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a distinct portfolio architecture for the market-neutral funding-carry effect.

Unlike Rotation V1, this hypothesis never chooses a "best" asset. BTCUSDT, ETHUSDT and SOLUSDT are three equal, independent sleeves. Each sleeve may open only when it independently passes the exact frozen Funding Carry V2 gate.

This architecture is predeclared after Rotation V1 and therefore its historical evidence may only justify a **new prospective Paper shadow**. It cannot retroactively promote any prior carry bot.

## Frozen universe and capital

Exactly:
- BTCUSDT
- ETHUSDT
- SOLUSDT

Each sleeve:
- conservative capital: $20,000
- long spot notional: $10,000
- short USD-M perpetual notional: $10,000

Portfolio conservative reference capital: $60,000.

At most one basket per asset may be open. Up to three baskets may overlap if they independently qualify. No cross-asset selector, ranking, weighting or capital transfer is allowed.

## Frozen per-sleeve policy

Every sleeve uses the exact Funding Carry V2 economics, with only `symbol` changed:

- spot fee 10 bps/fill
- perpetual fee 5 bps/fill
- slippage 3 bps per leg/fill
- 30d funding history >= 80 periods
- 7d funding history >= 18 periods
- positive funding share >= 85%
- conservative projected 30d funding >= 2.0× modeled round-trip costs
- executable entry basis -0.10% to +0.75%
- funding freshness <= 12h
- maximum funding cadence gap <= 12h
- forward-carry checkpoint at 30d
- maximum hold 90d
- forward cost buffer 1.25×
- maximum basis change from entry 1.50%
- maximum marked loss 1.0% of that sleeve's $20,000 reference capital

After a sleeve closes, only that same asset has a fixed 24h research cooldown. Other sleeves are unaffected.

## Frozen evidence period

Funding warm-up: `2020-12-01T00:00:00Z`  
Evaluation start: `2021-01-01T00:00:00Z`  
Primary/secondary split: `2023-07-01T00:00:00Z`  
Evaluation end: `2026-06-01T00:00:00Z`

Primary: 2021-01-01 → 2023-07-01  
Secondary: 2023-07-01 → 2026-06-01

Data:
- official Binance Vision spot 4h
- official Binance Vision USD-M perpetual 4h
- official Binance Vision USD-M fundingRate

Only information available at or before the simulated 4h timestamp may be used.

## Frozen data-repair policy

For a missing official 4h market bucket:
1. aggregate exactly four contiguous official Binance Vision 1h bars for that bucket;
2. if impossible, aggregate exactly 240 official 1m bars;
3. otherwise the data gate fails.

If a monthly official fundingRate archive is missing, official Binance Vision daily fundingRate files may fill exactly the missing dates. Funding is never interpolated. Any unresolved funding cadence gap >12h fails.

Spot/perpetual market data must be complete over the evaluation interval. Funding data must be complete from the warm-up start through evaluation end.

## Portfolio accounting

All entries, settlements, marks and exits use the exact V2 state-machine functions.

Portfolio equity at every 4h timestamp is:

`$60,000 + cumulative realized closed-cycle P&L + sum(current open-basket net P&L)`.

This produces a true time-series portfolio drawdown while overlapping baskets are open.

Report:
- total closed cycles;
- portfolio net P&L, PF, profitable share;
- maximum 4h marked portfolio drawdown;
- funding income minus modeled costs before basis P&L;
- primary and secondary segment cycle results;
- per-asset cycles, net P&L and PF;
- per-year closed-cycle results;
- maximum simultaneous baskets;
- asset share of positive P&L;
- exit-reason distribution.

A post-simulation stress subtracts another $8 from every closed cycle. It does not change entry/exit timing.

## Predeclared pass gate

All must pass:

1. At least 18 completed cycles overall.
2. Aggregate portfolio net P&L > $0.
3. Aggregate dollar PF >= 1.50.
4. At least 65% of closed cycles profitable.
5. Aggregate funding income minus modeled fees/slippage > $0 before basis P&L.
6. Maximum marked portfolio drawdown <= $600 (1.0% of $60,000 reference capital).
7. Primary contains at least 8 completed cycles, net P&L > $0 and PF >= 1.25.
8. Secondary contains at least 8 completed cycles, net P&L > $0 and PF >= 1.25.
9. Each of BTC, ETH and SOL has at least 4 completed cycles.
10. Each of BTC, ETH and SOL has positive net P&L.
11. No one asset contributes more than 70% of total positive closed-cycle P&L.
12. At least four distinct calendar years contain completed cycles and every such year is net non-negative.
13. Under +$8 per completed cycle friction stress, aggregate net P&L remains > $0 and stressed PF >= 1.10.
14. Data adequacy passes for all three assets.

## Decision

PASS:
- permits implementation of a separate prospective **Cross-Asset Funding Carry Portfolio V1 Paper shadow**;
- the Paper shadow keeps three independent ledgers/sleeves and exact frozen rules;
- no live or Pionex execution.

FAIL:
- no Paper shadow;
- do not drop a losing asset, reduce sample gates, rank assets, alter thresholds, costs, dates or concurrency based on the result.

## Isolation

Funding Carry V1/V2 remain manage-only. Rotation V1 remains a near-pass with no promotion. Challenger/FIB/Elliott/Pionex/live execution are untouched.
