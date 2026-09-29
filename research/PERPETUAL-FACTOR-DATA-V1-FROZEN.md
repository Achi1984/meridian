# Perpetual Factor Data Foundation V1 — Frozen Scope

Status: **DATA FOUNDATION — NO STRATEGY RESULT**  
Execution impact: **false**  
Auto-promotion: **false**  
Parent: MERIDIAN main after PR #267

## Purpose

Build a reproducible public-data foundation for a later, separately frozen Self-History Perpetual Factor strategy.

This foundation does not define factor weights, trading thresholds, portfolio construction, leverage, promotion or expected profitability.

## Evidence motivation

Dhanya MD (2026), *Every Asset Its Own Benchmark: Market-Neutral Alpha in Perpetual Futures*, reports that ranking perpetual-futures factor values against each contract's own trailing history outperformed conventional peer ranking in most tested factors and remained robust in held-out-universe and higher-cost tests.

MERIDIAN treats this as motivation only. V1 will not claim exact replication without the paper's complete implementation specification and exact data panel.

## Fixed candidate universe

Frozen before coverage inspection:

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

Symbols are Binance USD-M perpetual contracts `<ASSET>USDT`.

No asset may be added or removed based on later factor returns.

Assets may become dynamically eligible only when they pass the predeclared historical-data gate below.

## Official sources

Primary source: Binance Vision public USD-M futures archives.

Required:
1. `klines`, 4h
2. `premiumIndexKlines`, 4h
3. `fundingRate`

Optional diagnostic extension:
4. daily `metrics` archives for open interest / long-short / taker-ratio features

The optional metrics layer is not required for the first factor challenger because its daily file partitioning and known public-archive gaps require a separate continuity audit.

No authenticated exchange API and no account credentials are required.

## Coverage audit period

Audit monthly archive availability:
- 2021-01 through 2026-08 UTC

For every fixed symbol and month, record independently:
- kline archive available / unavailable;
- premium archive available / unavailable;
- funding archive available / unavailable;
- byte size when available;
- HTTP/error category when unavailable.

A month is `CORE_COMPLETE` only when all three required archives exist.

## Strategy-eligibility data gate

This foundation does not select a trading universe. It exposes an objective eligibility rule for later strategy code:

An asset can first become factor-eligible only after:
- at least **24 completed CORE_COMPLETE months** exist before the decision timestamp;
- the most recent 12 calendar months are CORE_COMPLETE;
- no synthetic backfill is used.

Once eligible, a missing required month causes that asset to fail closed until enough subsequent data restore the rolling 12-month continuity condition.

This allows later-listed assets to enter only after real history exists instead of backfilling pre-listing data.

## Future factor primitives supported

The required datasets are sufficient to construct transparent research primitives such as:

- medium-term price momentum;
- short-term reversal;
- realized volatility;
- volume / illiquidity measures;
- taker-buy share from perpetual kline fields;
- funding crowding relative to own history;
- premium/basis mean reversion relative to own history.

Open-interest-derived factors are deferred until the optional metrics layer has its own frozen data-quality audit.

## Data integrity

When raw files are later collected:
- verify ZIP readability;
- preserve source URL and period;
- normalize timestamps;
- reject duplicate or non-monotonic timestamps;
- measure expected 4h cadence;
- funding cadence is observed, not assumed;
- no interpolation or missing-row synthesis;
- source gaps remain explicit.

## Foundation acceptance

The coverage audit passes as a useful foundation when:
- BTC and ETH have >=24 CORE_COMPLETE months;
- at least 8 of the 14 frozen assets have >=24 CORE_COMPLETE months by 2025-12;
- every availability decision is reproducible from official source URLs;
- audit output records all 14 assets, including failures.

Passing this foundation does **not** authorize a strategy run. The next step would be a separately frozen Self-History Perpetual Factor V1 protocol using only objectively eligible assets.

## Anti-overfitting

- Universe frozen before coverage results.
- Coverage threshold frozen before results.
- No asset removal because its archives are inconvenient.
- No strategy PnL is computed in this foundation.
- No future factor definition may retroactively alter this coverage evidence.

## Safety

Research/data only. No orders, no credentials, no wallet state, no leverage, no exchange mutation.
