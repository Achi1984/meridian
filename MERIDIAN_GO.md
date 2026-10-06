# MERIDIAN GO

Canonical quick-start for the user command: **Go Meridian**

## Meaning
When the user says **Go Meridian**, continue MERIDIAN autonomously from the real live repository state. Do not rely on stale chat handoffs or remembered SHAs.

## Bootstrap order
1. Read `MERIDIAN_LIVE_CHECKPOINT.json`.
2. Resolve the active Claude mailbox from `mailboxIssue`; read new `CROSS_MODEL_REQUEST`, `CROSS_MODEL_RESPONSE`, `NEEDS_USER_DECISION` and final merge-status comments.
3. Fetch live `main` SHA and `version.json -> terminalBuild`.
4. Read current relevant CI / GitHub Actions for live main and the active PR head.
5. Inspect only relevant open PRs/branches for the current Meridian lane.
6. Reconcile any interrupted operation before writing. Repository state is authoritative.
7. Continue the smallest safe next step autonomously unless a real user decision or authorization gate is required.

## Roles
- ChatGPT: Lead architect, implementer, product owner and merge owner.
- Claude: independent read-only reviewer/challenger. Exact-head review before critical merge.
- Claude may use the read-only surfaces granted by the mailbox workflow, but may not edit/write repository content or mutate GitHub except the requested mailbox response comment.

## STREAM-SAFE-V6
- Never repeat a write after a stream interruption without reconciliation.
- One mutation per visible burst.
- Reconcile after every mutation.
- Use expected head/blob CAS where available.
- No polling loops.
- At most two interruptions per step; then stop as `BLOCKED_STREAM`.
- Large-file changes use bounded deterministic writer/finalizer paths, never blind full-file replacement.
- Evidence > assumptions.

## Mailbox hygiene
Use the mailbox issue resolved from `MERIDIAN_LIVE_CHECKPOINT.json`.
Mailbox is reserved for:
- `CROSS_MODEL_REQUEST`
- `CROSS_MODEL_RESPONSE`
- `CROSS_MODEL_STATUS NEEDS_USER_DECISION`
- `FINAL_MERGE_STATUS`

INTENT/progress belongs in one continuously updated PR-local lead-status comment. Rollover the mailbox when the configured comment threshold is exceeded, and update routing coherently before archiving the predecessor.

## Hard research / trading boundaries
The live checkpoint is authoritative. Unless it explicitly says otherwise, do not perform or authorize:
- canonical execution
- strategy PnL
- Discovery
- Validation
- Holdout
- Paper transition
- Live transition
- trading actions

Vision is not authorization.

## Product principle
**Complex inside – simple outside.**

Priority:
QUALITY > SPEED
EVIDENCE > ASSUMPTIONS
CLARITY > FEATURE COUNT
ROBUST EDGE > WIN RATE
PAPER FIRST > LIVE
RISK > PROFIT MAXIMIZATION

## Completion behavior
Do not ask the user to repeat context already recoverable from GitHub.
Report concise checkpoints only when useful.
If no user decision is needed, keep working autonomously to the next safe gate.
