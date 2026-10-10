# Bounded CI event observation pilot

Owner authorized this experiment in chat at 18:22:59 Europe/Vienna on
2026-10-10, ending at 19:20 the same day (`2026-10-10T17:20:00Z`). It permits
read-only Copilot observations and recommendations from the existing subscription,
not implementation, merge, deployment, research activation or additional spending.

## Exact scope

The only trigger is completion of `MERIDIAN Release Safety` for branch
`feat/v11-version-history-20261010`. Fresh API reads require its exact workflow
ID `347821227`, path `.github/workflows/backend-safety.yml`, first run attempt,
same-repository non-fork origin, an open PR 646 with that current head and main
base, and a pull-request source event. All recognized terminal conclusions can
produce an observation, including failure and cancellation. Unknown conclusions
and incomplete/oversized metadata fail closed. A later product head is allowed
only when it is the current head of this same PR and matches the source run.

The trusted control runs from default main. Its exact SHA must still be main,
with successful completed push runs of both Release Safety and Runtime Smoke
(`347846572`, `.github/workflows/runtime-smoke.yml`). These checks and all source,
PR and deduplication checks repeat immediately before model invocation. This is
a point-in-time observation; subsequent changes do not create approval.

Only typed IDs, SHAs, conclusions and failed step numbers enter the model. Job/step
names, logs, comments, patches, artifacts and source files never enter the prompt.
There is no checkout or execution of repository scripts. Copilot 1.0.95 installs
without lifecycle scripts or a token; that exact install and version startup
were verified during the preceding manual pilot preparation. Node 22+ and the
expected CLI version are checked before a token is supplied to the model process.
The only exposed tool is `view`, and reads are explicitly denied alongside shell,
writes, URLs and memory; MCP, custom instructions and remote sessions are disabled.

## Delivery, time and spending boundaries

- Only workflow run numbers 1–3 and attempt 1 may proceed. Any failed/skipped run
  consumes a slot; there is no retry or manual dispatch trigger.
- A fixed concurrency group serializes observations. The current run must be
  present in complete bounded history with its expected source-ID display title;
  any other run with that title, or unknown history, blocks duplicate processing.
  History is not a durable exactly-once ledger. Deletion/retention can remove
  evidence; the run-number cap is an independent limit, not protection against
  administrative workflow recreation. Never delete history or reset the cap.
- The absolute deadline is checked during gates and immediately before spawning.
  Process timeout is the smaller of 90 seconds and remaining time; the process
  group is killed on timeout with no grace extending past the deadline. The job
  limit is six minutes. No new model process starts after the deadline.
- One CLI invocation per accepted run is not one guaranteed provider request.
  Internal provider retries may exist. Existing account spending blocks remain
  the financial boundary; no budgets, subscriptions, secrets or paid APIs change.
- Token permissions are contents/actions/pull-requests read and Copilot requests
  write. There is no issue comment, source write, dispatch, deployment or merge
  permission. Model responses are bounded and escaped as untrusted log text.

This experiment tests **CI event → constrained Copilot observation**. It does not
wake ChatGPT, execute a repair, supply authenticated review evidence, or implement
durable queues/shared leases. Hourly Lead and all SOURCE_AUDIT boundaries remain
unchanged. Lead retains all merge authority.

## Review and stop procedure

Before merge/run, require exact-head/base CI and independent review under existing
Lead gates. Record source/control SHAs, source and pilot run IDs, observation status
and actual usage when available. At 19:20 Vienna, report results using the existing
scheduled report and disable this workflow; disable earlier on any unexpected
behavior. Cancellation/disable prevents future work but does not undo observations
already completed. Do not rerun failed attempts or extend the deadline/cap without
new owner approval. Remove this temporary workflow in a separately reviewed cleanup.

Receipt tests cover accepted terminal conclusions, stale heads, forks, foreign
workflows, post-merge CI absence/failure, duplicate delivery, unknown history,
caps and deadline expiry, plus process-group termination. Offline tests do not
prove live event receipt, token entitlement, billing state or Copilot output quality.

Official references:
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://github.com/github/copilot-cli/releases/tag/v1.0.95
