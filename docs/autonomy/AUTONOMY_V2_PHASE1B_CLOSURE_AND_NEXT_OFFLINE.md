# Phase 1B closure and next offline stage

This is an offline development and integration proposal. No merge, release,
workflow, scheduler, permission, spend, research-stage or trading authorization.
No production coordinator, dispatch, storage, network or paid execution is enabled.

## Reconciled implementation

Live main at reconciliation: `8a8a43fc8df4e440294bf7ef5747510b6c6a44d0`.
Existing Phase 1B cumulative head: `83fa93dc626bdb03d67084de4b6e89d428d8f4ee`
(Draft #614). New closure changes belong to that existing Draft; no competing
Autonomy implementation PR is needed. CI and old reviews do not cover a new head.

| Capability | Existing source and contract | Closure action |
| --- | --- | --- |
| Synthetic state/review/intent model | #607, state, guards, recovery and coordinator modules; synthetic evidence only | Preserve; does not authenticate remote reviews or authorize execution |
| Atomic in-memory claims | offline-store: revision + head + base CAS, writer, budget charge and lease committed together | Preserve |
| Recovery | offline-recovery: safe clock, exact revision/fence, advisory expiry and explicit reconciliation; no automatic writer transfer | Preserve |
| Fencing | offline-store: positive safe fences; nextFence exceeds complete claim history; terminal and queued restore checked | Preserve |
| Ledger consistency | offline-store: ordered legal lifecycle, revision equals ledger length, claim units sum to budget, current lease equals latest claim | Preserve; reject arrays that can present a different history during iteration and clone |
| Replay and collisions | global accepted-ID index reconstructed on restore; all mutators reject retries/cross-task reuse before mutation; rejected IDs remain reusable | Preserve; close array-induced ledger/index divergence |
| Crash/restart | offline-restart: real snapshot/rebuild, one crash at every accepted-operation boundary including empty and terminal list, current-epoch audit only | Preserve; require dense ordinary own-data operation arrays |
| Unknown operations | own-key allowlist; no constructor/toString dispatch; malformed plain-data arguments rejected | Preserve |
| Budget and exhaustion | each accepted claim charges one unit; follow-ups zero; quota checked before safe-counter exhaustion; bounded lease arithmetic | Preserve |

### Reproduced additional gap

Before this closure, a one-entry operations array could contain CLAIM fence 9 and
operation ID `shadowed`, but define its own Symbol.iterator to yield CLAIM fence 1
and ID `validated`. Validation accepted an active snapshot at nextFence 2; the
replay index registered `validated`; structuredClone stored the actual indexed
entry `shadowed` at fence 9. Completion using ID `shadowed` was then accepted,
producing fences [9,1] and two occurrences of that operation ID. A changing index
getter could create the same disagreement between the validation, ID-index and
clone passes. No proxies or production effects are needed for this reproduction.

The shared descriptor-only array guard now rejects sparse arrays, subclasses,
custom/null array prototypes, symbol/extra properties, index accessors and hidden
indices before iteration or cloning. It validates own-key count rather than
walking a huge sparse length. Frozen ordinary arrays and dense arrays containing
null-prototype records remain valid. Store task lists, ledgers and restart
operation lists use the same boundary. Hostile proxies and ambient mutation of
JavaScript intrinsics remain outside the plain-data contract.

The new deterministic regressions cover each rejected array shape at all three
boundaries, zero getter/iterator invocations, the reproduced fence/replay defect,
frozen/serialized round trips, and fence/budget/replay invariants across all crash
boundaries. Existing recovery and expiry semantics remain unchanged.

## Safe integration preparation

| PR | Reconciled exact head | Relevant Release Safety | Review / integration implication |
| --- | --- | --- | --- |
| #607 | 58bcf67dc421870ce3b73a5b6ca401a1256384a5 | 37786206667 success | Design/synthetic foundation; no operational authority |
| #608 | 79b5239946f94da19cc076be77d7b246eb639184 | 37810416671 failure | Do not integrate independently; failed expiry case is superseded by #611's fenced expiry fixture |
| #611 | 548ba776392cb05447487dfd88288237adbb60d6 | 37814460784 success | R1 has conflicting responses 6065144005 and 6065158520; effective CHANGES_REQUIRED, never inherit a later GREEN onto this head |
| #613 | b2966239d777df06b3f2cfe9435c87211923bb53 | 37834096755 success | Exact-head GREEN_LIGHT 6067845479; snapshot/fence/ledger hardening |
| #614 baseline | 83fa93dc626bdb03d67084de4b6e89d428d8f4ee | 37839674323 success | Exact-head GREEN_LIGHT 6068534896; superseded when closure is published |

The stack is main -> #607 -> #608 -> #611 -> #613 -> #614. Preserve every branch,
base and historical response during this block. Do not retarget, rebase, close or
merge ancestors as part of implementation. The red #608 CI and adverse #611
verdict remain blockers for independent sequential integration of those heads.

Recommended later integration is one cumulative candidate based on the then-live
main, carrying the final reviewed offline tree, rather than exposing known-bad
intermediate heads. Prepare it from exact verified cumulative changes; exclude
the alternate #612 implementation and unrelated Ops/V11 changes. This proposal
creates neither that candidate branch nor a main-target PR. It is a separate
protected mutation after this Draft's closure CI/review. A new base/head requires
fresh complete CI and a fresh exact-head/base Claude review in #571. Descendant
review evidence is never transitive merge permission for an ancestor.

Before any integration the Lead must verify exact files/tree, current main and
base, successful complete CI, one unambiguous independent review, single writer,
all unchanged research flags and explicit merge ownership. Codex does not merge.

## Next useful offline stage: simulated atomic persistence

Prepare Phase 1C as a separate reviewed design/implementation block using only
in-memory injected storage and synthetic clocks. The goal is to test crash points
inside a transaction, beyond Phase 1B's inter-operation snapshot rebuilds.

Proposed fixture contract:

1. An injected memory adapter atomically commits generation, task state, ordered
   operation ledger, budget and accepted-ID index. Compare generation/head/base
   before commit; two synthetic writers cannot both win the same generation.
2. Persist a synthetic high-water mark outside each task snapshot. A rolled-back
   but internally consistent snapshot must be blocked against that mark; loading
   older data cannot lower a published fence. Do not treat the current ledger as
   proof of authenticity or rollback resistance.
3. Inject deterministic faults before staging, after staging, before atomic commit,
   after commit and before acknowledgement. A pre-commit crash leaves old state;
   an acknowledged or unacknowledged committed operation is charged once and
   rejected on retry. No partial ledger/budget/replay-index state is accepted.
4. Verify multi-task ID collisions, stale generation/head/base/writer/fence,
   quota/counter exhaustion, rejected-ID retry, corrupt data and unknown records.
   Recovery reports a decision; it never authenticates a human or dispatches work.
5. Keep the existing advisory-expiry policy until a separately reviewed contract
   explicitly changes it. Model side-effect fence admission as a pure synthetic
   function; do not execute a real side effect.

A real durable adapter additionally needs trusted storage/authentication,
rollback-resistant external authority, authenticated reconciliation and fence
checks at every side-effect boundary. Those are open risks, not Phase 1B features
or authorizations. Disk/network storage, live workers, schedulers, spending and
production/research/trading activation require separate authorization and review.

Closure is ready for independent review after the new exact head passes CI.
No new head may reuse #614 baseline GREEN_LIGHT. The next mailbox request must
use a new ID bound to that head and the unchanged exact base, inspect #571 for an
existing matching request/response and avoid duplicate writes. This development
block spends its single protected mutation on the Draft head; requesting review
is a later mutation after successful CI, never an additional write in this run.
