# Forward-Paper V1 recovery and fault acceptance design

**Status:** documentation-only acceptance design, aligned to the accepted event
interface; final consolidated Lead acceptance remains pending. Implementation is
blocked pending independently assessed D2 evidence and separate owner
authorization.

**Canonical interface:** `MERIDIAN-FORWARD-PAPER-EVENT/1.0.0`, accepted
companion commit
[`a1c1b35656d501e4d2bcc74ae4a717110beca26c`](https://github.com/Achi1984/meridian/commit/a1c1b35656d501e4d2bcc74ae4a717110beca26c),
specifically the
[contract specification at that commit](https://github.com/Achi1984/meridian/blob/a1c1b35656d501e4d2bcc74ae4a717110beca26c/docs/strategy-lab/FORWARD_PAPER_V1_CONTRACT_SPEC.md)
§§4–8 and
[reducer acceptance design at that commit](https://github.com/Achi1984/meridian/blob/a1c1b35656d501e4d2bcc74ae4a717110beca26c/docs/strategy-lab/FORWARD_PAPER_V1_REDUCER_ACCEPTANCE.md).
The companion owns all wire fields and semantics; this document adds no
alternate interface.

This is a generated-fault acceptance design, not executable tests, SQL, a
recovery procedure, or a runnable command. It assumes no real market data,
provider connectivity, or deployment behavior. Useful and independently
assessed D2 evidence is required before any implementation; Paper/Live and
operating choices remain separately gated.

## Recovery outcomes and evidence

| Outcome | Required evidence | Required disposition |
| --- | --- | --- |
| `OP_APPLIED` | The atomic account-effect, committed-receipt, sequence-advance, and winning-claim fence-resolution transaction is durably evidenced for the exact operation, observation digest, expected prior state/sequence, run/config identity, and historical fence token. No later snapshot is required. | Return the existing durable result. Do not repeat the account effect or create another receipt. |
| `OP_ABSENT` | An authoritative read of the declared journal establishes no committed receipt and no attributable account delta; the prior committed sequence/account state are intact and match the exact expected state; the relevant receipt history and atomic account/sequence records are complete and integrity-valid. A snapshot is not required evidence. | Record the explicit reconciliation and provenance. Absence alone is not an automatic retry, replay, or repair authorization. Any further attempt requires a separate explicit authorized decision and must still be eligible without replaying a missed event/fill. |
| `OP_CONFLICT` | Durable evidence shows a changed digest for an already-bound identity, impossible/contradictory receipt sequence or history, or another demonstrated run/config/history integrity contradiction. A normal compare-and-set loser is not this outcome. | Halt the affected run. Preserve all history and account state; do not guess which writer/effect should win. |
| `UNKNOWN` | Available evidence cannot distinguish whether the atomic account/receipt/sequence/fence-resolution transaction applied, including ambiguous commit/write failure, unavailable or corrupt authoritative storage, or incomplete receipt history. Optional snapshot damage alone does not make this transaction outcome unknown. | Retain any active fence and its historical token, block re-execution, and require explicit authorized reconciliation. Read-only inspection cannot resume or settle it. |

A reconciliation record must preserve, without inventing values: the affected
`receiptIdentity`, `transitionIdentity`, `expectedStateIdentity`, observed
`stateIdentity`/receipt/account evidence references and digests, selected
recovery outcome, decision scope and exact reason, decision authority
provenance, decision time and its source/basis, prior and resulting receipt
sequence, and historical/active fence disposition. Bind the companion
`interfaceVersion` and run/config/event identities. Missing evidence stays
missing. Reconciliation is append-only metadata, not a receipt or account
mutation.

## Proposal, acknowledgment, state, and reason mapping

| Condition | Proposal disposition | Persistence acknowledgment / receipt disposition | Resulting state | Pinned reason |
| --- | --- | --- | --- | --- |
| Exact event identity and canonical payload digest already committed | `IDEMPOTENT_NOOP` | No new effect/receipt; return the exact prior committed result | Same prior state | `DUPLICATE_IDEMPOTENT` |
| Same event identity has another digest or conflicting identity-bearing provenance | `HALT` | Durable conflict/halt receipt if persistence is available; no dependent effect | `HALTED` | `IDENTITY_CONFLICT` |
| Compare-and-set expected state/fence does not match (including a concurrent loser) | `REJECT` | `DURABLE_REJECTED` / `REJECTED`, or no receipt if proposal was not submitted | Prior committed state unchanged; current winner remains eligible | `STATE_IDENTITY_MISMATCH` |
| Unsupported `interfaceVersion` or missing required identity | `HALT` for version conflict; `REJECT` for absent identity | Durable rejection only; no dependent state/account effect | `HALTED` or prior state unchanged | `VERSION_MISMATCH` or `IDENTITY_MISSING` |
| Proposal is valid and durable commit succeeds | `PROPOSE` | `DURABLE_COMMITTED` / `COMMITTED` | Exact contract-defined proposed state | No rejection reason |
| Exact persistence result cannot be established | `PROPOSE` | `UNKNOWN` / `UNKNOWN` | `UNKNOWN`; keep active fence | `PERSISTENCE_UNKNOWN` |
| Required frozen configuration is missing or unset | `HALT` | No claim; durable halt evidence only if the interface admission path provides it | `HALTED` | `CONFIGURATION_INCOMPLETE` |
| Invalid, future, unclosed, reordered, stale, gapped, misaligned, or missing input | `REJECT` or `HALT` according to the frozen terminal policy | `DURABLE_REJECTED` / `REJECTED` if durably recorded; no accepted watermark/effect | State unchanged or `HALTED` only under the selected policy | Exact matching code: `PAYLOAD_INVALID`, `EVENT_FUTURE`, `CANDLE_UNCLOSED`, `EVENT_REORDERED`, `CADENCE_GAP`, `UNIVERSE_MISALIGNED`, `SOURCE_STALE`, or `MISSING_REQUIRED_FIELD` |
| Fill candidate is not proven strictly later than its decision ACK | `REJECT` | `DURABLE_REJECTED` / `REJECTED` if persisted | `ELIGIBLE_FILL` remains unchanged; no fill | `LATE_OR_PAST_EVENT` |
| Fill candidate arrives before decision persistence is durably acknowledged | `REJECT` | `DURABLE_REJECTED` / `REJECTED` if persisted | `PENDING_DURABLE_DECISION`; no eligibility/fill | `DECISION_NOT_DURABLE` |
| Fill would violate balance, risk, cost, or exposure invariant | `HALT` | Commit halt/reason only; no partial account update | `HALTED` | Exact applicable code: `BALANCE_INVARIANT`, `RISK_LIMIT`, `COST_POLICY_INCOMPLETE`, or `COST_DUPLICATE` |
| Configured expiry is durably observed without an eligible fill | `PROPOSE` | `DURABLE_COMMITTED` / `COMMITTED` no-fill transition | `OBSERVED` or `HALTED` per frozen expiry action | `MISSED_OR_EXPIRED` |
| Mark is missing/stale or required valuation is unavailable | `REJECT` or committed unavailable-mark transition under interface policy | No fabricated mark; any committed mark-availability receipt uses `COMMITTED` | `MARKED` with `equity=UNAVAILABLE`, or unchanged | `MARK_UNAVAILABLE` |
| An event is valid `WARMUP_ONLY` historical/backfill/replay input | `PROPOSE` for warmup-only progress only; never for a forward decision/fill | A warmup observation receipt may be durable; no forward performance receipt/effect | `WARMUP` or unchanged `MARKED` | No rejection reason unless provenance/use conflicts (`PAYLOAD_INVALID`/`IDENTITY_CONFLICT`) |

`DURABLE_COMMITTED`, `DURABLE_REJECTED`, and `UNKNOWN` are persistence
acknowledgments; `COMMITTED`, `REJECTED`, and `UNKNOWN` are receipt
`transitionDisposition` values; and `PROPOSE`, `IDEMPOTENT_NOOP`, `REJECT`,
and `HALT` are proposal dispositions. An acknowledgment cannot be substituted
for a proposal disposition or reason. Use only the exact closed reason
vocabulary in the pinned contract §8; this mapping adds no codes.

The generated happy-path sequence must exercise the exact pinned lifecycle:
separately admitted run with durable `RUN_ADMITTED` fence; identity- and
provenance-bound prospective observation after that fence; `OBSERVED` →
`VALIDATED` → `PENDING_DURABLE_DECISION`; exact decision `DURABLE_COMMITTED`;
then `ELIGIBLE_FILL` only when its event is proven strictly later than that
decision's durable acknowledgment; and `MARKED` only after the fill/account
receipt commits. Decision inputs precede their consuming decision but need not
be later than that decision's receipt. From committed `MARKED`, another valid
forward observation begins `OBSERVED` and preserves the exact prior
`stateIdentity`, account, cash, holdings, costs, and parent receipt. A `NO_ACTION`
decision returns to `OBSERVED` without fill/account effect. Warmup/backfill
remains `WARMUP_ONLY`; it cannot enter the forward cycle or count as performance.
An expiry no-fill transition uses `MISSED_OR_EXPIRED` only after its explicitly
selected boundary is durably observed, never merely because no fill arrived.

## Generated fault-test matrix

Use the exact companion states `WARMUP`, `OBSERVED`, `VALIDATED`,
`PENDING_DURABLE_DECISION`, `ELIGIBLE_FILL`, `MARKED`, `HALTED`, and `UNKNOWN`.
Use its closed `TransitionProposal.disposition` values
`PROPOSE`/`IDEMPOTENT_NOOP`/`REJECT`/`HALT`, persistence acknowledgments
`DURABLE_COMMITTED`/`DURABLE_REJECTED`/`UNKNOWN`, receipt
`transitionDisposition` values `COMMITTED`/`REJECTED`/`UNKNOWN`, and closed
reason vocabulary. These are distinct fields with distinct meanings; do not
substitute one enum for another.

`Δ account` means the account change attributable to the injected operation.
“Attempt/fence” distinguishes the immutable historical token from whether its
claim is currently active or atomically resolved. Each generated case must
compare durable `runIdentity`, `eventIdentity`/`payloadDigest`,
`expectedStateIdentity`, `proposedStateIdentity`, `receiptIdentity`,
`transitionIdentity`, `stateIdentity`, `parentStateIdentity`, sequence,
attempt/fence, account, acknowledgment and restart inspection under the exact
pinned interface. No fixture may locally redefine those wire fields.

| Fault or case | Expected durable rows/state | Attempt / fence | Account delta and restart expectation |
| --- | --- | --- | --- |
| Forward decision-input observation with causal run-start proof | Identity/provenance-bound `FORWARD_CANDIDATE` is admitted only after `RUN_ADMITTED`; it advances through `OBSERVED` → `VALIDATED` → `PENDING_DURABLE_DECISION`. The input precedes its consuming decision but need not be later than that decision's durable ACK. | Each proposal compares the exact expected state; a commit resolves its winning fence. | No fill before decision `DURABLE_COMMITTED`; decision-input timing is not tested against the later decision ACK. |
| Two decision/fill cycles | First committed fill reaches `MARKED`; a new valid forward observation advances to `OBSERVED`, then a second decision and strictly later fill reach `MARKED` again. Receipts chain exact `parentStateIdentity`/`stateIdentity`. | Each cycle has its own committed proposal/receipt; no attempt is reused for a different proposal. | Second account state equals first committed account plus only the second fill/cost deltas; no capital reset, position loss, or duplicate first effect. |
| Identical duplicate after restart, including after a committed transition | Preserve existing records and return the same committed receipt/state. `IDEMPOTENT_NOOP`; reason `DUPLICATE_IDEMPOTENT`. | No new attempt/fence; the winning claim was resolved in its commit and its token remains historical. | Zero additional delta. Restart returns the same `receiptIdentity`/`stateIdentity`. |
| Same `eventIdentity` with changed `payloadDigest`, including after restart | Preserve original observation/receipt; `HALTED`, disposition `HALT`, reason `IDENTITY_CONFLICT`; retain conflict evidence. | No new attempt; do not release an unresolved fence. | Zero additional delta. Never rewrite or reinterpret earlier result. |
| Two concurrent claims against the same `expectedStateIdentity` | One succeeds. Losing compare-and-set is a no-effect rejection, reason `STATE_IDENTITY_MISMATCH`; it is not a run-wide conflict. Winner can continue while its expected state/fence remain current. | Winner consumes one attempt and owns active fence; loser consumes none and receives no fence. | Zero until winner's atomic commit; never apply two deltas. Losing claimant does not halt/invalidate winner. |
| Stale fence submits proposal or commit after its claim was resolved | Reject proposal with no account, receipt, sequence, or current-claim change; ordinary stale-fence/state compare rejection, not run-wide `IDENTITY_CONFLICT`. | Old attempt/token remain historical and resolved; current claim/fence unchanged. | Zero stale-writer delta; no stale receipt. |
| Commit succeeds but ACK is lost; restart/lookup observes same identity | Persistence outcome is `UNKNOWN` to the caller until exact receipt lookup; then established `OP_APPLIED` from the committed receipt. One proposal/receipt, disposition `COMMITTED`; no new transition rows. | One attempt; account, receipt, sequence, and winning-claim resolution committed atomically; historical token retained. | Exactly one delta; no snapshot write needed. No retry that reapplies effects. |
| Receipt corruption or truncation before restart inspection | Preserve damaged evidence; `UNKNOWN` if commit outcome cannot be distinguished; use `OP_CONFLICT` only when authoritative evidence proves contradictory history. No synthesized suffix/receipt. | No new attempt; retain any known active fence. | No new delta. No resume; exact reason is `PERSISTENCE_UNKNOWN` for ambiguous/incomplete durable evidence, or `IDENTITY_CONFLICT` for a proven identity/history contradiction. |
| Disk full or write failure before the account+receipt transaction | If rollback/prior state are authoritatively proven, `DURABLE_REJECTED`/`REJECTED`, reason `PERSISTENCE_REJECTED`; otherwise persistence `UNKNOWN`. | If claim committed, its attempt/token remain and active fence remains unresolved unless the outcome is durably resolved. | No inferred delta. No automatic retry even after `OP_ABSENT`. |
| Storage reports failure with commit outcome ambiguous | No fabricated receipt; persistence acknowledgment `UNKNOWN`, state `UNKNOWN`, reason `PERSISTENCE_UNKNOWN`. | Attempt consumed; active fence retained. | Do not apply again. Resolve only with authorized evidence-based reconciliation. |
| Timeout/cancellation before claim | No proposal or receipt; run's last committed state remains unchanged. If a bounded proposal was rejected, reason `BOUND_EXCEEDED`; no claim. | No attempt/fence allocated. | Zero delta; no background continuation. |
| Timeout/cancellation after claim, before known commit | If ambiguous, persistence `UNKNOWN`, state `UNKNOWN`, reason `PERSISTENCE_UNKNOWN`; if explicit durable rejection, `DURABLE_REJECTED` and unchanged state. | One attempt; active fence retained while uncertain. | Zero unless exact commit evidence proves one existing delta. Never replay on restart. |
| Late observation or source watermark gap | Late fill candidate is rejected with `LATE_OR_PAST_EVENT`; cadence gap with `CADENCE_GAP`. State unchanged or `HALTED` under the explicitly frozen terminal policy. No past event is made eligible. | No attempt for ineligible transition; do not release another unresolved fence. | Zero fill/account delta. No missed-fill backfill. |
| Missing/malformed candle `open` or incomplete OHLC | Reject with `MISSING_REQUIRED_FIELD`; no close-to-open synthesis and no accepted watermark advance. | No fill attempt/fence for the invalid price input. | Zero delta. No fill is inferred from close, cache, replay, or a retrospective next-bar position. |
| Configured expiry boundary is durably observed without an eligible fill | Commit the no-fill transition with reason `MISSED_OR_EXPIRED`; state becomes `OBSERVED` or `HALTED` according to frozen expiry action. Absence alone does not prove expiry. | Resolve only the claim associated with that committed no-fill transition; do not reopen the old fill proposal. | Zero fill/account delta; preserve the missed opportunity without backfill. |
| Optional snapshot lags the committed head but matches its named receipt prefix | Retain as a valid older checkpoint; it does not describe latest head and is not corruption. State remains the authoritative committed state. | No new attempt; claim/fence unchanged. | No new delta. Do not advance/rewrite snapshot automatically. |
| Optional snapshot is ahead of head or fails validation against its named prefix | Mark only snapshot unusable; do not infer a conflict in the authoritative commit solely from derived-checkpoint damage. Do not auto-repair. | No new attempt; claim/fence unchanged. | No new delta. Determine `OP_APPLIED`/`OP_ABSENT` from atomic authoritative records; if those are corrupt/ambiguous, use `OP_CONFLICT`/`UNKNOWN` supported by evidence. |
| Unauthorized resume while an operation is unresolved | Reject; keep state `UNKNOWN`, reason `RECONCILIATION_REQUIRED`; read-only inspection remains read-only. | No new attempt; same active fence remains. | Zero delta; no proposal, receipt, or resumed execution. |
| Required run/config field or explicit invocation limit missing | State `HALTED`, disposition `HALT`, reason `CONFIGURATION_INCOMPLETE`; reject before claim. | No attempt or fence. | Zero delta and no observation-driven transition. |
| Warmup-only/backfill/replay observations | Preserve identity-bound `observationUse=WARMUP_ONLY`, provenance and receipt; state `WARMUP` or unchanged `MARKED`; no forward decision. | No forward attempt/transition fence. | Zero receipt/account/performance delta; no forward fills, returns, or observation-day count. |
| Warmup event identity is reclassified as forward | Same `eventIdentity` is resent with changed digest-bound `observationUse`/provenance. Preserve original event; state `HALTED`, disposition `HALT`, reason `IDENTITY_CONFLICT`. | No second attempt; retain any unresolved fence. | Zero delta; no warmup-to-forward reclassification or performance count. |
| Missing/stale mark for account valuation | State may remain `MARKED`; mark/equity availability is explicit and reason `MARK_UNAVAILABLE`; never substitute zero or fabricated/carry-forward mark. | No fill attempt; preserve unrelated unresolved fence. | No invented valuation/PnL/account delta; `equity=UNAVAILABLE` as applicable. |
| New policy, source, strategy, or code version in an existing run | Reject identity mutation; state `HALTED`, reason `IDENTITY_CONFLICT` where an identity was reused inconsistently. A separately authorized new run has distinct identities. | No attempt under old run for changed identity. | Zero delta under old run; no migration/history rewrite. |

For uncertain write and timeout cases, tests must distinguish a definitively
rolled-back pre-commit transaction from an ambiguous commit. Both forbid an
automatic retry; only the former can support `OP_ABSENT`, and only through the
stated evidence and explicit reconciliation. A receipt must never be fabricated
to make the expected table pass. Optional snapshots are not transaction
participants: a valid older prefix is lag, and later snapshot corruption cannot
undo or obscure an otherwise evidenced atomic commit.

## Pinned interface serialization and digest interoperability

These generated cases are mandatory cross-package vectors for
`MERIDIAN-FORWARD-PAPER-EVENT/1.0.0` at exact commit
`a1c1b35656d501e4d2bcc74ae4a717110beca26c`. Its UTF-8 RFC 8785 canonical JSON
and SHA-256 lowercase-hex digest rules are authoritative; the expected bytes,
identity equality, and rejection behavior must be read from that exact
contract, not selected or redefined by this journal package.

| Interoperability case | Required cross-package check |
| --- | --- |
| Same logical envelope produced by each package | Identical UTF-8 RFC 8785 canonical bytes and SHA-256 lowercase-hex digest; digest excludes its own digest field and includes all other identity-bearing fields. |
| Object-member order and JSON whitespace | Canonical output is byte-identical under RFC 8785; no local serializer-specific wire variant. |
| UTF-8, escaping, and Unicode normalization distinctions | Match pinned RFC 8785 bytes; do not normalize Unicode implicitly. Distinct code-point sequences remain distinct input. |
| Missing versus null, unknown/extra fields, unknown enums, duplicate keys | Reject per closed schema; no ignored field or parser-dependent identity. |
| Numeric and decimal fields | Timestamps are UTC epoch-ms safe integers; decimal price/quantity/cash values are exact strings with explicit units. Reject unsafe numbers, exponent notation for decimal strings, NaN/infinity, coercion, and unsupported forms. |
| Digest membership | Verify `payloadDigest` covers every identity-bearing field, including event identity and observation-use/provenance/reference, while excluding only its own digest field. |
| Warmup/provenance identity | `observationUse`, `provenanceClass`, and `provenanceReference` are present and digest-bound; reclassification under the same event identity conflicts. Historical/replay input cannot be a forward candidate. |
| Event identity reused with same versus changed digest | Same `eventIdentity`+digest yields `IDEMPOTENT_NOOP`; changed digest yields `IDENTITY_CONFLICT` and `HALTED`. Different event IDs are not silently collapsed by equal payload. |
| Decision-input versus fill event ordering | Forward inputs follow `RUN_ADMITTED` causal fence and precede the consuming decision. Only the fill/price event must additionally be strictly later than the exact decision's durable ACK, proven by the pinned barrier/clock mapping. |
| Proposal and state identity chain | Compare the exact `TransitionProposal` fields, `expectedStateIdentity`, `proposedStateIdentity`, receipt/transition identities, parent/state identities and durable receipt bindings. A compare-and-set loser is a no-effect rejection, not a run-wide conflict. |
| Duplicate, rejected, committed, unknown persistence outcomes | Match proposal disposition, persistence acknowledgment, receipt disposition, state, exact reason, active/historical fence, and account effect independently; an ACK loss does not replay. |
| Snapshot behavior | Test optional lagging checkpoint matching its committed prefix versus ahead/mismatching checkpoint; neither may redefine the atomic commit outcome. |

The documents now cite the same exact M1 interface commit and the matrix
specifies shared generated vectors. This is a documentation compatibility
alignment, not evidence that executable serializers or shared tests passed. A
digest establishes byte/content consistency only within its stated input
definition; it does not establish source authenticity, authorization, or
global exactly-once delivery.

## Prerequisite and stop matrix

| Gate | Required before advancing | Current status |
| --- | --- | --- |
| Interface M1 | Exact companion commit defining wire fields, identity, transition, canonicalization, and bounds. | Accepted at `a1c1b35656d501e4d2bcc74ae4a717110beca26c`. |
| Interface compatibility M2 | Journal and recovery documentation bind the same version/commit and align identities, provenance/warmup, causality, states, dispositions, reason mapping, serialization, and recovery acceptance. | Documentation alignment complete at this revision; executable vectors are future implementation acceptance, not run here. |
| Final M3 acceptance | Lead's consolidated review of both packages and no unresolved spec contradiction. | Pending Lead confirmation; no interface blocker remains. |
| Evidence gate | Useful D2 evidence independently assessed before Forward-Paper implementation. | Not established by this specification. |
| Operating choices | Explicit owner-approved strategy/source/product, run period, cost/risk, timing, bounds, and reconciliation authority. | Required choices unset. |
| Source capability | A separately verified source adapter provides the actual fields needed by the eventual contract. Gateway's current mapping lacks `open`, volume, and trades. | Unverified; no usable full OHLC assumed. |
| Storage/clock/deployment | Declare and independently verify transaction durability, crash consistency, monotonic-clock behavior, and deployment boundary. | Unverified. |

Until remaining gates are resolved, this acceptance design authorizes no
implementation, test execution, data read, database creation, runtime,
workflow, provider, credential, spending, recovery, Paper, or Live activity.
