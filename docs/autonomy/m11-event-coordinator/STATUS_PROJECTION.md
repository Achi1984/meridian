# Offline coordinator status projection

`scripts/autonomy/m11-coordinator-status-projection.mjs` is source-only. It does
not connect a live feed, mount UI, poll, authenticate, dispatch, retry, deliver
receipts, or prove that agents are running. Rows are explicitly labelled
**stored coordinator operations**.

## API and context v1

```js
await projectCoordinatorStatus(canonicalEnvelopeJson, presentationContextJson, nowMs);
```

Both inputs must be JSON strings; `nowMs` must be an explicitly injected finite
number of milliseconds since the Unix epoch. No wall-clock default is used.
The canonical envelope is the actual atomic record backend's exported format.
The presentation context has exactly these properties:

```json
{
  "schemaVersion": 1,
  "operations": [
    {
      "executionKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "taskUrl": "https://github.com/Achi1984/meridian/issues/1033",
      "observedAt": "2026-10-29T22:00:00.000Z",
      "expiresAt": "2026-10-29T22:10:00.000Z"
    }
  ]
}
```

Each operation must have exactly the four shown fields. Every source claim
must have exactly one context entry, keyed by its exact lowercase 64-hex
`executionKey`; duplicate, omitted, and unmatched keys are rejected.
`taskUrl` must be a canonical public GitHub URL accepted by the actual M11
normalizer URL validator, at most 512 characters. URLs are presentation links,
not fetched evidence or a claim that the destination is publicly accessible.

Timestamps must be canonical UTC ISO strings with milliseconds. They describe
the **supplied snapshot**, never a heartbeat. Validation requires
`observedAt <= nowMs < expiresAt`. Expiry at exactly the injected clock is
unavailable, as are future observations and invalid calendar dates. There is
no default TTL or freshness derived from the stored claim's `createdAt`.
Changing the injected clock does not refresh the snapshot.

## Replay and trust boundary

The projection calls the actual
`createCoordinatorAtomicRecordBackend(...).exportCanonicalEnvelope()` using a
private read-only memory transport. Its replace method increments a counter
and throws; the projection checks that the counter remains zero. Backend
replay, chain digests, claim/admission consistency, and lifecycle validation
are reused, not reimplemented.

**Replay consistency is not authenticated source provenance.**
An attacker can construct a self-consistent history. Neither stored reviewer
identity nor a successful verdict/session is runtime attestation.
`hostedAtomicityProven: false` is always returned in successful result metadata.
No hosted atomicity or operational authority is established.

## Results

- `READY`: `{status, serializedDTO, metadata}`. `serializedDTO` is a JSON string
  built exclusively through `normalizeM11AgentStatus`, independently consumable
  by that same normalizer with the injected clock.
- `EMPTY`: `{status, metadata}` for zero claims and a valid empty context.
  There is no DTO or rows property.
- `UNAVAILABLE`: `{status, diagnostic}` only. No partial DTO, metadata, previous
  rows, or cached result survives an error.

Metadata is separate from the DTO and contains only `storageVersion`,
`publicRevision`, `publicOid`, `claimCount`, `transitionCount`,
`hostedAtomicityProven`, and `replaceAttempts` (zero). The public OID is bounded
to 128 characters. Storage version is not public revision: claim creation
increments storage version without advancing the public snapshot.

Rows are sorted by execution key. Both `agentId` and `taskId` use that unchanged
64-character key, not reviewer/session identity or an array index.
Requested and verified provider/model, coordinator mode, row freshness, and
aggregate freshness are always `UNKNOWN`. All three typed evidence bindings
are null; the generic evidence URL is null and evidence type is `unknown`.
Owner-decision fields are false/null; no retry or dispatch advice is inferred.

| Stored source condition | Task state | Fixed explanatory task label |
| --- | --- | --- |
| `COMMITTED` and `RECEIPT_DELIVERED` | `DONE` | Stored receipt cycle completed; not runtime completion |
| `REVIEWED` at `REVIEW_RESULT` with completion `REVISION_REQUIRED` | `BLOCKED` | Stored review requires revision; not a current runtime assessment |
| `REVIEWED` and `RECEIPT_PREPARING` | `UNKNOWN` | Stored receipt preparation; publication unconfirmed |
| `RECEIPT_POSTING` and `RECEIPT_POSTING` | `UNKNOWN` | Stored receipt posting fence; delivery unconfirmed |
| `UNKNOWN` and `RECEIPT_DELIVERY_UNKNOWN` | `UNKNOWN` | Stored receipt delivery outcome unknown; no retry authority |
| Every other state/stage | `UNKNOWN` | Stored operation state; current runtime unknown |

`DONE` describes the stored receipt cycle only, even when the cycle's verdict
requires revision. `RUNNING`, `REVIEWING`, and `ACTIVE` are never emitted.
Receipt-stage labels only distinguish persisted recovery boundaries; they do not
change task state, evidence, freshness, or the non-actionable next action.

## Bounds and diagnostics

Before backend replay, each JSON value is checked against fixed resource
bounds: envelope 1,048,576 UTF-8 bytes; context 32,768 UTF-8 bytes; depth 16
(root depth zero); 50,000 total values; 64 fields per object; 1,024 entries per
array; 2,048 characters per string; 128 characters per property name.
Nonfinite parsed numbers and prototype-related property names are rejected.
The context and projection permit at most 50 operations. There is no truncation.
Backend limits remain additional constraints.

Diagnostics are fixed codes, never parser messages or raw source values:
`INVALID_CLOCK`, `INVALID_SOURCE`, `ROW_LIMIT_EXCEEDED`, `INVALID_CONTEXT`,
`PROJECTION_FAILED`, and `READ_ONLY_VIOLATION`. After bounded JSON parsing, a
claims array longer than 50 is rejected by a count precheck before replay or
context validation. This is not a replay-validity assertion. Inputs within
that count still require complete backend replay; invalid history returns
`INVALID_SOURCE`, never a successful truncated projection.

## Focused verification and reachable backend bound

```sh
node --test test/m11-coordinator-status-projection.test.js
```

Tests generate real backend envelopes for claim, review, observation, successful
and revision-required receipt delivery, incomplete results, and UNKNOWN stages.
They check normalizer roundtrips, no runtime attestations, corrupt replay,
claim/admission mismatches, context identity, resource bounds, clocks/URLs,
exact expiry, unchanged inputs, zero replace attempts, and determinism.
Separate boundary tests exercise >50-claim precheck rejection using an explicitly
invalid oversized history, and the actual normalizer's acceptance of 50 rows
and rejection of 51 using **synthetic DTO-only rows**. The latter is not a
50-claim canonical envelope or a positive projection result. All positive
projection fixtures remain real backend-generated, replay-valid envelopes.
Full CI and Claude review are left to the Lead.

**The backend's reachable history bound is distinct from the DTO row limit.**
Its retained-claim limit is 64,
but its cumulative transition-chain byte limit is only 262,144. Each subsequent
claim requires the previous claim to release the single active gate through a
complete receipt cycle (eight records minimum). Minimal backend-generated
cycles reach 44 completed claims at 261,219 chain bytes; the next claim fails
during review preparation. This measured capacity describes those minimal
backend-generated cycles, not a universal maximum for arbitrary histories;
larger records exhaust the byte budget sooner. No replay-valid 50-claim
envelope is fabricated. Backend byte/history limits remain unchanged, and
neither padding claims nor dropping history is used for positive projections.
Per the clarified contract, count-precheck and synthetic DTO-only boundary
coverage are separate from backend-reachable projection coverage.
