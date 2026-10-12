# Native negative event probe — activation proposal

Prepared against main `b8ec85582e7bd73d4e6eaabc57ce52cda82b16d7`.
Inactive source only. This document and its sibling YAML do not install a workflow.

## Exact scope

- Source: still-open PR #705, head `514819aeb5d97afe00263ed433550e8788f4761e`.
- Release Safety run `38210241542`, workflow `347821227`, source event `pull_request`.
- Observed completed successful attempt 1 has run-associated base `e0e08298451a52529f2278252d417d06e144dd38`.
- Proposed trigger: one explicit rerun of that source run, yielding attempt 2. No new source commit, repeated rerun, model call or developer dispatch.
- Installed receiver accepts only that run/head/source attempt 2 and its own attempt 1; all other events skip its collector job.
- The four-minute receiver timeout bounds each receiver execution, not source CI runtime or exact-duplicate platform delivery count. One source rerun is the operational budget; duplicate-delivery hard deduplication remains unproven.
- Read-only contents/actions/issues/pull-requests token. No PR checkout, mailbox body collection, mutation, trade or deployment command.

## Proposed installation and execution sequence

1. Obtain independent review of this pinned candidate and explicit owner approval for the installation, one source rerun and cleanup. Delegated routine merge approval alone does not activate it.
2. Recheck source PR remains open at the exact head, run attempt remains 1, native run association and current main. Any unexpected state or prior delivery stops the packet; never substitute another run.
3. In separately reviewed installation PR #708, derive `.github/workflows/meridian-negative-event-pilot.yml` from the sibling YAML. The installed revision corrects the inactive-template comments and removes the artifact-upload step; it is intentionally not byte-identical. The source run/head/attempt pins, receiver attempt limit, read-only token and timeout must remain unchanged. Verify the collector at installation head includes the #706 association check and the intended read-only implementation. Record installation head and merge SHA. No other workflow or permission changes.
4. After required installation post-merge checks succeed, freeze further main changes for the probe. The receiver loads collector code from its immutable `GITHUB_SHA` and verifies it is current main; record that control SHA.
5. Recheck attempt 1 and source pins immediately before the sole source rerun. Observe its attempt-2 completion and the resulting receiver run. Do not re-run the receiver manually.
6. Record source and receiver IDs, attempts, SHAs, actual token permissions, source/receiver conclusions, collector step result and whether a receipt artifact exists. The current CLI prints only a generic rejection; do not infer its internal error code. No raw source logs or credentials in the report.
7. Remove the installed workflow through a reviewed cleanup PR after the observation, including on failure. If deletion cannot be completed, disable the specific pilot and report the unfinished cleanup. No general listener or scheduler remains intentionally installed.

## Expected evidence and stopping conditions

Installation changes main while the pinned source run belongs to an older base. Static analysis predicts `STALE_PR` or `STALE_RUN_PR`, depending on fresh PR metadata. The current CLI suppresses specific errors. Consequently the live acceptance scope is transport arrival plus generic collector rejection only, not proof of a specific stale-base check. Specific negative-path evidence would require separately reviewed safe error-code instrumentation. Neither result is green CI, successful receipt acceptance, duplicate-event safety or autonomous coding.

A generic failure, missing delivery, authentication error, timeout or platform skip is not proof of stale-base rejection. A generic collector rejection establishes only that the collector step ran and rejected processing. Record the actual outcome and stop; do not retry automatically. If run-associated base unexpectedly changes, or the collector accepts and emits a receipt, do not reinterpret that as success: stop and inspect the source association and tested-checkout provenance. No positive acceptance was authorized by this negative packet.

The installed negative probe contains no artifact-upload step. Any unexpectedly created receipt remains ephemeral on the runner; unexpected collector success stops the probe for diagnosis, not acceptance. The sibling preparation template retains its historical upload example and is not the authoritative installed revision. Do not mark absence of the receipt artifact alone as proof; inspect the collector step outcome and event/run identities. Exact duplicate delivery and wrong-pin native rejection remain separate unproven cases unless actually observed.

## Resource and authority boundaries

Use existing included Actions allowance only, with no billing/overage change. Verify allowance and stop-on-overage before installation. Source CI consumes its normal Actions runtime; the receiver four-minute timeout is not a cap on the source rerun's cost. No inference/model session is part of this probe.

A positive event probe needs a separately reviewed sequence that produces CI against the installed control main without stale bindings. No repository-variable configuration, credentials, dynamic authority, relaxed base check or worker activation is introduced here. Autopilot remains paused. Research/trading authorization is unchanged.
