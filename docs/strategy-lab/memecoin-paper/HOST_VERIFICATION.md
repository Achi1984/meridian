# Paper host verification procedure

## Current operator-reported state (2026-11-02)

The owner authorized progress toward the existing eight-hour, USD 1,000
virtual-capital Paper observation in #996 comment
[6560721313](https://github.com/Achi1984/meridian/issues/996#issuecomment-6560721313).
That authority does not turn a host check into a Paper run or establish host
readiness. The following #1105 receipts supersede the historical state below;
they are operator observations, not checks performed by this harness:

| Receipt | Current-state evidence and limits |
|---|---|
| [6579209509](https://github.com/Achi1984/meridian/issues/1105#issuecomment-6579209509) | Old run `observation-20261101-r1` reached `FINISHED` / `DEADLINE` at **2026-11-02T03:02:24.274Z**, report `PROJECTED`, 159 candidates / 636 requests, zero authorizations/fills. Terminal logs are not independent artifact retrieval; the old producer's nested `UNKNOWN` versus top-level null failure remains a historical discrepancy. |
| [6580105084](https://github.com/Achi1984/meridian/issues/1105#issuecomment-6580105084) | Observer deployed build `luminous-taste-567`, commit **`661cf1cb82cfdd716f4f0283a54dc13de2907d70`**, Running 1/1. At **14:47:25Z**, `PAPER_INERT_SMOKE_OK`, UID 1000, acquisition/execution false, blocked transport calls 0. CI/CD off; existing volume unchanged. This supersedes `14b9412` as deployed image and the claim that the utility is absent. The receipt also corrects the earlier claim that saving CMD had not restarted the old image. |
| [6580333435](https://github.com/Achi1984/meridian/issues/1105#issuecomment-6580333435) | At **14:57:12Z**, the deployed utility returned `BLOCKED`: physical mount UID 0 / GID 1000 versus process UID/GID 1000, **before evidence writes**, `providerRequests: 0`. Config holds after this one-shot, with no timed retry. No new eight-hour run started. Mount identity `UNVERIFIED`, durability `NOT_VERIFIED`. This blocked old ownership check is not acceptance of the revised private-child layout. |

The existing 6 GB `meridian-paper-data` volume is mounted at
`/var/data/meridian-paper`. Preserve its old runs, locks, evidence, and logs.
`achi-meridian` and `meridian-db` must remain untouched. No new paid resources,
permission weakening, privileged provisioning, or live-host action is authorized
by this source-only package.

The operator reports Northflank Shell is unavailable for the team. No shell,
SSH, new credentials, or service exec is required by the procedure below.
Northflank documents runtime command and entrypoint overrides at
[Override command or entrypoint](https://northflank.com/docs/v1/application/run/override-command-entrypoint).
The current command holds after the blocked preflight, not an active observation.
The Paper image contract in [`Dockerfile.paper`](../../../Dockerfile.paper)
uses `ENTRYPOINT ["node", "scripts/memecoin-paper/pilot-online.mjs"]` and
`USER node`. Consequently, a CMD/command override alone appends arguments to
that existing pilot entrypoint. To run the separate acceptance utility, choose
Northflank's **custom entrypoint plus custom command** mode, setting the
entrypoint to `node` and the command to the utility invocation below.

The deployed image contains the earlier utility, but not this reviewed
private-child remediation. A future rollout must bind the accepted remediation
commit and immutable image digest; deployment alone is not host acceptance.
No build, deployment, service setting, or host command was changed by this task.

## Historical host evidence and run boundary (2026-11-01)

The following are **operator-reported observations** in PR #1114, not checks run
by this agent. This table records the state at that handoff, **not current
deployment or active-run status**; use the November 2 receipts above for those.
Hashes and logs are identifiers, not independent authentication.

| Observation | Reported result | What it establishes / does not establish |
|---|---|---|
| Volume probe (`host-probe-20261101-r1`; comment [6562423375](https://github.com/Achi1984/meridian/pull/1114#issuecomment-6562423375)) | On deployed `main` image `14b9412564c300cc44a1f514c4dfebd55495b4aa`, runtime UID/GID 1000; `/proc/self/mountinfo` matched the expected mount. Exclusive create, file `fsync`, same-directory rename, directory `fsync`, byte/hash readback passed at 18:55:54Z. | Supports that the process and selected mounted path completed those operations at that time. The first newline-normalized attempt reported `MOUNT_NOT_PROVEN` and made no writes; only the corrected command passed. This is not power-loss or provider durability proof. |
| Container restart readback (comment [6562423375](https://github.com/Achi1984/meridian/pull/1114#issuecomment-6562423375)) | `PERSISTED_READBACK` passed at 18:56:31Z with the same SHA-256, `c5642cebfef93d86451aaddbd2ff13c7b7dea37bcbbc4ddc8e992420e0807948`. | Confirms the reported artifact was read after a container restart. It does not show survival of host, volume, or power loss. |
| Separate short acceptance run (comments [6562454779](https://github.com/Achi1984/meridian/issues/942#issuecomment-6562454779) and [6562477627](https://github.com/Achi1984/meridian/issues/942#issuecomment-6562477627)) | Lead reports `STOP_REQUESTED`; terminal `FINISHED` / `OPERATOR_STOP`, no terminal failure, report `PROJECTED`, four provider requests (one Dex, three RPC), 3,740 bytes, one candidate, zero entries/fills. Acceptance persisted across restart at 19:00:56Z with `ACCEPTANCE_RESTART_BLOCKED`; report readable from the durable volume via platform logs. | Supports the short stop/report/restart-denial path as reported. Filter `UNKNOWN` and executable quote `UNAVAILABLE` remain; this is not trade/quote readiness and does not prove a separate downloaded artifact copy. |
| Historical eight-hour observation (comments [6562477627](https://github.com/Achi1984/meridian/issues/942#issuecomment-6562477627) and [6562485487](https://github.com/Achi1984/meridian/pull/1114#issuecomment-6562485487)) | Run `observation-20261101-r1` started at 19:02:21Z, window `2026-11-01T19:02:21.383Z`–`2026-11-02T03:02:21.383Z`, with a fresh run/config path and permanent restart guard. The initial handoff had only heartbeat/checkpoint evidence and a pending final report. | Superseded by November 2 terminal `FINISHED` / `DEADLINE` receipt above; this run is no longer reported active. Preserve its paths and guard; never replay it. Filter `UNKNOWN` and unavailable executable quote evidence do not establish trade readiness. |

Clock provenance remains `UNVERIFIED`: timestamps in the operator report do
not identify an independently trusted host clock or establish its skew. The
actual artifact files have not been independently retrieved by this agent.
The Lead reports the acceptance report is readable from the volume via platform
logs, but that does not verify a downloadable volume copy or a file-transfer
route for this team/service. Platform logs and same-volume restart readback do
not prove host/volume power-loss persistence. No provider-capacity guarantee,
quote/trade readiness, or independent cross-artifact acceptance is claimed here.

## Offline checkpoint harness

[`host-verification.mjs`](../../../scripts/memecoin-paper/host-verification.mjs)
remains an offline-only test of the existing checkpoint store/session with
generated fixtures. Import is inert; the harness requires explicit
`SYNTHETIC_TEST_ONLY=SYNTHETIC_TEST_ONLY`. It reports
`SYNTHETIC_ONLY`, `runtimeAuthorization: false`,
`hostDurability: NOT_VERIFIED`, and clock provenance `UNVERIFIED`. The process
interruption cases test process/readback behavior only—not power-loss,
hardware, filesystem, volume, cross-host, or hosted-runner durability. UNKNOWN
evidence is preserved and never replayed automatically.

Run focused, network-free checks from the repository root:

```sh
node --test test/memecoin-paper-host-verification.test.js \
  test/memecoin-paper-host-acceptance.test.js
SYNTHETIC_TEST_ONLY=SYNTHETIC_TEST_ONLY node scripts/memecoin-paper/host-verification.mjs
```

The second command is synthetic and must not be presented as host evidence.

## Explicit candidate-host acceptance utility

[`host-acceptance.mjs`](../../../scripts/memecoin-paper/host-acceptance.mjs)
has no import-time effects and refuses to run without the `verify` command,
`--provider-preflight`, a safe unique evidence ID, and explicit Solana
mint/pool/quote identities. It never imports or starts `pilot-online.mjs`.
Use only the exact candidate identity approved for the later run; the current
integrated operator contract documents the source-page example below. The
preflight creates a temporary in-memory `READ_ONLY_PAPER` manifest for this
single check. It is not the eventual eight-hour run config and does not change
the disabled/stop-gated run manifest.

For the dedicated observer image **after it includes the reviewed utility**,
set Northflank CMD override to custom entrypoint + custom command:

```text
Custom entrypoint: node
Custom command: scripts/memecoin-paper/host-acceptance.mjs verify --evidence-id host-preflight-<UNIQUE_ID> --mint DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 --pool 5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9 --quote So11111111111111111111111111111111111111112 --data-root /var/data/meridian-paper/application-data --provider-preflight
```

Use an evidence ID made only of letters, digits, `.`, `_`, and `-`, without
`..`; never reuse it for a different candidate. The explicit preflight performs
at most four public requests (one fixed DexScreener GET and three fixed
Solana JSON-RPC reads), no credentials, no arbitrary URLs, no redirects, and no
retries. Per-response bytes are capped at 256 KiB (1 MiB total); requests have
5-second limits and a 6-second abort. It logs only event summaries, not raw
provider responses. It is a live public-data preflight if an operator runs it;
this task did not make those calls.

On its first invocation the utility:

1. Treats `/var/data/meridian-paper` as the physical mount root. It must be an
   absolute, normalized, real non-symlink directory; its owner may be the
   platform UID 0 or the runtime UID. If group/world writable it must be sticky,
   preventing other UIDs from renaming/replacing the runtime-owned child.
   An untrusted owner or writable non-sticky parent blocks before evidence
   creation. Mount identity remains `UNVERIFIED`.
2. Uses `/var/data/meridian-paper/application-data` as the private application
   data root by default. `--data-root` may select another single safe direct
   child only; it cannot escape the physical mount root. The private root,
   `host-acceptance`, and each evidence directory must be real non-symlink
   directories, owned by the actual runtime UID, not group/world writable, and
   on the same device as the physical mount root. Group ownership never
   substitutes for runtime-UID ownership. If the private root cannot be created
   safely, the utility blocks before provider calls; no ownership repair is
   attempted.
3. Writes a generated marker under
   `/var/data/meridian-paper/application-data/host-acceptance/<UNIQUE_ID>/`,
   calls file `fsync`, renames within that directory, syncs the directory, and
   verifies byte-for-byte readback.
4. Reports wall-clock samples against monotonic elapsed time. Clock provenance
   always remains `UNVERIFIED`; neither `Date.now()` nor this brief comparison
   establishes trusted clock authority.
5. Calls the integrated fixed-endpoint provider assembly only after the private
   write/readback succeeds. It stores a bounded, hashed `result.json` and emits
   one JSON result to platform logs. A pass means only these specific checks
   passed; `hostDurability` remains `NOT_VERIFIED`,
   `runtimeAuthorization` remains false, and `pilotStarted` remains false.

Evidence in the prior layout directly under
`/var/data/meridian-paper/host-acceptance` is never migrated, deleted, or
reused. If that legacy location exists, the utility fails closed before making
new evidence or provider requests. Inspect and preserve such data separately;
do not `chown` existing run artifacts.

The durable files are `probe.json` and `result.json`. Do not delete, overwrite,
or reuse the evidence directory. If the service restarts with the same CMD and
evidence ID, the utility verifies the existing file/hash identities and emits
`RESTART_VERIFIED` with `providerRequestsThisInvocation: 0`; it never repeats
the provider calls. If the first invocation was interrupted or either file is
missing/corrupt, it reports `UNKNOWN` and preserves the incomplete evidence
without repair or replay. Provider failure is retained as `BLOCKED`; a
subsequent start does not retry it.

### Reviewed remediation packaging (not deployment authority)

The revised private-child utility is source-only on this branch; the earlier
utility already ran and blocked on the deployed `661cf1` image. The old
observation is terminal per the receipt above. Before any separately authorized
rollout, confirm read-only that no newer run is active and preserve terminal
artifacts. Use an accepted image and an operator-selected new evidence ID,
not the old observation or blocked preflight identity. This procedure makes no
runtime change or host call.

If reviewed and run later, the host utility requires a custom Northflank
entrypoint `node` (because `Dockerfile.paper` has the pilot as its ENTRYPOINT)
and this command form:

```text
scripts/memecoin-paper/host-acceptance.mjs verify --evidence-id host-preflight-<UNIQUE_ID> --mint <APPROVED_MINT> --pool <APPROVED_POOL> --quote <APPROVED_QUOTE> --data-root /var/data/meridian-paper/application-data --provider-preflight
```

It would issue at most four credential-free, fixed-endpoint public requests.
It is a new online provider preflight, not a way to verify current run status;
do not use it to inspect or interrupt any active run.

### Host preflight provisioning, rollout, and rollback

This is an operator plan for a separately authorized future check, not an
instruction to change the current service. The command above is compatible with
Northflank's custom entrypoint + custom command override: `node` is the
entrypoint, and the complete script invocation is the command. Do not use a
CMD-only override because `Dockerfile.paper` already supplies the pilot
entrypoint. The CLI has no `--mount-root` option: the physical mount stays at
`/var/data/meridian-paper`; only the bounded `--data-root` child is selectable.

Conditionally reuse the existing observer/volume, or stop for an isolated fallback:

1. First preserve the old service configuration, logs, mounted volume, and all
   existing run/evidence paths. Confirm any active observation is terminal and
   its terminal artifacts have been preserved. Perform only read-only inspection
   through existing authorized platform capabilities: check current process/run
   status, mount path/identity, actual runtime UID, parent UID/mode/sticky bit,
   resolved ancestry, child UID/mode/device/symlink status if present, and
   absence of legacy `/var/data/meridian-paper/host-acceptance`. If inspection
   is unavailable or ambiguous, stop; do not use a provider preflight as a probe.
2. Build the reviewed source commit into an image and record its immutable
   digest only after review/CI and separate operator approval. Existing
   `/runs` alone does **not** prevent reuse: with no active run, preserved old
   artifacts, absent legacy mount-root evidence, and a safe private direct
   child, the existing volume may support this one-shot revision of the
   existing observer. Never alter old run/config/lock paths. Keep the image's
   unprivileged `node` user; do not add credentials or provider configuration.
3. The mounted parent may be platform-owned (including UID 0), but it must let
   the unprivileged process create the private child, or the child must already
   be correctly provisioned. The parent's owner must be UID 0 or the runtime
   UID; any group/world-writable parent must also be sticky to prevent child
   replacement by other UIDs. Group ownership does not satisfy the child's
   required runtime-UID ownership. The utility creates a missing `application-data`
   child with mode `0700`. If the child is already present, it must already
   satisfy runtime UID, non-symlink, non-group/world-writable, realpath, and
   same-device checks. Do not run as root, run a privileged init, `chown`,
   broaden permissions, or move old artifacts to make these checks pass. If
   the existing volume fails these read-only checks, stop. A separately
   authorized isolated service/volume with supported safe provisioning is a
   fallback, **not automatically required or authorized**; do not purchase
   resources, attach a ReadWriteOnce volume to a second active service, or
   weaken permissions. If supported provisioning is unavailable, leave the
   preflight unrun. This plan performs no `chmod`/`chown` or privileged init.
4. Configure custom entrypoint `node` and the complete command above, replacing
   `<UNIQUE_ID>` with a new, never-reused safe ID and using the specifically
   approved candidate identities. Start only the selected one-shot revision after
   independent review, required CI, and operator authorization. Its provider
   preflight is live public-data access, capped at four requests with no retry.
5. Preserve the service output and volume artifacts. `PASS` is limited to this
   host preflight; it does not activate or authorize the Paper pilot. A
   same-ID restart is read-only and returns `RESTART_VERIFIED` with zero new
   provider requests. Never rerun with the same ID after an `UNKNOWN` outcome.

The CLI emits a JSON `failureCode` and exits `2` for non-success (success exits
`0`). Stable preflight codes are:

| `failureCode` | Meaning / operator action |
|---|---|
| `HOST_ACCEPTANCE_RUNTIME_UID_MISMATCH` | Configured UID differs from the process UID; preserve state and use the image's intended unprivileged user. |
| `HOST_ACCEPTANCE_PRIVILEGED_RUNTIME` | Process is root; stop. The utility must not run as root. |
| `HOST_ACCEPTANCE_MOUNT_ROOT_INVALID`, `HOST_ACCEPTANCE_MOUNT_ROOT_UNAVAILABLE`, `HOST_ACCEPTANCE_MOUNT_ROOT_UNSAFE`, `HOST_ACCEPTANCE_MOUNT_ANCESTRY_UNAVAILABLE` | Fixed physical mount path or its ancestry is absent/unsafe; correct Northflank mount configuration without modifying evidence. |
| `HOST_ACCEPTANCE_MOUNT_ROOT_REPLACEABLE` | Parent owner is untrusted, or group/world-writable parent lacks the sticky bit; blocks before evidence writes/provider requests. Do not weaken permissions or repair the mount live; stop for supported safe provisioning. |
| `HOST_ACCEPTANCE_DATA_ROOT_INVALID` | `--data-root` is not one safe direct child of the physical mount. |
| `HOST_ACCEPTANCE_LEGACY_EVIDENCE_PRESENT` | Old evidence exists directly under the mount root; preserve it, stop reuse, and seek separately authorized isolated provisioning rather than migrate it. `/runs` alone does not trigger this gate. |
| `HOST_ACCEPTANCE_DATA_ROOT_CREATE_FAILED` | The runtime user could not create the private child; provision an appropriate new empty volume/path or stop. |
| `HOST_ACCEPTANCE_DATA_ROOT_UNSAFE`, `HOST_ACCEPTANCE_DATA_ROOT_OWNER_MISMATCH`, `HOST_ACCEPTANCE_DATA_ROOT_PERMISSIONS`, `HOST_ACCEPTANCE_DATA_ROOT_DEVICE_MISMATCH` | Existing private child failed a safety gate; do not repair/chown it or continue. |
| `HOST_ACCEPTANCE_EVIDENCE_PARENT_CREATE_FAILED`, `HOST_ACCEPTANCE_EVIDENCE_DIRECTORY_CREATE_FAILED`, `HOST_ACCEPTANCE_EVIDENCE_DIRECTORY_UNSAFE`, `HOST_ACCEPTANCE_EVIDENCE_DIRECTORY_SYNC_FAILED` | Acceptance evidence location failed its safety/create/sync check; leave any created files untouched and stop. |
| `HOST_ACCEPTANCE_EVIDENCE_UNKNOWN` | Existing ID is incomplete, invalid, or mismatched; preserve it and do not retry/replay. |
| `HOST_ACCEPTANCE_VOLUME_PROBE_<code>` | Probe creation/readback failed; top-level status is `UNKNOWN`, request count is unknown, and evidence is preserved. |
| `HOST_ACCEPTANCE_PROVIDER_PREFLIGHT_BLOCKED`, `HOST_ACCEPTANCE_PROVIDER_PREFLIGHT_<code>` | Provider assembly returned a bounded failure or failed after the probe; it is retained and must not be retried under that evidence ID. |
| `HOST_ACCEPTANCE_RESULT_WRITE_UNKNOWN` | Final result could not be durably read back; preserve the probe and result directory as `UNKNOWN`. |
| `HOST_ACCEPTANCE_CLI_COMMAND_INVALID`, `HOST_ACCEPTANCE_CLI_ARGUMENTS_INVALID`, `HOST_ACCEPTANCE_EVIDENCE_ID_INVALID`, `HOST_ACCEPTANCE_CANDIDATE_INVALID`, `HOST_ACCEPTANCE_MODE_OR_PREFLIGHT_REQUIRED` | Invocation is invalid; correct the command without reusing an evidence ID that may already have written files. |
| `HOST_ACCEPTANCE_FAILED` | An unexpected error occurred outside a classified check; preserve all output/artifacts and treat the result as `UNKNOWN`. |

Rollback is limited to the selected preflight revision: stop/scale it to zero
under separate operator authorization, retaining its volume and output. For
existing-service reuse, restore the recorded inert/hold command and image
settings if needed, **never** the old observation launch command. A Northflank
command save can restart the container; treat it as a runtime action, not an
inert edit. For an isolated fallback, leave the prior observer untouched.
Do not delete volumes, evidence, locks, or logs, and never replay the old run.
If any failure is ambiguous, preserve artifacts, report `UNKNOWN`, and do not
rerun or migrate them.

### Remaining evidence and retrieval handoff

1. Confirm this is still the separate `meridian-paper-observer` service and the
   bound `meridian-paper-data` volume at `/var/data/meridian-paper`; keep the
   gateway/database unchanged. The November 2 receipts report the old run
   terminal and current command held after a blocked preflight; verify no
   newer run is active before any separately authorized runtime change.
2. The old run's terminal `FINISHED` / `DEADLINE` and `PROJECTED` report were
   observed in logs. Independent persisted report/checkpoint identity and
   cross-artifact retrieval remain distinct acceptance work. Preserve its
   run/config directory, locks, logs, and `UNKNOWN` records; never replay it.
3. Use platform logs for the current stop/status/report evidence only through
   the run's existing operator procedure. The short acceptance reports those
   commands and persisted report readback passed; neither those nor the later
   terminal logs substitute for independent volume-artifact acceptance.
4. For terminal artifact retrieval, use an already available Northflank
   file-transfer capability only after the Lead verifies current CLI help,
   service/project IDs, and access. Northflank documents service file transfer
   at [Copy files](https://northflank.com/docs/v1/api/copy-files), but this
   account/service's download ability is not verified. If unavailable, record
   retrieval as `UNKNOWN`; do not assume Shell, SSH, or a CLI path.
5. Do not deploy the revised utility or run its provider preflight while any
   run is active. The conditional reuse/fallback plan above requires final
   exact-head independent GitHub review, CI, and separate operator authorization.
   The utility never starts or authorizes the Paper pilot.

The host check's runtime-UID match, `fsync`/rename/readback, and same-ID restart
readback are bounded observations. `dataRootSameDeviceAsMountRoot` is a required
layout check; `sameDeviceAsParent` remains informational and neither proves
mount identity. They do not prove a provider-specific durability guarantee,
trusted clock, source-page correctness, hard-gate completeness, executed trades,
PnL, or suitability for an eight-hour run. The report hash is an integrity
identifier, not authentication.
