# BTC/EUR one-shot spot paper host package

This package prepares one explicitly reviewed, eight-hour BTC/EUR paper run. It
is a proposed one-shot host job, not continuous production, a scheduler, a
deployment, a profitability claim, or an activation approval. It reuses the
existing spot-paper runner, Kraken public-data provider, SMA(5)/SMA(20) model,
simulated ledger, and journal. It does not change the strategy or reuse the
Memecoin paper image, observer, report gateway, or their volumes.

## Inert default and explicit commands

The image entrypoint with no arguments exits as `DISABLED`; it makes no network
requests and starts no child process. `preflight` is read-only and cannot launch
the runner. Only `launch` with the exact packaged launch manifest and a
nonexistent, explicitly configured evidence directory can start the fixed
paper command. The manifest fixes the run ID, source fingerprint, `BTC/EUR`,
`BTC_EUR_SMA5_SMA20_V1`, paper-only mode, 480 cycles, 960 requests, eight hours,
60-second polling, 5-second requests, and the existing 64 MiB total/256 KiB
per-response byte limits. The host wrapper also pins the Node executable and
CLI argument vector; it has no shell, arbitrary command, provider, strategy, or
run-ID option.

Build and inspect the inert image locally:

```sh
docker build -f Dockerfile.spot-paper -t meridian-spot-paper-host .
docker run --rm --network none meridian-spot-paper-host
```

The first command only builds. The second must print `DISABLED`; it is a
network-disabled smoke, not a pilot run. To inspect the manifest and verify the
runtime fingerprint without creating the evidence directory:

```sh
docker run --rm --network none \
  --entrypoint node meridian-spot-paper-host \
  scripts/spot-paper-pilot/host-entrypoint.mjs preflight \
  --manifest /app/scripts/spot-paper-pilot/host-launch-manifest.json \
  --evidence-dir /var/lib/meridian/spot-paper-host/run-001
```

A real host launch requires a separate operator approval and an explicitly
reviewed decision to permit outbound HTTPS to Kraken's public API. The operator
must mount a dedicated durable directory writable by the image's unprivileged
`node` user. Mount the parent volume so the run-specific child path is still
nonexistent, then invoke `launch` with the packaged manifest:

```sh
docker run --rm --network kraken-public-egress \
  --mount type=bind,src=/srv/meridian/spot-paper-host,dst=/evidence-root \
  --entrypoint node meridian-spot-paper-host \
  scripts/spot-paper-pilot/host-entrypoint.mjs launch \
  --manifest /app/scripts/spot-paper-pilot/host-launch-manifest.json \
  --evidence-dir /evidence-root/btc-eur-paper-001
```

`kraken-public-egress` represents a separately configured network restricted
to the existing public provider endpoints. The example is not an approval to
create that network or launch this job. This PR does not run or deploy it. Do
not pass credentials or exchange keys; none are required. The runner is
paper-only and has no order execution path.

## Evidence ownership, status, and stopping

The launch directory must not already exist. It is created exclusively and
contains a host lock/state plus `runtime/<runId>/` with the spot journal and
response bodies. Concurrent launch, restart, reuse of a stale lock, and any
ambiguous prior directory are refused. There is no resume, retry, balance
reset, or replacement run ID. Keep the entire directory intact, including
partial/corrupt evidence; do not remove a lock or journal marker to make a run
appear clean.

Read-only inspection uses the same absolute evidence directory:

```sh
docker run --rm --network none -v /srv/meridian/btc-eur-paper-001:/evidence:ro \
  --entrypoint node meridian-spot-paper-host \
  scripts/spot-paper-pilot/host-entrypoint.mjs status --evidence-dir /evidence
docker run --rm --network none -v /srv/meridian/btc-eur-paper-001:/evidence:ro \
  --entrypoint node meridian-spot-paper-host \
  scripts/spot-paper-pilot/host-entrypoint.mjs report --evidence-dir /evidence
```

Status distinguishes `DISABLED`, `RUNNING_OBSERVED`,
`VERIFIED_TERMINAL`, and `INCOMPLETE_UNKNOWN`. A persisted PID/lock can at most
support `RUNNING_OBSERVED`; it does not establish health or verified execution.
Terminal verification requires a clean child exit, non-interrupted host state,
read-only journal reconciliation, and matching run/model/mode/pair/limit/report
fields. Report and status do not modify the journal and return a bounded
summary, not raw response bodies. Inspection rejects journals above 8 MiB,
response references beyond the 960-request/64 MiB/256 KiB-per-response caps,
and reports above 256 KiB. Journal reconciliation is bounded to five seconds;
a timeout, missing/corrupt/pending journal, ambiguous write, signal, or
nonzero child exit remains incomplete/unknown. Never relaunch to resolve
unknown evidence.

## Storage diagnostic and byte-preserving evidence package

The standalone storage diagnostic is inert unless invoked with an explicit
absolute mount path. Run it as the image's unprivileged `node` user against the
mounted volume, never as root:

```text
Custom entrypoint: node
Custom command: scripts/spot-paper-pilot/storage-diagnostic.mjs --mount /var/lib/meridian/spot-paper-host
```

It creates one new `meridian-storage-probe-<UUID>` child, exclusively creates
one fixed-size probe file, writes and syncs it, renames and reads it back,
syncs the child directory, then reports its SHA-256, free bytes, and UTC time
in one small JSON line. The probe is retained. A collision, non-root failure,
or other error does not retry, remove evidence, change ownership/permissions,
read environment values, or make a network request. Its 512-byte work ceiling
and 10-second operation deadline apply to this short probe only; filesystem
calls are not hard-real-time guarantees. The deadline is cooperative and checked
between operations; synchronous filesystem calls cannot be interrupted. A
separately approved host Job also needs an external platform timeout.

The offline packaging command reads only the selected evidence tree. It never
calls the host assessment or journal parser, so partial locks, pending journals,
truncated files, and corrupt regular-file bytes are retained without repair or
success requirements. The archive is uncompressed USTAR; its companion JSON
manifest lists each regular file's relative path, byte length, and SHA-256.
The output reports `PACKAGED_BYTES_ONLY` / `BYTE_PRESERVATION_ONLY`, always
leaves operational readiness `NOT_ASSESSED`, and does not mean
`VERIFIED_TERMINAL`.

The tool rejects symlinks, special files, unsupported/escaping paths, input
mutation, and output collisions. It does not normalize or omit files. The
explicit ceilings admit at most 960 response files (256 KiB each, 64 MiB total),
an 8 MiB `journal.json`, an 8 MiB writer-temporary
`journal.json.<pid>.<uuid>.tmp`, a 16 KiB `journal.pending`, 1 MiB of other
metadata, 1,024 regular files, 256 directories, depth eight, an 84 MiB archive,
an aggregate 81 MiB + 16 KiB input ceiling, and a 60-second cooperative
monotonic work deadline. Input bytes stream through at most 64 KiB payload
buffers; the tool does not retain whole-file or whole-archive buffers. These
are packaging bounds, not a claim that the input is valid.
Both output paths must be absolute, outside the evidence tree, and not already
present:

```text
Custom entrypoint: node
Custom command: scripts/spot-paper-pilot/package-host-evidence.mjs /var/lib/meridian/spot-paper-host/btc-eur-paper-001 /tmp/btc-eur-paper-001.tar /tmp/btc-eur-paper-001.manifest.json --retrieval-window-ms 300000
```

### Authenticated Northflank-native download handoff

No artifact-download route or transport has been exercised for this host.
Current transport status is **UNVERIFIED**. Do not send archive bytes through
logs, base64, chat, a public HTTP endpoint, or the Memecoin `FINISHED`-only
256 KiB DTO / one-hour or four-hour spot gateways.

After the writer has exited, an operator must make a separate bounded,
one-attempt Northflank maintenance Job from the reviewed spot image. The
packager's `--retrieval-window-ms 300000` option keeps the successful process
alive for five minutes after it prints the small package result, providing a
live Job from which to download. There is no public server or retry. Mount the
same persistent volume read-only at `/var/lib/meridian/spot-paper-host`; use
the image's unprivileged `node` user, custom entrypoint `node`, and the
packaging command above with outputs under `/tmp`. Disable schedules/restarts/
retries and expose no public port. Do not run this job while a writer may still
be active. Its volume mount is read-only; the package and manifest are written
only to the Job's temporary filesystem. Use a single 390-second Job timeout
(60-second package ceiling + 300-second retrieval window + 30-second exit
margin), with no automatic retry, and reserve at least 84 MiB for its
temporary archive. The package deadline is cooperative; the platform timeout
bounds blocking operations and the full process lifecycle.

Before attempting the full package, use Northflank's authenticated CLI file
copy to download the small retained `probe.bin` from the mounted volume, then
compare its downloaded SHA-256 with the value reported by the storage
diagnostic. Use the operator's authenticated Northflank CLI session. The
Northflank Overview → Local access → Download panel provides a CLI instruction
and copy-command control; it is not a browser file download and does not
authenticate the CLI session. No authenticated CLI session has been used here.
The platform-confirmed native command form uses `--jobId`:

```sh
northflank download job file --projectId meridian --jobId meridian-btc-paper-host-8h \
  --remotePath /var/lib/meridian/spot-paper-host/meridian-storage-probe-<UUID>/probe.bin \
  --localPath ./probe.bin
sha256sum ./probe.bin
```

Only after that small download and hash comparison succeeds should the operator
use the same authenticated file-copy mechanism to fetch the TAR and manifest
from `/tmp` in the maintenance Job:

```sh
northflank download job file --projectId meridian --jobId meridian-btc-paper-host-8h \
  --remotePath /tmp/btc-eur-paper-001.tar \
  --localPath ./btc-eur-paper-001.tar
northflank download job file --projectId meridian --jobId meridian-btc-paper-host-8h \
  --remotePath /tmp/btc-eur-paper-001.manifest.json \
  --localPath ./btc-eur-paper-001.manifest.json
sha256sum ./btc-eur-paper-001.tar
```

Compare the downloaded TAR hash with the packager's small `archiveSha256`
result; retain the manifest and verify the listed file hashes offline.
Northflank describes this file-copy workflow in
[Copy files](https://northflank.com/docs/v1/api/copy-files) and
[Transfer data to and from containers](https://northflank.com/docs/v1/application/run/transfer-data-to-and-from-containers).
This source package has not established that the current account, project,
Job type, or image supports the transfer. Until the real probe is downloaded
and hash-compared, transport remains **UNVERIFIED**. If native download is
unavailable, operator authorization for that native transfer is the remaining
prerequisite; a local archive alone is **not** a completed download.

## Offline eight-hour assessment

The eight-hour path is offline only. It reads the current checked-in launch
manifest, verifies its runtime-source digest, independently reinspects
`host-state.json` and the retained journal, and passes the journal's response
bodies through the existing paper accounting and signal-replay validators.
Child stdout is ignored; the terminal report is taken from the independently
read terminal journal event and must match the verified host report.

Before any launch, prepare and retain an expected-context JSON file separately
from the evidence directory, using values reviewed independently of run
artifacts:

```json
{
  "schemaVersion": "SPOT_PAPER_HOST_EXPECTED_CONTEXT_V1",
  "profileId": "BTC_EUR_PAPER_HOST_8H_V1",
  "hostRunId": "btc-eur-paper-host-8h-001",
  "launchManifestSha256": "<sha256 of the exact reviewed manifest bytes>",
  "runtimeSourceSha256": "<runtimeSourceSha256 from the reviewed manifest>",
  "imageDigest": null,
  "hostIdentity": null
}
```

In this package, host state does not record an image digest or host identity;
leave those values `null`. If such fields are present in retained host state,
the independent context must match them. Operator-provided strings are not
attestations. The current host path can verify content binding only and reports
image/host identity as unavailable; source/image provenance, host identity,
clock correctness, and provider authenticity remain unattested and must be
verified independently before any launch. This assessment does not establish
launch readiness.

Run the assessment from a checkout containing the current package. Keep both
the expected-context input and output outside the retained evidence directory:

```sh
node scripts/spot-paper-pilot/host-evidence-assessment.mjs \
  /srv/meridian/btc-eur-paper-001 \
  /srv/meridian/reviewed/expected-host-context.json \
  /srv/meridian/reviewed/host-assessment.json
```

Use `-` in place of the expected-context path only to produce an `UNKNOWN`
result when no independent expectation is available. The command performs no
provider or network requests and fails closed on missing, pending, corrupt,
oversized, interrupted, mismatched, or mixed-profile evidence. It reports
actual elapsed duration and coverage: reaching the 480-cycle cap before eight
hours is partial, not full-duration. It preserves flat/open inventory, fees,
and PnL accounting, but makes no profitability claim.

For an operator stop, send `SIGTERM` to the host container/process. The parent
forwards `SIGTERM` to the spot CLI; the CLI attempts its existing bounded
terminal journal write (five-second grace). The parent escalates to
`SIGKILL` after seven seconds. Interruption is recorded and never presented as
a clean terminal run. Preserve evidence and retrieve it from the mounted
volume. Do not place the job in a restart policy, scheduler, daemon, or
continuation loop.

## Host readiness and evidence boundary

Before any separately approved launch, the host operator must confirm:

The general restricted-egress requirement below remains in force except for
the single owner-accepted, non-reusable exception documented in
[`SPOT_PAPER_HOST_DEPLOYMENT_EXCEPTION.md`](SPOT_PAPER_HOST_DEPLOYMENT_EXCEPTION.md).

- a durable, private volume with adequate space for up to 64 MiB of response
  bodies plus journal/checkpoint and atomic-write overhead;
- a local filesystem with exclusive file creation, atomic rename, and `fsync`
  semantics, and correct system time;
- volume ownership/access for the image's unprivileged `node` user;
- one launch owner and an unused evidence directory, with no competing writer;
- network egress restricted to the public Kraken HTTPS endpoints required by
  the existing provider; and
- an independent evidence retention and retrieval procedure for complete and
  incomplete runs.

The host manifest's `runtimeSourceSha256` fingerprints the exact existing
runtime source files used by the wrapper. The offline assessment's expected
context binds the host run, exact reviewed manifest bytes, and source fingerprint
to retained content. This is not a GitHub workflow identity, signed image
identity, or independently verified host provenance. Do not substitute or
forge a GitHub run/workflow identity.

The `BTC_EUR_PAPER_HOST_8H_V1` profile accepts only this package's exact
manifest and bounds; it is separate from the unchanged one-hour and four-hour
profiles and GitHub-dispatch checks. A successful offline assessment means that
the retained content passed those checks and the existing accounting/replay
validators. It does not authenticate the real host, source/image, clock, or
provider; it does not establish launch readiness, strategy profitability, or
production readiness. Real host/source authenticity remains a separate
prerequisite before any launch.

No eight-hour job is configured in GitHub Actions. Actions may build the image
and run offline tests only; actual hosting configuration and acceptance remain
separate from code merge.
