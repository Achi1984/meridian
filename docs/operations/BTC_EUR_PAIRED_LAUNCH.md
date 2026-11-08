# BTC/EUR paired-paper one-shot host launch

This is a prepared launch plan, not deployment or permission to run it. It does
not modify the existing spot-paper image, the stopped
`btc-eur-paper-host-8h-001` evidence, or its volume.

## Source and acceptance gates

The image packages the paired host from #1301, the baseline/shared-feed and
journal helpers it imports, and the reviewed #1299 research exports:

- #1299 research source: `adf5c0a6e7b7d93bfd106dd6136c40a8e15a6373`
- merged #1299 source commit: `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`
- #1301 source inspected for isolated composition: `3308394a2bd1e9d3d022da48f90a246cb3a20546`

At preparation time #1301 is still an open draft and these paired files are not
in this checkout. The Dockerfile must be built from a checkout updated after
#1301 is merged, not from this branch alone. Until then, only the temporary
composition recorded in the PR validation can be built. Require the merged
#1301 actual-export tests and final-head CI before accepting the image.

The production research pin in `scripts/spot-paper-paired/forward.mjs` must
remain `null` until Lead separately accepts the integrated adapter after those
tests. This image's default command is `disabled`; the explicit `run` command
currently fails closed with `RESEARCH_INTEGRATION_NOT_ACCEPTED` before feed
access. Do not edit the pin or treat this launch plan as authorization.

The image includes `status`, `report`, `export`, and byte-preserving `package`
commands from the paired host. It does not include or invoke the separate #1304
offline evaluator. Use that evaluator only from its separately reviewed,
compatible checkout after it is merged and after export integration passes.
There is no need to copy its modules into this image.

## Frozen run

| Setting | Value |
| --- | --- |
| Run ID | `btc-eur-paired-host-8h-001` |
| Pair and mode | `BTC/EUR`, paper only |
| Accounts | Three separate virtual accounts, EUR 1,000 each: baseline, challenger, cash control |
| Entry and position | Maximum EUR 100 entry per account; no leverage or short positions |
| Cost assumptions | 50 bp fee and 10 bp adverse slippage per side; modeled assumptions, not verified rates |
| Run bounds | Eight hours, 480 cycles, 960 shared public requests total |
| Existing data bounds | 64 MiB total response bytes, 256 KiB per response, five-second request timeout, at least 60 seconds between cycle starts |
| External deadline | 8 hours 2 minutes, with a 60-second termination grace period |
| Retry/restart | One attempt; no schedule, retries, restarts, or autoresume |

The host code stops at its eight-hour duration bound, bounds requests at five
seconds, and gives terminal/persistence journal operations five-second
deadlines. The external 8h02m timeout leaves two minutes beyond the internal
run bound for bounded completion and platform scheduling; allow the separate
60-second grace period after the platform sends SIGTERM. SIGTERM is delivered
directly to Node by the exec-form image entrypoint. Do not wrap it in a shell.

## Build and immutable image record

After #1301 is merged and the required tests pass, build from the exact reviewed
main commit. Use the already approved registry repository if one exists; its
name is not established by this change.

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

It must print `DISABLED`; it must not request feed data. Do not use a mutable tag
for the Northflank job. After an independently approved registry push, record
the full repository digest from `docker image inspect --format
'{{json .RepoDigests}}' "${IMAGE_TAG}"`, then configure the job with that exact
`repository@sha256:...` reference. This task does not push an image and no
registry path or image digest is available yet.

Record these immutable build and deployment identities in the launch approval:

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
they are available in that project. If either is unknown, stop for the owner;
this plan does not select or create new infrastructure identifiers.

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

This Job must not be created or launched until the source, research pin, image
digest, mount ownership, owner approval, and full-size export gate above are
independently accepted. The null research pin is a hard stop, not an operator
override.

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

`export` emits a bounded `SPOT_PAPER_PAIRED_HOST_EXPORT_V1` JSON document to
stdout, including report and validated journal payload. Capture and preserve
the complete output only if the platform returns it without truncation. An
incomplete export is not a valid evaluator input; retain the raw volume and
stop rather than reconstructing or editing evidence.

The #1301/#1304 full-480-cycle serialized-size and retrieval correction is
still a review gate. The current host uses an 8 MiB journal-inspection bound and
a 16 MiB export ceiling; neither alone demonstrates that a full run fits the
host, output transport, and evaluator together. Before accepting this image for
use, require measured 480-cycle journal, report, export, archive, and manifest
sizes, plus the complete host export-to-#1304 evaluator path and interrupted
evidence tests. Do not launch while that end-to-end correction is unresolved.

After that gate passes, run `package` as a separate read-only-volume
maintenance invocation. The host writes only in its pre-created
`/tmp/spot-paper-paired-package` directory, which is writable as `node`. Use a
390-second external timeout: 60 seconds for bounded packaging, the maximum
300-second native-download hold, and 30 seconds for exit. The helper also
enforces an 84 MiB archive ceiling. Exact arguments:

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
