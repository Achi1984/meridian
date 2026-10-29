# M11 adapter integration status

This PR includes coordinator R5 `348ecf05fb5904f080c20ba7d7a2d81cc25b59dc` and adapter R4 candidate snapshot `1be990b7f9106d14ad53953e74792057b9d7f451`, each merged normally. The adapter's three Codex-owned files are byte-identical to R4. R4's separate independent source audit is still pending; this integration does not represent that candidate as accepted.

## Composition status

The integration test composes the actual read adapter, `collectExactPair`, `runReviewCoordinator`, and `createCoordinatorStateStore` using synthetic HTTP responses and injected reviewer/receipt callbacks. It exercises one complete synthetic adapter-to-collector-to-review/state/receipt path. This does not invoke GitHub, a model, or a remote writer.

The collector requires validated `totalCount` pagination, exact run/attempt/workflow job identity, mandatory job/step evidence, and a complete exact-pair diff. It binds the adapter's immutable authentication-evidence snapshot (evidence ID, principal, host, scheme, TLS, verification time, expiry) into collection provenance. Collection expiry is capped by that authentication evidence. Evidence is checked before and after each adapter read (including each pagination page), and each promotion re-collects and requires an exact provenance match before claim, review, and receipt. This detects a changed or expired snapshot across an observed read; it cannot detect evidence that changes and reverts entirely between observations inside an adapter method.

The deterministic cases include a complete 130-run inventory over two pages (100 + 30), wrong individual-job run/attempt/workflow, malformed/truncated/changing totals, stale PR head, auth expiry and evidence rotation while reading a response body, auth identity changes at promotion boundaries, caller abort, and an UNKNOWN receipt outcome followed by a duplicate invocation. Expired or changed evidence cannot advance to new work; unknown delivery remains one-shot.

The adapter-to-collector composition is now demonstrated for synthetic fixtures, not for live GitHub. Hosted atomicity, live authentication provenance, model capability, receipt delivery/readback, and workflow behavior remain unproven. The workflow remains inactive; no credentials or external write capability are introduced.

## Validation evidence

The focused local test command for this branch is:

```sh
node --test test/m11-coordinator-integration.test.js test/m11-coordinator-github-read-api.test.js test/m11-coordinator-pilot.test.js test/m11-event-coordinator.test.js
```

This is focused local evidence only. On the prior published head `d6870687f90f26764d8b681617aeb53de44de2d1`, hosted Release Safety run `40858723599` is `action_required` with zero jobs and no failed-job logs; it is not a pass. Hosted CI for this follow-up head and final independent review remain pending.
