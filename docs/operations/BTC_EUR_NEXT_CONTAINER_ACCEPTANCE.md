# BTC/EUR next-paper container acceptance

## Result and pinned source

Container acceptance passed locally against the latest reviewed #1319 candidate
available for this run, source commit
`756089261b82d69451ae00215a85edcf8c7744d3`. This includes the trend activity
count reconciliation correction. The build used an isolated detached worktree;
no #1319 implementation files, host settings, or existing stopped-run evidence
were modified. These checks do not start a feed, launch a host, or establish
deployment readiness.

| Build identity | Value |
| --- | --- |
| Candidate source commit | `756089261b82d69451ae00215a85edcf8c7744d3` |
| Dockerfile SHA-256 | `4c279e7463c682a09c8d3a99fe5a739c82efd4d9fa2c060cd49813418b4f3f0c` |
| Base image | `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293` |
| Local tag | `meridian-spot-paper-paired-acceptance:756089261b82` |
| Local image ID | `sha256:244f46781691323326be3d2fab3fb2e24d52bc5dc84d96b5fc3d2883fb226230` |
| Registry digest | None; image was not pushed |
| Accepted three-source research digest | `dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25` |

The local image ID is not a remotely deployed immutable image reference. Before
any launch, build from the exact final reviewed source SHA, complete this
acceptance on that image, and obtain an approved registry
`repository@sha256:...` digest. Rebuild and revalidate if any packaged source
changes.

## Commands and observed results

The reproducible entrypoint requires a checkout of the specific source commit.
It builds that checkout's `Dockerfile.spot-paper-paired` and runs every
container command with `--network none`. It requires an empty temporary
evidence directory and removes that fixture when complete:

```sh
node scripts/spot-paper-paired-acceptance/acceptance.mjs \
  --source-dir /tmp/meridian-1319-candidate \
  --source-sha 756089261b82d69451ae00215a85edcf8c7744d3
```

Observed on that commit:

- The default image command returned `DISABLED` / `NO_RUN_REQUESTED`; the
  identity-only command selected account contract
  `BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2` and model pair
  `BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1`.
- Source-side and in-container expected identities matched exactly:
  - host source SHA-256:
    `254ed820673074202041a4c4876f7d61eb3f9cd6d5f4af7765a69e1483cfff0a`
  - config SHA-256:
    `b3b33cc2e5cf77d2f98e547fc606e59ccb1bb508ee4508db5b5b79b459d78681`
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

All 56 focused tests passed, including the verified trend-activity exit-count
reconciliation regression. These are synthetic/offline tests. The committed
acceptance entrypoint performs the image build, container CLI checks, import
checks, identity comparison, and rejection checks above. No full repository
suite was repeated.

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
