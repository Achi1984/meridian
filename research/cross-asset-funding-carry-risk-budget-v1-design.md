# MERIDIAN — Cross-Asset Funding Carry Risk Budget V1

Status: PREDECLARED / RESEARCH ONLY / NO PAPER OR LIVE EXECUTION  
Declared: 2026-09-26 before the first historical result is inspected.

## Objective

Test a distinct portfolio-risk architecture for the broad market-neutral carry effect.

Cross-Asset Funding Carry Portfolio V1 showed broad positive economics but failed its frozen portfolio drawdown gate because three simultaneous independent sleeves produced a 1.36% marked drawdown versus a 1.00% limit.

V1 here does NOT alter any per-asset carry rule, asset, cost, date or exit. It tests only a predeclared portfolio admission budget.

## Frozen universe

- BTCUSDT
- ETHUSDT
- SOLUSDT

No asset may be removed or added after evidence.

## Frozen sleeve economics

Every admitted sleeve uses the exact Funding Carry V2 policy, changing only `symbol`:

- conservative sleeve capital $20,000
- $10,000 long spot + $10,000 short USD-M perpetual
- spot fee 10 bps/fill
- perp fee 5 bps/fill
- slippage 3 bps per leg/fill
- 30d funding periods >= 80
- 7d funding periods >= 18
- positive funding share >= 85%
- projected 30d funding >= 2.0× modeled round-trip costs
- entry basis -0.10% to +0.75%
- funding freshness <= 12h
- cadence gap <= 12h
- checkpoint 30d
- max hold 90d
- forward cost buffer 1.25×
- max basis change 1.50%
- max marked loss per sleeve = 1.0% of its $20,000 reference capital

No carry threshold is changed from Funding Carry V2.

## Frozen portfolio risk budget

Portfolio reference capital remains $60,000.  
Frozen marked portfolio drawdown gate remains $600 / 1.00%.

Maximum simultaneous sleeves: **2**.

Risk rationale fixed before evidence:
- each sleeve has an explicit $200 maximum-loss rule;
- two simultaneous sleeves reserve $400;
- the remaining $200 is an execution/basis/funding-mark buffer inside the unchanged $600 portfolio risk budget.

This is not a performance-ranking rule.

## Frozen admission rule

Each asset evaluates exact V2 eligibility independently at every matched confirmed 4h timestamp.

If there are open slots:

1. maintain a cyclic admission pointer over BTC → ETH → SOL → BTC;
2. starting at the pointer, scan each asset once;
3. skip an asset if already active, in its 24h cooldown or V2-ineligible;
4. admit the first eligible asset;
5. after admission, advance the pointer to the next asset;
6. continue scanning only if a second slot remains;
7. never hold more than two baskets.

No asset is ranked by historical P&L, current cost coverage, funding magnitude or any outcome-derived score.

Each asset has its own 24h cooldown after closing. Other assets are unaffected.

## Frozen evidence period

Funding warm-up: `2020-12-01T00:00:00Z`  
Evaluation start: `2021-01-01T00:00:00Z`  
Primary/secondary split: `2023-07-01T00:00:00Z`  
Evaluation end: `2026-06-01T00:00:00Z`

Primary: 2021-01-01 → 2023-07-01  
Secondary: 2023-07-01 → 2026-06-01

Official Binance Vision:
- spot 4h
- USD-M perpetual 4h
- fundingRate archives

Only data known at or before the simulated timestamp may be used.

## Frozen data repair

For a missing official 4h spot/perp bucket:
- exactly four contiguous official 1h bars, otherwise
- exactly 240 official 1m bars,
- otherwise fail data adequacy.

Missing monthly funding files may be replaced only with official Binance Vision daily fundingRate files for the exact missing dates. Funding is never interpolated. Any unresolved funding cadence gap >12h fails.

## Portfolio accounting

At every 4h timestamp:

`portfolio equity = $60,000 + cumulative realized P&L + sum(open basket net P&L)`.

Report:
- total closed cycles, net P&L, PF, win share;
- marked max portfolio drawdown;
- Primary/Secondary statistics;
- per-asset cycles and P&L;
- per-year P&L;
- funding minus modeled costs;
- max simultaneous baskets;
- asset positive-PnL concentration;
- exit-reason distribution.

Post-simulation friction stress: subtract another $8 per closed cycle. It never changes entries or exits.

## Predeclared pass gate

All must pass:

1. >=18 completed cycles overall.
2. Aggregate net P&L > $0.
3. Aggregate PF >= 1.50.
4. >=65% profitable cycles.
5. Funding income minus modeled fees/slippage > $0 before basis P&L.
6. Maximum marked portfolio drawdown <= $600.
7. Primary >=8 cycles, net > $0, PF >=1.25.
8. Secondary >=8 cycles, net > $0, PF >=1.25.
9. Each BTC/ETH/SOL >=4 completed cycles.
10. Each BTC/ETH/SOL net P&L > $0.
11. No asset >70% of positive cycle P&L.
12. >=4 calendar years with closed cycles and every such year net non-negative.
13. +$8/cycle friction stress remains net positive with PF >=1.10.
14. Complete/reproducible data for all assets.
15. Observed maximum simultaneous baskets <=2.

## Decision

PASS permits a separate prospective Cross-Asset Funding Carry Risk Budget V1 Paper shadow with:
- three asset sleeves,
- no more than two active at once,
- the exact frozen admission pointer and V2 rules,
- no live/Pionex execution.

FAIL means no Paper shadow and no post-hoc change to concurrency, pointer, assets, notional, dates, thresholds or risk limit.

## Isolation

Funding Carry V1/V2 remain manage-only. Rotation V1 and Portfolio V1 remain failed/non-promoted research. Challenger/FIB/Elliott/Pionex/live execution are untouched.
