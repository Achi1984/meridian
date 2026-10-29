# M11 Coordinator Atomic Record Backend

This backend is a source-only synthetic implementation of the coordinator atomic-record contract.

## Contract

- One canonical envelope is atomically replaced by exact `storageVersion` compare-and-swap.
- `storageVersion` is private and increments on **every** durable mutation, including claim creation.
- Public lifecycle snapshot (`snapshot.oid`, `snapshot.revision`) does **not** advance on `createOnlyClaim`; it advances only on transition commit.
- Admission reducer state is independent from public lifecycle revision.
- Durable envelope fields are bounded to:
  - `storageVersion`
  - public `snapshot`
  - `admissionState`
  - retained `claims`
  - `transitionChain`

## Safety and sequencing

- Claims atomically consume quota and gate identity via `reduceAdmissionRecord(...SIMULATE_ADMISSION...)`.
- Transition commit enforces:
  - private-version fence (`claim.storageVersion` must match envelope `storageVersion`)
  - public expected pair fence (`expectedOid` + `expectedRevision`)
  - immutable claim identity consistency (action/execution/request/session when present)
  - legal lifecycle transition order, including dispatch/observe/receipt fences
- `OBSERVE_PENDING` remains resumable by allowing `OBSERVE_PREPARING` from `OBSERVE_PENDING`.
- Once a claim is marked `UNKNOWN`, it cannot resume to non-`UNKNOWN` transitions.
- Duplicate receipt preparation is rejected.

## Reconstruction and durability boundaries

- Canonical envelope import validates chain monotonicity and admission/claim projection coherence.
- Inconsistent chain, reducer, or claim projection data is rejected.
- Lost write ACK behavior is fail-closed: callers reconcile as unknown; replay does not duplicate write.

## Hosted gaps (intentional)

This module does **not** claim hosted durability or external authority. Capability flags in this synthetic backend prove only local source semantics, not production database/network guarantees.
