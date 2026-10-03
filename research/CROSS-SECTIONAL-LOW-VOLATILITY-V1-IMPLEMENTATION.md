# Cross-Sectional Low-Volatility V1 — Deterministic Implementation Contract

Status: **IMPLEMENTED FOR REVIEW — HISTORICAL DISCOVERY RUN BLOCKED**  
Ruleset: `CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN`  
Preregistration: `research/CROSS-SECTIONAL-LOW-VOLATILITY-V1-PREREGISTRATION.md`  
Execution impact: **false**  
Paper/live authorization: **false**

## Purpose

Implement the already-frozen Low-Volatility V1 hypothesis without changing its 12-asset universe, 28-day / 672-return formation rule, weekly forward outcome, Low-2/High-2 comparison, Newey-West lag, Discovery/Holdout boundaries, or fail-closed gates.

Pull-request CI runs only deterministic synthetic and structural invariants. It must not collect historical Discovery data or inspect a Low-Volatility V1 historical result.

A later documentation-only authorization commit on `research/cross-sectional-low-volatility-v1-discovery-run` is required before the first historical Discovery evaluation.

## Exact feature timing

At each Saturday 00:00 UTC anchor `t`:

- exactly **672 hourly close-to-close log returns** are used;
- those returns are built from **673 hourly bar closes**;
- the first selected hourly bar opens at `t - 674h`;
- the last selected hourly bar opens at `t - 2h` and closes strictly before the anchor;
- therefore no observation ending at or after the anchor enters the feature;
- `RV28 = sqrt(sum(r_h^2))`;
- `LOWVOL = -RV28`, so a larger score means lower realized volatility.

The forward outcome uses the public hourly kline open at `t` and the open at `t + 7d`.

## Frozen cross-sectional calculation

All 12 assets must be present at every anchor. Missing data fail closed; no asset is dropped.

For each valid week:

- Spearman Rank IC is calculated between `LOWVOL` and next-week return;
- the two highest `LOWVOL` scores form Low-2;
- the two lowest `LOWVOL` scores form High-2;
- the diagnostic spread is equal-weight Low-2 mean return minus High-2 mean return;
- exact signal ties are ordered by asset symbol for deterministic selection.

## Discovery-only source boundary

The first historical run, if later authorized, may collect only the data required for Discovery:

- Binance Vision official public USD-M monthly 1h kline archives;
- archive months 2025-01 through 2026-01;
- retained rows only from **2025-01-03T22:00:00Z** through **2026-01-03T00:00:00Z** inclusive;
- expected retained rows per asset: **8,739**;
- no funding data;
- no private/account data;
- no synthetic backfill;
- no rows after the first untouched Holdout anchor.

The collector records archive SHA-256 values, writes per-asset source files, and hashes the exact retained JSON files. The runner verifies all hashes, exact row counts, exact bounds, and one-hour continuity before evaluating Discovery.

## Discovery gate

The implementation enforces the preregistered gate exactly:

- 48 valid weekly anchors;
- 12 assets at every anchor;
- mean Rank IC >0;
- Rank IC Newey-West(4) t >=1.645;
- mean Low-2 minus High-2 spread >0;
- spread Newey-West(4) t >=1.645;
- >=3/4 chronological blocks with positive mean Rank IC;
- >=3/4 chronological blocks with positive mean spread.

Possible decisions are only:

- `DISCOVERY_PASS_HOLDOUT_ALLOWED`
- `DISCOVERY_FAIL_RESEARCH_STOP`

## Holdout seal

The implementation contains the frozen Holdout calendar only as an invariant:

- first Holdout anchor: 2026-01-03T00:00:00Z;
- last feature anchor: 2026-08-22T00:00:00Z;
- 34 expected anchors.

No Holdout collector or Holdout result runner is introduced here. The Discovery source explicitly refuses post-boundary Holdout rows. A Discovery FAIL closes V1. A Discovery PASS authorizes only a later, separately controlled untouched Holdout evaluation.

## PnL / execution boundary

This stage calculates feature diagnostics only. It does not calculate compounded strategy equity, funding, transaction-cost-adjusted strategy PnL, Profit Factor, Sharpe/Sortino, drawdown, Paper orders, or live orders.

The preregistered minimum future cost floor of 10 bps per one-way unit of notional turnover remains reserved for a separately preregistered strategy-design stage after an eventual Holdout PASS.

## Current authorization

Authorized in this PR:
- frozen implementation;
- Discovery-only collector and result runner;
- synthetic/invariant tests;
- workflow wiring whose historical jobs are skipped on pull requests.

Not authorized in this PR:
- historical Discovery execution;
- Holdout evaluation;
- strategy PnL;
- Paper/live execution.
