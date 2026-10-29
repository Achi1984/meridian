# M11 Coordinator Atomic Record Backend

This backend is source-only synthetic composition for coordinator state-store integration.

## Contract

- The backend stores one canonical envelope and only mutates it via exact `storageVersion` compare-and-swap replacement.
- Private `storageVersion` increments on **every durable mutation**, including claim creation.
- Public lifecycle pair (`snapshot.oid`, `snapshot.revision`) does **not** change on claim creation and changes only on transition commit.
- Admission reducer revision is separate from public snapshot revision.

Envelope fields:

- `storageVersion`
- `snapshot`
- `admissionState`
- `claims`
- `transitionChain`

## Durability and validation

- `transitionChain` persists immutable transition records including parent linkage and digests:
  - `parentStorageVersion`
  - `parentDigest`
  - `transitionDigest`
  - record `digest`
  - public tip (`publicOid`, `publicRevision`)
- Reconstruction validates chain linkage, digests, and reducer/projection replay consistency.
- Any inconsistency (chain parent/digest, public tip drift, admission/projection mismatch, or missing retained claim) rejects the envelope.
- `snapshot.chainValid` is returned only for validated/reconstructed history.

## Lifecycle fences and identity

- Claims atomically consume quota/gate/identity through `reduceAdmissionRecord(...SIMULATE_ADMISSION...)`.
- Transition commits enforce both:
  - private fence (`claim.storageVersion` == envelope `storageVersion`)
  - public CAS fence (`expectedOid`, `expectedRevision`)
- Strict lifecycle order is enforced (no shortcut bypasses):
  - `CLAIMED -> REVIEW_PENDING -> DISPATCH_ACKED -> OBSERVE_PREPARING -> REVIEW_RESULT -> RECEIPT_PREPARING -> RECEIPT_POSTING -> RECEIPT_DELIVERED`
- `OBSERVE_PENDING` remains eligible by allowing `OBSERVE_PREPARING` from `OBSERVE_PENDING`.
- Completion pairs are validated (`completionState`/`verdict`), and final delivered transition cannot overwrite accepted pair values.
- `UNKNOWN` is terminal for progression; non-unknown resume is rejected.

## One-attempt write semantics

- Claim and commit perform one conditional replacement attempt per invocation (no automatic retry/takeover/refund).
- Successful replace responses require authoritative readback verification before returning `CREATED`/`COMMITTED`.
- Malformed/uncertain replace outcomes fail closed.
- Lost ACK after persisted write remains uncertain to caller, and replay cannot duplicate the write.

## Hosted gap

This backend does not claim hosted database/network durability. Its capability flags prove source semantics only.
