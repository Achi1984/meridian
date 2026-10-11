# Event write deduplication and fencing preparation

Status: **inactive source-only prototype**. No receiver, model, dispatcher,
workflow or GitHub writer imports or invokes this module. No activation or
merge authority is granted. This is the bounded next preparation after #673.

## Boundary and reuse

`scripts/event-write-fence.py` uses standard-library SQLite for a local,
cooperating-process journal. Unlike the review request ledger (one consumed
review request), it binds a stable upstream event identity to a code-write
operation and serializes that branch's writers. It does not replace or modify
the review ledger, V3 offline replay store, or unmerged #642/#648/#661.
Those remain separate prototypes; no shared deployment is claimed.

The caller must authenticate and canonicalize each event, retaining its
`eventKey` across duplicate deliveries and retries. A changed operation ID
cannot bypass a consumed event. The event is unique across this repository,
including across branches. Every writer (Lead, model, manual and scheduled)
must participate in the same future coordinator. An invented event key is
not authenticated authorization, and deliberately changed keys are not
detected as semantically identical events.

## State and transaction contract

The CLI takes `--db PATH reserve|begin|settle` and bounded strict JSON on stdin.
`reserve` takes exactly repository, branch, eventKey, opId, writer,
expectedHead, expectedBase, intendedHead, payloadSha256, expiresAt (epoch ms,
within five minutes) and expectedFence (initially zero). SHA fields are full
lowercase Git SHA-1 values; payload digest is lowercase SHA-256. Repository
is fixed to Achi1984/meridian. Identities are case-sensitive opaque tokens;
trusted callers must supply a canonical branch name, never aliases.

Each BEGIN IMMEDIATE transaction checks expiry again after lock acquisition,
permanent event/operation uniqueness, the expected branch counter, and absence
of an active writer. Reservation consumes both identities permanently and
increments the branch fence. SQLite synchronous=FULL precedes the transaction.
The returned receipt has authenticated/mayWrite/mayDispatch/mayMerge=false.

`begin` requires opId, writer and fence. It moves RESERVED to STARTED once,
before a hypothetical external call; a lost acknowledgement never authorizes
another begin. Expiry rejects begin but never reclaims the branch. There is no
lease takeover, renewal, row deletion or automatic retry.

`settle` additionally requires outcome, observedHead and evidenceSha256:

| Outcome | Allowed state and supplied observation | Effect |
| --- | --- | --- |
| ABSENT | RESERVED only; original expectedHead | Cancel and free scope; event/op remain consumed |
| APPLIED | STARTED only; exact intendedHead | Record observation and free scope; identities remain consumed |
| UNKNOWN | RESERVED or STARTED | Permanently block scope pending out-of-band recovery |

ABSENT after STARTED is rejected: an unchanged ref does not prove a timed-out
write cannot still arrive. Terminal operations cannot transition again. Old
writer/fence tokens cannot alter a newer reservation. APPLIED and ABSENT are
**caller-supplied observations**, not authenticated proof; neither authorizes
another operation or merge. The module does not read GitHub head/base or verify
that intendedHead corresponds to payloadSha256.

## Limits and activation gates

All workers must use one trusted, persistent database on a filesystem with
correct SQLite locking/durability. Separate GitHub runner copies do not share
a fence. Database placement, permissions, symlink safety, backups, rollback
protection and hostile-writer resistance are out of scope. Missing/deleted
storage can reset history; production must fail closed on missing provisioned
storage, not silently initialize it. This prototype initializes empty storage
for offline tests only. No cross-host or hostile-storage proof is claimed.

SQLite serializes ledger transitions, **not external effects**. A real sink
must independently enforce authenticated authorization, stable event mapping,
budget, live exact head/base CAS and current fencing, including delayed stale
requests. GitHub ref updates do not consume this SQLite token automatically.
A process can crash between journal commit and external write, or before saving
the result. Such uncertainty stops the pipeline. There is no exactly-once
external-write guarantee. Operator recovery must stop all writers and preserve
the journal and remote evidence; no automatic unlock is implemented.

Before activation: choose and protect shared durable storage, implement trusted
event transport and evidence collection, demonstrate all-writer sink fencing,
crash/late-delivery recovery and finite budget enforcement, then obtain concrete
owner approval plus exact-head independent review. No changes to existing
workflows, permissions, credentials, costs, UI or research/trading gates here.

## Validation

`node --test test/event-write-fence.test.js` covers real competing processes,
same-scope different events, permanent identity reuse, wrong writers/fences,
unsafe absence, unknown outcomes, a crash after committed start, and expiry
during SQLite lock contention. Synthetic inputs and local filesystem success
do not establish live transport, authentication or distributed safety.
