# Perpetual Cross-Sectional Reversal V1 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parent:
- MERIDIAN main after PR #309

## Purpose

Build a strategy-neutral public-data foundation for a later, separately frozen `Perpetual Cross-Sectional Reversal V1`.

The motivation is external 2026 evidence of intermediate-horizon cryptocurrency reversal over roughly 8–10 week formation windows, with stronger results outside the largest coins and among more volatile assets.

This stage does **not** test that return hypothesis.

It must not:
- calculate reversal ranks;
- calculate long-short or long-only strategy PnL;
- infer a formation horizon;
- infer a skip period;
- infer a volatility threshold;
- infer portfolio weights;
- remove or replace a failed asset after coverage is observed.

## Frozen candidate universe

Frozen before coverage inspection:

- ADA
- DOGE
- LINK
- DOT
- LTC
- BCH
- AVAX
- HBAR
- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR
- OP
- INJ
- APT
- CRV
- LDO
- GALA
- IMX
- ARB

Count: **24**

The five largest/mega-cap names BTC, ETH, BNB, SOL and XRP are intentionally excluded before results because the motivating literature reports stronger reversal outside the largest tokens.

No candidate may be substituted after coverage results.

## Official public data

Binance Vision USD-M monthly archives only:

- `klines/{SYMBOL}/1d`
- `fundingRate/{SYMBOL}`

No private API, account state, credentials, synthetic backfill, interpolation or nearest-neighbor reconstruction.

## Frozen audit interval

- 2022-01 through 2026-08 inclusive
- 56 completed calendar months

Candidates that listed after 2022-01 remain in output with their true first complete month. Pre-listing missing archives are not transport failures and are not backfilled.

## Daily perpetual-price validation

For every available asset-month:

- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing open timestamps;
- no duplicate timestamps;
- exact 24-hour cadence between consecutive daily rows;
- rows remain inside the calendar month.

A calendar month is `PRICE_COMPLETE` only when:
- first daily bar opens exactly at month start;
- last daily bar opens exactly one day before month end;
- row count equals the number of UTC calendar days in that month.

A partial listing month is retained as partial evidence and cannot be called complete.

## Funding validation

For every available asset-month:

- finite realized funding rates;
- strictly increasing timestamps;
- no duplicates;
- at least 60 observations for a complete month;
- first boundary gap <=12h;
- last boundary gap <=12h;
- maximum inter-event/boundary gap <=12h.

A month is `FUNDING_COMPLETE` only when all pass.

## Joint monthly state

An asset-month is `REVERSAL_CORE_COMPLETE_V1` only when:
- PRICE_COMPLETE;
- FUNDING_COMPLETE;
- zero unexpected transport errors for those archives.

## Listing/continuity characterization

For each frozen candidate report:

- first month with any official price data;
- first `REVERSAL_CORE_COMPLETE_V1` month;
- last complete month;
- number of complete months;
- longest consecutive complete-month run;
- all internal gaps after first complete month;
- whether coverage remains complete through 2026-08.

No missing month after first complete month is silently treated as delisting or listing noise.

## Objective strategy-readiness labels

These are **data labels only**, not strategy decisions.

### LONG_HISTORY_READY

Candidate is `LONG_HISTORY_READY` when:
- it has at least **24 consecutive core-complete months**;
- the consecutive run ends at 2026-08;
- there are zero internal core gaps inside that 24+ month run.

### 2024_DISCOVERY_READY

Candidate is `2024_DISCOVERY_READY` when:
- it has at least **12 consecutive core-complete months ending no later than 2023-12**;
- coverage from its first qualifying month through 2024-12 contains no core gap.

This label only indicates enough pre-2024 data to support a future weekly formation-history rule. It does not authorize a strategy.

## Foundation acceptance gate

PASS requires:

- all 24 frozen candidates represented in output;
- zero unrecorded/unexpected transport errors;
- at least **18 of 24** candidates are LONG_HISTORY_READY;
- at least **12 of 24** candidates are 2024_DISCOVERY_READY;
- all incomplete/gap months remain visible;
- strategy PnL calculated = false;
- reversal ranks calculated = false;
- volatility-conditioned returns calculated = false;
- synthetic backfill used = false.

PASS => `FOUNDATION_PASS`

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`

A PASS authorizes only a separately frozen Reversal V1 strategy protocol.

## Diagnostic output

Per candidate:
- source archive URLs;
- complete/partial/missing month counts;
- first/last official price timestamp;
- first/last complete month;
- funding count and max gap diagnostics;
- internal continuity gaps;
- LONG_HISTORY_READY;
- 2024_DISCOVERY_READY.

No returns, ranking scores, quintiles, formation windows, or trading results are emitted.

## Anti-overfitting

- candidate universe frozen before coverage results;
- mega-cap exclusion frozen before coverage results;
- 2022-01..2026-08 audit window frozen;
- 18/24 long-history breadth gate frozen;
- 12/24 discovery-ready breadth gate frozen;
- no failed-asset replacement;
- no gap tolerance added after results;
- no PnL/ranking/volatility conditioning in foundation;
- any data redesign receives a new ruleset.

## Safety

Research/data only. No exchange credentials, live orders, leverage automation, liquidation model, wallet mutation or automatic promotion.
