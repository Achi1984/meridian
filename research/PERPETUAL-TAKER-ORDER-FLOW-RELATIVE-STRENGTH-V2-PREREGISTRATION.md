# Perpetual Taker Order Flow Relative Strength V2 — Frozen Feature Validation Protocol

Status: **PREREGISTERED BEFORE FIRST V2 VALIDATION RESULT**  
Ruleset: `PERPETUAL-TAKER-ORDER-FLOW-RELATIVE-STRENGTH-V2-FROZEN`  
Research only: **true**  
Execution impact: **false**  
Auto-promotion: **false**  
Strategy PnL in V2: **forbidden**

## Why V2 exists

V1 tested a two-sided weekly portfolio and failed its frozen DEVELOPMENT gate. The failure may not be rescued inside V1 by deleting the short side, dropping assets, changing the 168-hour FLOW signal, moving dates or relaxing gates.

V1 nevertheless produced one diagnostic that is logically prior to portfolio construction: high-FLOW assets outperformed low-FLOW assets by an average **0.9935 percentage points** in the following week during the seen DEVELOPMENT interval. That observation is hypothesis-generating only.

Independent external motivation also exists for the directional feature itself: published / current research on cryptocurrency order flow studies lagged order flow as a cross-sectional return predictor and separates predictive information from contemporaneous price impact.

V2 therefore does **not** test a long-only rescue and does **not** calculate strategy PnL. It asks only whether the already defined lagged FLOW ranking independently predicts the cross-section of next-week returns in the untouched 2025–2026 interval.

## Parent lineage locked for V2

Parent V1 research engine Git blob:
`580f8885118aa1bfcccd6c77a431d5b7835e8bba`

Parent V1 DEVELOPMENT result:
`PERPETUAL-TAKER-ORDER-FLOW-V1-DEVELOPMENT-RESULT.md`

V2 reuses, unchanged:
- exact 12-asset universe;
- Saturday 00:00 UTC weekly anchor;
- exact 168 completed 1-hour FLOW lookback;
- quote-volume normalization;
- continuation direction;
- exact next-week open-to-open outcome;
- top-2 / bottom-2 diagnostic baskets.

V2 does not reuse V1 portfolio weights, funding accounting, transaction costs, long/short PnL, Profit Factor, Sharpe or drawdown gates because no portfolio is formed.

## Frozen universe

Exactly:
- BTC
- ETH
- BNB
- SOL
- XRP
- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX

Every validation week requires all 12 assets. No asset selection after results.

## Public source

Binance Vision public USD-M monthly archives only:
- 1h perpetual klines;
- fields required: open time, open/high/low/close, quote asset volume, taker-buy quote asset volume.

No private API. No credentials. No funding data. No synthetic backfill. No interpolation. No nearest-neighbor fill.

Raw validation source months:
- 2025-01 through 2026-08 inclusive.

Historical validation collection/evaluation is blocked on pull requests. It requires a later documentation-only authorization commit after this exact implementation passes CI and review.

## Frozen validation calendar

Weekly anchor: **Saturday 00:00 UTC**.

Entry/outcome anchors:
- `2025-01-11 <= t < 2026-08-29`
- expected weeks: **85**
- last feature anchor: 2026-08-22 00:00 UTC
- final next-week outcome endpoint: 2026-08-29 00:00 UTC

This is the V1 temporal interval that remained unloaded after V1 DEVELOPMENT failed. It must remain unseen until the separately authorized V2 feature-validation run.

## Frozen lagged FLOW feature

For asset i at weekly anchor t, use exactly the 168 completed 1h bars in:

`[t-168h, t)`

For each hour:
- Q = total quote asset volume
- B = taker-buy quote asset volume

`SIGNED_FLOW = 2 * sum(B) - sum(Q)`

`FLOW = SIGNED_FLOW / sum(Q)`

Requirements:
- exactly 168 hourly bars;
- exact 1-hour cadence;
- finite internally consistent OHLC;
- Q finite and >= 0;
- B finite, >= 0 and <= Q;
- total Q > 0.

Higher FLOW is preregistered to predict higher next-week return. No sign flip.

## Frozen outcome

For every asset at anchor t:

`NEXT_WEEK_RETURN = OPEN(t+7d) / OPEN(t) - 1`

Both opens must exist exactly. No intraweek information may enter the signal.

No portfolio positions are created. No funding or costs are applied. No PnL is calculated.

## Frozen weekly diagnostics

For each of the 85 weeks:

1. **Rank IC** = Spearman correlation across all 12 assets between FLOW and NEXT_WEEK_RETURN.
2. **Top2-minus-Bottom2 spread** = mean next-week return of the two highest-FLOW assets minus mean next-week return of the two lowest-FLOW assets.
3. top-2 and bottom-2 identities are deterministic: FLOW rank, symbol ascending as tie-break.

## Frozen aggregate inference

Across the 85 non-overlapping weekly outcome periods:

- mean weekly Rank IC;
- median weekly Rank IC;
- positive-IC week count;
- mean Top2-minus-Bottom2 spread;
- median Top2-minus-Bottom2 spread;
- positive-spread week count;
- one-sided Newey-West t-statistic for mean weekly Rank IC, lag **4**;
- one-sided Newey-West t-statistic for mean weekly spread, lag **4**;
- five chronological blocks, exactly 17 weeks each;
- positive mean-IC block count;
- positive mean-spread block count.

Newey-West lag 4 is frozen before validation to allow approximately one month of serial dependence. No alternative lag grid may be inspected inside V2.

## Frozen feature-validation gate

PASS requires all conditions:

- exactly **85** weekly observations;
- all 12 assets valid every week;
- no data-integrity failure;
- mean weekly Rank IC > 0;
- Newey-West(4) t-stat for mean Rank IC >= **1.645**;
- mean Top2-minus-Bottom2 next-week return > 0;
- Newey-West(4) t-stat for mean spread >= **1.645**;
- at least **3 of 5** chronological blocks have positive mean Rank IC;
- at least **3 of 5** chronological blocks have positive mean spread.

PASS decision:
`FEATURE_VALIDATION_PASS_STRATEGY_DESIGN_ALLOWED`

FAIL decision:
`FEATURE_VALIDATION_FAIL_RESEARCH_STOP`

A PASS authorizes only a separately named, separately preregistered strategy-design stage. It does not authorize choosing a long-only portfolio, any weight, any threshold, Paper trading or live trading.

## Anti-overfitting

After the first V2 validation result, do not:
- change the 168h FLOW definition;
- change Saturday anchors;
- change the 7-day outcome;
- drop or replace assets;
- change top/bottom basket size;
- flip the signal;
- change Newey-West lag;
- change 1.645 threshold;
- change 3/5 block requirements;
- move or extend dates;
- add price, funding, volatility, basis, OI, sentiment or market-state filters;
- inspect subperiods and then redefine the gate;
- construct strategy PnL after a V2 FAIL.

Any further hypothesis requires a new frozen ruleset.

## Safety

This V2 stage is feature research only:
- no exchange credentials;
- no order placement;
- no wallet mutation;
- no leverage or liquidation logic;
- no Paper-bot mutation;
- no automatic promotion.
