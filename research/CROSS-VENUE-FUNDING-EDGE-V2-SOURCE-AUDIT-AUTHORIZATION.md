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

## Canonical source evidence lineage

The canonical V2 source evidence is fixed before any source result is known:

1. **Canonical run.** The canonical source workflow lineage is the first V2 source workflow run triggered by the merge commit of this authorization PR. Its `head_sha` must equal that merge commit. A later workflow run created by another commit can never replace this canonical lineage.
2. **Transport/infrastructure aborts and retry limit.** A failure is retryable only when execution aborts before `validateCrossVenueV2Source` produces a result because of transport or infrastructure failure, including exhausted HTTP retry handling, provider/network unavailability, GitHub runner failure or timeout. Such an abort is not a source result. Only a GitHub re-run of the same canonical workflow run on the same merge commit and unchanged repository tree is allowed. At most **two retries after the initial attempt** are allowed, for **three total attempts**. Every attempt and its classification must be recorded in `MERIDIAN_HANDOFF.md`.
3. **Final source-semantic result.** Any completed `validateCrossVenueV2Source` result is final for V2. An `ok:false` result is `CROSS_VENUE_V2_SOURCE_FAIL` and cannot be retried, rescued or replaced. A deterministic schema/parser/integrity failure after the relevant source object has been fully downloaded is also a final source-semantic result, not a transport retry. A successful `ok:true` result is final source evidence but still authorizes no later stage by itself.
4. **Later runs are diagnostic only.** A source run produced by any different commit is diagnostic and cannot replace the canonical source evidence. It may only confirm determinism when its canonical source-receipt digest is exactly identical to the canonical receipt digest. Any digest difference is `CROSS_VENUE_V2_SOURCE_DETERMINISM_FAILURE`, not an alternative evidence choice, and blocks further research progression.
5. **Durable persistence before transition.** Before any later research-stage transition, a separate reviewed source-evaluation PR must persist the canonical `runId`, `runAttempt`, merge `commitSha`, `artifactId` and `receiptDigest` in repository continuity/evidence state. This must occur before artifact retention expires. Until that evaluation PR is merged, V2 remains at `SOURCE_AUDIT`.

These rules prevent both "retry until green" evidence selection and accidental termination from pure transport failure.

Any subsequent stage transition requires a separate reviewed PR under `RESEARCH_STAGE_TRANSITION` / `SPLIT_OR_STAGE_LOCK`.
