# Bounded Paper-pilot composition — offline and no-entry external proof

**Status: the synthetic path is a runner-backed paper proof. The external path
performs bounded candidate evaluation only and always fails closed to a durable
no-entry result while source evidence remains unaccepted. Real-data entry and
launch are BLOCKED.** The
[`paper-pilot-composition.mjs`](../../../scripts/memecoin-paper/paper-pilot-composition.mjs)
uses the accepted #1146 `execution-runner.mjs`, execution-step, checkpoint
session, and fixed-point ledger. Its trade path remains
`SYNTHETIC_TEST_ONLY`; fixtures remain synthetic through evidence, quotes,
provenance, report output, and durable checkpoint. The separate
`EXTERNAL_READ_ONLY_INPUT` contract accepts bounded normalized candidate rows,
rewrites their source label to `UNVERIFIED_EXTERNAL_READ_ONLY_INPUT`, clears all
evidence `verified` flags, and routes them through the existing scout, filter,
analyst, risk, and terminal runner. It cannot request a quote or dispatch an
entry. Missing or unauthenticated evidence therefore yields a durable
`BLOCKED`/no-entry result with a terminal receipt, not a synthetic fill or
readiness claim. No provider acquisition, order, wallet, signer, deployment, or
live-ready path is enabled. Import and no-argument CLI invocation are inert/
disabled.
Configuration and fixture options reject accessor/hidden fields, and a
pre-aborted run exits before opening a checkpoint.

The proof uses #996 unchanged: USD 1,000 virtual capital; max 8% entry size;
three open positions; 6% initial stop; trailing distance 6% after 12% activation;
3% daily loss limit; and an eight-hour maximum run window. The existing engines
remain authoritative for filter thresholds, six-component analyst score,
reservation/fill, integer base-unit and cent accounting, stop exits, event
identity, checkpoint hashing/readback, and terminal open/unvalued positions.

## Exact offline command and configuration

Create a new, empty state directory for each proof. The config has exactly these
top-level keys (no extension fields); all budgets are positive safe integers
except the nonnegative clock-uncertainty bound:

```json
{
  "version": 1,
  "mode": "SYNTHETIC_TEST_ONLY",
  "enabled": true,
  "runId": "memecoin-offline-proof-001",
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
}
```

`startedAt` is integer UTC epoch milliseconds, no later than the proof clock
and at most eight hours before its fixed deadline. The supported
ceilings are requests 960, bytes 8,388,608, global events 1,000 (the checkpoint
step further caps ledger events at 256), candidates 100, cycles 256, duration
eight hours, callback timeout 30 seconds, and clock uncertainty 60 seconds.
Bytes have a 1,024-byte minimum. External mode reserves the packet bytes before
assigning runner input capacity and therefore requires at least one byte to
remain; a smaller-than-needed budget can stop the runner before a terminal
receipt, which remains explicit in the report.
Callback timeout cannot exceed duration; candidate count cannot exceed cycles.
The config file is limited to 64 KiB and opened nonblocking without following
symlinks; only regular files are accepted.

Generate a fresh current start time and a unique state path when running the
example (the fixed number in the JSON above is illustrative):

```sh
RUN_ID="memecoin-offline-proof-$(date -u +%Y%m%dT%H%M%SZ)"
START_AT="$(date -u +%s%3N)"
STATE_DIR="/tmp/$RUN_ID"
mkdir "$STATE_DIR"
cat > "/tmp/$RUN_ID.json" <<JSON
{
  "version": 1,
  "mode": "SYNTHETIC_TEST_ONLY",
  "enabled": true,
  "runId": "$RUN_ID",
  "startedAt": $START_AT,
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
}
JSON
```

The exact command is:

```sh
node scripts/memecoin-paper/paper-pilot-composition.mjs offline-proof \
  --config "/tmp/$RUN_ID.json" \
  --data-dir "$STATE_DIR"
```

Without `offline-proof`, the command prints `DISABLED`. The CLI constructs only
the repository's generated synthetic candidate and hypothetical quotes. It
never starts acquisition from a provider. The state directory must be new for
each run: an existing checkpoint or pre-start binding returns
`RESTART_NOT_ALLOWED`; there is no replay migration or restart path.

Before sequence zero is published, each new run writes and fsyncs an immutable
`start-binding.json` containing the canonical config digest, producer revision,
run/window/policy identity, and (for external evaluation) the bounded input
digest. It is not a ledger/checkpoint format change. A binding without a
checkpoint is never treated as proof that a run completed.

The synthetic factory accepts only module-generated adapters from
`offlineFixtureAdapters({clock?, fault?})`. It does not accept caller-supplied
callbacks, fixture candidates, quotes, clock functions, or storage hooks. The
finite `fault` enum is offline-only and exercises disconnect, timeout, stop,
clock-jump, lost-ack, no-candidate, evidence/cost rejection, and unavailable-mark
paths. It cannot perform network access or relabel caller-supplied market data.

The external path is a distinct data-only, no-entry evaluation. Its bounded
packet contract is:

```json
{
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
    "receiptTimestamp": 1793651881000,
    "uncertaintyMs": 0,
    "monotonicElapsedMs": 1000,
    "clockSource": "UNATTESTED"
  },
  "payload": {
    "candidates": [{
      "chainId": "solana",
      "mint": "11111111111111111111111111111111",
      "pool": "Vote111111111111111111111111111111111111111",
      "quote": "Stake11111111111111111111111111111111111111",
      "decimals": 6,
      "sampledAt": 1793651880000,
      "source": "caller-claimed-source",
      "evidence": {},
      "analystEvidence": {}
    }]
  }
}
```

`sourceContracts` values are either `null` or lowercase 40/64-character SHAs;
the packet, including `payload`, is bounded to 8 MiB and detached from caller
objects. The candidate array is bounded by the configured candidate count; the
legacy singular `payload.candidate` shape is also accepted. All producer, SHA,
source-label, source-time, and clock fields remain caller claims. None is an
attestation or an accepted dependency pin. The exact API is:

```js
import {createPaperPilotComposition} from
  "./scripts/memecoin-paper/paper-pilot-composition.mjs";
import {createBoundedExternalReadOnlyInput} from
  "./scripts/memecoin-paper/execution-runner.mjs";

const externalReadOnlyInput = createBoundedExternalReadOnlyInput(packet);
const pilot = createPaperPilotComposition({
  config: {...config, mode: "EXTERNAL_READ_ONLY_INPUT"},
  dataDirectory: "/absolute/path/to/new-empty-state",
  externalReadOnlyInput
});
const result = await pilot.start();
const runExport = result.report;
```

This path accepts no callbacks and performs no acquisition. It replaces each
candidate source with the code-owned `UNVERIFIED_EXTERNAL_READ_ONLY_INPUT`
label, preserves the original label only as `sourceClaim`, and forces every
supplied evidence item's `verified` flag to `false`. Candidates go through the
existing scout, filter, analyst, risk, and runner finish path; a valid bounded
candidate therefore gets a durable no-entry terminal result even when its hard
evidence is UNKNOWN. It never calls an entry/exit quote source or `executeEntry`.
The report records the filter/analyst decision and caller claims, while its
immutable start binding commits to the complete input digest. SHA claims alone
cannot turn the data into trusted evidence.

Input copying, candidate count, request count, result bytes, runner input, ledger
events, ticks, and monotonic elapsed time remain bounded by the one config budget.
The external path uses a local receipt clock only to detect invalid or jumping
wall time; `trustedUtc` is false and packet clock claims are not substituted.
Missing trusted source time, evidence, an accepted owner census, source-bound
quotes, and complete source costs remain explicit blockers. The existing
`SYNTHETIC_FIXTURE_CLOCK` still tests the synthetic wall/monotonic path only.

Checkpointed authorization/entry records preserve exact
chain/mint/pool/quote identity, units, source sample time, and full evidence.
External blocked candidates do not create synthetic ledger events; the pre-start
receipt binds the packet digest and the runner report carries the filter/analyst
decision. Synthetic quote provenance distinguishes source observation from
local receipt time; prices are integer `priceMicros`, costs are explicitly
hypothetical integer cents, and quantities are token base units. These
zero-cost synthetic fixtures are not source-verified settled-cost estimates.
The existing runner and execution step reject a quote without all five costs, a
future/stale/noncausal quote, identity mismatch, or source-mode mixing. An
unavailable final mark stays `VALUATION_UNAVAILABLE`; an open position is never
closed or valued by assumption. If quote/cost rejection follows risk
authorization, the runner report preserves the still-pending reservation rather
than claiming it was released.

## Terminal contract and verification

Both modes delegate terminal finalization to the accepted #1146 execution runner
and #1160 execution-step/checkpoint path. The export is
`memecoin-paper-run-export/v1`, a thin envelope over the **unmodified** runner
report and actual canonical checkpoint. It does not project a second accounting
or terminal API:

```json
{
  "schemaVersion": "memecoin-paper-run-export/v1",
  "producerRevision": "paper-pilot-composition/3",
  "config": {"version": 1, "...": "canonical validated config"},
  "configSha256": "<sha256 of canonical config bytes>",
  "runId": "<checkpoint run id>",
  "startedAt": 1793651880000,
  "deadlineAt": 1793680680000,
  "policyVersion": "memecoin-paper-ledger-v2-monotonic-time",
  "runnerReport": {"status": "FINISHED", "...": "actual runner fields"},
  "checkpoint": {
    "formatVersion": 1,
    "runHeader": {"runId": "...", "startedAt": 1793651880000, "...": "..."},
    "sequence": 8,
    "records": ["full actual canonical checkpoint records"]
  },
  "checkpointSha256": "<sha256 of canonical checkpoint bytes>",
  "persistence": "ACKNOWLEDGED | UNKNOWN | NOT_STARTED",
  "exportBinding": "PRESTART_BOUND | EXPORT_ASSERTED",
  "bindingReceipt": {
    "schemaVersion": "memecoin-paper-start-binding/v1",
    "producerRevision": "paper-pilot-composition/3",
    "runId": "...",
    "startedAt": 1793651880000,
    "deadlineAt": 1793680680000,
    "policyVersion": "memecoin-paper-ledger-v2-monotonic-time",
    "configSha256": "<sha256>",
    "externalInputSha256": null,
    "receiptSha256": "<sha256 of preceding receipt fields>"
  }
}
```

The receipt is exactly `{runId, sequence, hash, resultDigest}`. When present, it
must match the runner report, the full checkpoint hash/head, and the final record.
That record must have method `finishRun`; its `commandId` must match
`runnerReport.terminalResult.commandId`, and its result digest must match both
the terminal result receipt and final checkpoint record. `session.metadata` is
not checkpoint content. The export cross-checks `runId`, `startedAt`,
`deadlineAt`, and `policyVersion` against `checkpoint.runHeader`.

The immutable `start-binding.json` is written and fsynced before the initial
checkpoint publication. Its receipt digest binds the canonical config and
producer revision; in external mode it also binds the bounded input digest.
`exportBinding` is `PRESTART_BOUND` only when that receipt verifies;
`EXPORT_ASSERTED` makes no historical config/producer binding claim. Old
checkpoints are never backfilled or migrated. The report is returned as
`result.report`, not persisted as a second accounting artifact.

`runnerReport` preserves the runner's actual status/reason, execution mode,
provenance, receipts, operation results, terminal result/receipt, and summary.
No separate entries/exits/open-position projection is invented. Consumers use
the actual checkpoint inputs and runner summary; preserve
`missingTerminalValuationMints` and open positions exactly. Stop/deadline reason
is a lifecycle outcome, independent of persistence: a `STOPPED` run may have an
acknowledged terminal receipt, while lost ACK is `UNKNOWN` with no invented
receipt. A valid terminal receipt can coexist with a runner `UNKNOWN` result.
Persistence is exactly `ACKNOWLEDGED`, `UNKNOWN`, or `NOT_STARTED`; missing
terminal receipt is represented by `UNKNOWN`, never a fourth enum.

Lost checkpoint acknowledgement remains `UNKNOWN` and is not retried.
Disconnect, timeout, cancellation, clock jump, late deadline, restart, missing
evidence/costs, no-candidate, open/unvalued, and duplicate-command behavior are
covered using actual checkpoint files and the accepted runner's independent
risk ticks.

Run the focused offline lifecycle suite:

```sh
node --test test/memecoin-paper-pilot-composition.test.js
node --test test/memecoin-paper-execution-runner.test.js
```

## Exact current integration boundary and blockers

This is not a relabeling of the observation-only
[`pilot-online.mjs`](../../../scripts/memecoin-paper/pilot-online.mjs). Its
published dependency pins remain provider `b000c6a6dcfcce102e61821e8316174a15a0dd58`,
controller `89a20bf118e059c6153ac75b51f2ed6947d46332`, and report
`14075eef9ef0eebde3249718a6f6e3c51016bdee`; that runner has no authorized entry
or simulated fill. The synthetic lifecycle instead reuses accepted runner
#1146 (`df0ee9a5d089d327db9be5981c3340f1de14b6ef`) and terminal #1160
(`3dfc5031be90f5d9c31e5777afdaa3c6ddd7b04`). The execution evidence contract
confirms that current public
sources cannot establish token authorities/extensions, LP proof, owner
distribution, developer history, bundled supply, complete analyst evidence,
executable quotes, or validated exact costs
([`EXECUTION_EVIDENCE.md`](EXECUTION_EVIDENCE.md), especially its capability
matrix). Provider receipt time is not a source market timestamp. Synthetic
fixtures cannot fill these gaps.

Intake #1150 remains open; quote #1157 and evidence #1158 remain draft/open.
Their source SHAs and interfaces are caller claims, not accepted pins. The
external candidate path therefore produces durable blocked/no-entry results and
does not authorize simulated fills. Candidate intake provenance, complete hard
and analyst evidence, source-bound quote/cost semantics, and trusted source-time
attestation remain blockers.

The accepted #1152 owner-census interface is reconciled but is not treated as an
eligible hard-gate source. `acquireOwnerCensus()` reports
`RECONCILED_RPC_RESPONSE_ONLY`, leaves `filterEvidence.verified` and coverage
false, emits no `top10OwnerPct`, and documents unauthenticated RPC completeness
and unsupported pool exclusions. It therefore cannot satisfy the existing
owner-concentration gate. Its injected transport/clock is not wired into this
composition or allowed to bypass the shared budget/cancellation boundary.
Holder evidence remains UNKNOWN until a separately reviewed source supplies
authenticated completeness, pool/burn exclusions, and identity/time binding.

### Concrete integration patch proposal (not applied)

After #1150/#1157/#1158 are accepted at exact SHAs and their source/time,
identity/units, cancellation, and complete-cost semantics are reviewed, a
lead-guarded patch can replace only the module-owned packet-to-candidate adapter:

1. Construct the exact `MEMECOIN_EXTERNAL_READ_ONLY_INPUT_V1` envelope from the
   accepted intake, evidence, and quote exports; caller SHA values alone remain
   insufficient.
2. Keep source labels, timestamps, evidence verification, and cost data bound to
   their producer's actual source and receipt records. Do not copy fixture fields
   or promote any owner census result that still reports UNKNOWN.
3. Use the existing `createPaperPilotComposition()` signal, common request/
   byte/event/candidate/time budgets, `scout`, `createPaperExecutionStep`, and
   accepted execution runner. No second runner, checkpoint schema, ledger format,
   terminal API, or replay migration is proposed.
4. Preserve default-disabled behavior. The external mode stays no-entry until
   every hard gate, quote/cost requirement, trusted-time condition, and immutable
   pre-start binding validates. The terminal boundary remains the runner's
   acknowledged `finishRun` receipt and actual checkpoint.

The exact producer integration call shape is:

```js
const packet = createBoundedExternalReadOnlyInput({
  kind: "MEMECOIN_EXTERNAL_READ_ONLY_INPUT_V1",
  schemaVersion: 1,
  producerRevision: acceptedProducerRevision,
  sourceContracts: {
    candidateIntakeSha: accepted1150Sha,
    evidenceSha: accepted1158Sha,
    quotesSha: accepted1157Sha
  },
  timing: reviewedSourceAndReceiptTiming,
  payload: boundedAcceptedSourceOutput
});
const composition = createPaperPilotComposition({
  config: {...reviewedConfig, mode: "EXTERNAL_READ_ONLY_INPUT"},
  dataDirectory: "/absolute/path/to/new-empty-state",
  externalReadOnlyInput: packet
});
const result = await composition.start();
```

This API is executable for bounded no-entry evaluation today; using unaccepted
producer exports does not make it live-ready. Caller-supplied SHA strings alone
are not proof. No provider, wallet, signing, order, or deployment API is part of
this proposal.

The required independent accounting, methodology, security review, hosted CI,
and subsequent lead-guarded integration have not been performed by this offline
proof. No launch or operational readiness is claimed.
