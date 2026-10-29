# M11 event coordinator — preparation only

Status: `PREPARATION_ONLY`. The 24-hour/three-packet manifest remains disabled
with start/end unset. The owner authorized source preparation, not activation.
This packet installs no workflow, schedule, transport, mutation adapter,
credential, or continuous runtime. It does not create another UI/cache writer.

## Current evidence and capability matrix

Reconciliation snapshot: current `main` is
`34eb7dfd804fed8769bec3d8f9e7bb0557c31b62` (2026-10-29). The coordinator
branch has been integrated with that main; the prior supervisor timing patch was
dropped in favor of the current-main copy. Earlier coordinator CI run
`40632733971` is for the former `eacb230…` / `d62004e…` pair and is not evidence
for this reconciled source. No current-pair coordinator CI or final independent
Claude review is claimed here.

The following are source observations and dated run receipts, not proof that a
new workflow or credential works:

| Capability | Current evidence | What it establishes / does not establish |
|---|---|---|
| Interactive Copilot assignment | Prior task delivery in #997 was explicitly requested by an owner and completed its R2 focused suite (33/33, receipt `6488608926`). | Human-started assignment/delivery can work. It does not prove a reusable unattended Actions dispatch or automatic resume. |
| Native issue assignment | `scripts/native-copilot-task-dispatch.py` and `scripts/native-copilot-task-runtime.py` implement a bounded, inert assignment adapter. It requires an externally verified PAT, OAuth token, or GitHub App user-to-server token; it excludes Actions `GITHUB_TOKEN` and App installation tokens. | The adapter is source, not a deployed workflow or successful unattended dispatch. No credential was inspected, provisioned, or used. |
| Existing Copilot request workflow | `.github/workflows/copilot-coding-pilot.yml` accepts a fixed historical source SHA (`99eff911…`), successful Release Safety, attempt cap, and owner `triggering_actor`; only its generation job has `copilot-requests: write`. Publishing has separate contents-write and publisher-App scope. | A one-packet, immutable pilot, not general current-PR dispatch. Its scoped permission does not prove this coordinator can call the Copilot API. |
| Existing CI event pilot | `.github/workflows/copilot-ci-event-pilot.yml` is pinned to the old `feat/v11-version-history-20261010` branch, October 10 deadline, three-run cap, and read-only event summary; it also declares `copilot-requests: write`. | Expired, branch-specific observation experiment. It is not a current coordinator listener or general author/continuation path. |
| Claude reviewer trigger | `.github/workflows/claude-mailbox-review.yml` only accepts issue #942 comments by `Achi1984` containing `@claude` and `CROSS_MODEL_REQUEST`. It declares `contents: read`, `issues: write`, `pull-requests: read`, `actions: read`, and `id-token: write`; Claude is read-only, with `Edit,Write` disallowed and 35 turns. | An owner-authored mailbox request can launch a bounded independent review. A bot comment, arbitrary issue text, or coordinator event cannot pass this gate. This does not approve CI or request PR review automatically. |
| Exact-pair hosted CI observation | Release Safety run `40821781547`, attempt 2, job `123277027311`, passed 2,877/2,877 on PR #1000 head `a013a202…` / base `34eb7df…`. Its independent final Claude review was requested in mailbox comment `6488665928` and was still in progress at snapshot. | Demonstrates one successful current-main-pair hosted run and a separately owner-triggered reviewer path, not coordinator readiness or reliability proof. |
| CI permissions / approval | `.github/workflows/backend-safety.yml` declares only `contents: read` and `pull-requests: read`; no workflow-write or approval capability is declared. | `action_required` cannot be approved by this packet. The interactive connector and `GITHUB_TOKEN` are not evidence of an unattended approval path. |
| Merge and postchecks | No coordinator merge adapter exists. Four exact-merge checks are configured in the manifest, but the coordinator has no authenticated collector or execution path for them. | Source merge remains Lead-owned; automatic merge/deploy, approval bypass, and automatic post-merge continuation are unsupported. |

### Flow evidence and gaps

The last observed chain is intentionally split across different packets: the
#997 author completed its requested R2 work; #1000 then obtained exact-pair
Release Safety success and requested independent Claude review. Those events
were not joined by a coordinator and do not show unattended continuation.
Issue #942 remains the durable human-facing mailbox, but comments are receipts,
not authenticated locks. The source-only coordinator run and any previously
green CI on its old head/base pair are stale for the current base.

Current event discrimination is a key gap: Claude's workflow accepts only an
owner-authored comment on #942, while the coding pilot is fixed to a historical
SHA and owner-triggered workflow run. A coordinator-generated comment cannot
impersonate `Achi1984`; no general accepted bot trigger or automatic ChatGPT
session wake-up exists. Do not infer either from `copilot-requests: write`.

## Reducer and replay contract

`scripts/autonomy/m11-event-coordinator.mjs` is a pure, offline state reducer.
`scripts/autonomy/m11-event-coordinator-replay.mjs` runs a generated synthetic
event sequence; it has no network imports or live adapter. Actor strings are
strict per-event allowlist claims, not authenticated GitHub provenance. The
event schema has no issue-body or free-form instruction field, so arbitrary
issue text cannot become a command. An unsupported agent operation transitions
to `BLOCKED`.

The state binds the fixed repository, PR number, head, base, phase, author
delivery, CI attempt/workflow, review coverage/verdict, merge SHA, required
postchecks, a three-package WIP ceiling, and one writer. `wipCount` and actor
fields are offline claims, not a live authenticated package count; no new
dispatch is allowed without a current external WIP read and a fenced lease. A
new CI attempt at the same head invalidates an earlier review. The proposed
pilot is capped at one concurrent draft PR.
Head/base movement clears dependent author/CI/review/merge/postcheck gates.
CI must be completed `success` for the exact head/base and workflow before a
review request may be proposed. Partial, truncated, turn-limited, or
`NEEDS_MORE_EVIDENCE` reviews retain coverage parts but remain incomplete.
`REVISION_REQUIRED` yields one consolidated correction proposal; pending CI and
`action_required` yield waiting actions. Only complete full-coverage
`GREEN_LIGHT` reaches `WAIT_FOR_OWNER_MERGE`; source merge is observed, never
performed. `COMPLETE` requires all four configured postchecks to report
success for the exact merge SHA in the pilot manifest. Other scopes must pin
their applicable postcheck allowlist before replay; unlisted checks cannot
complete the state. Each applicable postcheck receipt must match the workflow
ID pinned in state. CI and postcheck receipts also carry an explicit
`currentRunId`, `currentRunAttempt`, and monotonic `selectionRevision`; stale
attempts are ignored and different run IDs require a newer authoritative
selection revision. The offline reducer cannot authenticate that selection:
the future collector must determine it from authoritative current workflow
state. The pilot manifest deliberately leaves these IDs as placeholders; the
synthetic replay uses generated test IDs only.

Event delivery deduplication binds repo/PR/head/base/phase plus immutable event
ID and digest. The stable `actionDedupeKey` hashes exactly repo/PR/head/base/
phase so two deliveries cannot create different action identities for the same
pair and phase. A repeated event is a no-op; a conflicting reuse of an event ID
fails closed. The replay has finite limits: 96 events, 24 transitions, 4 KiB
per event, 64 KiB total, and 10 seconds. The source also requires a synthetic
state window of at most 24 hours; the proposed manifest's actual start/end
remain unset.

All decisions are untrusted offline proposals: authentication, provenance,
authorization, dispatch, merge, activation, trading authority, and external
effects remain false. A comment/receipt is not an atomic lock. Any future
mutation lane requires a durable shared compare-and-swap lease/journal tied to
the expected repo/PR/head/base/phase, one-writer fencing, and reconciliation
after every write. No such hosted CAS/lease guard is implemented or proven by
this packet. An unknown mutation outcome blocks the lane until authoritative
read reconciliation; it must never be blindly retried.

## Disabled pilot proposal

`m11-event-coordinator/pilot-manifest.json` still proposes at most 24 hours,
three packets, three WIP packages, one writer, and one draft PR. It is
`enabled: false`; start/end and repository/PR/actor allowlists remain unset or
owner-approval placeholders. All network, mutation, dispatch, review-request,
automatic merge/deploy, and approval-bypass flags remain false. Existing
resources only; no plan upgrade. Publisher/research stay paused and runtime or
trading authority stays false. Exact required workflow identities still need
verification from authoritative runs before any future activation review.

## Concrete handoff design — reviewable proposal only

The desired progression is one bounded event-driven state machine:

| Transition | Required authoritative evidence | Proposed next action | Present status |
|---|---|---|---|
| Admit packet → author | Owner-approved repo/PR/head/base and an authenticated, current event; external WIP count below three; one writer lease. | Dispatch one fixed task with an idempotency key for repo/PR/head/base/phase. | No generic authenticated event collector or general Copilot dispatcher is installed. |
| Author → CI | Re-read PR head/base and author delivery; select current Release Safety workflow/run/attempt from Actions API, not event payload alone. | Wait while pending; on failure/action-required produce one consolidated exception/correction receipt; do not retry an unchanged request. | Existing Release Safety runs provide CI, but no current coordinator subscribes or persists their state. The workflow token declares only `contents: read` and `pull-requests: read`. |
| CI success → independent review | Full success on exact PR/head/base and current workflow selection. | Request a complete independent review bound to the exact CI run/attempt/workflow. | Current Claude workflow only starts from an owner-authored #942 comment. A bot cannot trigger it. A new authenticated event path is required for automatic review. |
| Review → correction or Lead merge | All required coverage parts and complete verdict tied to the exact successful CI pair; truncated/turn-limited/partial responses remain incomplete. | `REVISION_REQUIRED`: one consolidated correction dispatch, then return to exact-pair CI. `GREEN_LIGHT`: Lead may perform an already-authorized routine merge; coordinator never merges. | No automatic PR review request or Lead/ChatGPT wake-up path exists. No workflow receives merge authority. |
| Merge → four postchecks | Authoritatively observed merge SHA plus current run selection and pinned workflow identity for every applicable check. | `COMPLETE` only when all four checks succeed on that SHA; otherwise one deduplicated exception and wait/reconcile. | The reducer models this gate, but no current collector persists or advances it. The manifest IDs are placeholders. |

### Event authentication, durable state, and unknown outcomes

An eventual collector must treat webhook/workflow payloads as hints, then
re-fetch the repository, PR, head/base, workflow identity, run attempt,
conclusion, actor and `triggering_actor`, review threads, merge SHA, and checks
through GitHub's authenticated API. It must reject forks, wrong repositories,
unlisted actors/workflows, stale head/base, incomplete pagination, and unknown
current-run ordering. It must never parse arbitrary issue text as executable
instructions. The offline reducer's actor strings and selection revisions are
not authenticated evidence.

Each persisted transition needs a durable atomic compare-and-swap on
`(repository, PR, head, base, phase, revision)`, a lease owner/expiry, a
monotonically increasing fencing epoch, and a unique operation key. Commit the
event digest and new revision before offering the next action. Re-read the lease
and exact source pair immediately before any side effect. If a remote write has
an unknown outcome, mark it `UNKNOWN`, reconcile the authoritative remote state,
and never blindly retry. Emit one exception receipt per stable action key; later
unchanged event deliveries are no-ops.

There are two existing fencing mechanisms to evaluate, neither a complete
coordinator lease:

* `SQLiteAttemptJournal` in `scripts/native-copilot-task-dispatch.py` is a
  durable, one-shot operation fence using SQLite `FULL` synchronous commits.
  It requires a pre-provisioned existing database on stable, access-controlled
  storage that survives runner/process restarts. The source does not establish
  that hosted Actions has such shared storage, nor does this journal implement
  the coordinator's mutable revision/lease state.
* The dispatcher's `github_ref` mode proceeds only after this invocation
  receives and validates HTTP 201 for a create-only claim ref. It is useful as a
  fail-closed one-operation claim, but its own documentation requires validation
  of ref atomicity/retention. It does not alone provide renewable leases,
  monotonically fenced writers across phases, or atomic state-plus-assignment.
  A comment is never a substitute for either mechanism.

Accordingly, current source supports no proven unattended CAS/lease store. Do
not enable side effects until one store is selected, its crash/concurrency/
rollback properties are integration-tested, and UNKNOWN reconciliation is
exercised. A future ref-backed state log or shared SQLite service is a design
candidate, not a capability claim.

### Minimum viable next step and exact remaining authority

The smallest useful no-mutation stage is a separately reviewed, read-only
`workflow_run` observer for the exact Release Safety workflow. It would
re-fetch exact-pair run and PR state, persist an allowlisted status/coverage
receipt, and stop at `WAITING` on pending, action-required, ambiguous, or
unsupported events. It cannot dispatch an author, trigger the current Claude
workflow, approve `action_required`, request a review, merge, or deploy. A
temporary artifact is not durable state; a mailbox comment is not a lock.
Therefore that observer alone does not remove the owner/Lead handoff.

To attempt end-to-end continuation in a later, separately approved package:

1. Reuse the native task dispatcher's immutable task pins and no-retry behavior
   for author assignment only. Its existing names/types are a user-to-server
   PAT, OAuth token, or GitHub App user access token; Actions `GITHUB_TOKEN` and
   App installation tokens are explicitly ineligible for native assignment.
   The one-packet request must pin issue body digest, main SHA, workflow/run/
   attempt, actor, assignees, and expiry. A secret name such as
   `COPILOT_NATIVE_ASSIGNMENT_USER_TOKEN` is only a proposal; no credential was
   inspected or requested. If this capability is not approved and verified,
   keep author dispatch `BLOCKED`.
2. Separately review a collector/reviewer trigger that accepts authenticated
   exact-pair workflow events. The existing Claude trigger cannot be reached by
   a bot comment. If Claude is used, its existing OAuth secret name is
   `CLAUDE_CODE_OAUTH_TOKEN`; its existence/value was not inspected and its
   existing owner-comment workflow does not authorize automatic event calls.
   Only a separately reviewed workflow may use it for the same read-only review
   scope and full-coverage contract.
3. Select and test the durable CAS/lease/fencing store before enabling any
   automatic dispatch or receipt. The native SQLite journal and create-only
   ref are candidates with the limits above; neither is proven as a shared
   multi-phase state store in hosted Actions.
4. Preserve explicit human stops: `action_required` approval remains owner
   controlled; merge remains Lead-owned with no coordinator merge token; deploy
   remains outside scope. Under a future standing owner policy, Lead need not
   ask for another “Go” for a routine eligible merge, but an external Lead
   invocation is still required. Actions cannot wake ChatGPT by themselves.
5. Persist progress and deduplicated exceptions in #942 only after a separately
   reviewed, narrowly scoped receipt path exists. Ask the owner only for a
   strategic decision, a real permission/credential/cost/runtime change, or an
   unresolved blocker; never duplicate an unchanged request. Do not invent
   approval for this disabled preparation packet.

No new workflow, schedule, permission, credential, secret, spending, runtime,
automatic merge/deploy, approval bypass, or activation is authorized here. The
manifest's 24-hour/three-packet proposal remains disabled and unset until the
concrete implementation, exact permissions, current evidence, and test plan
receive independent source review and owner/security approval.

### Authority inventory (names and types only)

| Operation | Minimum capability candidate | Current result |
|---|---|---|
| Read current PR/run/check/review state | Actions installation token with `actions: read`, `pull-requests: read`, `contents: read`; exact event collector must be separately reviewed. | Existing Release Safety workflow has only contents/PR read; no coordinator collector. |
| Native Copilot issue assignment | Verified user-to-server PAT/OAuth/GitHub App user token, plus immutable task pins and a durable one-shot fence. | Adapter source only; no live capability proof or secret inspection. |
| Claude independent review | Existing `CLAUDE_CODE_OAUTH_TOKEN` OAuth secret plus a separately reviewed authenticated event path. | Current workflow only accepts owner-authored #942 request. |
| Status receipt | Narrow `issues: write` if #942 comments are selected as the receipt channel; retain state separately under CAS. | Existing Claude workflow has it only for requested review receipts; no coordinator receipt path. |
| Persistent operation fence/state | Existing SQLite attempt journal on stable shared storage, or a validated ref-backed CAS design. | Storage durability, full-state CAS, retention, and fencing are unproven. |
| Approve `action_required`, merge, deploy | No coordinator capability. | Unsupported and intentionally remains a human/Lead boundary; no `actions: write`, merge, or approval-bypass permission proposed. |
| Publisher/research/runtime/trading | None. | Remain paused/false; not part of this coordinator. |

## Local checks

```sh
node --test test/m11-event-coordinator.test.js
node scripts/autonomy/m11-event-coordinator-replay.mjs
```

Both use generated/local data only. Hosted full CI and the required independent
Claude and Lead implementation reviews remain pending; preparation is not
activation.
