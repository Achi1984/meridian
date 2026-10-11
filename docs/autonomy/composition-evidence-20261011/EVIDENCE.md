# Offline continuation composition evidence

Executed 2026-10-11 by delegated local implementation agent. No GitHub writes, model calls, network, workflow changes, token use, production imports, or live execution. This is a test harness, not a runtime dispatcher or activation approval.

## Reproduce

Use Node 22+ (String.isWellFormed is required by the unchanged intake). From this directory:

```sh
node --test test/autonomy-continuation-composition.test.mjs
```

No dependencies or network are required. Four source fixtures under scripts/ are byte-identical to pinned upstream blobs. The first test recomputes each Git SHA-1 blob and compares provenance.json. They are deliberately fixture copies, not an integration or replacement of the repository's modules. Their original branches are unchanged. Total package is approximately 49 KB.

## Exact source provenance

| Source | Commit | Git blob |
| --- | --- | --- |
| PR642 scripts/development-centre-planner.mjs | 3847ebc128214c3b7fe370bf82cadf75229b5780 | cee54e3dd3f9eaeade610221aecaf87e09692c6c |
| PR648 scripts/event-continuation-intake.mjs | eb8d14b7a46beac8ab00b78cddc5a28f8e85adfd | b4db44a654ddb73b14d2455166d0a2417c6019ff |
| PR661 scripts/continuation-contract.mjs | 2eb21df86ffa5366ae6fbaa75f6ce128b306da19 | 3963b21cf31a22ce3c6bd8906cba267673e32a23 |
| Main scripts/codex-bridge-v3-review-coordinator.mjs | 98c3f8aa96cb2b7ffcdaa1ec37e7b3fc9d724028 | 05971d00c2f5f9fad3e15cea21a7893ba0b4aa58 |

## Results

10 tests, 10 pass, zero failed/skipped/cancelled. test-results.txt preserves the local run. An initial test expected a BLOCKED planner result for a changed head with the old request identity. The actual coordinator correctly throws REQUEST_SCOPE_CONFLICT earlier. The final test pins that stricter behavior and separately verifies STALE_CI after clearing the old review. No upstream source was modified to make tests pass.

The composed successful path explicitly supplies synthetic collector evidence: normalized event hint, preapproved fixture manifest, claim, simulated model-start/draft observation, planner CI/review evaluation, simulated completion, next fixture packet claim. It does not invent a real collector or claim actual model/PR activity.

## Genuine integration boundaries demonstrated

- Intake results cannot directly satisfy continuation event or planner input schemas. A workflow success hint has neither base SHA nor required-job totals. No direct event-to-approval conversion exists.
- Mailbox GREEN prose remains an opaque body digest and cannot supply a review verdict.
- The planner requires head != base, so it cannot assign the first coding task. Task selection in the test uses the existing continuation manifest, not the planner.
- Duplicate intake is deterministic but explicitly not durably deduplicated. Duplicate/replayed simulated claims fail. Unknown outcomes block both retry and next packet after a JSON snapshot round trip; this is not persistent cross-process proof.
- Old request identity on a changed head fails REQUEST_SCOPE_CONFLICT; stale CI and contradicted review block readiness.
- After a simulated merge and matching post-merge checks, continuation rejects the new main as BASE_MISMATCH. It still accepts the old fixed manifest base. Therefore an authenticated current-base collector plus separately reconciled fresh manifest is a mandatory future integration gate. This test must not be interpreted as automatic rebasing or a live safety proof.
- Authentication, authorization, dispatch, merge and durability flags remain false.

## Next bounded integration prerequisite

Use these results to define the missing trusted collector/dispatch boundary and concrete owner-approved live packet. Do not widen the fixture-only continuation policy, activate workflows, or convert synthetic results into merge authority. The current deployed coding pilot remains the expired fixed Trial4 configuration; this harness does not change that.
