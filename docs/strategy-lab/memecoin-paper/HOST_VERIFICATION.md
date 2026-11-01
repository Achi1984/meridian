# Paper host verification procedure

**Disposition: owner run request recorded; technical activation remains blocked.**
The owner has explicitly requested the existing #996 eight-hour virtual-capital
Paper test online. That request is not evidence that a specific host, volume,
source integration, provider path, stop control, or exact run configuration is
ready. This packet does not start a run. The manifest remains disabled, the
stop switch remains engaged, and no runtime authorization is produced here.

## Repository-backed host, storage, and stop inventory

The checked-in configuration does not identify a suitable compute host:

| Interface | What the repository actually configures | What remains unknown or unavailable |
|---|---|---|
| Compute host | `scripts/memecoin-paper/run-manifest.json` names the public provider endpoints only. No Paper-specific machine, region, account, runner label, volume, or deployment target is present. `Dockerfile` describes the general Node gateway image; `vercel.json` configures an unrelated asset-watch function. Neither designates a Paper host. | Actual host identity, ownership, runtime deployment, filesystem/mount, capacity, and host-side operational access. Do not treat the coding-agent checkout or a generic CI runner as the selected host. |
| Storage | `CheckpointStore.open(absoluteDirectory)` uses a local directory, lifetime lock, file sync, same-directory rename, directory sync, and bounded readback. The harness uses an owned temporary directory under Node's `os.tmpdir()`. | No configured production checkpoint path, volume identity, filesystem failure-domain, external sync guarantee, or recovery proof for any host. Local API behavior is not evidence about a deployment volume. |
| Stop/deadline | The manifest is `enabled: false` with `stopSwitch.engaged: true`. `PaperCheckpointSession` enforces its fixed deadline when a command is invoked; `finishRun` is an explicit journal command. | No active stop-switch reader, host watchdog, scheduler, signal-to-session adapter, or operator stop command exists for this pilot. A fixed deadline does not stop an idle process. |
| Provider/source | The manifest lists DexScreener and Solana JSON-RPC endpoint names with both providers disabled. `adapters.mjs` sets `NETWORK_ENABLED = false`; its request method throws. | No online downloader, validated completeness for required evidence, real-data run controller, or source integration into the Paper orchestration path. `runSyntheticPaperOrchestration` accepts only the exact disabled manifest and generated scenarios. |

These are source/configuration findings, not host probes. The running harness
cannot discover or attest a host hidden outside the repository.

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

## Remaining gates for the requested online test

1. Select and independently identify the compute host and actual checkpoint
   volume; verify ownership, mount/failure domain, capacity, and storage
   durability using that host/volume's supported operational evidence.
2. Integrate and review the exact source that is intended to run there. This
   branch's source hashes do not establish that it is deployed or integrated.
3. Implement and review the real bounded data collection and run controller.
   Current providers are disabled, the adapter is offline-only, and the
   synthetic orchestration rejects enabled providers and non-fixture inputs.
   The manifest also has empty mint/pool allowlists and unset run identity and
   timestamps.
4. Provide a host-enforced stop/timeout path and operator-visible incident
   procedure. The command-invoked session deadline is not a watchdog; there is
   no active stop-switch interface.
5. Establish trusted host clock provenance/skew policy and independently
   review the exact run manifest, accounting/restart behavior, provider evidence
   coverage, stop behavior, and final source/CI results before activation.

The executable commands above are the minimal supported later **synthetic host
verification**, not commands to start the eight-hour Paper test. No host target,
volume, trusted clock, real-data provider implementation, active stop control,
or online launch command is identified by the repository. The owner request is
recorded; those technical blockers still prevent this packet from claiming the
online test is startable.
