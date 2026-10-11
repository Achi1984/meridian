# Bounded native event pilot — activation packet

Status: preparation only. No workflow is installed, no event has been received by this candidate and no worker is activated.

## Proposed first live test

Use GitHub Actions' native `workflow_run` completion event for Release Safety only. This tests the existing read-only receiver independently of the production gateway and PostgreSQL. Keep the proposal at `docs/autonomy/event-receiver/pilot-receiver.yml`; a file in this directory is inactive.

The draft has a literal source run ID of `0` and an all-zero head SHA. These sentinel pins disable acceptance. A future, separately approved installation patch must replace them with one independently verified source CI run ID and exact head SHA. It must verify the repository and non-fork origin, fixed Safety workflow identity/path, completed event, and source attempt restricted to 1 or 2. Wrong pins must skip the collector job. No mailbox comment or general workflow trigger is in this pilot.

The source collector must first be available on protected main after PR #703 is merged. Select the pinned source run/head from a separate, still-open PR in the same repository after that merge; the collector cannot accept merged PR #703 itself as the pilot source. Load the collector from an immutable, independently verified current-main commit; do not check out or execute PR code. The pilot uses GitHub's Python runner environment, whose actual compatibility still needs a live probe. The production gateway's Node 20 container is not involved.

## Limits and acceptance evidence

- One pinned source run, source attempts restricted to 1 and 2, with a four-minute timeout per receiver execution. The template now requires `github.run_attempt == 1`, rejecting manual reruns of the receiver. Two accepted receiver executions is the operational pilot budget, not durable deduplication or a guaranteed hard cap against duplicate platform deliveries. Stop on unexpected repetition; no exact-duplicate delivery proof exists yet.
- GitHub token permissions remain read-only for contents, actions, issues and pull requests. No model calls, dispatches, comments, PR mutations, merges or deployment operations.
- Only bounded metadata receipts, at most 4 KiB, retained as an artifact for one day. No comment bodies, raw job logs, secrets or executable artifacts.
- Record the actual source event/run/attempt/head and receiver run identity. A successful local fixture is not event-delivery evidence.
- Demonstrate real accepted delivery and duplicate/repeated delivery handling without execution or merge authority. If the second source attempt is used, record it as a new attempt of the same pinned run; do not mislabel it an exact duplicate. Without a demonstrated exact duplicate, duplicate-event acceptance remains unproven.
- Wrong-pin rejection is statically assessed in preparation; demonstrating that native negative-pin deliveries produce no collector job remains a future live probe. Inspect the actual emitted receipt and permissions. All existing authentication/provenance/action-authority flags remain false; platform event context does not silently promote them.
- Stop after the bounded test. Remove or disable the installed pilot workflow through the reviewed cleanup patch; do not leave a general listener or scheduler behind.

## Concrete approval boundaries

First obtain the owner's concrete approval to merge the exact reviewed PR #703 source revision after its required CI and independent review gates. Separately obtain approval for the exact pilot workflow installation patch, selected source run/head/current-main pins, bounded execution plan and cleanup. The generic development Go is not presented as approval for this new installed workflow. Neither this document nor sentinel replacement is permission to bypass the existing protected merge/review policy.

The activation review must inspect the final literal pins and job-level conditions, action/collector commit pins, timeout, read-only token scope, artifact bounds/retention and rerun limit. Keep preparation outside `.github/workflows` until that concrete installation is approved.

## What the pilot cannot establish

This is a read-only event transport probe. It does not demonstrate autonomous coding, a model wake-up API, authenticated review authorship, cross-host durable coordination or safe external writes. It does not authorize workflow permissions or a production gateway change.

The current development workspace has PostgreSQL client libraries but no PostgreSQL server/client binaries, container launcher or installed embedded PostgreSQL runtime in the inspected runtime locations. No disposable PostgreSQL service was exposed by the available tools. No live database credentials were inspected or connections attempted. A real disposable PostgreSQL instance and isolated schema/role remain prerequisites for independent-client transaction and crash testing of any shared-store implementation. SQLite files copied among Actions jobs are not a shared coordination protocol.
