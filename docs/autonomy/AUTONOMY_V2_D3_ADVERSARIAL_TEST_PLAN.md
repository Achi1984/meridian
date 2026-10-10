# D3 deterministic adversarial acceptance plan

Operation: `MERIDIAN-D3-OFFLINE-DESIGN-20261009-001`.
Companion: [security design](AUTONOMY_V2_D3_OFFLINE_SECURITY_DESIGN.md).

**Status: specified, not implemented or executed as D3 tests.** No persistent D3
implementation or real provider is authorized. The executed v1 baseline results
are in [D3_OFFLINE_TEST_EVIDENCE.md](D3_OFFLINE_TEST_EVIDENCE.md). Passing those
baseline tests does not satisfy any persistent D3 gate below.

## Fixture, API contract and invariant oracle

Use a reset fixture per case, no live credentials/network/jobs. Deterministic
clock `T=1_000_000` ms, lease TTL=100, task timeout=200; expiry equality is denied.
Task expiry=T+200, lease expiry=T+100, intent deadline=min(task expiry, lease
expiry, startedAt+timeout). Add task-expiry-first and timeout-first variants.
Day D=`2026-10-09`, midnight=`2026-10-10T00:00:00Z`; day tests explicitly set the
trusted clock, not a caller timestamp. Head H=`'a'.repeat(40)`, base B=
`'b'.repeat(40)`, changed head H2=`'c'.repeat(40)`, changed base B2=`'d'.repeat(40)`.
Both PR-base and main observations initially equal B. Registry P1 allows exact
repo `Achi1984/meridian`, branch `offline-fixture`, paths `scripts/example.mjs`
and `test/example.test.js`, operations READ_SCOPE/PREPARE_PATCH/SIMULATE_TESTS,
task limit=10, daily limit=12 synthetic integer units, timeout<=200,
concurrency=1. This is fixture policy, never real authorization.

Task A uses distinct IDs `task-A`, `request-A`, `enqueue-A`; task B uses the B
suffix. Authority UUID=`fixture-store-1`, initial generation=0, epoch=1,
fenceHighWater=0. A accepted prepare has effect ID `effect-A`, reserve=8 and
fence=1; actual receipt cost=3. A second minimal task may reserve 5. Actors are
fixture identities `fixture-lead`, `fixture-recovery` and `fixture-owner` with
disjoint capabilities; `untrusted-worker` has none. Observer data comes through
a trusted fixture reader inaccessible to command payloads. Fake provider is a
deterministic ID-keyed receipt registry/effect counter, not a command callback.

Proposed harness interface (not exported by current v1 modules):

```text
admit(task, actor, commandId, expectedTaskRevision?)
prepare(taskId, actor, commandId, expectedTaskRevision, reserveEstimateVersion)
recordIntent(taskId, actor, effectOpId, descriptor, expectedTaskRevision, fence)
deliverOnce(committedAttemptCapability)                # fixture provider only
recordReceipt(effectOpId, authenticatedProviderReceipt)
settle(effectOpId, actor, result, expectedTaskRevision) # transaction retry only
markRecovery(taskId, actor, commandId, revision, fence)
reconcile(taskId, recoveryActor, commandId, providerEvidence, revision, fence)
readAcceptedOperation(id, actor)
restartController(), killProcessAt(namedBoundary), authority.read()
```

`prepare` has no caller policy/head/base authority arguments. Admission must also
be tested through the raw write-capable queue surface, not only an adapter. The
trusted reader may be varied by the harness only. `reserveEstimateVersion`
selects the installed estimator; it cannot choose reserve=0/1 for an 8-unit task.

Every case captures before/after `(generation,taskRevision,stateDigest,ledgerRoot,
replayRoot,UUID,epoch,fenceHighWater,timeHighWater,lease,attempts,R,S,L,dailyBuckets,
acceptedIDs,receipts,auditReason,effectCount)`. For a pre-intent denial, all accepted
state/ID/budget/fence fields are equal to before and effectCount=0. An append-only
denial audit may differ outside accepted state. An identical accepted replay
does not advance generation or task revision, charge or deliver again. A
post-effect denial retains intent/result evidence and accounting; it does not
assert the entire state is unchanged. Costs and outcome changes are asserted
explicitly. Assert oracle values, not only `ok=false`.

## Policy and independent observations

| ID | Concrete sequence | Expected oracle |
| --- | --- | --- |
| D3-01 | Raw `admit(A)` with repository `other/repo`, target `main`, or path `scripts/unapproved.mjs`, one mutation per reset; supply matching caller policy claims. | Reject each; unchanged accepted IDs/state; effectCount=0. Valid A with the same denied IDs can subsequently admit. |
| D3-02 | Raw `admit` asks GITHUB_PUSH/CLOUD_DISPATCH/WORKFLOW_EDIT; raw prepare attempts to authorize them with a forged caller context. | Protected operation => NEEDS_USER_DECISION; unsupported nonprotected => policy rejection. No reservation, fence or effect capability. |
| D3-03 | Ask task limit=11 or timeout=201, reserve=1 for trusted estimate=8; mutate P1 input after controller creation; substitute P2/different digest. | Ceiling/estimator/policy mismatch rejected; installed detached P1 unchanged. Existing task cannot be silently rebound. |
| D3-04 | Admit A; revoke P1; raw prepare/intent with prior approval strings. Separately settle an already committed effect-A after revocation. | New effect denied; recovery receipt/accounting remains possible with recovery actor, grants no new effect. |
| D3-05 | Admit A at H/B; observer becomes H2/B before prepare; caller continues to send H/B. Repeat with H/B2 and with only live main=B2. | STALE_HEAD / STALE_BASE before reserve/fence/ID use; fixing observer permits same prepare ID. |
| D3-06 | Reader timeout, unauthorized reader actor, missing PR/ref or observation outside freshness limit at prepare. Then supply caller `observedHead=H`. | OBSERVATION_UNAVAILABLE/INVALID_EVIDENCE; no fallback to caller; state unchanged. |
| D3-07 | Prepare and intent at H/B; move refs to H2/B before fake gateway deliver. Repeat change B2. | Conditional effect rejected; no provider effect. Explicit recovery proves absence before release. Local earlier observation alone cannot authorize. |
| D3-08 | Effect applied once/cost3 at H/B; before settle reader sees H2 or B2 or fails. Store trusted receipt, attempt ordinary success, then recovery. | Success blocked with specific drift/unavailable reason; RECOVERY_REQUIRED, intent + result digest preserved; reservation held until trusted cost disposition, then S=3,L=5,R=0, no second effect. Recovery cannot relabel stale success by replacing expected SHA. |

## Transaction and crash matrix

Name boundaries precisely: C0 before candidate write; C1 after journal fsync,
before authority CAS; C2 after authority commit, before materialization; C3 after
materialization, before acknowledgement. Run the cuts separately for admission,
prepare, intent, receipt recording, settle and recovery, not just enqueue. The
authority and journal are separate retained fixtures for the model. Persistent
acceptance later repeats each applicable cut with killed/restarted subprocesses
and separately retained storage/authority, including fsync failure injection.

| ID | Concrete sequence | Expected oracle |
| --- | --- | --- |
| D3-09 | Crash at C0 and C1 for each command; restart/read anchor. | Predecessor remains committed. C1 orphan candidate authorizes no effect/ID/budget. Reconcile proves absence before an identical guarded transaction retry. |
| D3-10 | Crash at C2 for each command; retain authority/journal; restart before new dispatch. | Load exact authority-named candidate; committed operation applied once. Intent candidate can never be inferred absent. Materialization does not advance anchor/fence again. |
| D3-11 | Crash at C3; lose accepted response; submit identical operation/phase. | ALREADY_APPLIED with same stored receipt/status; generation,R/S/L,fence and effect count unchanged. |
| D3-12 | CAS acknowledgement lost; independently inspect authority: (a) candidate won, (b) predecessor unchanged, (c) competing candidate won. Also fail fsync before CAS. | (a) materialize only; (b) retry one transaction only after absence; (c) STALE_CHECKPOINT/conflict and refresh without send. Failed fsync cannot advance authority. |
| D3-13 | Commit fence1/intention then settle; save coherent old snapshot + local pointer before those events; kill controller; replace all local copies with old valid data; retain independent authority. | Rollback rejected; latest version restored only from exact authenticated backup or BLOCKED; fence1 never reissued. Repeat with anchor pointing to a missing candidate: no initialization fallback. |
| D3-14 | Restart with fresh authority/UUID or lower generation/epoch/fence/time/replayRoot while claiming existing installation. | Store/authority mismatch rejected; no fresh zero authority, refunded budget or forgotten ID. |
| D3-15 | Authority unavailable; corrupted candidate digest; truncated journal/replay index; local uncommitted pointer ahead. | No dispatch/write from untrusted state. Exact anchor-named view only; orphan ahead pointer ignored; missing/corrupt required version blocked. |
| D3-16 | Controllers X/Y read generation g. Both stage candidates; barrier X CAS then Y CAS; reverse order in second reset. Repeat two prepare reservations competing for remaining daily cap. | Exactly one accepted CAS at g; losing task/ID/reservation not applied. No duplicate fence. Persistent version: two OS processes against same approved authority, not two closure objects. |

## Attempt, effect, replay and settle

Additional cuts E0 after committed intent before send, E1 after provider applies
before ack, E2 after authenticated receipt is available before settle, E3 after
settle authority commit before reply. Never invoke a real provider in this plan.

| ID | Concrete sequence | Expected oracle |
| --- | --- | --- |
| D3-17 | E0 crash/restart. Without provider absence proof try automatic resend/new effect ID/interrupt. Then authenticated reconciliation proves no execution and revokes outstanding capability. | Initial outcome ambiguous, R=8, execution lock retained; no resend. After conclusive absence: R=0,S=0,L=8; explicit interrupt or requeue, old capability cannot later deliver. |
| D3-18 | Fake provider applies effect-A once at E1, reply lost. Restart and lookup by recorded provider key; retry settle with same effectOpId/result digest. | Receipt records original result once; effectCount=1; R=0,S=3,L=5; no execute call during settlement. Unknown provider lookup stays RECOVERY_REQUIRED with R=8. |
| D3-19 | E2/E3 crash; additionally enqueue B between receipt and settlement to move global generation. Retry local transaction with refreshed CAS only. | Same result settles once after reconciliation; effectCount=1. No volatile attempted-set poison. Unrelated intake doesn't require re-execution. |
| D3-20 | Replay identical admission/prepare/intent/settle after lost replies and restart. Include replay after task expiry, policy revocation and current refs moving. | Read original accepted receipt/pending state without reauthorizing effect. Prepare replay does not return a new dispatch capability. No new state/charge/effect; read access still authenticated. |
| D3-21 | Same ID, change repository, scope, descriptor, effect target, expected refs or resultDigest; vary field order only as control. | Changed semantic payload => OP_PAYLOAD_CONFLICT; ordering-only canonical JSON => same digest/receipt. Revisions/fetch timestamps may refresh only as separately validated transport CAS. |
| D3-22 | Use task-A as another request/op ID; effect-A on task B; SETTLE phase with different root intent; settle same intent with cost4 vs original cost3. | Global collision or phase/root digest conflict; accepted index/receipt/accounting unchanged. |
| D3-23 | Compact committed history including terminal A; crash before/after archive fsync and authority CAS; restart; replay same admission/effect and conflicting payload, then delete tombstone/chunk or replace replayRoot. Exhaust hot/candidate/retained-ID capacity with reduced fixture limits, leaving capacity reserved for active receipt. | Old/new exact manifest reconstructible at each cut, same replay known, conflict rejected; erased/tampered replay/archive authority blocks. Capacity blocks intake, never drops IDs; already admitted receipt/recovery still fits. No ID reuse because task is expired/deleted. |

## Lease, recovery and intake

| ID | Concrete sequence | Expected oracle |
| --- | --- | --- |
| D3-24 | Prepare A at T, enqueue B at T+1, then prepare B while A owns writer. | Enqueue succeeds, B QUEUED; preparing B denies SINGLE_WRITER_BUSY without accepted prepare ID. |
| D3-25 | No intent: try new attempt at T+99, T+100, T+101 separately. Repeat with task expiry T+50 and with timeout deadline T+40. Mark recovery at earliest equality; prove ledger/capability had no intent; release and requeue. | Authorize only before minimum task/lease/timeout deadline; equality/later rejects. Explicit no-effect recovery frees reserve; later eligible prepare gets fence2, old fence1 cannot write. |
| D3-26 | Intent A accepted; provider running or unknown at T+100. Enqueue B, mark recovery, attempt prepare/deliver B. | Intake works; execution remains locked, R=8; expiry does not create second writer or release budget. |
| D3-27 | Stale writer/fence1 or prior epoch tries completion, new intent, recovery or deliver after explicit recovery/new session. Receipt arrives from provider separately. | Worker authority rejected; trusted receipt retained for recovery owner, not lost. No old-session capability replay; provider cancellation/absence must be conclusive before another effect. |
| D3-28 | Inject trusted clock rollback T-1, caller TTL extension, clock uncertainty; kill switch while provider in flight. | New attempt blocked, lease cannot extend by caller. Kill switch stops new effects but allows read/receipt/recovery and preserves unknown reservation. |

## Arithmetic and daily cap

| ID | Concrete sequence | Expected oracle |
| --- | --- | --- |
| D3-29 | Reserve8, authenticated actual3; successful settle, replay settle. | R=0,S=3,L=5; no reserve+actual double charge; replay unchanged. |
| D3-30 | FAILED then INTERRUPTED in separate resets: actual3; confirmed no effect cost0; unknown cost. | Known3: R0/S3/L5. Proven0: R0/S0/L8. Unknown: nonterminal recovery R8/S0/L0. Failure label cannot refund real consumption. |
| D3-31 | A reserves8 under daily12; B tries5; then A settles3/releases5; B retries denied prepare ID. Separate reset: A settles actual8, execution lock free; B reserve5, then C reserve4. Race via D3-16 at remaining capacity. | Active-writer B initially denies SINGLE_WRITER_BUSY, not proof of daily-cap rejection; after actual3 B5 accepted. Free-lock variant: daily S8+B5 denies DAILY_CAP_EXCEEDED without ID use; C4 fits exactly12. Exactly one competing CAS succeeds, no cap oversubscription. |
| D3-32 | Reservation8 in day D, crosses midnight, settle3 on D+1. Then trusted clock returns to D. | D retains S3/L5, outstanding reservations never reset; no backward-date replenishment. Unknown D reserve stays8; new-day task limit independent with hard total-cost bound for original attempt. |
| D3-33 | Costs -1/NaN/float/negative-zero/unsafe integer, limit overflow, zero estimator, or cost11 for reserve8. | Malformed data denied before accepted arithmetic; counter exhaustion blocks. Authenticated cost11 persists R0/S11/L0/overrun3 and COST_INCIDENT, disables new effects and needs owner; cannot reject truthful accounting, clamp to8 or claim cap compliance. |
| D3-34 | Post-effect timeout/lease expiry/policy change with missing cost; caller asks release or lower actual without receipt. Then provider proves exact3. | R8 retained initially; only authenticated receipt/disposition converts to S3/L5; no timeout or policy-based refund. |

## Evidence, governance, migration and rollback

| ID | Concrete sequence | Expected oracle |
| --- | --- | --- |
| D3-35 | Caller passes `verifiedSynthetic=true`, copied review JSON/GREEN_LIGHT, fabricated comment/run IDs or author name. Reader instead returns wrong repository, workflow or actor. | INVALID_EVIDENCE / NEEDS_MORE_EVIDENCE; success projection stays false; arbitrary names/hashes do not authenticate. |
| D3-36 | CI correct H but wrong/missing B; wrong attempt/run; required job skipped/cancelled; stale workflow definition; zero/unknown required coverage; old response after H2. | No exact-head/base eligibility. Required skipped job is not pass. Original evidence retained as historical, not rewritten. |
| D3-37 | Canonical mailbox has matching requestId/head running, or already answered NEEDS_MORE_EVIDENCE/GREEN_LIGHT. Restart controller and ask again. Simulate comment accepted then lost ack. | Zero reposts; reconcile by operation marker/comment ID. #617 R1 and #616 R1 are answered fixtures; never invoke either live review. |
| D3-38 | API evidence unavailable; response body claims CLAUDE but platform author/provenance differs; wrong requestId/base. | Fail closed; local cached/copied body cannot substitute. Success only after authenticated exact tuple/provenance and all required checks. |
| D3-39 | Request workflow/permission/secret/cost/dispatch/merge/research/trading/autonomy-rule operation; offer broad prior approval, expired answer or wrong-scope approval. | NEEDS_USER_DECISION with exact blocked scope; no automatic capability, external action, stage flag change or merge. Exact future approval still doesn't waive CI/review/other gates. |
| D3-40 | Import pinned v1 QUEUED, PREPARED/CLAIMED and terminal snapshots; conflicting model ownership, malformed ledger or lower fence. | Deterministic imports with pre/post digest, no execution authority; active work recovery-only, terminal historical, queued requires new identity/approval. Ambiguous ownership/incompatible history rejected. Legacy budgetUsed cannot become refundable money. |
| D3-41 | Roll back code with active intent; load old snapshot/schema/UUID; request downgrade to v1 or reset anchor. | Disable new attempts; preserve latest anchor/WAL/replay/budget. Compatible code reads latest version or remains disabled. No autonomous state rollback/downgrade. |
| D3-42 | Exercise full recovery: two tasks, same global index, expiry, lost effect ack, settlement, compaction, restart and concurrent prepare. Missing trusted journal/anchor on final restart. | All oracle invariants hold through sequence; acknowledged receipts remain unique; fence/epoch monotone; missing authority/version blocks and needs owner recovery. |

## Implementation-level acceptance gates

The future pure model may run these schedules with fixture identities/time and
a synthetic authority/provider. Those results prove only the model. Persistent
implementation must execute applicable cases against the **same canonical queue
API**, with separately durable authority and subprocess crash/restart, coherent
store rollback and two process races. Re-run the existing D1/D2 suites through an
explicit v1 compatibility layer where applicable; update intentional v2 semantics
in separately versioned tests, never relabel old memory tests as persistent proof.

Authentication/provider cases need separately approved authenticated reader and
gateway implementations, isolated contract fixtures and provider-sandbox tests
only if authorized. Fsync/durability, retained authority failure domain, actual
CAS/idempotency and enforceable cost ceilings cannot be inferred from a memory
Map/HMAC. Reject a provider/task class missing these properties.

For each exact head/base record test commands, Node version, case/assertion counts,
skips/failures, crash boundary coverage, authenticated evidence provenance and
remaining blockers. No mutation-testing, local model PASS, CI run or historical
Claude response grants storage/adapter/pilot/spending/merge authorization. Request
a fresh independent exact-head review only under normal dedup and STREAM-SAFE-V7
rules after an approved scoped implementation, never duplicate the existing R1.
