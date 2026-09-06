# MERIDIAN FIB Level Bot V3 — Daily-Anchor / 4h Execution Design

Status: RESEARCH ONLY — NO PROMOTION — NO EXECUTION IMPACT.

This design is committed before V3 market data are fetched or results inspected.

## Hypothesis

V1/V2 mapped every confirmed 4h swing and failed replication. V3 tests one structurally different, price-only thesis: Fibonacci retracements may be more reliable when the impulse is anchored on a confirmed daily swing while orders are evaluated on 4h candles.

This is not a repair of V1/V2 failure cohorts. No V1/V2 asset, side, regime or result is used as a filter.

## Frozen strategy

- Build UTC-aligned daily candles from public Coinbase 1h candles.
- Confirm daily pivots with two complete daily bars on each side; a pivot becomes usable only after the second right-hand daily bar has closed.
- Pair alternating confirmed daily pivots chronologically. LOW → HIGH defines LONG; HIGH → LOW defines SHORT.
- No ATR, trend, momentum, volume, regime or volatility condition participates in setup creation or entry.
- Evaluate orders only on 4h candles after pivot confirmation.
- Equal 25% limit tranches at Fibonacci retracements 0.382 / 0.500 / 0.618 / 0.786.
- Invalidation/stop at 1.000.
- TP1 at 0.236 closes 50% of each open tranche; TP2 at 0.000 closes the remainder.
- Fixed 0.10% round-trip friction.
- Conservative gap fills, stop-first ambiguity handling and no target exit on a candle that adds a fill.
- One active basket per symbol. A new confirmed daily impulse may replace only an unfilled pending map; it never displaces an open basket.

The only changed hypothesis versus V1/V2 is the daily anchor with 4h execution. FIB levels, tranche weights, stop, targets, costs and conservative accounting remain unchanged.

## Locked universe and periods

- Universe: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, ADAUSDT, AVAXUSDT, LINKUSDT.
- Primary historical replication period: basket closes from `2023-09-06T14:15:00Z` inclusive to `2024-09-06T14:15:00Z` exclusive. This period was not used by V1/V2 evidence.
- Secondary stability period: `2024-09-06T14:15:00Z` through `2026-09-06T14:15:00Z`; reported by chronological year and aggregate. It is already observed research history and cannot confirm V3 independently.
- Warm-up starts 120 days before the primary period.
- Prospective holdout begins `2026-09-06T14:15:00Z` and remains excluded.

## Required reporting

- PF, expectancy R, net R, max drawdown R, win rate and basket count;
- setups, filled/unfilled maps, fill rate, open baskets and median/time-in-market opportunity cost;
- three chronological folds in the primary period;
- LONG/SHORT, asset, descriptive regime and core/expansion concentration;
- deepest FIB touch only as realized-path telemetry, never as an entry decision;
- primary sample adequate at 100 closed baskets; side/asset cohorts descriptive below 30.

## Predeclared historical gate

Historical robustness requires all of:

1. primary sample >=100 closed baskets;
2. primary PF >=1.10 and expectancy >0;
3. all three primary chronological folds have PF >1 and expectancy >0;
4. LONG and SHORT each have PF >1 and expectancy >0 with at least 30 baskets;
5. at least five of seven assets have PF >1 and expectancy >0; each counted asset needs at least 15 baskets because daily anchoring lowers frequency;
6. core and expansion groups both have non-negative expectancy;
7. no single asset contributes more than 40% of positive net R;
8. each secondary chronological year has PF >1 and expectancy >0;
9. the secondary two-year aggregate has PF >1 and expectancy >0.

Failure means stop this exact V3 thesis without threshold search. Passing every historical gate still does not permit Paper/live promotion.

## Prohibited reactions

Do not tune pivot width, periods, assets, sides, FIB levels, tranche weights, stop, targets or costs after inspecting results. Do not create LONG-only, SHORT-only, asset-only or regime-only variants from cohort outcomes. Any later change requires a separately predeclared structural hypothesis.
