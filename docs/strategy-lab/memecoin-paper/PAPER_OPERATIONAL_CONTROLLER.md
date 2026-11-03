# Default-disabled Paper operational wrapper

This package is an owner-reviewed preparation interface around the existing
`createPaperPilotComposition()` API. It does not activate providers, wallets,
signers, orders, deployments, schedules, or trading. Importing the module, running
it with no arguments, or requesting status does not start a run. Every run
requires the explicit `start --enable` command and a bounded manifest.

The v1 manifest path accepts `EXTERNAL_READ_ONLY_INPUT`. The input is passed through
the existing `createBoundedExternalReadOnlyInput()` interface and composition:
source labels are rewritten as unverified, evidence `verified` flags remain
false, and unsupported or missing source gates remain no-entry/UNKNOWN. This
wrapper does not use observation-pilot commands as trading control, remove
verification stripping, synthesize accepted source evidence, or introduce a
second runner, ledger, checkpoint, or export schema.

The separate `SOURCE_BACKED_PAPER` mode uses an exact v2 manifest containing the
module-owned source policy both at the manifest root and in `config.sourcePolicy`,
plus `config.sourcePolicySha256`. The current policy is intentionally disabled
and every listed provider is unapproved. Its digest is included in the canonical
config hash and immutable prestart receipt. A policy mismatch or caller attempt
to mark a provider approved is rejected before run state is created.

With the checked-in disabled policy, an explicit source-mode start still follows
the runner/checkpoint/export/evaluator lifecycle, but acquisition returns
`SOURCE_POLICY_UNAPPROVED`; it does not make network calls, falls back to
synthetic data, request quotes, or authorize entries. The fixed pipeline and
quote adapter are constructed disabled, and the local host clock remains
`trustedUtc: false`. The terminal `UNKNOWN` outcome records the exact outstanding
provider authenticity/time, archive/census, LP/developer/rug/bundle/wallet,
source-bound price/cost, and independent policy approval requirements. This is
an operational no-entry path, not an acquired-data or live-readiness claim.

## Reviewed manifest and start

The manifest is UTF-8 JSON, a regular non-symlink file no larger than 8 MiB, with
exactly these top-level fields:

```json
{
  "schemaVersion": "memecoin-paper-operational-manifest/v1",
  "config": {
    "version": 1,
    "mode": "EXTERNAL_READ_ONLY_INPUT",
    "enabled": true,
    "runId": "reviewed-paper-run-001",
    "startedAt": 1793651880000,
    "budgets": {
      "requests": 12,
      "bytes": 1000000,
      "events": 128,
      "candidates": 4,
      "cycles": 4,
      "durationMs": 20000,
      "callbackTimeoutMs": 1000,
      "maxWallClockUncertaintyMs": 10
    }
  },
  "externalReadOnlyInput": {
    "kind": "MEMECOIN_EXTERNAL_READ_ONLY_INPUT_V1",
    "schemaVersion": 1,
    "producerRevision": "candidate-intake-1",
    "sourceContracts": {
      "candidateIntakeSha": null,
      "evidenceSha": null,
      "quotesSha": null
    },
    "timing": {
      "sourceTimestamp": 1793651880000,
      "receiptTimestamp": 1793651880000,
      "uncertaintyMs": 0,
      "monotonicElapsedMs": 0,
      "clockSource": "UNATTESTED"
    },
    "payload": {
      "candidate": {
        "chainId": "solana",
        "mint": "11111111111111111111111111111111",
        "pool": "Vote111111111111111111111111111111111111111",
        "quote": "Stake11111111111111111111111111111111111111",
        "decimals": 6,
        "sampledAt": 1793651880000,
        "source": "caller-claimed-source",
        "evidence": {},
        "analystEvidence": {}
      }
    }
  }
}
```

This is a syntactically valid example with caller claims, not accepted evidence.
Replace the illustrative times and run ID with the reviewed values. Config keys
and budgets are validated by the existing composition; limits are requests 960,
bytes 8 MiB, events 1,000, candidates 100, cycles 256, duration eight hours,
callback timeout 30 seconds, and clock uncertainty 60 seconds. The external
packet must leave room in the byte budget for runner input.

Create the runs directory in advance as a real non-symlink directory. Each
successful start creates exactly one private run directory named by the
manifest's safe `runId`, with exclusive creation and a single writer lock. An
existing directory is a permanent restart refusal; it is never resumed, replayed,
or overwritten. Example:

```sh
node scripts/memecoin-paper/paper-operational-controller.mjs start \
  --enable \
  --manifest /absolute/path/reviewed-manifest.json \
  --runs-dir /absolute/path/paper-runs
```

The command reports `exportStatus` and `evaluatorOverall` separately. It exits
successfully only for a finished run whose persisted export was acknowledged and
whose evaluator result is `PASS`; the current unverified external path is expected
to remain `UNKNOWN` and return exit code 2 even when the exact export was
durably published.

The wrapper writes bounded `controller-status.json` state and polls for the
exclusive `stop-request.json` marker. `SIGINT` and `SIGTERM` request the
composition's existing stop path and are not converted into forced process
termination. Publication failures and uncertain acknowledgements are not
retried. Status and stop commands never invoke the composition:

```sh
node scripts/memecoin-paper/paper-operational-controller.mjs status \
  --runs-dir /absolute/path/paper-runs --run-id reviewed-paper-run-001

node scripts/memecoin-paper/paper-operational-controller.mjs stop \
  --runs-dir /absolute/path/paper-runs --run-id reviewed-paper-run-001 \
  --command-id reviewed-stop-001
```

A repeated stop command ID reports `DUPLICATE_COMMAND`; a different ID after a
stop is already recorded reports `STOP_ALREADY_REQUESTED`. Control records and
reads have fixed size limits, require regular non-symlink files, and stay within
the selected run directory.

Any error after creation of the unique run directory returns `UNKNOWN` with its
run ID and directory, and requires reconciliation. Do not retry that run ID even
when composition execution is not confirmed or the export ACK is uncertain. Check
the durable status, start binding, checkpoint, and export independently; missing
or unacknowledged files remain `UNKNOWN`.

## Canonical report persistence and read-only export

On completion, the wrapper serializes exactly the composition's
`result.report` using the existing canonical checkpoint encoding. It publishes
the complete bytes once to `run-export.json` using a same-directory temporary
file, file sync, exclusive link publication, and directory sync. It then reads
the bounded file back, requires byte-for-byte equality, and invokes the actual
`evaluateMemecoinPaperRunExport()` against the complete export, full checkpoint,
and its pre-start binding. It never reconstructs an export from a DTO or
checkpoint. Export persistence (`ACKNOWLEDGED`, `UNKNOWN`, or `NOT_STARTED`) is
separate from the report's own checkpoint persistence and evaluator outcome.
All missing values, open/unvalued positions, and `UNKNOWN` outcomes are retained.
If publication may have happened but its acknowledgement/readback is lost, the
result is `UNKNOWN`; the wrapper neither retries publication nor overwrites the
unique run export.

Download is a read-only stdout operation. Supply independently reviewed run,
config-digest, and producer expectations; a failing evaluator check refuses
download. `UNKNOWN` remains retrievable as `UNKNOWN`, not promoted to `PASS`:

```sh
node scripts/memecoin-paper/paper-operational-controller.mjs export \
  --runs-dir /absolute/path/paper-runs \
  --run-id reviewed-paper-run-001 \
  --config-sha256 <independently-reviewed-config-sha256> \
  --producer-revision paper-pilot-composition/3 \
  > /absolute/path/run-export.json
```

The result can also be evaluated with the existing independent CLI:

```sh
node scripts/memecoin-paper-simulated-evaluation/index.mjs \
  --export /absolute/path/run-export.json \
  --run-id reviewed-paper-run-001 \
  --config-sha256 <independently-reviewed-config-sha256> \
  --producer-revision paper-pilot-composition/3 \
  --format json
```

## Remaining source and host requirements

This wrapper does not establish operational readiness. The current external
packet's producer revisions, source hashes, timestamps, and evidence are caller
claims. Existing accepted interfaces do not provide the reviewed, source-bound
candidate intake, complete hard/analyst evidence, authenticated owner census,
executable quote and complete costs, or trusted source-time attestation needed
to clear the existing gates. Until each required producer interface and exact
revision is accepted and bound, inputs remain unverified and no-entry; there is
no source-trust handoff or readiness promotion in this change.

The host/operator must separately review private persistent storage, process
supervision, signal delivery, permissions, retention, and recovery of uncertain
publication. This preparation wrapper is not launch authorization or a service
deployment.

Focused offline checks:

```sh
node --test test/memecoin-paper-operational-controller.test.js \
  test/memecoin-paper-pilot-composition.test.js \
  test/memecoin-paper-simulated-evaluation.test.js
```
