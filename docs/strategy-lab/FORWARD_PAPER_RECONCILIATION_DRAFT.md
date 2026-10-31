# Forward Paper reconciliation amendment — draft 2

**Status: PROPOSED_NOT_ADOPTED. Documentation and generated examples only.**

Proposed interface: `MERIDIAN-FORWARD-PAPER-RECONCILIATION/0.1.0-draft.2`.
This is a separate recovery-control envelope, not an extension of the closed
`MERIDIAN-FORWARD-PAPER-EVENT/1.0.0` event, proposal, receipt or reason enums.
Merging this draft would publish a proposal; it would not adopt the amendment,
authorize its implementation, resolve an operation or activate Paper.

## 1. Baseline and unresolved gates

Prepared against main `dcfd520c02987c546fc5d23db4a0491cc4a3d935` and:

- [Event contract](FORWARD_PAPER_V1_CONTRACT_SPEC.md), especially §§3, 6, 8, 10.
- [Journal specification](FORWARD_PAPER_V1_JOURNAL_SPEC.md).
- [Recovery acceptance](FORWARD_PAPER_V1_RECOVERY_ACCEPTANCE.md).
- [Synthetic infrastructure boundary](SYNTHETIC_PAPER_INFRASTRUCTURE_V1.md).

The unchanged event-wire historical pin remains
`a1c1b35656d501e4d2bcc74ae4a717110beca26c`. It does not contain this draft.
The existing v1 contract still has no adopted reconciliation receipt. Its
`UNKNOWN` fence remains binding. The twelve operating-choice groups remain
`REQUIRED_UNSET`; this draft adds no group and chooses no authority, storage,
provider, instrument, strategy, capital, cost, risk or timing default.

The proposed amendment addresses one problem: a caller cannot safely infer
whether a transaction committed after losing its acknowledgment. Recovery may
classify and record evidence; it must never execute the original proposal.
Storage guarantees, source-time proof, independently assessed qualification,
operating choices and a separate bounded operational admission remain gates.

## 2. Two paths, with no second financial effect

**Exact-result lookup remains the existing v1 path.** Finding the exact original
committed receipt, its atomic account/state/sequence result and its resolved
historical fence returns that same result. No recovery receipt is necessary,
no original receipt is appended again, and no fee or account delta is applied.
Finding only a snapshot, a receipt identifier, a hash or an ACK is insufficient.

**The proposed resolution path changes recovery control only.** A separately
authorized resolver would evaluate a bounded immutable evidence set and
atomically append a recovery receipt plus its recovery-control disposition.
It would not change cash, holdings, marks, valuation, original event history,
original transition receipts or original committed sequence. The narrow
permitted fence change is to seal an authoritatively absent original attempt
as permanently unable to commit; it is never reused or removed from history.

Resolution is not resumption. Every proposed outcome leaves the affected run
administratively blocked. Even a proven absent operation must not be replayed
or backfilled. A later run/attempt needs its own explicit authority, fresh
state/input validation and applicable causal/expiry checks. This amendment
does not define that authorization or a start/resume API.

## 3. Encoding, identity and exact closed schemas

Use UTF-8 RFC 8785 canonical JSON and SHA-256 lowercase hexadecimal digests.
Every object below is closed: required fields cannot be omitted, unknown
fields/enums and duplicate JSON keys reject, and no coercion is allowed.
`digest` always means 64 lowercase hexadecimal characters. `id` means a
nonempty opaque string under the separately reviewed finite byte bounds.
Counters are nonnegative safe integers; local times are UTC epoch-ms safe
integers. No money or price appears in a recovery-control envelope.

`Ref = {identity: id, digest: digest}` binds immutable bytes, not their truth or
authority. `Fence = {attemptIdentity: id, generation: positive safe integer}`.
The original operation retains its own v1 identities, not a newly minted
replacement identity. Canonical byte/digest interoperability vectors must be
independently supplied before any executable implementation is accepted.

### 3.1 Resolution proposal

| Required field | Exact type and binding |
| --- | --- |
| `interfaceVersion` | Literal proposed interface above. |
| `resolutionIdentity` | `id`, stable for this exact proposal only. |
| `runIdentity`, `accountIdentity` | `id`; exact original run and isolated account. |
| `configurationIdentity` | `Ref`; exact immutable original configuration. |
| `original` | Closed object specified below. |
| `expectedControl` | Closed object specified below. |
| `authority` | Closed object specified below. |
| `evidence` | Nonempty ordered array of evidence items specified below. |
| `evidenceSetDigest` | Digest of canonical complete `evidence` array. |
| `proposedOutcome` | `OP_APPLIED`, `OP_ABSENT`, `OP_CONFLICT` or `UNKNOWN`. |
| `requestedAtLocalMs` | Local observation time; never source time or proof. |
| `proposalDigest` | Digest of the complete proposal excluding only this field. |

`original` contains exactly:

| Field | Type |
| --- | --- |
| `eventIdentity` | Unchanged v1 tuple object: `sourceIdentity`, `sourceStream`, `productIdentity`, `sourceEventId`, each `id`. |
| `payloadDigest` | Digest of complete original event bytes under the v1 rules. |
| `transitionProposal` | `Ref` to immutable original v1 proposal bytes. |
| `receiptIdentity` | `id`, the original expected transition receipt. |
| `expectedStateIdentity`, `proposedStateIdentity` | Exact original state identities, each `id`. |
| `expectedCommittedSequence` | Original prior committed sequence, safe integer. |
| `fence` | Original `Fence`, never a fresh execution claim. |

`expectedControl` contains exactly `controlIdentity: Ref`,
`recoverySequence: safe integer`, `journalHeadIdentity: Ref`,
`committedSequence: safe integer`, `accountStateIdentity: Ref`, and
`fenceDisposition: "ACTIVE_UNRESOLVED" | "RESOLVED_COMMITTED"`.
These values describe the authoritative recovery view the resolver inspected.
They are compared together at publication; original expected state and current
observed state are different fields and must not be confused.

`authority` contains exactly `authorityIdentity: Ref`, `grantIdentity: Ref`,
`policyIdentity: Ref`, and `evidenceVerifierIdentity: Ref`. The grant must
explicitly bind the exact run, account, original operation/fence, proposed
outcome, authorization binding digest, permitted evidence kinds and immutable
verifier implementation. The authorization binding digest is SHA-256 of the
canonical proposal with `authority.grantIdentity`, `requestedAtLocalMs` and
`proposalDigest` omitted; the remaining authority identity, policy and verifier
are included. This exclusion prevents a circular grant/proposal hash: the
completed proposal then includes the immutable grant reference and its own
full digest. The grant cannot authorize a changed outcome, evidence, expected
control, resolver identity or original operation. The grant is evaluated against an independently authenticated
authority registry/policy selected under the existing `reconciliationAuthority`
choice; a caller-supplied flag, name, digest or self-signed assertion cannot
establish authority. Revocation and grant validity must be rechecked at commit.
The registry, authentication mechanism and validity policy are unselected;
their absence blocks implementation and resolution.

### 3.2 Evidence item

Each item contains exactly `kind`, `reference: Ref`, `journalIdentity: Ref`,
`verifierIdentity: Ref`, `observedAtLocalMs`, and `bindingDigest`.
`kind` is one of `COMMITTED_TRANSACTION`, `SEALED_ABSENCE`,
`INTEGRITY_CONTRADICTION`, or `UNAVAILABLE_INSPECTION`.
`bindingDigest` covers canonical `{runIdentity, accountIdentity,
configurationIdentity, original, expectedControl}` from the proposal.
Every referenced evidence record must be retrievable and verified within the
declared bounds. An `UNAVAILABLE_INSPECTION` record may completely describe an
incomplete inspection; it does not make the unavailable original records complete. The evidence reference contains no URL, credentials or raw
account payload. Verification does not dereference arbitrary caller URLs.

Evidence kinds name proof obligations, not a selected storage format:

- `COMMITTED_TRANSACTION`: exact original receipt bytes and digest; matching
  event/config/proposal/state identities; atomically committed account result,
  sequence increment and resolved historical fence. Partial records fail.
- `SEALED_ABSENCE`: complete integrity-valid authoritative history through the
  expected head; original prior account/sequence intact; no original receipt
  or attributable delta; and storage proof that the active original writer is
  excluded and cannot commit after the absence check. An empty lookup, timeout,
  rollback assertion from a client or missing file is not such proof.
- `INTEGRITY_CONTRADICTION`: authoritative incompatible records for the same
  bound identity or impossible committed history. Normal stale-state/CAS
  contention, a lagging snapshot or a missing optional snapshot is not this.
- `UNAVAILABLE_INSPECTION`: bounded reason and exact attempted scope sufficient
  to record that classification remains unknown; never proves absent/applied.

Storage-specific evidence schemas and authenticity verification need separate
review. Until selected and verified, these obligations cannot be discharged.

### 3.3 Whole-evidence classification and write eligibility

Evaluate the complete bound evidence set and required authoritative scope; never
select a favorable subset. The verifier must account for every item and reject
an unverified reference or an unverifiable evidence-set boundary. No caller can
suppress a known contradictory authoritative record by omitting it from the
array. Storage proof must establish complete coverage for applied/absent claims.
A hash or a verified subset cannot prove that coverage.

Apply the following precedence to the exact same original operation:

1. Any verified authoritative integrity contradiction takes precedence over an
   otherwise apparently applied or absent result. A valid committed transaction
   and a valid absence assertion for that same operation are themselves a
   contradiction, regardless of their declared evidence kinds. Classification
   is `OP_CONFLICT`; never choose a preferred record or hide the contradiction
   as `UNKNOWN`.
2. With no contradiction and complete required scope, exact authoritative
   atomic commit evidence yields `OP_APPLIED`. Unavailable optional snapshots
   do not change that result. Missing evidence needed to rule out a relevant
   contradiction is not optional and prevents this classification.
3. With no contradiction and complete required scope, the full absence proof
   including serialized writer exclusion yields `OP_ABSENT`.
4. Otherwise, verified inspection evidence that cannot establish an outcome
   yields `UNKNOWN`. It is not a fallback that can conceal a proven conflict.

The independently determined classification must equal `proposedOutcome`.
Mismatch rejects with `EVIDENCE_UNPROVEN` and no write; the system may report the
supported classification read-only but cannot change a signed proposal or its
grant to fit it. Evidence of an unproven claim is not a verified contradiction.

Classification is separate from permission and ability to record it. Every
recorded outcome, including `UNKNOWN` and `OP_CONFLICT`, requires a trustworthy
current control record, account-state identity, committed sequence, journal
head and fence disposition, authenticated mutation authority and a verified
atomic CAS boundary. An incomplete original-operation history may justify an
`UNKNOWN` classification while that control/account boundary is still verified.
If the control/account/fence boundary itself is missing, corrupt, contradictory
or unverified, **no durable recovery receipt may be fabricated or appended**.
Do not seal a fence, advance a sequence or choose a replacement account Ref.
Preserve the existing block and return read-only `RESOLUTION_UNKNOWN`; any
observed conflict remains diagnostic evidence, not a successful durable
`CONFLICT_BLOCKED` write. An unproven mutation grant instead rejects with
`AUTHORITY_UNPROVEN`. This draft supplies no repair procedure for either case.

### 3.4 Durable recovery receipt

The receipt contains exactly:

| Field | Type / invariant |
| --- | --- |
| `interfaceVersion` | Same proposed interface literal. |
| `resolutionIdentity`, `proposalDigest` | Exact proposal binding. |
| `runIdentity`, `accountIdentity`, `configurationIdentity` | Exact proposal identities. |
| `original` | Exact full `original` object from the proposal. |
| `authority`, `evidenceSetDigest` | Exact approved authority/evidence binding. |
| `previousControlIdentity` | Exact proposal `expectedControl.controlIdentity`. |
| `previousRecoverySequence`, `recoverySequence` | Expected sequence and expected + 1. |
| `outcome` | Exact verified `proposedOutcome`; never silently downgraded/upgraded. |
| `controlDisposition` | Mapping in section 4 only. |
| `originalResult` | `Ref` to original committed receipt for `OP_APPLIED`; literal `"UNAVAILABLE"` for all other outcomes. |
| `accountStateIdentityBefore`, `accountStateIdentityAfter` | Equal `Ref` values, both matching the current authoritative account state. |
| `committedSequenceBefore`, `committedSequenceAfter` | Equal safe integers; recovery appends no original transition. |
| `fenceDispositionBefore`, `fenceDispositionAfter` | Mapping in section 4 only. |
| `resumeAuthorized`, `retryAuthorized` | Both literal `false`. |
| `durableAtLocalMs` | Persistence-assigned local time, not caller-assigned proof. |
| `receiptDigest` | Digest of complete receipt excluding only this field. |

The new control identity is the `Ref` whose identity is `resolutionIdentity`
and digest is `receiptDigest`. It is derived after commit serialization, not a
self-referential receipt field. A successful outer acknowledgment contains
exactly `{status:"RESOLUTION_RECORDED", receipt:<complete receipt>}`. An
ambiguous write, or inability to verify the control/account/fence write boundary,
returns `{status:"RESOLUTION_UNKNOWN", resolutionIdentity, proposalDigest}`.
This response asserts no durable receipt or state change and preserves the
existing block. An ambiguous write blocks further writes until exact receipt
lookup; it does
not automatically resend the proposal. Rejections are effect-free and contain
`status:"RESOLUTION_REJECTED"`, the proposal identity/digest and one of
`INVALID_ENVELOPE`, `AUTHORITY_UNPROVEN`, `EVIDENCE_UNPROVEN`,
`EXPECTED_CONTROL_CHANGED`, `RESOLUTION_IDENTITY_CONFLICT`, `BOUND_EXCEEDED`.
These are proposed recovery-protocol statuses, not additions to v1 reasons.

## 4. State and fence table

The following are new recovery-control dispositions only; they do not add
states to or execute the v1 reducer. These rows apply only after section 3.3
write eligibility is established; a classification alone cannot install them.
All rows retain an administrative run block and `resumeAuthorized=false`,
`retryAuthorized=false`.

| Verified outcome | Required current fence | Recovery disposition after commit | Original fence after commit | Account / original committed sequence |
| --- | --- | --- | --- | --- |
| `OP_APPLIED` | `RESOLVED_COMMITTED`, proven by exact original atomic commit | `APPLIED_BLOCKED` | Same resolved historical fence | Unchanged; return existing result only |
| `OP_ABSENT` | `ACTIVE_UNRESOLVED`, original prior state/sequence intact, writer excluded atomically | `ABSENT_BLOCKED` | `SEALED_ABSENT`; never eligible to commit again | Unchanged |
| `OP_CONFLICT` | Either allowed current disposition, exact contradiction evidenced | `CONFLICT_BLOCKED` | Unchanged; active unresolved fence remains blocking | Unchanged; no repair or chosen winner |
| `UNKNOWN` | Either allowed current disposition, evidence insufficient | `UNKNOWN_BLOCKED` | Unchanged | Unchanged |

Only a current `UNKNOWN_BLOCKED` control record may receive a new resolution
proposal under this draft. `APPLIED_BLOCKED`, `ABSENT_BLOCKED` and
`CONFLICT_BLOCKED` have no outgoing recovery transition here. Exact duplicates
can be looked up. New contradictory evidence against a terminal disposition
is an incident requiring a separate reviewed procedure, not an overwrite.
An initial recovery-control record must bind the original uncertainty and
last acknowledged state without asserting that the underlying transaction
did not commit. Its creation/storage schema is a separate persistence design
gate; this document does not fabricate it for an existing v1 run.

## 5. Atomicity and races

1. The **lookup-only branch** authenticates existing read permission for the
   exact run/account/receipt scope and validates bounded lookup identity and
   stored receipt integrity. An exact committed `resolutionIdentity` plus
   `proposalDigest` returns that identical historical receipt without new rows,
   sequence changes, account effects or fence changes. It does not require a
   fresh mutation grant; expiry/revocation of the original resolution grant
   does not erase evidence or prohibit a separately authorized read. Read
   permission itself is not inferred from a prior mutation grant. A changed
   digest under that identity rejects and never replaces the original receipt.
   This branch neither reclassifies current state nor authorizes resume.
2. Only the **new mutation branch**, after no committed duplicate is established,
   validates the full proposal, immutable references, all evidence, the current
   resolution grant and section 3.3 write eligibility. Missing receipt lookup
   alone is not proof that a previous write was absent: after an ambiguous
   resolution write, this branch remains blocked. A stale/revoked grant blocks
   any new write even though an authorized read of an earlier exact receipt
   remains possible. Reject before mutation if authority is unproven; report
   `RESOLUTION_UNKNOWN` without a write if the control/account boundary is
   unverified. Neither branch claims an execution attempt.
3. Under one declared authoritative transaction/serialization boundary, compare
   the complete expected control, original fence, journal head, account state,
   committed sequence, grant validity and verified evidence. Reject a changed
   expectation as ordinary stale resolution; preserve the current winner.
4. For `OP_ABSENT`, exclude the original writer before proving absence, and seal
   its fence together with the recovery receipt/control update. Original commit
   and absence resolution must compare the same fence in the same serialized
   boundary. If original commit wins, absence CAS fails. If absence wins, the
   original writer's commit fails. No check-then-write window is permitted.
5. Append one recovery receipt, advance only recovery sequence and install its
   control disposition atomically; never apply account/event effects. After
   durability, acknowledge. Lost acknowledgment is looked up by exact identity;
   absence of that lookup does not authorize retry or a second resolution ID.

If the chosen storage cannot make these comparisons and updates atomic, this
proposal is not implementable on that storage. Restart, elapsed time, expired
leases and missing responses do not supersede fences. Derived snapshots never
substitute for authoritative records or reverse an evidenced commit.

## 6. Generated examples — illustrative, not executable receipts

Names below are symbolic aliases for complete fixture records and digests;
they are deliberately not valid serialized envelopes. No real run, account,
market data or monetary value is used. Counters and injected local times are
fixture values, not operating defaults. In every example the entire account
byte sequence and original committed sequence before/after resolution compare
equal; only previously committed original operations may have changed them.

| Example | Given generated evidence | Expected result |
| --- | --- | --- |
| A: original commit, ACK lost | Proposal `P`, fence generation 7, prior sequence 12. Complete atomic original commit has receipt `R`, sequence 13 and resolved fence. | Existing v1 lookup returns `R` with zero writes. If separately authorized recovery auditing is later used, `OP_APPLIED` records `APPLIED_BLOCKED`, keeps sequence 13 and returns the same `R`. |
| B: commit never happened | Proposal `P`, active fence 7, complete sequence 12 and prior account intact. Serialized storage proof excludes fence 7 from committing while absence is checked. | One `OP_ABSENT` recovery receipt seals fence 7 and records `ABSENT_BLOCKED`. Original sequence remains 12. No replay of `P`, no missed fill, no new run. |
| C: absence check races commit | Resolver expects sequence 12/active fence 7; original writer commits `R` first at sequence 13. | Resolver CAS rejects `EXPECTED_CONTROL_CHANGED`, zero recovery rows. It cannot use stale absence proof. A new inspection may find `R`; it does not retry the stale proposal. |
| D: absence resolution wins race | Same starting fixture; resolver atomically seals fence 7 first. | Late original commit is rejected by sealed fence; no original receipt/account delta. Historical attempt and fence remain preserved. |
| E: exact resolution ACK lost | Recovery proposal `Q` committed as receipt `S`, but caller received no ACK. | Exact identity+digest lookup returns `S`; recovery sequence advances once only. Missing lookup remains unresolved, not absence proof. |
| F: two resolvers | Both expect recovery sequence 4/control `C`; one records a valid result at sequence 5. | Other fails the expected-control comparison with no row/effect; it cannot overwrite or invalidate the winner. |
| G: contradictory original records | Complete authoritative original records bind one identity to incompatible payload digests; separate current control/account/fence CAS boundary is intact and independently verified. | `OP_CONFLICT`, `CONFLICT_BLOCKED` only after authorized atomic recording; preserve records/fence/account, no repair or preferred record. If the contradiction compromises that write boundary, no receipt is appended. |
| H: unavailable original evidence, intact control | An original-operation evidence segment is unavailable, but the current control/account/head/fence CAS boundary is independently complete and verified; a snapshot alone would not suffice. | `UNKNOWN` may be recorded as `UNKNOWN_BLOCKED` with valid mutation authority. If that control boundary also cannot be verified, return `RESOLUTION_UNKNOWN` with zero writes, no invented account Ref or receipt, and the existing block retained. |
| I: stale resolver after restart | Resolver holds old control `C`; current control is `D`, even if account bytes happen to match. | Reject expected-control mismatch; equality of balances is insufficient. |
| K: applied plus contradiction | Bound evidence contains a complete original commit and a verified integrity contradiction for the same identity. | Classification is `OP_CONFLICT`; proposed `OP_APPLIED` or `UNKNOWN` rejects without mutation. Recording conflict still needs an intact verified control boundary. |
| L: applied plus absence | Independently verified assertions claim both exact commit and authoritative absence for the same operation/head. | Treat the inconsistency as `OP_CONFLICT`, not success by preferred evidence order. No durable write if the inconsistency defeats control/account CAS verification. |
| M: expired mutation grant, exact receipt exists | An exact prior resolution receipt is intact; original mutation grant is revoked, but caller has independently valid read permission. | Lookup returns identical historical receipt, zero writes. It does not authorize a new resolution, retry or resume. |
| N: unknown plus decisive complete evidence | Bound verified evidence includes an unavailable optional snapshot and complete authoritative original commit scope with no contradiction. | Classify `OP_APPLIED`; proposed `UNKNOWN` rejects. The optional unavailable snapshot cannot hide the known commit. |
| J: fabricated grant | Caller supplies syntactically valid hashes and `OP_ABSENT` but no authenticated valid grant/verifier. | `AUTHORITY_UNPROVEN`; no receipt, control change or fence release. |

## 7. Amendment acceptance matrix

These are required future checks, **not tests run by this documentation packet**.

| Case | Required observable assertion | Evidence needed |
| --- | --- | --- |
| Complete envelope / unknown field / duplicate key | Only exact closed schema accepted; no ignored identity-bearing field | Canonical generated vectors |
| Identity tampering | Any original operation/run/account/config/fence/evidence alteration changes digest and invalidates grant | Generated binding tests plus authority verifier review |
| Valid hash without authentic authority | No resolution allowed | Independent authority-negative tests |
| Exact duplicate / changed digest | Same immutable result versus conflict rejection; no second row/sequence effect | Model and later storage tests |
| Applied proof | Complete original atomic commit required; original result returned without reapplication | Model; later storage atomicity proof |
| Absence proof | Missing lookup/snapshot/timeout insufficient; intact prior head and excluded original writer required | Negative cases; storage-specific proof review |
| Absence/commit race, both winners | Exactly one can win; no late commit after sealing | Real isolated storage concurrency tests later |
| Concurrent/stale resolvers | Only exact current control can advance; loser has no effect | Model and later storage tests |
| Conflict vs normal CAS loss | Proven contradiction blocks; normal loser preserves winner | Generated cases |
| Mixed commit/contradiction and commit/absence evidence | Evaluate entire bound scope; contradiction wins, mismatching requested outcome rejects, no subset selection | Generated mixed-evidence cases |
| Unknown plus decisive complete proof | Optional unavailable evidence does not mask proven applied/absent/conflict; relevant missing scope blocks completeness | Generated mixed-evidence cases |
| Unknown evidence, intact control boundary | Authorized atomic UNKNOWN receipt possible only with trustworthy control/account/head/fence CAS; no retry/resume | Generated cases |
| Unknown/conflict with corrupt control boundary | `RESOLUTION_UNKNOWN`, zero appended receipt/sequence/seal/account change; no fabricated current Ref | Generated negative boundary cases |
| Resolution crash before/after commit / ACK loss | Atomic control+receipt+seal or UNKNOWN; exact lookup only | Later bounded temporary-journal fault tests |
| Recovery receipt or authoritative history corrupt | No repair, synthetic completion or inferred absent result | Negative corruption cases later |
| Optional snapshot missing/lagging/corrupt | Does not reverse independently evidenced original commit | Generated cases |
| Bounds at limit / one over | No truncation or partial write; explicit safe ceilings | Later implementation tests |
| Grant revoked/expired during evaluation | Commit-time validation rejects new writes; no authority cached indefinitely | Authority/storage boundary tests later |
| Exact receipt read after mutation grant revoked | Independently authorized read returns identical intact prior receipt; no fresh mutation grant or side effect; denied read permission still blocks disclosure | Read/mutation separation tests later |
| Money/effect conservation | Byte-identical account and unchanged original receipt sequence for every recovery outcome | Every model/storage fixture |
| Terminal outcome and new evidence | No in-place resume, relabeling, overwrite or automatic retry | Generated terminal-state tests |
| Old v1 interoperability | Original event/proposal/receipt bytes, enums and historical vectors unchanged | Full original compatibility checks |

## 8. Review and implementation boundary

Before adoption, independent review must accept: schema completeness and digest
membership; control-vs-reducer separation; the two atomic races; authority and
evidence trust boundaries; handling of terminal contradictions; and the explicit
no-resume rule. Resolve review findings in a new draft version, preserving old
evidence. Publication alone is not acceptance.

After contract acceptance, a separate bounded temporary-journal proposal must
identify an already available resource and its actual transaction/durability
guarantees, finite limits, test-only identities, generated inputs, injected
clock, cleanup boundary, crash injection and evidence-verifier mechanism.
No new dependency, database provisioning, workflow, scheduler, provider call,
credential access, production storage or operational reconciliation is included.
Do not copy portfolio `DOUBLE PRECISION` storage or research B1 identities.

Passing future synthetic or local crash tests would establish only their tested
boundary. It would not qualify a strategy, authenticate a market source, verify
production storage, grant Paper admission or authorize Live trading. All current
authority flags remain false; D2 and operating-choice gates remain unchanged.

## 9. Draft revision record

Draft 2 incorporates internal design review: complete-evidence contradiction
precedence and mixed-evidence acceptance cases; distinct original-evidence
uncertainty versus an unverified write boundary; and exact historical receipt
lookup under separate read authorization despite an expired mutation grant.
Draft 1 SHA-256 was
`8c12a249161e89c89e4d67235f63954f69cacf35b9e5b8ae3875324ed006c586`.
These edits are proposal revisions, not independent final acceptance or
implementation evidence. No canonical v1 file has changed.
