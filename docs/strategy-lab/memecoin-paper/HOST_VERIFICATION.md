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

### Lead-run acceptance sequence

1. Confirm this is still the separate `meridian-paper-observer` service and the
   bound `meridian-paper-data` volume at `/var/data/meridian-paper`; keep the
   gateway/database unchanged. Confirm the deployed image contains the exact
   reviewed utility and assembly. A Dockerfile `chown` does not prove mounted
   volume ownership.
2. Record the unique evidence ID and the exact `node` UID expected for the
   image. Apply the custom entrypoint/command above, then inspect Northflank
   **platform logs**. Require JSON `status: PASS`, `hostCheck: PASS`,
   `providerPreflight.status: PASS`, matching runtime/root UID, four received
   events, `runtimeAuthorization: false`, `pilotStarted: false`,
   `hostDurability: NOT_VERIFIED`, and `clockProvenance: UNVERIFIED`.
   `BLOCKED`/`UNKNOWN`, UID mismatch, missing fields, timeout, or nonzero exit
   means stop and preserve all files/logs.
3. If Northflank restarts the exited process, require the same ID to report
   `RESTART_VERIFIED` and zero provider requests in that invocation. If it does
   not restart automatically, use only the platform's documented service
   restart control once, then require that same result. Do not rely on an
   assumed restart-policy toggle. This tests that the evidence is visible
   after a container restart; it still does not prove power-loss durability.
4. Preserve logs and retrieve
   `/var/data/meridian-paper/host-acceptance/<UNIQUE_ID>/` using an already
   available Northflank file-transfer path only after the operator verifies
   current CLI help, service/project IDs, and access. Northflank documents
   service file transfer at
   [Copy files](https://northflank.com/docs/v1/api/copy-files), but file
   retrieval capability for this account/service has not been observed. If
   unavailable, logs alone do not provide the volume files; mark retrieval
   `UNKNOWN` and stop rather than assuming Shell or SSH access.
5. Restore the service's reviewed inert command after capturing the evidence.
   This host acceptance never runs `start`, `stop`, `status`, or `report` for
   the Paper pilot. An eight-hour run remains a separate later operation using
   its own new run ID, frozen config, and run directory.

The host check's UID match, `fsync`/rename/readback, and same-ID restart readback
are bounded observations. `sameDeviceAsParent` is informational, not volume
authentication. They do not prove a provider-specific durability guarantee,
trusted clock, source-page correctness, hard-gate completeness, executed
trades, PnL, or suitability for an eight-hour run. The report hash is an
integrity identifier, not authentication.
