# Cross-Venue Funding Edge V2 — Source Audit Authorization

Status: **AUTHORIZED SOURCE AUDIT ONLY**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V2`  
Canonical pre-transition main: `2e463a533e8d0a6de3b509620cb1af7da847acd5`

## Decision

MERIDIAN may transition V2 from `PREREGISTERED` to `SOURCE_AUDIT` and set `sourceAudit:true`.

All later stages remain false:

- discovery: false
- validation: false
- holdout: false
- paper: false
- live: false

This authorization permits only the already-frozen main-only V2 source collector to acquire and validate authoritative public source data against the frozen V2 data contract.

It does **not** authorize:

- strategy signal calculation;
- strategy PnL;
- Discovery;
- Validation;
- Holdout;
- Paper;
- Live;
- any change to preregistered economics, source semantics, coverage, grid, recovery, accounting, thresholds or gates.

## Preconditions satisfied

- PR #530: V1 permanently closed as `CROSS_VENUE_V1_SOURCE_FAIL`; V2 preregistered.
- PR #532: V1/V2 research lineage pinned in Frozen Research Guard.
- PR #533: active-lane and cross-model reviewer continuity aligned.
- PR #535: V2 implementation/source contract merged with exact-head Claude GREEN LIGHT.
- V2 post-merge Source Gate run `37287414973`: invariants SUCCESS, source collection SKIPPED because `sourceAudit=false`.
- Release Safety run `37287414943`: SUCCESS.
- Runtime Smoke run `37287414927`: SUCCESS.
- No V2 Source Audit has run.
- No V2 strategy PnL has been calculated.

## Automatic post-merge behavior

After this reviewed transition PR merges to main, `.github/workflows/cross-venue-funding-edge-v2-source.yml` may execute its source job because all three conditions become true:

1. event is `push`;
2. ref is `refs/heads/main`;
3. frozen V2 stage lock has `sourceAudit:true`.

The collector independently checks the same stage lock before network access.

The resulting run is source-evidence only. A successful source audit does not unlock any later stage. A failed or inconclusive source audit also does not permit rule rescue inside V2.

Any subsequent stage transition requires a separate reviewed PR under `RESEARCH_STAGE_TRANSITION` / `SPLIT_OR_STAGE_LOCK`.
