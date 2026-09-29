# Spot-Perp Basis Dislocation V1 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #304

## Purpose

Build a reproducible public-data foundation for a later, separately frozen `Spot-Perp Basis Dislocation V1`.

This stage must not:
- calculate strategy PnL;
- infer a basis threshold;
- infer a funding threshold;
- rank assets by performance;
- remove a candidate after observing basis behavior;
- promote a Paper or live bot.

## Why this is a new family

Spot-Perp Funding Harvest V1 and Funding Persistence V2 used an absolute funding trigger.

V2 failed independent validation because the original 77.5 bps entry regime did not recur at all in 2025-09 through 2026-08.

The next family therefore does not lower or rescue that threshold.

The future hypothesis, if this foundation passes, may study **spot-perp basis dislocation with funding as confirmation**, motivated by perpetual-futures research showing that basis deviations and funding feedback are jointly shaped by arbitrage capacity, contract design and market stress.

This foundation itself does not define that strategy.

## Frozen candidate universe

Frozen before coverage inspection:

- APT
- APE
- CRV
- SUSHI
- DYDX
- LDO
- GALA
- IMX

No candidate may be added, removed or replaced after coverage results.

## Official public sources

Binance Vision only.

### Spot
Monthly:
- `data/spot/monthly/klines/{SYMBOL}/8h`

### USD-M perpetual
Monthly:
- `data/futures/um/monthly/klines/{SYMBOL}/8h`
- `data/futures/um/monthly/fundingRate/{SYMBOL}`

No authenticated API, account data, credentials or wallet state.

## Frozen audit interval

- 2024-06 through 2026-08 inclusive
- exactly 27 completed calendar months

The first three months may later serve only as basis-history warm-up.

A future strategy protocol must freeze its own discovery and holdout split before first PnL.

## Spot 8h gate

For every asset/month:

- parse all official 8h Spot trade bars;
- timestamps strictly increasing;
- no duplicate open times;
- OHLC finite and positive;
- exact 8h cadence;
- first open time exactly at calendar-month start;
- final open time exactly 8 hours before calendar-month end;
- row count exactly equals `calendar_days × 3`.

## Perpetual 8h gate

For every asset/month:

- parse all official USD-M perpetual 8h trade bars;
- timestamps strictly increasing;
- no duplicate open times;
- OHLC finite and positive;
- exact 8h cadence;
- first open time exactly at month start;
- final open time exactly 8 hours before month end;
- row count exactly equals `calendar_days × 3`.

## Spot/perpetual synchronization gate

For every asset/month:

- Spot and Perp must contain exactly the same 8h open-time set;
- row counts must match exactly;
- every synchronized Spot close and Perp close must be finite and >0;
- the basis `PerpClose / SpotClose - 1` must be finite at every synchronized timestamp.

No basis distribution statistics, percentiles or thresholds are calculated in this stage.

## Funding gate

For every asset/month:

- realized funding values finite;
- timestamps strictly increasing;
- no duplicates;
- at least 60 observations;
- first event no more than 12 hours after month start;
- last event no more than 12 hours before month end;
- maximum inter-event gap <=12 hours.

Funding is audited only for availability/integrity. No funding signal or threshold is inferred.

## Candidate qualification

A candidate is `SPOT_PERP_BASIS_DATA_QUALIFIED` only if all 27 months pass:

1. Spot 8h gate;
2. Perp 8h gate;
3. exact Spot/Perp timestamp synchronization;
4. finite basis computability at every synchronized row;
5. funding gate;
6. zero unexpected transport errors.

## Foundation acceptance gate

Foundation PASS requires:

- all 8 frozen candidates represented in output, including failures;
- zero unrecorded/unexpected transport errors;
- at least **6 of 8** candidates fully qualified;
- no synthetic backfill;
- no nearest-neighbor repair;
- no strategy PnL;
- no basis threshold inference;
- no funding threshold inference.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen Basis Dislocation strategy protocol.

## What a later strategy may investigate

Only after this foundation passes, a new preregistered ruleset may study a basis-dislocation signal using only information available before entry.

Potential ingredients may include:
- current synchronized spot-perp basis;
- trailing own-history basis distribution;
- realized funding sign or cash-flow confirmation;
- explicit no-trade region;
- fixed transaction-cost assumptions.

None of these are selected or parameterized in this foundation.

## Anti-overfitting

- universe frozen before coverage inspection;
- audit interval frozen before coverage inspection;
- >=6/8 breadth gate frozen before results;
- no candidate substitution;
- no basis percentile calculation in this stage;
- no strategy PnL;
- no funding/basis threshold inference;
- no synthetic reconstruction;
- any future strategy must freeze signal, lookback, threshold, costs, discovery/holdout windows and gates before first PnL.

## Safety

Research/data only. No orders, credentials, leverage, liquidation model, wallet state or exchange mutation.
