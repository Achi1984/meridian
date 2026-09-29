# Cross-Venue Funding Spread V2 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #282

## Purpose

Build a reproducible public-data foundation for a later, separately frozen `Cross-Venue Funding Spread V2`.

This stage must not calculate strategy PnL, choose a trade direction from outcomes, optimize a threshold or promote a bot.

## Why a new foundation

`CROSS-VENUE-FUNDING-SPREAD-V1-FROZEN` showed positive aggregate discovery and transfer economics, but failed its immutable asset-level transfer gate because XRP was net negative.

`CROSS-SECTIONAL-FUNDING-CARRY-RISK-BUDGET-V2-FROZEN` subsequently showed that single-venue cross-sectional Funding Carry did not generalize to a second independent universe.

V2 therefore returns to a distinct market-structure hypothesis — venue-to-venue funding dispersion — but begins with a previously unused frozen candidate universe.

## Frozen candidate universe

Frozen before coverage inspection:

- BNB
- ADA
- DOT
- LTC
- BCH
- TRX
- ETC
- XLM

No candidate may be added, removed or replaced after coverage results.

These assets were not used in Cross-Venue Funding Spread V1 discovery/transfer testing.

## Official public sources

### Binance

Binance Vision USD-M monthly archives:
- `markPriceKlines`, interval 8h
- `fundingRate`

### Hyperliquid

Public `/info` API:
- `meta` for current asset identity/listing
- `candleSnapshot`, interval 8h
- `fundingHistory`

No authenticated exchange API and no account credentials.

## Frozen common coverage interval

Foundation qualification interval:

- 2024-09-01 00:00 UTC through 2026-09-01 00:00 UTC
- exactly 24 completed calendar months: 2024-09 through 2026-08

The later V2 strategy, if authorized, may use only this interval or a strict subset frozen before PnL.

## Binance monthly coverage

For every asset and each of the 24 months:

- record official archive URL for 8h markPriceKlines;
- record official archive URL for fundingRate;
- probe archive availability without synthetic inference;
- month is `BINANCE_CORE_COMPLETE` only if both archives exist.

An asset satisfies the Binance foundation rule only with:
- all 24/24 months `BINANCE_CORE_COMPLETE`;
- zero unexpected transport errors.

## Hyperliquid listing identity

Using public `meta`:

- asset coin string must exist exactly as frozen;
- record the index returned by the metadata response;
- no alias substitution after results.

A candidate absent from `meta` fails Hyperliquid qualification.

## Hyperliquid 8h mark coverage

Request one 8h `candleSnapshot` covering the common interval.

Qualification requires:
- response is a non-empty array;
- timestamps strictly increasing after exact duplicate rejection is disallowed — duplicates cause failure;
- first candle open <= 2024-09-01 08:00 UTC;
- last candle open >= 2026-08-31 08:00 UTC;
- maximum open-time gap <=16 hours;
- at least 2,100 candles.

No missing candle is reconstructed.

## Hyperliquid funding coverage anchors

To avoid a full multi-asset strategy replay in the data-foundation stage, audit two frozen one-month funding anchors:

- early anchor: 2024-09-01 <= time < 2024-10-01
- late anchor: 2026-08-01 <= time < 2026-09-01

For each anchor:
- page through public `fundingHistory` until the frozen month is exhausted;
- preserve exact returned timestamps/rates;
- require >=600 observations;
- timestamps strictly increasing;
- no duplicates;
- maximum inter-event gap <=2 hours;
- first observation within 2 hours of month start;
- final observation within 2 hours of month end.

No synthetic funding events.

These anchor checks establish broad historical accessibility. A later V2 strategy must still fetch and validate the complete funding history over every traded period.

## Candidate qualification

A frozen candidate is `CROSS_VENUE_DATA_QUALIFIED` only if all pass:

1. 24/24 Binance core-complete months;
2. exact Hyperliquid meta listing;
3. Hyperliquid 8h mark-coverage gate;
4. early funding-anchor gate;
5. late funding-anchor gate;
6. zero unexpected transport errors.

## Foundation acceptance gate

Foundation PASS requires:

- all 8 frozen candidates represented in output, including failures;
- zero unrecorded/unexpected transport errors;
- at least **4 of 8** candidates are `CROSS_VENUE_DATA_QUALIFIED`;
- official source references recorded for every pass/fail;
- no strategy PnL;
- no synthetic backfill.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen V2 strategy protocol.

## Anti-overfitting

- universe frozen before coverage inspection;
- 24-month interval frozen before coverage inspection;
- >=4/8 acceptance breadth frozen before results;
- no candidate replacement because one venue lacks history;
- no alias replacement after Hyperliquid meta result;
- no PnL in this stage;
- no use of prior Cross-Venue V1 assets to fill missing V2 breadth;
- any future strategy must freeze direction, costs and gates before first PnL.

## Safety

Research/data only. No orders, credentials, wallet state, leverage, liquidation model or exchange mutation.
