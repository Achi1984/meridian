# Bounded routine-merge standing approval — candidate

The owner's 2026-10-10 15:47 Vienna agreement authorizes preparation of this
candidate. It does not itself adopt or merge this policy. Policy adoption and
later policy amendments remain reserved decisions requiring concrete approval.

After adoption, a manually verified standing owner approval may satisfy
`ownerMergeApprovalRequired=true` for an eligible routine product packet. The
scalar remains true: approval is never optional. Reserved work still needs its
own concrete owner approval. ChatGPT remains sole lead and merge owner.
`automaticDispatchAuthorized=false` and all other existing gates remain unchanged.
No automatic merge runner, workflow activation, spending, production activation,
research/trading permission or release cadence change is introduced here.

## Routine scope and reserved decisions

Routine means a nonempty change inside an assigned, explicitly approved product
packet with exact allowed paths. Owner approval covers the objective and path
boundary; the lead subsequently binds the resulting head/base under the adopted
policy without requiring fresh owner approval of that generated commit. The lead
cannot expand the approved scope. `packet.approved` describes that bounded scope
approval, not a new per-head owner decision. Architecture/direction, costs, permissions,
policy/workflows/release cadence, security/deployment, production activation and
research/trading stage decisions remain reserved. Uncertainty is escalated.

`classifyRoutineMerge()` only checks supplied offline claims. It cannot authenticate
owner approval, actor identity, independence, scope classification, fresh GitHub
state, complete diffs or required-check selection. `eligibleForStandingApproval`
is advisory; every result has `authorized=false`, `authenticated=false`,
`provenanceVerified=false`, `mergeAllowed=false`, `dispatchAllowed=false`.
Even an eligible result grants no permission to merge.

Before acting, the lead must authenticate the adopted approval, assigned scope,
semantic classification and current remote evidence; inspect the complete diff,
including rename sources; verify independent full Claude review with zero gaps
or unresolved blockers, exact head/base CI and all required integration checks.
The lead must also verify that the previous release's required postmerge checks
succeeded, that no write outcome is unknown and no conflicting writer exists.
Recheck current head/base immediately before merging. After merging, publish
FINAL_MERGE_STATUS and await required postmerge checks before continuing the
pipeline. Failure or uncertainty stops continuation and requires reconciliation.

Path checks are a conservative backstop, not complete semantic classification.
They reserve all `.github/`, `scripts/`, `research/`, `docs/autonomy/` changes,
canonical GO/checkpoint, root index/version and PWA entrypoints, and dependency/deployment configuration, and filenames
containing governance, agent, authentication/security, deployment, research,
trading, paper/bot, release or merge-policy tokens. This classifier's own source,
tests and document are protected. New sensitive features disguised under generic
filenames must still be recognized by the lead's semantic review. False positives
require a concrete owner decision; never weaken the gate merely to pass a packet.

## Strict input envelope

Input has exactly `policyAdopted`, `packet`, `candidate`, `ci`, `review`,
`coordination`, `priorRelease`, `classification`.

| Record | Required fields |
|---|---|
| packet | workId, owner (`CHATGPT`), approved, repository, headSha, baseSha, allowedPaths, requiredChecks, priorRequiredChecks |
| candidate | workId, owner, repository, headSha, baseSha, liveHeadSha, liveBaseSha, changes |
| changes entry | path, previousPath (null except rename source) |
| ci | runId, headSha, baseSha, checks |
| CI check | name, status, conclusion, total, passed, failed |
| review | commentId, headSha, baseSha, reviewer (`CLAUDE`), verdict, independent, fullDiffReviewed, gaps, unresolvedBlockers |
| coordination | unknownOutcome, conflictingWriter |
| priorRelease | headSha (current base), checks |
| prior check | name, status, conclusion |
| classification | agreedProductScope, architecture, direction, costs, permissions, policy, workflows, releaseCadence, productionActivation, researchStage, tradingStage, security, deployment |

Repository is exactly `Achi1984/meridian`; commit pins are full lowercase SHA-1
strings. Candidate identity/pins must equal its packet; live pins and CI/review
pins must match. Allowed paths are exact, unique relative paths; both rename
endpoints must be included. Required-check lists must be nonempty and unique.
All checks present must be completed success; each required candidate check must
report a positive test count with all passed and zero failures. Required candidate
checks therefore represent test-bearing checks; do not invent totals for non-test
jobs. Prior postmerge checks require success but no artificial test totals.
Verdicts are GREEN_LIGHT, REVISION_REQUIRED or NEEDS_MORE_EVIDENCE; only the first
can qualify. All reserved classification flags must be false, scope agreed true.

Identifiers use 3–128 ASCII letters/digits/`.`/`_`/`:`/`-`, starting alphanumeric.
Statuses: QUEUED, RUNNING, COMPLETED. Conclusions: SUCCESS, FAILURE, PENDING,
CANCELLED, SKIPPED. Counts are nonnegative safe integers, passed + failed = total.
Collections allow 128 entries, strings 1024 characters, nesting 10, and total
copied values 10,000. Unknown fields, accessors, proxies, cycles and inconsistent
totals fail closed before any result. Missing evidence is not inferred.

## Validation

`node --test test/routine-merge-policy.test.js` covers approval/adoption boundaries,
reserved actions, protected paths and renames, all evidence pins, unknown outcomes,
concurrent writers, previous-release failure, incomplete CI/review, malformed and
hostile inputs, determinism and immutable false authority. This is local evidence,
not independent exact-head review or successful live enforcement.
