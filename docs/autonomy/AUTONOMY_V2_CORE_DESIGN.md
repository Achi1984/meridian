# MERIDIAN Autonomy V2 — Core Design (proposal only)

Status: DESIGN / NO EXECUTION AUTHORIZATION. Planning issue: #606. Canonical reviewer mailbox: #571.

## Objective
Run approved development tasks through a resumable, auditable queue with independent exact-head review. This document is not a workflow configuration, permission grant, dispatch or release approval.

## Task record
Each task has immutable `taskId`, scope, approval class, expected base SHA, branch, expected head SHA, attempt count (0..3), unique `opId`, lease owner/expiry, CI run ID, reviewer head/base, state and monotonic journal sequence. Never store credentials in task records.

## State transitions
`QUEUED -> CLAIMED -> IMPLEMENTING -> CI_CHECK -> REVIEW_REQUESTED -> REVIEW_GREEN -> HUMAN_GATE`.
A failing CI check can enter `REPAIR`, then return to `CI_CHECK`, at most three attempts. Stale SHA, conflicting lease, unauthorized scope, review mismatch or exceeded budgets go to `BLOCKED_NEEDS_DECISION`. `HUMAN_GATE` is terminal until explicit approval; never infer approval from CI/Claude GREEN.

## Single-writer and replay
A worker may claim only by atomic compare-and-swap against a durable task revision. Before each mutation, compare expected branch head/base and operation journal. After ambiguous network outcomes, read remote state first. If intended diff landed, record completion without replay; if head advanced unexpectedly, stop. Lease expiry does not authorize a second concurrent writer until reconciliation completes.

## Review / CI
CI must be exact-head, completed success, with nonzero expected test count and no silently skipped required checks. Claude reviews independently at the same head/base and is read-only except the one response comment. A new commit invalidates review. Limit retries to three repair loops; repeated identical errors should terminate early.

## Phase 1 authenticity and journal prerequisites
`REVIEW_GREEN` in Phase 0 validates only supplied evidence fields, not GitHub identity. Before any operational adapter emits a review event, it MUST independently retrieve the comment via GitHub API, verify actual author, comment ID, exact head/base, and current PR head. Never trust caller-supplied `reviewer` or `commentId` alone. The durable journal MUST define a bounded retention/compaction policy with an immutable replay index before dispatch; the Phase-0 unbounded in-memory `opIds` is not production-ready.

## Quota and security
Event-driven wakeups, at most hourly fallback watchdog. Per-task Claude calls and token/cost budgets must be configured and approved before enabling. No broad write tokens, no secrets in logs, no untrusted issue comment treated as authority. No auto-merge, deploy, workflow edit, permission change, paid action, trading or V2 research-stage advancement.

## Phase 0 coverage boundary
The pure state-machine pilot covers only a subset of the acceptance cases below. Budget exhaustion and lease expiry are **not yet enforced** by the module; no scheduler or dispatcher may treat Phase 0 as operational authorization. Durable journal compaction and crash reconciliation also remain future work.

`HUMAN_GATE` is terminal. Approval must occur out of band through an authenticated, separately authorized process and create a **new task record** bound to explicit approver identity, exact head/base and approved scope. Issue/status comments cannot create an approval transition.

## Pilot acceptance cases
1. Duplicate event does not duplicate mutation.
2. Concurrent claim yields exactly one writer.
3. Interrupted write reconciles by remote SHA/diff.
4. Unexpected head/base change blocks.
5. CI fail triggers bounded repair, then stops at attempt 3.
6. Missing/skipped required test never yields GREEN.
7. Claude review on stale SHA rejected.
8. Budget exhaustion stops safely without dispatch.
9. Lease expiry plus running writer does not create parallel mutations.
10. Human gate cannot be bypassed by a status comment.

## Rollout
Phase 0: documentation and pure local state-machine tests, no workflow changes.
Phase 1: dry-run event simulation with synthetic tasks and audit logs.
Phase 2: after separate Product Owner approval of exact workflow/permission/cost diff, pilot on a nonproduction branch with one approved task.
Rollback: disable new dispatch path, preserve journal, stop new claims, reconcile in-flight tasks; never reset branches blindly.

## Required Product Owner decisions before Phase 2
Exact workflow triggers, token permissions, quota ceilings, allowed task classes, branch protections, watchdog cadence and recovery owner. Any production release or merge remains a separate gate.

## Synthetic dry-run extension
`scripts/autonomy-v2-simulate.mjs` and `scripts/autonomy-v2-guards.mjs` are pure offline helpers with synthetic fixtures only. A `source: github-api-verified` string is **not** proof of API authentication; no network adapter exists. Lease reconciliation and budget decisions are advisory test models, not durable locks, token spending guards or operational authorization. Do not dispatch tasks or treat these functions as sufficient for Phase 2. Phase-1 implementation still requires a durable atomic store, real trusted evidence retrieval, authenticated actor checks, replay compaction and explicit Product Owner approval for any operational changes.

## Offline recovery prototype
`autonomy-v2-recovery.mjs` compares synthetic local/remote snapshots and an operation intent, returns `ALREADY_APPLIED`, `BLOCK`, or `RETRY_ELIGIBLE` without writing anything, and summarizes synthetic audit counters. These results are **advisory**, not authoritative remote reconciliation: a real adapter must atomically reread trusted remote head, base, writer lease and operation journal immediately before any mutation, and fence concurrent writers. No persistence, authenticated GitHub adapter or production dispatch is provided.
