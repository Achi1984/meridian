# Offline observation-run evaluation

This package evaluates caller-supplied exports from one completed
`READ_ONLY_PAPER` observation. It is not connected to the runner, provider,
checkpoint writer, report producer, bridge, UI, or workflow. It does not access
the network, inspect a live run, change evidence, or authorize a simulated or
real trade.

## Required exports and identity

Supply the original canonical UTF-8 JSON bytes for these four artifacts from
the same run:

| CLI input | Persisted contract | Maximum bytes |
| --- | --- | ---: |
| `--config` | `run-config.json` | 65,536 |
| `--lock` | `run.lock` | 16,384 |
| `--terminal` | `terminal.json` (the durable terminal status record) | 16,384 |
| `--report` | `operator-report.json` (the persisted wrapper, not just its `dto`) | 262,144 |

The evaluator checks the config's read-only mode and eight-hour bounds, then
binds its SHA-256 digest and expected run ID across the durable lock, terminal
record, and report wrapper/DTO. `--config-sha256` must be obtained independently
from the approved launch record; computing a hash from the same unverified
config file is not independent identity evidence. The SHA is over the exact
exported config bytes. Any missing, changed, non-canonical, malformed,
oversized, or identity-mismatched artifact cannot yield a passing identity
criterion.

Export only after the run is terminal and through an owner-approved,
read-only process. Preserve the bytes exactly; do not reconstruct, reserialize,
or combine files from different runs. Do not query or probe the active worker,
restart it, update it, or cause the report producer to run for this evaluation.

## CLI

```sh
node scripts/memecoin-paper-run-evaluation/index.mjs \
  --run-id observation-20261101-r1 \
  --config-sha256 <approved-config-sha256> \
  --config /absolute/export/run-config.json \
  --lock /absolute/export/run.lock \
  --terminal /absolute/export/terminal.json \
  --report /absolute/export/operator-report.json \
  --format json \
  --output /absolute/output/observation-evaluation.json
```

`--format` accepts `json` or `markdown` and defaults to `json`. If `--output`
is omitted, the selected representation goes to standard output. An explicit
output must be an absolute path that does not already exist. The command reads
each input once, with a bounded read, and writes no file other than the
explicit output. Inputs must be regular, non-symlink files; the CLI rejects
platforms that cannot open inputs nonblocking without following symlinks. The
module has no import-time work.

The pure `evaluateObservation` API accepts the same expected run ID, expected
config SHA-256, and four `Uint8Array` inputs. `renderEvaluationMarkdown`
renders the resulting evaluation without I/O.

## Interpreting results

Each operational criterion is `PASS`, `FAIL`, or `UNKNOWN`. `overall` is
`FAIL` when any criterion fails, `UNKNOWN` when no criterion fails but at least
one remains unknown, and `PASS` only when every criterion passes. In
particular, the current persisted status/report contracts do not contain a
time-series export or externally authenticated clock/provenance; those
criteria therefore remain `UNKNOWN`. Report age, heartbeat recency, checkpoint
file size, or file growth never establishes uptime or gap-free observation.

`observation.completionStatus` is separate from the overall evidence result.
A coherent `DEADLINE` stop can establish a full scheduled interval. A coherent
`OPERATOR_STOP` is accepted as a completed early stop, but does not claim that
the full scheduled duration ran. Both display the scheduled and evidenced
durations separately. An explicit `UNKNOWN`, missing marker, nonterminal state,
or mismatch is never treated as completion success.

Accounting counters are copied as safe integers and reconciled between the
terminal marker and report; missing counters stay unavailable, not zero.
Provider request/event and per-provider totals must reconcile and remain within
the config budgets. Financial totals are copied from the report's exact
fixed-point strings; this evaluator does not calculate profitability. Zero
fills are not profitability evidence. Candidate rejection reasons and
checkpoint audit coverage are shown only when supplied in the report DTO;
truncated or unavailable coverage remains explicit.

The operator report's provenance is caller-labeled, not authenticated.
Executable quote/cost evidence and time-series uptime evidence remain
unavailable unless separately supplied and independently reviewed. All
outputs hardcode `runtimeAuthorization: false` and
`simulatedTradeTestEligibility: false`. A PASS, if one is ever possible with
complete supplied evidence, is not runtime or trading authority.

## Post-run operator checklist: `observation-20261101-r1`

The frozen window is **2026-11-01T19:02:21.383Z through
2026-11-02T03:02:21.383Z** (Vienna **20:02–04:02 CET, UTC+1 throughout**).
This is the planned window, not a result or claim that the run completed.

After the scheduled end, and only after an authorized operator confirms a
terminal run state:

1. Obtain the exact four exports above from that same run through the
   owner-approved read-only route. Do not restart, update, stop, or probe an
   active worker to obtain evidence.
2. Obtain the expected run ID and independently recorded config SHA-256 from
   the approved launch record. Preserve the original export bytes and record
   their SHA-256 digests outside this evaluator if required by the operator's
   evidence procedure.
3. Run this CLI once with explicit absolute input and output paths. Retain the
   JSON or Markdown evaluation alongside, not in place of, the source exports.
4. Review every criterion, stop reason, scheduled/evidenced duration,
   accounting reconciliation, checkpoint/candidate coverage, and listed
   prerequisite. Treat missing, incomplete, truncated, corrupt, or mismatched
   evidence as `UNKNOWN` or `FAIL`; do not fill gaps by inference.
5. Record no outcome, request count, uptime, profitability, or trade-readiness
   claim until the corresponding evidence has actually been exported and
   reviewed. The evaluator itself does not contain actual results for this
   run.
6. Keep simulated-trade testing as a separate future decision. This evaluation
   cannot start it and does not change any existing hard gate.

## Focused tests

```sh
node --test test/memecoin-paper-run-evaluation.test.js
```

Tests use generated in-memory artifacts only. They do not access the active
run or contact any provider.
