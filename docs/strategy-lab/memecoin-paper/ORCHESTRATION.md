# Synthetic checkpoint orchestration

`runSyntheticPaperOrchestration({store, manifest, runId, startedAt, scenario = "baseline"})`
is a bounded, manually invoked fixture driver. It does not activate Paper bots,
fetch market data, register schedules, or contact providers. Pass an exclusively
owned `CheckpointStore` and the unchanged disabled `run-manifest.json`. The driver
consumes and closes the store on success and failure. Reopening requires a new
store handle, the same run identity, timestamp, manifest, and scenario.

The manifest must retain disabled providers, an engaged stop switch, empty mint
and pool lists, and null run ID/start/end fields. `startedAt` is an explicit fixture
clock, not an activation date written into the manifest. Caller-supplied candidates,
quotes, external evidence and additional options are rejected. Fixture output is
neither market evidence nor execution-realistic performance.

## Named scenarios

| Scenario | Commands and expected boundary |
| --- | --- |
| `baseline` | Authorize, simulate entry, finish at exactly eight hours; compare actual ledger summary, fill, finish result and ledger audit with `runSyntheticReplay`. Only the summary run ID is normalized for this comparison. |
| `stale-evidence` | A generated entry quote predates the authorization; actual ledger reports `UNFILLED`, preserving cash and positions. |
| `mismatched-evidence` | A generated quote has a different pool binding; actual ledger reports `UNFILLED`, preserving cash and positions. |
| `vienna-daily-gate` | Requires fixture start `2026-01-01T19:00:00Z`; crosses Vienna midnight at 23:00 UTC. Unknown marks block risk, 2999 cents permits entries, 3000 cents trips the daily gate and revokes a pending second reservation. A later attempted fill remains rejected. |
| `manual-late` | A risk command at exactly eight hours plus one millisecond is routed through the session deadline guard and reports `INVALID_RUN_WINDOW`. No timer is installed. |

All state transitions use the existing `PaperCheckpointSession` and its real
ledger. The driver adds no reducer, ledger, provider adapter or trading rules.
`runSyntheticReplay` supplies the existing golden decisions and reference results.
The v2 monotonic-time session remains authoritative. Exact acknowledged command
retries may use their original times; new backward commands remain rejected.

## Acknowledgement and restart contract

Stable scenario-prefixed command IDs and a deterministic input plan bind a run to
its fixture. Before sending commands, an existing checkpoint must be an exact
prefix of that plan. A foreign scenario or changed payload is rejected before any
new command is issued. Partial acknowledged prefixes can resume; completed runs
return cached command results without adding fills or audit entries.

Each command's returned result is checked against its persisted record digest and
the session's acknowledged checkpoint hash and sequence. A session-level rejection
without a journal record does not count as a successful acknowledgement. Unknown
publication, mismatched receipt or golden mismatch throws and withholds the whole
report. No retry or reconciliation is performed automatically. Resolve an unknown
publication through the existing checkpoint-store recovery contract before resuming.

Reports include only acknowledged command results, checkpoint metadata, the actual
ledger snapshot and SHA-256 digests for results, snapshot and audit. BigInts remain
BigInts in command results; use `canonicalCheckpointBytes(report)` when serializing
instead of plain `JSON.stringify`. These digests support replay comparisons, not
claims of market execution or live profitability.

## Focused validation

Run `node --test test/memecoin-paper-orchestration.test.js`.
Six tests cover the scenarios, reopen equivalence, backward-time rejection,
manifest/input isolation, foreign-plan rejection and withholding output after an
ambiguous publication. Existing session/store/ledger tests remain the dependency
coverage; this packet changes none of those components.

## Provenance

This is a fresh three-file implementation of the approved orchestration scope in
PR #1057, based on main `0fe8badf1dfe6513bd84a35580b7e58211ab50b4`.
Copilot's earlier temporary patch was declared `PATCH_UNAVAILABLE` in comment
6555480212. Its previously reported checksum and test receipt do not describe this
implementation. This packet neither reconstructs nor claims to recover those bytes.
