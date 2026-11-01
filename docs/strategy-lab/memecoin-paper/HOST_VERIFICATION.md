# Paper host verification procedure

**Disposition: owner authorization to progress is recorded; technical launch
blockers remain.** In #996 comment
[6560721313](https://github.com/Achi1984/meridian/issues/996#issuecomment-6560721313),
the owner said to continue and bring this existing eight-hour, USD 1,000 virtual
capital Paper test online. This authorizes progress toward that one-shot
simulated run, not real-money/live-exchange execution, unlimited spending, or
bypassing technical gates. No additional generic owner signoff is requested by
this procedure. This packet does not start a run; the harness continues to
report `runtimeAuthorization: false`, and the manifest remains disabled with
its stop switch engaged.

## Repository-backed host, storage, and stop inventory

The repository identifies an existing application-host candidate, but not a
verified Paper execution target:

| Interface | What the repository actually configures | What remains unknown or unavailable |
|---|---|---|
| Compute host | [`MERIDIAN_CONTEXT.md`](../../../MERIDIAN_CONTEXT.md#L78-L85) says Northflank deploys canonical `main`; [`runtime-smoke.yml`](../../../.github/workflows/runtime-smoke.yml#L36-L44) and [`runtime-smoke.mjs`](../../../scripts/runtime-smoke.mjs#L8-L9) identify and check the public Northflank gateway. This makes that deployed gateway a concrete candidate to ask the operator about. | These references establish the app gateway, not that it runs this branch or supports an isolated Paper process. No Paper service identity, Northflank exec/job command, host shell access, or operator credentials/access path is defined here. No host probe was made. |
| Storage | `CheckpointStore.open(absoluteDirectory)` uses a local directory, lifetime lock, file sync, same-directory rename, directory sync, and bounded exact readback. Its process-interruption behavior is exercised on owned temporary directories by this harness. | No Paper checkpoint path, Northflank volume/mount identity, or provider-specific persistence/sync guarantee is configured. Local API and process-exit observations describe tested behavior only; they do not establish which volume the gateway uses. Assess the documented storage failure/restart boundary for a selected host; do not require a guarantee against every possible eight-hour outage. |
| Stop/deadline | The manifest is `enabled: false` with `stopSwitch.engaged: true`. `PaperCheckpointSession` enforces its fixed deadline when a command is invoked; `finishRun` is an explicit journal command. | No active stop-switch reader, host watchdog, scheduler, signal-to-session adapter, or operator stop command exists for this pilot. A fixed deadline does not stop an idle process. Required access is an operator-supported way to start and stop a one-shot process on the selected host; no such Paper command is checked in. |
| Provider/source | The manifest lists DexScreener and Solana JSON-RPC endpoint names with both providers disabled. `adapters.mjs` sets `NETWORK_ENABLED = false`; its request method throws. | No online downloader, validated completeness for required evidence, real-data run controller, or source integration into the Paper orchestration path. `runSyntheticPaperOrchestration` accepts only the exact disabled manifest and generated scenarios. |

These are source/configuration findings, not host probes. The running harness
cannot discover or attest host settings hidden outside the repository. The
separate D2 execution-context assessment makes the same distinction between
Northflank app hosting and a persistent execution target
([`D2_EXECUTION_CONTEXT_SETUP.md`](../D2_EXECUTION_CONTEXT_SETUP.md#L12-L15)).

## Offline harness

The harness exercises the existing `CheckpointStore` and
`PaperCheckpointSession` interfaces with a generated fixture. It does not add a
storage engine, readiness projection, provider access, strategy replay, or PnL
calculation. Importing the module is inert; execution requires this explicit
opt-in:

```sh
SYNTHETIC_TEST_ONLY=SYNTHETIC_TEST_ONLY node scripts/memecoin-paper/host-verification.mjs
node --test test/memecoin-paper-host-verification.test.js
```

The machine-readable result binds hashes of the observed source, config, and run
fixture bytes and keeps generated-fixture checks under `syntheticEvidence`.
`hostEvidence` is a separate, empty `NOT_PROVIDED` section. Every result says
`SYNTHETIC_ONLY`, `runtimeAuthorization: false`,
`hostDurability: NOT_VERIFIED`, and clock provenance `UNVERIFIED`. Hashes and
booleans are not authentication. The fixed fixture clock is test input, not a
trusted host clock. For unresolved synthetic publications, the result records
the pending marker and visible checkpoint identities before cleaning only the
verified, owned temporary fixture directory; that cleanup is not a successful
reconciliation. If a synthetic check fails, its owned fixture directory is
preserved and reported for inspection rather than cleaned up.

Child-process termination checks observe the temporary filesystem after a child
exits and exercise the existing pending-publication behavior. They prove neither
power-loss recovery nor hardware, filesystem, volume, `fsync`, cross-host, or
hosted-runner durability. They also do not demonstrate autonomous operation for
eight hours. An ambiguous publication remains `UNKNOWN`; visible candidate bytes
do not establish durable acknowledgment, and uncertain records are not retried
or cleaned up as successful.

## Executable candidate-host verification

An owner/operator may run this existing offline harness from the exact reviewed
checkout on a separately designated candidate host. It creates generated
checkpoint fixtures only in unique directories below that host's
`os.tmpdir()`. Run from the repository root:

```sh
node --test test/memecoin-paper-host-verification.test.js
SYNTHETIC_TEST_ONLY=SYNTHETIC_TEST_ONLY node scripts/memecoin-paper/host-verification.mjs
```

Capture the second command's JSON output together with the externally supplied
host identity, checkout commit, operator, date, and storage/volume identity in
the owner's approved evidence system. Do not add host names, credentials, or
private configuration to this repository. Require `status: PASS`,
`scope: SYNTHETIC_ONLY`, `runtimeAuthorization: false`,
`hostDurability: NOT_VERIFIED`, and `hostClockProvenance: UNVERIFIED`.
Any failed check, timeout, un-reaped child, unresolved `UNKNOWN`, or output
identity mismatch is a stop; preserve its reported fixture directory and
evidence. A pass establishes only that these synthetic checks ran on that
process/filesystem. It does not certify the selected production volume,
power-loss recovery, host suitability, trusted time, or online operation.

## Concrete handoff for the requested online test

The minimum next operator input is **whether the existing Northflank gateway
supports a reviewed one-off command/job for this Paper code, and which mounted
path it would use**. The repository has no Northflank service identifier or
operator command for that access; do not infer one from the gateway health URL.
If it supports that operation, collect its non-secret service/deployment
identity, exact deployed commit, writable test path, and the provider's
documented persistence and restart behavior. If not, the owner/operator must
identify an already available suitable execution context; this packet does not
select or provision another host.

Then perform these bounded gates:

1. **Source/config integration:** verify that the exact reviewed Paper source is
   integrated/deployed. The current manifest has disabled providers, empty
   mint/pool allowlists, and null run identity/start/end. `adapters.mjs` is
   offline-only, and the synthetic orchestration rejects real inputs. The
   missing implementation is an enabled-by-explicit-configuration, bounded
   public-data collection path and one-shot run controller—not a new Paper
   ledger or another readiness validator.
2. **Storage behavior:** identify the selected checkpoint directory and its
   volume boundary. Compare the provider's documented write/flush and restart
   behavior to the store's file-sync/rename/directory-sync/readback contract.
   Record what that documentation guarantees and what it leaves unspecified.
   Process-kill/readback results are supporting observations, not proof of
   machine power-loss behavior. If a process stops with unresolved state, retain
   `UNKNOWN`, do not resume or replay automatically, and report the run
   incomplete. No claim that a host must survive every possible outage is
   required.
3. **Stop and clock behavior:** identify the concrete operator stop/access path
   and how it stops the one-shot process; the checked-in stop switch is not
   wired to it. Confirm the trusted clock source/skew policy used for run
   timestamps. A command-invoked deadline alone is insufficient to stop an idle
   collector.
4. **Exact bounded run config:** populate the approved one-shot run identity,
   start/end, and permitted mint/pool scope using the existing owner direction
   and risk policy; keep provider/request/time/byte/event limits bounded.
   Preserve unknown evidence as blocked entries; do not weaken gates to obtain
   trades.
5. **Evidence and completion:** run the synthetic candidate-host commands above
   first, then collect actual source/provider, storage, clock, stop, and run
   outputs under the operator's approved evidence process. A synthetic pass
   never substitutes for those observations. Stop and report incomplete on
   `UNKNOWN`, missing evidence, exceeded bounds, or unavailable stop control.

The commands documented above verify only synthetic host behavior; they are
not the missing online start/stop commands. The Northflank gateway is the only
documented current app-host candidate, while its Paper execution access and
volume configuration are `UNKNOWN`. Exact source integration, enabled bounded
provider/controller, populated run config, storage-boundary behavior, trusted
clock, and host operator stop access remain the concrete launch blockers. The
owner's authorization to progress is recorded; this procedure does not
autonomously activate the service.
