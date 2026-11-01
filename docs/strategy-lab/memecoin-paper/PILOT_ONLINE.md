# One-shot READ_ONLY_PAPER worker

**Implementation status: runnable observation-only lifecycle and explicit
pinned-module assembly; real-module acceptance remains BLOCKED in this base
checkout.** The adapter
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

## Pinned source assembly and acceptance status

The explicit `scripts/memecoin-paper/pilot-online-assembly.mjs` assembly lazily
loads producer modules only when that file is selected with `--assembly`. It
supplies the provider's fixed public-fetch adapter and freshness policy; it
does not fetch code, start on import, or bypass the producer exports.
`createPinnedAssembly()` verifies the documented export names before returning
the runner interface. The provider, controller, and report sources are absent
from this base checkout, so this composition cannot yet be executed here.

| Dependency | Pin | Expected export | Status |
| --- | --- | --- | --- |
| Base | `fa04cf49842f0350bd4fc21f466984612a139396` | Checkpoint session/store; `filterCandidate`; `analyzeCandidate` | Present in this checkout |
| Provider #1108 | `b000c6a6dcfcce102e61821e8316174a15a0dd58` | `acquireProviderEvidence(options)` | Owner-reported independent GREEN_LIGHT; not exercised in this checkout |
| Controller #1110 | `89a20bf118e059c6153ac75b51f2ed6947d46332` | `createPilotRunControl(options)` with `READ_ONLY_PAPER` and acquire/step/checkpoint/report callbacks | Owner-reported independent GREEN_LIGHT; not exercised in this checkout |
| Report #1104 | `14075eef9ef0eebde3249718a6f6e3c51016bdee` | `projectOperatorReport(input)` and `renderOperatorReport(report)` | Owner-reported independent GREEN_LIGHT; not exercised in this checkout |

Lifecycle edge tests retain injected fakes. A separate accelerated-clock
eight-hour regression imports the real pinned producers, uses generated
provider fixture responses and temporary storage, verifies all controller
cycles plus the terminal receipt and complete report, and fits the 1,000-row,
1 MiB input, and 256 KiB output bounds. It skips with an explicit BLOCKED
reason when producer sources and their synthetic fixture set are absent. A
skip is not integration acceptance.

The checked-in assembly module is the explicit source composition:

```js
await createPinnedAssembly();
```

The transport accepts only the fixed public origins, exact pair path or
allowlisted read-only RPC methods, `redirect: "error"`, and
`credentials: "omit"`. Tests inject a fake Fetch implementation; production
uses built-in Fetch only after an explicit start command. This source composition
does not prove that the declared commit heads were assembled: the lead must
verify their ancestry and execute the exact-head regression.

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
`--data-dir` (proposed `/var/data/meridian-paper`), no public port, no scheduled
restarts, and no reuse of existing Meridian service secrets. Verify mount
persistence, filesystem rename/fsync semantics, host clock, Northflank access,
cost, and the security incident/credential posture before assembly or launch.
The adapter cannot prove that a directory is a mounted durable volume. Do not
launch until the lead confirms those host facts and the complete run manifest.
An interrupted or uncertain run remains locked and stopped; recovery is
deliberately manual and cannot be done by restarting the worker.

The lead's authorized one-shot uses the checked-in composition and explicit
persistent mount:

```sh
node scripts/memecoin-paper/pilot-online.mjs start \
  --mode READ_ONLY_PAPER \
  --config /var/data/meridian-paper/run-config.json \
  --assembly /app/scripts/memecoin-paper/pilot-online-assembly.mjs \
  --data-dir /var/data/meridian-paper
```

Operational commands use the same persistent directory and need no provider
assembly:

```sh
node scripts/memecoin-paper/pilot-online.mjs status --data-dir /var/data/meridian-paper
node scripts/memecoin-paper/pilot-online.mjs stop --data-dir /var/data/meridian-paper
node scripts/memecoin-paper/pilot-online.mjs report --data-dir /var/data/meridian-paper
```

`stop` writes an identity-bound durable request that the worker observes; the
active process also handles SIGTERM/SIGINT. `status` reports `UNKNOWN` rather
than guessing if the lock exists without a terminal marker. `report` reads the
separately persisted projection and does not manufacture one from a controller
summary.

## Tests and next acceptance

Run the online lifecycle and synthetic contract suites in this base:

```sh
node --test test/memecoin-paper-pilot-online.test.js \
  test/memecoin-paper-pilot-integration.test.js
```

The producer-specific tests and full-duration integration test are unavailable
in this base checkout. In the exact-head integration checkout, first verify all
dependency commits are ancestors of `HEAD`, then run:

```sh
for pin in fa04cf49842f0350bd4fc21f466984612a139396 \
  b000c6a6dcfcce102e61821e8316174a15a0dd58 \
  89a20bf118e059c6153ac75b51f2ed6947d46332 \
  14075eef9ef0eebde3249718a6f6e3c51016bdee; do
  git merge-base --is-ancestor "$pin" HEAD || exit 1
done
node --test test/memecoin-paper-pilot-online.test.js \
  test/memecoin-paper-pilot-run-control.test.js \
  test/memecoin-paper-provider-evidence.test.js \
  test/memecoin-paper-operator-report.test.js
```

The regression uses 480 one-minute controller cycles plus the terminal receipt
(481 report receipts), samples the single allowlisted identity every third
cycle (160 provider acquisitions and 640 requests), and preserves complete
receipt/audit coverage within producer limits. `ZERO_TRADES` means the
observation ledger records no entry or fill; it is not simulated-trading
performance validation. Exact-head tests, independent review, host
volume/clock/security checks, and lead launch authority remain required. No
provider probe, worker provisioning, wallet/order, or Paper/Live run has been
performed by this coding task.
