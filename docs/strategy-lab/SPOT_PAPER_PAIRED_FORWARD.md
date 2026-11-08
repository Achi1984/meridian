# BTC/EUR paired shared-feed forward adapter

**Status: actual-export synthetic integration passes against merged #1299;
production launch remains blocked and no launch/readiness claim is made.** The
reviewed #1299 source `adf5c0a6e7b7d93bfd106dd6136c40a8e15a6373` is merged to
`main` at `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`. Its exports are
`createEntryConfirmationState`,
`advanceEntryConfirmation`, `recordEntryConfirmationSell`, and
`compareSpotPaperStrategies`. The multi-cycle test binds these actual exports
from this checkout; no strategy simulator, temporary overlay, or mock comparison
engine is used. This verifies synthetic integration only, not live acceptance or
operational readiness. The accepted research-source pin remains `null` until
Lead accepts the integrated adapter.

## Frozen experiment contract

The eventual comparison is three independent EUR 1,000 accounts on the same
BTC/EUR observations:

| Arm | Frozen model | Account treatment |
| --- | --- | --- |
| Baseline | `BTC_EUR_SMA5_SMA20_V1` | Existing SMA(5/20) parser, ledger and risk calculations |
| Challenger | `BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1` | Must bind the accepted #1299 exports; no implementation is copied here |
| Control | `CASH_CONTROL_V1` | EUR 1,000 cash, no strategy decisions, exposure, or fills |

The per-arm account contract is EUR 1,000 initial cash, at most EUR 100 entry,
no leverage or short positions, existing sampled 2% stop, and EUR 20 loss
limit. The common modeled costs remain 50 bp fee and 10 bp adverse slippage per
side. These cost values are assumptions, not verified Kraken rates. The adapter
does not tune, validate, or change them.

The hard run limits are eight hours, 480 cycles, 960 total public requests
across the entire run (including warmup), 64 MiB total response bytes, 256 KiB
per response, five-second request timeouts, 10-second ticker freshness,
120-second closed-candle freshness, and at least 60 seconds between cycle
starts. Each cycle gets one OHLC response and one shared ticker response,
regardless of the number of arms. Decision callbacks for all three arms finish
before the ticker request begins. The existing Kraken parsers and baseline
strategy preserve closed-candle, startup/warmup, backfill, and no-catch-up
semantics.

## Adapter boundary and current blocker

`scripts/spot-paper-paired/forward.mjs` reuses
`scripts/spot-paper-pilot/core.mjs` for Kraken response parsing and the
unchanged baseline ledger/risk calculation, and
`scripts/spot-paper-pilot/journal.mjs` for exclusive run creation, checksummed
response persistence, and durable event publication.
`scripts/spot-paper-paired/feed.mjs` wraps the existing fixed public Kraken
provider for `XBTEUR`; the runner rejects providers without its source identity.
Constructing the provider is inert; network requests begin only when the live
runner is invoked after source-pin validation. The adapter exposes the baseline
and cash-control arms and the challenger export binder; it does not provide a
challenger implementation.

The live entrypoint reads and hashes the two #1299 source files, checks them
against the accepted source pin, then imports the exact challenger exports and
comparison function from those paths. It builds the challenger arm from
`createEntryConfirmationState`, `advanceEntryConfirmation`, and
`recordEntryConfirmationSell`, and binds `compareSpotPaperStrategies` under
`SPOT_PAPER_SMA_COMPARISON_V1`. That arm reuses the existing baseline ledger
for fills, fees, and risk. The comparison replay receives the raw, persisted
shared-observation inputs; it is not replaced by a new comparison engine.
The live entrypoint creates only the fixed public Kraken provider after the
source pin passes; caller-supplied providers, strategies, and comparison
engines are rejected or ignored. Until the accepted #1299 source is present and
bound by the pinned digest, production execution is blocked. The local host
composition CLI is under `scripts/spot-paper-paired/host.mjs`; it makes no
deployment changes and does not bypass this gate.

The live `runSpotPaperPaired` entrypoint is additionally fail-closed while
`SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256` is `null`; it requires the
exact accepted research-source digest before it can create an evidence path or
request data. The separate `runSpotPaperPairedSynthetic` path accepts only the
`SYNTHETIC_TEST_ONLY` feed identity and labels its report `testOnly`. It cannot
be used as a live-feed substitute or evidence of integration.

After Lead accepts this paired integration, calculate the production source pin
from the merged #1299 research exports with this deterministic command (run
from the repository root; path names are included in the hash):

```sh
node --input-type=module -e '
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const paths = ["scripts/spot-paper-research/comparison.mjs", "scripts/spot-paper-research/entry-confirmation.mjs"].sort();
const hash = createHash("sha256");
for (const path of paths) {
  hash.update(path); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
}
console.log(hash.digest("hex"));
'
```

Only the lead-reviewed digest from the accepted/merged commit may replace the
current `null` source pin. The reviewed candidate source is sufficient for
isolated synthetic testing, not permission to set the production pin.

For every accepted observation the journal records one causally ordered shared
OHLC/ticker pair and separate arm decisions, fills, risk states and valuations.
An arm-specific stop latches trading off for that arm but continues preserving
its account state without invoking later decision or effect callbacks. The original
stop reason and effect timestamp remain attached to that account; later quotes
cannot trigger a sell or other fill. A separate valuation clone reuses
`applyPaperObservation` with entries and stop exits disabled, asserts no fills and
unchanged inventory, and stores only the new mark; the stopped trading ledger is
never mutated. It does not fabricate a liquidation. A common-horizon value is
available only when that position has a valid mark at the shared horizon;
otherwise remaining marked equity and the comparison result are unknown, not
compared against a stale mark.
Terminal summaries and the replay use the final shared observation's `effectAt`
as their stated horizon; the report separately records whether that quote was
still fresh when terminal persistence began.
Reports carry costs, net/marked
equity, sampled drawdown from starting capital, exposure, turnover, open
positions, unresolved observations, and the shared-horizon status. The cash
control is not evidence of alpha; fewer challenger trades alone do not show
improvement.

Each persisted shared observation and replay input carries distinct `decisionAt`
and `effectAt` timestamps; legacy replay `at` is the effect-time alias. The
reviewed candidate accepts `decisionAt` for cooldown decisions and allows up to
720 candles per snapshot. The actual-export test uses a provider-shaped 32-row
snapshot over 480 shared cycles, actual buys and sells, and a cooldown-expiry
boundary where `decisionAt < cooldownUntil <= ticker.receivedAt`. It verifies
fills, costs, common-horizon equity, trading-stop timestamps, valuation
timestamps, and stopped open inventory against the actual comparison output.
Stopped accounts keep their account ledger and stop metadata unchanged; a
mark-only clone of the existing ledger calculation updates valuation at each
shared quote without recording fills or modifying inventory. The comparator
uses the same mark-only rule. Any account/replay mismatch makes the comparison
unavailable rather than publishing an unrelated replay as the executed ledger.

Any invalid/stale/future/pre-decision quote or shared-feed error stops the
paired run. Ambiguous journal writes are terminal unknown and must not be
retried, resumed, or overwritten. A caller/operator stop is recorded as
interrupted, never as a completed eight-hour run. There is no auto-promotion,
authenticated provider, order, wallet, or real-execution path.

For a future approved run, the retrieval sequence is: independently confirm
the writer is stopped; inspect status/report read-only; preserve the complete
new run directory, including incomplete or corrupt files; package the directory
and manifest with bounded byte-preserving tooling; retrieve both files using the
separately approved host's native download path; verify archive and member
hashes; then perform an offline assessment against independently reviewed
source/config/evidence identities. Never repair, delete, resume, or overwrite
ambiguous evidence. Do not apply the old runbook's fixed run/image/volume
identifiers to a paired run.

## Offline validation command

Run the focused acceptance suite from the repository root:

```sh
node --test test/spot-paper-paired-forward.test.js
```

The synthetic contract tests use an in-memory feed and make no network or order
calls. The actual-export integration test imports the merged research sources
from the checkout and does not depend on the production accepted-source pin.
It exercises 480 cycles, provider-shaped long snapshots, buys and sells, the
decision/quote cooldown boundary, stopped inventory valuation, and replay-to-
forward account reconciliation.

## Lead review identity and future host work

The host CLI has a fail-closed run command, read-only status/report/export
commands, and bounded byte-preserving packaging. No run was launched. Lead
review must bind all of the following
before any separate operating approval:

| Identity | Required review value |
| --- | --- |
| Source | Exact reviewed commit and SHA-256 identity of the packaged adapter, baseline, accepted challenger and comparison sources |
| Image | Immutable image digest built from that exact reviewed source; not a moving tag |
| Research pin | Exact accepted #1299 research-source SHA-256 pinned in `SPOT_PAPER_PAIRED_ACCEPTED_RESEARCH_SOURCE_SHA256` |
| Configuration | SHA-256 of the frozen three-arm BTC/EUR configuration, feed source, bounds, account IDs, research pin, and explicit cost assumptions |
| Evidence | A fresh run ID and previously nonexistent evidence path; the journal manifest binds source/config hashes, models, accounts, run limits, and comparison-engine ID |
| Model/export binding | Accepted #1299 challenger model and comparison-engine exports, including their reviewed source identities |

No values for the future image, accepted #1299 source, frozen paired
configuration, or evidence run are assigned here. Do not reuse
`btc-eur-paper-host-8h-001`, its image, its evidence directory, or its volume.
That stopped run and its existing evidence remain untouched; its captured
snapshot is development evidence, not untouched validation.

The minimal host composition and concrete local commands are now in
`scripts/spot-paper-paired/host.mjs`:

```sh
node scripts/spot-paper-paired/host.mjs disabled
node scripts/spot-paper-paired/host.mjs run --data-root /evidence-root --run-id <new-unique-run-id>
node scripts/spot-paper-paired/host.mjs status --data-root /evidence-root --run-id <run-id>
node scripts/spot-paper-paired/host.mjs report --data-root /evidence-root --run-id <run-id>
node scripts/spot-paper-paired/host.mjs export --data-root /evidence-root --run-id <run-id>
node scripts/spot-paper-paired/host.mjs package --data-root /evidence-root --run-id <run-id> --archive /tmp/<run-id>.tar --manifest /tmp/<run-id>.manifest.json --retrieval-window-ms 300000
```

The `run` command requires an existing absolute evidence root, a fresh run ID,
and rejects an existing output path. It computes the source/config identities
from frozen defaults and maps SIGTERM to the runner's `AbortSignal`; today it
fails closed with `RESEARCH_INTEGRATION_NOT_ACCEPTED` before network access
because the production pin is null. The other commands are read-only except
`package`, which exclusively creates outputs via the existing verified
`packageHostEvidence` helper, refuses writer-lock/pending state, and holds the
maintenance process open for the requested retrieval window. They do not verify
that a remote writer process has stopped: an operator must independently verify
terminal state before running inspection/package on a mounted evidence volume.

`export` emits one bounded `SPOT_PAPER_PAIRED_HOST_EXPORT_V1` JSON object with
top-level `status`, `verifiedTerminal`, `reconciliationStatus`, `report`, and
`journal`. `report` is the standalone `SPOT_PAPER_PAIRED_REPORT_V1` terminal
report (or `null` when no terminal report exists). `journal` is the validated
`readRunJournal` payload, including `manifest`, ordered `events`, and its
`reconciliationStatus`; the terminal event's report must equal the top-level
report. The export has no host filesystem path and is capped at twice the
8 MiB journal limit. Consumers should preserve the original packaged evidence
as well: this JSON export is a read-only structural view, not a byte-exact
journal copy or independent authentication. A non-verified status remains
non-verified in the export and must not be relabeled as complete.

The paired terminal report's consumer-facing fields are `runId`, `pair`,
`models`, `sourceSha256`, `configSha256`, `researchSourceSha256`,
`integrationStatus`, `outcome`, `stopReason`, `startedAt`, `endedAt`,
`elapsedMs`, `coverage`, `cycles`, `requests`, `deliveredBytes`,
`commonHorizon`, `assumptions`, `arms`, and `comparison`. Each arm exposes
`role`, `modelId`, `accountId`, `tradingStatus`, `stopReason`, `stoppedAt`,
`decisions`, `fills`, `riskStates`, and `valuation`. Decision summaries omit
their per-cycle internal `state` snapshots; complete causal decisions and
structured account state remain in journal events/checkpoints, avoiding an
O(cycles²) duplicate in the terminal report. Valuation includes
`feesCents`, `slippageCents`, `modeledCostsCents`, `netEquityCents`,
`markedEquityCents`, `sampledDrawdownCents`, `exposureCents`, `turnoverCents`,
`openPositions`, `unresolvedObservations`, and `markAgeMs`. Comparison arm
state distinguishes `tradingStoppedAt` from `valuationAt`. These are canonical
producer fields; dashboard consumers should map them through the shared #1302
DTO rather than inventing a parallel report schema. `elapsedMs` is a finite
monotonic duration and may be fractional; consumers must not require integer
milliseconds.

The canonical report-evaluation chain uses these two host commands and passes
only the helper-validated journal payload to the #1304 evaluator:

```sh
node scripts/spot-paper-paired/host.mjs report \
  --data-root "$PAIRED_DATA_ROOT" --run-id "$PAIRED_RUN_ID" \
  > "$STAGE/report-wrapper.json"
node scripts/spot-paper-paired/host.mjs export \
  --data-root "$PAIRED_DATA_ROOT" --run-id "$PAIRED_RUN_ID" \
  > "$STAGE/paired-export.json"
node --input-type=module -e '
import {isDeepStrictEqual} from "node:util";
import {readFile, writeFile} from "node:fs/promises";
const [reportPath, exportPath, journalPath] = process.argv.slice(1);
const [report, paired] = await Promise.all([
  readFile(reportPath, "utf8").then(JSON.parse),
  readFile(exportPath, "utf8").then(JSON.parse)
]);
if (report.schemaVersion !== "SPOT_PAPER_PAIRED_HOST_STATUS_V1" ||
    report.status !== "TERMINAL_JOURNAL_VERIFIED" ||
    report.verifiedTerminal !== true ||
    paired.schemaVersion !== "SPOT_PAPER_PAIRED_HOST_EXPORT_V1" ||
    paired.status !== report.status || paired.verifiedTerminal !== true ||
    paired.reconciliationStatus !== "READ_ONLY_VERIFIED" ||
    !isDeepStrictEqual(report.report, paired.report) ||
    !isDeepStrictEqual(report.report, paired.journal?.events?.at(-1)?.report) ||
    paired.journal?.reconciliationStatus !== paired.reconciliationStatus) {
  throw new Error("PAIRED_EXPORT_NOT_RECONCILED");
}
await writeFile(journalPath, `${JSON.stringify(paired.journal)}\n`,
  {flag: "wx", mode: 0o600});
' "$STAGE/report-wrapper.json" "$STAGE/paired-export.json" \
  "$STAGE/journal-export.json"
node scripts/spot-paper-paired-report/cli.mjs \
  "$EXPECTED_IDENTITY_JSON" "$STAGE/report-wrapper.json" \
  "$STAGE/journal-export.json"
```

Run this only after independently confirming the writer is stopped. The
extraction writes no reconciliation marker; it checks that report and export
agree and preserves the exact helper-produced journal payload/status. The
evaluator still independently checks expected identity, journal reconciliation,
terminal report/checkpoint, and accounting, and labels its result structural,
not independently authenticated.

For Northflank retrieval, use a separately reviewed maintenance Job with the
evidence volume mounted read-only and the exact `node` host command above; use
the maintenance Job ID and exact instance name returned by that run, never the
old writer's identity. Download both `/tmp/<run-id>.tar` and
`/tmp/<run-id>.manifest.json` with `northflank download job file` into separate
empty local directories; for example:

```sh
set -euo pipefail
umask 077
: "${PAIRED_RUN_ID:?set the new paired run ID}"
: "${PAIRED_MAINTENANCE_JOB_ID:?set the separate maintenance Job ID}"
: "${PAIRED_MAINTENANCE_INSTANCE_NAME:?set the exact maintenance instance name}"
: "${EXPECTED_ARCHIVE_SHA256:?set archiveSha256 from this package result}"
stage="$(mktemp -d)"
mkdir "$stage/archive" "$stage/manifest"
northflank download job file \
  --projectId meridian \
  --jobId "$PAIRED_MAINTENANCE_JOB_ID" \
  --instanceName "$PAIRED_MAINTENANCE_INSTANCE_NAME" \
  --remotePath "/tmp/${PAIRED_RUN_ID}.tar" \
  --localPath "$stage/archive"
northflank download job file \
  --projectId meridian \
  --jobId "$PAIRED_MAINTENANCE_JOB_ID" \
  --instanceName "$PAIRED_MAINTENANCE_INSTANCE_NAME" \
  --remotePath "/tmp/${PAIRED_RUN_ID}.manifest.json" \
  --localPath "$stage/manifest"
printf '%s  %s\n' "$EXPECTED_ARCHIVE_SHA256" \
  "$stage/archive/${PAIRED_RUN_ID}.tar" | sha256sum -c -
```

Validate every archive member against the downloaded manifest before
extraction, using the bounded Python/TAR validation sequence in the linked
post-run runbook. Give the one-shot maintenance process one attempt, no
schedule/restart/retry, at least 84 MiB temporary storage, and a 390-second
external timeout (60-second package budget + 300-second retrieval hold + 30-second
exit margin). The package helper enforces the 60-second cooperative package
bound, 84 MiB archive ceiling, exclusive new outputs and byte-exact round-trip
verification. Never reuse
`btc-eur-paper-host-8h-001`, its image, volume or evidence. No deployment or
host-provider mutation is part of this change.

The 480-cycle synthetic run against actual #1299 exports measured these bytes
for one provider-shaped fixture (not a theoretical maximum):

| Artifact | Measured | Existing bound |
| --- | ---: | ---: |
| Persisted `journal.json` | 1,627,285 | 8 MiB |
| `readRunJournal` export payload | 1,627,241 | 16 MiB evaluator input |
| Standalone terminal report | 279,371 | 8 MiB evaluator input |
| Host `report` wrapper | 279,688 | 8 MiB evaluator input |
| Combined host `export` | 1,906,788 | 16 MiB |
| Byte-preserving evidence archive | 4,319,232 | 84 MiB |

This measured reduction comes from omitting each decision's cumulative internal
account `state` snapshot from the terminal report; causal decisions, risk,
fills, valuations, and structured state remain in journal events/checkpoints.
The same test runs host `report`, `export`, and `package` on that 480-cycle
evidence. The candidate #1304 file CLI evaluated these report/export artifacts
as `VERIFIED_COMPLETE`; a separate operator-interrupted synthetic fixture
remained `INTERRUPTED` with unavailable deltas. The evaluator was composed
temporarily from candidate `1feea98a1fd2c602fccb1824c71d19e253c28376`; this is
cross-PR synthetic compatibility validation, not a dependency pin or live
acceptance. The paired adapter/research identities were based on adapter
candidate `bb00a41f3eb65ece13ec0cfcb54b02ef710edb01` and #1299 reviewed source
`adf5c0a6e7b7d93bfd106dd6136c40a8e15a6373` (merged as
`4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`). These synthetic and host-helper
tests do not establish live acceptance or readiness. The production pin remains
`null`.
The existing
[BTC/EUR post-run retrieval runbook](../operations/BTC_EUR_8H_POSTRUN_20261108.md)
describes that sequence for the old run identity only; it is not approval or
identity for a new paired run. If a future run is interrupted or evidence is
ambiguous, preserve it and report the incomplete/unknown outcome rather than
restarting.
