# Forward-Paper V1 durable journal and bounded observer

**Status:** documentation-only journal design, aligned to the accepted event
interface. The separately specified isolated synthetic test harness is
owner-approved in principle; journal/operational implementation remains blocked
by the gates below.

**Canonical event/transition interface:** `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0`, accepted
companion commit
[`a1c1b35656d501e4d2bcc74ae4a717110beca26c`](https://github.com/Achi1984/meridian/commit/a1c1b35656d501e4d2bcc74ae4a717110beca26c),
specifically the companion's
[contract specification at that commit](https://github.com/Achi1984/meridian/blob/a1c1b35656d501e4d2bcc74ae4a717110beca26c/docs/strategy-lab/FORWARD_PAPER_V1_CONTRACT_SPEC.md)
§§4–8. The companion contract owns all event, transition, identity,
canonicalization, acknowledgment, state, and reason-code semantics. The tables
below describe journal durability obligations using that interface; they do
not add or rename wire fields. This is a historical pin for the unchanged
event/transition wire contract; this documentation clarification is not text
from that commit and does not change its fields. The reconciliation-resolution
receipt envelope is **UNSPECIFIED** in v1. A separate versioned contract
amendment defining that envelope is required before implementing reconciliation
or resolving `UNKNOWN`. M3 still requires Lead's consolidated acceptance.

## Scope and evidence boundary

This document specifies durability, fencing, bounded observation, and failure
semantics only. It does not specify an executable observer, storage schema,
SQL, runnable commands, market-data adapter, strategy reducer, or accounting
engine. The only approved pre-qualification technical scope is the isolated,
generated-fixture harness in
[`SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md`](SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md);
it is not a journal implementation or evidence of durability. No Paper or Live
authority follows from this design.

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
before Forward-Paper admission or operational implementation; it does not
block the separate synthetic test-only scope above. All twelve §3 configuration
groups remain `REQUIRED_UNSET` for real operation: strategy identity; source
identity; ordered universe; product; initial capital/account currency;
observation period; fee/slippage/liquidity; risk/stop/exposure/loss;
decision/fill/expiry/mark timing; freshness/gap/synchronization; compute bounds;
and reconciliation authority. No separate budget or stop/resume choice is added
to §3. Future work is limited to verified existing resources, `$0` additional
spend, and no provisioning; availability is unverified. Storage
location/durability and authoritative clock/source-time mapping are additional
implementation gates, not §3 configuration rows. Historical no-stop policy is
not inherited. A policy, source, or version change requires a new immutable run.

## Journal entities and conceptual fields

The companion's exact field names and meaning are canonical; this journal
design adds no alternate event or transition fields. Durable records must
preserve the following interface identities, provenance, and causal boundaries:

| Entity | Required conceptual content | Immutability and checks |
| --- | --- | --- |
| Run and frozen configuration | Companion `interfaceVersion`, `runIdentity`, `strategyIdentity`, `configurationIdentity`, closed `choices`, and `frozenAtLocalMs`; `RUN_ADMITTED` receipt with `runStartDurableAtLocalMs` and source barrier or trusted clock mapping. | Freeze and separately admit before `FORWARD_CANDIDATE` input. Missing/`REQUIRED_UNSET` choices block admission. Any changed strategy/config/source/version requires a new immutable run. |
| Observation identity, payload, and provenance | Companion `eventIdentity=(sourceIdentity, sourceStream, productIdentity, sourceEventId)`; canonical complete event and `payloadDigest`; `runIdentity`, source/product/adapter identities; `sourceEventTimeMs`, `localReceivedAtMs`; `kind`; corresponding `candle`, `priceEvent`, or `mark`; `observationUse`, `provenanceClass`, and `provenanceReference`. | Identity binds the full digest, including use/provenance/reference. Exact identity+digest is `IDEMPOTENT_NOOP`; changed digest under an existing identity is `IDENTITY_CONFLICT` and halts. Historical/backfill/replay/synthetic input is `WARMUP_ONLY`, never forward performance. A digest or provenance label is not authentication. |
| Decision proposal | Companion `decisionIdentity`, ordered `inputEventIdentities`, `inputDigest`, `decisionTimeLocalMs`, strategy-owned `proposal`/`NO_ACTION`, and `proposalDigest`; it is carried by the exact `TransitionProposal` rather than a new journal wire shape. | Pure deterministic proposal over acknowledged state and bounded events; input events precede the consuming decision. No decision effect exists until its exact durable receipt is acknowledged. |
| Eligible fill intent | Companion `priceEventIdentity`, payload digest, `priceEventTimeMs`, `localReceivedAtMs`, phase, exact price/product, `decisionReceiptIdentity`, `decisionDurableAtLocalMs`, `causalOrderProof`, and selected quantity/side/cost treatment. | The causal proof must establish event occurrence strictly after the exact committed decision acknowledgment. Local receipt later than ACK alone is insufficient. No past open/backfill/cache event may fill. |
| Source watermark and causal proof | Accepted source event identity/time/sequence and closed-through position, with companion `provenanceReference`; run-start source barrier or trusted source/local clock mapping. | Source time and local receipt time remain distinct. Forward decision inputs must follow the durable run-start fence and precede the consuming decision; they need not follow that decision's ACK. Only an eligible fill/price event must additionally be proven strictly later than that exact decision's durable acknowledgment. A gap, regression, late, or unprovable event cannot silently advance eligibility. |
| Attempt and fence | The companion proposal/receipt `receiptIdentity`, `transitionIdentity`, expected/proposed `stateIdentity`, and persistence outcome, plus the journal's internal attempt number and fence token needed to enforce single-writer fencing. | A successful claim consumes one attempt. Its fence token remains immutable history after resolution. The committed winning claim's active fence is resolved in the same atomic commit as account, receipt, and sequence. `UNKNOWN` keeps it active. An ordinary compare-and-set loser consumes no attempt, does not halt the run, and does not invalidate the still-current winner. Internal attempt/fence metadata is not a competing interface field. |
| Transition proposal | Exact companion `TransitionProposal {interfaceVersion, expectedStateIdentity, eventIdentity, proposedStateIdentity, receiptIdentity, disposition}`; disposition is `PROPOSE`, `IDEMPOTENT_NOOP`, `REJECT`, or `HALT`. | Pure proposal only; it does not itself mutate state/account. Validate exact expected state, event and receipt binding, run/config, fence, causality, and applicable invariants. Do not extend or rename this closed shape. |
| Account state and committed receipt | Companion `accountIdentity`, `runIdentity`, `baseCurrency`, exact `cash`, `holdings`, `marks`, `equity` or `UNAVAILABLE`, `riskSnapshot`, `parentStateIdentity`/`stateIdentity`; receipt `interfaceVersion`, `receiptIdentity`, `transitionIdentity`, `transitionDisposition`, exact reason, event/input identities and digests, account/cost/mark evidence, and persistence-set `durableAtLocalMs`. | Durable `DURABLE_COMMITTED` evidence atomically applies the account state, appends receipt, advances sequence, and resolves the winning active claim; retain historical fence token. ACK/UI arrival alone is not commit. Receipt/state identities and fields are those of the pinned interface. |
| Optional derived snapshot/checkpoint | A projection/cache of the authoritative account and reducer state already committed in the receipt transaction; names a specific committed state/receipt identity and account/mark content. It is not that authoritative committed state itself and not a new interface receipt or transition. | Not an atomic participant or authority for commit status. A lagging snapshot is valid only if it matches the committed prefix it names. Ahead-of-head or content/prefix mismatch makes that snapshot unusable; it does not undo or obscure an independently evidenced `DURABLE_COMMITTED` receipt. Never auto-repair, rewrite, or fabricate state. Missing marks/equity remain unavailable. |
| Reconciliation outcome and audit metadata | `OP_APPLIED`, `OP_ABSENT`, `OP_CONFLICT`, and `UNKNOWN` are conceptual recovery outcomes only. The pinned v1 interface defines no reconciliation-resolution receipt envelope or schema. | No reconciliation receipt fields or transition are specified here. A separate versioned contract amendment must define and accept the envelope before reconciliation can be implemented or resolve `UNKNOWN`. Until then, retain the active fence and block retry/resume. Read-only inspection cannot reconcile. |

## Transaction boundaries and effect semantics

The implementation must preserve these boundaries exactly as specified by
`MERIDIAN-FORWARD-PAPER-EVENT/1.0.0` §§4–8. The companion contract owns
serialization, identities, transition shape, states, dispositions, and reason
codes.

1. **Observe and deduplicate.** Accept only the caller-supplied bounded
   observations for this invocation. Validate run/config binding, required
   source watermark, `observationUse`/provenance consistency, causal proof
   after `RUN_ADMITTED`, ordering, and interface-defined identity/digest. A
   forward decision-input event must precede its consuming decision but need
   not occur after that decision's durable acknowledgment. An
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
3. **Propose.** The reducer computes the exact immutable
   `TransitionProposal` as a pure result over an acknowledged state and bounded
   event; it performs no journal I/O or account effect. The persistence
   boundary binds that result to the active claim/fence and rechecks expected
   state, run/config identity, observation digests, warmup/provenance rules,
   run-start/event ordering, watermark eligibility, and fence. Any separately
   persisted internal intent remains non-authoritative and does not advance
   reducer state. A stale compare-and-set is a no-effect rejection; it is not
   by itself a run-wide identity/history conflict.
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

A definite `DURABLE_REJECTED` is a known no-effect result, distinct from
`UNKNOWN`: it leaves reducer state and account unchanged and cannot be treated
as a commit. The journal must durably resolve that attempt as rejected before
allowing an independent later claim; this is not permission to retry the same
proposal. If the rejection outcome itself is ambiguous, preserve the active
fence and classify `UNKNOWN`. This internal attempt disposition adds no
companion wire field or receipt identity.

Recovery from `UNKNOWN` is not currently implementable: the pinned interface
§§6/8 define no reconciliation-resolution receipt envelope. A separate
versioned contract amendment must specify and accept its schema and binding
rules before any reconciliation implementation or resolution. Until then,
retain the active fence and do not retry, resume, or advance state. A read-only
lookup may establish `OP_APPLIED` only by finding the exact original committed
result; it cannot resolve other outcomes. Internal audit metadata may preserve
diagnostic evidence but does not itself resolve `UNKNOWN`.

Every commit must match its expected prior state, expected receipt sequence,
and current fence. A stale writer, concurrent compare-and-set loser, or
mismatched proposal must leave account state and receipt history unchanged.
An ordinary loser is not a run-wide halt: the current winner remains eligible
to commit while its claim and expected state are still valid. A conflicting
digest for an already-bound identity, impossible receipt sequence/history, or
other demonstrated journal-integrity conflict is distinct; preserve evidence
and halt the affected run. A rejection must not be represented as a committed
transition.

## Pinned transition and receipt mapping

All Forward-Paper reducer state names are exactly `WARMUP`, `OBSERVED`,
`VALIDATED`, `PENDING_DURABLE_DECISION`, `ELIGIBLE_FILL`, `MARKED`, `HALTED`,
and `UNKNOWN`, as defined by the pinned companion contract §8. In particular,
`MARKED` is not terminal: a later admitted `FORWARD_CANDIDATE` can begin the
next cycle while carrying the exact prior committed account/state identity,
cash, holdings, costs, and parent receipt. It does not reset capital. A
`WARMUP_ONLY` observation cannot produce a forward decision, fill, account
mutation, performance receipt, or forward observation count.

The companion's proposal, acknowledgment, and receipt enums are separate and
must not be collapsed:

| Layer | Exact pinned values | Journal meaning |
| --- | --- | --- |
| `TransitionProposal.disposition` | `PROPOSE`, `IDEMPOTENT_NOOP`, `REJECT`, `HALT` | Pure reducer intent. It cannot change durable state or account by itself. |
| Persistence acknowledgment | `DURABLE_COMMITTED`, `DURABLE_REJECTED`, `UNKNOWN` | Only `DURABLE_COMMITTED` advances the exact matching expected/proposed state and commits its receipt/effect. `DURABLE_REJECTED` has no state/effect advancement. `UNKNOWN` retains the active fence and blocks dependent transitions. |
| Receipt `transitionDisposition` | `COMMITTED`, `REJECTED`, `UNKNOWN` | Durable receipt outcome; it is not the proposal disposition or the outer acknowledgment enum. |

For an actionable proposal, the exact `DURABLE_COMMITTED` decision
acknowledgment advances `PENDING_DURABLE_DECISION` to `ELIGIBLE_FILL`.
`ELIGIBLE_FILL` means a decision is durable and waiting for a candidate; it
does not mean a price event has passed causal eligibility or that a fill
occurred. The later event's proof gates acceptance of that fill and the
subsequent transition to `MARKED`. Until a qualifying event and its fill
receipt commit, the reducer remains `ELIGIBLE_FILL`. A committed `NO_ACTION`
proposal instead returns to `OBSERVED`.

The exact proposal shape is the closed companion shape:
`{interfaceVersion, expectedStateIdentity, eventIdentity,
proposedStateIdentity, receiptIdentity, disposition}`. `stateIdentity` binds
its parent and canonical contents; receipt identity is stable only for that
same proposal. A committed receipt binds interface/run/config/strategy
identities, input/event identities and digests, transition identity/reason,
state before/after, account/cost/mark evidence, and
`durableAtLocalMs` assigned by persistence. Decision local time and
`durableAtLocalMs` remain distinct. Do not invent parallel transition IDs,
receipt IDs, states, or reason codes.

Companion reason codes are the closed uppercase vocabulary in contract §8.
Journal/recovery tests use those exact codes, including
`CONFIGURATION_INCOMPLETE`, `VERSION_MISMATCH`, `IDENTITY_MISSING`,
`IDENTITY_CONFLICT`, `DUPLICATE_IDEMPOTENT`,
`PAYLOAD_INVALID`, `BOUND_EXCEEDED`, `EVENT_FUTURE`, `CANDLE_UNCLOSED`,
`EVENT_REORDERED`, `CADENCE_GAP`, `UNIVERSE_MISALIGNED`, `SOURCE_STALE`,
`MISSING_REQUIRED_FIELD`, `LATE_OR_PAST_EVENT`,
`DECISION_NOT_DURABLE`, `PERSISTENCE_REJECTED`, `PERSISTENCE_UNKNOWN`,
`STATE_IDENTITY_MISMATCH`, `BALANCE_INVARIANT`, `RISK_LIMIT`,
`COST_POLICY_INCOMPLETE`, `COST_DUPLICATE`, `MARK_UNAVAILABLE`,
`MISSED_OR_EXPIRED`, and `RECONCILIATION_REQUIRED`. Unknown reason codes
reject; no reason code or free-text value is added by this journal design.

## Crash boundary map

| Interruption point | Durable interpretation after restart |
| --- | --- |
| Before claim | No attempt, fence, proposal, receipt, or account effect exists. A later invocation is not a replay of a claimed operation, but still requires a valid explicit invocation and current expected state. |
| After claim/attempt, before proposal | The attempt and active fence are durable; no proposal or account effect is presumed. Treat as unresolved until authorized reconciliation establishes the outcome. |
| After proposal, before atomic commit | The proposal is not an account effect. If absence of commit cannot be authoritatively established, report `UNKNOWN`, retain its fence, and block re-execution. |
| During an ambiguous commit/write failure | Do not infer either rollback or success. Keep the fence and classify `UNKNOWN` unless authoritative receipt/account evidence proves `OP_APPLIED`; `OP_ABSENT` does not permit resolution or retry without the separately amended reconciliation contract. |
| After `DURABLE_COMMITTED`, before caller receives ACK | The account effect, receipt, sequence advance, and winning-claim fence resolution are already committed together. Read-only lookup by exact receipt/state identity returns that result; do not apply it again. A later optional snapshot write is irrelevant to this outcome. |
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
- A `UNKNOWN` operation retains its fence and blocks re-execution. The pinned
  interface has no reconciliation-resolution receipt schema; a separate
  versioned contract amendment must be accepted before an authorized
  reconciliation can be implemented. Read-only inspection can report evidence
  and outcome candidates but cannot resume, release a fence, create a receipt,
  or change account state.
- The atomic account/receipt/sequence/claim-resolution transaction establishes
  commit outcome; a later snapshot is optional and not required to establish
  `OP_APPLIED`. A snapshot may name an older committed prefix if it matches that
  prefix. A snapshot ahead of the head or mismatching its named prefix is
  unusable, not silently repaired. Corrupt, truncated, missing,
  non-contiguous, or conflicting receipts stop processing; no history repair
  is inferred.
- New policy, source, strategy, or implementation version means a new run,
  not a mutation of an existing run's identity or evidence.
- A persistence lookup may resolve the exact same `receiptIdentity` under the
  same fence after lost acknowledgment, but it is lookup-only and may never
  reapply effects. This is not an execution retry.

## Canonical serialization and interoperability

The pinned v1 wire profile is UTF-8 RFC 8785 canonical JSON with SHA-256
lowercase-hex digests. The digest excludes its own digest field and includes
every other identity-bearing field, including event identity, payload,
observation use, provenance class, and provenance reference. Reject
noncanonical encodings, unknown/extra fields, duplicate keys, malformed
digests, unsafe numbers, and over-bound payloads. Decimal quantities/prices/
cash are exact decimal strings with explicit units; timestamps are UTC epoch
milliseconds as safe integers. Do not use floating-point account arithmetic,
exponent notation, implicit units, or Unicode normalization not defined by the
pinned serializer.

The companion interface's generated interoperability vectors are authoritative.
The journal/recovery package must verify byte-for-byte and digest compatibility
against commit `a1c1b35656d501e4d2bcc74ae4a717110beca26c`, not choose its own
canonicalization. Identity-bound warmup/provenance fields and all transition,
state, and receipt identities must participate in precisely that pinned
canonicalization.

## M1/M2/M3 handoff

- **M1 inventory and transaction/failure map:** completed independently and
  corrected by the accepted durability review.
- **M2 event/transition alignment:** aligned to the unchanged
  `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0` wire contract at exact companion commit
  `a1c1b35656d501e4d2bcc74ae4a717110beca26c`; no companion-owned wire field is
  redefined here. Reconciliation-resolution receipt schema remains
  **UNSPECIFIED** and requires a separate versioned contract amendment before
  implementation or resolution; this clarification is not claimed to exist in
  the pinned commit.
- **M3 consolidated acceptance:** recovery and serialization matrices are
  documented against that pin, with the reconciliation-schema blocker explicit;
  final Lead acceptance remains pending.

No operational implementation, runtime, database, market-data, provider, or
authority change is authorized by this document. Only the isolated synthetic
test harness specified in
[`SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md`](SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md)
is approved in principle, subject to contract review and an available lane. D2
and operating-choice gates remain unchanged.
