# M11 review lifecycle (asynchronous start + observe)

`scripts/autonomy/m11-review-lifecycle.mjs` adds bounded control operations for the review lifecycle:

- `startReviewLifecycle(...)` admits one logical action/execution, persists immutable review identity in durable claim state, then dispatches review work without awaiting model completion.
- `observeReviewLifecycle(...)` polls only the existing persisted identity, re-collects fresh exact-pair evidence, evaluates completion via `evaluateReviewBoundary(...)`, and publishes one identity-bound receipt only after durable completion persistence.

## Safety properties

- Control operations are individually bounded (`maxRuntimeMs <= 10000`); they do not inflate runtime budgets to wait for model execution.
- A separate explicit review deadline is persisted (`reviewDeadlineAt`) and enforced during observation.
- Dispatch acknowledgement and persistence ambiguities fail closed to `UNKNOWN`; no automatic re-dispatch/repost is attempted.
- Dispatch acknowledgement is durably committed (`DISPATCH_ACKED`) before observation can advance; a reconstructed `REVIEW_PENDING` claim without durable ack remains non-advancing.
- Observation and receipt-preparation each write a durable attempt fence (`OBSERVE_PREPARING`, `RECEIPT_PREPARING`) before fallible external/readback boundaries.
- Restart paths must reacquire a fresh branded collection and match immutable pins (`action/execution/run/head/base/diff/changed-path-digest`); serialized JSON is not treated as verified collection evidence.
- Revalidation is mandatory at promotion boundaries; missing/errored/stale collector output fails closed.
- Changed paths for boundary identity come from collector-validated compare inventory, not diff-header regex parsing.
- Completion is accepted only through `evaluateReviewBoundary(...)` with injected trusted runtime verification and exact identity/coverage/terminal checks.
- Persisted terminal review results (`REVIEW_RESULT` with `COMPLETE`/`REVISION_REQUIRED`) resume receipt preparation after restart without re-observing model output or re-applying deadline downgrades; fresh revalidation is still required before receipt.
- A reconstructed unfinished attempt fence (`OBSERVE_PREPARING`/`RECEIPT_PREPARING`) is non-advancing and requires manual reconciliation; direct resume from `REVIEW_RESULT` is allowed only when receipt preparation never durably started.
- Receipt posting is identity-bound and readback-verified before durable `RECEIPT_DELIVERED`.
- If durable state is already in `RECEIPT_POSTING` or unknown receipt-delivery stages after restart, observation performs authoritative readback only and never auto-reposts.
- Duplicate completion/observation is idempotent: no second dispatch and no second receipt.

## Durability limits

- Returning `UNKNOWN` from a control operation is not, by itself, proof that a durable unknown latch was committed.
- Recovery therefore relies on explicit durable stage invariants (`DISPATCH_ACKED`, `REVIEW_RESULT`, `RECEIPT_POSTING`, `RECEIPT_DELIVERED`) plus authoritative receipt readback.
- Failed `recordUnknown(...)` persistence is treated as unresolved durability uncertainty; fencing stages prevent unsafe re-observe/repost after reconstruction.
- This packet still does not prove hosted crash safety or global linearizability; those remain backend responsibilities.

## Current scope and hosted gaps

This module composes existing local collector/state-store/boundary interfaces with injected adapters and fake I/O tests. It does **not** claim hosted durability guarantees by itself and does not activate automation, model credentials, or live external dispatch.

Remaining hosted owner work includes:

1. Binding real admission backend semantics to expose durable transition fields used by observe.
2. Providing authenticated runtime evidence verifier implementation for boundary seam.
3. Supplying production dispatch/observe/receipt adapters and operational telemetry.
