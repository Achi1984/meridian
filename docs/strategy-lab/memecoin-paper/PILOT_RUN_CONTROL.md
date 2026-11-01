# Offline Paper pilot run control

**Disposition: isolated control-contract prototype only. No Paper run is
startable or authorized.** This module is default-disabled, has no live mode or
CLI, and performs no acquisition, strategy, ledger, checkpoint-store, or report
work of its own. It does not change the disabled manifest or the #996 risk
policy. Supplying callbacks is not authorization to bind them to real sources.

## Invocation and bounds

`scripts/memecoin-paper/pilot-run-control.mjs` exports
`createPilotRunControl(options)`. Importing it has no timer, filesystem,
network, process, provider, or strategy side effects. Calling it without a
`mode` creates a disabled controller; `start()` returns `DISABLED` and calls
nothing. The only accepted mode is the unmistakable
`SYNTHETIC_TEST_ONLY` string. `REAL`, boolean enable/authorization options, and
other modes are rejected. There is no auto-start.

The explicit test-only controller shape is:

```js
const control = createPilotRunControl({
  mode: SYNTHETIC_TEST_ONLY,
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

All callbacks are injected functions and receive one object containing the
listed fields and an `AbortSignal`.

| Callback | Input | Return contract |
| --- | --- | --- |
| `acquire` | `cycleIndex`, `remainingRequests`, `remainingEvents`, `deadlineAtMonotonicMs` | `{events: Array, requestsUsed: nonnegative safe integer, done?: boolean}`. `events` must fit the remaining event budget. |
| `step` | `cycleIndex`, `eventIndex`, `event` | Optional `{unresolvedPositions: bounded plain-data array}`. These are supplied evidence only; the controller does not derive positions, liquidation, or P&L. |
| `checkpoint` | `cycleIndex`, `eventCount`, `completedSteps`, `unresolvedPositions`, `positionEvidenceStatus`, `lastKnownPositionEvidence` | `{status: "ACKNOWLEDGED", sequence: nonnegative safe integer, hash: lowercase SHA-256 hex}` only after the integration verifies the durable receipt. Any other result is `UNKNOWN`. |
| `report` | `{summary, signal}` | Its return value is not a durability acknowledgement. The callback is attempted once and bounded by `callbackSettlementMs`; a failed or late report does not change the run's terminal status. |

Acquisition, step, and checkpoint work is sequential. Position evidence is
current only when the latest successfully completed `step` explicitly supplies
a valid `unresolvedPositions` array; an explicit empty array is distinct from
missing evidence. Starting another step invalidates current evidence. If that
step omits or supplies invalid evidence, fails, is unsettled, or settles after
stop, the current status remains `UNKNOWN`. Earlier data may be retained only
under `lastKnownPositionEvidence` with `status: "STALE"` and its source step; it
is never exposed as the current unresolved-position list. A stop also marks
current evidence stale. Checkpoint and terminal-report payloads carry both the
current status/list and the separately labelled last-known evidence.

Acquisition, step, and checkpoint work is sequential. On stop, the active
callback receives an aborted signal. If it does not settle within the configured
settlement bound, the controller returns `UNKNOWN`, starts no new work, and
does not retry or recover it. A completed step is not treated as durable until
the checkpoint hook acknowledges it. If a checkpoint hook settles with a
valid acknowledgement while stopping, that acknowledgement is retained without
resuming the run. Callback completion, checkpoint acknowledgement, and the
returned terminal summary are separate fields.

The terminal report receives the status and acknowledgement known before
reporting begins. In particular, it cannot turn an `UNKNOWN` checkpoint into a
durable `FINISHED` result. An absent acknowledgement, uncertain write, invalid
clock, callback failure, or unbounded settlement produces `UNKNOWN`. Supplied
unresolved-position evidence is retained in a bounded summary only as current
when its freshness contract above is satisfied; absent evidence is reported as
`UNKNOWN`, not as an empty portfolio. No code here fabricates liquidation or
P&L. Timer handles and the parent abort listener are cleaned up when the
one-shot operation terminates.

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
  bounded `events` and `counters.requests` into `{events, requestsUsed}` while
  enforcing both controller and provider budgets. It must also keep unsupported
  evidence `UNKNOWN`. The branch-only module is not imported here.
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
all work budgets, unknown checkpoint acknowledgement, late results, report
failure/timeout, one-shot terminal emission, monotonic regression, and cleanup.
This is not evidence of real-source readiness, durable host behavior, or
permission to start the eight-hour Paper pilot.
