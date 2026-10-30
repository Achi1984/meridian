# M11 GitHub State Transport (source-only, default-disabled)

`scripts/autonomy/m11-coordinator-github-state-transport.mjs` provides a GitHub-backed transport for the atomic coordinator backend contract:

- `readCanonicalEnvelope()`
- `replaceCanonicalEnvelope({ expectedStorageVersion, nextEnvelope })`

It is **default-disabled** and does no startup I/O. This packet is source-only: no workflow wiring, no runtime activation, and no provisioning.

## Fixed target and provisioning status

The transport is pinned to one proposed state location:

- repository: `Achi1984/meridian`
- branch: `meridian-coordinator-state`
- path: `state/m11-coordinator.json`
- provisioning: `UNPROVISIONED`

The implementation does **not** create/provision the branch/path and does not probe alternate refs/endpoints.

## Storage model and replay invariants

- Envelope shape is exact: `storageVersion`, `snapshot`, `admissionState`, `claims`, `transitionChain`.
- `snapshot.oid` is the logical coordinator OID from the canonical envelope, **not** the Git commit OID.
- Git `readHeadOid` is tracked separately and bound with `storageVersion` + envelope digest.
- Reads resolve `ref -> commit -> tree -> blob` and replay through the real atomic backend canonical validator (no duplicate reducer).
- Same `storageVersion` observed under a different `readHeadOid` is treated as unknown (`SAME_VERSION_DIFFERENT_OID`).

## Write semantics

- Single GraphQL mutation: `createCommitOnBranch` with `expectedHeadOid`.
- Exact branch selector: `{ repositoryNameWithOwner, branchName }`.
- One file addition/replacement for `state/m11-coordinator.json`; no deletions/force semantics.
- GraphQL `FileAddition.contents` is UTF-8 encoded and RFC 4648 base64 encoded.
- No mutation retry.
- Conflict is reported only for HTTP 409 or an explicit structured expected-head mismatch; message text and partial GraphQL data/errors remain UNKNOWN.
- After mutation, transport requires authoritative branch readback to match returned commit OID and exact candidate bytes before returning `REPLACED`.
- Each `storageVersion` read binding is a one-use opportunity for the lifetime of the transport instance, including after an ambiguous mutation.

## Safety bounds

- Redirects are rejected.
- Response origin and exact URL/resource identities are checked.
- Each response and request body is capped at 1 MiB; each operation is capped at five requests and 10 MiB aggregate I/O.
- One operation-wide deadline (at most 30 seconds) covers fetch, streamed bodies, and readback; cancellation races uncooperative fetch/read promises and yields on empty chunks.
- Errors are stable enum codes (`GITHUB_STATE_TRANSPORT_ERROR`) and exclude credential/body logging.

## Current limitations (unchanged by this packet)

- `hostedAtomicityProven` remains `false`.
- External reset/delete/foreign-writer/ABA defenses are still deployment prerequisites, not solved here.
- Later reads can observe and reconcile canonical state, but cannot reauthorize a consumed storage version within the same instance. The one-use fence is memory-only and does not protect against a new transport instance/process.
- Transport never auto-reposts on unknown acknowledgements.
