# Simulated pilot receipt evaluator

This package is a bounded, offline evaluator for one completed simulated
Meme-Coin pilot. It is separate from the `READ_ONLY_PAPER` observation
evaluator and does not change observation acceptance, the runner, ledger,
composition, deployment, or activation state. It reads supplied artifact
bytes only; it performs no network access and makes no live-execution,
profitability, or readiness claim.

## CLI

```sh
node scripts/memecoin-paper-simulated-evaluation/index.mjs \
  --manifest /absolute/export/manifest.json \
  --config /absolute/export/config.json \
  --checkpoint /absolute/export/checkpoint.json \
  --terminal /absolute/export/terminal.json \
  --report /absolute/export/operator-report.json \
  --run-id approved-run-id \
  --build-id approved-build-id \
  --config-sha256 independently-recorded-config-sha256 \
  --format json
```

`--format` accepts `json` or `markdown` and defaults to `json`. `--output
/absolute/path/evaluation.json` is optional; the destination must not already
exist. Without it, output is written to standard output. Inputs must be
absolute paths to regular non-symlink files. The evaluator reads each file
once, with these maximum byte limits:

| Artifact | Maximum |
| --- | ---: |
| Manifest | 64 KiB |
| Config | 64 KiB |
| Checkpoint | 8 MiB |
| Terminal | 2 MiB |
| Operator report | 256 KiB |

Exit codes are `0` for overall `PASS`, `1` for `FAIL` (including malformed
artifact bytes reported as `INVALID_EVIDENCE`), and `2` for `UNKNOWN` or
unreadable/invalid command-line input. Output schema:

```json
{
  "schema": "MEMECOIN_SIMULATED_PILOT_EVALUATION_V1",
  "overall": "PASS | FAIL | UNKNOWN",
  "outcome": "SIMULATED_ENTRY_EXIT_COMPLETE | ZERO_ENTRY_COMPLETE | OPEN_UNVALUED_TERMINAL_POSITION | OPEN_POSITION_TERMINAL | SIMULATED_CYCLE_INCOMPLETE | INCOMPLETE_UNKNOWN | INVALID_EVIDENCE",
  "identity": {
    "runId": "…",
    "buildId": "…",
    "configSha256": "…",
    "artifacts": {
      "manifest": "sha256",
      "config": "sha256",
      "checkpoint": "sha256",
      "terminal": "sha256",
      "report": "sha256"
    }
  },
  "checks": [{"id": "…", "status": "PASS | FAIL | UNKNOWN", "reason": "…"}],
  "evidence": {
    "entryFills": 0,
    "exits": 0,
    "openPositions": 0,
    "terminalAt": "ISO timestamp or null",
    "stopReason": "…",
    "measuredCosts": "NOT_SUPPLIED"
  },
  "costProvenance": {
    "declared": {"basis": "DECLARED_HYPOTHETICAL", "revision": "…", "source": "…"},
    "measured": "NOT_SUPPLIED",
    "comparability": "NOT_ASSESSED"
  },
  "claims": {"liveExecution": false, "profitability": false, "activation": false}
}
```

## Input contract: version 1

The evaluator accepts only these exact, versioned artifacts. It does not infer
or migrate older formats. Hashes bind the raw supplied bytes; do not
reconstruct, reserialize, mix runs, or edit historical evidence. The expected
run ID, build ID, and config SHA-256 must come independently from the approved
launch record. A matching SHA-256 proves byte identity, not producer
authenticity or trustworthy time.

### Manifest

`MEMECOIN_SIMULATED_PILOT_EXPORT_V1` contains `runId`, `buildId`,
`configSha256`, and `revisions`. Each of `config`, `checkpoint`, `terminal`,
and `report` has an immutable safe `revision` identifier and the SHA-256 of
the corresponding exact file bytes. All three expected identity values must
match the CLI values and each artifact.

### Config

`MEMECOIN_SIMULATED_PILOT_CONFIG_V1` identifies the same `runId` and
`buildId`, with `mode: "SIMULATED_PAPER"`,
`executionMode: "SIMULATED_ONLY"`, and
`policyVersion: "memecoin-paper-ledger-v2-monotonic-time"`. It carries integer
millisecond `startedAt`, `entryCutoffAt`, and `deadlineAt` (an eight-hour
window), plus `quoteMaxAgeMs` and a cost policy. These #996 limits are checked
as fixed policy, not trusted as caller-adjustable values:

| Limit | Required value |
| --- | ---: |
| Initial virtual capital | 100,000 cents |
| Maximum all-in entry | 8,000 cents |
| Maximum open positions | 3 |
| Initial stop | 600 bps |
| Trailing activation | 1,200 bps |
| Trailing distance | 600 bps |
| Daily loss gate | 3,000 cents |
| Daily accounting timezone | `Europe/Vienna` |

`costPolicy` must include `basis: "DECLARED_HYPOTHETICAL"`, safe bounded
revision/source identifiers, and `measuredBasis: "NOT_MEASURED"`. A declared
quote-cost assumption is not a settled or measured execution cost.

### Checkpoint and terminal

`checkpoint.json` must be the canonical `formatVersion: 1` checkpoint from
`PaperCheckpointSession`: `runHeader`, contiguous `records`, and matching
`sequence`. The evaluator reuses the repository's pure
`canonicalCheckpointBytes` serializer, verifies every predecessor hash and
command ID, and binds the final SHA-256 to the terminal checkpoint receipt.
This is a digest chain, not a signature.

The separate `MEMECOIN_SIMULATED_PILOT_TERMINAL_V1` receipt binds
`runId`, `buildId`, `configSha256`, actual `terminalAt`, terminal `status`,
`stopReason`, and the final `checkpointReceipt`. Its `operations` list must
contain one result for every non-header checkpoint record, in sequence, with
matching `commandId`, `method`, and `resultDigest`. Each result is checked by
recomputing the canonical result digest. `stopEvidence` must establish the
same actual terminal instant and stop reason. A deadline stop requires the
actual stop instant to equal the configured deadline; an operator stop stays
an early completion and is not described as an eight-hour run.

`restartEvidence` passes only when it explicitly states `NOT_REQUIRED` with
zero restarts and no receipts. Any restart, including a claimed `VERIFIED`
restart, remains `UNKNOWN` until the producer freezes a receipt schema bound to
the prior and resumed checkpoint identities. The current ledger explicitly
fails closed on restart; no restart transition schema is available here.

### Report

The report must be the `MEMECOIN_PAPER_OPERATOR_REPORT_V1` DTO and identify
the expected run through `experiment.id`. It is bound by its exact artifact
revision and is reconciled against the terminal results for entry-fill count,
cash, realized totals, fixed-point costs, and final open-position identities.
The evaluator does not construct or repair the report.

Risk snapshots are recomputed from replay-derived cash and exactly one fresh,
event-identified mark per open position, including mark identity, price,
decimals, and cost assumptions. Reported cash/equity/open value/exit costs and
daily-loss fields must equal that recomputation. A local-day rollover resets
the loss baseline only after a validated snapshot establishes the next day's
opening equity. A terminal marked position likewise requires a fresh
event-identified finish mark; unsupported marks cannot substantiate reported
valuation.

## Acceptance and interpretation

`overall` is `FAIL` if any check fails, `UNKNOWN` if there is no failure but
at least one required evidence item is unavailable, and `PASS` only when all
checks pass. Criteria cover artifact identity/revisions, canonical checkpoint
chain, terminal-receipt/result binding, operation/event uniqueness, causal
fresh quotes and event-ID association (including fixed-point quantity/notional
recomputation from quote price and decimals), entry cutoff, #996
sizing/position/daily-loss limits, replay-derived risk snapshots and local-day
rollover, fixed-point cash/P&L/terminal-mark reconciliation, declared cost
provenance, terminal positions/reservations, and restart evidence.

| Outcome | Acceptance meaning |
| --- | --- |
| `SIMULATED_ENTRY_EXIT_COMPLETE` | The durable receipts record one or more simulated entries and matching exits, with no remaining positions. This is not proof of live execution capability or profitability. |
| `ZERO_ENTRY_COMPLETE` | A coherent terminal completion has zero entry fills and no open positions. This is not a failed run and not profitability evidence. |
| `OPEN_UNVALUED_TERMINAL_POSITION` | The finish receipt retains one or more open positions and the report honestly says terminal marks/unrealized values are unavailable. Overall evidence remains `UNKNOWN`; no liquidation is fabricated. |
| `OPEN_POSITION_TERMINAL` | A terminal open position is reported with fresh, event-identified mark evidence. It is still not an entry/exit-complete run. |
| `SIMULATED_CYCLE_INCOMPLETE` | Receipts show activity, but do not prove a complete entry/exit cycle. |
| `INCOMPLETE_UNKNOWN` | A terminal, restart, quote, or accounting prerequisite is incomplete or explicitly `UNKNOWN`. |
| `INVALID_EVIDENCE` | Identity, digest, checkpoint, event, accounting, or risk evidence is contradictory or invalid. |

`executionRealistic: false`, hypothetical quotes, and declared costs remain
simulation evidence. The evaluator reports measured/settled costs as
`NOT_SUPPLIED`; it does not calculate or claim strategy profitability, value
an unpriced position, synthesize a quote, or liquidate an open position.

## Integration boundary and unresolved dependencies

This is an isolated evaluator contract proposal, not a claim that the
composition already emits these artifacts. At inspection, PR #1168 contained
only its initial plan commit and had no report/terminal implementation schema.
The accepted local checkpoint has canonical sequence/hash/result-digest
records, but the checkpoint itself does not retain result objects; this
contract therefore requires the terminal export to preserve each operation
result for digest verification. The local operator-report DTO is
`MEMECOIN_PAPER_OPERATOR_REPORT_V1`; the observation report is not accepted as
a substitute for simulated-pilot receipts.

Before integration, #1168/#1160 must freeze and produce this exact versioned
config, terminal, and report contract, including stop evidence, a restart
transition schema, and immutable artifact revision IDs. Until then, restarted
runs cannot pass this evaluator. If their final schemas differ, integration
requires an explicitly versioned adapter and new fixtures; this evaluator
will not silently migrate historical artifacts. No import from an unmerged
branch is used. The existing observer, ledger, runner, composition, and
deployment files are unchanged.

Focused offline tests:

```sh
node --test test/memecoin-paper-simulated-evaluation.test.js
```
