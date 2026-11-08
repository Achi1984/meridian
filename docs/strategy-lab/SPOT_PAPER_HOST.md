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
