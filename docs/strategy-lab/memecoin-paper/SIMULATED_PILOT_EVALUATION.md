# Memecoin Paper run-export evaluator

This bounded, offline evaluator consumes the producer's actual
`memecoin-paper-run-export/v1` envelope. It does not create an alternate
manifest, terminal receipt, operator report, accounting projection, or checkpoint.
It performs no network, provider, wallet, signing, order, deployment, or activation
activity. A simulated `PASS` is limited to the reported offline lifecycle and
its available receipt/export consistency; it is not operational readiness,
profitability, real-source verification, or evidence that hypothetical costs
equal settled costs.

## CLI

The export file contains the envelope itself (the `report` object returned by
`createPaperPilotComposition()`), not the surrounding CLI result object.
Independent run/config/producer expectations must come from the caller's
approved run record:

```sh
node scripts/memecoin-paper-simulated-evaluation/index.mjs \
  --export /absolute/path/memecoin-paper-run-export.json \
  --run-id approved-run-id \
  --config-sha256 independently-recorded-config-sha256 \
  --producer-revision paper-pilot-composition/3 \
  --format json
```

`--format` accepts `json` or `markdown` (default `json`).
`--output /absolute/path/evaluation.json` is optional and must not already
exist. Without it, output goes to stdout. The single export input must be an
absolute path to a regular, non-symlink file and is opened nonblocking with a
bounded read. The maximum envelope size is 16 MiB; the embedded canonical
checkpoint is separately limited to 8 MiB.

Exit codes are `0` for `PASS`, `1` for `FAIL`, and `2` for `UNKNOWN` or invalid
CLI/file input. A missing pre-start binding is `UNKNOWN`, never a pass based on
matching hashes computed after the run.

## Input contract

The evaluator accepts only the exact v1 envelope fields:

```json
{
  "schemaVersion": "memecoin-paper-run-export/v1",
  "producerRevision": "paper-pilot-composition/3",
  "config": {"version": 1, "mode": "SYNTHETIC_TEST_ONLY"},
  "configSha256": "<sha256 of canonical config bytes>",
  "runId": "<checkpoint run id>",
  "startedAt": 1793651880000,
  "deadlineAt": 1793680680000,
  "policyVersion": "memecoin-paper-ledger-v2-monotonic-time",
  "runnerReport": "<unmodified runner report or null>",
  "checkpoint": "<full actual canonical checkpoint or null>",
  "checkpointSha256": "<sha256 of canonical checkpoint bytes or null>",
  "persistence": "ACKNOWLEDGED | UNKNOWN | NOT_STARTED",
  "exportBinding": "PRESTART_BOUND | EXPORT_ASSERTED",
  "bindingReceipt": "<immutable pre-start receipt or null>"
}
```

The evaluator requires separate expected `runId`, `configSha256`, and
`producerRevision` values. It checks the fixed eight-hour run window, checkpoint
header/policy identity, canonical config digest, full checkpoint digest and
predecessor chain, runner operation-receipt mapping, and final `finishRun`
receipt. Terminal receipt shape is exactly
`{runId, sequence, hash, resultDigest}`; `commandId` is reconciled from the raw
`runnerReport.terminalResult` and final checkpoint record. The raw runner report
is retained as supplied by the producer; evaluator code does not replace it
with a derived report.

`PRESTART_BOUND` requires a valid `memecoin-paper-start-binding/v1` receipt
whose canonical digest binds the expected producer, run, config, policy,
window, and external-packet digest (if applicable). This checksum is not a
signature. Without the receipt, the evaluator returns
`historical_run_binding: UNKNOWN` and `exportBinding: EXPORT_ASSERTED` remains
an assertion only. It never backfills historical runs.

Persistence certainty is distinct from lifecycle status:

| Persistence | Meaning |
| --- | --- |
| `ACKNOWLEDGED` | The actual terminal receipt and full checkpoint were read back and match. This may coexist with a runner lifecycle `UNKNOWN` if the strategy/source outcome was unknown. |
| `UNKNOWN` | A publication/readback may have happened, but durable certainty or terminal receipt is unavailable. The evaluator does not infer a receipt. |
| `NOT_STARTED` | No checkpoint publication was attempted. |

The runner's actual reason is preserved, including `SOURCES_EXHAUSTED`,
`DEADLINE`, and `SHUTDOWN`. A terminal timestamp after the configured deadline
is accepted only with reason `DEADLINE`; the timestamp must be the actual
`finishRun` input and is never clamped or backdated. Nonterminal checkpoint
records after the deadline are rejected. `STOPPED`/`UNKNOWN` lifecycle states
do not become successful completion merely because persistence was acknowledged.

Mark event IDs may appear in multiple operation inputs when a risk mark is
reused. Identical event ID and identical canonical mark content are accepted;
reusing an ID with different content fails. Terminal open positions marked
`VALUATION_UNAVAILABLE` remain explicitly unvalued; no terminal mark or
liquidation is invented.

## Interpretation and limitations

`overall` is `FAIL` when an export binding, checkpoint, receipt, time, mark
reuse, inventory, or raw runner-summary consistency check contradicts the
provided evidence. It is `UNKNOWN` when persistence, lifecycle, valuation,
source trust, or another required outcome remains unresolved. `PASS` means only
that the supplied simulated run export is internally consistent under the
checks available in this envelope. It does not mean that real sources were
verified; `realDataSourceCoverage` remains `NOT_ASSESSED`, and live execution,
profitability, activation, and source-readiness claims are always false.

The runner's checkpoint stores each operation's result digest rather than the
full result object. Its unmodified `operationResults` expose method/status and
receipt references. The evaluator can bind those receipt references to
checkpoint records, but cannot independently reconstruct every nonterminal
ledger result or re-run the strategy from absent data. It therefore uses only
the raw runner's available operation summaries and terminal accounting; it does
not claim a separate result replay or independent source/cost verification.
Costs reported by this simulation remain hypothetical; measured/settled costs
are `NOT_SUPPLIED`.

| Outcome | Meaning |
| --- | --- |
| `SIMULATED_ENTRY_EXIT_COMPLETE` | Runner summaries report one or more simulated fills and matching quote exits, with no remaining positions. Not a profitability or live-execution claim. |
| `ZERO_ENTRY_COMPLETE` | Durable terminal completion reports no simulated fill and no open position. It is not proof of strategy quality. |
| `OPEN_UNVALUED_TERMINAL_POSITION` | The terminal receipt retains open positions without a supported mark. Overall evidence remains `UNKNOWN`. |
| `SIMULATED_CYCLE_INCOMPLETE` | Activity exists but the supplied runner summary does not show a complete cycle. |
| `INCOMPLETE_UNKNOWN` | Binding, persistence, lifecycle, quote, valuation, or other evidence is unresolved. |
| `INVALID_EVIDENCE` | Conflicting identity, digest, checkpoint, receipt, time, event, or accounting evidence was found. |

## End-to-end verification

Tests create composition runs with the module-owned offline fixtures, then pass
their actual export envelopes to the evaluator. They cover zero-entry,
entry/exit, open-unvalued terminal positions, actual late-deadline finish,
sequence-zero lost acknowledgement, missing/tampered pre-start binding,
config/producer/checkpoint tampering, identical reused marks, and changed
content under a reused mark ID. No hand-crafted checkpoint or alternate
terminal artifact is used.

```sh
node --test test/memecoin-paper-simulated-evaluation.test.js
```

The two-position fixture is synthetic-only and exists to exercise repeated-mark
identity behavior. It does not represent provider-sourced evidence or authorize
runtime activation.
