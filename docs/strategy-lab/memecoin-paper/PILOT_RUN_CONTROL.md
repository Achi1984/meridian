# Offline Paper pilot run control

**Disposition: isolated control-contract prototype only. This module does not
start, authorize, or activate a Paper run.** It performs no acquisition,
strategy, ledger, checkpoint-store, or report work of its own. Its optional
`READ_ONLY_PAPER` label supports injection of a read-only acquisition callback;
it is not a live mode, an owner-authority check, or evidence that a worker is
approved. No CLI, automatic start, provider, or execution adapter is added.
The controller exposes no order, wallet, or real-money API. The disabled
manifest and #996 risk policy are unchanged. Supplying callbacks does not
authorize their binding to real sources.

## Invocation and bounds

`scripts/memecoin-paper/pilot-run-control.mjs` exports
`createPilotRunControl(options)`. Importing it has no timer, filesystem,
network, process, provider, or strategy side effects. Calling it without a
`mode` creates a disabled controller; `start()` returns `DISABLED` and calls
nothing. The only accepted modes are the unmistakably labelled
`SYNTHETIC_TEST_ONLY` and `READ_ONLY_PAPER`. `LIVE`, `REAL`, boolean
enable/authorization options, and other modes are rejected. Mode is an explicit
label only: it does not authenticate a host, verify a read-only worker, or
authorize a run. Runtime authority is external and remains `EXTERNAL`.
There is no auto-start.

The explicit controller invocation shape is:

```js
const control = createPilotRunControl({
  mode: READ_ONLY_PAPER,
  callbacks: {acquire, step, checkpoint, report},
  clock: monotonicNow,
  scheduler: {setTimeout, clearTimeout},
  signal, // optional AbortSignal
  budgets: {
    requests, events, cycles, durationMs, pollIntervalMs, callbackSettlementMs
  }
});
const terminal = await control.start();
```

The module exports `SYNTHETIC_TEST_ONLY`, `READ_ONLY_PAPER`, and
`PILOT_EVIDENCE_SOURCE`. `SYNTHETIC_TEST_ONLY` labels fixture evidence as
`SYNTHETIC_FIXTURE_ONLY`; `READ_ONLY_PAPER` labels an injected acquisition
boundary as `READ_ONLY_PROVIDER_CALLBACK`. `acquire` must return this exact
mode-matched value in its `evidenceSource` field along with `events` and
`requestsUsed`. A mismatched or absent source label stops before stepping with
`UNKNOWN`. The labels are caller-contract consistency checks, not source
authentication. Callback implementations must independently guarantee their
own read-only behavior and accurate request accounting.

`control.stop()` is the idempotent operator-stop hook. It can be requested
before or during a run. Repeated `start()` calls share the same one-shot
terminal promise. The required integer limits are 0–10,000 acquisition requests,
events, and cycles; duration is 1 ms through eight hours; polling delay is 1 ms
through 60 seconds; and callback settlement is 1 ms through 60 seconds. A zero
work budget starts no cycle. The injected monotonic clock must return finite,
nonnegative, nondecreasing numbers. The duration is measured from its first
sample and no new callback starts at or after the exact deadline.

`requests` counts the reported request units, not controller invocations. Each
acquisition receives the remaining request and event budgets. It must enforce
the request limit before dispatch and return the actual bounded `requestsUsed`;
an omitted, invalid, or over-budget count stops before any event is stepped.
The controller cannot police a callback that lies about or bypasses its own
request accounting. `events` counts events passed to `step`; a batch larger
than the remaining budget is rejected whole, never silently truncated.
`cycles` counts acquisition cycles. Polling is scheduled only after a cycle
settles, so slow work cannot overlap or cause catch-up bursts.

## Callback contracts

All callbacks are injected functions and receive one object containing
`mode`, `evidenceSource`, the listed fields, and an `AbortSignal`. The report
callback receives `{summary, mode, evidenceSource, signal}`. The terminal
summary also reports `acquisitionStarted`, `executionStarted: false`,
`externalExecutionStatus: "NOT_ASSESSED"`, and `runtimeAuthority: "EXTERNAL"`.
`executionStarted: false` means this controller invokes no trading/engine
execution API; it cannot prove that arbitrary injected callbacks have no
external side effects. These fields do not assert host verification or run
authorization.

| Callback | Input | Return contract |
| --- | --- | --- |
| `acquire` | `mode`, `evidenceSource`, `cycleIndex`, `remainingRequests`, `remainingEvents`, `deadlineAtMonotonicMs` | `{evidenceSource: exact mode-matched label, events: Array, requestsUsed: nonnegative safe integer, done?: boolean}`. `events` must fit the remaining event budget. |
| `step` | `cycleIndex`, `eventIndex`, `event` | Optional `{unresolvedPositions: bounded plain-data array}`. These are supplied evidence only; the controller does not derive positions, liquidation, or P&L. |
| `checkpoint` | `cycleIndex`, `eventCount`, `completedSteps`, `unresolvedPositions`, `positionEvidenceStatus`, `positionEvidenceSourceStep`, `lastKnownPositionEvidence` | `{status: "ACKNOWLEDGED", sequence: nonnegative safe integer, hash: lowercase SHA-256 hex}` only after the integration verifies the durable receipt. Any other result is `UNKNOWN`. |
| `report` | `mode`, `evidenceSource`, `summary`, `signal` | Its return value is not a durability acknowledgement. The callback is attempted once and bounded by `callbackSettlementMs`; a failed or late report does not change the run's terminal status. |

Acquisition, step, and checkpoint work is sequential. Position evidence is
current only when the latest successfully completed `step` explicitly supplies
a valid `unresolvedPositions` array; an explicit empty array is distinct from
missing evidence. Starting another step invalidates current evidence. If that
step omits or supplies invalid evidence, fails, is unsettled, or settles after
stop, the current status remains `UNKNOWN`. Earlier data may be retained only
under `lastKnownPositionEvidence` with `status: "STALE"` and its source step; it
is never exposed as the current unresolved-position list. A stop also marks
current evidence stale. Checkpoint and terminal-report payloads carry both the
current status/list and the separately labelled last-known evidence. Current
evidence includes `positionEvidenceSourceStep`; empty acquisition cycles do not
refresh that provenance or imply a new position observation.

The checkpoint sequence cannot regress. Reusing the same sequence with a
different hash is `UNKNOWN`. An identical sequence/hash ACK may be repeated
only when event and completed-step counts have not advanced since that ACK; a
repeat after new work cannot acknowledge that work. This is only a local
consistency check: the controller does not authenticate hashes or receipt
contents. The injected checkpoint integration remains responsible for proving
that each ACK is the durable readback for the state it claims to acknowledge.

On stop, the active callback receives an aborted signal. If it does not settle
within the configured settlement bound, the controller returns `UNKNOWN`,
starts no new work, and does not retry or recover it. A completed step is not
treated as durable until the checkpoint hook acknowledges it. If a checkpoint
hook settles with a valid acknowledgement while stopping, that acknowledgement
is retained without resuming the run. Callback completion, checkpoint
acknowledgement, and the returned terminal summary are separate fields.

The terminal report receives the status and acknowledgement known before
reporting begins. In particular, it cannot turn an `UNKNOWN` checkpoint into a
durable `FINISHED` result. An absent acknowledgement, uncertain write, invalid
clock, callback failure, or unbounded settlement produces `UNKNOWN`. Supplied
unresolved-position evidence is retained in a bounded summary only as current
when its freshness contract above is satisfied; absent evidence is reported as
`UNKNOWN`, not as an empty portfolio. No code here fabricates liquidation or
P&L. Timer handles and the parent abort listener are cleaned up when the
one-shot operation terminates.

If active work becomes unsettled and the terminal report callback then throws
or rejects, `reportStatus` is `FAILED`; the run remains `UNKNOWN`. A rejection
that arrives after the settlement timeout is consumed but cannot revise the
already returned terminal summary or change terminal state. Report completion
or failure does not acknowledge checkpoint durability.

## Existing contracts and proposed future glue

This controller deliberately does not import or call any existing producer.
These are the actual interfaces on the inspected `main` base
`c60bb6a2516ab88000ece3c339bcc740280a9ba7`:

- `PaperCheckpointSession.open({store, runId, startedAt})` is in
  [`checkpoint-session.mjs`](../../../scripts/memecoin-paper/checkpoint-session.mjs).
  Its commands replay through the existing ledger. The current orchestration
  contract reads `store.readCheckpoint()` and compares its `status`, `hash`,
  and `sequence` with `session.metadata`; its command records also bind the
  command ID and result digest. A future glue callback may emit the controller's
  acknowledgement only after the applicable receipt/readback checks succeed.
  The controller does not open, close, resume, reconcile, or recover a session.
- [`runSyntheticPaperOrchestration`](../../../scripts/memecoin-paper/orchestration.mjs)
  accepts the unchanged disabled manifest and named generated scenarios only.
  It is not a control adapter or real-data launch path.

The neighboring source lanes were unmerged when inspected; these names are
references for a future integration sketch, not dependencies of this module:

- PR #1108 adds `acquireProviderEvidence(options)` in
  `provider-evidence.mjs`. A proposed `acquire` glue layer would adapt its
  bounded `events` and `counters.requests` into the mode-labelled
  `{evidenceSource, events, requestsUsed}` contract while enforcing controller
  and provider budgets. The read-only mode/evidence-source values are now
  explicit for #1112 to propagate, but are not source-authentication evidence.
  Unsupported evidence remains `UNKNOWN`. The branch-only module is not
  imported here.
- PR #1104 adds `projectOperatorReport(input)` and
  `renderOperatorReport(report)` in `operator-report.mjs`. Those project
  existing replay/checkpoint result shapes; this controller summary is not one
  of those inputs. A future `report` adapter must construct the supported
  receipt/result projection from verified evidence. Passing this summary
  directly or claiming a report is durable is not supported.
- PR #1103's coordinator cancellation work is not imported or bound here.
  `signal` propagation in this controller is a local callback contract only.

The snippets above are integration requirements, not executable glue. No
current export wires these callbacks to provider, strategy, ledger,
checkpoint, or operator-report APIs.

## Readiness boundary and validation

The #1106 readiness projection distinguishes source readiness, operational
verification, and run authority; authorization is unconditionally false.
It records that the provider request adapter, real-run orchestration, stop,
watchdog, and reporting commands are not implemented. This controller supplies
only isolated control plumbing and does not clear any of those launch blockers.
`READ_ONLY_PAPER` does not mean "approved to run"; it only tells downstream
callbacks and reports which mode/evidence-source contract they must use.
Trusted clock provenance/skew policy, host-specific storage durability,
independent review, exact run configuration, and owner authorization remain
unresolved deployment prerequisites. The monotonic clock and callback
acknowledgement supplied here are not authenticated.

Tests in `test/memecoin-paper-pilot-run-control.test.js` use only generated
callback recordings, barriers, a fake clock, and a fake scheduler. They do not
load providers, run the strategy/ledger, access the filesystem or network, or
simulate trades. Run the focused suite with:

```sh
node --test test/memecoin-paper-pilot-run-control.test.js
```

The tests cover default-disabled behavior, mode rejection, deadline boundaries,
operator and parent cancellation, callback settlement, sequential acquisition,
all work budgets, checkpoint sequence and repeat-ACK boundaries, missing timer
handles, late checkpoint acknowledgements, position-evidence provenance,
unknown acknowledgements, late results, report failure/timeout, one-shot
terminal emission, monotonic regression, and cleanup.
This is not evidence of real-source readiness, durable host behavior, or
permission to start the eight-hour Paper pilot.
