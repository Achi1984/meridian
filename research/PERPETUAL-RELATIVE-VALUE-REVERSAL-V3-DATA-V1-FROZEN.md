# Perpetual Relative-Value Reversal V3 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- MERIDIAN main after PR #315
- `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN`
- `HIGH-VOLATILITY-PERPETUAL-CROSS-SECTIONAL-REVERSAL-V2-FROZEN`

## Purpose

Build a reproducible public-data foundation for a later, separately frozen **Relative-Value / Beta-Neutral Perpetual Reversal V3**.

Observed prior-family evidence is hypothesis-generating only:
- V1 and V2 both produced positive next-week loser-minus-winner spreads;
- the profitable absolute side flipped between V1 and V2;
- neither V1 nor V2 passed its frozen promotion gate.

V3 may later test whether removing broad-market exposure yields a more stable relative-value reversal signal. This foundation does not define or calculate that strategy.

## Forbidden in this stage

Do not calculate:
- strategy PnL;
- market beta;
- residual returns;
- reversal ranks;
- long/short portfolios;
- volatility filters;
- trade signals;
- parameter thresholds.

No candidate may be replaced after coverage inspection.

## Frozen transfer-candidate universe

Exactly 20 assets not used in the Reversal V1/V2 strategy universe:

- SAND
- MANA
- ALGO
- EOS
- ZEC
- IOTA
- ZIL
- COMP
- SNX
- KSM
- 1INCH
- CHZ
- RUNE
- SUSHI
- DYDX
- APE
- ARB
- SUI
- WLD
- SEI

These are candidate assets only. Passing data coverage does not imply strategy inclusion or profitability.

## Frozen market benchmark

BTCUSDT Binance USD-M perpetual daily trade klines are audited as the sole benchmark-price series for a possible later beta-neutral specification.

BTC is **not** part of the candidate ranking universe in this foundation.

No beta is calculated in this stage.

## Public source

Binance Vision USD-M monthly archives only.

For each candidate:
- 1d perpetual trade klines;
- fundingRate.

For BTC benchmark:
- 1d perpetual trade klines.

No authenticated API, account data, private endpoints or synthetic reconstruction.

## Frozen audit interval

- 2024-01 through 2026-08 inclusive
- **32 completed calendar months**

This interval supplies ample prehistory and a common candidate-transfer window for a future V3 preregistration.

No data after 2026-08 are used.

## Daily-price audit

For every required asset-month:

- parse official 1d kline archive;
- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 24h cadence;
- row count exactly equals calendar days;
- first row at UTC month start;
- last row at final daily UTC slot.

No interpolation or nearest-neighbor replacement.

## Funding audit

For every candidate asset-month:

- parse official fundingRate archive;
- finite funding rates;
- strictly increasing timestamps;
- no duplicates;
- at least 60 observations per completed month;
- first/inter-event/final boundary gap <=12h.

Observed cadence may vary; no funding event is synthesized.

## Candidate qualification

A candidate is `RELATIVE_VALUE_REVERSAL_V3_DATA_READY` only when:

- price audit passes in all 32 months;
- funding audit passes in all 32 months;
- no unexpected transport error occurs for that candidate.

A missing official archive or failed continuity month is recorded and the asset fails; it is never silently replaced.

## BTC benchmark qualification

BTC benchmark passes only when:

- its 1d price audit passes in all 32 months;
- zero unexpected transport errors.

No funding qualification is required for BTC at foundation stage.

## Foundation acceptance gate

PASS requires all of:

- all 20 frozen candidates represented in output, including failures;
- BTC benchmark represented;
- zero unrecorded/unexpected transport errors;
- BTC benchmark passes 32/32 months;
- at least **15 of 20** candidates are fully data-ready;
- no PnL;
- no beta calculation;
- no residual-return calculation;
- no reversal ranking;
- no synthetic backfill.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen V3 strategy protocol.

## What a later V3 protocol may define

Only after this foundation passes, a new preregistration may define:

- exact trailing beta-estimation window;
- benchmark-return semantics;
- residualized 8-week formation return;
- skip and hold period;
- beta-neutral portfolio sizing;
- funding accounting;
- transaction costs;
- independent validation split;
- robustness and transfer gates.

None of those parameters may be inferred from foundation-stage PnL because foundation-stage PnL is forbidden.

## Anti-overfitting

- candidate universe frozen before coverage inspection;
- benchmark frozen before coverage inspection;
- audit interval frozen before coverage inspection;
- >=15/20 breadth gate frozen before results;
- no failed-asset replacement;
- no strategy statistics in this stage;
- no use of V1/V2 strategy assets to repair breadth;
- no synthetic backfill;
- any strategy successor receives a new frozen ruleset before first PnL.

## Safety

Research/data only. No credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
