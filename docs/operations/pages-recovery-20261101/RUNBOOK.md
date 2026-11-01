# Pages recovery package 2026-11-01 — inert, not executed

Documentation only. Nothing here activates a workflow, changes Pages settings,
deploys, cancels or reruns. The mechanism, readiness contract, permissions,
rollback principles and approval text are those of PR #1092
(head `2e788edc522542d26e489d553be33fa44a680d62`, cumulative GREEN
#942/comment6557001049). This package adds only the exact activation diff and an
ordered execution/rollback sequence. Where #1092 already says it, it is referenced.

Files: `pages-activation.patch` (rename + 3 comment lines), `validate-patch.py`
(in-memory check), this runbook.

## Readiness guard vs backend lock — not the same thing

The #1092 queue (`meridian-pages-production`, `cancel-in-progress: false`,
`queue: max`) and GET-only helper give one writer and fail-closed sequencing.
They do **not** clear or repair GitHub's Pages admission lock. A `READY`
disposition only means our reads agree; `deploy-pages` can still get HTTP 400.
That lock is the unresolved operational blocker below.

## Evidence reused (GitHub reads, 2026-11-01)

| Item | Value |
|---|---|
| main | `c60bb6a2516ab88000ece3c339bcc740280a9ba7` |
| Pages config | `build_type: legacy`, source `main` `/`, status `errored`, https enforced, public, no CNAME, `https://achi1984.github.io/meridian/` |
| Last success | `adec0f21985f9b937039cff1751a94f74c71846e` (run 41291064688), Pages deployment status `succeed`; compare to main: `ahead` 5, merge base = itself |
| Failure | run 41293347696 job 124813148075 (`c60bb6a2`): HTTP 400 request `4C40:1C0180:FB947:347D4F:6AE70B1B` "due to in progress deployment. Please cancel adec0f21… first" while that ID reports `succeed`. Same pattern earlier for prior `5d851cb5` (#1092). |
| Current-SHA deployment | `GET pages/deployments/c60bb6a2…` → HTTP 200, `status: ""` |
| Environment `github-pages` | one `branch_policy` rule, custom branch policy `main` (branch) |
| Preserved pins (build log run 41290246270) | checkout `3d3c42e5…` (v7.0.1), jekyll-build-pages `44a6e6be…` (v1), upload-pages-artifact `56afc609…` (v3), deploy-pages `368f8252…` (v5). Source `/github/workspace/.` → `./_site`; artifact `github-pages` 14030916 bytes |

The template in #1092 matches these pins, source/destination and artifact name.
The repo has no `_config.yml`, `.nojekyll` or `Gemfile` at main, so output stays the
default Jekyll site. Expect about 14 MB per artifact; the exact inventory was not
compared.

## Preconditions (all needed; any failure → stop)

1. #1092 is merged at its reviewed head. The patch needs the template and
   `scripts/pages-publication-readiness.mjs` on main.
2. The owner decision text below is posted, plus an exact-head review of the
   activation PR that this patch produces.
3. Single-writer window: no other merges or dispatches. Record main SHA M0,
   `GET /pages` (build_type, source, URL, https, cname), and the environment rules.
4. No deployment is `deployment_queued`/`deployment_in_progress`, and the last
   successful prior P is known (today P = `adec0f21…`, unless a later
   deployment succeeds). Do not cancel anything.
5. Permissions: an admin/maintainer changes the source in the UI. The workflow
   uses only the ephemeral `GITHUB_TOKEN`: build `contents: read`; deploy
   `contents: read, pages: write, id-token: write`. It uses the existing
   `github-pages` environment (main-only). No PAT, secret, role or policy change.

## Execution (one attempt)

1. **Source switch:** Settings → Pages → Build and deployment → Source:
   *Deploy from a branch* → *GitHub Actions*. Change nothing else. Read back
   `GET /repos/Achi1984/meridian/pages`: `build_type` should be `workflow` and
   URL/https/public unchanged.
2. **Activation PR:** on a branch from current main, apply
   `pages-activation.patch` (`git apply --index`). Review and merge it within the
   window. The merge push is SHA M1.
3. **Expected push outcome:** `event.before` is the previous main, which has no
   successful deployment (c60bb6a2 shows `""`; the #1092 merge was branch-built
   or failed). The helper therefore blocks with `DEPLOYMENT_NOT_SUCCESSFUL` or
   `DEPLOYMENT_STATUS_UNKNOWN` before any deploy. This is the intended fail-closed
   behavior, not a failure to retry.
4. **Bootstrap dispatch (exactly once):** use `workflow_dispatch` on `main` with
   `expected_sha=M1` and `previous_deployment_sha=P`. The helper rechecks
   main==M1, P ancestor of M1, P `succeed`, M1 absent, and then rechecks once
   more. The 5-min budget, 10 s polls and 10 s per request are from #1092.
   `READY` runs `deploy-pages` once. `ALREADY_DEPLOYED` skips the deploy.
5. **Success evidence (all needed):** the run conclusion is success. Step
   `Verify Pages terminal state` returns `VERIFIED`, which means
   `GET pages/deployments/M1` = `succeed` and main still equals M1. Record the run
   and job IDs and the deployment URL. The live site serves M1's build/version
   through the existing postmerge/live check. Exactly one Pages workflow is active
   and no `dynamic/pages` run exists for M1. Only then reopen dependent merges.
6. **On any stop:** keep the served site. Record the disposition code, run/job IDs,
   request ID and deployment IDs. Do not rerun, cancel, edit the helper or switch
   publishers. A 400 "in progress deployment" naming a `succeed` deployment
   means the backend lock persists. Escalate it to GitHub Support with the
   evidence table above.

## Rollback (separate recorded action)

As in #1092: freeze merges/dispatches. Let any active run reach a terminal state;
do not cancel blindly. Merge the reverse of the patch (`git apply -R`) so the
template goes back to `docs/operations/`. Then set Source back to *Deploy from a
branch*, `main` `/`, and read back `GET /pages` against the recorded state. Do not
delete the site or change domain/HTTPS. If state is unknown, leave the site and
escalate. Never run both publishers at once.

## Validation performed / not performed

- Performed: `python3 docs/operations/pages-recovery-20261101/validate-patch.py`.
  It reads the template string from `2e788edc`, applies the hunk in memory and
  confirms old blob `20002686…` → new blob `1dd11512…`. Exactly 3 comment lines
  change and the YAML body is byte-identical to the GREEN-reviewed template.
- **NOT performed:** `git apply` against any tree, writes to `.github/workflows`,
  GitHub workflow-syntax validation (including `queue: max`, which is still
  unverified), any workflow execution, source switch or deployment. These are
  pre-activation checks for the activation PR.

## Unresolved operational blockers

1. **Backend lock:** Pages rejects new deployments as blocked by `adec0f21…`
   while reporting it `succeed`. Neither the queue nor the switch to Actions is
   shown to clear it. Step 4 can fail the same way. If it does, the only path is
   GitHub Support. The repo has no lever to fix it.
2. `queue: max` acceptance by the workflow parser is not validated (lead-accepted
   residual risk, #942/6557001049).
3. The bootstrap needs P = the last *successful* deployment. Re-read it at
   execution time.

## Owner decision text (smallest exact)

> I approve the Pages activation in docs/operations/pages-recovery-20261101 per
> the PR #1092 approval text: switch Pages source to GitHub Actions, merge the
> exact reviewed pages-activation.patch, and run at most one bootstrap dispatch
> with the recorded current main and last successful deployment SHA. On any stop,
> including the backend-lock 400, keep the served site, do not retry or cancel,
> and escalate; rollback per this runbook.
