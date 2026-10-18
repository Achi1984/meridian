# M11 local research supervisor — synthetic source only

This package is an inactive execution foundation for later bounded research, not
a research authorization, profitability claim, autonomous service, or live/paper
trading integration. It makes no exchange orders and has no active captured-data
loader, market-data service, network client, model call, workflow, daemon, or
import-time action. It retains the legacy deterministic hash-chain fixture and
adds a generated-fixture B1 R3 session bridge. The B1 bridge runs strategy
calculations only on its immutable generated synthetic series.

## Contract and local journal

`scripts/research-supervisor/journal.py` is a dedicated, same-host SQLite journal.
`initialize(path)` creates a new mode-0600 database and refuses an existing file;
there is no migration, delete/reset operation, TTL, stale-claim reclaim, or retry.
SQLite transactions use `BEGIN IMMEDIATE` and `synchronous=FULL`. A trial key has
one canonical SHA-256 trial ID and is immutably bound to the fixed fixture protocol
hash, source/data hash strings, data-byte budget, ordered path manifest, and variant
IDs. Reusing a key with changed pins is a conflict. The source/data hash values are
caller-pinned identifiers only: the fixture does not load those artifacts or
authenticate that they match any bytes.

The original `synthetic` profile retains its fixed manifest of one
`synthetic-development` path followed by 43 `synthetic-frozen-control` hash-chain
paths. The named `MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1` profile is separate:
its manifest pins the B1 R3 engine's exact 44 output descriptors and its
development-first 19/diagnostic-last 25 computation order. Both profiles are
sequential; B1 uses `createExecution`/`advanceOne` rather than emulating or
duplicating engine calculations.

`scheduler_tick(database, policy, owner)` is a bounded, caller-invoked scheduler
tick. The default policy is OFF. It considers at most one oldest queued trial,
requires exact protocol/source/data pins, and atomically claims the job and reserves
the daily budget. Policy input explicitly supplies a one-batch-per-UTC-day limit,
up to 1,800 compute seconds, a data-byte ceiling, and zero model calls. Reservations
survive restart and new trial IDs; rejected jobs are retained. A claim consumes the
only attempt. Queue admission and an approved hash policy are not research,
holdout, or promotion authorization.

`supervisor.run_batch(database, claim)` starts the exact claim and launches only the
fixed local Node adapter, without a shell. Each path is a child-process/message
boundary. The child emits `path_started` and waits for a parent acknowledgement; only after
the parent validates the event and exact manifest ID and durably records it does
the parent acknowledge and start that path's deadline. The child then runs the path
and must emit a matching `path_completed` event and digest.
The per-path deadline is at most 60 seconds; the one absolute monotonic batch
deadline is at most 1,800 seconds. Shorter limits are used in tests. The parent
passes each journal write the remaining monotonic deadline and a maximum 10 ms
SQLite lock wait (whichever is shorter). A contended write fails without waiting
for SQLite's former five-second default; the parent kills/reaps the child group
before returning `UNSETTLED`. Failed start/progress/final settlement leaves the
last committed state and active fence intact for explicit reconciliation, never
an automatic retry. Successful path boundaries are acknowledged only after their
write commits. Standard
output and error are capped while being read (8 KiB and 4 KiB), input is capped at
8 KiB, and persisted results are capped at 1 MiB. The child receives only `PATH`
and `LANG`, runs in a new POSIX process group, and is killed/reaped on timeout,
output failure, or exit, including when a descendant retains a pipe.

`initialize(path, profile=journal.B1_PROFILE_NAME)`, `enqueue_b1`, and
`scheduler_tick_b1` select the distinct create-new-only B1 schema version 2;
legacy synthetic databases remain schema version 1 and are not migrated. The B1
profile pins the protocol, generated input identity, exact result manifest and
computation order, plus the actual bytes of the engine, validator, dormant loader,
protocol, fixture generator, adapter, supervisor, and journal. These are local
source/input byte identities, not claims of market-data authenticity.

`supervisor.run_b1_batch(database, claim)` starts one persistent Node process for
the entire engine session. Input generation, preparation, all 44 paths, control
calibration, serialization, and finalization share one absolute monotonic batch
deadline; there is no child-per-path replay. Each path start is validated and
committed before the parent ACK. Actual bounded path-result bytes use a separate
explicit-length result pipe; the parent validates the B1 path schema and exact
identity, hashes received bytes, and atomically commits payload plus progress
before acknowledging completion. Controls are committed once after path 19 and
bound to the received-byte digests of the designated primary/full-basket 15 bp
development paths. Diagnostic admission requires frozen controls. Controls and
final-summary events require a parent-ready ACK before the child writes the
result pipe, avoiding cross-pipe ordering assumptions. The final summary omits
the 44 payloads; inspection reconstructs the result from stored evidence.

The B1 journal enforces a cumulative 1 MiB persisted-result/progress capacity.
The generated-fixture measurement of 939,435 total bytes and a 30,623-byte
largest path is sizing evidence for that fixture only, not a universal path-size
limit. Framing is incrementally checked against the remaining capacity. The
8 KiB control and 4 KiB stderr bounds remain; parent ACK input is capped at 8
KiB. A successful summary must have a strict engine-result schema, a settled
screen, all 44 completed paths, and unchanged false authority flags before
durable completion. Insufficient evidence remains failed and cannot admit
diagnostics.

`resultSha256` hashes the complete reconstructed result returned by B1
inspection; `summarySha256` separately hashes the exact final-summary bytes
received from the child. A final settlement commits before its ACK. Child-exit
or trailing-output errors after that ACK cannot undo the committed result; the
immediate response carries `postSettlementFailure`, and inspection recovers the
durable completion.

This process supervision is operational bounding, **not** a hostile-code sandbox
or network/security isolation. The monotonic deadline bounds child work and SQLite
lock waiting; it is not a hard-real-time guarantee for OS scheduling, local
filesystem/fsync latency, or process reaping. If local persistence fails, return
latency and result persistence are not guaranteed, but the child has already been
terminated and the durable fence is not released. It assumes trusted local code,
a POSIX host, and operator-controlled database access. This is not a hostile-code
sandbox, network/security isolation, or hard-real-time guarantee.

The journal retains `rejected`, `failed`, `timed_out`, `partial`, and `unknown`
outcomes. A complete result is recoverable by read-only `inspect` without rerun.
An interrupted `CLAIMED` or `RUNNING` record is projected as `unknown` with `unresolved=true`;
it keeps the active fence and blocks other work until an explicit
`reconcile(database, trial_id, note)` records operator resolution. A failed
settlement leaves the transaction and active fence unchanged. The read-only
projection contains source timestamps, pins, budget, path hashes and bounded
result; it makes no profitability inference and all execution/promotion flags are
false.

## Reuse decision

The existing event runtime and publisher supervisor are separate protocols and
remain unchanged. This package reuses their applicable mechanics: create-new-only
SQLite provisioning, immediate transactional fencing, one-shot consumed attempts,
bounded pipe reads during execution, a minimal child environment, monotonic
deadlines, process-group cleanup/reap, and fail-closed uncertain recovery. It uses
a dedicated research schema rather than reusing event claims, publisher roles,
event/branch SHAs, or publication authorization as research permission. Research
trial pins and per-path progress have different identity, budget, and review
semantics, so schema reuse would imply authority the existing records do not grant.

## Synthetic demo and tests

Run the full local demo with a new temporary SQLite path:

```sh
python3 -B scripts/research-supervisor/demo.py /tmp/meridian-m11-demo.sqlite
```

The command refuses an existing database. It runs only the synthetic adapter and
prints a bounded summary. Remove that temporary demo database manually after
inspection; the journal itself provides no reset/delete path. Focused tests run
through the existing npm test command:

```sh
node --test test/research-supervisor.test.js
```

They cover durable enqueue/claim/complete/recovery, competing processes, identity
conflicts, restart and budget persistence, explicit reconciliation and failed
settlement, rejected policy, actual sleeping and pipe-retaining children, absolute
batch/path deadlines, output floods, missed/false path events, result bounds, and
the credential/code-hook-free child environment.

## Remaining integration/deployment checklist

- [ ] Independently review the merged #880 engine/protocol, frozen source/data identities, and a concrete `runBatch` path-boundary adapter; verify sequential mathematics against that implementation before any integration.
- [ ] Review data quality, provenance, immutable source/data byte hashes, and protocol-specific path IDs before any non-fixture batch is admitted.
- [ ] Provision an isolated persistent POSIX host with trusted clock/storage, filesystem permissions, backup/restore review, and operator access controls.
- [ ] Choose and explicitly invoke a scheduler; no scheduler is installed or running here. Set bounded recurring daily compute/data/model budgets and monitor reservations, timeouts, unresolved work, disk, and host health.
- [ ] Add a separate durable run ledger and independently reviewed evidence/research/holdout authorization and promotion gate. Job completion or queue admission must never satisfy these gates.
- [ ] Require independent review and cost-budget approval before any future continuous research or live-paper deployment. This package alone does not establish operational readiness.
