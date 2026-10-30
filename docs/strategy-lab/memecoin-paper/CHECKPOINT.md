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
