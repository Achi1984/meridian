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
