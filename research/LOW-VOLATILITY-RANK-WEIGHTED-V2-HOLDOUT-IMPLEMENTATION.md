# Low-Volatility Rank-Weighted V2 — Untouched Holdout Implementation Contract

Status: **IMPLEMENTED FOR REVIEW / HOLDOUT RUN BLOCKED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Frozen Development state: **PASS**  
Execution impact: **false**

## Purpose

Evaluate the already preregistered 34-period untouched Holdout only after the V2 Development PASS was frozen.

This Holdout adapter does not alter the frozen V2 Development engine. It imports and reuses its deterministic portfolio mechanics and verifies the exact frozen Development engine, evidence, and compact Development summary before any Holdout metric can be emitted.

## Mandatory frozen lineage

The Holdout implementation requires:

- V2 Development engine blob: `87302fdc0c1880a35e1bfd663be8191d5f6be429`;
- frozen Development evidence blob: `e9babe1566c8667a21eb6cae8388ca6dfb77385e`;
- frozen Development summary blob: `5b3ada9fd32abe4747fbc854bb5f5388e15e6763`;
- frozen Development decision: `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`;
- frozen Development gate pass;
- Development `holdoutEvaluated=false`;
- no Development data-integrity failure.

Any lineage mismatch blocks Holdout evaluation.

## Identical strategy mechanics

The Holdout calls the frozen V2 Development helpers directly for:

- exact 28-day / 672-return V1 Low-Volatility feature;
- 12-asset average-rank weighting;
- gross exposure 1.0;
- net exposure 0;
- weekly open-to-open returns;
- funding accounting;
- turnover accounting;
- initial entry cost;
- mandatory terminal close;
- Profit Factor;
- annualized weekly Sharpe;
- maximum drawdown;
- chronological block returns.

No top/bottom basket, regime filter, leverage multiplier, stop, take-profit, DCA, martingale, asset removal, parameter optimization, or post-Development retuning is introduced.

## Untouched Holdout calendar

Exactly 34 Saturday anchors:

- first anchor: **2026-01-03T00:00:00Z**;
- last feature anchor: **2026-08-22T00:00:00Z**;
- terminal next-week open: **2026-08-29T00:00:00Z**;
- expected periods: **34**.

## Holdout-only public source

Only official Binance Vision USD-M monthly archives are authorized:

- monthly 1h `klines`;
- monthly `fundingRate`;
- exactly the same 12 frozen symbols.

Archive months:

- **2025-12 through 2026-08**.

Retained hourly rows:

- first: **2025-12-05T23:00:00Z**;
- last: **2026-08-29T00:00:00Z**;
- expected exact count per asset: **6,386**.

Retained funding rows:

- from **2026-01-03T00:00:00Z**;
- through **2026-08-29T00:00:00Z**.

The December 2025 price rows exist only to form the frozen 28-day feature for the first Holdout anchor. Development metrics are not collected or replayed by the Holdout source collector.

Every official archive is SHA-256 receipted. Every retained per-asset JSON file is independently hashed. The runner checks hourly bounds and one-hour continuity, funding monotonicity, declared funding intervals, source file hashes, and Holdout-only boundaries.

## Frozen funding rule

The corrected Development funding coverage implementation is reused exactly.

Funding inclusion remains:

`start < funding_timestamp <= end`

Coverage validation allows only the already reviewed 1,000 ms official timestamp-jitter tolerance. No timestamp is rounded, synthesized, interpolated, or moved.

## Frozen costs

Identical to Development:

- baseline: **10 bps** one-way per unit of turnover;
- mandatory stress: **20 bps** one-way per unit of turnover.

## Holdout gate

The untouched Holdout passes only if all frozen preregistered conditions are true:

- exactly **34** periods;
- exactly **12** eligible assets every period;
- gross exposure deviation <= **1e-12**;
- absolute net exposure <= **1e-12**;
- baseline compounded return >0;
- Profit Factor >=**1.15**;
- annualized weekly Sharpe >=**0.75**;
- maximum drawdown <=**20%**;
- at least **3/4** chronological blocks positive;
- 20-bps stress compounded return >0;
- mean weekly Rank IC >0;
- Rank IC Newey-West(4) t >=**1.645**;
- no lineage, source, invariant, or funding-coverage failure.

Possible decisions are exactly:

- `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`;
- `HOLDOUT_FAIL_RESEARCH_STOP`.

A Holdout PASS does not automatically start or modify any Paper bot. It authorizes only a later explicit prospective Paper-review decision.

A Holdout FAIL closes this V2 line without rescue or retuning.

## PR isolation

Pull-request CI runs only deterministic lineage and synthetic invariants. It must not download or collect Holdout history and must not evaluate Holdout PnL.

After exact-head CI and merge, a separate documentation-only authorization commit on:

`research/low-volatility-rank-weighted-v2-holdout-run`

is required before the first Holdout source collection/evaluation.

## Current authorization

Authorized in this PR:

- isolated Holdout engine;
- untouched Holdout-only source collector;
- Holdout result runner;
- synthetic/lineage tests;
- gated workflow;
- frozen implementation documentation.

Not authorized in this PR:

- historical Holdout execution;
- Paper deployment;
- live execution.
