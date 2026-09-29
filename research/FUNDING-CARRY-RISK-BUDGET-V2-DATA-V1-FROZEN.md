# Funding Carry Risk-Budget V2 Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #278

## Purpose

Build a reproducible public-data foundation for a later, separately frozen `Cross-Sectional Funding Carry Risk-Budget V2`.

This foundation does **not** define:
- Funding-Carry ranking thresholds;
- portfolio weights;
- volatility targets;
- leverage;
- promotion;
- expected profitability.

No strategy PnL may be calculated in this stage.

## Why a new foundation

`CROSS-SECTIONAL-FUNDING-CARRY-V1-FROZEN` produced strong economics on LTC/BCH/AVAX/HBAR but failed its preregistered risk and concentration gates:
- max drawdown 48.86% > 25%;
- positive-PnL concentration 61.34% > 50%.

Those four assets are now observed and may not be reused as independent validation for a successor.

V2 therefore begins with a previously unused, frozen candidate universe.

## Frozen candidate universe

Frozen before coverage inspection:

- TRX
- ETC
- XLM
- ATOM
- UNI
- AAVE
- FIL
- NEAR

Symbols are Binance USD-M perpetual contracts `<ASSET>USDT`.

No asset may be added, removed or replaced after the coverage audit result is observed.

## Official sources

Primary source: Binance Vision public USD-M monthly archives.

Required for each asset/month:

1. `klines`, interval `4h`;
2. `fundingRate`.

No authenticated exchange API and no account credentials are required.

## Coverage audit period

Audit monthly archive availability:

- 2021-01 through 2026-08 UTC.

For each frozen asset/month/kind record:

- source URL;
- available/unavailable;
- HTTP status or error category;
- byte size when available;
- request method used.

A month is `CORE_COMPLETE` only when both required archives exist.

## Objective future-strategy eligibility

This foundation exposes only an objective availability rule.

An asset can first become factor-eligible at the start of a calendar month only when, strictly before that month:

- at least **24 completed CORE_COMPLETE months** exist;
- the **most recent 12 completed calendar months** are all CORE_COMPLETE;
- no synthetic backfill is used.

Once eligible, a missing required month makes the asset ineligible until the rolling 12-month continuity condition is restored.

This rule does not guarantee that every row inside an available archive is continuous. A later strategy must still validate the exact rows/windows it uses.

## Foundation acceptance gate

The foundation passes only if all are true:

1. all 8 frozen assets appear in the audit output, including failures;
2. transport-level unexpected errors = 0;
3. at least **6 of 8** frozen assets have >=24 CORE_COMPLETE months through 2025-12;
4. at least **6 of 8** expose a non-null objective first eligible month no later than 2026-01;
5. every monthly availability decision is reproducible from the recorded official source URL;
6. no synthetic or inferred archive availability is used.

PASS => `FOUNDATION_PASS`.

FAIL => `FOUNDATION_FAIL_DATA_REDESIGN`.

A foundation PASS does not authorize a strategy run until a separate V2 protocol is committed first.

## Future V2 design constraint

If this foundation passes, the next allowed step is a separately frozen strategy protocol that may test:

- the **same already-observed Funding Carry 7d factor direction**;
- cross-sectional diversification with more than one long/short asset;
- an **ex-ante** risk budget derived only from data available before entry;
- the same explicit turnover-cost/stress discipline.

This section is not a strategy definition and cannot be used to bypass preregistration.

## Anti-overfitting

- universe frozen before coverage results;
- acceptance threshold frozen before coverage results;
- no asset substitution because an archive is inconvenient;
- no strategy PnL in this foundation;
- no future strategy may retroactively change this coverage record;
- LTC/BCH/AVAX/HBAR remain observed V1 evidence and are excluded from this foundation.

## Safety

Research/data only. No orders, credentials, wallet state, leverage, liquidation model or exchange mutation.
