# Phase 1C: offline transaction safety

Phase 1C is a synthetic transaction laboratory stacked on the exact Phase 1B
closure head `bd9bf59bfa83e98c4925c4d898a0111a2f564cde` (#614). Its Release
Safety run `37892987483` passed 1962/1962 Node tests; mailbox response
`6075637875` grants scoped offline-lab GREEN_LIGHT for that exact Phase 1B head.
This evidence does not cover the new Phase 1C head. The reviewed Phase 1B head
remains unchanged. The new module reuses the existing validated
store, recovery rules, ordered ledger and global operation-ID checks rather than
implementing another task lifecycle.

No production coordinator, dispatch, disk or network adapter, scheduler,
permission, spending, research-stage or trading activation is included. A
successful local test or offline review does not authorize any of those actions.

## Trust boundary

The simulated trusted memory adapter remains alive when a coordinator session
crashes or restarts. Its signing key, current committed generation, canonical
commit identity and task fencing high-water marks are outside the exported
snapshot. At bootstrap the watermarks are derived from the validated committed
ledger; every staged successor recomputes them and rejects any decrease before
commit. An untrusted snapshot cannot supply or reset that authority.

This models durable authority across *coordinator* restarts. It does not provide
persistence across process termination, machine failure, rollback of the trusted
adapter itself, replacement of the signing key or loss of the authority. A real
durable adapter must preserve both the committed state and an independently
protected monotone authority; restoring only an authenticated old state is not
sufficient rollback protection.

Synthetic signing material belongs to the fixture and conveys no remote identity
or production authorization. Hostile JavaScript proxies, mutated built-in
intrinsics and compromise of the trusted adapter are outside the plain-data
contract inherited from Phase 1B.

## Implemented API and transaction boundary

`scripts/autonomy-v2-offline-authority.mjs` owns the trusted memory closure;
`scripts/autonomy-v2-offline-transaction.mjs` composes deterministic crash points.
Both reuse `createOfflineStore` and the shared descriptor-only plain-data guards.

| Surface | Offline contract |
| --- | --- |
| `createOfflineTransactionLab(initial, {key, scope})` | Validates the Phase 1B fixture and creates one trusted memory authority. Defaults are public synthetic fixture material, unsuitable for production authentication. |
| `lab.openWriter(writer)` | Captures a nonblank synthetic writer identity and the current authority epoch. There is no real actor authentication. |
| `writer.execute({type, args, expectedGeneration}, {crashAt})` | Stages and commits an allowlisted existing-store operation, or injects one of the five crash points. Supported types are CLAIM, MARK_RECOVERY, REQUEUE and COMPLETE. |
| `writer.stage(request)` / `writer.commit(ticket)` | Allows deterministic concurrent-writer tests. The frozen opaque ticket is bound to its originating session, current epoch and expected generation; its private candidate never crosses the authority boundary. Forged, foreign-session or already-used tickets cannot commit. |
| `writer.checkFence({taskId, fence})` | Pure synthetic admission: the session epoch, CLAIMED state, captured writer, current lease fence and external watermark must all match. It does not execute a side effect. |
| `lab.snapshot()` / `lab.authorityState()` | Returns detached copies of the signed envelope or public authority counters/digest/fences. Neither exposes the signing key or private staged state. |
| `lab.restore(envelope)` | Read-only verification against the current trusted authority. It neither imports state nor signs caller-supplied data. |
| `lab.restart()` | Preserves committed task state and generation, advances the authority epoch and reseals the envelope. Existing writer sessions and their staged tickets become stale. |

Staging rebuilds the existing store from the committed tasks and applies exactly
one existing lifecycle operation. The global accepted-ID index is reconstructed
from that validated ledger; there is no separately writable replay index.
Generation CAS happens again at commit. The resulting task state, ledger, budget,
fence watermarks, generation and signed envelope replace the trusted fields
inside one synchronous synthetic commit. Faults are injected around that commit,
not inside its assumed atomic replacement; the memory model does not prove the
atomicity of any future physical storage operation.

The signed envelope contains `version`, `scope`, `generation`, `epoch`, `snapshot`,
`fences`, `digest` and `mac`. SHA-256 covers the domain-prefixed complete canonical
payload, and HMAC-SHA-256 authenticates that domain-prefixed digest. Restore checks
scope, authentication, exact current generation/epoch/digest, and the existing
ledger schema plus derived fence watermarks. An internally valid old snapshot or
a valid signature from another generation is insufficient. The authority does
not offer a public arbitrary-payload signing method.

Canonical encoding validates nested own descriptors before reading values,
serializes sorted record keys directly and preserves array order. It rejects
accessors, nonordinary arrays, custom iterators, functions (including toJSON),
cycles, undefined, symbols, nonfinite/unsafe numbers and negative zero. This
prevents validation/serialization divergence within the supported plain-data
contract; hostile proxies and compromised JavaScript intrinsics remain excluded.

## Defined crash points

| `crashAt` | Committed task data and generation | Retry after reopening a writer |
| --- | --- | --- |
| `BEFORE_STAGE` | Unchanged; no candidate created | The operation may be accepted once. |
| `AFTER_STAGE` | Unchanged; private candidate not published | The operation may be accepted once. |
| `BEFORE_COMMIT` | Unchanged; staged candidate cannot survive the epoch change | The operation may be accepted once. |
| `AFTER_COMMIT` | Exactly one committed operation, budget charge and generation advance | The accepted ID is replay-protected; no second charge. |
| `BEFORE_ACK` | Same committed result, with acknowledgement lost | The accepted ID is replay-protected; no second charge. |

Each simulated crash advances the coordinator epoch through `restart` while the
trusted memory authority survives. Consequently, even a pre-commit crash makes
old writer sessions and old signed envelopes stale, although task data and
generation did not change. Post-crash retry uses a new writer session and the
current trusted generation. These results model deterministic recovery; they do
not model operating-system termination or a torn disk write.

## Invariants to preserve

- A commit publishes task state, revision, ordered ledger, budget, global accepted
  operation-ID index derived from that ledger, generation and fence watermark as one indivisible simulated
  transaction. A rejected or interrupted pre-commit operation publishes none of
  them.
- Snapshot authentication binds the complete canonical payload and an authority
  scope. Matching a generation number alone cannot authenticate changed state.
- Restoring a previously authentic snapshot cannot lower the authority's committed
  generation or fences. An old writer cannot commit using an earlier authority
  generation, including after another coordinator starts.
- Committed operation IDs survive session restarts. An operation committed before
  its acknowledgement is lost remains charged exactly once, and its retry cannot
  append a second ledger entry or consume another budget unit.
- Rejected IDs remain reusable; cross-task reuse of an accepted ID is rejected.
  Unknown operation names and unsupported input shapes fail closed.
- Recovery remains explicit. Expiry remains advisory until the existing
  `markRecovery` transition revokes the writer. No function authenticates a human
  reconciliation or executes a real side effect.

Reopening a writer with the same label after restart creates a new fixture-trusted
session. If its still-current CLAIMED lease and fence match, that new session may
pass `checkFence`; the earlier captured session cannot. `openWriter` is not an
identity-authentication boundary, and `checkFence` is an instantaneous synthetic
check rather than a durable side-effect capability.

## Validation scope

Deterministic regression tests cover all five crash points, pre-commit retry and
post-commit replay, competing same-generation writers, restart epoch fencing,
ledger/replay/budget invariants, authentic old-snapshot rollback and tamper
rejection. A formerly accepted signed snapshot is preserved before forward
commits and rejected afterward, distinguishing rollback rejection from malformed
input or bad authentication. Independent Codex smoke checks also exercised
special task/operation identifiers, detached public authority copies and fence
watermark preservation through recovery, requeue, re-claim and restart.

The inherited task-store safe-counter boundaries are testable with explicit
fixtures. Authority generation/epoch overflow is guarded before mutation, but
these counters start at zero and have no privileged injection API; near-maximum
authority-counter exhaustion is not exhaustively exercised by this block. No
test claims process-level durability, authority-reset resistance, authenticated
real writers or actual external side effects.

### Results from this development block

- New Phase 1C regressions: 194/194 pass; all Autonomy tests: 368/368 pass.
- Full Node run in the restricted sandbox: 2139/2145 pass. All six failures
  reproduce on the unchanged Phase 1B tree (34/40 relevant baseline checks).
- With test isolation and network-enabled sandbox rights, all nonbrowser Node
  tests pass: 2147/2147. The two Chrome acceptance files remain environment-limited;
  a network-enabled diagnostic timed out and was stopped rather than claimed green.
- Python discovery: 189/189 pass. Release, continuity, frozen research (140 files),
  UI, privacy and orchestration guards pass; original secret scanner passes with
  the network-enabled sandbox. No workflow or permission file was changed.
- Removing snapshot authentication causes nine test failures; removing commit
  generation CAS or captured-session epoch checks causes one failure each.
  These deliberate mutations were made in test-agent source copies and restored.

CI and independent Claude review of the new head remain unperformed at this local
milestone. Existing Phase 1B CI/review evidence must not be inherited.

## Remaining integration gates

A separately designed and reviewed durable adapter needs crash-consistent
storage, authoritative monotone generation and fencing state, secure key and
scope management, authenticated review/CI evidence and reconciliation, bounded
replay retention, and fence admission at each real side-effect boundary. It must
also recheck live exact head/base and enforce Single-Writer atomically. Trusted
adapter replacement or authority loss must fail closed or require a separately
authorized migration, never silently bootstrap from an arbitrary snapshot.

The stack remains a proposal for the Lead: no merge, ancestor retargeting or
permission change is performed by this block. Exact-head CI and a fresh,
deduplicated Claude review via mailbox #571 are required before any integration.
ChatGPT remains Lead and merge owner; Codex implements; Claude reviews
independently. A Codex subagent safety audit is not a Claude verdict.

## Publication and review boundary

STREAM-SAFE-V7 permits one guarded repository mutation per run and requires
ending the run after that mutation. Local implementation, tests, a durable
intent and a prepared Draft body may precede one guarded branch publication.
Creating the Draft and later requesting Claude review are separate reconciled
mutations; a prepared body or request is not a published PR or a completed review.
The Lead must inspect the live exact head/base, CI and mailbox before advancing.
An ancestor GREEN_LIGHT, or the independent Codex design audit performed in this
block, is never approval of a different head. No merge is authorized.
