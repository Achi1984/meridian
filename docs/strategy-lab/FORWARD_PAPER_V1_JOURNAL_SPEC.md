# Forward-Paper V1 durable journal and bounded observer

**Status:** documentation-only design; implementation blocked pending independently
assessed D2 evidence and the companion interface.

**Interface dependency:** Achi1984/meridian#914, Draft PR #916, owns the event and
transition wire fields and identity semantics. At this writing PR #916 contains
only its initial-plan commit `b7321fdd6b07f48f7523b3903cc4c71d97c9045f`; it has
no interface files or M1 interface commit. The terms and tables below are
conceptual design vocabulary, not wire fields, a second API, or an alternative
identity definition. Exact names, canonicalization, digests, reason codes, and
compatibility remain **WAITING_FOR_INTERFACE**.

## Scope and evidence boundary

This document specifies durability, fencing, bounded observation, and failure
semantics only. It does not specify an executable observer, storage schema,
SQL, runnable commands, market-data adapter, strategy reducer, or accounting
engine. No Paper or Live authority follows from this design.

The local research supervisor documents useful mechanisms: create-new-only
local journal provisioning, transactional claims, consumed attempts, monotonic
deadlines, bounded child I/O, post-commit acknowledgments, retained fences for
unsettled work, and read-only inspection (`docs/strategy-lab/RESEARCH_SUPERVISOR.md`;
`scripts/research-supervisor/journal.py` and `supervisor.py`). Its SQLite
schema, B1 identity/profile, scheduler, authority, and accounting are not
Forward-Paper authority and must not be copied or treated as an implementation
of this contract. `inspection_report.py` is a projection of that existing
journal; `inspection_history.py` checks supplied observations without durable
storage or source authenticity. Neither is a Forward-Paper journal.

PR #911 review correction #6275687114 is binding context: the gateway maps
`openTime`, `high`, `low`, `close`, and `closeTime`, but does not provide an
`open` price, volume, or trades. No usable full OHLC is assumed. Never derive an
open from close or create a simulated fill from an unavailable price.
Provider availability, source authenticity, storage durability, clock behavior,
and deployment behavior remain unverified.

The accepted #911 gate requires useful, independently assessed D2 evidence
before any Forward-Paper implementation. Strategy, source, universe, product,
capital, costs, risk, timing, stop/resume, budget, and reconciliation-authority
choices remain unset. Historical no-stop policy is not inherited. A policy,
source, or version change requires a new immutable run.

## Journal entities and conceptual fields

The field labels here describe information that durable records must represent;
they are not prescribed serialization or API spellings. Exact event and
transition fields are blocked on #914's published M1 interface.

| Entity | Required conceptual content | Immutability and checks |
| --- | --- | --- |
| Run and frozen configuration | Unique run identity; strategy/code and policy version identities; source/provider contract identity; universe/product and timeframe; explicit risk, cost, capital/currency and timing selections; source/config digest; explicit finite invocation limits. | Freeze before accepting observations. No in-place edit, inherited default, or mixed version. Missing or changed required configuration rejects the run before claim. Any changed policy/source/version starts a new run. |
| Observation identity and digest | Interface-defined observation identity; digest of the interface-defined content; run identity; observation kind; source watermark reference; source-reported time and any separately identified local receipt time. | First accepted identity binds permanently to its digest. Same identity and digest is a duplicate; same identity with another digest is a conflict and halts the affected run. Digest validity does not authenticate the provider or payload. |
| Source watermark | Interface-defined source/provider and stream identity; instrument/timeframe where applicable; source sequence or as-of/closed-through position; predecessor/continuity information where supplied. | Distinguish source progress from local receipt/fetch time. Exact meaning and encoding are owned by #914. A missing, regressing, ambiguous, late, or gapped watermark cannot silently advance the eligible position. |
| Attempt and fence | Run and logical operation identity; monotonically advancing attempt number; unique fence generation/token; claimant; expected committed receipt sequence/state; active or resolved status. | Claim is a compare-and-set against expected state and the current fence. A successful claim consumes an attempt. Its fence token remains in immutable history after resolution. Commit atomically resolves the winning active claim; an unresolved result keeps that claim active and blocks re-execution. A losing compare-and-set does not create a claim or halt the run. |
| Proposed transition | Interface-defined proposal identity and disposition; input observation identities/digests; expected prior state/receipt sequence; proposed next state; calculated account delta; fence generation. | Proposal is immutable, bound to the run/config and claim, and checked against current state. It is not an effect and cannot be acknowledged as committed. No proposal may bypass missing marks, source gaps, eligibility, risk, or accounting invariants. |
| Committed receipt | Unique receipt sequence; proposal and observation references; expected and resulting state identities; account delta and post-transition account identity; run/config identity; committed fence generation; durable commit outcome. | Append-only and written atomically with the account effect, committed sequence advance, and resolution of the winning active claim. Preserve the fence token and attempt as historical identity; resolve its active status in that same transaction. A receipt cannot be fabricated, rewritten, or inferred from an ACK or UI response. A receipt sequence is contiguous within the selected journal. |
| Optional derived snapshot/checkpoint | Run/config identity; account projection; last included committed receipt sequence and identity; snapshot content identity; explicit valuation/mark availability. | Not an atomic participant or authority for commit status. It may lag the committed head if its projection matches the receipt prefix it names; that is a stale checkpoint, not corruption. A checkpoint ahead of the committed head, or whose content/digest fails validation against its named prefix, is corrupt/drifted and unusable. It cannot make an otherwise evidenced receipt `UNKNOWN` or invalidate `OP_APPLIED`. Preserve evidence; do not rewrite or automatically repair it. Missing marks remain unavailable, never zero. |
| Reconciliation record | Reconciliation identity; affected run/operation/observation and expected state; one outcome from the recovery table; evidence references/digests; decision and authority provenance; decision time and time basis; before/after sequence and fence disposition. | Append-only and separate from receipts. It records a decision; it does not create a missing receipt, change an account, authorize itself, or erase an earlier record. No recovery command or presumed operator identity is specified here. |

## Transaction boundaries and effect semantics

The implementation must preserve these boundaries. The exact wire transition
shape and serialization are still owned by #914.

1. **Observe and deduplicate.** Accept only the caller-supplied bounded
   observations for this invocation. Validate run/config binding, required
   source watermark, ordering, and interface-defined identity/digest. An
   identical observation already durably committed returns its existing durable
   result without another attempt or account effect. A reused identity with a
   changed digest records a conflict when storage permits and halts the run; it
   never replaces the old observation. Gaps and late inputs remain explicit
   and are not backfilled.
2. **Claim and fence.** Atomically compare the caller's expected run state,
   committed receipt sequence, and current fence, then consume one attempt and
   issue a new fence generation. Only one claimant may win. A compare-and-set
   loser is rejected as ordinary contention, consumes no attempt, and does not
   halt the run or invalidate the winner. An invalid precondition creates no
   claim. An unresolved claim remains active; no timeout, restart, read-only
   inspection, or elapsed wall time releases it.
3. **Propose.** Persist or otherwise durably identify the immutable proposal
   against that claim. Recheck expected state, run/config identity, observation
   digests, watermark eligibility, and fence. A stale compare-and-set is a
   no-effect rejection; it is not by itself a run-wide identity/history
   conflict.
4. **Commit account, receipt, sequence, and claim resolution atomically.** One
   storage transaction must compare the expected account/state/receipt
   sequence and active fence, apply the account delta, append exactly one
   committed receipt, advance the durable sequence, and resolve the winning
   claim's active fence together. All happen, or none do. The historical
   attempt and fence token remain immutable evidence after resolution. Optional
   derived snapshots are not participants in this transaction. If the storage
   model cannot establish whether this transaction committed, classify the
   operation `UNKNOWN`; do not infer rollback from a missing response.
5. **Acknowledge only after commit.** Return the committed receipt identity and
   durable result only after the commit boundary. An ACK, process response, or
   UI arrival is not the commit point. Lost ACK after commit is recovered by
   read-only lookup/deduplication of the already committed result, never by
   applying the transition again.

Every commit must match its expected prior state, expected receipt sequence,
and current fence. A stale writer, concurrent compare-and-set loser, or
mismatched proposal must leave account state and receipt history unchanged.
An ordinary loser is not a run-wide halt: the current winner remains eligible
to commit while its claim and expected state are still valid. A conflicting
digest for an already-bound identity, impossible receipt sequence/history, or
other demonstrated journal-integrity conflict is distinct; preserve evidence
and halt the affected run. A rejection must not be represented as a committed
transition.

## Crash boundary map

| Interruption point | Durable interpretation after restart |
| --- | --- |
| Before claim | No attempt, fence, proposal, receipt, or account effect exists. A later invocation is not a replay of a claimed operation, but still requires a valid explicit invocation and current expected state. |
| After claim/attempt, before proposal | The attempt and active fence are durable; no proposal or account effect is presumed. Treat as unresolved until authorized reconciliation establishes the outcome. |
| After proposal, before atomic commit | The proposal is not an account effect. If absence of commit cannot be authoritatively established, report `UNKNOWN`, retain its fence, and block re-execution. |
| During an ambiguous commit/write failure | Do not infer either rollback or success. Keep the fence and classify `UNKNOWN` unless authoritative receipt/account evidence proves `OP_APPLIED` or `OP_ABSENT`. |
| After durable commit, before ACK | The account effect, receipt, sequence advance, and winning-claim fence resolution are already committed together. Read-only inspection/deduplication returns that result; do not apply it again. A later optional snapshot write is irrelevant to this outcome. |
| Concurrent compare-and-set loser | The loser is rejected without a claim, attempt, proposal, or account effect. The winner remains valid and may commit if its expected state and active fence still match. This rejection alone does not halt the run. |
| Later stale writer | Reject a proposal whose historical fence is no longer active, with no account effect. Preserve the old token and current state. Ordinary stale-writer rejection alone does not halt the run; an independent identity/history integrity conflict does. |
| Optional snapshot lags committed head | Accept as a valid older checkpoint only if its projection matches the receipt prefix it names. It is stale, not corrupt, and does not change commit/recovery outcome. Do not silently advance or rewrite it. |
| Optional snapshot is ahead of head or fails prefix/content validation | Mark that snapshot unusable and preserve it for inspection. Do not repair it automatically. Determine operation outcome from the atomic account/receipt/sequence/claim transaction; snapshot damage alone does not reverse `OP_APPLIED`. |

The exact storage technology and its crash, transaction, and durability
guarantees are unverified. “Exactly once” is therefore not a global claim: at
most, the future implementation may establish one effect per interface-defined
identity within a specifically declared and verified journal/storage model.
Provider delivery, remote systems, and unverified filesystems are outside that
claim.

## Bounded one-invocation observer

The observer, if separately authorized and implemented, is a synchronous,
one-invocation consumer of observations supplied by its caller. It does not
discover or retrieve observations. It has no feed, polling, network, service,
daemon, workflow, scheduler, recurring timer, or background continuation.

Each invocation and frozen run configuration must explicitly supply finite,
positive limits for:

| Bound | Required limit |
| --- | --- |
| Events | Maximum observations accepted and maximum transition/proposal/receipt count. |
| Input/output | Maximum serialized input bytes and maximum returned/output bytes. |
| Persistence | Maximum journal growth/bytes and maximum snapshot/receipt bytes for the invocation. |
| Time | Maximum elapsed invocation duration, measured by a monotonic clock; per-transition time may not extend the total. |

No limit has a wall-clock default. A missing, non-finite, non-positive, invalid,
or internally inconsistent limit fails closed before a claim. Counts and byte
limits must be positive integers; elapsed duration must be a positive finite
value with an explicitly pinned unit. The final implementation must select and
enforce hard ceilings in addition to these caller-supplied limits; those values
and the storage model are unselected here and block implementation. Hitting a
bound before claim rejects without an attempt. Hitting it after claim stops new
work; if commit status is ambiguous, the operation remains `UNKNOWN` with its
fence retained. Output and diagnostics are bounded and must not echo arbitrary
payloads.

Use source-provided event times and watermarks only for source ordering. Use a
monotonic clock only to enforce elapsed duration. Do not substitute machine
wall-clock time for source time or invent a missing time. The clock provider,
storage durability, deployment, and provider behavior are not verified.

## Restart and inspection invariants

- Journal history is append-only. No replay, missed-fill backfill, silent edit,
  automatic repair, or automatic retry is allowed.
- After restart, identical observation identity plus digest resolves to the
  original durable result. A different digest for that identity halts as a
  conflict. An integrity failure never authorizes rebuilding history.
- A `UNKNOWN` operation retains its fence and blocks re-execution until an
  explicit, authorized reconciliation is durably recorded. Read-only
  inspection can report evidence and outcome candidates but cannot resume,
  release a fence, create a receipt, or change account state.
- The atomic account/receipt/sequence/claim-resolution transaction establishes
  commit outcome; a later snapshot is optional and not required to establish
  `OP_APPLIED`. A snapshot may name an older committed prefix if it matches that
  prefix. A snapshot ahead of the head or mismatching its named prefix is
  unusable, not silently repaired. Corrupt, truncated, missing,
  non-contiguous, or conflicting receipts stop processing; no history repair
  is inferred.
- New policy, source, strategy, or implementation version means a new run,
  not a mutation of an existing run's identity or evidence.

## M1/M2/M3 handoff

- **M1 inventory and transaction/failure map:** specified here independently.
- **M2 interface binding and interoperability:** blocked until #914 publishes
  its exact M1 interface commit. At that point, record the exact commit and
  resolve each conceptual table, transition, identity, and canonicalization
  point without redefining companion-owned fields.
- **M3 acceptance and consolidated handoff:** blocked on M2, completion of the
  recovery acceptance matrix, and Lead's independent review. Operating choices,
  D2 evidence, storage model, and source capability remain prerequisites.

Current handoff state: **WAITING_FOR_INTERFACE**. No implementation, runtime,
database, market-data, provider, or authority change is authorized.
