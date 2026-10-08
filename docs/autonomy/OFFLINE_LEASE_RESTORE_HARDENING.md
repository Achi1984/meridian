# Offline lease and restore hardening

This correction stacks on PR #611 at `548ba776392cb05447487dfd88288237adbb60d6`.
It addresses CHANGES_REQUIRED mailbox comment 6065144005; the contradictory
GREEN on the same head does not supersede those findings. PRs #607, #608 and #611
remain independent Drafts. No workflow, permissions, quotas, costs, scheduler,
production import, persistence, dispatch, release or trading behavior is changed.

## Snapshot contract

The complete operation ledger is the offline replay authority. Restore replays
legal transitions from QUEUED and requires the resulting state, revision, active
writer/lease, claim charges and next fence to equal the snapshot. Revision equals
ledger length. Each CLAIM costs exactly one unit; recovery, requeue and terminal
operations cost zero. Unknown kinds, unknown fields, sparse entries, duplicate
local/global operation IDs and inconsistent snapshots are rejected.

Only CLAIM issues a new fence, strictly higher than the previous claim and
consecutive after the first claim. Other ledger entries reference the current
claim's fence. `nextFence` must be exactly one above the latest claim. An empty
initial ledger can seed a positive safe-integer fence counter; exhausted counters
cannot issue another lease. An active lease must match the latest CLAIM's owner,
expiry and fence. Sorting uses JavaScript code-unit order, independent of locale.

CLAIM ledger entries now contain `writer`, `now` and `expiresAt`. RECOVERY_MARK
and COMPLETED/FAILED entries contain `now`. Earlier experimental snapshots lacking
these fields are deliberately rejected; no silent migration or history invention
is performed. They are lab fixtures, not persisted production data.

## Expiry and reconciliation

`inspectExpired` requires caller-supplied expected revision and fence. The two
Phase-1A failures in run 37810416671 omitted those values after the CAS signature
change; named regression tests restore coverage and also assert stale CAS blocks.

`complete` requires an explicit safe-integer `now`, at or after the latest claim's
start and strictly before lease expiry. At expiry it returns LEASE_EXPIRED without
mutation or operation-ID consumption. Retrying a rejected ID after correcting
its arguments is allowed. Accepted IDs remain globally reserved through restore.

Expiry alone does not transfer ownership. Recovery must be explicitly marked,
then explicitly reconciled to QUEUED before a fresh claim. A new claim's clock
must not precede the previous lease's expiry. `reconcileToQueue` is an explicit
offline caller action; it does not authenticate a human or prove an old worker
has stopped. No operational authorization is inferred from it.

## Restart evidence and remaining limits

The restart harness rejects prototype property names and malformed arguments
deterministically. It preserves the whole simulation's audit output across
rebuilds; the store's own audit remains process-local. Snapshots retain the full
ledger and rebuild the global replay index. Regression cases cover crashes after
claim, recovery marking, requeue and reclaim, plus lost acknowledgements for
recovery/requeue/completion and third-claim quota exhaustion.

Crashes occur between synchronous operations, not mid-write. This is an in-memory
single-process lab, not a durable transaction system or an authenticated adapter.
Snapshot consistency cannot prove authenticity or detect replacement by an older
self-consistent snapshot. Durable rollback protection, authenticated clocks and
actors, side-effect fence enforcement, journal retention/compaction and a separately
approved operational adapter remain prerequisites before dispatch.
