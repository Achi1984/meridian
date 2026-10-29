# M11 adapter integration status

This PR is based on coordinator head `699f6e702682308e330275cd81ae2ab3549e1310` and includes core R5 `348ecf05fb5904f080c20ba7d7a2d81cc25b59dc` by normal merge. It also imports the reviewed read-adapter snapshot `d66ba429cb20d1ac3fbc3efaa8fdb495df49e831`; the adapter's three owned files are unchanged.

## Current result: blocked on adapter contract

The integration test composes the actual read adapter, `collectExactPair`, `runReviewCoordinator`, and `createCoordinatorStateStore` using synthetic HTTP responses and injected reviewer/receipt callbacks. It does not patch, decorate, or replace the adapter contract.

The collector correctly returns `BLOCKED/RUN_PAGINATION_INCOMPLETE`: the adapter's run-page result has no authoritative `totalCount`, which the collector requires to prove complete pagination. The adapter also maps workflow jobs to only `id`, `status`, and `conclusion`; the coordinator requires job name/step evidence and identity bound to the exact workflow-run-attempt endpoint. The adapter's trusted-auth evidence remains inside its closure and is exposed to the collector only as a boolean `authenticated`, so its evidence identity and expiry cannot be bound into collection provenance. No job read, state claim, reviewer call, or receipt call proceeds after the pagination failure.

These are intentional blocking assertions, not a successful adapter-to-review path. Adapter R4 has not been delivered in the reviewed snapshot. No inferred `totalCount`, synthetic workflow identity, or boolean-only durable authentication claim is added. Re-run a positive composed path only after the adapter owner delivers and reviews the required contract.

Tests use synthetic payloads and in-memory injected I/O. They do not establish live GitHub authentication, hosted atomicity, model capability, receipt delivery/readback, or workflow behavior. The workflow remains inactive; no credentials or external write capability are introduced.

## Validation evidence

The focused local test command for this branch is:

```sh
node --test test/m11-coordinator-integration.test.js test/m11-coordinator-github-read-api.test.js test/m11-coordinator-pilot.test.js test/m11-event-coordinator.test.js
```

This is local focused evidence only. Hosted CI and final independent review for this follow-up are pending.
