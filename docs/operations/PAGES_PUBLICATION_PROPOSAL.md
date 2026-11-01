# Pages publication proposal — disabled

This is an inert source proposal, not operational setup. The template is
`docs/operations/pages-publication.yml.disabled`; GitHub Actions cannot discover
it there. Neither merging this candidate nor running its mocked tests publishes a
site. No source setting, environment rule, secret, role or live deployment changes.

## Consolidated candidate and provenance

This seven-file candidate is based on main
`c60bb6a2516ab88000ece3c339bcc740280a9ba7` and consolidates:

- PR #1092 head `2e788edc522542d26e489d553be33fa44a680d62`: its inert template
  (blob `20002686c294ba7099ec56705618dc3891584d6b`), helper (blob
  `6d222ec2696a0e94bfcb8586266eb428623f0687`), focused tests (blob
  `21dbe2267e108a7c1c61e750bd3378cf23df6956`) and this proposal (blob
  `beefaa75779e95f303b998e5fabb666bcac7a894`).
- PR #1098 head `5e48ae5c945ba76c62a80a21037d2741a783107c`: the recovery
  runbook (blob `5366ca11eb6e77e1eeb51ab4e33aef3711017bb4`), activation patch
  (blob `645e2ccb0c814c716be2c5b82a5610b0a77282df`) and in-memory validator
  (blob `2889bc500491450cbb08df73fb5f47cebd246438`).

The helper, focused tests and this proposal were modified from recorded PR #1092 head `2e788edc522542d26e489d553be33fa44a680d62`, the runbook and validator were modified from recorded PR #1098 head `5e48ae5c945ba76c62a80a21037d2741a783107c`, and the workflow template and activation patch remain byte-identical to their source blobs `20002686c294ba7099ec56705618dc3891584d6b` and `645e2ccb0c814c716be2c5b82a5610b0a77282df`.

The original PRs remain untouched and are not merge prerequisites. Review and
merge this consolidated candidate first. Any later activation change must verify
the template blob expected by its patch; any change to the pins, source,
destination, artifact name or template bytes invalidates that review and requires
fresh review. No active workflow is included here.

Allowed paths for this package are exactly:

- `docs/operations/PAGES_PUBLICATION_PROPOSAL.md`
- `docs/operations/pages-publication.yml.disabled`
- `scripts/pages-publication-readiness.mjs`
- `test/pages-publication-readiness.test.js`
- `docs/operations/pages-recovery-20261101/RUNBOOK.md`
- `docs/operations/pages-recovery-20261101/pages-activation.patch`
- `docs/operations/pages-recovery-20261101/validate-patch.py`

No changes to existing release/source pins, trading, providers or review gates.

## Problem and scope

Managed branch publishing uses `dynamic/pages/pages-build-deployment`, not an
editable repository workflow. The prior deployment reported Pages API `succeed`,
yet the next create request returned HTTP 400 naming that same prior deployment
as still active. This occurred for prior `5d851cb5` and again for prior `adec0f2`.
Serializing jobs does **not** prove that GitHub's backend admission lock is clear.
The proposal provides a single writer and explicit bounded reconciliation; it
does not promise to repair that contradiction or hide it behind repeated retries.

## Proposed publisher after separate approval

- Trigger on main pushes or a manually reviewed main dispatch; fixed concurrency
  group `meridian-pages-production`, `cancel-in-progress: false`, `queue: max`.
  Queueing is not a commit-order guarantee. Superseded main SHAs stop before
  publication; no stale artifact may overwrite the current approved head.
- Preserve observed action pins and build behavior: checkout
  `3d3c42e5aac5ba805825da76410c181273ba90b1`; Jekyll
  `44a6e6beabd48582f863aeeb6cb2151cc1716697`, source `.` to `./_site`;
  upload-pages-artifact `56afc609e74202658d3ffba0e8f6dda462b719fa`, artifact
  `github-pages` from `./_site`; deploy-pages
  `368f82528645a54fb793d4d04e342629a3f51346`. No `.nojekyll`, alternate static
  generator, whole-repository raw upload or expansion of the public scope.
- Reuse the ephemeral job `GITHUB_TOKEN`. Build: `contents: read`. Deploy:
  `contents: read`, `pages: write`, `id-token: write`. Reuse `github-pages` and
  its existing main-only protection. No PAT, new secret, administration permission,
  generic deployment-status write or action-run rerun permission.
- Keep the existing public URL, domain/HTTPS configuration and site visibility.
  The token is passed only to the readiness step and official deployment action.

## Readiness and stopping contract

All helper requests are same-origin, allowlisted **GET** requests. Requests have
a 10-second maximum timeout, and reconciliation has a five-minute total budget
with ten-second polling. A malformed response, unauthorized read, unknown status,
failed/cancelled deployment or timeout blocks publication; it never issues a write.

1. Bind expected SHA to workflow SHA and authenticated current main. Reject forced
   pushes, branch creation/deletion, non-main events, invalid/zero SHAs and a prior
   SHA that is not an ancestor. Recheck main during and immediately before readiness.
2. For a normal push, `event.before` is only an **expected prior deployment ID**,
   not proof of a previous deployment. This relies on the existing one-merge then
   successful-postchecks discipline. If intervening commits were not published,
   this assumption fails closed. Do not guess a predecessor. A separately approved
   bootstrap dispatch binds exact current main and a separately reconciled prior
   successful deployment ID.
3. Current candidate 404 is absence only in the before phase. The fixed-repository
   GET evidence recorded in the recovery runbook also shows HTTP 200
   `{"status":""}` for both the undeployed current main SHA and a made-up SHA.
   The helper treats that empty status as absence only for the current expected
   SHA in the before phase. Prior-SHA empty status, after-phase empty status,
   missing/null/malformed/unknown status, failed states and transport errors block.
   Prior ID 404 remains missing evidence and blocks.
4. Existing current success means `ALREADY_DEPLOYED` and skips creation. An existing
   current queued/in-progress deployment is polled, never duplicated. Only known
   queued/in-progress statuses are waited on; other states require reconciliation.
   Positive prior success plus absent current candidate yields `READY` for exactly
   one pinned deploy action.
5. There is no `continue-on-error`, auto-rerun, alternate artifact or compensating
   cancellation. The official action retains its own existing timeout/cleanup
   behavior for its own pending deployment; this proposal adds no cancellation,
   particularly none of a successful prior deployment.
6. The after-step requires current Pages status `succeed` and unchanged main. This
   is Pages deployment evidence, not overall release acceptance. Pages technical
   acceptance also requires a public `version.json` read matching the expected
   `version`, `buildId` and `terminalBuild` from the exact reviewed main. The
   marker on the inspected base is `10.0-r130`; do not assume it remains current.

The separate overall release acceptance includes the existing `MERIDIAN Runtime
Smoke` check in `.github/workflows/runtime-smoke.yml`. Its
`scripts/runtime-smoke.mjs` verifies the public Pages version and also requires
the gateway deployment SHA to match the exact pushed SHA. With the gateway
runtime paused, that exact-SHA condition is not currently satisfiable. A
Runtime Smoke failure for that reason is an overall release acceptance blocker,
not a Pages deployment failure; it must not be used to relabel Pages evidence or
waived. Even if Pages technical acceptance passes, full release acceptance and
the merge hold remain blocked until a separate concrete Owner decision addresses
the paused gateway or explicitly records alternative acceptance. No such
decision or waiver is granted by this proposal.

The workflow status alone cannot prove Pages' internal admission lock cleared or
that a source-switch gap preserved the currently served content. The runbook makes
that continuity uncertain and sets a stop criterion rather than asserting it.
If Pages again says prior success while rejecting creation as prior-in-progress,
stop with the request ID, deployment IDs and run IDs. Keep the existing merge hold.
Reconcile with GitHub Support; never fabricate statuses, cancel a successful
deployment, weaken checks or loop reruns to obtain green.

## Approval, hold and activation sequence (not executed)

The Owner, Achi1984, must record an explicit narrowly scoped Pages recovery merge
exception before any held recovery source or activation change may merge. The
Lead's merge delegation does not authorize runtime recovery, setup or activation.
The existing hold remains until that recorded decision and all exact-head review,
CI and applicable postmerge gates are complete. This draft grants no approval.

1. Review and merge this exact consolidated inert candidate only after the
   recorded recovery merge exception; do not merge or close original PRs #1092
   or #1098 as separate prerequisites.
2. For a later activation-only change, verify the current main template blob is
   exactly `20002686c294ba7099ec56705618dc3891584d6b`, run the in-memory
   validator, and review the exact activation patch. If the blob differs—especially
   because pins, source, destination or artifact name changed—stop and regenerate
   the patch/review against the new source.
3. Before any switch, obtain separate concrete Owner approval for setup/activation.
   Record current main, last successful Pages ID, source `main`/root, URL and
   environment protections. Reconcile active or contradictory deployment state
   without cancellation. Queue syntax, including `queue: max`, remains
   **NOT_PERFORMED**.
4. The switch to GitHub Actions may create a period before a workflow publisher
   is active. Whether the old deployed site remains served throughout that period
   has not been verified. If that uncertainty is unacceptable or public serving
   cannot be verified before switching, stop before the source change. Do not infer
   continuity from a `succeed` status on an older deployment.
5. Only after the single-writer window and approved settings readback, merge the
   reviewed activation change. Follow the runbook's observed-disposition branches.
   Never run both branch and custom publishers simultaneously.
6. Establish Pages technical acceptance from after-step `VERIFIED` plus the
   matching public `version.json` marker. Separately, retain every required
   overall release/postmerge gate. The existing `MERIDIAN Runtime Smoke` also
   requires the gateway exact-SHA check, which is currently unsatisfiable while
   the gateway is paused; that blocks overall release acceptance without
   constituting a Pages failure. Keep the merge hold until the required gates
   pass and a separate concrete Owner decision addresses the paused gateway or
   explicitly records alternative acceptance. Do not waive a check or treat this
   source-only candidate or readiness disposition as acceptance.

Rollback is a separate recorded setup action: freeze new merges/dispatches, let any
active publisher reach a known terminal state, remove the active custom workflow
through a reviewed source change, and only then restore Pages source to the
recorded `main`/root branch configuration. No deletion of the Pages site or
domain/HTTPS changes. If state is unknown, leave the site and escalate rather than
switching publishers or cancelling blindly.

## Validation and official references

Run `node --test test/pages-publication-readiness.test.js`. Tests use injected GET
responses and a virtual clock; they do not contact GitHub or deploy anything.
Activation review must additionally check the exact output path inventory against
the existing Jekyll build and GitHub's workflow syntax/environment constraints.

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/rest/pages/pages#get-the-status-of-a-github-pages-deployment
