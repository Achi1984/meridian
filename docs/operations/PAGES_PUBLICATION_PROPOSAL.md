# Pages publication proposal — disabled

This is an inert source proposal, not operational setup. The workflow template is
`docs/operations/pages-publication.yml.disabled`; GitHub Actions cannot discover
it there. Neither merging this packet nor running its mocked tests publishes a
site. No source setting, environment rule, secret, role or live deployment changes.

## Problem and scope

Managed branch publishing uses `dynamic/pages/pages-build-deployment`, not an
editable repository workflow. The prior deployment reported Pages API `succeed`,
yet the next create request returned HTTP 400 naming that same prior deployment
as still active. This occurred for prior `5d851cb5` and again for prior `adec0f2`.
Serializing jobs does **not** prove that GitHub's backend admission lock is clear.
The proposal provides a single writer and explicit bounded reconciliation; it
does not promise to repair that contradiction or hide it behind repeated retries.

Allowed source paths are exactly this runbook, the disabled template,
`scripts/pages-publication-readiness.mjs`, and its one contract-test file.
No changes to existing release/source pins, trading, providers or review gates.

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
   this assumption fails closed. Do not guess a predecessor. Bootstrap/recovery
   uses manual inputs for exact current main and a separately reconciled prior
   successful deployment ID. The expected SHA must equal the workflow's main SHA.
3. Current candidate 404 means not yet created and permits checking the prior ID.
   Prior ID 404 means missing evidence and blocks. Existing current success means
   `ALREADY_DEPLOYED` and skips creation. An existing current queued/in-progress
   deployment is polled, never duplicated. Only known queued/in-progress statuses
   are waited on; other states require reconciliation.
4. Prior success plus absent current candidate yields `READY` for exactly one
   pinned deploy action. There is no `continue-on-error`, auto-rerun, alternate
   artifact or compensating cancellation. The official action retains its own
   existing timeout/cleanup behavior for its own pending deployment; this proposal
   adds no cancellation, particularly none of a successful prior deployment.
5. The after-step requires current Pages status `succeed` and unchanged main.
   This API evidence does not replace live verification of the exact deployed
   build/version and the existing postmerge gate. The external single-writer
   release discipline must hold through creation: no API read can atomically lock
   the branch against a concurrent merge.

If Pages again says prior success while rejecting creation as prior-in-progress,
stop with the request ID, deployment IDs and run IDs. Keep the currently served
site. Reconcile with GitHub Support; never fabricate generic deployment statuses,
cancel a successful deployment, weaken checks, or loop reruns to obtain green.

## Approval and activation sequence (not executed)

The owner merge delegation in mailbox639/comment6229644994 permits reviewed
source merges but explicitly does not authorize runtime recovery/setup or
scheduler activation. This proposal requires concrete approval of the source
switch and publisher activation, not a new approval merely for a protected path.
Root owns that decision request and checks later instructions before activation.

1. Review this exact inert four-file candidate with focused contract tests and the
   existing exact-head independent review/CI gates. No active YAML is introduced.
2. After separate concrete owner approval, record the current main, prior successful
   Pages ID, source `main`/root, URL and environment protections. Reconcile any active
   or contradictory deployment first; no automatic cancellation. Prepare and review
   the activation-only move to `.github/workflows/pages-publication.yml`.
3. During a single-writer maintenance window, an authorized admin/maintainer changes
   Settings → Pages → Build and deployment → Source from **Deploy from a branch**
   to **GitHub Actions**. Preserve all other settings. Do not use configure-pages
   with automatic site enabling or grant workflow administration rights.
4. Only after that readback, merge the reviewed activation move. Its main push runs
   the custom publisher. If a bootstrap mismatch blocks, use the separately approved
   exact-main manual dispatch with reconciled prior ID; do not change the helper.
   Never operate both branch and custom publishers simultaneously.
5. Verify artifact scope, one publisher, terminal Pages success and exact live build.
   Keep the dependent-merge gate closed until complete. This proposal does not change
   release cadence, schedules, trading or production data-provider activation.

Rollback is a separate recorded setup action: freeze new merges/dispatches, let any
active publisher reach a known terminal state, disable/remove the active custom
workflow through the reviewed source change, and only then restore Pages source to
the recorded `main`/root branch configuration. No deletion of the Pages site or
domain/HTTPS changes. If state is unknown, leave the served site and escalate rather
than switching publishers or cancelling blindly.

Concrete approval text for the prepared candidate:

> I approve the separately reviewed Pages setup/activation: switch this repository
> from branch publishing to GitHub Actions, activate the pinned publisher described
> here with only the existing job token and stated standard Pages permissions, keep
> Jekyll/artifact/public scope and environment protections unchanged, and verify the
> exact live build before further dependent merges. No automatic cancellation of
> successful deployments, retry loop, new secret/role, trading or provider activation
> is authorized. Rollback follows the recorded single-publisher procedure above.

## Validation and official references

Run `node --test test/pages-publication-readiness.test.js`. Tests use injected GET
responses and a virtual clock; they do not contact GitHub or deploy anything.
Activation review must additionally check the exact output path inventory against
the existing Jekyll build and GitHub's workflow syntax/environment constraints.

- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/rest/pages/pages#get-the-status-of-a-github-pages-deployment
