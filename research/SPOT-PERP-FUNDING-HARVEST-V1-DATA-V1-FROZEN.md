# Spot-Perp Funding Harvest V1 Data Foundation — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #295

## Purpose

Build a reproducible public-data foundation for a later, separately frozen single-venue Spot-Perp Funding Harvest strategy.

The future strategy family is conceptually distinct from the closed Cross-Venue V1-V4 lineage:
- long spot;
- short the matching Binance USD-M perpetual;
- harvest positive perpetual funding while remaining approximately delta-neutral.

This foundation must not calculate:
- strategy PnL;
- carry return;
- funding threshold;
- entry/exit signal;
- leverage;
- asset ranking.

## Why a new family

Cross-Venue V1-V4 are immutable and receive no more threshold, direction or asset tuning.

The new family removes the venue-direction decision entirely and first asks only whether a clean joint Spot + Perp + Funding historical tape exists.

## Frozen candidate universe

Frozen before coverage inspection:

- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

No candidate may be added, removed or replaced after coverage results.

## Public sources

Binance Vision public monthly archives only.

### Spot
- `data/spot/monthly/klines/{SYMBOL}/8h`

### USD-M perpetual
- `data/futures/um/monthly/markPriceKlines/{SYMBOL}/8h`
- `data/futures/um/monthly/fundingRate/{SYMBOL}`

Symbols are the exact `ASSETUSDT` strings.

No authenticated API, private account data, wallet state or synthetic backfill.

## Frozen audit interval

- 2024-09-01 00:00 UTC through 2026-09-01 00:00 UTC
- exactly 24 completed calendar months: 2024-09 through 2026-08

A later strategy may use this interval or a strict subset frozen before first PnL.

## Raw archive requirements

For each asset and month, fetch and inspect:

1. Spot 8h klines
2. USD-M perpetual 8h mark-price klines
3. USD-M realized funding-rate archive

All three source URLs must be recorded in evidence.

A missing official archive is a recorded coverage failure, not an unexpected transport error.

## Spot 8h validation

For each monthly Spot archive:

- parse exchange open timestamps and OHLC;
- all timestamps finite;
- all OHLC finite and positive;
- timestamps strictly increasing;
- no duplicates;
- exact 8-hour cadence between consecutive rows;
- first bar opens within 8 hours of calendar-month start;
- last bar opens no earlier than 16 hours before calendar-month end;
- at least 84 valid 8h rows.

No interpolation or nearest-neighbor replacement.

## Perpetual 8h mark validation

For each monthly mark-price archive:

- finite positive closes;
- timestamps strictly increasing;
- no duplicates;
- exact 8-hour cadence;
- first bar opens within 8 hours of month start;
- last bar opens no earlier than 16 hours before month end;
- at least 84 valid 8h rows.

No mark reconstruction.

## Funding validation

For each monthly funding archive:

- finite realized funding rates;
- timestamps strictly increasing;
- no duplicates;
- at least 60 valid observations;
- first funding timestamp within 12 hours of month start;
- final funding timestamp within 12 hours of month end;
- maximum inter-event or boundary gap <=12 hours.

Observed exchange cadence is validated rather than assumed.

No synthetic funding event.

## Monthly joint-core state

An asset-month is `JOINT_CORE_COMPLETE` only when all three pass:

- Spot 8h
- Perpetual mark 8h
- Funding

A failed component and its exact reason remain visible in output.

## Asset qualification

An asset is `SPOT_PERP_DATA_QUALIFIED` only when:

- 24/24 months are `JOINT_CORE_COMPLETE`;
- zero unexpected transport errors occurred for that asset.

No asset may be qualified from partial history.

## Foundation acceptance gate

PASS requires:

- all 8 frozen candidates represented in output, including failures;
- zero unrecorded/unexpected transport errors;
- at least **6 of 8** assets fully qualified;
- all official source references retained;
- strategy PnL calculated = false;
- funding threshold inferred = false;
- no synthetic backfill.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen Spot-Perp Funding Harvest V1 strategy protocol.

## Future strategy constraints not yet defined

Only after foundation PASS may a new protocol freeze:

- whether funding must be positive;
- any funding threshold;
- holding/rebalance horizon;
- spot and perp fee/slippage assumptions;
- borrow/capital treatment;
- basis PnL;
- liquidation/margin assumptions;
- discovery/holdout split;
- promotion gates.

None of these may be inferred from this data-foundation output.

## Anti-overfitting

- universe frozen before coverage inspection;
- interval frozen before coverage inspection;
- 6/8 breadth gate frozen before results;
- no failed-asset replacement;
- no alias replacement;
- no PnL;
- no strategy signal;
- no threshold inference;
- no synthetic row;
- any strategy protocol is a new frozen ruleset committed before first PnL.

## Safety

Research/data only. No exchange credentials, live orders, leverage, liquidation automation, account mutation or automatic promotion.
