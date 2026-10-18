# M11 local research supervisor — synthetic source only

This package is an inactive execution foundation for later bounded research, not
a research authorization, profitability claim, autonomous service, or live/paper
trading integration. It makes no exchange orders and has no CSV loader, market
data access, database service, network client, model call, workflow, daemon, or
import-time action. The only runnable workload today is a deterministic synthetic
fixture that hashes a sequential chain; it does not perform strategy calculations.

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

The fixed manifest has one `synthetic-development` path followed sequentially by
43 `synthetic-frozen-control` paths. Every completion digest feeds the next path.
This is only a stable supervisor fixture, not a claim that these are the approved
R3 engine's paths or that its mathematics is preserved. The R3 engine is not copied
or imported; integration requires the reviewed #880 merge and its concrete protocol.
The first path/control ordering is deliberately sequential, never dispatched in
parallel.

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
deadline is at most 1,800 seconds. Shorter limits are used in tests. Standard
output and error are capped while being read (8 KiB and 4 KiB), input is capped at
8 KiB, and persisted results are capped at 1 MiB. The child receives only `PATH`
and `LANG`, runs in a new POSIX process group, and is killed/reaped on timeout,
output failure, or exit, including when a descendant retains a pipe.

This process supervision is operational bounding, **not** a hostile-code sandbox
or network/security isolation. It assumes trusted local code, a POSIX host, and
operator-controlled database access. A path protocol adapter can support an
eventual `runBatch` integration only if the approved engine exposes and validates
these path boundaries while preserving its development-to-frozen-controls state
and computation. No such integration is wired here.

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

- [ ] Merge and review #880's approved engine, protocol, frozen source/data identities, and concrete `runBatch` path-boundary adapter; then verify sequential mathematics against that implementation.
- [ ] Review data quality, provenance, immutable source/data byte hashes, and protocol-specific path IDs before any non-fixture batch is admitted.
- [ ] Provision an isolated persistent POSIX host with trusted clock/storage, filesystem permissions, backup/restore review, and operator access controls.
- [ ] Choose and explicitly invoke a scheduler; no scheduler is installed or running here. Set bounded recurring daily compute/data/model budgets and monitor reservations, timeouts, unresolved work, disk, and host health.
- [ ] Add a separate durable run ledger and independently reviewed evidence/research/holdout authorization and promotion gate. Job completion or queue admission must never satisfy these gates.
- [ ] Require independent review and cost-budget approval before any future continuous research or live-paper deployment. This package alone does not establish operational readiness.
