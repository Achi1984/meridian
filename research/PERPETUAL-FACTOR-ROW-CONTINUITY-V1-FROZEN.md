# Perpetual Factor Row Continuity V1 — Frozen Data Diagnostic

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #270

## Purpose

Diagnose row-level continuity of the canonical public perpetual-factor inputs after Self-History Perpetual Factor V2 failed closed on `BTC: PREMIUM_GAP`.

This diagnostic does not repair V2, does not interpolate missing data and does not compute strategy PnL.

## Frozen universe

Exactly the 14 assets from `PERPETUAL-FACTOR-DATA-V1`:

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
- HBAR
- SUI

## Official sources

Binance Vision public USD-M monthly archives:

- 4h `klines`
- 4h `premiumIndexKlines`
- `fundingRate`

Audit interval:
- 2021-01 through 2026-08 UTC

Pre-listing months before the canonical first CORE_COMPLETE month of each asset are not treated as missing.

## Required measurements

For every asset and required dataset:

### 4h kline continuity

- normalize timestamps to milliseconds;
- reject duplicate/non-monotonic timestamps;
- expected cadence = exactly 4 hours;
- identify every missing expected openTime;
- group adjacent missing timestamps into gap runs;
- record first/last observed timestamp and total row count.

### 4h premium-index continuity

Same rules as 4h klines.

Additionally classify every expected 4h timestamp as:
- BOTH_PRESENT
- KLINE_ONLY
- PREMIUM_ONLY
- BOTH_MISSING

This distinguishes a general market-data outage from premium-specific archive loss.

### Funding continuity

- normalize timestamps;
- reject duplicate/non-monotonic timestamps;
- do not assume a fixed funding cadence;
- flag every observed inter-event gap >12 hours;
- record gap start/end and duration.

## Weekly factor-window diagnostics

Without computing strategy returns, audit Monday 00:00 UTC anchors.

For every asset after its objective Perpetual Factor Data V1 eligibility month, report:

- whether the exact preceding 4h price mark exists;
- whether a 12-week momentum mark exists;
- whether the prior 7-day premium window has all 42 expected 4h rows;
- whether the prior 7-day funding window has no boundary/inter-event gap >12h.

Report counts and percentages of:
- fully factor-ready weekly anchors;
- premium-window failures;
- price/momentum failures;
- funding-window failures.

No missing window is filled or inferred.

## Cross-asset synchronization

For each missing premium timestamp:
- count how many of the 14 assets are missing at that same timestamp;
- report timestamps missing for >=50% of then-listed assets;
- report whether corresponding regular 4h klines are present.

This identifies exchange/archive-wide premium discontinuities separately from asset-specific faults.

## Foundation decisions

This diagnostic has no profitability pass/fail.

It produces one of:

- `ROW_CONTINUITY_CHARACTERIZED` when all requested audits complete with zero transport errors;
- `ROW_CONTINUITY_INCOMPLETE` when source retrieval or parsing fails.

A later factor-strategy successor may use these facts only through a **new frozen ruleset**. V2 remains immutable.

## Anti-overfitting

- Universe frozen before results.
- Interval frozen before results.
- No data interpolation.
- No gap deletion.
- No asset removal.
- No strategy PnL.
- No strategy thresholds.
- No factor promotion.

## Safety

Research/data only. No credentials, orders, wallet state, leverage or account mutation.
