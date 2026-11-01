# One-shot READ_ONLY_PAPER worker

**Implementation status: exact producer modules are integrated and the focused
offline real-module assembly test passes. Host launch remains BLOCKED pending
lead verification of the mounted volume, source-page candidate identity, and
target-host public-data evidence.** The adapter
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
loads the exact merged producer modules only when that file is selected with
`--assembly`. It supplies the provider's fixed public-fetch adapter and
freshness policy; it does not fetch code, start on import, or bypass the
producer exports. `createPinnedAssembly()` verifies the documented exports.
Its integration test uses the actual provider/controller/report/checkpoint/
filter modules with generated synthetic responses, fake time, and temporary
storage only.

| Dependency | Pin | Expected export | Status |
| --- | --- | --- | --- |
| Base | `fa04cf49842f0350bd4fc21f466984612a139396` | Checkpoint session/store; `filterCandidate`; `analyzeCandidate` | Common merge base |
| Provider #1108 | `b000c6a6dcfcce102e61821e8316174a15a0dd58` | `acquireProviderEvidence(options)` | Merged; exact source and ancestry verified |
| Controller #1110 | `89a20bf118e059c6153ac75b51f2ed6947d46332` | `createPilotRunControl(options)` with `READ_ONLY_PAPER` and acquire/step/checkpoint/report callbacks | Merged; exact source and ancestry verified |
| Report #1104 | `14075eef9ef0eebde3249718a6f6e3c51016bdee` | `projectOperatorReport(input)` and `renderOperatorReport(report)` | Merged; exact source and ancestry verified |

The source composition retains the producer commits as merge parents. The
imported files are unchanged from those heads:

- Provider commit `b000c6a6dcfcce102e61821e8316174a15a0dd58`:
  `scripts/memecoin-paper/provider-evidence.mjs`,
  `docs/strategy-lab/memecoin-paper/PROVIDER_EVIDENCE.md`,
  `test/memecoin-paper-provider-evidence.test.js`, and its four fixtures under
  `test/fixtures/memecoin-paper-provider-evidence/`.
- Controller commit `89a20bf118e059c6153ac75b51f2ed6947d46332`:
  `scripts/memecoin-paper/pilot-run-control.mjs`,
  `docs/strategy-lab/memecoin-paper/PILOT_RUN_CONTROL.md`,
  `test/memecoin-paper-pilot-run-control.test.js`, and
  `test/fixtures/memecoin-paper-pilot-run-control/fakes.mjs`.
- Report commit `14075eef9ef0eebde3249718a6f6e3c51016bdee`:
  `scripts/memecoin-paper/operator-report.mjs`,
  `docs/strategy-lab/memecoin-paper/OPERATOR_REPORT.md`,
  `test/memecoin-paper-operator-report.test.js`, and
  `test/fixtures/memecoin-paper-operator-report/scenarios.mjs`.

The focused assembly suite asserts those heads are ancestors and executes all
three producer modules. It covers a full eight-hour deadline (480
one-minute checkpoints plus the final receipt), 160 provider polls/640
requests, report bounds, mismatched source identity, uncertain checkpoint with
no write retry, operator stop, restart denial, and import-time inertness. The
result is observation-only `ZERO_TRADES`, not strategy-performance validation.
Combined hosted CI/review and host verification remain outstanding.

At the deadline, a clean controller `DEADLINE` may finalize the immutable ledger
at the configured `endAt` only after the terminal report is emitted, request
accounting is known, the checkpoint acknowledgement is bound, and every
callback is settled (a checkpoint acknowledged while settling the deadline is
allowed; late acquisition/step callbacks are not). No new provider/step work is
admitted after the controller deadline. The report sidecar and terminal marker
separately retain `effectiveEndAt`, actual `finalizedAt`, and `latenessMs`;
the report never claims physical finalization happened at the window boundary.
Clock regression, early wall-clock time, unsettled work, or more than 60 seconds
of deadline finalization delay remains `UNKNOWN`. Manual stops continue to use
their actual validated time. The integration test covers 250 ms and 30 s
settlement delays plus rejection beyond the fixed delay bound.

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

`scripts/memecoin-paper/create-run-config.mjs` generates the run config offline.
It requires an absolute output path, explicit run ID and start time, and actual
mint/pool/quote inputs; it has no baked-in candidate or run window. It writes
the canonical config exclusively with mode `0600`, placing `run-config.json`
inside the state directory. The runner permits that one pre-existing config
file and rejects any mismatch or other pre-existing run state.

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
cycles. The one-candidate plan polls every third cycle: at most 160 acquisitions
and 640 provider requests, with 480 controller cycles and 481 checkpoint
receipts including `finishRun`. The code rejects extra fields and noncanonical
JSON; no API key or credential is part of this contract.

Comment `6561517774` supplies this source-page-corroborated example identity:
mint `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`, pool
`5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9`, quote
`So11111111111111111111111111111111111111112`. The pool case is significant.
This provenance is not embedded in the strict run-config schema and proves
neither fresh RPC identity/decimals nor slots, authorities, hard-gate passage,
executable quotes, or costs. Use it only as an explicit observation example;
provider output still determines runtime evidence and can only yield no-entry.

Northflank is the current owner-selected target, superseding the earlier Render
choice. Build the dedicated image from `Dockerfile.paper`; its default
entrypoint is the Paper runner (no gateway, port, package install, runtime Git,
or code download) and no arguments return `DISABLED`. The lead must configure a
separate one-instance worker in the existing project with a dedicated
persistent volume mounted at `/var/data/meridian-paper`, no public port, no
scheduled restarts, and no reuse of existing Meridian service secrets. Ensure
the mounted volume is writable by the image's `node` user. Verify mount
persistence, filesystem rename/fsync semantics, host clock, Northflank access,
cost, and the security incident/credential posture before launch. The adapter
cannot prove mount durability or host clock validity. Do not launch until the
lead confirms those host facts and the exact run config.
An interrupted or uncertain run remains locked and stopped; recovery is
deliberately manual and cannot be done by restarting the worker.

Build and generate the config offline on the lead's verified mounted volume;
these commands are examples and were not executed here:

```sh
docker build -f Dockerfile.paper -t meridian-paper:pilot .
STATE_DIR=/var/data/meridian-paper
IMAGE=meridian-paper:pilot
RUN_ID=pilot-memecoin-$(date -u +%Y%m%dT%H%M%SZ)
START_AT_MS=$(date -u +%s%3N)
MINT=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263
POOL=5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9
QUOTE=So11111111111111111111111111111111111111112
docker run --rm --mount type=bind,src="$STATE_DIR",dst=/var/data/meridian-paper \
  --entrypoint node "$IMAGE" scripts/memecoin-paper/create-run-config.mjs \
  --output /var/data/meridian-paper/run-config.json \
  --run-id "$RUN_ID" --start-at "$START_AT_MS" \
  --mint "$MINT" --pool "$POOL" --quote "$QUOTE"
```

For the Northflank worker command override (with its volume already mounted):

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

Equivalent one-shot Docker operations use the same pre-mounted state:

```sh
docker run --rm --name meridian-paper-once \
  --mount type=bind,src="$STATE_DIR",dst=/var/data/meridian-paper "$IMAGE" \
  start --mode READ_ONLY_PAPER \
  --config /var/data/meridian-paper/run-config.json \
  --assembly /app/scripts/memecoin-paper/pilot-online-assembly.mjs \
  --data-dir /var/data/meridian-paper
docker run --rm --mount type=bind,src="$STATE_DIR",dst=/var/data/meridian-paper "$IMAGE" \
  status --data-dir /var/data/meridian-paper
docker run --rm --mount type=bind,src="$STATE_DIR",dst=/var/data/meridian-paper "$IMAGE" \
  stop --data-dir /var/data/meridian-paper
docker run --rm --mount type=bind,src="$STATE_DIR",dst=/var/data/meridian-paper "$IMAGE" \
  report --data-dir /var/data/meridian-paper
```

`stop` writes an identity-bound durable request that the worker observes; the
active process also handles SIGTERM/SIGINT. `status` reports `UNKNOWN` rather
than guessing if the lock exists without a terminal marker. `report` reads the
separately persisted projection and does not manufacture one from a controller
summary.

## Tests and next acceptance

Run focused tests only:

```sh
node --test test/memecoin-paper-pilot-online.test.js \
  test/memecoin-paper-pilot-assembly.test.js \
  test/memecoin-paper-pilot-integration.test.js \
  test/memecoin-paper-provider-evidence.test.js \
  test/memecoin-paper-pilot-run-control.test.js \
  test/memecoin-paper-operator-report.test.js
```

The online/assembly tests use fake public transport/time and temporary storage.
No provider probe, worker provisioning, wallet/order, or Paper/Live run has been
performed by this coding task. Individual source reviews were reported green by
the owners; combined hosted CI/review and lead-authorized host launch remain
required.
