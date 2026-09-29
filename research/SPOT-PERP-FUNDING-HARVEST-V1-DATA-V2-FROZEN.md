# Spot-Perp Funding Harvest V1 Data Foundation V2 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- `SPOT-PERP-FUNDING-HARVEST-V1-DATA-V1-FROZEN`

## Purpose

Re-run the exact Spot-Perp Funding Harvest V1 coverage question with one independently motivated data-source change:

- preserve Binance Spot 8h klines;
- preserve Binance USD-M realized funding archives;
- replace Binance USD-M `markPriceKlines` with public USD-M perpetual **trade klines** as the execution-price tape.

V1 remains immutable.

## Frozen candidate universe

- OP
- INJ
- WLD
- SEI
- TIA
- PENDLE
- RUNE
- ICP

No additions, removals or substitutions.

## Frozen interval

- 2024-09 through 2026-08
- exactly 24 completed calendar months

## Public sources

Binance Vision monthly archives only.

### Spot
- `data/spot/monthly/klines/{SYMBOL}/8h`

### USD-M perpetual execution-price tape
- `data/futures/um/monthly/klines/{SYMBOL}/8h`

### USD-M realized funding
- `data/futures/um/monthly/fundingRate/{SYMBOL}`

No authenticated API, wallet state, private data, interpolation or synthetic backfill.

## Validation rules

Spot 8h and Perpetual Trade 8h must each satisfy, per month:
- finite positive OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 8-hour cadence;
- first bar within 8h of month start;
- last bar no earlier than 16h before month end;
- at least 84 valid rows.

Funding must satisfy, per month:
- finite realized rates;
- strictly increasing timestamps;
- no duplicates;
- at least 60 observations;
- first/last boundary gap <=12h;
- maximum inter-event or boundary gap <=12h.

## Joint-core state

An asset-month is `JOINT_CORE_COMPLETE_V2` only when:
- Spot 8h PASS;
- Perpetual Trade 8h PASS;
- Funding PASS.

A failed component remains visible with exact reasons and official source URL.

## Asset qualification

An asset is qualified only when:
- 24/24 months are `JOINT_CORE_COMPLETE_V2`;
- zero unexpected transport errors occurred for that asset.

No partial-history qualification.

## Foundation gate

PASS requires:
- all 8 frozen candidates represented;
- zero unexpected transport errors;
- at least **6 of 8** fully qualified assets;
- official source references retained;
- strategy PnL calculated = false;
- funding threshold inferred = false;
- synthetic backfill used = false.

PASS => `FOUNDATION_PASS`  
FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen Spot-Perp Funding Harvest V1 strategy protocol.

## Anti-overfitting

- same universe as V1;
- same interval as V1;
- same 6/8 breadth gate as V1;
- only execution-price source changes from mark-price klines to perpetual trade klines;
- no asset replacement;
- no June-2026 exception;
- no 23/24 relaxation;
- no PnL;
- no funding threshold inference;
- no synthetic reconstruction.

## Safety

Research/data only. No credentials, live orders, leverage, liquidation automation, account mutation or automatic promotion.
