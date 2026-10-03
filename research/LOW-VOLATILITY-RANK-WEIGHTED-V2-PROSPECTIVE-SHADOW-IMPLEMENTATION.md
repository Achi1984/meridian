# Low-Volatility Rank-Weighted V2 — Prospective Paper/Shadow Implementation Contract

Status: **IMPLEMENTED FOR REVIEW / START NOT YET AUTHORIZED / PAPER AND LIVE BLOCKED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Stage: `PROSPECTIVE_PAPER_SHADOW`  
Execution impact: **false**  
Paper authorization: **false**  
Live authorization: **false**

## Purpose

Implement the already-preregistered forward-only evidence stage after the frozen Development PASS and untouched Holdout PASS.

This stage is a **shadow accounting process only**. It computes what the unchanged V2 portfolio would have done from a future boundary. It does not create orders, connect to account endpoints, mutate exchange state, change an existing Meridian Paper bot, or allocate capital.

## Frozen upstream lineage

The prospective engine verifies the exact frozen lineage before it can emit a prospective performance snapshot:

- V2 engine blob: `87302fdc0c1880a35e1bfd663be8191d5f6be429`;
- Holdout evidence blob: `f3e6c329fe57b3a5d6a4ee03dde693c33d4aa85b`;
- Holdout frozen-summary blob: `4e59899559fefe5c8f6697f9f4fc320fc9ed8516`;
- prospective-review preregistration blob: `738965343f5fc28835f15bbbcdc0a12d8cf3cfbe`;
- frozen Holdout decision: `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`.

Any mismatch fails closed.

## Frozen prospective boundary

The exact prospective start is frozen **before any eligible outcome exists**:

**2026-10-10T00:00:00Z**

This is the next untouched Saturday V2 anchor after implementation review.

The first eligible prospective outcome is therefore the complete weekly holding period:

**2026-10-10T00:00:00Z → 2026-10-17T00:00:00Z**

No holding-period return that begins before the prospective start may enter this evidence gate.

The 28-day signal formation window may use information available before the start because that information is required to form the first prospective signal. It does not count as a prospective outcome.

## Observation unit and fixed decision window

The unchanged V2 observation unit is one Saturday-to-Saturday week.

Frozen minimum:

- **12 fully completed prospective weeks**;
- **84 elapsed days**;
- fixed gate window: 2026-10-10T00:00:00Z through **2027-01-02T00:00:00Z**;
- exactly the **first 12** eligible prospective observations determine the performance gate, even if the review is performed later.

Later weeks may be monitored but may not rescue or alter the fixed first-12-week decision.

## Unchanged strategy mechanics

The prospective engine reuses the frozen V2 implementation for:

- exact 28-day / 672-return Low-Volatility feature;
- 12 frozen USD-M perpetual assets;
- continuous average-rank weighting;
- gross exposure 1.0;
- net exposure 0;
- weekly open-to-open price return;
- funding contribution;
- turnover accounting;
- baseline 10-bps one-way turnover cost;
- mandatory 20-bps stress cost;
- mandatory terminal close for the fixed 12-week gate sample.

No leverage multiplier, top/bottom basket, stop, take-profit, DCA, regime filter, asset removal, or parameter optimization is introduced.

## Public prospective source

Only unsigned public Binance USD-M market-data endpoints are permitted:

- `GET /fapi/v1/time`;
- `GET /fapi/v1/klines`;
- `GET /fapi/v1/fundingRate`;
- `GET /fapi/v1/fundingInfo`.

Forbidden:

- API keys;
- account endpoints;
- position endpoints;
- order endpoints;
- private/user streams;
- wallet/balance data;
- alternate exchange substitution;
- synthetic price or funding history.

Every HTTP response is SHA-256 receipted. Every retained per-asset source JSON is independently hashed. The complete source manifest is hashed into every snapshot.

## Funding completeness

Exact public funding timestamps and rates are used in PnL.

For cumulative deterministic coverage, no gap greater than **8 hours + 1,000 ms** is permitted.

Additionally, every canonical weekly collection validates the newest completed week against Binance's currently published `fundingIntervalHours`. This protects shortened funding intervals from silent missing rows while keeping older already-canonical weeks immutable if Binance later changes an interval.

A source ambiguity or gap fails closed and produces no eligible performance decision.

## Snapshot timing and evidence ledger

The workflow runs every Saturday at **01:15 UTC**, approximately 75 minutes after the V2 weekly boundary.

A canonical snapshot is considered timely only when collected within **12 hours** after its Saturday 00:00 UTC cutoff.

Each cutoff has exactly one immutable canonical JSON/Markdown snapshot. The first snapshot committed for a cutoff wins; reruns cannot overwrite it.

Snapshots are appended to the dedicated branch:

`research/low-volatility-rank-weighted-v2-prospective-evidence`

A mutable `LATEST` pointer may be updated, but dated canonical snapshots are never rewritten.

The final human review must verify an unbroken timely ledger consisting of:

- the 2026-10-10 start-boundary snapshot with zero completed prospective weeks; and
- the 12 weekly outcome snapshots through 2027-01-02.

A pre-start baseline snapshot may also exist and is diagnostic only.

## Frozen 12-week performance gate

The first 12 prospective weeks pass the automatic performance gate only if all are true:

- exactly **12** periods;
- exactly **12** eligible assets every period;
- gross exposure deviation <= **1e-12**;
- absolute net exposure <= **1e-12**;
- 10-bps baseline compounded return **> 0**;
- Profit Factor **>= 1.15**;
- annualized weekly Sharpe **>= 0.75**;
- maximum drawdown **<= 20%**;
- at least **2 of 3** chronological four-week blocks positive;
- 20-bps stress compounded return **> 0**;
- mean weekly Rank IC **> 0**;
- Rank IC Newey-West(4) t-statistic **>= 1.645**;
- no lineage or source-integrity failure.

The automated decisions are:

- `PROSPECTIVE_WAITING_FOR_START`;
- `PROSPECTIVE_COLLECTING`;
- `PROSPECTIVE_PERFORMANCE_PASS_LEDGER_REVIEW_REQUIRED`;
- `PROSPECTIVE_FAIL_RESEARCH_STOP`.

An automated performance PASS is **not** Paper authorization. It requires a separate human-reviewed ledger PR.

## Final promotion boundary

Only after both:

1. the fixed 12-week performance gate passes; and
2. the immutable prospective ledger is independently reviewed as complete and timely,

may a separate proposal be created for a real Meridian Paper deployment.

Even that later proposal may not authorize live trading automatically.

## Current authorization

Authorized in this PR:

- prospective-only shadow engine;
- unsigned public market-data collector;
- immutable snapshot runner;
- append-only evidence-ledger workflow;
- synthetic/lineage tests;
- fixed future start and fixed 12-week gate contract.

Not authorized in this PR:

- starting the evidence clock;
- Paper orders;
- live orders;
- exchange/account mutation.

After this PR is merged, a separate documentation-only start authorization on branch `research/low-volatility-rank-weighted-v2-prospective-start` is required. That push also creates the pre-start zero-observation baseline snapshot.
