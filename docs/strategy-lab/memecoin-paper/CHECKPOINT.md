# Offline Paper checkpoint prototype

The checkpoint wrapper is an opt-in, local-filesystem recovery experiment for
the disabled Paper ledger. It journals commands and replays them through the
actual `PaperLedger` methods; it does not hydrate ledger summaries or enable a
run, network access, providers, wallets, orders, or scheduling.

## Contract

Open an exclusively owned `CheckpointStore`, then open a session with a fixed
run identity and integer-millisecond start time:

```js
const store = await CheckpointStore.open("/local/private/paper-run");
const session = await PaperCheckpointSession.open({
  store,
  runId: "paper-001",
  startedAt: Date.now()
});
```

Commands require stable IDs and all time, quote, and marks inputs explicitly.
They are serialized as bounded canonical bytes, chained by sequence and
predecessor SHA-256, then acknowledged only after file and directory fsync,
atomic same-directory publication, bounded exact readback, and pending-marker
cleanup. The run deadline is fixed at `startedAt + 8 hours`; the wrapper checks
it when a command is invoked, not with a wall-clock watchdog. Duplicate command
IDs with the same complete payload return the committed result; changed payloads
are rejected. Authorization references are reconstructed in command order and
passed to the ledger as its original returned objects.

`riskSnapshot` is replayed as a mutating ledger command. Rejected and unknown
ledger outcomes are journaled too. BigInts have exact decimal encodings, Maps
are encoded as sorted tagged entries, and all command results are verified
against SHA-256 digests during recovery. A changed policy or Node/ICU/timezone
runtime fingerprint fails closed. These hashes detect byte changes and bind the
local replay chain; they are not signatures or provenance authentication.

## Failure behavior and limits

The store uses a lifetime exclusive local lock. It never steals an existing
lock, removes stale locks automatically, or retries ambiguous publication. A
pending publication returns `UNKNOWN`; `reconcilePending()` only reads and
reports what is visible. Callers must not use a visible candidate as proof that
a failed directory flush was durable. Pre-publication errors preserve the
previous checkpoint. The store requires working file and directory fsync and
does not claim shared-filesystem or hosted-runner durability.

The child-process tests exercise process termination around local publication
phases on a temporary filesystem. They do not prove power-loss recovery,
cross-host durability, autonomous eight-hour operation, provider readiness, or
real-data performance. This checkpoint packet does not change the disabled run
manifest or authorize runtime activation.

Run the focused tests with:

```sh
node --test test/memecoin-paper-checkpoint.test.js test/memecoin-paper.test.js
```


## Caller-time ordering (policy v2)

New commands must supply nondecreasing integer UTC milliseconds, starting at the
fixed run start. Equal times are permitted. A backward new command returns
`REJECT / NON_MONOTONIC_TIME` before ledger mutation or checkpoint publication;
it does not consume a command ID or change the acknowledged sequence/hash.
Every acknowledged command, including a rejected ledger outcome, advances the
session time fence. Replay checks the same ordering and restores that fence.
Exact retries of already acknowledged command IDs return their old result before
the clock check; they are reads and do not move time backwards.

The direct ledger also fences newly admitted timestamps before mutation, including
commands later rejected for missing evidence. Its Vienna day can never regress.
This prevents an old-day call from clearing a latched USD 30 daily loss gate.
UTC ordering permits Vienna daylight-saving fallbacks; a genuine later day still
opens a new daily gate. The policy/header version is changed deliberately: old
v1 checkpoints fail `CHECKPOINT_INCOMPATIBLE`, with no automatic migration or
restart authority.

**Activation blocker remains:** nondecreasing caller time is not an authenticated
clock. A future real-data pilot must pin a trusted timestamp source, tolerable
clock skew and forward-jump handling. A caller can still supply monotonic but
false future times; this patch does not establish wall-clock authority, an
active watchdog, automatic recovery or permission to run. The manifest remains
disabled and `UNRECOVERABLE_FAIL_CLOSED`.


## Opt-in anchored clock admission (policy v3)

The default above remains the caller-time v2 fixture contract, including existing
orchestration behavior. There is no implicit upgrade. A separate
`memecoin-paper-ledger-v3-anchored-clock` header pins an explicit `clockPolicy`:
`version: "anchored-clock-v1"`, `mode` (`synthetic` or `external`), bounded
`sourceId`, `anchorUtcMs` (equal to `startedAt`), `anchorMonotonicMs`,
`anchorUncertaintyMs`, `maxAnchorUncertaintyMs`, `maxSkewMs`, and
`maxObservationGapMs`. All numeric fields are nonnegative integer milliseconds;
the observation gap limit must be positive. There are no default limits.

A new anchored session also requires a synchronous `clock.sample()` port returning
exactly `{sourceId, mode, wallUtcMs, monotonicMs}`. Effective UTC is the pinned UTC
anchor plus elapsed monotonic milliseconds. Each new command's explicit `now`
must equal that derived UTC. Wall divergence is checked against `maxSkewMs` in
both directions; observation gaps have a separate bound. Elapsed time is never
inferred from the wall clock. Source/mode mismatch, malformed or missing samples,
regression, overflow, excess gap/skew, or caller-time mismatch block admission.
No clock is obtained from `Date.now()` as a fallback.

A fault is a control record in the existing canonical, hash-chained checkpoint,
published through the same durable ACK protocol. It never invokes the ledger:
financial state, reservations, daily gate, ledger time and audit remain unchanged.
An acknowledged fault latches all new mutating commands closed. Unacknowledged
publication produces UNKNOWN and disables usable session reads, as before.
Snapshots and exact acknowledged retries remain reads after an acknowledged
fault; retries neither resample the clock nor append another record.

Recovery validates persisted receipts and replays financial commands without
sampling any current clock. The exact pinned policy must be supplied again.
Reopened anchored sessions are read-only: the first attempted new command records
`CLOCK_RESTART_BLOCKED`, because a monotonic counter does not prove process
continuity. There is no automatic restart, re-anchor, mode change or migration.
The existing eight-hour guard uses admitted UTC and is still command-triggered.

**Scope and remaining activation blocker:** `external` is a required configuration
label, not a certificate of UTC provenance. No real source, source-authentication
adapter, operating skew/gap/uncertainty limits, watchdog or activation is selected
by this packet. Tests use named synthetic limits only; synthetic receipts cannot
match an external-mode policy. The operator must establish trusted anchoring and
source integrity separately before any real-data run. The manifest remains
disabled and `UNRECOVERABLE_FAIL_CLOSED`.

Focused clock regression: `node --test test/memecoin-paper-clock.test.js`.
