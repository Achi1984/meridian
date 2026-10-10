# Copilot one-shot read-only pilot

Owner approved this exact scope in chat on 2026-10-10 at 18:01:59 Europe/Vienna:
"Ja gebe ich frei go" after the proposal for a new workflow with
`copilot-requests: write` for one manual read-only test. Provenance: issue #647.
Additional AI-credit and Actions spending is blocked in the owner's account;
do not change budgets or publish private billing screenshots in this public repo.

## What this tests

Can the built-in GitHub Actions token use the personal owner's existing Copilot
subscription to return a short answer? This is NOT a code review, a ChatGPT wake-up,
an event dispatcher, a source execution, a durable queue or a merge authorization.
The model sees only a bounded typed projection from the pinned main checkpoint.
No checkout, repository scripts, issue text, custom instructions, MCP or model tools
are used. No new secret or separate paid API is introduced.

## Gates and limits

- Manual dispatch on main by Achi1984 only, personal User ownership only;
  `run_number == 1` and `run_attempt == 1` additionally reject new runs and reruns.
- Fixed concurrency group; the workflow's run history must contain exactly the
  current run. A prior failed/skipped run also consumes the attempt. Concurrent
  dispatches may block both, safely. Never delete history to reset this gate.
- History is NOT a durable exactly-once store: deletion or retention expiry can
  remove it. The run-number guard adds an independent barrier, but neither is a
  tamper-proof ledger against administrative reset/recreation. Dispatch once only
  and disable the workflow after its terminal run.
  Do not reuse/reactivate it; a later pilot needs fresh authorization.
- 6-minute job limit; 90-second model-process timeout and 10-second kill grace.
  One CLI invocation, no retry/autopilot/subagents. Provider-internal requests may
  exceed one; this is not a hard token/credit cap. Account spending blocks remain
  the financial boundary. Stop on unavailable quota, unsupported auth or flags.
- CLI pinned to official `@github/copilot@1.0.95`; install has no explicit token,
  no lifecycle scripts and no repo checkout. Tool denials and an isolated working
  directory reduce risk; this is not an OS sandbox for a compromised CLI package.
  Only the `view` tool is exposed, with all reads explicitly denied; other tools
  including subagent delegation are absent from the allowlist.
  Exact-version local verification: install with `--ignore-scripts` succeeded
  (three packages); `copilot --version` returned 1.0.95, and help listed the selected
  control flags. This is stronger evidence for this package than generic install
  guidance requiring lifecycle scripts, but not proof of Actions authentication.
  Runtime fails closed unless Node 22+ and CLI version 1.0.95 are available.
- Only contents/actions read plus Copilot request permission. No repository write,
  issue/PR comment, deployment, workflow-dispatch or merge permission.
- Response is untrusted and escaped in logs; never executed or consumed as authority.
  A non-empty answer proves connectivity only, not factual correctness.

## Lead runbook

1. Require exact-head/base CI, independent review and recorded owner approval.
2. Merge through the existing guarded Lead process; verify required post-merge CI.
3. Reconfirm account blocks and no previous pilot run, then dispatch once on main.
4. Capture run/head/CLI exit, bounded response and actual credit usage if available.
5. Disable this workflow after completion/failure; no retries without owner decision.
6. Propose a separate bounded event-driven pilot only after this evidence exists.

No changes to the hourly Lead, Claude reviewer, #648 offline intake, routine merge
policy, production or frozen SOURCE_AUDIT research boundaries.

Official references (checked 2026-10-10):
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/copilot-cli-in-github-actions
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- https://github.com/github/copilot-cli/releases/tag/v1.0.95
