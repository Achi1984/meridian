# Continuation after Trial 3 — design candidate

Status: inactive proposal, 2026-10-10. Base: `0e28cd177a3af0423092789647b439f60fed809f`.
This document does not activate a dispatcher, change policy or grant permissions.

## Evidence and remaining objective

Trial 3 established CI completion -> one model invocation -> validated fixed
documentation/test packet -> Draft #659, without human output repair. The Lead
subsequently merged #659 under separate owner approval. Exact-head review is
mailbox #571 comment 6101059306. Source run 38070967939 attempt 5, controller
38077659791 attempt 2, output CI 38077755377 attempt 2. Both controller and output
CI needed maintainer approval. The post-merge Release Safety retry job
114289950412 passed 2152 tests; Runtime Smoke 38078247732, Coordinator 38078247752
and Pages 38078247255 succeeded. Superseded #656 was closed without deleting its
branch or claim. Existing claims must not be reused.

Lead evidence was reconciled on 2026-10-10 shortly after 21:09 Europe/Vienna:
https://github.com/Achi1984/meridian/issues/571#issuecomment-6101059306
and https://github.com/Achi1984/meridian/pull/659#issuecomment-6101050655.
Controller approval and no-human-repair findings originate in the earlier Trial3
audit; the current continuation reread that audit, not a new reproduction of Trial3.

The next objective is a bounded queue that progresses without manual CI-start
clicks. Selecting a packet, claiming it, generating a Draft, obtaining CI evidence,
reviewing and merging are distinct operations. A completed model call is not a
completed development packet. Automatic product merge is outside this proposal.

## Two distinct approval barriers

| Origin | Documented behavior | Consequence for Meridian |
| --- | --- | --- |
| Copilot cloud-agent PR, such as #653 | Repository Copilot setting can permit workflows after agent pushes without maintainer approval | Does not establish that our custom Actions publisher is covered |
| Custom workflow PR created/updated with GITHUB_TOKEN, such as #659 | opened/synchronize/reopened create approval-required workflow runs | Copilot's setting must not be assumed to remove this gate |
| Custom workflow using a dedicated GitHub App installation token | GitHub documents this as a way to trigger PR workflows without the GITHUB_TOKEN approval requirement | Candidate transport; actual repository delivery, policies and CI still need a live test |

Sources checked 2026-10-10:
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions

Do not disable the Copilot approval setting merely to repair #659's publisher.
Do not introduce automatic approval of arbitrary runs. Do not use pull_request_target
to execute generated code with privileged credentials. The existing ChatGPT GitHub
connector is not a credential that can be copied into Actions.

## Recommended implementation sequence

1. Complete an offline queue/claim contract and the CI trust-boundary inventory.
   Reuse the existing intake proposal in #648 and planner in #642 as inputs, not
   independent dispatchers. Neither prototype currently proves authenticated
   transport or an atomic shared runtime lease. No changes to their branches.
2. Prepare a dedicated publisher App transport on an isolated branch, disabled
   by default. Keep the model's existing read-only GITHUB_TOKEN plus Copilot
   requests permission; the App token is only for deterministic publication.
3. Obtain exact-head independent review and a concrete owner decision covering
   App installation, credential handling, repository enforcement, workflow changes,
   approved packets, time window and invocation budget. Preparation is not adoption.
4. Run one bounded delivery test with a fresh claim and trusted output template.
   Prove actual PR CI starts without a maintainer click. Stop if the controller
   itself requires approval; do not approve it automatically or call the run hands-free.
5. Only after that gate, test two explicitly approved packets in sequence. No
   free-form task invention. Stop at reviewed Drafts; Lead retains merge control.

The App route is recommended for the custom publisher, not yet proven here.
Keeping the current manual gates remains the fallback if installation or adequate
repository enforcement is unavailable. The hourly Lead remains an existing fallback,
not a second publisher. No PAT or paid OpenAI API is proposed.

## Credential and CI boundaries to prove before activation

- App installation restricted to Achi1984/meridian. Candidate permissions:
  contents:write, pull_requests:write, metadata:read; no administration,
  workflows:write, Actions write or secrets API rights. Validate sufficiency in
  the delivery test; never silently broaden after failure.
- Mint short-lived installation tokens for that repository and exact permissions.
  Store the private key only through approved secret provisioning. Never pass it
  to the model, PR code, generated artifact, logs or browser-evaluated scripts.
- These GitHub permissions are NOT branch-scoped and do NOT technically prohibit
  all merge/API operations. A code allowlist alone cannot enforce that promise.
  The Lead's 2026-10-10 approximately 21:09 Europe/Vienna read of
  https://api.github.com/repos/Achi1984/meridian/branches/main at base 0e28cd17
  reported protected:false. This is a dated observation, not a complete ruleset
  inventory or a guarantee about future settings. Before live
  App publication, independently verify enforceable repository rules protecting
  main and policy/workflow refs, without granting the App bypass. If adequate
  enforcement cannot be shown, stop and bring the concrete residual risk to Owner.
  No rule is changed by this proposal.
- Trusted publisher runs code pinned to an approved main SHA, uses exact path and
  byte-template validation, and cannot take API paths or executable commands from
  model output. App token is minted only after validation and revoked after use.
- Inventory every workflow triggered by the resulting push/PR, not only Release
  Safety. Establish which revision supplies workflow code, token permissions,
  persisted checkout credentials, caches/artifacts and secrets. CI executing
  proposed code must not receive publication credentials or privileged shared caches.
  Do not turn a configuration toggle into permission to execute arbitrary code.
- A documentation plus trusted-test template proves only that narrow output class.
  Extending generation to arbitrary product JavaScript requires a separate
  executable-code isolation design and review before that scope is activated.

## Queue and recovery contract

Use a manifest approved at an exact commit, with finite ordered packet IDs,
explicit allowed paths/output class, dependency IDs, per-packet base policy,
acceptance tests, maximum invocations, expiry and owner-approval reference.
No issue body, comment, label or model output may expand this manifest.

Candidate states: READY, CLAIMED, GENERATING, DRAFT_CREATED, CI_WAIT,
REVIEW_WAIT, COMPLETE_DRAFT, FAILED, UNKNOWN_OUTCOME, EXPIRED, REVOKED.
Claim is an atomic create of a permanent packet ref, binding manifest digest,
packet ID, control/source run attempts and base SHA. A failed or uncertain model
call consumes the claim. A crash never grants a new invocation automatically.
App rotation, workflow retries and edited comments do not reset claims.
Protect claim refs against deletion and rewriting through enforceable repository
rules; otherwise their permanence is only a convention. Reconcile a durable
invocation ledger before any new model invocation. Administrative override of
those protections is outside the guarantee and must invalidate activation until
audited reconciliation; a missing claim ref alone must never mean safe to rerun.

Events are wake hints only: re-read authenticated live state. Process completed CI
and mailbox created/edited/deleted events; deleted or changed reviews revoke stale
evidence. Exact head/base changes invalidate prior gates. Unknown API outcomes,
pagination truncation, missing identity or conflicting claims stop dependent writes.

One shared coordinator must serve event and hourly work. The current document
lease validator is not a runtime lock. Permanent packet claims alone do not stop
two different packets with overlapping files. Before real multi-packet work,
implement and test an atomic shared lease with fencing enforced by the actual
writer, including the hourly Lead and every manual/connector/App publication path.
If existing credential paths cannot enforce the fence, explicitly suspend those
writers during the bounded trial; do not claim global exclusion from an App-only
lock. A pre-write GET is not atomic compare-and-swap. Git ref fast-forward alone
is not a general lease. If the selected API cannot enforce the required CAS/fence,
do not publish; use a supported transactional store or revise the design with Owner.

Start the next independent packet only after the previous Draft has exact-head CI
and independent review, and no conflicting writer exists. A dependent packet waits
for the Lead's separate merge and all required post-merge checks. CI success by
itself never authorizes merge, next scope, more model calls or deadline extension.
Unknown budget/expiry/revocation state prevents a new claim. Existing zero-overage
account settings remain required, but are not a measured per-run credit ceiling.

## Acceptance matrix for the implementation

| Scenario | Required observed result |
| --- | --- |
| Same event twice; reordered CI attempts | One claim and at most one invocation per packet |
| Hourly and event worker race | Exactly one fenced writer; loser makes no model call |
| Two different packets overlap paths | Second cannot start while first owns the scope |
| Lost response after claim/model/push/PR | UNKNOWN_OUTCOME; reconcile without replay |
| Main, manifest, PR head or review revision changes | Invalidate stale evidence; no dependent publication |
| Model emits wrong path, structured fact, executable test or API instruction | Reject before token mint/publication; structured facts bind to fresh authenticated fields |
| Expiry, revocation, exhausted cap, unreadable budget | No new claim/model/publication; retain evidence |
| App creates first eligible Draft | Real CI starts with no maintainer approval; all relevant workflows audited |
| First independent Draft accepted | Exactly next preapproved packet can start; no recursion beyond manifest |
| Packet depends on unmerged code | Wait for Lead merge and successful post-merge checks |
| App has broader effective access than approved | Activation blocked; do not advertise branch-only write rights |

Factual validation covers explicit structured fields such as PR number, merge SHA,
timestamp and canonical URL from authenticated GitHub reads. It cannot establish
the truth of arbitrary additional prose; independent review covers those claims.

Rollback: disable intake and new claims first, fence existing writers, stop model
processes, revoke installation tokens and restore explicitly changed settings.
Preserve claims, run IDs and artifacts. Do not delete branch claims as cleanup.
Do not promise cancellation of a request GitHub already accepted; reconcile it.

## Concrete next authorization boundary

Current work: design and inactive implementation preparation only. No new live
trial, model invocation, setting change, App installation, private key, deadline
extension, recurring dispatcher or automatic merge is authorized by this document.
After reviewed implementation and enforcement evidence exist, the Owner should
receive one concrete activation proposal with exact head, repository settings,
credential scopes, packet list, limits, cutoff, disable procedure and remaining
risks. Do not request a vague blanket authorization now.
