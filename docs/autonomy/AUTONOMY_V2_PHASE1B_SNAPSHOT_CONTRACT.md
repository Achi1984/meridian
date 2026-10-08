# Phase 1B offline snapshot contract

This contract addresses Claude's `CHANGES_REQUIRED` review of PR #611, mailbox
#571 comment 6065144005, at head `548ba776392cb05447487dfd88288237adbb60d6`.
It applies only to the in-memory laboratory. It grants no operational authority.

## Restore and replay

A task starts QUEUED at revision zero with an empty operation ledger. Every
accepted mutation adds exactly one record and increments revision once. Restore
checks the complete ordered ledger, starting from that state:

| Kind | Required state | Result | Units | Fence |
| --- | --- | --- | --- | --- |
| CLAIM | QUEUED | CLAIMED | 1 | strictly greater than every earlier CLAIM |
| RECOVERY_MARK | CLAIMED | RECOVERY_PENDING | 0 | current CLAIM fence |
| REQUEUE | RECOVERY_PENDING | QUEUED | 0 | current CLAIM fence |
| COMPLETED | CLAIMED | COMPLETED | 0 | current CLAIM fence |
| FAILED | CLAIMED | FAILED | 0 | current CLAIM fence |

Follow-up records deliberately repeat their claim's fence; strict increases
apply to successive CLAIM records. Every fence is a positive safe integer.
`nextFence` must exceed every ledger fence, including for queued and terminal
tasks. It may skip values, permitting a reserved initial fence and an exhausted
counter fixture. An active lease must match the latest CLAIM fence, have a
positive safe-integer expiry, and name the current writer as its owner.

The derived state must equal the snapshot state, revision must equal ledger
length, and the sum of CLAIM charges must equal budget usage and fit its limit.
Task, budget, lease and operation records accept only their defined own data
fields. Unknown kinds, extensions, inherited fields, accessors, invalid counters,
duplicate IDs and illegal transitions fail closed. Invalid legacy fixtures using
NOTE or IO charges are rejected rather than silently migrated.

The ledger contains operation ID, kind, units and fence. It does not reconstruct
historical writer identities or timestamps. These are validated fields of the
current lease, not authenticated evidence. There is no protection against an
attacker coherently rewriting an entire snapshot, or rolling it back to a valid
older snapshot. A durable adapter needs trusted storage and a rollback-resistant
high-water mark outside the restored snapshot.

All accepted operation IDs are globally unique across the restored tasks.
Lost-acknowledgement retries return OP_ID_SEEN; cross-task reuse returns
OP_ID_COLLISION. Both reject before mutation. Rejected attempts do not consume
IDs and may be retried after their preconditions are corrected. Replay fixtures
use an own-key operation allowlist and reject malformed method arguments.
Snapshot task ordering uses JavaScript code-unit ordering, independent of locale.

## Expiry, reconciliation and audit

Lease expiry is advisory in this laboratory: `inspectExpired` only asks for human
reconciliation. An expired CLAIMED writer can complete until `markRecovery`
explicitly revokes it. Completion in RECOVERY_PENDING or after requeue fails CAS;
completion from an older claim after reclaim fails the fence check. Requeue is an
explicit caller action and does not authenticate a human or attest worker death.
A future adapter must authenticate that action and enforce fences at every
side-effect boundary before any dispatch is authorized.

`audit()` is process-local and resets on rebuild. `snapshotAll()` retains the
operation ledger and replay index authority for the fixture. `replayRestart`
returns the current process's audit, not a merged pre-crash audit. It simulates one
crash between accepted operations, including before the first operation; it does
not model a crash inside an atomic durable write or real concurrent processes.

## Verification

The security regression suite covers malformed history, fence reuse, ledger/state
and revision mismatches, charge rules, schema extensions, prototype operation
names, null arguments, valid recovery and terminal restores, all-operation replay
and global collisions, rejected-attempt retry, stale writer/fence/revision,
quota exhaustion, every inter-operation crash boundary and volatile audit scope.
The original offline tests now use legal lifecycle records for budget and global
collision fixtures. No persistence, workflow, permissions, dispatch, production
imports, research-stage changes or trading behavior is introduced.
