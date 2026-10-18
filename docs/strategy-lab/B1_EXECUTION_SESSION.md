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
session.completedResult;      // full result only after successful completion
session.finalResult();        // null until terminal; final result after completion/failure
session.interrupt();          // terminal fail-closed interruption between advances
```

The manifest retains the frozen output/path-ID order, interleaved by segment.
Computation order is distinct: 19 development paths run first, the two controls
are calibrated once from development and frozen, then 25 diagnostic paths run.
An advance returns the just-finished `completedPath` record. Calling `runBatch`
drives this same session implementation to its terminal result.

Session state, the validated/frozen input snapshot, feature cache, and frozen
controls live only in this one JavaScript object. Mutating caller-owned inputs
after session creation cannot change later path calculations. A repeated or
wrong-order advance terminates the session; it never retries a path. An
interrupted session makes prior paths incomplete and cannot expose a completed
result. This is not durable checkpointing or process-restart recovery.
The API does not create or supervise a child process. The persistent-child,
ACK/result-channel bridge remains future work dependent on PR 884.

Validation, series identity, feature preparation, path work, development
calibration, and finalization all use the same absolute 30-minute/60-second path
budget and fixed 1 MiB output cap. The optional synthetic clock is accepted only
for `SYNTHETIC_FIXTURE`; it does not alter any production cap. JavaScript work is
cooperatively checked and cannot be hard-preempted.

## Captured-input loader

`scripts/research/b1-7/captured-input.mjs` has no import-time file reads or network
fallback. `loadCapturedInputs()` is the future production entry point. Its
independently frozen selected-input manifest and source admission are deliberately
absent, so it returns `SELECTED_INPUT_MANIFEST_MISSING` before opening a market
file. Caller-provided hashes, options, or a fixture result cannot grant that
admission.

The production path allowlist is fixed to the seven normalized paths and source
commit/per-file SHA-256 pins already recorded in B1 metadata. When an independently
reviewed manifest and explicit source admission are frozen in code, the loader
will require both its raw whole-file hashes and selected-series hashes to match.
Each file is opened once without following symlinks, read into one bounded buffer
(512 KiB maximum), hashed as raw bytes before parsing, and parsed from those same
bytes. The strict seven-column parser selects exactly 955 daily rows from
2024-02-19 through 2026-09-30 without sorting, filling, or repair. It rejects
invalid UTF-8/schema/numbers, duplicate or out-of-order timestamps, calendar
gaps, missing assets, path escapes, symlinks, non-regular/oversized files, and
hash drift. Existing synchronized OHLC validation runs before the selected
arrays and their separate hashes are deep-frozen.

`loadSyntheticFixtureProfile(rootDir)` is intentionally and unmistakably
`SYNTHETIC_ONLY_GENERATED_FIXTURE`. It uses generated test CSVs and computes
fixture hashes for identity/testing only; it does not pin, authenticate, or
authorize any production input. No captured market CSVs are read by these tests.

## Boundaries and limitations

- Hashes establish byte identity, not data-source authenticity or market provenance.
- The source-commit value is a frozen provenance assertion; this loader does not
  authenticate Git history or the origin of the captured bytes.
- B1 diagnostics remain historical/conditioned rather than a holdout; synthetic
  results are marked `SYNTHETIC_ONLY_NOT_ASSESSED`, not profitability evidence.
- The 15/30 bp cost assumptions, thresholds, protocol, and authority flags are
  unchanged and are not execution evidence or permission to trade.
- There is no complete hard-supervisor integration, no external process
  persistence, and no ACK/result-channel bridge in this change.
- No scheduler/service activation, actual market-data run, Paper/Live run, or
  order interface is provided.

Focused generated-fixture checks:

```sh
node --test test/b1-7-engine.test.js test/b1-7-captured-input.test.js
```
