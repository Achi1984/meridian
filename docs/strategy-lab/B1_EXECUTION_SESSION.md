# B1 execution session and captured-input boundary

This is an inactive, synthetic-only implementation interface. It does not authorize
captured-data execution, historical performance claims, Paper, Live, scheduling, or
orders. The frozen B1-7 protocol JSON and its raw hash are unchanged.

## Execution-session interface

`createExecution(options)` in `scripts/research/b1-7/engine.mjs` performs input
validation and identity binding once, then returns one in-process session object:

```js
const session = createExecution({
  seriesByAsset,
  source: {kind: 'SYNTHETIC_FIXTURE'},
  implementationSha256
});

session.manifest;             // stable 44-path output manifest
session.computationOrder;     // actual execution order, with ordinal and path ID
session.beforePathBoundary(); // describes the next path without advancing it
session.advanceOne(pathId);   // runs only that next actual path
session.controlDefinitions;  // defensive snapshot, null before calibration
session.completedResult;      // full result only after successful completion
session.finalResult();        // null until terminal; final result after completion/failure
session.interrupt();          // terminal fail-closed interruption between advances
```

The manifest retains the frozen output/path-ID order, interleaved by segment.
Computation order is distinct: 19 development paths run first, the two controls
are calibrated once from development and frozen, then 25 diagnostic paths run.
The read-only `controlDefinitions` snapshot is available at the first diagnostic
boundary, allowing a future supervisor to persist and acknowledge the frozen
controls before advancing that path. Mutating a returned snapshot cannot affect
the session. Only a fully completed result produces session status `COMPLETED`;
insufficient evidence and invalid outcomes produce `FAILED`.
An advance returns the just-finished `completedPath` record. Calling `runBatch`
drives this same session implementation to its terminal result.

Session state, the validated/frozen input snapshot, feature cache, and frozen
controls live only in this one JavaScript object. Mutating caller-owned inputs
after session creation cannot change later path calculations. A repeated or
wrong-order advance terminates the session; it never retries a path. An
interrupted session makes prior paths incomplete and cannot expose a completed
result. This is not durable checkpointing or process-restart recovery. The
inactive B1 supervisor bridge below owns one such session in a single Node
child; the engine API itself does not create or supervise a child process.

## Persistent generated-fixture bridge

`scripts/research-supervisor/b1_bridge_manifest.json` names the strict
`MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1` profile. It pins the B1 protocol,
the generated-series input identity, all 44 manifest descriptors, the distinct
19-development/25-diagnostic computation order, and the byte hashes of the
engine, validator, dormant loader, protocol, generated fixture, adapter,
supervisor, and journal. The parent verifies these source bytes before launch;
the child independently verifies them and the generated input before reporting
ready. These hashes bind local bytes only; they do not establish data
authenticity or provenance.

The explicit local API is `journal.initialize(path,
profile=journal.B1_PROFILE_NAME)`, `journal.enqueue_b1(path, trial_key)`,
`journal.scheduler_tick_b1(path, enabled=True)`, and
`supervisor.run_b1_batch(path, claim)`. Scheduling remains OFF unless the
caller explicitly ticks it. B1 uses a create-new-only SQLite schema version 2;
it does not migrate or reset the existing synthetic hash-chain profile or any
existing database.

`run_b1_batch` starts the single absolute monotonic batch deadline before
source verification, preparation, or process launch. It starts exactly one
absolute Node process with a minimal environment and no shell. At each
computation boundary, the child announces the expected path; the parent checks
the fixed order and durably records the start before acknowledging it. The
child then calls `advanceOne(expectedPathId)` once and sends the actual JSON
path-result bytes on a separate result file descriptor using an explicit
length frame. The parent incrementally enforces the remaining 1 MiB journal
capacity, validates the B1 result schema and exact path identity, hashes the
received bytes itself, then commits payload and progress atomically before
acknowledging completion. The 8 KiB control channel and 4 KiB stderr bounds are
separate from framed result bytes. Duplicate JSON keys, non-finite values,
truncated or extra frames, invalid lengths, and cumulative-capacity overflow
fail closed.

The session's `controlDefinitions` are read and committed once after 19
development paths. The journal binds that payload to the received-byte digests
of the designated primary 15 bp and full-basket 15 bp development results.
Only after this commit does the parent acknowledge readiness for the controls
frame; diagnostic path admission requires a frozen control status. The final
screen/result summary is separately framed without duplicating the 44 path
payloads. It must have the strict completed B1 result schema, all 44 completed
paths, and the engine's authority flags unchanged and false before it can be
settled as `COMPLETED`. The journal commits this settlement before sending the
final acknowledgement. An insufficient-evidence result remains failed, never
completed, and does not admit diagnostics.

Path work is limited to 60 seconds each and the complete preparation,
calibration, serialization, and finalization lifecycle shares one 1,800-second
batch deadline. Result payloads, controls, summary, and journal progress share
the cumulative 1 MiB persisted-capacity check; the generated-fixture sizing
measurement (939,435 bytes total, 30,623 bytes maximum path) is evidence for
this fixture only, not a general path-size limit. SQLite lock waits are capped
at 10 ms or the remaining deadline, whichever is shorter. Crash, timeout,
protocol failure, or lost acknowledgement does not retry or resume: the
one-shot attempt and active fence remain for explicit reconciliation.
If the final settlement has already committed, later child-exit or trailing
output errors do not undo it; the immediate return reports
`postSettlementFailure`, and read-only inspection recovers the committed result.

These are local operational bounds, not a hostile-code sandbox, a security
isolation boundary, or a hard-real-time guarantee. This bridge accepts only its
generated fixture; captured-data admission remains blocked by the inactive
loader and missing independent manifest/admission decision. It activates no
service or scheduler, reads no market CSVs, makes no orders, grants no research
or trading authority, and makes no profitability or operational-readiness claim.

Validation, series identity, feature preparation, path work, development
calibration, and finalization all use the same absolute 30-minute/60-second path
budget and fixed 1 MiB output cap. The optional synthetic clock is accepted only
for `SYNTHETIC_FIXTURE`; it does not alter any production cap. JavaScript work is
cooperatively checked and cannot be hard-preempted.

`createExecution` starts its trusted monotonic batch deadline before taking an
input snapshot. It snapshots the accepted input graph through own data-property
descriptors before validation or any caller-supplied clock callback; fixed
955-row arrays are rejected before row enumeration/copy. The supported input is an
ordinary or null-prototype options/source/asset/row record, an exact seven-asset
map, dense ordinary arrays, and rows with exactly seven enumerable own data
properties. Optional `syntheticClock` must be a function and is deliberately called
after the snapshot; trusted monotonic elapsed time, including preparation, remains
part of the existing 30-minute and 60-second limits. Accessors, sparse arrays,
extra keys, and unsupported object shapes are rejected without invoking getters;
validation and later execution use the same frozen snapshot. This is not a sandbox
for arbitrary Proxies or for side-effects in a caller-supplied clock.

## Captured-input loader

`scripts/research/b1-7/captured-input.mjs` has no import-time file reads or network
fallback. `loadCapturedInputs()` is the future production entry point. Its
independently frozen selected-input manifest and source admission are deliberately
absent, so it returns `SELECTED_INPUT_MANIFEST_MISSING` before opening a market
file. Caller-provided hashes, options, or a fixture result cannot grant that
admission.

Production and generated-fixture loads share one root normalization boundary.
Trailing separators are normalized before the directory identity check; canonical
path comparison and component/descriptor checks still reject root aliases,
symlinks, and escapes. The synthetic manifest and both nested hash maps are
snapshotted from own data descriptors before the first asynchronous filesystem
operation. Inputs here are standard data records; Proxies are not treated as a
security sandbox.

The production path allowlist is fixed to the seven normalized paths and source
commit/per-file SHA-256 pins already recorded in B1 metadata. When an independently
reviewed manifest and explicit source admission are frozen in code, the loader
will require both its raw whole-file hashes and selected-series hashes to match.
Each file is opened once without following symlinks, read into one bounded buffer
(512 KiB maximum), hashed as raw bytes before parsing, and parsed from those same
bytes. The strict seven-column parser requires the captured `timestamp_utc,open,high,low,close,volume,trades` header and selects exactly 955 daily rows from
2024-02-19 through 2026-09-30 without sorting, filling, or repair. It rejects
invalid UTF-8/schema/numbers, duplicate or out-of-order timestamps, calendar
gaps, missing assets, path escapes, symlinks, non-regular/oversized files, and
hash drift. Existing synchronized OHLC validation runs before the selected
arrays and their separate hashes are deep-frozen.

`loadSyntheticFixtureProfile(rootDir)` is intentionally and unmistakably
`SYNTHETIC_ONLY_GENERATED_FIXTURE`. It uses generated test CSVs and computes
fixture hashes for identity/testing only. Its optional second argument is an exact
synthetic-only manifest (`profile`, `wholeFileSha256`, `selectedSeriesSha256`) for
checking expected generated bytes before parsing and selected-series hashes after
parsing. Pins are copied before asynchronous I/O. These checks cannot authorize
production; its independent missing-manifest/admission guard remains unchanged.
Root symlinks and symlinked ancestors are rejected before file reads. The descriptor
path check requires Linux `/proc/self/fd`; no cross-platform filesystem guarantee is
claimed. No captured market CSVs are read by these tests.

## Boundaries and limitations

- Hashes establish byte identity, not data-source authenticity or market provenance.
- The source-commit value is a frozen provenance assertion; this loader does not
  authenticate Git history or the origin of the captured bytes.
- B1 diagnostics remain historical/conditioned rather than a holdout; synthetic
  results are marked `SYNTHETIC_ONLY_NOT_ASSESSED`, not profitability evidence.
- The 15/30 bp cost assumptions, thresholds, protocol, and authority flags are
  unchanged and are not execution evidence or permission to trade.
- The external supervisor persists received path evidence, but does not persist
  resumable engine state or recover/replay an interrupted session.
- No scheduler/service activation, actual market-data run, Paper/Live run, or
  order interface is provided.

Focused generated-fixture checks:

```sh
node --test test/b1-7-engine.test.js test/b1-7-captured-input.test.js
```

Candidate result: Node `v22.23.3`, 33 tests passed, 0 failed. The existing
inactive-source verifier also passed with `python3 -B
docs/autonomy/verify-source.py` (all suites; no live authority established).
