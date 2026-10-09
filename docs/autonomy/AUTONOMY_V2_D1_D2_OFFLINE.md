# D1 + D2: direct Codex orchestration, offline foundation

Status: offline development only. This module set grants no cloud execution,
GitHub mutation, workflow, credentials, paid action, merge or trading authority.
Product Owner: Christoph. Integration and merge owner: ChatGPT. Independent
exact-head reviewer: Claude via the live checkpoint's mailbox (currently #571).

## Contract boundary

D1 uses schema version 1. Tasks require taskId, requestId, opId, repository,
targetBranch, expectedHeadSha, expectedBaseSha, taskType, scope,
allowedOperations, budgetLimit, timeout, approvalState, reviewState, createdAt
and expiresAt. Time is an injected safe integer in milliseconds; budgets use
synthetic integer units, never money or provider tokens. Paths name exact files;
there is no glob expansion or ambient filesystem access. Contract changes need
a new version; unknown fields and values fail closed.

The caller supplies a separate synthetic policy that pins repository, branch,
SHAs, scope, operations and ceilings. Approval and review strings are lab
fixtures. They are not authenticated Product Owner approval or Claude evidence.
The pure queue owns admission, global ID history, generation CAS, fencing,
single-writer ownership, budget accounting and terminal transitions. Identical
accepted requests are recognized without executing them again; conflicting IDs
fail closed. Rejection never weakens existing accepted replay history.

Public entry points are `validateTaskContract(task, context)`,
`canonicalDigest(data)`, `createMemoryAuthority()` and
`createTaskQueue({authority, snapshot?})`. Queue operations are `enqueue`,
`prepare` and `finish`; reads are `get`, `snapshot`, `checkpoint` and `audit`.
Only own enumerable data fields and dense ordinary arrays are accepted. Records
are detached at admission and at every read; accessors and callbacks are rejected.
The three ID classes share a global namespace, so a request ID cannot be reused
as another task's operation ID. The first admitted entry revision is 1;
preparation advances it to 2 and every accepted terminal event advances it again.

```js
const authority = createMemoryAuthority();
const queue = createTaskQueue({authority});
queue.enqueue(task, {...policy, now: task.createdAt});
const adapter = createOfflineCodexAdapter({queue, policy});
const prepared = adapter.prepare({taskId: task.taskId, opId: 'prepare-1',
  writer: 'offline-lead', revision: 1, now: task.createdAt + 1});
// Check prepared.ok before using its ticket.
const finished = adapter.finish({ticket: prepared.ticket, opId: 'finish-1',
  now: task.createdAt + 2, scenario: {kind: 'success'}});
```

The `policy` is a separate plain-data record with repository, targetBranch,
expectedHeadSha, expectedBaseSha, scope, allowedOperations, budgetMax and
timeoutMax. Admission context additionally supplies `now`. Every queue mutation
uses a unique operation ID, entry revision and explicit expected head/base;
terminal events also require the issued fence and writer.

## Adapter boundary

D2 prepares a deterministic descriptor from an admitted task and a fenced
ticket. Its built-in fake runner produces data and artifact metadata only.
It does not execute commands, read files, call Codex, access the network, load
credentials, mutate GitHub or perform jobs. Plain-data scenarios inject faults;
there is no arbitrary runner callback. Results bind to task and exact SHA pair.
Malformed, out-of-scope, over-budget, over-timeout, interrupted and stale results
cannot become successful completion. Terminal or interrupted work does not
automatically retry or acquire a second writer.

One preparation reserves one synthetic budget unit. A successful fake result
costs one further unit. Validated failure/interruption costs no additional unit;
the preparation charge is retained. Deadlines are exclusive: equality with
expiresAt or elapsed timeout rejects success. The allowed fault scenarios are
success, exception, invalid_result, budget_exceeded, timeout and interruption.
`ok: true` on a terminal response means the terminal state was committed;
callers must inspect `outcome` and `reason` before calling it successful work.

## Crash and snapshot boundary

The independent memory authority is a shared, synthetic coordination fixture.
Its checkpoint lives outside the replaceable queue snapshot and pins the
accepted generation, digest and fencing history. Rebuild replays and validates
the complete event ledger, then compares it with that authority. Truncated,
tampered or older snapshots fail closed. Two queue views sharing one authority
cannot both commit against the same generation. Accepted operation IDs, budget
and audit history survive a queue rebuild with that same authority.

| Boundary | Safe continuation |
| --- | --- |
| Rejected admission or CAS | No accepted ledger/ID/budget change; reconcile before a new attempt |
| Preparation committed, acknowledgement lost | Retained snapshot identifies PREPARED; do not prepare or run it again |
| Adapter restarted with PREPARED task | New adapter rejects execution of the inherited ticket; explicit interrupt can close it |
| Completion committed, acknowledgement lost | Retained terminal ledger and operation ID reject replay; read the recorded evidence |
| Snapshot incomplete, altered, or older than authority | Restore fails closed; do not create a fresh authority to bypass the failure |

This proves single-process model invariants. The authority itself is not durable
or authenticated. Restarting the entire application with a fresh authority loses
the trusted anchor and does not prove rollback resistance. Hostile JavaScript
proxies and mutated language intrinsics remain outside the plain-data boundary.
Hashes detect differences against a retained anchor; they do not authenticate
an adversary-controlled snapshot and checkpoint pair.

The complete ledger currently grows without compaction. D3 requires bounded
retention and an immutable replay index; deleting history to permit old IDs is
forbidden. Raw queue terminal transitions model state only; operational callers
must not bypass authenticated adapter checks through that low-level API.

## Reused foundation and review evidence

The proposal carries the offline foundations and regression tests from #614,
including the canonical #613 ledger and dense own-data array checks. #612's
alternate mandatory completion clock and aggregated audit are not imported.
Legacy Phase 1B completion expiry remains advisory until explicit recovery
revocation. D1/D2 has its own timeout and result boundary; it does not change
legacy semantics or connect the old raw state transitions to operational work.

The stack's old reviews are historical, exact-head evidence only. In particular,
#608's failed CI and #611's CHANGES_REQUIRED are not erased by descendant reviews.
A cumulative candidate on current main needs its own complete CI and review.
Mutable SHA/run evidence belongs in the publication manifest and PR description,
not in this stable contract document. Existing branches remain untouched.

## D3 interface and approval gates

D3 would replace the synthetic authority and fake runner with separately
reviewed implementations while retaining the task version, atomic reservation,
generation/head/base CAS, global replay index, side-effect fencing, result
validation and audit evidence. It must provide authenticated actor and approval
identity, authenticated exact-head review/CI evidence, trusted clock, durable
atomic transactions and an external monotone rollback anchor. A process-local
Map or caller-supplied SHA is insufficient.

Before a D3 cloud pilot, Christoph must explicitly approve the exact task class,
repository/branch/scope, provider and credential mechanism, minimal permissions,
monetary/token ceilings, timeout, concurrency, cancellation and recovery owner,
workflow/runner changes, retention/replay compaction, rollback/kill switch and
any cloud spending. The pilot needs fresh exact-head CI and independent Claude
review. D4 production operation and any research/trading authorization require
their own explicit decisions. D1/D2 does not authorize either stage.

## Verification

Run `node --test --test-isolation=none --test-reporter=tap
test/autonomy-v2-*.test.js` on Node 24 locally. Existing Release Safety runs the
ordinary full Node suite on Node 20 without any new workflow. Source syntax,
continuity, frozen research, orchestration, privacy and secret gates also apply.
Report actual assertion counts and distinguish local browser/sandbox limitations
from exact-head GitHub CI; old CI is never evidence for a new candidate head.
