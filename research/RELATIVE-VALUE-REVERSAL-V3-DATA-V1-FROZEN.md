# Relative-Value / Beta-Neutral Perpetual Reversal V3 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- MERIDIAN main after PR #316
- Reversal V1 remains immutable discovery-fail evidence.
- Reversal V2 remains immutable, non-promotable seen evidence because its first observed run had ambiguous repository-level preregistration provenance.

## Purpose

Build a strategy-neutral public-data foundation for a later, separately preregistered `Relative-Value / Beta-Neutral Perpetual Reversal V3`.

V1 and V2 both showed a positive loser-minus-winner next-week relative spread, while the profitable absolute leg flipped between versions. This motivates a new relative-value hypothesis that will later test whether broad-market exposure can be separated from the cross-sectional reversal spread.

This foundation does **not** test that hypothesis.

It must not:
- calculate reversal ranks;
- calculate market betas;
- calculate residual returns;
- calculate long/short weights;
- calculate strategy PnL;
- infer a beta lookback from results;
- infer a residual-return formation horizon;
- infer a hedge ratio;
- infer a cost threshold;
- remove or replace a failed candidate after coverage is observed.

## External design motivation fixed before V3 PnL

Two sources motivate the later protocol without defining its profitability:

1. Sila, Mark, Kristoufek et al. (2025), *Crypto market betas: the limits of predictability and hedging*, Financial Innovation 11:107.
   - crypto betas are materially less stable/predictable than US equity betas;
   - winsorized and Bayesian-shrunk estimators can improve beta forecasting;
   - market-index specification materially affects crypto beta estimates.

2. Liu, Tsyvinski & Wu (2022), *Common Risk Factors in Cryptocurrency*, Journal of Finance 77(2).
   - cryptocurrency market, size and momentum factors capture substantial cross-sectional return variation.

V3 will therefore require a broad, fixed market benchmark and a robust beta method frozen before first PnL. This data stage does not choose the final estimator.

## Frozen candidate trading universe

Frozen before coverage inspection and disjoint from the 23-asset V1/V2 reversal universe:

- ALGO
- SAND
- MANA
- AXS
- RUNE
- SUSHI
- DYDX
- APE
- ICP
- THETA
- EGLD
- KAVA
- CHZ
- ZEC
- COMP
- MKR

Count: **16**

No candidate may be added, removed, substituted or renamed after foundation results.

These names are candidates only. A later V3 strategy may use only candidates that satisfy the objective readiness rule below.

## Frozen market-factor benchmark set

Benchmark-only assets:

- BTC
- ETH
- BNB
- SOL
- XRP

Count: **5**

These assets are **not V3 trading candidates** in this foundation. They exist only to establish complete public daily price coverage for a later fixed broad-market factor.

No benchmark asset may be replaced after results.

## Official public source

Binance Vision USD-M monthly archives only:

Candidate assets:
- `klines/{SYMBOL}/1d`
- `fundingRate/{SYMBOL}`

Benchmark assets:
- `klines/{SYMBOL}/1d`

No private API, credentials, account state, synthetic backfill, interpolation or nearest-neighbor reconstruction.

## Frozen audit interval

- 2022-01 through 2026-08 inclusive
- 56 completed calendar months

This interval is intentionally longer than the earliest possible later V3 validation period so a one-year beta-history requirement can be frozen without peeking at V3 PnL.

## Daily perpetual-price validation

For every available asset-month:

- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing open timestamps;
- no duplicate timestamps;
- exact 24-hour cadence;
- all rows inside the UTC calendar month.

A month is `PRICE_COMPLETE` only when:
- first daily bar opens exactly at month start;
- last daily bar opens exactly one day before month end;
- row count equals UTC calendar-day count.

No partial month is promoted to complete.

## Candidate funding validation

For every available candidate-month:

- finite realized funding rates;
- strictly increasing timestamps;
- no duplicates;
- at least 60 observations for a complete month;
- first month-boundary gap <=12h;
- last month-boundary gap <=12h;
- maximum inter-event/boundary gap <=12h.

A month is `FUNDING_COMPLETE` only when all checks pass.

## Candidate joint core state

A candidate-month is `V3_CANDIDATE_CORE_COMPLETE` only when:
- PRICE_COMPLETE;
- FUNDING_COMPLETE;
- zero unexpected transport errors for those archives.

## Frozen candidate readiness rule

A candidate is `V3_REVERSAL_DATA_READY` only when:

- every month from **2023-01 through 2026-08** is V3_CANDIDATE_CORE_COMPLETE;
- exactly 44 consecutive core-complete months are therefore available across that mandatory interval;
- there are no internal gaps;
- coverage remains complete through 2026-08.

The pre-2023 portion is recorded for provenance but is not required for readiness.

This readiness rule is data-only. It does not authorize a signal.

## Frozen benchmark readiness rule

A benchmark asset is `V3_MARKET_FACTOR_READY` only when:

- all **56/56** monthly daily-price archives from 2022-01 through 2026-08 are PRICE_COMPLETE;
- no internal gap exists;
- zero unexpected transport errors exist.

No funding history is required for benchmark-only assets at foundation stage.

## Foundation acceptance gate

PASS requires:

- all 16 frozen candidate assets represented in output, including failures;
- all 5 frozen benchmark assets represented in output, including failures;
- zero unrecorded/unexpected transport errors;
- at least **12 of 16** candidates are V3_REVERSAL_DATA_READY;
- all **5 of 5** benchmark assets are V3_MARKET_FACTOR_READY;
- no strategy PnL;
- no reversal ranking;
- no beta estimation;
- no residual-return calculation;
- no portfolio weighting;
- no synthetic backfill.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen V3 strategy protocol.

## Required output

Per candidate:
- source archive URLs/status;
- first/last official price timestamp;
- first/last core-complete month;
- complete/partial/missing month counts;
- 2023-01..2026-08 mandatory-interval gap list;
- funding row/gap diagnostics;
- V3_REVERSAL_DATA_READY.

Per benchmark:
- source archive URLs/status;
- complete/partial/missing daily-price months;
- internal gap list;
- V3_MARKET_FACTOR_READY.

Global:
- qualified candidate count/list;
- benchmark-ready count/list;
- unexpected transport errors;
- gate decision;
- explicit booleans proving no PnL, rank, beta, residual-return or weights were calculated.

## Anti-overfitting

- trading candidate universe frozen before coverage inspection;
- benchmark basket frozen before coverage inspection;
- audit interval frozen before coverage inspection;
- readiness interval frozen before coverage inspection;
- 12/16 candidate breadth gate frozen before results;
- 5/5 benchmark gate frozen before results;
- no failed-asset replacement;
- no symbol substitution;
- no PnL or signal diagnostics;
- no beta estimator chosen from data results;
- no use of the already-seen V2 validation window as an independent gate on the old V1/V2 asset universe;
- any data redesign receives a new ruleset.

## Safety

Research/data only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
