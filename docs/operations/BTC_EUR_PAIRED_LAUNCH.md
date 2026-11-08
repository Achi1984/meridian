# BTC/EUR paired-paper one-shot host launch

The owner's one-shot PAPER execution approval is already recorded. This change
prepares and validates the package only; it does not deploy or launch it. It
does not modify the existing spot-paper image, the stopped
`btc-eur-paper-host-8h-001` evidence, or its volume.

## Source and acceptance gates

The image packages the paired host from #1301, the baseline/shared-feed and
journal helpers it imports, and the reviewed #1299 research exports:

- #1299 research source: `adf5c0a6e7b7d93bfd106dd6136c40a8e15a6373`
- merged #1299 source commit: `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`
- merged #1301 source commit: `a64eef5f614bdba3cf284d9a5209aa606dd8e87d`
- #1304 single-export evaluator candidate: `5700feb6f1b82257b18e5c50f527a3e2f80d175a` (accepted source, not merged to main at this revision)

The accepted research pin in `scripts/spot-paper-paired/forward.mjs` is
`4c60b1ccccbd495d93006a6838593423c27caac8104a0239fa23fd97a716f82d`. It was
computed by `pairedResearchSourceDigest` from the exact merged #1299 source
bytes and is intentionally unchanged by the paired host. Independent byte
identities:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| `scripts/spot-paper-research/comparison.mjs` | 19,018 | `482092145488d6a9fe3fd4230648fac85fb3036fe2f256f6ff1c2e18d00b617f` |
| `scripts/spot-paper-research/entry-confirmation.mjs` | 4,518 | `0107759a690a8ce20ae6cb61c59ed3ef2fad0c7093f5efb6df0be37b61334f8b` |

The image's default command remains `disabled` and performs no feed request.
The explicit `run` command is capable of public feed access when invoked; this
task does not invoke it, acquire data, launch a host, or deploy an image.

The image includes `status`, `report`, `export`, and byte-preserving `package`
commands from the paired host. It does not include the separate #1304 offline
evaluator. The new single-export evaluator CLI from #1304 candidate
`5700feb6f1b82257b18e5c50f527a3e2f80d175a` takes the combined host-export
artifact directly; it removes the earlier report-wrapper/journal-extraction
chain. Keep evaluator modules out of this image.

### Candidate image and smoke evidence

The first candidate image was built from an isolated temporary context
containing only #1301 `5f25f771cd45dab41ec642660cce18cbdb324ef3`, merged #1299
exports, required baseline/journal/provider/packaging modules, and this
Dockerfile. After #1301 merged, the image was rebuilt from the complete merged
checkout with the accepted pin set. The current build identities and smoke
results are recorded below.

| Build identity | Recorded value |
| --- | --- |
| Dockerfile SHA-256 | `e92f25066d313a51b95072cfbdb88811ada781bd787587be54753ffc25fee22b` |
| Resolved base image | `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293` |
| Local image ID | `sha256:f50c5d63e248adc37209eae980239a063a617565f462dc70dc442788c77fe590` |
| Local tag | `meridian-spot-paper-paired:5f25f771` |
| Registry digest | Not available; image was not pushed |

The initial candidate build smoke checks passed:

- `docker run --rm --network none meridian-spot-paper-paired:5f25f771`
  returned `DISABLED`; no feed access was possible.
- Direct imports of all nine packaged host, paired, baseline, provider,
  packaging, and #1299 research modules succeeded with networking disabled;
  provider counters remained unused.
- A bind-mounted file write succeeded as UID 1000 (`node`).
- Docker SIGTERM reached Node's paired host signal helper; its AbortSignal
  handler wrote `SIGTERM` to the writable mount and the process exited within
  the 10-second Docker stop grace.
- The exact #1301 paired-forward and paired-host test files passed 22/22,
  including the 480-cycle integration against actual #1299 exports.

The updated #1301 actual-export 480-cycle fixture measured:

| Artifact | Measured bytes | Applicable bound |
| --- | ---: | ---: |
| Persisted journal | 1,627,285 | 8 MiB |
| Read-only journal export payload | 1,627,241 | 16 MiB evaluator input |
| Standalone terminal report | 279,371 | 8 MiB evaluator input |
| Host report wrapper | 279,688 | 8 MiB evaluator input |
| Combined host export | 1,906,788 | 16 MiB |
| Byte-preserving archive | 4,319,232 | 84 MiB |

These are measured sizes for the exercised provider-shaped fixture, not a
worst-case guarantee. The temporary #1304 CLI composition at
`1feea98a1fd2c602fccb1824c71d19e253c28376` accepted the completed report/export
as `VERIFIED_COMPLETE`; the separate operator-interrupted synthetic case stayed
`INTERRUPTED` with unavailable deltas. The evaluator was not packaged in this
image because it remains an independently run consumer.

#1301 merged as `a64eef5f614bdba3cf284d9a5209aa606dd8e87d`; final-head CI
`42528020776` succeeded. The current branch contains that main commit and the
accepted research pin. #1304's single-export CLI at `5700feb6f1b82257b18e5c50f527a3e2f80d175a`
has accepted source review and CI `42528821318` succeeded, but it has not yet
merged to main. Before final package acceptance, require the current branch's
final-head CI and rebuild the image from the merged reviewed source. No
registry repository or digest, Northflank job/instance/volume IDs, region, or
compute size is available from this preparation.

## Frozen run

| Setting | Value |
| --- | --- |
| Run ID | `btc-eur-paired-host-8h-001` |
| Pair and mode | `BTC/EUR`, paper only |
| Accounts | Three separate virtual accounts, EUR 1,000 each: baseline, challenger, cash control |
| Entry and position | Maximum EUR 100 entry per account; no leverage or short positions |
| Cost assumptions | 50 bp fee and 10 bp adverse slippage per side; modeled assumptions, not verified rates |
| Run bounds | Eight hours, 480 cycles, 960 shared public requests total |
| Existing data bounds | 64 MiB total response bytes, 256 KiB per response, five-second request timeout, at least 60 seconds between cycle starts, ticker age at most 10 seconds, closed-candle age at most 120 seconds |
| External deadline | 8 hours 2 minutes, with a 60-second termination grace period |
| Retry/restart | One attempt; no schedule, retries, restarts, or autoresume |

The host code stops at its eight-hour duration bound and bounds requests at
five seconds. On SIGTERM it can have one in-flight request (at most five
seconds) and up to three terminal/persistence journal operations (five seconds
each), a 20-second bounded cleanup budget. The external 8h02m timeout leaves
two minutes beyond the internal run bound for that cleanup and platform
scheduling; allow the separate 60-second grace period after the platform sends
SIGTERM. SIGTERM is delivered directly to Node by the exec-form image
entrypoint. Do not wrap it in a shell.

## Build and immutable image record

After final-head tests pass, build from the exact reviewed merged source commit.
Use the existing approved registry repository if one exists; its name is not
established by this change.

```sh
SOURCE_COMMIT="$(git rev-parse HEAD)"
IMAGE_TAG="<existing-approved-registry-repository>:paired-${SOURCE_COMMIT}"
docker build \
  --label "org.opencontainers.image.revision=${SOURCE_COMMIT}" \
  -f Dockerfile.spot-paper-paired \
  -t "${IMAGE_TAG}" .
```

Smoke the local image without networking before any separately approved
registry push:

```sh
docker run --rm --network none "${IMAGE_TAG}"
```

It must print `DISABLED`; it must not request feed data. Do not use a mutable
tag for the Northflank job. After an independently approved registry push,
record the full repository digest:

```sh
docker image inspect --format '{{json .RepoDigests}}' "${IMAGE_TAG}"
```

Configure the job with that exact `repository@sha256:...` reference. This task
does not push an image and no registry path or image digest is available yet.

Record these immutable build and deployment identities in the run record:

- reviewed source commit (`git rev-parse HEAD`) and Dockerfile SHA-256;
- merged #1301 commit, #1299 commit above, and accepted research-source SHA-256;
- image repository digest (`repository@sha256:...`), not only the build tag;
- paired config SHA-256 from the host composition;
- actual Northflank project/job/instance and new volume IDs, mount path, region,
  compute size, run ID, command vector, timeout, and termination grace.

Only the existing project name `meridian` and the run ID above are specified
here. Job, instance, volume, region, compute-size, registry, and image-digest
identifiers must be obtained from the approved environment; do not invent or
reuse identifiers from the old stopped run.

## Northflank job configuration

In the existing `meridian` project, create one unscheduled one-shot Job using
the immutable image digest above. Reuse the already approved region and size if
they are available in that project. If either is unknown, resolve those
existing allocations before launch; this plan does not select or create new
infrastructure identifiers.

Allocate a **new, separate durable volume** for this run. Mount its root
read/write at `/evidence-root`, and ensure the mount is writable by the image's
unprivileged `node` user (UID 1000); do not use a root init/write step. Never
attach the old stopped-run volume. The host creates the previously nonexistent
run directory `/evidence-root/btc-eur-paired-host-8h-001` exclusively.

Set the Job to one instance/attempt, no schedule, retry count zero, restart
policy `Never`, timeout `8h 2m`, and termination grace `60s`. Do not enable
resume, retry, or automatic restart. Set the container command/arguments
exactly as this vector; keep the image entrypoint unchanged:

```json
[
  "run",
  "--data-root",
  "/evidence-root",
  "--run-id",
  "btc-eur-paired-host-8h-001"
]
```

This Job must not be created or launched until the exact reviewed source and
immutable image digest are recorded, mount ownership is verified, and remaining
technical prerequisites above pass. The already-recorded owner PAPER approval
covers the future bounded paper operation; it does not replace those technical
checks.

## Stop, inspect, export, and retrieve

After the writer has stopped, independently verify that no writer remains
before attaching the new volume read-only to a separate one-shot maintenance
Job using the same immutable image digest. Use no retry, schedule, or restart.
Run the host commands as separate invocations with the exact arguments below:

```text
status --data-root /evidence-root --run-id btc-eur-paired-host-8h-001
report --data-root /evidence-root --run-id btc-eur-paired-host-8h-001
export --data-root /evidence-root --run-id btc-eur-paired-host-8h-001
```

Give the status/report/export-only maintenance invocation a finite 60-second
external timeout; host journal inspection is bounded to five seconds. Apply
the longer retrieval timeout below only to packaging and native file download.

`export` emits one bounded `SPOT_PAPER_PAIRED_HOST_EXPORT_V1` JSON document
containing the report and validated journal payload. The canonical evaluator
consumes that file directly; do not extract, transform, or hand-edit a separate
report or journal:

```sh
node scripts/spot-paper-paired/host.mjs export \
  --data-root /evidence-root --run-id btc-eur-paired-host-8h-001 \
  > /tmp/spot-paper-paired-package/host-export.json
node scripts/spot-paper-paired-report/cli.mjs \
  /absolute/path/expected-identity.json \
  /tmp/spot-paper-paired-package/host-export.json
```

The second command requires #1304 candidate
`5700feb6f1b82257b18e5c50f527a3e2f80d175a` (or its merged successor), which
accepts exactly one host-export artifact plus the independently prepared
expected-identity file. Do not copy candidate evaluator files into the paired
image. Capture and preserve the complete export; if the host output is truncated
or the evaluator reports `CORRUPT_UNKNOWN`, retain raw evidence and stop.

The candidate #1301 source addresses the 480-cycle size issue by omitting
cumulative decision-state snapshots from the terminal report while preserving
causal decisions and structured states in the journal. Its 480-cycle measured
sizes and synthetic evaluator completed/interrupted results are recorded above
in this runbook. The remaining technical acceptance is final-head CI for this branch and
reconfirmation using #1304's merged single-export CLI when it reaches main.
The candidate measurements do not establish a worst-case maximum or live
readiness.

After that gate passes, run `package` as a separate read-only-volume
maintenance invocation. Reserve at least 90 MiB of writable temporary space
for the maximum 84 MiB archive, bounded manifest, and margin. The host writes
only in its pre-created `/tmp/spot-paper-paired-package` directory, which is
writable as `node`. Use a 390-second external timeout: 60 seconds for bounded
packaging, the maximum 300-second native-download hold, and 30 seconds for
exit. The helper also enforces an 84 MiB archive ceiling. Exact arguments:

```text
package --data-root /evidence-root --run-id btc-eur-paired-host-8h-001 --archive /tmp/spot-paper-paired-package/btc-eur-paired-host-8h-001.tar --manifest /tmp/spot-paper-paired-package/btc-eur-paired-host-8h-001.manifest.json --retrieval-window-ms 300000
```

Record the actual maintenance Job ID and exact instance name returned by that
Job. Download the two files into separate empty local directories using those
identities and project `meridian`; never use the old writer Job or instance:

```sh
northflank download job file \
  --projectId meridian \
  --jobId "$PAIRED_MAINTENANCE_JOB_ID" \
  --instanceName "$PAIRED_MAINTENANCE_INSTANCE_NAME" \
  --remotePath "/tmp/spot-paper-paired-package/btc-eur-paired-host-8h-001.tar" \
  --localPath "$EMPTY_ARCHIVE_DIRECTORY"
northflank download job file \
  --projectId meridian \
  --jobId "$PAIRED_MAINTENANCE_JOB_ID" \
  --instanceName "$PAIRED_MAINTENANCE_INSTANCE_NAME" \
  --remotePath "/tmp/spot-paper-paired-package/btc-eur-paired-host-8h-001.manifest.json" \
  --localPath "$EMPTY_MANIFEST_DIRECTORY"
```

Verify the archive SHA-256 reported by `package`, then validate every archive
member against the manifest before extraction using the existing bounded
post-run validation procedure. Preserve the source volume and archive unchanged.
Assessment is offline and separate; `PACKAGED_BYTES_ONLY` is not a valid,
complete, or ready result. Any interrupted, oversized, corrupt, or ambiguous
evidence remains `UNKNOWN`/incomplete and must not be retried or rewritten.
