# M11 adapter integration status

The original read-adapter packet was accepted and merged in #1006. This revision adds bounded relevant-run discovery follow-up corrections and expanded negative composition tests; files in this branch are no longer byte-identical to the earlier R4 candidate snapshot.

## Composition status

The integration test composes the actual read adapter, `collectExactPair`, `runReviewCoordinator`, and `createCoordinatorStateStore` using synthetic HTTP responses and injected reviewer/receipt callbacks. It exercises one complete synthetic adapter-to-collector-to-review/state/receipt path. This does not invoke GitHub, a model, or a remote writer.

The collector requires validated `totalCount` pagination, exact run/attempt/workflow job identity, mandatory job/step evidence, and a complete exact-pair diff. It binds the adapter's immutable authentication-evidence snapshot (evidence ID, principal, host, scheme, TLS, verification time, expiry) into collection provenance. Collection expiry is capped by that authentication evidence. Evidence is checked before and after each adapter read (including each pagination page), and each promotion re-collects and requires an exact provenance match before claim, review, and receipt. This detects a changed or expired snapshot across an observed read; it cannot detect evidence that changes and reverts entirely between observations inside an adapter method.

The deterministic cases include a complete 130-run inventory over two pages (100 + 30), bounded relevant-run discovery via supplied `head_sha` when workflow-wide inventory is much larger (for example 2500 unrelated runs), explicit fail-closed blocking when bounded discovery cannot be proven complete (`UNSUPPORTED_RELEVANT_RUN_DISCOVERY`), wrong PR/head/base in listed rows, empty or ambiguous PR associations, synthetic merge-SHA versus PR-head mismatch, fork branch-collision refusal, moved base refusal, newer/tied competing run or attempt, ignored `head_sha` filter returning mixed bounded rows, wrong individual-job run/attempt/workflow (including attempt-payload workflow mismatch), malformed/truncated/changing totals, stale PR head, auth expiry and evidence rotation while reading a response body, auth identity changes at promotion boundaries, caller abort, and an UNKNOWN receipt outcome followed by a duplicate invocation. Expired or changed evidence cannot advance to new work; unknown delivery remains one-shot.

`head_sha` is optional at adapter interface level but supplied by collector in bounded discovery. Adapter input `pullRequest` is validated locally and currently not mapped to a REST query parameter because GitHub workflow-run list endpoints do not provide a pull-request-number filter. Mixed historical bases/PR rows are currently rejected, not filtered into a partial-as-complete result set.

Primary REST references:

- https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
- https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository

The adapter-to-collector composition is now demonstrated for synthetic fixtures, not for live GitHub. Hosted atomicity, live authentication provenance, model capability, receipt delivery/readback, and workflow behavior remain unproven. The workflow remains inactive; no credentials or external write capability are introduced.

## Validation evidence

The focused local test command for this branch is:

```sh
node --test test/m11-coordinator-github-read-api.test.js test/m11-coordinator-integration.test.js test/m11-coordinator-pilot.test.js
```

This is focused local evidence only. Hosted CI and final independent review are pending.
