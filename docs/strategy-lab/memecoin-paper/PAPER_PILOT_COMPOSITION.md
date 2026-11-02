# Bounded Paper-pilot composition — offline proof only

**Status: runner-backed synthetic integration proof; real-source composition and
launch are BLOCKED.** The
[`paper-pilot-composition.mjs`](../../../scripts/memecoin-paper/paper-pilot-composition.mjs)
uses the accepted #1146 `execution-runner.mjs`, execution-step, checkpoint
session, and fixed-point ledger. Its runnable trade path is
`SYNTHETIC_TEST_ONLY`; fixtures remain synthetic through evidence, quotes,
provenance, report output, and durable checkpoint. The separate
`EXTERNAL_READ_ONLY_INPUT` contract is deliberately bounded but returns
`UNKNOWN` without starting execution while candidate intake, evidence, quote,
cost, and trusted-time producers remain unaccepted. No provider, order, wallet,
signer, deployment, or live-ready path is enabled. Import and no-argument CLI
invocation are inert/disabled.
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

`startedAt` is integer UTC epoch milliseconds, no later than the proof's
synthetic clock and at most eight hours before its fixed deadline. The supported
ceilings are requests 960, bytes 8,388,608, global events 1,000 (the checkpoint
step further caps ledger events at 256), candidates 100, cycles 256, duration
eight hours, callback timeout 30 seconds, and clock uncertainty 60 seconds.
Bytes have a 1,024-byte minimum; a smaller-than-needed budget can
stop the runner before a terminal receipt, which remains explicit in the report.
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
each run: an existing checkpoint, including a terminal one, returns
`RESTART_NOT_ALLOWED`; there is no replay migration or restart path.

The synthetic factory accepts only module-generated adapters from
`offlineFixtureAdapters({clock?, fault?})`. It does not accept caller-supplied
callbacks, fixture candidates, quotes, clock functions, or storage hooks. The
finite `fault` enum is offline-only and exercises disconnect, timeout, stop,
clock-jump, lost-ack, no-candidate, evidence/cost rejection, and unavailable-mark
paths. It cannot perform network access or relabel caller-supplied market data.

The bounded external read-only input is a distinct, data-only packet. Its exact
shape is:

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
  "payload": {"candidate": {}, "evidence": {}, "quotes": []}
}
```

`sourceContracts` values are either `null` or lowercase 40/64-character SHAs;
the packet, including `payload`, is bounded to 8 MiB and detached from caller
objects. These producer/time fields are claims, not attestations. The API is:

```js
import {createPaperPilotComposition} from
  "./scripts/memecoin-paper/paper-pilot-composition.mjs";
import {createBoundedExternalReadOnlyInput} from
  "./scripts/memecoin-paper/execution-runner.mjs";

const externalReadOnlyInput = createBoundedExternalReadOnlyInput(packet);
const pilot = createPaperPilotComposition({
  config: {...config, mode: "EXTERNAL_READ_ONLY_INPUT"},
  externalReadOnlyInput
});
const report = await pilot.start();
```

This path accepts no callbacks and performs no acquisition. Until the source
contracts are accepted and wired, it returns `UNKNOWN`, zero entries, no
checkpoint/terminal receipt, `executionStarted: false`, and explicit unresolved
producer/time/cost blockers. Caller source labels cannot turn this packet into
trusted evidence or synthetic fixtures.

The following callback interface is the proposed contract for future accepted
source adapters; it is **not wired or callable in this offline proof**:

```text
acquireCandidates({signal, now, deadlineAt, remaining, recordRequest})
  -> Promise<Candidate[]>
entryQuote({signal, now, deadlineAt, remaining, candidate, authorization, recordRequest})
  -> Promise<Quote | null>
exitQuote({signal, now, deadlineAt, remaining, candidate, purpose, previousQuote, recordRequest})
  -> Promise<Quote | null>
```

For a future accepted adapter, each callback must be single-shot, sequential,
signal-cancellable, and timed; no retries are permitted. Its
`recordRequest({bytes, events})` boundary must charge the cumulative
request/response-byte/provider-event budget before further work is admitted, and
returned data must remain shape/byte bounded. `deadlineAt` is the earlier of the
fixed eight-hour boundary and the composition budget deadline; `remaining.timeMs`
reports the remaining wall/monotonic-bounded callback time. The implemented offline proof
charges callback, candidate, decision, and actual ledger events to one cap, plus
cycles and elapsed monotonic time. Its generated
`SYNTHETIC_FIXTURE_CLOCK` tests wall/monotonic consistency and uncertainty
bounds, not a trusted host clock.

Each checkpoint-bound candidate records exact chain/mint/pool/quote identity,
token decimals/base-unit semantics, source sample time, composition receipt
time, and per-evidence SHA-256 digest, source, time, slot, identity binding, and
coverage-complete state (the full evidence remains in the checkpoint). Quote
provenance distinguishes quote-source observation from local receipt time;
prices are integer `priceMicros`, costs are explicitly hypothetical integer
cents, and token quantities are base units. These zero-cost synthetic fixtures
are not source-verified settled-cost estimates. The existing runner and execution
step reject a quote without all five costs, a future/stale/noncausal quote,
identity mismatch, or source-mode mixing. An unavailable final mark stays
`VALUATION_UNAVAILABLE`; an open position is never closed or valued by
assumption. If quote/cost rejection follows risk authorization, the report keeps
the still-pending reservation instead of claiming it was released.

## Terminal contract and verification

The synthetic path delegates terminal finalization to the accepted #1146
execution runner and #1160 execution-step/checkpoint path. The receipt is the
actual `finishRun` command receipt, bound to the checkpoint sequence, SHA-256
head hash, result digest, and command ID. The report's checkpoint reference is
the runner's session metadata; the terminal receipt is only included after the
runner validates the acknowledgement. There is no separate report persistence
API and no proposed `recordTerminal`/`recordUnknown` API.

The export schema is `memecoin-paper-pilot-report/v1`:

```json
{
  "schemaVersion": "memecoin-paper-pilot-report/v1",
  "producerRevision": "paper-pilot-composition/2",
  "configDigest": "<sha256 of canonical validated config>",
  "runId": "<checkpoint run id>",
  "status": "FINISHED | STOPPED | UNKNOWN | BLOCKED",
  "strategyOutcome": "CLOSED_PAPER | NO_CANDIDATES | BLOCKED | REJECT | ...",
  "mode": "SYNTHETIC_TEST_ONLY | EXTERNAL_READ_ONLY_INPUT",
  "executionMode": "SIMULATED_ONLY | READ_ONLY_EXTERNAL",
  "realDataSourceCoverage": "NOT_ASSESSED",
  "authority": {"executionAuthorized": false, "liveReady": false},
  "persistence": {
    "certainty": "ACKNOWLEDGED | UNKNOWN | NO_TERMINAL_RECEIPT | NOT_STARTED",
    "checkpointRef": {"runId": "...", "sequence": 8, "hash": "..."},
    "terminalReceiptRef": {
      "runId": "...", "sequence": 8, "hash": "...",
      "resultDigest": "...", "commandId": "..."
    }
  },
  "outcomes": {
    "entries": [],
    "exits": [],
    "openUnvaluedPositions": [],
    "unresolved": []
  }
}
```

`checkpointRef` and `terminalReceiptRef` are nullable when the checkpoint or
terminal acknowledgement is not known; they are never synthesized. The
`strategyOutcome` is separate from the lifecycle `status` and from persistence
certainty.

Entry/exit rows contain the actual runner operation status, chain/mint/pool/quote
identity, base-unit quantity, quote price, explicit cents, source label, source
timestamp, local receipt timestamp, and checkpoint sequence. Synthetic rows
declare `costBasis: "HYPOTHETICAL_FIXTURE_ONLY"`; no settled-source cost is
claimed. Open unvalued rows preserve mint, base-unit quantity, unavailable mark
status, and null equity. `status` and `persistence.certainty` are independent:
for example, an explicit stop is `STOPPED` with `ACKNOWLEDGED` persistence when
`finishRun` was acknowledged; an uncertain write has no invented receipt.
`UNKNOWN` due to an unavailable source can still have an acknowledged terminal
receipt, but the unresolved source outcome remains explicit.

The report export is derived from runner results and their real checkpoint
references; it is not itself written as a second artifact. Evaluators should
bind to `schemaVersion`, `producerRevision`, `configDigest`, `runId`, and the
actual receipt references, and must not treat a successful synthetic report as
simulated-trading or real-data acceptance.

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

Intake #1150 is open; quote #1157 and evidence #1158 are draft/open. Their
branches and interfaces are not consumed as accepted dependencies. The external
input packet above defines the bounded handoff envelope but does not authenticate
its producer claims or process its payload. The current runner gate therefore
returns `UNKNOWN` before checkpoint creation. Candidate intake, complete
evidence, source-bound quote/cost semantics, and trusted clock/provenance remain
operational blockers; no `READ_ONLY_EXTERNAL` packet can authorize a simulated
entry in this revision.

### Concrete integration proposal (not applied)

After #1150/#1157/#1158 have merged at accepted SHAs and their exact source/time
and cancellation contracts have been reviewed, the lead-owned integration is to
replace the untrusted packet gate with a dedicated adapter that emits this
versioned envelope from those exact exports. The adapter must independently
validate producer SHA, identity/units, evidence completeness and source-versus-
receipt times, and pass the existing global budget/signal/deadline controls.
Until that integration change is reviewed, the only runnable composition is the
synthetic fixture path. The present external input API must continue returning
`UNKNOWN` and must not create checkpoint state.

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
  externalReadOnlyInput: packet
});
const report = await composition.start();
```

The snippet is a schema binding example, not executable real-source wiring: all
three producer SHAs and their exports must be accepted before use, and caller-
supplied SHA strings alone are not proof. No provider, wallet, signing, order, or
deployment API is part of this proposal.

The required independent accounting, methodology, security review, hosted CI,
and subsequent lead-guarded integration have not been performed by this offline
proof. No launch or operational readiness is claimed.
