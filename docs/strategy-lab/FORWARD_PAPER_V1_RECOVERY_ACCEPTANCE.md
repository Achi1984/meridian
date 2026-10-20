# Forward-Paper V1 recovery and fault acceptance design

**Status:** documentation-only test design; exact interface binding and final
acceptance are blocked pending Achi1984/meridian#914 M1.

**Interface dependency:** Companion issue #914 / Draft PR #916 owns event,
transition, identity, and wire-digest semantics. PR #916 currently has only its
initial-plan commit `b7321fdd6b07f48f7523b3903cc4c71d97c9045f` and no interface
files. Do not turn the conceptual row/state labels below into executable
fixtures or wire assertions until the exact interface commit is published.
Current handoff: **WAITING_FOR_INTERFACE**.

This is a generated-fault acceptance design, not executable tests, SQL, a
recovery procedure, or a runnable command. It assumes no real market data,
provider connectivity, or deployment behavior. Useful and independently
assessed D2 evidence is required before any implementation; Paper/Live and
operating choices remain separately gated.

## Recovery outcomes and evidence

| Outcome | Required evidence | Required disposition |
| --- | --- | --- |
| `OP_APPLIED` | A validated, durable committed receipt for the exact operation, observation digest, expected prior receipt sequence/state, run/config identity, and fence; account projection and snapshot agree with that receipt sequence. | Return the existing durable result. Do not repeat the account effect or create another receipt. |
| `OP_ABSENT` | An authoritative read of the declared journal establishes no receipt and no attributable account delta; the prior committed sequence/account state are intact and match the exact expected state; the relevant receipt history is complete and integrity-valid. | Record the explicit reconciliation and provenance. Absence alone is not an automatic retry, replay, or repair authorization. Any further attempt requires a separate explicit authorized decision and must still be eligible without replaying a missed event/fill. |
| `OP_CONFLICT` | Durable evidence shows a different digest, run/config, expected state, receipt sequence, account projection, or fence than the operation required, or a stale writer lost a compare-and-set. | Halt the affected run. Preserve all history and account state; do not guess which writer/effect should win. |
| `UNKNOWN` | Available evidence cannot distinguish applied from absent, including ambiguous commit/write failure, unavailable or corrupt storage, incomplete receipt history, or an unverified snapshot. | Retain the active fence, block re-execution, and require explicit authorized reconciliation. Read-only inspection cannot resume or settle it. |

A reconciliation record must preserve, without inventing values: the affected
operation and expected state; observed receipt/account/snapshot evidence
references and digests; selected outcome; decision scope and reason; decision
authority provenance; decision time and its source/basis; prior and resulting
receipt sequence; and fence disposition. Missing evidence stays missing.
Reconciliation is append-only metadata, not a receipt or account mutation.

## Generated fault-test matrix

Use logical row labels only: `Run`, `Observation`, `Claim`, `Proposal`,
`Receipt`, `Snapshot`, `Conflict/Halt`, and `Reconciliation`. `Δ account` means
the account change attributable to the injected operation. “Attempt/fence”
distinguishes a historical fence generation from an active retained fence.
Each test must start from a generated isolated journal and compare durable rows,
state, sequence, attempt/fence, account, and restart inspection. Exact serialized
fields and state names remain subject to #914.

| Fault or case | Expected durable rows/state | Attempt / fence | Account delta and restart expectation |
| --- | --- | --- | --- |
| Identical duplicate after restart, including after a committed transition | Existing records for the operation (observation, claim, proposal, receipt, as applicable); no replacement rows or new claim. Return the prior durable result. | Unchanged; do not issue a new claim/fence. A completed fence remains resolved. | Zero additional delta. Restart returns the same receipt/result. |
| Same observation identity with changed digest, including after restart | Preserve original observation/receipt; append a conflict/halt fact if storage remains writable; halt the run. | No new attempt; retain any unresolved prior fence. | Zero additional delta. Never rewrite or reinterpret the earlier result. |
| Two concurrent claims against the same expected state | Exactly one successful claim; losing claimant rejected as a state/fence conflict. No duplicate proposal or receipt. | Winner consumes one attempt and owns the current fence; loser consumes none. | Zero until winner's atomic commit; never apply two deltas. |
| Stale fence submits proposal or commit after a newer fence exists | Reject stale proposal/commit; preserve the winning claim and receipt sequence. | Stale attempt cannot advance fence; current fence remains authoritative. | Zero stale-writer delta; no stale receipt. |
| Commit succeeds but ACK is lost; restart/retry observes same identity | One proposal and one receipt; duplicate lookup returns that receipt. No new transition rows. | One consumed attempt; committed fence is resolved, not replaced. | Exactly one delta total, not one per ACK. |
| Receipt corruption or truncation before restart inspection | Preserve damaged evidence; fail integrity check and halt. Do not synthesize a missing suffix or receipt. | No new attempt; retain any known unresolved fence. | No new delta. Inspection reports conflict/unknown; no resume. |
| Disk full or write failure before the account+receipt transaction | If rollback and unchanged prior state are authoritatively proven, no receipt/account delta and classify absence; otherwise `UNKNOWN`. | If a claim already committed, its attempt and fence remain; unresolved fence retained. | No inferred delta. No automatic retry even after proven absence. |
| Storage reports failure with commit outcome ambiguous | No fabricated receipt; preserve whatever can be read and mark `UNKNOWN`. | Attempt consumed; fence retained. | Do not apply again. Resolve only with authorized evidence-based reconciliation. |
| Timeout or cancellation before claim | No claim, proposal, receipt, or account update. Fail closed. | No attempt and no fence allocated. | Zero delta; no invocation resumes in background. |
| Timeout or cancellation after claim, before known commit | Claim remains; no committed receipt unless durable evidence proves commit. State is `UNKNOWN` when commit status is ambiguous. | One attempt; active fence retained. | Zero unless `OP_APPLIED` evidence proves one existing delta. Never replay on restart. |
| Late observation or source watermark gap | Preserve the supplied late/gap fact and halt or defer according to the pre-frozen policy; no eligible past event is manufactured. | No new attempt for an ineligible transition; do not release a different unresolved fence. | Zero fill/account delta. No missed-fill backfill after restart. |
| Snapshot sequence or account projection drifts from committed receipts | Read-only verification reports conflict and halts; no repaired snapshot or rewritten receipt. | No new attempt; preserve active fence if unresolved. | Zero repair delta. Do not select snapshot or ledger by guess. |
| Unauthorized resume while an operation is unresolved | Reject; preserve claim, prior records, and unresolved state. Read-only inspection remains read-only. | No new attempt; same active fence remains. | Zero delta; no proposal, receipt, or resumed execution. |
| Required run/config field or explicit invocation limit missing | Reject before claim; do not create an executable run from defaults. | No attempt or fence. | Zero delta and no observation-driven transition. |
| Warmup-only observations | Record only frozen run/config and any separately authorized input provenance; no forward decision/eligible event. | No forward attempt or transition fence. | Zero receipt/account delta; no forward fills, returns, or observation days. |
| Missing mark/price for an account valuation | Preserve mark-unavailable status; do not replace the value with zero or carry a fabricated mark. | No marking attempt/receipt; preserve any unrelated unresolved fence. | No invented valuation/PnL/account delta. Snapshot cannot claim a fresh fully marked state. |
| New policy, source, strategy, or code version in an existing run | Reject identity mutation; preserve the old run. A separately authorized new run is a distinct identity. | No attempt under the old run for changed identity. | Zero delta under the old run; no migration or history rewrite. |

For uncertain write and timeout cases, tests must distinguish a definitively
rolled-back pre-commit transaction from an ambiguous commit. Both forbid an
automatic retry; only the former can support `OP_ABSENT`, and only through the
stated evidence and explicit reconciliation. A receipt must never be fabricated
to make the expected table pass.

## Interface serialization and digest interoperability

These generated cases are mandatory cross-package vectors after #914 publishes
its exact interface. The expected bytes, identity equality, rejection behavior,
and digests must come from that pinned interface; this document does not select
canonical serialization or redefine identity semantics.

| Interoperability case | Required cross-package check |
| --- | --- |
| Same logical envelope produced by each implementation | Both sides agree on the exact interface-defined canonical bytes, observation identity, and digest. |
| Object-member ordering and insignificant JSON whitespace | Confirm whether the pinned format canonicalizes or preserves them; both implementations must produce the same specified outcome. |
| UTF-8, non-ASCII text, escaping, and Unicode normalization distinctions | Compare exact pinned byte encoding and digest behavior; do not normalize implicitly. |
| Missing field versus explicit `null`, booleans versus integers, integer bounds, decimal/floating values, negative zero, and non-finite numbers | Agree on each accepted/rejected type and digest input; reject values not allowed by the pinned contract. |
| Duplicate object keys, malformed encoding, and trailing data | Both implementations reject or handle only as explicitly specified; no parser may silently choose a different identity. |
| Line endings and trailing newline | Match the pinned canonical bytes exactly, including whether a final newline participates in the digest. |
| Observation identity reused with equal bytes versus changed semantic content | Equal identity+digest is a duplicate; changed digest is a conflict. Digest/identity binding details come from #914. |
| Watermark/order values at boundary, absent, duplicate, regressing, and gap cases | Both implementations agree on eligibility and the corresponding rejection/conflict without converting receipt time into source time. |
| Receipt and snapshot sequence boundaries | Cross-check sequence representation, integer limits, and snapshot-to-receipt binding under the same interface version. |

No compatibility claim can be made until both packages cite the same exact M1
commit and pass shared generated vectors. A digest establishes byte/content
consistency only within its stated input definition; it does not establish
source authenticity, authorization, or global exactly-once delivery.

## Prerequisite and stop matrix

| Gate | Required before advancing | Current status |
| --- | --- | --- |
| Interface M1 | Exact companion commit defining wire fields, identity, transition, canonicalization, and bounds. | **WAITING_FOR_INTERFACE**; #916 has no interface files yet. |
| Interface compatibility M2 | Shared generated serialization, digest, identity, and transition vectors pass against that exact commit. | Blocked on M1. |
| Final M3 acceptance | Complete traceability from contract to fault matrix; Lead's independent review; no unresolved contradiction or missing required case. | Blocked on M2 and independent review. |
| Evidence gate | Useful D2 evidence independently assessed before Forward-Paper implementation. | Not established by this specification. |
| Operating choices | Explicit owner-approved strategy/source/product, run period, cost/risk, timing, bounds, and reconciliation authority. | Required choices unset. |
| Source capability | A separately verified source adapter provides the actual fields needed by the eventual contract. Gateway's current mapping lacks `open`, volume, and trades. | Unverified; no usable full OHLC assumed. |
| Storage/clock/deployment | Declare and independently verify transaction durability, crash consistency, monotonic-clock behavior, and deployment boundary. | Unverified. |

Until the blocked gates are resolved, this acceptance design authorizes no
implementation, test execution, data read, database creation, runtime,
workflow, provider, credential, spending, recovery, Paper, or Live activity.
