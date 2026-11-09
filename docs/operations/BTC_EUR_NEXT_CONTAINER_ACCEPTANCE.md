# BTC/EUR next-paper container acceptance

## Result and pinned source

Container acceptance passed locally against the updated #1319 candidate source
commit `4097aa704c12749b72e568768a67ea6babfa5816`. The build context was a Git
archive of that exact commit; source-side identity was computed from the same
archive. Dirty and untracked checkout files cannot enter the image or expected
identity. No #1319 implementation files, host settings, or existing stopped-run
evidence were modified. These checks do not start a feed, launch a host, or
establish deployment readiness.

| Build identity | Value |
| --- | --- |
| Candidate source commit | `4097aa704c12749b72e568768a67ea6babfa5816` |
| Exact Git archive SHA-256 | `82e839cf5f7f88ea476a3502209952b50baee1576e22b9d072bc4e814e264faa` |
| Dockerfile SHA-256 | `4c279e7463c682a09c8d3a99fe5a739c82efd4d9fa2c060cd49813418b4f3f0c` |
| Dockerfile base reference | `node:20-alpine` (mutable tag) |
| Resolved base image digest | Unknown; not captured in local image metadata |
| Local tag | `meridian-spot-paper-paired-acceptance:4097aa704c12` |
| Local image ID | `sha256:9bfde1a6b169b8c4e6427fb46fe6c1c53507feac96b6b0d08bee09f326256d69` |
| Registry digest | None; image was not pushed |
| Accepted three-source research digest | `dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25` |

The base-image digest is deliberately reported as unknown: this Dockerfile uses
a mutable tag and the local build did not retain provenance sufficient to bind
the resolved base digest. Resolve and pin the base or capture authoritative
build provenance for the final deployment build. The local image ID is not a
remotely deployed immutable image reference. Before any launch, build from the
exact final reviewed source SHA, complete this acceptance on that image, and
obtain an approved registry `repository@sha256:...` digest. Rebuild and
revalidate if any packaged source changes.

## Commands and observed results

The reproducible entrypoint requires a Git repository containing the requested
commit. It creates a clean `git archive` build context from that commit (not the
mutable worktree), computes source-side identity from the archive, and runs all
container commands by inspected image ID with `--network none`. It requires an
empty temporary evidence directory and removes the fixture when complete:

```sh
node scripts/spot-paper-paired-acceptance/acceptance.mjs \
  --source-dir /tmp/meridian-1319-final \
  --source-sha 4097aa704c12749b72e568768a67ea6babfa5816
```

Observed on that commit:

- The exact-source archive hash was
  `82e839cf5f7f88ea476a3502209952b50baee1576e22b9d072bc4e814e264faa`; the
  inspected local image ID was
  `sha256:9bfde1a6b169b8c4e6427fb46fe6c1c53507feac96b6b0d08bee09f326256d69`.
  The default image command returned `DISABLED` / `NO_RUN_REQUESTED`; the
  identity-only command selected account contract
  `BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2` and model pair
  `BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1`.
- Source-side and in-container expected identities matched exactly:
  - host source SHA-256:
    `68924929a3f2079697dc291ea7e79619cd1bbe87839462fd4694ffabc31b9232`
  - config SHA-256:
    `cd7c1ca3dde11eeb4cbc8f4790355d04a5bb7a117712de8f96e52a9ac7d237ff`
  - research source SHA-256:
    `dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25`
- All 15 required host, paired-runner, report/evaluator, and research modules
  were present in the image and imported successfully.
- The temporary evidence root remained empty after default and identity
  commands; no journal/run directory was created.
- Unknown model pair, unknown account contract, model-pair/account mismatch,
  malformed model-pair argument, and an existing evidence path were rejected.
  The existing-path sentinel remained unchanged.
- The image runs as `node`. The inspected image has no registry digest; no
  network data, credentials, or live-feed invocation were used.

Focused source suites, run from the pinned candidate checkout:

```sh
node --test test/spot-paper-paired-host.test.js \
  test/spot-paper-paired-image.test.js \
  test/spot-paper-paired-next-run-composition.test.js \
  test/spot-paper-paired-forward.test.js \
  test/spot-paper-paired-report.test.js
```

The final #1319 focused source suites passed **56/56**, including the verified
trend-activity exit-count reconciliation regression. The added archive
regression passed **1/1**, proving dirty tracked and untracked checkout files
are excluded from the build context. These tests are synthetic/offline. No full
repository suite was repeated.

## Northflank handoff — do not launch from this record

The candidate establishes the prepared selection and launch bounds, not an
approved deployment. Lead must supply the fresh run ID and evidence-volume ID
at launch; do not reuse the stopped run ID/volume. The local image tag above is
not deployable. Use only the approved project `meridian` and the approved
registry digest after it exists:

| Northflank setting | Required value |
| --- | --- |
| Project | Existing `meridian` project |
| Image | Approved immutable `repository@sha256:...` for the final accepted source SHA |
| Job | New unscheduled one-shot job; one instance/attempt; retry count `0`; restart `Never` |
| Evidence | Fresh separate durable volume ID supplied at launch; mount read/write at `/evidence-root`; writable by image user `node` (UID 1000) |
| Runtime bounds | Existing 8 hours, 480 cycles, 960 shared public requests; retain existing byte, response, request-timeout, and cadence bounds |
| External timeout / termination grace | `8h 2m` / `60s` |
| Credentials | None |

Supply a fresh unique `RUN_ID` and `EVIDENCE_VOLUME_ID`; mount that new volume at
`/evidence-root`. Set the container arguments exactly to:

```json
[
  "run",
  "--data-root",
  "/evidence-root",
  "--run-id",
  "<fresh RUN_ID>",
  "--account-contract",
  "BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2",
  "--model-pair",
  "BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1"
]
```

Use the image entrypoint unchanged. Do not schedule, retry, restart, resume, or
extend the existing bounds. Preserve the stopped-run evidence and its volume.
Before launch, Lead must independently verify the approved immutable image
digest, fresh volume identity and unprivileged writability, final source pin,
and launch authorization. This task did not provision, configure, or start a
Northflank job.
