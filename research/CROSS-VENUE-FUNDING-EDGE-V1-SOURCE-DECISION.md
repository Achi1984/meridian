# Cross-Venue Funding Edge V1 — Final Source Decision

Status: **SOURCE AUDIT FAILED — V1 CLOSED**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V1`  
Execution impact: `false`  
Discovery: **NOT AUTHORIZED**  
Validation: **LOCKED**  
Holdout: **LOCKED**  
Paper/Live: **NOT PERMITTED**

## Authoritative decision evidence

Cross-Venue Funding Edge V1 never reached strategy PnL.

The final fail-closed source verification after the validator correction was:

- main commit: `a52c56010b9a547061c82d37840f5335465b3754`
- workflow run: `37270798106`
- invariants job: **SUCCESS**
- source job: **FAILURE**
- failure: `CROSS_VENUE_V1_SOURCE_INVALID {"ok":false,"reason":"OKX_INVALID_FUNDING"}`
- blocker issue: `#528`

No source artifact or source receipt from a failed run is accepted as lock evidence.

## Root cause

The frozen V1 source contract required every accepted funding settlement to canonicalize to the hourly grid within ±1 second and required no funding gap greater than 8 hours + 1 second.

Independent cross-model source forensics established that the authoritative OKX history contains a real exceptional settlement on 2022-12-18 at 18:54 UTC after a missing scheduled settlement. The authoritative history therefore cannot satisfy the frozen V1 source assumptions without changing the contract.

A separate validator defect that could coerce invalid scalar values to numeric zero was fixed in PR #529 before this final decision. That fix changed validation correctness only and did not change the frozen V1 source thresholds or economic rules.

## Decision

Final decision: **`CROSS_VENUE_V1_SOURCE_FAIL`**

V1 is permanently closed at the source stage.

The user selected the fail-closed successor path:

- do not relax or special-case the V1 source contract;
- do not remove the exceptional event or affected period to rescue V1;
- do not calculate V1 strategy PnL;
- create a separately preregistered `CROSS-VENUE-FUNDING-EDGE-V2` with generic venue-outage/off-grid settlement semantics frozen before V2 source-result or PnL inspection.

## Consequence

V1 may not reopen Source Audit, Discovery, Validation, Holdout, Paper or Live stages.

Historical failed source runs remain diagnostic evidence only. They are not strategy evidence and do not authorize source/split locks or promotion.

Any successor research must use a new ruleset and must freeze its implementation/source contract before running a V2 source audit.
