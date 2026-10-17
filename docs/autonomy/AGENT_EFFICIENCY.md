# Bounded agent work packages

Use this contract to reduce repeated work while preserving Meridian's existing
approval, exact-head review, runtime and research boundaries. This document grants
no new permissions. ChatGPT remains lead and sole merge owner; keep the existing
limit of three active work packages, including review and continuity work.

## Before starting

Use [the work-package template](../../.github/ISSUE_TEMPLATE/agent-work-package.md).
Name one objective, the allowed files, exact base and input evidence, dependencies,
acceptance checks, prohibited effects and a stopping condition. Assign one writer
per worktree. Delegate independent bounded work only within existing authority;
do not assume a GitHub writer agent exists or provision one implicitly.

Read relevant source and project rules before changing files. Resolve a concrete
uncertainty; do not add framework exploration or unrelated cleanup to the packet.

## Evidence and review

Record each check's exact command, result, tested head or local candidate identity,
base, relevant input/dependency hashes and environment/toolchain. Reuse prior
verified evidence only when its covered inputs, dependencies and environment are
unchanged and its scope still applies. Identify the original receipt and explain
why it remains applicable; never relabel an older run as a new-head execution.

After a complete prior review, review the delta and uncovered dependencies rather
than rereading already covered unchanged material. List every reused dependency by path/hash and prior coverage receipt; record
the coverage mapping and any invalidated evidence. The final verdict must still cover the full requested
scope and bind to the exact final head/base. This optimization cannot waive a
mandatory check, exact-head CI, required local execution or independent review.
If a required check cannot run, report the missing evidence and stop at that gate.

GitHub CI provides execution evidence. The existing Claude mailbox job is a
reviewer only under its current permissions: it may inspect evidence and run
permitted read-only checks, but cannot change checkout/worktree, edit source or
act as an implementation agent. Its only permitted remote mutation is the
requested review response in Mailbox639. A green CI run is not a review verdict.
A local test against another checkout is not an exact-head test. Neither this
contract nor an evidence link overrides the reviewer's mandatory checks.

## Scheduling and measurement

The existing mailbox workflow already has a 35-turn limit, a 35-minute job timeout
and issue-scoped concurrency with cancellation disabled. Do not reduce these
blindly or change workflows, credentials, permissions or schedules through this
contract. Investigate a measured bottleneck before proposing a separate change.

Record CI/review run and job IDs, attempt, conclusion and observed elapsed job
seconds when available. Elapsed job seconds are **not billed minutes**. Queue time,
local elapsed time and job duration are different measurements; label each.
Actual token usage is unknown unless the provider reports it for the identified
run. Do not infer tokens from turns or invent euro costs, billing or savings.

Prepare one consolidated handoff per completed merge block; preserve an unpublished
draft while dependent merges are pending. Refresh it against the resulting main
and run its own required gates. Keep intermediate receipts in their existing
locations rather than repeatedly publishing the same continuity files.

## Completion report

Return the exact files and candidate identity, objective outcome, actual checks and
receipts, reused evidence with its scope, unresolved risks and the next gate.
Separate source completion, publication, merge/postchecks and runtime readiness.
Do not claim results for pending jobs or actions not performed. Stop optional
retesting once acceptance is satisfied; mandatory gates remain mandatory.

Do not install an entire ECC or other plugin bundle merely to accelerate work.
Evaluate only a concrete missing capability, its provenance, dependencies and
permissions within a separately bounded proposal. Existing agents and tooling are
the default; no blanket plugin installation or new external access is authorized.
