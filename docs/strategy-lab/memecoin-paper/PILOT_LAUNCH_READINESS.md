# Solana Paper pilot launch readiness

**Disposition: preparation only; an eight-hour real-data Paper run is not
startable or authorized.** This packet does not enable the manifest, activate
the adapter, run a provider, or grant permission to execute. The approved
experiment remains the existing #996 Solana experiment, not a new strategy and
not the separate D2 `NO_EDGE` result.

## Offline readiness projection

`scripts/memecoin-paper/pilot-readiness.mjs` exports
`projectPilotReadiness(packet)` and provides a bounded local-JSON CLI. It reads no
feed, imports no stage pipeline/replay/orchestration, and never instantiates the
ledger (it reads only its exported immutable policy). Hashes bind the supplied
configuration and candidate identities;
they are not signatures or provenance authentication. Evidence fields are
caller-supplied assertions, not independently verified facts. The projection
always reports `executionStarted: false` and `RUN_AUTHORIZED.authorized: false`.
Even a complete synthetic packet cannot authorize a real run.

Run the preflight against the checked-in incomplete example:

```sh
node scripts/memecoin-paper/pilot-readiness.mjs test/fixtures/memecoin-paper-pilot-readiness/incomplete.json
```

The exit code is zero for a structurally valid packet, even when blocked; it is
2 for malformed, oversized, or unreadable input. `UNSET`, `UNKNOWN`, stale,
invalid, and mismatched evidence remain distinct. The packet binds operational
evidence to code commit, canonical manifest SHA-256, canonical candidate
identity SHA-256, and run ID. It rejects mixed identities and synthetic
operational evidence. The 256 KiB packet and structural limits protect this
offline parser; they are not provider request budgets.

The projection reports the existing #996 risk choices from
`scripts/memecoin-paper/ledger.mjs` unchanged: USD 1,000 virtual capital, at
most USD 80 and 8% of marked equity per entry, three positions, 6% initial stop,
6% trailing stop activated at +12%, USD 30 daily loss gate, Europe/Vienna, and
an eight-hour window. Provider identities and poll/request/event/byte limits
are copied from the supplied manifest; no cost, slippage, provider capacity,
or performance assumptions are invented.

| Dimension | Meaning in this projection | Current result |
| --- | --- | --- |
| `SOURCE_READY` | Source, configuration, and fixed candidate identities are pinned, and a real-data adapter exists. | **BLOCKED** — commit/config/candidate pins and allowlists are unset; the existing request adapter is disabled and always fails closed. |
| `OPERATIONALLY_VERIFIED` | Required bound evidence is present and current. The offline tool cannot authenticate its claims. | **BLOCKED / NOT VERIFIED** — run identity/window and operational evidence are absent; restart is unrecoverable; request timeout and watchdog are not implemented. |
| `RUN_AUTHORIZED` | Separate, exact owner authority for one run. | **NOT AUTHORIZED**, unconditionally. |

### Hard run prerequisites and candidate data gates

Hard prerequisites prevent starting the pilot: a pinned source/config/candidate
bundle; fixed provider, mint, pool, and run identities; the exact eight-hour
window; a bounded real-data adapter with request/time/byte/event limits; an
authenticated clock policy; reviewed accounting and restart/`UNKNOWN` handling;
host-specific storage/durability evidence; explicit cost semantics; an
implemented operator stop and report procedure; independent source/security/
accounting review; and separate owner authority for the exact run.

The per-candidate evidence gates are not minimum trade quotas. Existing
`filterCandidate` hard gates remain authoritative. Missing concentration,
developer/rug-history, bundle, or smart-wallet evidence blocks that candidate;
it must remain `UNKNOWN`, not be weakened or substituted. A later bounded
observation may therefore have zero entries and still be a valid observation
report. Zero entries do not demonstrate profitability or a strategy failure.
`candidateDataGates` in the projection only summarizes supplied filter
dispositions; `PASS` is not an entry authorization.

## Existing implementation and exact call chain

- `scripts/memecoin-paper/stages.mjs` exports `scout`,
  `filterCandidate`/`processCandidate`, and `analyzeCandidate`. It enforces
  identity-bound freshness and strict candidate evidence gates.
- `scripts/memecoin-paper/adapters.mjs` contains offline parsers and the
  read-only RPC method allowlist. `NETWORK_ENABLED` is `false`;
  `createReadOnlyAdapterInterface().request()` throws. No downloader exists.
- `scripts/memecoin-paper/ledger.mjs` contains `PaperLedger`, fixed-point
  accounting and the approved risk policy. `restartDisposition()` is
  `UNRECOVERABLE_FAIL_CLOSED`.
- `scripts/memecoin-paper/replay.mjs` implements
  `runSyntheticReplay({now})`, a fixture-only comparison, not market evidence.
- `scripts/memecoin-paper/run-manifest.json` is disabled, keeps the stop switch
  engaged, has unset run ID/start/end and empty mint/pool allowlists. It names
  two disabled public providers and declares poll/request/response/run/event/
  candidate bounds.
- `scripts/memecoin-paper/checkpoint-session.mjs` exports
  `PaperCheckpointSession.open({store, runId, startedAt})`; acknowledged
  `authorizeEntry`, `executeEntry`, `observeExitQuote`, `riskSnapshot`, and
  `finishRun` commands replay through the actual ledger.
- `scripts/memecoin-paper/checkpoint-store.mjs` exports
  `CheckpointStore.open(directory)` and `canonicalCheckpointBytes`. The store
  uses a local exclusive lock, file/directory fsync and atomic publication;
  ambiguous publication stops as `UNKNOWN`. Tests use temporary filesystems
  and process crashes; they do not prove power-loss, shared-filesystem,
  hosted-host, or eight-hour unattended durability.
- `scripts/memecoin-paper/orchestration.mjs` exports
  `runSyntheticPaperOrchestration({store, manifest, runId, startedAt, scenario})`.
  It accepts only the exact disabled manifest and named generated scenarios,
  then verifies acknowledged checkpoint results against the synthetic replay.
  It has no provider input or real-data launch mode.

The inspected live `main` base is
`c60bb6a2516ab88000ece3c339bcc740280a9ba7`. The existing checkpoint/replay
tests demonstrate only their documented local and synthetic guarantees; they
are not operations evidence.

| State | Packet | Readiness consequence |
| --- | --- | --- |
| Present on current `main` base | #996 stages, offline parsers, fixed-point ledger, disabled manifest and synthetic replay; #1057-style local checkpoint/orchestration interfaces listed above. | Useful isolated source and replay plumbing; no live data adapter or start authority. |
| Unmerged | #1096 assembly `61044c0709fd071a734d3aa60db2c01e54f0b54f`, based on `c60bb6a2516ab88000ece3c339bcc740280a9ba7`. It adds the anchored-clock API `pinClockPolicy(value, startedAt)`, `normalizeClockSample(value)`, and `admitClock(policy, previousMonotonicMs, sample, requestedNow)` in `scripts/memecoin-paper/clock-policy.mjs`. | The assembly is not this branch's base or an accepted integration. Its API does not authenticate a UTC source; do not import its branch-only module into main tests. Retain the current merge hold. |
| Missing | Real bounded provider/evidence adapters; complete sources for pool LP, owner aggregation, authority/extensions, developer history, bundles and smart-wallet provenance; executable quote/depth and validated costs; trusted clock and host-specific storage/restart evidence; operator stop/report commands; exact run config and independent review. | These are concrete blockers to an eight-hour pilot, not owner-selected risk parameters. |

Current code checks nondecreasing caller time, not an authenticated clock. The
checkpoint deadline is enforced when a command is invoked; there is no timer,
watchdog, or scheduler. No successful source test can establish that a host
will remain available or preserve durable state for eight hours.

## Distinct work and publication boundaries

- D2 issue #935's recorded `NO_EDGE` is a separate trial. It is not evidence
  for or against this Solana experiment and must not be rerun or retuned here.
- Issues #982/#985 concern a separate Forward-Paper contract and synthetic
  infrastructure boundary. Their evidence/authority restrictions do not supply
  this pilot's provider, accounting, or run authorization.
- The #1096 Pages failure is a publication/UI dependency and its current merge
  hold remains. Pages is not inherently required for offline or headless
  simulation or computation; resolving Pages alone would not satisfy any of the
  data, clock, durability, stop, cost, review, or run-authority prerequisites.

## Commands and next dependency order

Supported preparation commands:

```sh
node scripts/memecoin-paper/pilot-readiness.mjs test/fixtures/memecoin-paper-pilot-readiness/incomplete.json
node --test test/memecoin-paper-pilot-readiness.test.js
node --test test/memecoin-paper-orchestration.test.js test/memecoin-paper-checkpoint.test.js test/memecoin-paper.test.js
node scripts/memecoin-paper/replay.mjs
```

The last command prints synthetic fixtures only. There is no supported real
launch, operator stop, watchdog, or real-run reporting command:
**NOT_IMPLEMENTED**. The preflight JSON is not an operator run report.

Smallest next implementation packet to dispatch after choosing an evidence
source: own only
`scripts/memecoin-paper/provider-evidence.mjs`,
`test/memecoin-paper-provider-evidence.test.js`,
`test/fixtures/memecoin-paper-provider-evidence/`, and
`docs/strategy-lab/memecoin-paper/PROVIDER_EVIDENCE.md`. It should be a disabled,
read-only, bounded adapter/parser boundary with injected response fixtures and
explicit `UNKNOWN` for unsupported evidence; no feed probes or calls in tests.
It must first document which chosen sources can actually supply each hard gate.
That packet alone would not prove capacity, costs, durability, or authorize a
run.

After technical evidence and independent review exist, the only owner decision
to request is the exact candidate mint/pool allowlist, fixed run ID and UTC
start/end, and whether to authorize that exact one-shot manifest. Do not ask the
owner to select the already approved capital or risk limits again. No such
decision is requested by this preparation packet.
