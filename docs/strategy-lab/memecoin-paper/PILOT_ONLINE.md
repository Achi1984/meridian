# One-shot READ_ONLY_PAPER worker

**Implementation status: runnable lifecycle adapter with fake-only tests;
production assembly and real-module acceptance remain BLOCKED.** The adapter
does not start on import or without an explicit `READ_ONLY_PAPER` start command.
It is observation-only: it invokes the fixed public-data provider, runs the
existing hard filter and analyst boundaries, and deliberately never calls
`authorizeEntry` or `executeEntry`. Current provider output cannot establish all
hard gates or an executable hypothetical quote and validated costs. No-entry
observation is not an executed-paper-trades test.

## What this checkout implements

`scripts/memecoin-paper/pilot-online.mjs` exposes `createPilotOnline()` and the
`start`, `stop`, `status`, and `report` CLI operations. Checkpoint store/session,
filter, and analyst boundaries come from the current base. Provider, controller,
and report modules are supplied by an explicit assembly module only on `start`;
there are no static imports of branch-only modules and no startup side effects.

The start adapter:

- requires a canonical, externally frozen JSON run configuration bound to one
  run ID, exact eight-hour window, fixed Solana candidate/mint/pool identities,
  credential-free public hosts, and the dependency pins below;
- requires an empty owned checkpoint directory and creates a durable,
  exclusive `run.lock` before opening the checkpoint session or calling a
  provider. The lock and terminal marker are never removed. Any restart,
  residual checkpoint, or missing terminal marker blocks another run;
- calls the provider only from the explicit run-control acquisition callback,
  aggregates request/provider/byte/request-event/candidate totals across
  provider calls, and sends normalized candidates—not provider audit events—to
  the filter/step boundary;
- records one actual `riskSnapshot` checkpoint receipt per acknowledged
  controller checkpoint. A lost or mismatched readback is `UNKNOWN`, is not
  retried, and cannot be reported as a successful durable receipt;
- projects `READ_ONLY_PAPER_CHECKPOINT` only from a readback-bound checkpoint
  snapshot and the complete receipt sequence. The controller summary is never
  passed to the report projector. Report files and the terminal marker are
  distinct from checkpoint receipts;
- accepts an operator `stop` file or SIGTERM/SIGINT, forwards stop to the
  controller, and leaves durable run state that prevents restart.

The existing #996 checkpoint/ledger policy remains authoritative: USD 1,000
virtual capital, maximum 8% entry sizing, three positions, 6% initial stop, 6%
trailing distance after 12% activation, 3% daily loss limit, and an eight-hour
window. This runner does not duplicate that policy or derive P&L, liquidation,
or a simulated fill. Missing provider evidence remains `UNKNOWN`, blocking entry.

## Source pins and acceptance status

These are current source-candidate heads, not approvals or proof of a combined
integration. They are checked against the run configuration and assembly
exports. Re-pin after the producer owners freeze their candidates.

| Dependency | Pin | Expected export | Status |
| --- | --- | --- | --- |
| Base | `fa04cf49842f0350bd4fc21f466984612a139396` | Checkpoint session/store; `filterCandidate`; `analyzeCandidate` | Present in this checkout |
| Provider #1108 | `b000c6a6dcfcce102e61821e8316174a15a0dd58` | `acquireProviderEvidence(options)` | Candidate; independent review pending |
| Controller #1110 | `89a20bf118e059c6153ac75b51f2ed6947d46332` | `createPilotRunControl(options)` with `READ_ONLY_PAPER` and acquire/step/checkpoint/report callbacks | Candidate; source lane not yet final |
| Report #1104 | `14075eef9ef0eebde3249718a6f6e3c51016bdee` | `projectOperatorReport(input)` and `renderOperatorReport(report)` | Candidate; review/CI status must be rechecked at source assembly |

`pilot-online.test.js` injects fake provider/controller/report dependencies and
temporary storage. It does **not** import or execute the pinned producer modules.
No exact-head combined integration has been run; this package must not be
described as end-to-end accepted or as host/run-ready.

The explicit assembly module supplied to `--assembly` must export:

```js
export const pins = {
  provider: "b000c6a6dcfcce102e61821e8316174a15a0dd58",
  controller: "89a20bf118e059c6153ac75b51f2ed6947d46332",
  report: "14075eef9ef0eebde3249718a6f6e3c51016bdee"
};
export const acquireProviderEvidence = /* exact provider export */;
export const createPilotRunControl = /* exact controller export */;
export const projectOperatorReport = /* exact report export */;
export const renderOperatorReport = /* exact report export */;
export const freshnessPolicy = /* explicit bounded provider policy */;
export const transport = /* fixed-request fetch adapter; no custom URL/headers */;
```

The transport receives the provider's fixed request object plus `{signal,
redirect, credentials}` and must return the Fetch `Response` without following
redirects or adding credentials. It must not probe providers during import.
The assembly is deployment integration material and is intentionally not
checked in as an unowned fifth source path. Before acceptance, the lead must
freeze one assembly checkout containing these exact dependency heads and verify
its source tree and host image.

## Configuration and Northflank contract

The run config is JSON with exactly these top-level fields:
`version`, `mode`, `runId`, `startAt`, `endAt`, `dependencyPins`, `manifest`,
`candidates`, and `budgets`. Use integer epoch milliseconds for `startAt` /
`endAt`; `endAt` must be exactly eight hours after `startAt`, and launch must
occur inside that window. `manifest` must bind the same run/window, the two
fixed public provider hosts, `SIMULATED_ONLY`, no credentials/redirects/custom
URLs, and bounded request/byte/event/candidate limits. `candidates` is a
nonempty fixed allowlist of exact Solana chain, mint, pool, and quote identities.
`budgets` separately bounds cumulative total/per-provider requests, response
bytes, provider request events, candidate observations, controller events and
cycles. The code rejects extra fields and noncanonical JSON; no API key or
credential is part of this contract.

Northflank is the current owner-selected target, superseding the earlier Render
choice. The lead must configure a separate one-instance worker in the existing
project with a dedicated persistent volume mounted at the chosen absolute
`--data-dir` (proposed `/data/meridian-paper`), no public port, no scheduled
restarts, and no reuse of existing Meridian service secrets. Verify mount
persistence, filesystem rename/fsync semantics, host clock, Northflank access,
cost, and the security incident/credential posture before assembly or launch.
The adapter cannot prove that a directory is a mounted durable volume. Do not
launch until the lead confirms those host facts and the complete run manifest.
An interrupted or uncertain run remains locked and stopped; recovery is
deliberately manual and cannot be done by restarting the worker.

Build the external assembly only after the source owners freeze their interfaces.
The exact command shape for the lead's authorized one-shot is:

```sh
node scripts/memecoin-paper/pilot-online.mjs start \
  --mode READ_ONLY_PAPER \
  --config /data/meridian-paper/run-config.json \
  --assembly /app/paper-pilot-assembly.mjs \
  --data-dir /data/meridian-paper
```

Operational commands use the same persistent directory and need no provider
assembly:

```sh
node scripts/memecoin-paper/pilot-online.mjs status --data-dir /data/meridian-paper
node scripts/memecoin-paper/pilot-online.mjs stop --data-dir /data/meridian-paper
node scripts/memecoin-paper/pilot-online.mjs report --data-dir /data/meridian-paper
```

`stop` writes an identity-bound durable request that the worker observes; the
active process also handles SIGTERM/SIGINT. `status` reports `UNKNOWN` rather
than guessing if the lock exists without a terminal marker. `report` reads the
separately persisted projection and does not manufacture one from a controller
summary.

## Tests and next acceptance

Run the focused fake-only suite in this base:

```sh
node --test test/memecoin-paper-pilot-online.test.js test/memecoin-paper-pilot-integration.test.js
```

The next required exact-head acceptance is in the authorized integration
checkout after it contains this runner and the three frozen producer pins:

```sh
node --test test/memecoin-paper-pilot-online.test.js \
  test/memecoin-paper-pilot-integration.test.js \
  test/memecoin-paper-pilot-run-control.test.js \
  test/memecoin-paper-provider-evidence.test.js \
  test/memecoin-paper-operator-report.test.js
```

That command alone still does not make the fake-only assembly test a
real-module integration test. The lead must add/run the explicit assembly
acceptance against the exact pinned modules, confirm `UNKNOWN` on mixed source
identity and lost acknowledgement, and record exact-head CI plus independent
review before authorizing a host launch. No provider probe, worker provisioning,
wallet/order, or Paper/Live run has been performed by this coding task.
