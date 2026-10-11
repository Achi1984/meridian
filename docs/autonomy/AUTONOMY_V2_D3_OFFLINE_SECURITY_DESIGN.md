# D3 offline security design — proposed, not enabled

Operation: `MERIDIAN-D3-OFFLINE-DESIGN-20261009-001`.
Task specification: [#617 / 6076481009](https://github.com/Achi1984/meridian/pull/617#issuecomment-6076481009).
Security input: [Claude #571 / 6076423542](https://github.com/Achi1984/meridian/issues/571#issuecomment-6076423542), verdict `NEEDS_MORE_EVIDENCE`.
Baseline: head `dce9dfbfdcac5d84384bac51301205e2878d48dd`, main/base `8a8a43fc8df4e440294bf7ef5747510b6c6a44d0`.

This is a bounded design and adversarial test plan. No D3 implementation,
storage, adapter, runner, workflow, permission, quota or spending is enabled.
#617 stays Draft with its existing exact-head review boundary. #616 stays a
separate Draft on head `e77a5d222add6c17dad5524612a366d3f57c232e` and base
`bd9bf59bfa83e98c4925c4d898a0111a2f564cde`; its synthetic authority is not imported.
The current lane remains SOURCE_AUDIT. Canonical execution, strategy PnL,
Discovery, Validation, Holdout, Paper and Live remain unauthorized.

## Canonical choice and trust boundary

Choose a new version-2 **queue-owned event ledger**, derived from D1's queue
contract. Only this ledger will own task lifecycle, policy binding, identity
indexes, lease, attempts, budget and evidence. Its materialized task views are
read models. Neither `autonomy-v2-offline-store.mjs` nor
`autonomy-v2-state.mjs` becomes a second operational state authority. Those
modules and #616 remain historical offline labs, with unchanged v1 semantics.
Workflow stages such as CI_CHECK and REVIEW_REQUESTED become projected evidence
statuses, not independent mutable task machines. This design does not silently
upgrade any v1 module or approval string into an operational capability.

The trusted computing boundary contains the queue controller, immutable policy
registry, authenticated observation/evidence readers, trusted clock, durable
candidate journal, independently retained commit authority, and eventual
side-effect gateway. Callers, tasks, artifacts, repository text, snapshots,
provider responses before authentication, and worker strings are untrusted.
Snapshot plus matching locally supplied checksum is not authority. Trust in the
authority itself, clock and authenticated reader must be established separately;
rolling back or compromising that independent authority is outside a local
hash model and must block the pilot rather than be claimed solved.

No caller-provided callbacks, accessors, sparse arrays, arbitrary shell commands,
paths, `verifiedSynthetic`, approval strings, heads or review objects establish
authority. Decode bounded JSON into ordinary data before hashing. Reject unknown
schema versions/keys, non-integer amounts, negative zero, counter overflow,
duplicate IDs, cyclic values and oversized data before mutation. Canonical JSON
and SHA-256 bind bytes; authentication binds the actor. Hostile in-process code
or proxies require a process/capability boundary, not optimistic plain-data checks.

## 1. Immutable policy where state commits

Bootstrap installs a detached immutable policy with `policyId`, version, digest,
authenticated approver identity and approval reference, validity/revocation,
repository ID/full name, allowed branch/PR IDs, exact paths, operation classes,
task and daily budget ceilings and units, reservation estimator version, timeout,
lease TTL, concurrency=1, recovery owner, retention and kill-switch rules.
Every admitted task binds that policy digest and an immutable request digest.
Task limits may reduce policy ceilings; they cannot raise them. Mutating a policy
argument after creation cannot affect the controller. Policy changes require a
new authenticated policy version; existing tasks are not silently rebound.

The queue's transaction validator rechecks repository, target, exact scope,
operations, policy validity, revocation and limits at enqueue, prepare and attempt
authorization. Public adapter prechecks are advisory. Direct calls to queue
write methods use the identical trusted validator and cannot pass their own
authorization context. Policy revocation blocks new attempts; accounting and
reconciliation of an already accepted attempt remain possible without granting
any new effect. Scope uses canonical repository paths and exact files, never
ambient globs. A future filesystem adapter must resolve symlinks with containment
and reject path races; that adapter is outside this work order.

Protected classes include dispatch, workflow/runner/scheduler or autonomy-rule
changes, permissions/secrets, paid service/cost activation, merges, and research
or trading gates. The classifier emits `NEEDS_USER_DECISION` with exact proposed
scope, reason and approval requirements. Queue policy cannot autonomously grant
these classes. Approval is authenticated, exact, expiring and single-use where
required; receipt of a user answer does not waive CI/review or another gate.
This work order authorizes none of those classes. The eventual escalation follows
MERIDIAN_AGENT_WORKFLOW §16.1 through the checkpoint-resolved mailbox; this design
does not post an escalation or alter that routing.

## 2. Head/base observation and evidence

Tasks name an immutable repository ID, PR/ref identity and expected head/base.
The trusted reader independently fetches the actual PR head and base refs plus
live target-branch/main SHA at prepare and again before accepting success at
settle. A PR's stored base is not assumed to equal current main: the pinned tuple
contains both. Prepare rejects `STALE_HEAD` or `STALE_BASE` before reservation,
fence allocation or consuming its operation ID. API failure, unauthorized reader,
missing refs or unproven freshness reject; caller equality is irrelevant.

Reads alone cannot eliminate the race between observation and an external
effect. Any future mutable-ref adapter must additionally enforce provider-side
expected-head/base CAS and the current attempt capability at the effect boundary.
Where the provider cannot enforce the required condition, that task class stays
disabled; no local read is advertised as an atomic remote guard. A proposed
patch lives in an isolated workspace and has no authority to advance a ref.

For the initial design, success requires the original pinned head/base tuple to
remain unchanged. A future authorized ref-writing class needs a separately
approved exact pre-state, intended post-state and operation-bound provider
receipt. Matching an intended head alone is not proof that this attempt wrote it.
This is not permission to auto-rebase a task or reinterpret a changed ref.

After a real effect, a stale or unavailable observation cannot discard the result.
An authenticated provider receipt may be **recorded for reconciliation** while
success remains blocked. Use `RECOVERY_REQUIRED` with `STALE_HEAD`, `STALE_BASE`
or `OBSERVATION_UNAVAILABLE`; preserve the original result/cost receipt, attempt
and reservation. Recording that receipt grants no additional effect. Recovery
must record trusted current refs and a disposition; it cannot make stale work
successful by replacing its expected pair with caller values.

## 3. One authoritative state model

Each task has schema=2, immutable contract/policy digest, task revision, lifecycle,
evidence projection, lease/attempt references and integer budget counters. Queue
state includes store UUID, authority generation, writer epoch, global fence
high-water, trusted time high-water, policy/evidence roots, immutable global ID
index and ledger root. Rejected commands leave all these unchanged; denied
security audit messages live outside the accepted operation ledger.

| Lifecycle | Meaning and permitted progression |
| --- | --- |
| QUEUED | Admitted; no lease. May prepare or become NEEDS_USER_DECISION. |
| PREPARED | Lease + estimate reservation committed; no attempt authorized yet. May record ATTEMPT_INTENT or explicitly recover/interrupt. |
| ATTEMPT_INTENT | Write-ahead intent committed; effect may or may not have occurred. Only receipt recording, settle or recovery; never automatic second send. |
| RECOVERY_REQUIRED | Expired, ambiguous, drifted or blocked attempt; no new effect. Authenticated reconciliation may terminalize or, if no intent/effect is conclusively proven, requeue with a later fence. |
| COMPLETED | Valid result and exact-head evidence accepted; immutable terminal. Completion is not merge permission. |
| FAILED / INTERRUPTED | Explicit terminal disposition with known accounting, including any actual effect; immutable terminal. Unknown outcome cannot use these as a shortcut. |
| NEEDS_USER_DECISION | Protected/unsupported request; cannot acquire an effect capability. An exact approval is a separate command, followed by normal admission checks. |

Transitions append accepted events; projections cannot write around the reducer.
Receipt recording is an append-only attempt substate, not a second lifecycle.
All commits use task-revision CAS and queue-generation CAS. Enqueue is serialized
as an ordinary ledger commit but does not require an empty execution lease.
Enqueue B while A executes is allowed; preparing/authorizing B remains blocked.
Unrelated enqueue may advance global generation: settle retries only the local
transaction after reconciliation, never the provider effect. Terminal revisions,
attempt receipts and replay records remain available after restart and compaction.

## 4. Durable transactional authority and rollback rejection

Proposed commit protocol: an independently retained, authenticated, durable
linearizable CAS authority is the **commit decision**, while a durable immutable
candidate journal holds the complete reconstructible ledger version. A database
alone under the same rollback domain as snapshots cannot provide rollback
rejection. The anchor is not a process WeakMap, fixture HMAC key or caller object.
No specific service is provisioned or approved by this proposal.

The authority pins `(storeUUID, generation, stateDigest, ledgerRoot, replayRoot,
policyRoot, fenceHighWater, writerEpoch, timeHighWater, commitOpId, commitDigest)`.
Generation, epoch, fence and trusted time never decrease. Canonical state binds
all budgets, lease, attempt and evidence fields. Counters use checked arithmetic;
exhaustion blocks without wraparound. Independent writer handles cannot reset
these values. Read/restore requires authenticated exact agreement with authority.

The bounded commit steps are:

1. Read authority/current committed version; authenticate actor and validate
   command, task revision, current policy, observations and budget.
2. Build a complete candidate with predecessor digest and next generation; fsync
   the immutable candidate plus operation receipt to approved durable journal.
   The candidate is not visible committed state and cannot authorize an effect.
3. CAS the independent authority from the exact predecessor tuple to that
   candidate. This is the single linearization point for state, budget, IDs,
   lease/fence and intent. Exactly one racing candidate wins.
4. Materialize the matching committed view and return its receipt. A lost reply
   is recovered by reading the authority and immutable candidate, not resending.

All readers must use the authority-named version, never a newer uncommitted
candidate or an older convenient snapshot. A crash before step 3 leaves the old
version authoritative; staged orphan candidates authorize nothing. A crash after
step 3 requires materialization of the exact candidate before any further effect.
Anchor unavailable => recovery-only local inspection, no write/dispatch. Anchor
ahead of the available journal => restore that exact version from authenticated
durable replicas or block. Missing candidate data cannot be fixed by decreasing
the anchor. A local pointer ahead is ignored unless the authority names it.
On lost CAS acknowledgement, read the exact authority tuple/op receipt once;
do not assume absence and retry a write blindly.

Backing up or rolling back all local journal/snapshot/checkpoint copies still
cannot lower the independent anchor. Loss or rollback of that anchor itself is
a trust failure needing owner recovery, never fresh initialization. Startup on an
existing installation cannot manufacture a new store UUID/authority to bypass it.
Provisioning, durability, authenticated identity, independent failure domains,
availability and crash guarantees require a separately approved implementation
and subprocess/service tests. This document does not prove those guarantees.

Bounded retention is part of the immutable policy, not best-effort cleanup.
Proposed fixture limits: 256 active tasks, 4,096 hot events, 64 KiB per command,
256 KiB per canonical candidate manifest, and 100,000 retained identity records.
These are design/test values, not approved production capacity. Full history may
use immutable archived chunks: the candidate manifest references authenticated
checkpoint, event/receipt chunks and exact replay-index shards through their
roots, rather than copying an unbounded journal into every candidate. The global
exact ID index includes tombstones; probabilistic filters cannot decide absence.

Compaction stages and fsyncs archives, checkpoint and replay shards first, verifies
complete reconstruction and approved durable replicas, then commits the new
manifest/root by the same authority CAS. Only after that commit and verified
backup retention may unreferenced hot copies be pruned. Crash before CAS retains
the old complete version; crash after CAS uses the new exact manifest. No reader
uses an archive unbound to the current authority. Missing/corrupt required chunks
block restore. Exhausting retained-ID/byte capacity blocks new admission pending
an explicitly approved capacity decision; it never forgets an ID. Reserve policy
capacity for already admitted attempts' receipts/recovery before admission, so
normal intake cannot fill all space needed to record their eventual outcomes.

## 5. Intent, external effects, idempotent settle

Before send, an accepted immutable attempt intent records `effectOpId`, task and
descriptor digests, exact policy/approval binding, authenticated actor, writer
epoch/fence, provider/task class, provider idempotency key, pre-ref observation,
intended postcondition, estimate reservation, deadline and result schema.
The authority must name this committed intent before an effect gateway can act.
Issuance of a capability counts as an ambiguous attempt even if no send is known.
Neither volatile `issued`/`attempted` sets nor an attempted-before-settle flag
substitutes for the durable record. Workers do not retain reusable provider
credentials and cannot invoke a provider outside that gateway.

External effects are **not** atomic with state commits. Exactly-once execution is
not claimed. An eventual supported provider must enforce idempotency/reconcile
by the recorded key and, where needed, conditional mutation; otherwise an
ambiguous effect stays blocked for manual investigation. Fences in the ledger
alone do not revoke an already issued remote request. A gateway restart, a
timeout, or a stale lease does not authorize another send.

Authenticated result receipt includes provider operation identity, intent digest,
actual cost/units, result digest and raw receipt digest; worker assertions are
untrusted. Settle records it using the **same effectOpId** and may retry only
the transaction after CAS conflict, lost acknowledgement or materialization
failure. Identical result digest returns the committed receipt; conflicting
result digests block with `OP_PAYLOAD_CONFLICT`. A receipt arriving after expiry
can be stored but cannot use an expired worker's completion capability; the
trusted reconciliation owner must settle/dispose it. Rejected or stale success
does not erase a recorded real outcome or release unknown cost.

Dedup uses a global ID record with immutable root intent/request digest and
phase receipts. `(effectOpId, INTENT)` and `(effectOpId, SETTLE)` are explicitly
different phases of one root operation, not permission to replace its payload.
Each phase has its own immutable digest and accepted receipt. Other command IDs,
task IDs and request IDs share the queue-wide collision index; cross-class reuse
rejects. Canonical semantic payload binds task, policy, descriptor, expected
refs, operation class and target/result. Transport CAS revisions, fetch timestamps
and refreshed observation envelopes are excluded from that immutable payload
and revalidated separately, so a transaction retry can refresh CAS without
changing the effect. Same ID + same semantic digest returns ALREADY_APPLIED or
its pending/recovery status, without new generation, reservation or effect.
Different digest returns OP_PAYLOAD_CONFLICT before mutation. Reads still require
authenticated access; replay returns status, not a fresh effect capability.

## 6. Lease and recovery without intake denial of service

Keep separate `task.expiresAt`, `lease.expiresAt` and
`intent.deadline=min(task.expiresAt,lease.expiresAt,startedAt+task.timeout)`.
Trusted authority time fixes exclusive expiry: authorization requires
`now < intent.deadline`, including task expiry at prepare and lease expiry at
intent/gateway. Receipt intake remains available after all deadlines.
Clock rollback, excessive uncertainty or no trusted time
blocks authorization; caller clocks cannot extend a lease or reset daily limits.
Writer identity, epoch, fence and lease expiry are checked at intent and at the
effect gateway, not only at prepare. Only a newly committed prepare increases
the fence, never a replayed prepare or an import of a lower historical value.

Explicit RECOVERY_MARK uses current task revision/fence and records why the
claim is no longer usable. A PREPARED task with no committed intent/capability
can be proved to have no effect: release unused reservation and interrupt or
requeue under a later fence. ATTEMPT_INTENT or unknown outcome requires trusted
provider reconciliation. Keep its reservation and global execution lock until
the provider confirms absence, or the effect is completed/cancelled and costs
are known. Expiry alone never clears a potentially active writer.

If the provider cannot prove an old request cannot still execute, the queue
cannot safely grant a second effect writer. Continue enqueue and read/reconcile;
block execution and require a concrete owner decision. After conclusive
reconciliation, explicit recovery may close the old task and release the
execution lock. Old tickets, epochs and fences never authorize a new effect or
success after revocation. A restarted session opens under a later authority epoch
and can recover receipts, but cannot reissue the old worker's send capability.

## 7. Budgets: reservation, settlement, release and UTC cap

Use checked nonnegative integer units with a policy-specified meaning. Synthetic
units in tests are not money. Any real conversion/provider pricing and spending
ceiling require explicit approval. Estimate is the trusted policy's hard maximum
for the allowed task class; callers cannot choose an arbitrary small reserve.
No provider without an enforceable cost ceiling may run under a hard cap.

Let `R` be outstanding reserved, `S` confirmed settled consumption, and `L`
cumulative proven-unused released units. Per task and daily UTC bucket:
`R + S <= limit` is the admission/success condition; the reservation ledger's cumulative commitments equal
`R + S + L`. Reserve `r`: R+=r. Actual proven cost `c<=r`: R-=r, S+=c,
L+=r-c atomically. Example reserve 8, actual 3 => R=0,S=3,L=5, not 11.
FAILED and INTERRUPTED have the same accounting rule: actual incurred cost
still counts; only proved-unused remainder is released. Proven no effect costs
zero and releases all 8. Unknown cost/effect retains R=8 until reconciliation.
Duplicates change none of R/S/L. An impossible over-reserve cost is preserved as
a cost incident, disables new dispatch and needs owner resolution; it is not
clamped or accepted as successful budget-compliant completion. Record the true
confirmed cost even if it breaks that admission inequality: reserve8/actual11
becomes R=0,S=11,L=0 with `overrun=3` and explicit COST_INCIDENT recovery status.
The ledger then records commitments plus overrun equal R+S+L. Accounting receipt
intake cannot be rejected merely to preserve a false cap invariant; no further
reservation/success is allowed until a separately approved disposition.

Reserve and daily admission commit together with the queue state. Two concurrent
tasks cannot oversubscribe the shared daily cap. The original reservation bucket
receives settlement/release even after midnight; prior-day reservations never
vanish. A later day has its own cap, but cannot absorb or forgive prior-day
unknown charges. Bound every attempt's total cost across midnight by its original
hard reservation; if a provider bills by wall-clock day, the approved estimator
must conservatively hold coverage in each possible day or reject that task class.
Time high-water prevents backward-date cap resets. Task expiry or policy changes
cannot release unknown reservations or retroactively increase approved limits.

## 8. Authenticated exact-head CI and review

The controller fetches canonical GitHub evidence with a separately approved
read-only identity; caller evidence is never promoted. CI verifies repository,
workflow identity and expected definition, run/check/attempt IDs, completed
success of every required job, head SHA and observed PR/base/main tuple. GitHub
head-only status is not proof of a base: capture its event metadata and workflow
checkout semantics, or require a separately verified test attestation binding the
exact base. Missing base binding or skipped required coverage is
NEEDS_MORE_EVIDENCE. Synthetic testCount/green strings are insufficient.

Review verifies canonical mailbox issue, authenticated review workflow/actor
identity, exact request ID, head/base, verdict and response ID/body digest.
Text claiming `reviewer: CLAUDE` or a copied GREEN_LIGHT is not authenticated
authorship. Use actual platform author and provenance of the trusted reviewer
workflow; any additional signature/attestation needs an approved implementation.
Head/base/policy changes invalidate success eligibility, never rewrite old
evidence. COMPLETE does not grant merge authority, and historical descendant
green results do not approve their ancestors.

Persist dedup receipts for `(requestId, exactHead)` and read the canonical mailbox
before any permitted request. Already running or answered => no repost. A crash
after comment creation requires reconcile of operation marker/comment ID, not a
second request. Current #617 R1 and #616 R1 are already answered with
NEEDS_MORE_EVIDENCE; this work creates neither a duplicate nor a new review.

## 9. Migration, compatibility and rollback

No migration executes in this block. Future migration must be separately approved
and deterministic from pinned v1 inputs, with pre/post digests and authority CAS.
Legacy task/request/op IDs and fence maxima are retained as immutable tombstones.
Imported approval/review/head contexts are synthetic-unverified and never grant
execution. Duplicate ownership, ambiguous identity or incompatible ledger models
reject the import; the three legacy models are not merged by guessing precedence.

QUEUED legacy work needs fresh schema-2 policy/identity/ref approval before
admission. PREPARED/CLAIMED imports enter RECOVERY_REQUIRED without any new send
capability. Terminal imports remain historical with no new work authority.
Legacy `budgetUsed` remains historical lab accounting, not confirmed monetary
cost or refundable reservation. Imported task IDs cannot be reused: any newly
approved task has a new identity linked to the historical one. Preserve all
accepted IDs through compaction with an authenticated replay root; expiry is not
permission to forget an operation. Unknown/missing retained history blocks.

Rollback first disables new attempt authorizations, fences new sessions and
reconciles outstanding attempts. It may revert code only to a version capable of
reading the latest schema/authority or keep the system disabled. Never restore an
older snapshot, reset UUID/anchor, lower generation/fence/clock, erase WAL/replay
history or release unknown costs. There is no autonomous downgrade to v1. Durable
backups recover the exact authority-named version; missing evidence is an owner
recovery incident. Kill switch blocks new effects while preserving receipt intake
and reconciliation; it does not guarantee cancellation of in-flight remote work.

## Failure matrix and deterministic acceptance

The companion [test plan](AUTONOMY_V2_D3_ADVERSARIAL_TEST_PLAN.md) defines explicit
fixture values, crash cuts, racing schedules and per-case assertions. Its test
IDs are acceptance requirements, not tests already passing against D3.

| Failure | Required result | Test IDs |
| --- | --- | --- |
| Caller overrides policy/scope/repo/operation/limit | Reject before accepted state/ID change | D3-01..04 |
| Independent ref drift or unavailable read | Prepare denied; post-effect receipt retained, success blocked | D3-05..08 |
| Crash around candidate/anchor/materialization | Only authority-named candidate committed; no blind resend | D3-09..12 |
| Coherent rollback, fresh UUID, authority loss | Restore/dispatch blocked; no fence reuse | D3-13..15 |
| Concurrent authority commits | One accepted candidate, losing IDs/budget unchanged | D3-16 |
| Effect applied, acknowledgement/settle lost | Same intent reconciled; one effect, one settlement | D3-17..19 |
| Same operation or conflicting payload | Recorded same-digest result or immutable conflict | D3-20..23 |
| Lease expiry, stale writer, uncertain provider | Explicit recovery; enqueue allowed, second effect blocked | D3-24..28 |
| Failure/interrupt/unknown cost/day boundary | Correct R/S/L and daily cap; no implicit refund | D3-29..34 |
| Forged/skipped/stale CI/review | No success eligibility or review repost | D3-35..38 |
| Protected operation/migration/compaction/rollback | NEEDS_USER_DECISION or fail closed; retained replay authority | D3-39..42 |

## Scoped PR sequence and approval gates

1. **D3-A: this design/test-plan/evidence packet only.** Publish an isolated
   documentation-only Draft on reconciled main; retain pinned #617 as the design
   and test input, without importing its runtime changes or amending #617/#616.
   Reconcile then-live head/base before publication, keep one op ID and
   single writer, check transport payload/blob budgets and CAS. Ordinary CI and
   review remain separate from design acceptance. No new Claude request here.
2. **D3-B: offline pure queue policy/state/budget/replay model.** New schema and
   fixtures only, after explicit scope approval for implementation; no real
   persistence, provider or dispatch. Run D1/D2 regressions plus model cases and
   independent adversarial review on its exact head/base.
3. **D3-C: durable storage/authority implementation.** Before coding any real
   storage, obtain a concrete owner decision covering service/provider, independent
   rollback domain, identity, durability, retention, data handling, costs, recovery
   and kill switch. Implement in another scoped Draft after approval; run all
   applicable cases with subprocess kill/restart and concurrent processes, not
   just retained-memory fixtures. #616 review is not authorization for this step.
4. **D3-D: authenticated readers/gateway/provider adapter.** Separate approval
   before any real adapter, credential/permission/workflow/runner change,
   dispatch or spending. Name task class, repo/ref/scope, provider idempotency/CAS,
   minimal identities/permissions, hard cost limits, TTL, concurrency, cancellation,
   reconciliation owner and rollout/rollback. Fresh exact-head CI and independent
   Claude review are additional gates, not substitutes for the owner decision.
5. **Pilot/production or merge:** separately authorize any actual external work;
   STREAM-SAFE-V7 applies to each guarded remote mutation, with reconcile then
   one atomic action and stop. No automatic workflow activation, spending, merge,
   D4 promotion or research-stage advancement follows from any preceding Draft.

No owner decision is needed to finish this offline design. The real storage,
identity/provider choice and pilot approvals remain documented future blockers.
Actual local test results and source verification are recorded separately in
[D3_OFFLINE_TEST_EVIDENCE.md](D3_OFFLINE_TEST_EVIDENCE.md).
