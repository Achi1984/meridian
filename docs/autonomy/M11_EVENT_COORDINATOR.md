# M11 event coordinator — preparation only

Status: `PREPARATION_ONLY`. The 24-hour/three-packet manifest remains disabled
with start/end unset. The owner authorized source preparation, not activation.
This packet installs no workflow, schedule, transport, mutation adapter,
credential, or continuous runtime. It does not create another UI/cache writer.

## Current evidence and capability matrix

Reconciliation snapshot: current `main` is
`830c9346aae22023c739a89bdc46943a2d5d088d` (2026-10-29). The coordinator
branch includes that merge. Its diff remains within the isolated coordinator
packet; `scripts/research-supervisor/test_supervisor.py` matches main byte for
byte. The earlier coordinator CI run `40632733971` is for the former
`eacb230…` / `d62004e…` pair and is stale. On main merge SHA `a40b714…`,
Release Coordinator `40823600127`, Runtime Smoke `40823600130`, and Pages
`40823599573` succeeded; Release Safety `40823600133` completed with failure
(attempt 1, job `123281454123`; Research and auth regression tests: 2,876 pass,
1 fail, 0 skipped). The available job-log response did not include the failed
test name or assertion, so neither is inferred here. This is not a complete
four-check postcheck set. No retry was requested. No full CI has been run on the
current #973 head/base pair, and no independent Claude acceptance of that exact
pair is claimed.
Main advanced to `830c9346aae22023c739a89bdc46943a2d5d088d`; its postchecks have
not been queried for this exact SHA. The previously recorded Release Safety
failure on `a40b714…` remains separate historical evidence. Issue #989 remains
open: the merged #1000 change added bounded diagnostics but did not establish
or fix the historical timing root cause.

The following are source observations and dated run receipts, not proof that a
new workflow or credential works:

| Capability | Current evidence | What it establishes / does not establish |
|---|---|---|
| Interactive Copilot assignment | Prior task delivery in #997 was explicitly requested by an owner and completed its R2 focused suite (33/33, receipt `6488608926`). | Human-started assignment/delivery can work. It does not prove a reusable unattended Actions dispatch or automatic resume. |
| Native issue assignment | `scripts/native-copilot-task-dispatch.py` and `scripts/native-copilot-task-runtime.py` implement a bounded, inert assignment adapter. It requires an externally verified PAT, OAuth token, or GitHub App user-to-server token; it excludes Actions `GITHUB_TOKEN` and App installation tokens. | The adapter is source, not a deployed workflow or successful unattended dispatch. No credential was inspected, provisioned, or used. |
| Existing Copilot request workflow | `.github/workflows/copilot-coding-pilot.yml` accepts a fixed historical source SHA (`99eff911…`), successful Release Safety, attempt cap, and owner `triggering_actor`; only its generation job has `copilot-requests: write`. Publishing has separate contents-write and publisher-App scope. | A one-packet, immutable pilot, not general current-PR dispatch. Its scoped permission does not prove this coordinator can call the Copilot API. |
| Existing CI event pilot | `.github/workflows/copilot-ci-event-pilot.yml` is pinned to the old `feat/v11-version-history-20261010` branch, October 10 deadline, three-run cap, and read-only event summary; it also declares `copilot-requests: write`. | Expired, branch-specific observation experiment. It is not a current coordinator listener or general author/continuation path. |
| Claude reviewer trigger | `.github/workflows/claude-mailbox-review.yml` only accepts issue #942 comments by `Achi1984` containing `@claude` and `CROSS_MODEL_REQUEST`. It declares `contents: read`, `issues: write`, `pull-requests: read`, `actions: read`, and `id-token: write`; Claude is read-only, with `Edit,Write` disallowed and 35 turns. | An owner-authored mailbox request can launch a bounded independent review. A bot comment, arbitrary issue text, or coordinator event cannot pass this gate. This does not approve CI or request PR review automatically. |
| Exact-pair hosted CI and independent review observation | Release Safety run `40821781547`, attempt 2, job `123277027311`, passed 2,877/2,877 on PR #1000 head `a013a202…` / base `34eb7df…`; independent Claude returned `GREEN_LIGHT` for that exact diagnostic-only diff in #942 receipt `6488670460`. #1000 was subsequently merged as `a40b714…`. | Evidence for that separate test-diagnostic packet only; it is not review or full CI for #973. The exact-merge Release Safety run on main `40823600133` completed with 2,876 pass / 1 fail; the failed test identity is unavailable from the returned log tail. |
| CI permissions / approval | `.github/workflows/backend-safety.yml` declares only `contents: read` and `pull-requests: read`; no workflow-write or approval capability is declared. | `action_required` cannot be approved by this packet. The interactive connector and `GITHUB_TOKEN` are not evidence of an unattended approval path. |
| Merge and postchecks | No coordinator merge adapter exists. Source models exact-merge postchecks; new CI collector source has no authenticated GitHub client or live postcheck path. | Source merge remains Lead-owned; automatic merge/deploy, approval bypass, and automatic post-merge continuation are unsupported. |

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

## Disabled coordinator source and handoff design

The newly implemented modules are offline/injected-IO source only:

* `scripts/autonomy/m11-coordinator-collector.mjs` accepts a minimal
  `workflow_run` hint, then requires an injected adapter to identify itself as
  authenticated and re-fetch the workflow run, PR, exact-pair diff, current run
  selection, and every jobs/runs page. It binds the exact
  repo/PR/head/base/workflow/run/attempt and both actors; forks, stale or
  ambiguous selection, missing pages, `action_required`, incomplete jobs/diffs,
  and expired/over-budget input fail closed. Diff bytes are explicitly passed as
  untrusted reviewer input and never executed. The `authenticated` property is
  an adapter contract, not GitHub provenance; no GitHub API adapter is included.
* `scripts/autonomy/m11-coordinator-state-store.mjs` defines a backend contract
  for immutable commits, atomic create-only claims, atomic packet quota,
  expected-old-OID + expected-revision CAS, and durable fencing. Missing
  capability declarations disable the store. Declarations and deterministic
  in-memory tests do not prove a hosted backend; there is no GitHub-ref or
  shared-SQLite implementation. Ref fast-forward behavior is not treated as
  expected-old-OID CAS.
* `scripts/autonomy/m11-coordinator-review.mjs` accepts only a collector result
  branded in the same process, claims the exact CI action before review, passes
  only bounded pair/CI/coverage input to an injected reviewer, persists a
  structured complete/incomplete verdict, then makes one injected receipt
  attempt. `AbortSignal` and runtime/window budgets are passed to adapters;
  timeout/transport errors are `UNKNOWN`, never a retry. The explicit
  `reconcileUnknownReceipt` path performs read-only state/receipt lookup and
  never retries, even when no receipt is found.
* `test/m11-coordinator-pilot.test.js` supplies synthetic API/store/reviewer/
  receipt adapters only. It tests local expected-OID/fence/quota behavior and
  restart/unknown handling; these test doubles cannot establish GitHub
  atomicity, exactly-once comments, authentication, or reviewer availability.
* `docs/autonomy/m11-event-coordinator/m11-ci-review-workflow.yml.disabled` is
  an inert template outside `.github/workflows`. It separates read-only
  collection, state-write, reviewer, and receipt jobs and gates every job on an
  unset opt-in plus manifest, allowlist, expiry, 24-hour, and three-packet
  checks. Its steps are placeholders, not runnable adapters.

The manifest remains disabled with unset dates and owner-approval allowlist
placeholders. No source path performs a live GitHub or model operation by
default; there is no automatic merge, approval, native author dispatch, deploy,
or Lead/ChatGPT wake-up.

The desired progression is one bounded event-driven state machine:

| Transition | Required authoritative evidence | Proposed next action | Present status |
|---|---|---|---|
| Admit packet → author | Owner-approved repo/PR/head/base and an authenticated, current event; external WIP count below three; one writer lease. | Dispatch one fixed task with an idempotency key for repo/PR/head/base/phase. | No generic authenticated event collector or general Copilot dispatcher is installed. |
| Author → CI | Re-read PR head/base and author delivery; select current Release Safety workflow/run/attempt from Actions API, not event payload alone. | Wait while pending; on failure/action-required produce one consolidated exception/correction receipt; do not retry an unchanged request. | Existing Release Safety runs provide CI, but no current coordinator subscribes or persists their state. The workflow token declares only `contents: read` and `pull-requests: read`. |
| CI success → independent review | Full success on exact PR/head/base, complete diff, and current workflow selection. | Request a complete independent review bound to the exact CI run/attempt/workflow and diff digest. | Offline collector/review source models this transition; no authenticated API or reviewer adapter is installed. Current Claude workflow only starts from an owner-authored #942 comment. |
| Review → correction or Lead merge | All required coverage parts and complete verdict tied to the exact successful CI pair; truncated/turn-limited/partial responses remain incomplete. | `REVISION_REQUIRED`: one consolidated correction dispatch, then return to exact-pair CI. `GREEN_LIGHT`: Lead may perform an already-authorized routine merge; coordinator never merges. | No automatic PR review request or Lead/ChatGPT wake-up path exists. No workflow receives merge authority. |
| Merge → four postchecks | Authoritatively observed merge SHA plus current run selection and pinned workflow identity for every applicable check. | `COMPLETE` only when all four checks succeed on that SHA; otherwise one deduplicated exception and wait/reconcile. | Reducer source models this gate; no authenticated post-merge collector persists or advances it. The manifest IDs are placeholders. |

### Event authentication, durable state, and unknown outcomes

The implemented normalizer treats workflow payloads as hints, but its future
production API adapter must fetch repository, PR, head/base, workflow identity,
run attempt, conclusion, actor and `triggering_actor`, exact PR diff, and
complete job pagination from authenticated GitHub APIs. A separate collector
must later implement post-merge SHA/check reads. It must reject forks, wrong repositories,
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

### Ranked implementation options and exact file-level boundary

The smallest useful automation does **not** dispatch an author. Keep the
existing interactive/owner-authorized author delivery as the start of the
packet; automate only completed exact-pair CI → independent review → one
consolidated receipt. This still removes a repeated owner “Go” for that segment
without claiming unattended development or requiring native assignment
credentials.

| Rank | Later pilot | Access and coverage | Decision |
|---|---|---|---|
| 1 — recommended | A bounded Release Safety `workflow_run` listener invokes the existing read-only Claude review resource only after authoritative exact-pair CI success, then persists one consolidated receipt. | Actions reads + a durable CAS write + issue receipt write + the already configured Claude OAuth secret. No native Copilot assignment, `copilot-requests: write`, approval, merge, or deploy permission. | The disabled injected-IO implementation is now present. It still requires separately reviewed authenticated read, hosted CAS, reviewer, and receipt adapters plus workflow/permission approval; none is installed or proven. |
| 2 — least access | Read-only `workflow_run` observer reports allowlisted CI state, with no review invocation and no persistent receipt. | `actions: read`, `pull-requests: read`, `contents: read`; no writes or secret. | Safe observation only; does not launch review or durably resume a phase, so it does not remove the owner/Lead handoff. |
| 3 — defer | Native unattended author assignment before CI. | Existing dispatcher requires an externally verified user-to-server PAT/OAuth/GitHub App user token plus a one-shot fence. | Not a prerequisite for option 1, not proven operationally, and excluded from the minimal pilot. Keep `agentDispatch: false`. |

#### Implemented source and future wiring boundary

1. **`docs/autonomy/m11-event-coordinator/m11-ci-review-workflow.yml.disabled` —
   inert template only.** It describes a completed `workflow_run` allowlist for
   `MERIDIAN Release Safety` / workflow `347821227`; jobs require the unset
   `M11_COORDINATOR_ENABLED` opt-in, exact repository/workflow/conclusion, a
   `PREPARATION_ONLY`-blocking manifest gate, trusted `main` checkout, and
   bounded 24-hour/three-packet/one-writer allowlists. It separates read-only
   collector, candidate state-write, read-only reviewer, and receipt jobs.
   Candidate permissions remain `actions: read`, `contents: read`,
   `pull-requests: read`; `contents: write` only for isolated state,
   `issues: write` only for receipt, and reviewer credentials only in the
   reviewer job after separate approval. The template does not pass the state
   writer token to the model job. No live action, credential, or secret is wired.
2. **`scripts/autonomy/m11-coordinator-collector.mjs` — implemented normalizer,
   no API adapter.** Input: four-field workflow event hint and injected
   authenticated-read adapter. It re-fetches workflow/PR identity, the exact
   diff, latest run selection, actors, and fully paginated jobs/runs. It rejects
   incomplete or stale results and returns a same-process branded envelope
   binding repo/PR/head/base, workflow/run/attempt, selection revision, diff
   digest, and idempotency key. The source diff is bounded and marked untrusted;
   arbitrary event/issue body text is not part of the schema.
3. **`scripts/autonomy/m11-coordinator-state-store.mjs` — implemented contract
   adapter, no production backend.** Interface includes read, fenced lease/
   claim, immutable commit against an explicit expected-old OID and revision,
   read-only reconciliation, atomic release, and a durable three-packet quota.
   The backend must enforce CAS atomically; a create-only claim or ordinary
   fast-forward is not equivalent. A future GitHub ref backend requires
   isolated concurrency/crash/restart tests proving its exact semantics before
   activation. If that cannot be established, use a separately reviewed shared
   durable CAS service; never fall back to runner-local SQLite or artifacts.
4. **`scripts/autonomy/m11-coordinator-review.mjs` — implemented injected
   orchestration, no reviewer/receipt adapter.** It may invoke the reviewer only
   after the durable create-only action claim succeeds. Reviewer input is the exact,
   explicitly untrusted PR diff and pinned CI receipt, with the required coverage
   parts and explicit read-only boundary. Output is a bounded structured verdict
   plus covered parts, exact run/head/base, and completion/truncation/turn-limit
   flags. Only full coverage and a complete verdict may record `GREEN_LIGHT` or
   `REVISION_REQUIRED`; partial output remains `NEEDS_MORE_EVIDENCE`. Make at
   most one #942 receipt call keyed by `actionKey`. If delivery is ambiguous,
   the explicit lookup can reconcile it, but no retry is offered even when
   lookup says not found; remote exactly-once behavior is not established.
5. **`test/m11-coordinator-pilot.test.js` — deterministic source acceptance.**
   Covers forged/stale hints, actors/repo/workflow mismatch, forks, incomplete
   pagination/current-run changes, one concurrent claim winner, stale fence
   rejection, restart reconstruction, three-packet budget, crash before/after
   side effect, UNKNOWN reconciliation without retry, exact review coverage,
   partial/truncated/turn-limited output, expiry/runtime limits, default-disabled
   behavior, and the inert workflow contract. Remote delivery exactly-once is
   deliberately not asserted.

#### Dedupe, failure handling, rollout, and authority

The collector's `actionKey` binds repo/PR/head/base, workflow/run/attempt, run
selection, and diff digest; the separate `packetKey` binds repo/PR/head/base for
the durable three-packet quota. A duplicate unchanged event is a no-op. Persist
the full adapter-provided selection revision and lease epoch. Every remote
operation follows `claim → perform once → read back authoritative result →
commit`; timeout or lost acknowledgment becomes `UNKNOWN`, followed by
read-only reconciliation. It never results in a blind re-dispatch. A crash
after a claim but before invocation is stranded and requires reconciliation or
an explicitly approved new action key; it cannot silently replay.

Rollout remains `enabled: false`, dates unset, three packets maximum, one writer,
one draft PR. Before any separately approved pilot: stage the proposed workflow
with a dry-run observer (no model call/write), verify workflow IDs, exact-main
postchecks, ref CAS race/crash/restart acceptance tests and rollback. Initial
activation unavoidably requires an owner to approve the exact workflow diff,
the `contents: write`/`issues: write` scopes, reuse of the existing Claude
OAuth secret for the event path, allowlist, and bounded start/end. No extra
owner “Go” is required for a routine merge already within standing Lead
authority. Rollback
means disable the new workflow trigger, retain claim/state refs and receipts for
audit, and stop new work; do not delete claims or retry ambiguous operations.
The eventual reviewer stage adds Claude invocation and one mailbox receipt only
after independent exact-pair source review and security/owner approval. No
current workflow, permission, secret, schedule, spending, or runtime changes are
authorized by this design.

**Actual human boundary:** author delivery remains interactive in this minimal
pilot; native assignment is separate and unsupported. A completed
`action_required` run still needs the owner to resolve GitHub's gate. After a
full independent `GREEN_LIGHT`, routine eligible merge remains the standing
Lead responsibility and does not require another owner “Go”; the coordinator
gets no merge credential and cannot wake the Lead session by itself. The owner
is contacted only for a strategic decision, a genuinely new permission/
credential/cost/runtime request, or an unresolved blocker. `REVISION_REQUIRED`
is one consolidated correction receipt; until author dispatch is separately
enabled, Lead/owner must explicitly route that correction through the existing
interactive author path. Publish progress/one deduplicated exception to #942
only through the later reviewed receipt path.

#### Minimum future permission inventory (not enabled)

| Job/path | Minimum candidate | Why |
|---|---|---|
| Collector | `GITHUB_TOKEN`: `actions: read`, `contents: read`, `pull-requests: read` | Re-fetch authoritative run/workflow, trusted collector files, and PR state. |
| CAS state write | Same job token with `contents: write`, restricted in code to the dedicated coordinator refs | GitHub-ref append-only CAS and create-only operation claim. This repo-scoped permission must receive security review; it is not present in the current workflow. If too broad, use an owner-approved isolated state service rather than claim comments/artifacts. |
| Reviewer invocation | Existing `CLAUDE_CODE_OAUTH_TOKEN` secret and `id-token: write` only if required by the pinned Claude action | Reuse existing reviewer resource; approval to expose it to this event-triggered workflow is a remaining owner/security decision. No secret values were read. |
| Consolidated receipt | `issues: write` on the reviewer/receipt job | Post one keyed mailbox receipt; comments remain notifications, not the CAS store. |
| Native author assignment (deferred) | User-to-server PAT/OAuth/GitHub App user token | Required only for native assignment; not needed for CI-to-review. |
| CI approval, merge, deploy | None | Retain human owner / Lead gates; do not add `actions: write`, contents-to-main, merge, or approval-bypass authority. |

No new workflow, permission, credential, secret, spending, runtime, automatic
merge/deploy, approval bypass, or activation is authorized here. The
manifest's 24-hour/three-packet proposal remains disabled and unset until the
concrete implementation, exact permissions, current evidence, and test plan
receive independent source review and owner/security approval.

## Local checks

```sh
node --test test/m11-event-coordinator.test.js
node --test test/m11-coordinator-pilot.test.js
node scripts/autonomy/m11-event-coordinator-replay.mjs
```

These use generated/local data only. Hosted full CI and the required independent
Claude and Lead implementation reviews remain pending; preparation is not
activation.
