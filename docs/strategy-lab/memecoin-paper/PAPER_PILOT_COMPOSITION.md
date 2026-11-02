# Bounded Paper-pilot composition — offline proof only

**Status: runnable synthetic integration proof; real-data composition and launch
are BLOCKED.** The new
[`paper-pilot-composition.mjs`](../../../scripts/memecoin-paper/paper-pilot-composition.mjs)
connects the existing scout/filter/analyst, execution-step, checkpoint-session,
and fixed-point ledger boundaries. Its only enabled mode is
`SYNTHETIC_TEST_ONLY`; its fixtures remain visibly synthetic through evidence,
quotes, provenance, output, and durable checkpoint. It rejects real-source labels.
No providers, orders, wallets, signers, deployment, or live-ready state are
enabled. Import and no-argument invocation are inert/disabled.
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
ceilings are requests 960, bytes 10,485,760, events 1,000, candidates/cycles
300, duration eight hours, callback timeout 30 seconds, and clock uncertainty
60 seconds. Bytes have a 1,024-byte minimum to fit the existing checkpoint
engine. Callback timeout cannot exceed duration; candidate count cannot exceed
cycles. The config file is limited to 64 KiB.

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

The public factory accepts only the module-generated adapters from
`offlineFixtureAdapters({clock?, fault?})`. It does not accept caller-supplied
callbacks, fixture candidates, quotes, clock functions, or storage hooks. The
finite `fault` enum is offline-only and exercises disconnect, timeout, stop,
clock-jump, lost-ack, no-candidate, evidence/cost rejection, and unavailable-mark
paths. It cannot perform network access or relabel caller-supplied market data.

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
returned data must remain shape/byte bounded. The implemented offline proof
charges callback, candidate, decision, and actual ledger events to one cap, plus
cycles and elapsed monotonic time. Its generated
`SYNTHETIC_FIXTURE_CLOCK` tests wall/monotonic consistency and uncertainty
bounds, not a trusted host clock.

Each checkpoint-bound candidate records exact chain/mint/pool/quote identity,
token decimals/base-unit semantics, source sample time, composition receipt
time, and per-evidence SHA-256 digest, source, time, slot, identity binding, and
coverage-complete state (the full evidence remains in the checkpoint). Quote
provenance distinguishes quote-source observation from local receipt time;
prices are integer `priceMicros`, cost components are explicit integer cents,
and token quantities are base units. The existing execution step rejects a
quote without all five costs, a future/stale/noncausal quote, identity mismatch,
or source-mode mixing. An unavailable final mark stays `VALUATION_UNAVAILABLE`;
an open position is never closed or valued by assumption. If quote/cost rejection
follows a risk authorization, the terminal summary exposes its still-pending
reservation instead of claiming it was released.

## Terminal contract and verification

The terminal receipt is the `finishRun` command receipt from the existing
checkpoint session, with the checkpoint sequence and SHA-256 head hash. It is
not an operator readiness report. A lost checkpoint acknowledgement remains
`UNKNOWN` and is not retried. Disconnect, timeout, cancellation, clock jump,
late deadline, restart, and duplicate command identity are covered against
actual checkpoint files. Stop/uncertainty before finalization has no terminal
receipt; a completed proof records the actual final open/unvalued state.

Run the focused offline lifecycle suite:

```sh
node --test test/memecoin-paper-pilot-composition.test.js
```

## Exact current integration boundary and blockers

This is not a relabeling of the observation-only
[`pilot-online.mjs`](../../../scripts/memecoin-paper/pilot-online.mjs). Its
published dependency pins remain provider `b000c6a6dcfcce102e61821e8316174a15a0dd58`,
controller `89a20bf118e059c6153ac75b51f2ed6947d46332`, and report
`14075eef9ef0eebde3249718a6f6e3c51016bdee`; that runner has no authorized entry
or simulated fill. The execution evidence contract confirms that current public
sources cannot establish token authorities/extensions, LP proof, owner
distribution, developer history, bundled supply, complete analyst evidence,
executable quotes, or validated exact costs
([`EXECUTION_EVIDENCE.md`](EXECUTION_EVIDENCE.md), especially its capability
matrix). Provider receipt time is not a source market timestamp. Synthetic
fixtures cannot fill these gaps.

The issue's dependency interfaces for runner #1146, terminal #1160, intake
#1150, quotes #1157, and evidence/evidence-acquisition packet #1158 are not
present in this checkout, so no unverified APIs or commit IDs are guessed or
imported. Required acceptance is the exact merged SHA and interface contract
for each; those producers must preserve source event times separately from
receipt times, identity/units, evidence coverage and provenance, and obey the
shared cancellation/budget interface above. Until then, real source acquisition,
live timestamps, quotes, and costs are operational blockers—not adapter TODOs
that can be represented as ready.

### Minimal lead-owned integration patch proposal (not applied)

After interface reconciliation and explicit lead ownership transfer for existing
runner/time/provenance files, the proposed extension to the composition call site
is:

```js
const composition = createPaperPilotComposition({
  config: exactReviewedRealReadOnlyConfig,
  dataDirectory: ownedFreshStateDirectory,
  trustedClock: reviewedClockAttestation,
  adapters: {
    acquireCandidates: (bounds) => accepted1150.acquire({
      ...bounds, evidence: accepted1158, provider: accepted1146
    }),
    entryQuote: (request) => accepted1157.entryQuote(request),
    exitQuote: (request) => accepted1157.exitQuote(request)
  }
});
const terminal = await composition.start();
```

The `REAL_READ_ONLY_PAPER`, `trustedClock`, and callback-adapter inputs in this
snippet are proposed additions, not accepted inputs in the checked-in
synthetic-only factory. It is a binding proposal, not executable source: the accepted
dependency exports are intentionally unspecified until their exact SHAs and
contracts are reviewed. Before a live-data adapter can be represented, the
composition must replace its synthetic-only mode with a separately reviewed
real-read-only mode; source labels alone are not proof. The terminal integration
must map `terminalReceipt` only from the actual `finishRun` checkpoint receipt,
map missing final marks to explicit open/unvalued positions, and preserve
`UNKNOWN` after a lost acknowledgement. It must not pass controller summaries
off as durable terminal receipts, replay old checkpoints, or authorize a wallet,
signed transaction, order, or deployment.

The proposed #1160 terminal boundary is deliberately receipt-bearing and
fail-closed:

```js
if (terminal.terminalReceipt) {
  await accepted1160.recordTerminal({
    runId: exactFrozenRunConfig.runId,
    status: terminal.status,
    receipt: terminal.terminalReceipt,
    checkpoint: terminal.checkpoint,
    reservedPositions: terminal.terminalState.reservedPositions,
    openPositions: terminal.terminalState.openPositions,
    equityCents: terminal.terminalState.equityCents
  });
} else {
  await accepted1160.recordUnknown({runId: exactFrozenRunConfig.runId});
}
```

`recordTerminal` / `recordUnknown` are names of this proposed integration
contract, not claims about the absent #1160 producer's current exports. The
terminal consumer must validate the exact checkpoint receipt and preserve
unvalued positions; it may not synthesize acknowledgement or replay a prior
checkpoint.

The required independent accounting, methodology, security review, hosted CI,
and subsequent lead-guarded integration have not been performed by this offline
proof. No launch or operational readiness is claimed.
