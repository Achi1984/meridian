# M11 admission record reducer (preparation only)

`/home/runner/work/meridian/meridian/scripts/autonomy/m11-admission-record.mjs` is a **pure offline reducer** for synthetic admission-record state transitions.

This packet does **not** add runtime wiring, durable storage, hosted CAS, dispatcher authority, scheduler activation, or backend IO.

## Scope

- Strict own-data plain-record schema validation (rejects accessors, proxies, malformed IDs/integers, and extra keys).
- Immutable reducer inputs/outputs.
- Default-disabled state (`enabled: false`).
- Synthetic enabled mode still returns:
  - `dispatchAllowed: false`
  - `mergeAllowed: false`
  - `activationAllowed: false`
  - `externalEffects: false`
  - `retryAllowed: false`

## State model in this packet

The reducer combines one record with:

- `revision`
- retained `claims` (bounded)
- permanently consumed quota
- one `activeGate`
- reconciliation latch (`CLEAR` or terminal `UNKNOWN`)

A successful `SIMULATE_ADMISSION` transition updates **revision + claim + consumedQuota + activeGate** atomically in one immutable state step.

## Safety invariants

- Expected revision and expected total quota must match.
- Only one active gate can exist.
- Existing logical claim blocks duplicate logical action, including fresh execution keys.
- Retained execution keys are also unique and cannot be reused by a different logical action.
- Reconstructed state must satisfy relational invariants (claims/quota/revision/status/gate/UNKNOWN latch bindings), not just field shapes.
- Rejections are fail-closed and return unchanged state.
- Quota and retained claims are never refunded/deleted by this reducer.

## UNKNOWN handling

Uncertain admission/effect/checkpoint outcomes transition to terminal `UNKNOWN`.

Readback events may annotate observations (`committed`, `notobserved`, `unresolved`) but never:

- authorize retry/resume/takeover/new execution key,
- release gate,
- refund quota,
- clear retained claim.

`UNKNOWN` survives JSON serialization/reconstruction and continues blocking competing admissions while the latch/gate is present.

Malformed reconstructed records (for example `ADMITTED` or `UNKNOWN` claims without valid gate/latch bindings) are rejected before any transition.

## Completion and gate release

- Completion evidence must be exact-bound to logical action, execution key, and admission revision.
- Unacknowledged completion does **not** release the active gate.
- Only acknowledged terminal completion may release the gate.
- Claim and consumed quota remain retained permanently after release.

## Revision safety

Every mutating transition requires a safe next revision. If `revision` is already `Number.MAX_SAFE_INTEGER`, the reducer blocks unchanged with `REVISION_EXHAUSTED`.

## Explicit non-claim

This pure reducer cannot durably record intent across client crash boundaries. It does not prove global blocking-before-admission, persistence, linearizability, or external-effect commitment. A separately proven hosted durable sequencer/CAS store is required for those guarantees.
