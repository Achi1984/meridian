# Phase 1B offline snapshot contract

This contract addresses Claude's `CHANGES_REQUIRED` review of PR #611, mailbox
#571 comment 6065144005, at head `548ba776392cb05447487dfd88288237adbb60d6`.
It applies only to the in-memory laboratory. It grants no operational authority.

## Consolidation decision

The implementation follows PR #613 comment 6067930276. Both complete five-file
deltas were compared against their common #611 base. The canonical patch is #613
at `b2966239d777df06b3f2cfe9435c87211923bb53`, whose formal Claude review is
6067845479. PR #612 at `a8b5eadc573dd438b04a9902d41a3f6f3dbe1dbe` is an
alternative with different API and snapshot semantics. This consolidation is a
new Draft stacked on #613; it does not merge, close or modify either predecessor.
The earlier GREEN is evidence about its old head, not approval of this new head.

| Concern | #612 | Selected contract |
| --- | --- | --- |
| Recovery clock | Safe nonnegative integer | Same validation already exists in #613; now tested across all recovery states |
| Completion after expiry | Required clock and rejection at expiry | #613 advisory expiry until explicit recovery revokes the writer; offline only |
| Snapshot ledger | Additional writer/clock metadata, consecutive fences | #613 four-field ledger, increasing CLAIM fences and nextFence above all history; existing valid #613 fixtures retained |
| Audit returned by restart | Aggregates all simulation epochs | Current process epoch only, matching store audit |
| Recovery inspection | Caller CAS | Named Phase-1A waiting/expiry/stale-CAS cases carried forward |
| Crash after final operation | Neither harness rebuilt at that boundary | Rebuild exactly once, including an empty list and terminal outcomes |

The recovery planner has the identical source blob
`f1a69e3295606ef63f48da995e450bb599d54207` at both old heads. No missing clock
validation was imported or claimed. Additional regression cases exercise unsafe
clock inputs, the last safe clock, near-exhausted fences, quota precedence and
rejected-ID retry. A shared plain-data guard now rejects malformed, inherited or
accessor-bearing planner contexts, restart options and operation wrappers before
reading their values. This follows #613's stricter own-data-field checks.
The input guard and whitespace-only lease-writer rejection are new planner checks
in this consolidation; the safe-integer clock check itself is unchanged.

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

The input boundary is serialized JSON or equivalent plain data records, including
null-prototype records. Hostile executable JavaScript proxies are outside this
contract: reflective operations may invoke proxy traps. A durable adapter must
parse serialized input at a trusted boundary rather than accept arbitrary live
objects. The plain-data guard does not provide an execution sandbox.

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
crash at the selected boundary of accepted operations, including before the first
and after the final operation. `crashAfter: 0` rebuilds an empty operation list once.
`crashAfter: operations.length` rebuilds after all operations succeed, leaving an
empty current-epoch audit and an intact snapshot/replay index. An index above the
number of accepted operations, or the default Infinity, produces no restart.
Rejected operations do not advance that counter. The harness does not model a
crash inside an atomic durable write or real concurrent processes.

## Verification

The security regression suite covers malformed history, fence reuse, ledger/state
and revision mismatches, charge rules, schema extensions, prototype operation
names, null arguments, valid recovery and terminal restores, all-operation replay
and global collisions, rejected-attempt retry, stale writer/fence/revision,
quota exhaustion, every inter-operation crash boundary and volatile audit scope.
The original offline tests now use legal lifecycle records for budget and global
collision fixtures. No persistence, workflow, permissions, dispatch, production
imports, research-stage changes or trading behavior is introduced.
