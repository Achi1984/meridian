# Adaptive Cross-Venue Funding Spread V3 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #287

## Purpose

Build a reproducible public-data foundation for a later, separately frozen `Adaptive Cross-Venue Funding Spread V3`.

This stage must not:
- calculate strategy PnL;
- infer or choose a trade direction from returns;
- optimize a threshold;
- remove a losing asset;
- promote a Paper or live bot.

## Why V3 needs a stronger foundation

Cross-Venue Funding Spread V1 showed positive aggregate economics with low drawdown, but failed its immutable asset-level holdout gate.

Cross-Venue Funding Spread V2 then independently tested the same static venue direction on a new universe. V2 produced:
- positive gross funding cash flow;
- very low drawdown;
- small basis PnL;
- but negative net result after costs;
- asset-specific direction failures.

V3 therefore tests a different future hypothesis: **direction/no-trade decisions may need to adapt to observable pre-trade cross-venue funding conditions**.

Because that future hypothesis depends on the historical funding path itself, V3 requires full public funding-history coverage before any strategy protocol or PnL is allowed.

## Frozen candidate universe

Frozen before coverage inspection:

- HBAR
- SUI
- NEAR
- FIL
- UNI
- AAVE
- ATOM
- ARB

No candidate may be added, removed or replaced after coverage results.

These assets were not used in Cross-Venue Funding Spread V1 or V2 strategy validation.

## Official public sources

### Binance

Binance Vision USD-M monthly archives:
- `markPriceKlines`, interval 8h
- `fundingRate`

### Hyperliquid

Public `/info` API:
- `meta`
- `candleSnapshot`, interval 8h
- `fundingHistory`

No authenticated API, private account data, credentials or wallet state.

## Frozen common interval

Foundation qualification interval:

- 2024-09-01 00:00 UTC through 2026-09-01 00:00 UTC
- exactly 24 completed calendar months: 2024-09 through 2026-08

A future V3 strategy may use only this interval or a strict subset frozen before first PnL.

## Binance coverage gate

For every candidate and each of the 24 months:

- record official 8h mark-price archive URL;
- record official funding-rate archive URL;
- probe archive availability;
- no synthetic inference.

A month is `BINANCE_CORE_COMPLETE` only when both archives exist.

An asset passes the Binance foundation rule only with:
- 24/24 core-complete months;
- zero unexpected transport errors.

## Hyperliquid identity gate

Using public `meta`:

- the exact frozen coin string must exist;
- record the metadata index;
- no alias substitution after results.

Absent coin => candidate fails.

## Hyperliquid 8h mark gate

Request one complete `candleSnapshot` over the common interval.

Qualification requires:
- non-empty array;
- finite positive close values;
- strictly increasing timestamps;
- no duplicates;
- first candle open <= 2024-09-01 08:00 UTC;
- last candle open >= 2026-08-31 08:00 UTC;
- max open-time gap <=16 hours;
- at least 2,100 valid candles.

No candle reconstruction.

## Hyperliquid full funding-history gate

Unlike V2's foundation anchors, V3 audits the complete common interval because any later adaptive direction/no-trade rule will rely on this path.

For every candidate:

- page through `fundingHistory` from 2024-09-01 to 2026-09-01;
- preserve exact returned timestamps and realized rates;
- no interpolation;
- no synthetic funding events.

Qualification requires:
- at least **17,000** valid observations;
- finite rates;
- strictly increasing timestamps;
- no duplicates;
- first observation within 2 hours of interval start;
- final observation within 2 hours of interval end;
- max inter-event gap <=2 hours.

Any unexpected transport/rate-limit failure after bounded retries is recorded and candidate fails.

## Candidate qualification

A frozen candidate is `ADAPTIVE_CROSS_VENUE_DATA_QUALIFIED` only if all pass:

1. 24/24 Binance core-complete months;
2. exact Hyperliquid meta identity;
3. Hyperliquid 8h mark gate;
4. Hyperliquid full funding-history gate;
5. zero unexpected transport errors for that candidate.

## Foundation acceptance gate

Foundation PASS requires:

- all 8 frozen candidates represented in output, including failures;
- zero unrecorded/unexpected transport errors;
- at least **5 of 8** candidates are fully qualified;
- official source references recorded;
- no strategy PnL;
- no trade-direction inference;
- no synthetic backfill.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen V3 strategy protocol.

## What a later V3 strategy may investigate

Only after this foundation passes, a new preregistered strategy may test whether pre-trade information such as trailing realized funding differential can determine:

- Binance-long / Hyperliquid-short;
- Binance-short / Hyperliquid-long;
- or NO TRADE.

This foundation does not define thresholds, directions, costs or PnL gates.

## Anti-overfitting

- universe frozen before coverage inspection;
- interval frozen before coverage inspection;
- >=5/8 breadth gate frozen before results;
- no replacement for a failed asset;
- no alias replacement;
- no PnL in this stage;
- no direction inference in this stage;
- no reuse of V1/V2 assets to repair V3 breadth;
- any future V3 strategy must freeze signal, direction logic, no-trade rule, costs and gates before first PnL.

## Safety

Research/data only. No orders, credentials, wallet state, leverage, liquidation model or exchange mutation.
