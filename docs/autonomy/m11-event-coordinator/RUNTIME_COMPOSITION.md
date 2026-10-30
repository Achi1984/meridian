# M11 one-shot runtime composition

**SOURCE_COMPOSITION_ONLY / PUBLICATION_NOT_READY.** This library imports the
actual atomic record backend, state store, asynchronous review lifecycle and
offline status projector. It neither activates nor proves hosted autonomy.
Only the three runtime-composition source/test/doc files are part of this
packet. No scheduler, polling loop, CLI, workflow, browser feed, state target,
credential source, network fallback or automatic restart/discovery is added.

## Explicit API

```js
const runtime = createCoordinatorRuntimeComposition({
  enabled: false,
  stateTransport,       // readCanonicalEnvelope / replaceCanonicalEnvelope
  now,                  // explicitly injected clock for start/observe
  dispatchReview,
  observeReview,
  revalidate,           // must return a fresh actual collector-branded value
  reviewerIdentity,     // exact provider / agent / model / transport
  trustedRuntimeSeam,   // exact {verifyRuntimeEvidence}; supplied externally
  receiptLookup        // exact {lookupByExecutionKey}; read-only, no publication
});

await runtime.start({
  collected, expiresAt, maxRuntimeMs: 10000,
  reviewDeadlineMs: 300000, claimOwner: 'm11-runtime-composition'
});
await runtime.observe({executionKey, collected, expiresAt, maxRuntimeMs: 10000});
await runtime.projectStatus({contextJson, nowMs});
```

Construction does no I/O. Default-disabled operations return `WAITING/DISABLED`
before inspecting dependencies or calling the clock. Invalid/missing required
operation seams, scalar limits and unbranded/expired collections cause no state
or reviewer I/O. Start requires dispatch, revalidation, reviewer, clock and state
transport; observe additionally requires observation, external verification and
the narrow lookup seam. Projection requires only the state transport, a JSON
context string and an explicit positive safe-integer `nowMs`; it does not use
the runtime clock or reviewer seams. Detailed context validation remains with
the real projector, after the canonical read. Invalid context produces no rows
or writes, but does not promise zero reads.

No backend, lifecycle, collector or projector success can be injected. Each
operation constructs the real backend and store over the supplied transport.
All result envelopes add `scope: SOURCE_COMPOSITION_ONLY`, `publication:
NOT_READY`, `receiptDelivery: NOT_ATTEMPTED`, and `hostedAtomicityProven: false`.
`receiptDelivery` describes this composition's sends, not whether an external
receipt might already exist. Original lifecycle uncertainty and authority flags
are preserved, except a locally refused publication reports no publication
effect. No merge, retry, activation or trading authority is granted.

## Identity, durability and publication refusal

The collector's **logical `actionKey`** and **`executionKey`** stay distinct.
The lifecycle's outer receipt `actionKey` is an execution-key binding, while
its nested receipt payload `actionKey` remains the logical action. This adapter
does not rename one into the other. The lookup-only seam receives exactly
`{executionKey, signal}`, never a logical-action alias or an arbitrary URL.

Start retains the real create-only claim, atomic quota, single active gate,
public OID/revision and private storage-version CAS semantics. It persists
`REVIEW_PENDING` before dispatch, and dispatch acknowledgement before returning.
Observe retains the lifecycle's attempt fences, fresh collection revalidation,
deadline and real review-boundary admission. Serialized JSON collections do not
become branded evidence on restart: callers must explicitly collect again.

After admitted completion the lifecycle really commits `REVIEW_RESULT`,
`RECEIPT_PREPARING` and `RECEIPT_POSTING`. The internal `postOnce` is **a refusal,
not a publication bridge**. Before returning a publication diagnostic it reads
the actual backend export (including full replay/digest validation), and checks:

- claim status **and** last stage are `RECEIPT_POSTING`;
- the final posting record binds the exact claim, execution and logical action;
- claim, record and envelope storage version, public revision and OID agree,
  and match the actual successful posting commit;
- all receipt fields match the replayed persisted claim: logical action,
  execution, repository, PR, head/base/diff, review request/session and accepted
  completion/verdict pair; reviewer identity and collector pins also match.

Only then does it return `NOT_ATTEMPTED/PUBLICATION_NOT_READY`. State/payload
drift instead reports `POSTING_STATE_OR_PAYLOAD_MISMATCH`; unavailable or
unreplayable posting state reports `POSTING_CANONICAL_STATE_UNAVAILABLE`.
There is **no POST implementation or injected POST callback**.

The existing lifecycle would normally record `RECEIPT_DELIVERY_UNKNOWN` after
a failed `postOnce`. The composition's small store facade deliberately refuses
that transition after its local no-send refusal. The durable posting fence,
quota consumption and active gate therefore remain intact; no success-shaped
`CREATED`, receipt delivery, `COMMITTED` claim or quota refund is fabricated.
A posting commit with a lost ACK remains uncertain, but durable replay still
finds the posting fence.

On explicit observe after restart, canonical `RECEIPT_POSTING` is validated
against the reconciled claim, actual final record and fresh collector pins.
Immediately before delegating lookup it is re-exported and must exactly match
that validated envelope. Only one lookup is delegated, within the lifecycle's
abortable time budget. FOUND with one ID remains
`UNKNOWN/RECEIPT_FOUND_RECONCILE_REQUIRED`, **never COMPLETE**. NOT_FOUND and
multiple matches do not authorize a repost. There are no restart writes or
re-dispatches on this path.

Existing UNKNOWN delivery/readback/state-commit stages are not promoted to a
posting identity: they return `POSTING_IDENTITY_RECONCILIATION_REQUIRED` without
delegation. The current record contract cannot provide the required final
posting-tip identity for those states. This is an explicit manual-reconciliation
limit, not a change to the external lifecycle/backend modules. Terminal UNKNOWN,
unacknowledged dispatch and unfinished observation/receipt attempt fences retain
the existing non-advancing lifecycle behavior.

## Deliberate blockers and trust limits

The current canonical record and state transport provide no authenticated
`committedAtMs`, durable publication intent, authority issuer or actual-send
evidence writer. This packet supplies none of them. Clock time and
`claim.createdAt` are not commit-time evidence. A valid CAS, OID, replay or digest
is consistency evidence, not authenticated provenance or publication authority.
Even an internally consistent replacement history must match the in-flight
receipt payload; tests explicitly exercise hostile re-signed histories.

The runtime verifier is an external trust seam, not an implemented hosted
attestation. Synthetic tests explicitly inject trusted synthetic evidence only
to exercise the real boundary/lifecycle; that is not proof of hosted reviewer
trust. The actual Claude capture parser still returns UNVERIFIED, and its
candidate is rejected by the actual boundary.

Unmerged receipt work in #1028 is neither imported (including optional imports)
nor copied. Its receipt namespace/routing design is separate and pending.
There is no end-to-end receipt integration claim. State transport remains
injected, with no dependency on the unmerged #1042 implementation and no
provisioning. Hosted durability, external writers/resets and real network
semantics remain outside this synthetic packet.

## Status and limits

`projectStatus` reads the real canonical backend export and passes its JSON
directly to the actual status projector, with the caller's presentation context.
There is no projection write or provider/model/runtime evidence synthesis.
Requested and verified provider/model and current coordinator/runtime state
remain UNKNOWN, with null evidence bindings. Presentation timestamps are
caller-supplied snapshot context, not a heartbeat.

Lifecycle control budget: 1–10,000 ms per start/observe; explicit review deadline:
1–86,400,000 ms (default 300,000). Reviewer fields are capped at 120 UTF-8 bytes,
matching the actual review boundary rather than its looser start-only check.
Lookup accepts at most two nonempty IDs of at most 120 UTF-8 bytes; more than
one is ambiguous. Throwing, incomplete, malformed or timed-out lookup remains
UNKNOWN. A callback ignoring abort cannot trigger another lookup or a write.
These timers cannot preempt synchronous blocking dependencies. The injected
state transport is responsible for bounding its own I/O; projection has no new
transport deadline wrapper.

Backend history bounds remain 1,024 records, 16,384 bytes per transition and
262,144 cumulative chain bytes. Projector bounds remain 1 MiB envelope, 32 KiB
context, 50 rows, depth 16 and 50,000 values. No history truncation, cap increase,
automatic quota reset or retry is introduced. Existing gate contention can
surface as `CLAIM_OUTCOME_UNKNOWN`, not a fabricated precise duplicate verdict.

Focused synthetic acceptance command:

```sh
node --test test/m11-coordinator-runtime-composition.test.js
```

The independent serialized CAS fixture drives real components, JSON restarts,
posting refusal, lost ACKs, pending/terminal fences, exact payload/state
rejection (including replay-valid hostile histories), lookup-only recovery,
capture rejection, status normalization and competing starts. No full-suite or
CI reruns, live calls/probes, receipt POSTs, credentials, provisioning, spending,
runtime activation or trading actions are needed or authorized. Lead owns
final exact-head CI/review/integration; this delivery stops at a draft PR.
