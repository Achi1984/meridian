# Paper host verification procedure

## Status and observed Northflank target

The owner authorized progress toward the existing eight-hour, USD 1,000
virtual-capital Paper observation in #996 comment
[6560721313](https://github.com/Achi1984/meridian/issues/996#issuecomment-6560721313).
That authority does not turn a host check into a Paper run or establish host
readiness. The operator reported that the separate Northflank service
`meridian-paper-observer` is deployed from `main` commit
`14b9412564c300cc44a1f514c4dfebd55495b4aa`, build `fine-floor-4780`, with one
`node`-user instance, no ports, no environment variables, CI/CD off, and an
inert `node -e` process. The operator also reported a dedicated 6 GB volume
`meridian-paper-data` bound at `/var/data/meridian-paper`; the displayed storage
estimate was USD 0.90/month, excluding unverified compute cost. These are
operator observations, not observations by this harness. Existing
`achi-meridian` and `meridian-db` must remain untouched.

The operator reports Northflank Shell is unavailable for the team. No shell,
SSH, new credentials, or service exec is required by the procedure below.
Northflank documents runtime command and entrypoint overrides at
[Override command or entrypoint](https://northflank.com/docs/v1/application/run/override-command-entrypoint).
The deployed service currently runs an inert command; it has not run the Paper
worker. The Paper image contract in [`Dockerfile.paper`](../../../Dockerfile.paper)
uses `ENTRYPOINT ["node", "scripts/memecoin-paper/pilot-online.mjs"]` and
`USER node`. Consequently, a CMD/command override alone appends arguments to
that existing pilot entrypoint. To run the separate acceptance utility, choose
Northflank's **custom entrypoint plus custom command** mode, setting the
entrypoint to `node` and the command to the utility invocation below.

The current deployed image predates `host-acceptance.mjs`; it cannot run this
utility until the dedicated observer image is rebuilt from the reviewed source
that includes it. No build, deployment, service setting, or host command was
changed by this task.

## Lead-reported host evidence and active run boundary

The following are **operator-reported observations** in PR #1114, not checks run
by this agent. The linked report is the evidence source; hashes and logs are
identifiers, not independent authentication.

| Observation | Reported result | What it establishes / does not establish |
|---|---|---|
| Volume probe (`host-probe-20261101-r1`; comment [6562423375](https://github.com/Achi1984/meridian/pull/1114#issuecomment-6562423375)) | On deployed `main` image `14b9412564c300cc44a1f514c4dfebd55495b4aa`, runtime UID/GID 1000; `/proc/self/mountinfo` matched the expected mount. Exclusive create, file `fsync`, same-directory rename, directory `fsync`, byte/hash readback passed at 18:55:54Z. | Supports that the process and selected mounted path completed those operations at that time. The first newline-normalized attempt reported `MOUNT_NOT_PROVEN` and made no writes; only the corrected command passed. This is not power-loss or provider durability proof. |
| Container restart readback (comment [6562423375](https://github.com/Achi1984/meridian/pull/1114#issuecomment-6562423375)) | `PERSISTED_READBACK` passed at 18:56:31Z with the same SHA-256, `c5642cebfef93d86451aaddbd2ff13c7b7dea37bcbbc4ddc8e992420e0807948`. | Confirms the reported artifact was read after a container restart. It does not show survival of host, volume, or power loss. |
| Separate short acceptance run (comments [6562454779](https://github.com/Achi1984/meridian/issues/942#issuecomment-6562454779) and [6562477627](https://github.com/Achi1984/meridian/issues/942#issuecomment-6562477627)) | Lead reports `STOP_REQUESTED`; terminal `FINISHED` / `OPERATOR_STOP`, no terminal failure, report `PROJECTED`, four provider requests (one Dex, three RPC), 3,740 bytes, one candidate, zero entries/fills. Acceptance persisted across restart at 19:00:56Z with `ACCEPTANCE_RESTART_BLOCKED`; report readable from the durable volume via platform logs. | Supports the short stop/report/restart-denial path as reported. Filter `UNKNOWN` and executable quote `UNAVAILABLE` remain; this is not trade/quote readiness and does not prove a separate downloaded artifact copy. |
| Active eight-hour observation (comments [6562477627](https://github.com/Achi1984/meridian/issues/942#issuecomment-6562477627) and [6562485487](https://github.com/Achi1984/meridian/pull/1114#issuecomment-6562485487)) | Lead reports run `observation-20261101-r1` invoked at 19:02:21Z, window `2026-11-01T19:02:21.383Z`–`2026-11-02T03:02:21.383Z`, with a new run/config path and permanent restart guard. The follow-up reports a heartbeat at 19:03:21.480Z and a 1,792-byte checkpoint modified at 19:02:23.675Z; final report was pending. | Treat this one-shot as active/pending per the Lead's handoff, not as a run independently observed here. Do not restart, redeploy, change its CMD/config, stop it, or reuse its paths. Its actual filter remained `UNKNOWN` and executable quote evidence unavailable; this is not trade/quote readiness. |

Clock provenance remains `UNVERIFIED`: timestamps in the operator report do
not identify an independently trusted host clock or establish its skew. The
actual artifact files have not been independently retrieved by this agent.
The Lead reports the acceptance report is readable from the volume via platform
logs, but that does not verify a downloadable volume copy or a file-transfer
route for this team/service. Platform logs and same-volume restart readback do
not prove host/volume power-loss persistence. No provider-capacity guarantee,
quote/trade readiness, or completed eight-hour report is claimed here.

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
Custom command: scripts/memecoin-paper/host-acceptance.mjs verify --evidence-id host-preflight-<UNIQUE_ID> --mint DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 --pool 5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9 --quote So11111111111111111111111111111111111111112 --provider-preflight
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

1. Records the actual process UID/GID and volume-root UID/GID/mode/device. It
   blocks before writes or provider calls unless the mounted root is a real
   non-symlink directory owned by the actual runtime UID.
2. Creates a new, private evidence directory under
   `/var/data/meridian-paper/host-acceptance/<UNIQUE_ID>/`, then writes a
   generated marker, calls file `fsync`, renames within that directory, syncs
   the directory, and verifies byte-for-byte readback.
3. Reports wall-clock samples against monotonic elapsed time. Clock provenance
   always remains `UNVERIFIED`; neither `Date.now()` nor this brief comparison
   establishes trusted clock authority.
4. Calls the integrated fixed-endpoint provider assembly only after the volume
   write/readback succeeds. It stores a bounded, hashed `result.json` and emits
   one JSON result to platform logs. A pass means only these specific checks
   passed; `hostDurability` remains `NOT_VERIFIED`,
   `runtimeAuthorization` remains false, and `pilotStarted` remains false.

The durable files are `probe.json` and `result.json`. Do not delete, overwrite,
or reuse the evidence directory. If the service restarts with the same CMD and
evidence ID, the utility verifies the existing file/hash identities and emits
`RESTART_VERIFIED` with `providerRequestsThisInvocation: 0`; it never repeats
the provider calls. If the first invocation was interrupted or either file is
missing/corrupt, it reports `UNKNOWN` and preserves the incomplete evidence
without repair or replay. Provider failure is retained as `BLOCKED`; a
subsequent start does not retry it.

### Future host-utility packaging (not an instruction to touch the active worker)

The host-acceptance utility described below is source-only on this branch and
is absent from the currently deployed image. Do not deploy it, change the CMD,
or restart the worker while `observation-20261101-r1` is active. The short
acceptance run has already exercised stop/report/restart behavior; do not run a
second host acceptance lap. After the active run is complete and its terminal
artifacts are preserved, any later packaging/acceptance requires a separately
reviewed image and an operator-selected, new evidence ID. This procedure makes
no runtime change or host call.

If reviewed and run later, the host utility requires a custom Northflank
entrypoint `node` (because `Dockerfile.paper` has the pilot as its ENTRYPOINT)
and this command form:

```text
scripts/memecoin-paper/host-acceptance.mjs verify --evidence-id host-preflight-<UNIQUE_ID> --mint <APPROVED_MINT> --pool <APPROVED_POOL> --quote <APPROVED_QUOTE> --provider-preflight
```

It would issue at most four credential-free, fixed-endpoint public requests.
It is a new online provider preflight, not a way to verify current run status;
do not use it to inspect or interrupt the active one-shot run.

### Remaining evidence and retrieval handoff

1. Confirm this is still the separate `meridian-paper-observer` service and the
   bound `meridian-paper-data` volume at `/var/data/meridian-paper`; keep the
   gateway/database unchanged. Do not change or restart the active worker. Its
   reported existing storage and short acceptance results are listed above;
   they must not be repeated during the active run.
2. The eight-hour run is not complete until the Lead records terminal status,
   final report, and the persisted report/checkpoint identity after its stated
   deadline. Preserve the active process, its run/config directory, logs, and
   any `UNKNOWN` records; do not replay uncertain work.
3. Use platform logs for the current stop/status/report evidence only through
   the run's existing operator procedure. The short acceptance reports those
   commands and persisted report readback passed; it did not establish that the
   active run has finished or that logs are a substitute for volume artifacts.
4. For terminal artifact retrieval, use an already available Northflank
   file-transfer capability only after the Lead verifies current CLI help,
   service/project IDs, and access. Northflank documents service file transfer
   at [Copy files](https://northflank.com/docs/v1/api/copy-files), but this
   account/service's download ability is not verified. If unavailable, record
   retrieval as `UNKNOWN`; do not assume Shell, SSH, or a CLI path.
5. Do not deploy the host utility or run its provider preflight while the
   one-shot is active. After terminal evidence is preserved, future source
   packaging or a separate host preflight is outside this handoff and requires
   a new review. The utility never starts or authorizes the Paper pilot.

The host check's UID match, `fsync`/rename/readback, and same-ID restart readback
are bounded observations. `sameDeviceAsParent` is informational, not volume
authentication. They do not prove a provider-specific durability guarantee,
trusted clock, source-page correctness, hard-gate completeness, executed
trades, PnL, or suitability for an eight-hour run. The report hash is an
integrity identifier, not authentication.
