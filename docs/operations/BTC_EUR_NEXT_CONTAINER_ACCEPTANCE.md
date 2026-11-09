# BTC/EUR next-paper container acceptance

## Result and pinned source

The #1319 composition merged to main as
`c19c5d5a8f9492cd56cbe75f8446ea6d2663f096`. Its exact archived source passed a
local disabled/identity/import/rejection acceptance on that commit. That first
build used the then-mutable base tag, so it is superseded for deployment.

| Merged-main verification | Value |
| --- | --- |
| Source commit | `c19c5d5a8f9492cd56cbe75f8446ea6d2663f096` |
| Git archive SHA-256 | `97917966c9c81bdea38c878d8eba35d1ac2656bb9d5b209450413d9e586eabd4` |
| Local image ID (superseded, unpinned base) | `sha256:69a89da4e712073eddc0f848b033ed0d8c7ead65e2bb573ab82ec0012b57060a` |
| Host source SHA-256 | `68924929a3f2079697dc291ea7e79619cd1bbe87839462fd4694ffabc31b9232` |
| Config SHA-256 | `07824817f223106f1faa1d0c56c4e4406e53f2f79355ec6c418466c6bfd7f941` |

The final deployment-source acceptance passed on
`cbf5db1fefa49192f3243975b79d2a8a6585f6c9`, which contains the merged
composition and pins the base image by digest. The build context was a Git
archive of that exact source commit; source-side identity was computed from the
same archive. Dirty and untracked checkout files cannot enter the image or
expected identity. No market feed or host run was started; no Northflank
resource or existing stopped-run evidence was modified.

| Build identity | Value |
| --- | --- |
| Merged #1319 composition commit | `c19c5d5a8f9492cd56cbe75f8446ea6d2663f096` |
| Final deployment-source commit | `cbf5db1fefa49192f3243975b79d2a8a6585f6c9` |
| Exact Git archive SHA-256 | `6b60168d38ae1eb4d88e2d28a9711b5b085fba654f21e305b8e711360f2f0726` |
| Dockerfile SHA-256 | `cfa2455decf969ce37d3d8bc4985b5ac093933d05143a97af2f4dcf036539f21` |
| Pinned base reference | `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293` |
| Verified base image ID | `sha256:11cedc39e663e7c5d5cb9cc77a461a0d2adc25537b94e6831a6108f09cb2001b` |
| Base digest verification | Pulled digest matches image RepoDigest; final image rootfs layer ancestry matches pinned base |
| Local tag | `meridian-spot-paper-paired-acceptance:cbf5db1fefa4` |
| Local image ID | `sha256:4210460e7aa52e1a94627ca84c40b12a5d045e20cd738f5d581ccf677e2841ef` |
| Registry digest | None; image was not pushed |
| Accepted three-source research digest | `dc7be719198ff3c936354c75352dfb782eaece65761b4fb47ba5d3fc0f756e25` |

The Dockerfile now pins the resolved base manifest digest. Acceptance explicitly
pulls that digest, checks it against the local base image's RepoDigest, then
confirms the final image retains the base image's complete rootfs layer prefix.
The local image ID is still not a remotely deployed immutable image reference.
Before launch, publish only through the approved registry, record its immutable
`repository@sha256:...` digest, and configure Northflank with that digest.
Rebuild and revalidate if any packaged source changes.

## Commands and observed results

The reproducible entrypoint requires a Git repository containing the requested
commit. It creates a clean `git archive` build context from that commit (not the
mutable worktree), computes source-side identity from the archive, and runs all
container commands by inspected image ID with `--network none`. It requires an
empty temporary evidence directory and removes the fixture when complete:

```sh
node scripts/spot-paper-paired-acceptance/acceptance.mjs \
  --source-dir /home/runner/work/meridian/meridian \
  --source-sha cbf5db1fefa49192f3243975b79d2a8a6585f6c9
```

The merged composition commit `c19c5d5a8f9492cd56cbe75f8446ea6d2663f096` was
also tested directly before the Dockerfile base pin was added. The deployment
receipt below is from the later pinned-source commit, not from stale commits
`7560892` or `4097aa7`.

- The final exact-source archive hash was
  `6b60168d38ae1eb4d88e2d28a9711b5b085fba654f21e305b8e711360f2f0726`; the
  inspected local image ID was
  `sha256:4210460e7aa52e1a94627ca84c40b12a5d045e20cd738f5d581ccf677e2841ef`.
  The pinned base is
  `node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`;
  pulled image ID and rootfs layer ancestry were verified by the acceptance
  entrypoint.
  The default image command returned `DISABLED` / `NO_RUN_REQUESTED`; the
  identity-only command selected account contract
  `BTC_EUR_PAIRED_PAPER_EEA_SPOT_V2` and model pair
  `BTC_EUR_CONFIRM2_VS_5M_TREND_AND_CASH_V1`.
- Source-side and in-container expected identities matched exactly:
  - host source SHA-256:
    `68924929a3f2079697dc291ea7e79619cd1bbe87839462fd4694ffabc31b9232`
  - config SHA-256:
    `f8faa2080a14d67d92b1cee88dbdf3b77256b8bfa40dcec3c7017a63f7991cb7`
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
regression and pinned-Dockerfile guard brought the complete focused set to
**57/57**, proving dirty tracked and untracked checkout files
are excluded from the build context. The source identity matched exactly
between archive-side composition and container command. The default,
identity-only, imports, and invalid-selection/path checks ran with networking
disabled and did not create a run journal. These tests are synthetic/offline.
No full repository suite was repeated.

The merged #1319 composition passed Release Safety run `42670199776`
(`SUCCESS`, tested head `54647ef9b7ee8b0574550c085dddf1ff3a79b4f5`). On this
acceptance branch, run `42674276430` for source commit
`cbf5db1fefa49192f3243975b79d2a8a6585f6c9` was cancelled when the evidence
record commit superseded it. The current final-head Release Safety run is
`42674603529` for `e2b466d5419ea5f332aa10aff0abe437588ce32f`, observed
**in progress**; no final result is claimed.

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
