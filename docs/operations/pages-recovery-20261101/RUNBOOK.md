# Pages recovery package — 2026-11-01, inert

Source-only preparation. Nothing here activates a workflow, changes Pages
settings, deploys, cancels or reruns. This package consolidates the four inert
source/proposal files from PR #1092 with the three recovery documents from PR
#1098 into one seven-file candidate, based on main
`c60bb6a2516ab88000ece3c339bcc740280a9ba7`.

The original PRs #1092 and #1098 remain untouched; neither is a separate merge
prerequisite. Review and merge only this consolidated candidate after the
required recorded decision. Any later activation change must first verify the
exact template blob below. A changed template—including any action pin, build
source/destination or artifact name—invalidates the patch review and requires a
new patch and review.

## Approval, dependency order and hold

The Owner, Achi1984, must record an explicit, narrowly scoped Pages recovery
merge exception before any held recovery source or activation change may merge.
The Lead's source-merge delegation does not authorize runtime recovery, setup,
the Pages source switch or deployment. The existing hold remains until that
decision is explicitly recorded and all applicable exact-head review, CI and
postmerge gates are complete. This Draft PR is not that decision and does not
lift the hold.

Order:

1. Review the exact seven-file consolidated candidate and verify its source
   provenance in `PAGES_PUBLICATION_PROPOSAL.md`.
2. Only after the recorded exception and all ordinary merge gates, merge this
   inert candidate.
3. Before any later activation PR, verify on its base that
   `docs/operations/pages-publication.yml.disabled` has blob
   `20002686c294ba7099ec56705618dc3891584d6b`. Run the in-memory validator;
   it checks that exact template and the exact activation result.
4. If that blob differs, stop. Regenerate and independently review the patch
   against the new source. Changes to pins, Jekyll source/destination or artifact
   name are not a mechanical rebase and invalidate this review.

The activation patch is not applied here. No `.github/workflows` path is written.

## Observed evidence (GitHub reads, 2026-11-01)

| Item | Observed value |
|---|---|
| Main | `c60bb6a2516ab88000ece3c339bcc740280a9ba7` |
| Pages configuration | `build_type: legacy`, source `main` `/`, status `errored`, HTTPS enforced, public, no CNAME, URL `https://achi1984.github.io/meridian/` |
| Last reported successful deployment | `adec0f21985f9b937039cff1751a94f74c71846e`, Pages status `succeed`; it is an ancestor of main |
| Conflicting create failure | Run `41293347696`, job `124813148075`: HTTP 400 request `4C40:1C0180:FB947:347D4F:6AE70B1B` said the deployment was in progress and asked to cancel `adec0f21…`, while that ID reported `succeed` |
| Current-SHA API response | `GET pages/deployments/c60bb6a2…` returned HTTP 200 `{"status":""}` |
| Independent API probe | #942/comment `6558108770` reports read-only GETs: the current SHA and made-up SHA `1111…` each returned HTTP 200 with the identical 13-byte body `{"status":""}`; `adec0f21…` returned `{"status":"succeed"}` |
| `github-pages` environment | One branch-policy rule for custom branch policy `main` |
| Preserved pipeline | Checkout `3d3c42e5…`; Jekyll `44a6e6be…`, source `.` to `./_site`; upload artifact `github-pages` via `56afc609…`; deploy via `368f8252…` |

The template's full immutable action pins and build/artifact shape are preserved
from PR #1092. The documented evidence does not establish that the Pages backend
lock has cleared, that `queue: max` is accepted by GitHub's workflow parser, or
that public serving continues across a source switch.

## Readiness guard and backend lock are separate

The fixed concurrency group (`meridian-pages-production`), `queue: max` and
GET-only helper provide bounded single-writer sequencing. They do **not** clear
or repair the Pages backend admission lock. A `READY` result means only that
the helper's bounded reads agree. The official deploy action can still receive
HTTP 400 because GitHub reports a successful prior deployment as in progress.
The repository has no verified mechanism to resolve that contradiction; keep
the lock as a separate stop condition and escalate to GitHub Support.

`queue: max` parser validation is **NOT_PERFORMED**. The focused source test
checks that the template contains the text; it is not workflow-syntax validation.

## Preconditions before any later activation (all required; otherwise stop)

1. The consolidated inert candidate is merged at its reviewed tree, and the
   later activation PR is independently reviewed against the exact template
   blob `20002686c294ba7099ec56705618dc3891584d6b`.
2. The Owner's explicit recovery-merge exception and separate concrete
   activation/setup approval are recorded. Do not infer either from this PR,
   prior approvals or Lead merge delegation.
3. In a single-writer window, record exact current main M0, Pages configuration,
   public URL, environment rules and the last successful deployment SHA P.
   Re-read them at execution time; do not assume today's evidence remains current.
4. No relevant deployment is queued or in progress, and P is known successful
   and an ancestor of the candidate main. Do not cancel any deployment.
5. Confirm that any potential gap in active publishing is acceptable. Switching
   the source before the activation workflow is installed may leave no active
   repository publisher for a period. Whether the old deployed content continues
   to be served through that period has **not been verified**. Do not claim
   serving continuity from the prior `succeed` status. If the uncertainty is
   unacceptable, the current public marker cannot be checked, or state is
   unknown, stop before switching the source.
6. Preserve existing settings and permissions. An authorized admin/maintainer
   performs the separately approved UI source change. The workflow reuses only
   the ephemeral job token: build `contents: read`; deploy `contents: read`,
   `pages: write`, `id-token: write`; existing `github-pages` environment.
   No PAT, new secret, role, policy or workflow permission change.

## One bounded deployment attempt: branch on observed disposition

After a separately approved source switch and activation merge, inspect the
actual run and exact Pages API responses. Do not predict whether the push run
will fail or succeed. The helper is read-only before its `READY` output; only
that disposition reaches the single `deploy-pages` step.

1. **`READY`** — the exact main is still the expected SHA, the supplied prior
   successful deployment is an ancestor, and the expected current deployment
   was absent on the before-phase reads. `deploy-pages` runs once. This is the
   one actual deployment attempt. Record run/job IDs and the action result.
   Whether the action succeeds or fails, do not dispatch again, retry, cancel
   or start another publisher. A backend-lock 400 is a stop; preserve its
   request ID and escalate.
2. **`ALREADY_DEPLOYED`** — the current expected SHA already reports `succeed`;
   the deploy step is skipped. Do not create another deployment. Require the
   after-step's `VERIFIED` result and the public runtime/version check below
   before treating the work as complete.
3. **`DEPLOYMENT_NOT_SUCCESSFUL`** — a known non-success status blocked the
   readiness check before `READY`; this is not permission to retry. The helper
   message does not identify which SHA caused the block. Read the exact current
   and prior deployment records. If the current expected SHA is failed,
   cancelled, queued/in progress beyond the helper's bound, or otherwise not
   absent/successful, stop. A single manual bootstrap dispatch is permissible
   only when the push run definitively did not invoke `deploy-pages`, the
   current expected SHA is still main and is absent (`404` or the observed
   empty status in before phase), and a separately reconciled successful
   ancestor P is known. Bind `expected_sha` to that exact current main and
   `previous_deployment_sha` to P. This dispatch may lead to the one actual
   deployment attempt; if it does not reach `READY`, stop. Never dispatch a
   second time.
4. **`DEPLOYMENT_STATUS_UNKNOWN`** — malformed, missing, null, unauthorized,
   unexpected or otherwise unknown API evidence blocks. Transport failures
   also fail closed (the runner reports `REQUEST_FAILED` for non-coded errors).
   Do not substitute another prior SHA, dispatch, retry, cancel or infer absence.
   Stop and reconcile read-only.
5. For every other error, including main mismatch, nonancestor prior, timeout,
   missing prior evidence or failed after-phase verification, stop. If
   `deploy-pages` was invoked, the one attempt is consumed regardless of its
   conclusion. Do not blindly retry or cancel.

The special empty-status interpretation is evidence-bound: HTTP 200
`{"status":""}` means absence only for the exact expected current SHA in phase
`before`. It is not accepted for a prior SHA, after phase, missing/null status,
malformed body, any other status, failed state or transport error. A current
404 remains safe absence only before publication; a prior 404 remains missing
evidence and blocks.

## Verify success with the existing public check

Pages technical acceptance requires both the publication run to conclude
successfully with the after-step returning `VERIFIED`, and a public `version.json`
read whose `version`, `buildId` and `terminalBuild` match the expected values
from the exact reviewed main. On the inspected base,
`version.json.terminalBuild` is `10.0-r130`; use the marker from the exact
activation main if that source value changes. These checks establish Pages
technical evidence only.

Overall release acceptance is separate. The existing `MERIDIAN Runtime Smoke`
workflow in `.github/workflows/runtime-smoke.yml` runs
`scripts/runtime-smoke.mjs` on main pushes. It checks the public Pages version,
terminal assets and manifest, and also requires the gateway deployment SHA to
match the exact pushed `GITHUB_SHA`. With the gateway runtime paused, that
gateway exact-SHA condition is not currently satisfiable. If Runtime Smoke is
blocked for that reason, record it as an overall release acceptance blocker,
not a Pages deployment failure. Do not waive the check or reinterpret a Pages
pass as full release acceptance.

Even if the Pages technical checks pass, full release acceptance and hold
lifting remain blocked until a separate concrete Owner decision addresses the
paused gateway or explicitly records alternative acceptance. No such decision
or waiver is granted by this runbook. Keep dependent merges held until all
applicable overall gates and that decision are complete. Do not manually rerun
the smoke or use it as a substitute for Pages terminal-state evidence.

## Rollback and stop procedure

On any stop, keep the merge hold. Record the observed disposition/error, exact
main and deployment SHAs, run/job IDs, request ID and relevant public marker.
Do not cancel, rerun, edit pins, change source or start the other publisher as
an improvised recovery. If a 400 names a `succeed` deployment as in progress,
preserve the contradictory evidence and escalate to GitHub Support.

Rollback is a separate recorded and approved action: freeze new merges and
dispatches, wait for a known terminal state without blind cancellation, remove
the active custom workflow through a reviewed source change, then restore the
recorded branch publishing settings. Do not delete the site or alter domain or
HTTPS. If state is unknown, leave settings unchanged and escalate.

## Validation boundaries

- Focused helper tests use injected responses and a virtual clock; they do not
  make GitHub requests or deploy.
- `validate-patch.py` applies the activation hunk in memory and checks exact
  source/result blob IDs. It does not write files or run `git apply`.
- **NOT_PERFORMED:** workflow parser/syntax validation (including `queue: max`),
  any workflow write or execution, source switch, deployment, cancellation,
  rerun, live serving-continuity probe or backend-lock recovery.
