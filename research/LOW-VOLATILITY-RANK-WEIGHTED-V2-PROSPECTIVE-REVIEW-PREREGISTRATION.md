# Low-Volatility Rank-Weighted V2 — Prospective Paper/Shadow Review Preregistration

Status: **PREREGISTERED — PROSPECTIVE EVIDENCE NOT YET STARTED**

## Purpose

Define the next evidence gate after the first untouched Development and Holdout PASS for Low-Volatility Rank-Weighted V2.

This document does **not** authorize Paper deployment, live deployment, order creation, exchange mutation, automatic promotion, parameter tuning, or retrospective result selection.

## Frozen lineage

- Holdout freeze merge: `e99a84d6f4bba8370eb3a2dd979aca7385bb94b8` / PR #477.
- Canonical first untouched Holdout workflow: `37133809945`.
- The strategy definition, universe, ranking, weighting, rebalance schedule, costs, accounting, and all completed Development/Holdout evidence remain frozen by their existing research lineage.
- No rule may be changed in response to prospective observations.

## Prospective-only boundary

Evidence used by this gate must be generated strictly after a separately recorded prospective start timestamp.

No historical replay, pre-start observation, carry-over position, Development sample, Holdout sample, or already-observed return may count toward the prospective decision.

The first prospective snapshot must record zero eligible completed prospective observations unless the strategy has genuinely completed an observation entirely after the recorded start boundary.

## Gate design

The prospective review must measure the unchanged V2 strategy under shadow/Paper-equivalent accounting without placing live orders.

Before the first eligible prospective outcome is observed, a separate implementation/review PR must freeze:

1. the exact prospective start timestamp;
2. the exact observation unit implied by the frozen V2 rebalance/holding mechanics;
3. a minimum elapsed-time requirement;
4. a minimum count of fully prospective completed observations;
5. baseline and stress cost treatment identical to the frozen strategy where applicable;
6. data-completeness and stale/missing-data fail-closed rules;
7. decision metrics and thresholds;
8. treatment of any carry-over/pre-boundary state;
9. exact source/provenance receipts required for every snapshot.

No threshold may be selected after inspecting prospective performance.

## Decisions

Before the implementation/review contract above is frozen, status is:

`PROSPECTIVE_REVIEW_NOT_STARTED`

After a future eligible prospective evidence window:

- PASS may authorize a **separate human-reviewed Paper promotion proposal only**.
- FAIL freezes the unchanged V2 prospective failure and blocks result-driven rescue within this V2 lineage.
- Neither outcome authorizes live trading automatically.

## Safety invariants

- researchOnly = true
- executionImpact = false
- autoPromotion = false
- liveAuthorized = false
- paperAuthorized = false at this stage
- no credentials, orders, wallet/exchange mutation, bot mutation, or production sizing mutation
- no retrospective optimization
- no parameter/asset/side/regime cherry-picking after prospective start

## Next gate

Merge this preregistration only after exact-head Release Safety and independent review. Then implement the prospective shadow evidence collector and freeze its observation-count/time requirements **before** recording the prospective start boundary or inspecting any eligible prospective performance.
