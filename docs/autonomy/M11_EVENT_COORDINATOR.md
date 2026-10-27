# M11 event coordinator — preparation only

Status: `PREPARATION_ONLY`; the pilot manifest is disabled and has no start/end
timestamps. The owner authorized this reviewable source packet in mailbox #942
comment 6453205248, not activation. This packet does not install a workflow,
schedule, network transport, mutation adapter, credential, or continuous runtime.
It does not create another UI/cache writer.

## Current evidence and capability matrix

The checkpoint at preparation time selects mailbox #942 and records
`lastSeenCommentId: 6449657435`; the mailbox has since advanced. Read through
comment 6453229023 before acting on this packet. Comment 6453205248 authorizes
preparation only. Comment 6453229023 records PR #970 merged at
`d62004e5a9d3194dd6ca16982d39999246585431`, with exact-head Claude review and
pre-merge CI, but its exact-merge Release Safety, Runtime Smoke, Release
Coordinator, and Pages checks were still pending. It says #966 integration
follows those postchecks and #971 remains preparation. Do not treat the
checkpoint's `liveMainAtCreation` (`f23fc2db…`) or this source packet as current
merge/postcheck evidence; reconcile live main and relevant checks before any
future action. This worktree started from `d309b3559cfcda4580fc2a286977b1033b7ccd06`;
live `main` has moved to the #970 merge, so this packet is not integrated with
current main and has no merge readiness claim. PR #973 is still a draft, based
on `d309b3559cfcda4580fc2a286977b1033b7ccd06`, and GitHub reports it behind.

| Capability | Read-only evidence | Classification for this packet |
|---|---|---|
| Interactive GitHub connector assignment | The issue scope records successful interactive connector assignment. | Reported interactive capability only; not proof of unattended runner credentials, an Actions API, or event-driven continuation. |
| Native issue assignment endpoint | `scripts/native-copilot-task-dispatch.py`, `scripts/native-copilot-task-runtime.py`, and `docs/autonomy/native-assignment-pilot-readiness.md` require a verified user-to-server token (PAT, OAuth, or GitHub App user access token); they explicitly exclude Actions `GITHUB_TOKEN` and App installation tokens. | **Unsupported with the ordinary Actions token.** No credential was inspected, provisioned, or used here. |
| Scoped Copilot request workflows | `copilot-coding-pilot.yml` gates a fixed `workflow_run`, exact source SHA, and owner `triggering_actor`; its generation job declares `copilot-requests: write`. `copilot-ci-event-pilot.yml` is a capped, old-branch, read-only observation pilot with a similar permission. | The permission and narrow source adapters exist; they do not prove this coordinator can dispatch arbitrary Copilot work, nor that an unattended PR assignment succeeds. No live dispatch was attempted. |
| Copilot CLI read-only path | `copilot-readonly-pilot.yml` has a manual, owner/main/one-shot gate and a restricted tool-free CLI call. Its output is explicitly not review or merge approval. | Narrow connectivity/observation only; not source authoring, review, or general event continuation. |
| Claude reviewer | `claude-mailbox-review.yml` accepts an owner-authored `@claude CROSS_MODEL_REQUEST` on issue #942, declares `id-token: write`, requires `CLAUDE_CODE_OAUTH_TOKEN`, and scopes the reviewer to read-only work plus a mailbox receipt. | A scoped reviewer path exists; it is not an unattended coding dispatcher or CI approval mechanism. Its required credential was not inspected. |
| Observed Claude failure | Run `40580614439`, job `122458678108`, ended failed: Claude returned a successful result after 45 turns, exceeding the configured 35-turn maximum. | That invocation is not a successful complete review receipt. Turn-limit/partial output remains incomplete and must retain coverage, never become a green gate. |
| Candidate CI observation | The latest observed Release Safety run at source-only head `a904b50d794c84d32c4559947773ba2008e0764f` (run `40583298725`) was `action_required`; the jobs listing returned zero jobs. `backend-safety.yml` grants workflow-level `contents: read` and `pull-requests: read`. | No successful hosted test evidence. The run predates this documentation/manifest update. Approval/approval-bypass capability is unsupported here; do not infer it from `GITHUB_TOKEN` or the interactive connector. |

These are source and run observations, not proof that a future workflow, token,
external webhook, or GitHub policy will behave the same way. The repository's
native assignment adapter documents an immutable issue/body/run pin and
user-token prerequisite; its tested/offline status is not a successful
unattended dispatch. No credentials or secret values were read.

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

## Pilot proposal

`m11-event-coordinator/pilot-manifest.json` proposes a 24-hour, three-packet
pilot, capped at three concurrent WIP packages, one writer, and one concurrent
draft PR. It is
`enabled: false`; `startUtc` and `endUtc` are `null`; repository, PR, and actor
allowlists are explicit owner-approval placeholders. Network, mutation,
dispatch, review-request, automatic merge/deploy, and approval-bypass adapters
are all false. Costs are existing resources only; no plan upgrade is proposed.
Publisher/research remain paused, and runtime/trading authorization remains
false. Required check workflow IDs are unset placeholders; determine the
applicable exact workflow/check identity before proposing activation.

## Activation checklist — none of these steps is automatic

1. Reconcile live `main`, #942 since the checkpoint cursor, PR #970's four
   exact-merge postchecks, #966's integration gate, and #971's preparation
   state. Re-pin exact repo/PR/head/base and the eventual 24-hour UTC window.
2. Obtain owner decisions for concrete repository, PR, and authenticated-actor
   allowlists, packet count, WIP limit, and one writer. Replace placeholders
   only in a separately reviewed activation package.
3. Demonstrate the exact unattended Copilot operation independently. For the
   native issue-assignment endpoint, the documented credential types are a
   user-to-server PAT, OAuth token, or GitHub App user access token; the
   required secret name/type and minimum endpoint permissions must be approved
   without exposing values. `GITHUB_TOKEN` and App installation tokens are not
   substitutes. The existing `copilot-requests: write` workflow permission is
   scoped to its fixed pilots and is not proof for this operation. If that
   capability cannot be established, leave dispatch blocked and report it.
4. Select and review a durable CAS/lease/fencing service and its narrowly
   scoped credential. No atomic lease is supported by issue comments; no
   service credential or hosted guard currently exists in this packet.
5. If Claude review is retained, independently approve use of the existing
   `CLAUDE_CODE_OAUTH_TOKEN` Actions secret (OAuth token) and mailbox
   `issues: write` receipt permission. Neither authorizes CI approval, merge,
   deployment, or a broader agent task.
6. Require exact-pair successful CI, full independent Claude coverage/verdict,
   and Lead review of this concrete activation package. The Lead remains sole
   merge owner. No activation decision is requested or claimed here.
7. Preserve publisher/research pauses and all canonical execution, PnL,
   Discovery, Validation, Holdout, Paper, and Live boundaries. No automatic
   merge/deploy, approval bypass, workflow/schedule/permission/secret change,
   runtime activation, plan upgrade, or trading authority.

### Permission and credential names/types for a future review

| Purpose | Proposed name/type | Status |
|---|---|---|
| Current evidence reads | `GITHUB_TOKEN`: ephemeral Actions installation token; minimal `contents: read`, `pull-requests: read`, `actions: read`, and `issues: read` | No coordinator workflow exists; exact scope must be reviewed before activation. |
| Create a review request | `pull-requests: write` | Not enabled; use only after exact-pair successful CI. |
| Post a mailbox receipt | `issues: write` | Not enabled by this packet; a comment is not a lock. |
| Copilot request API | `copilot-requests: write` | Present only in existing fixed pilots; this packet has no proven general-purpose dispatch adapter. |
| Native Copilot issue assignment | Proposed name `COPILOT_NATIVE_ASSIGNMENT_USER_TOKEN`; user-to-server PAT, OAuth token, or GitHub App user access token | Not provisioned or verified. Required fine-grained endpoint permissions and provenance remain owner/security-review questions. |
| Claude reviewer | `CLAUDE_CODE_OAUTH_TOKEN`: OAuth token stored as an Actions secret | Existing reviewer workflow prerequisite; not inspected. |
| Existing publisher | `MERIDIAN_PUBLISHER_APP_PRIVATE_KEY`: GitHub App private key | Separate publisher path, paused and not required/authorized for this coordinator. |
| Approve `action_required`, merge, or deploy | No coordinator credential | Unsupported; retain explicit human owner action and existing gates. No `actions: write`, `contents: write`, approval bypass, or merge permission is proposed. |

## Local checks

```sh
node --test test/m11-event-coordinator.test.js
node scripts/autonomy/m11-event-coordinator-replay.mjs
```

Both use generated/local data only. Hosted full CI and the required independent
Claude and Lead implementation reviews remain pending; preparation is not
activation.
