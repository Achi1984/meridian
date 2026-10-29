# M11 review lifecycle (asynchronous start + observe)

`scripts/autonomy/m11-review-lifecycle.mjs` adds bounded control operations for the review lifecycle:

- `startReviewLifecycle(...)` admits one logical action/execution, persists immutable review identity in durable claim state, then dispatches review work without awaiting model completion.
- `observeReviewLifecycle(...)` polls only the existing persisted identity, re-collects fresh exact-pair evidence, evaluates completion via `evaluateReviewBoundary(...)`, and publishes one identity-bound receipt only after durable completion persistence.

## Safety properties

- Control operations are individually bounded (`maxRuntimeMs <= 10000`); they do not inflate runtime budgets to wait for model execution.
- A separate explicit review deadline is persisted (`reviewDeadlineAt`) and enforced during observation.
- Dispatch acknowledgement and persistence ambiguities fail closed to `UNKNOWN`; no automatic re-dispatch/repost is attempted.
- Restart paths must reacquire a fresh branded collection and match immutable pins (`action/execution/run/head/base/diff/changed-path-digest`); serialized JSON is not treated as verified collection evidence.
- Revalidation is mandatory at promotion boundaries; missing/errored/stale collector output fails closed.
- Changed paths for boundary identity come from collector-validated compare inventory, not diff-header regex parsing.
- Completion is accepted only through `evaluateReviewBoundary(...)` with injected trusted runtime verification and exact identity/coverage/terminal checks.
- Receipt posting is identity-bound and readback-verified before durable `RECEIPT_DELIVERED`.
- If durable state is already in `RECEIPT_POSTING` or unknown receipt-delivery stages after restart, observation performs authoritative readback only and never auto-reposts.
- Duplicate completion/observation is idempotent: no second dispatch and no second receipt.

## Current scope and hosted gaps

This module composes existing local collector/state-store/boundary interfaces with injected adapters and fake I/O tests. It does **not** claim hosted durability guarantees by itself and does not activate automation, model credentials, or live external dispatch.

Remaining hosted owner work includes:

1. Binding real admission backend semantics to expose durable transition fields used by observe.
2. Providing authenticated runtime evidence verifier implementation for boundary seam.
3. Supplying production dispatch/observe/receipt adapters and operational telemetry.
