# Synthetic temporary journal — proposed source packet

Baseline: `87d69bb982c1261aa45f1b55a702cc413cd1ee7e` (merged PR1082).
Status: local implementation candidate, not reviewed, published, or operational.

Synthetic infrastructure v1 §3 permits a separately reviewed local temporary
journal packet after resource verification. PR1082 verified the existing Python
stdlib SQLite resource on the test host. This packet uses that resource only;
it makes no production Docker, power-loss, strategy, or Paper-admission claim.
All twelve operational choice groups remain REQUIRED_UNSET.

## Implementation boundary

`test/synthetic-paper-temporary-journal.test.js` imports the unchanged existing
`test-support/synthetic-paper/harness.mjs`. That harness exclusively generates
the proposal, exact integer account transition, receipt, and identities. The
Python fixture persists opaque generated before/after account-state-sequence
snapshots and the original committed result. It is not a second reducer or a
canonical wire serializer. The generated table is a test oracle, not a durable
proposal API or evidence that an operation committed.

Fixture units are integer USD cents, whole shares, cents per share, and fee
cents. JSON transport converts BigInt values to decimal digit strings without
rounding; no money arithmetic occurs in Python. These are fixtures, not policies.
Each fixture has its own synthetic identity, deterministic clock, private
TemporaryDirectory, exclusive mode-0600 database, and single original attempt.

The original fence is stored before child launch. Only the original child can
apply its generated transition. One SQLite transaction installs the account,
state identity, committed sequence, original result, and resolved fence. All
restart inspection remains blocked, even when a receipt is found. The receipt
lookup is read-only and does not install a recovery-control record or resolve an
UNKNOWN admission block. Missing receipt and wrong fence report UNKNOWN.
No retry or resume interface exists. The persistent `blocked` flag is a
fixture-only restart interlock, not the proposed recovery control schema.

Bounds: 16 KiB input, 16 KiB child capture, 64 SQLite pages / 256 KiB total
artifacts, one receipt per fixture, 5-second child timeout, 10-second outer
process timeout. SQLite DELETE journal and synchronous FULL are explicit.
Subprocesses have no shell, only PATH/LANG inheritance, bounded lifetime and
reaping. TemporaryDirectory cleanup covers normal paths and Python exceptions;
a SIGTERM handler unwinds cleanup. Forced termination/host loss can still leave
artifacts and was not tested. No network, providers, credentials, dependencies,
schedulers, production files, B1 schema, or portfolio schema are used.

## Focused evidence

Command: `node --test test/synthetic-paper-temporary-journal.test.js`.
Local result: **6 passed, 0 failed, 0 skipped**.

For both FILL and NO_ACTION the suite exercises normal commit, process exit
immediately before commit, and process exit immediately after commit before ACK.
Every case verifies atomic before-or-after snapshot, original fence state,
receipt count, exact and repeated original-result lookup, wrong-fence and
missing-receipt UNKNOWN, retained restart block, failed read-only mutation,
byte-identical database after lookup, and temporary-directory removal. The
before-commit fixture uses SQLite hot-journal recovery; this is not domain
history repair. Repeated receipt lookup does not charge another fee.

This does not test power loss, hostile input, multi-writer races, corruption
recovery, production storage, canonical v1 serialization compatibility, strategy
qualification or trading. CAS/fence predicates guard the original fixture
transaction, but their loser branches are not claimed as tested here. The model's
existing tests remain the accounting/causal/idempotency evidence. A separate
review is required before merging this persistence packet.
