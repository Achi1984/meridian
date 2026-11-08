# Offline paired-paper dashboard report

This package is an offline, read-only consumer for the `#1301`
`SPOT_PAPER_PAIRED_REPORT_V1` report and `SPOT_PAPER_PILOT_JOURNAL_V1`
journal export. It does not retrieve provider data, access a host, repair
evidence, change a production source pin, launch a run, or make a promotion
decision.

## Shared browser-safe DTO

The UI contract is exported from
[`scripts/spot-paper-paired-report/contract.mjs`](../../scripts/spot-paper-paired-report/contract.mjs).
Dashboard code should import `SPOT_PAPER_PAIRED_DASHBOARD_SCHEMA` and
`projectSpotPaperPairedDashboard`; it should not define a parallel DTO.
`sanitizeSpotPaperPairedDashboardDto` is also exported for validation at a UI
boundary. The projector returns only this minimal shape:

```text
{
  schemaVersion, evidenceStatus, evidenceQualification, reasonCode,
  syntheticFixture, independentAuthentication,
  identity: {
    runId, pair, sourceSha256, configSha256, researchSourceSha256,
    models: [{role, modelId}]                 // baseline, challenger, cash
  },
  timing: {
    requestedDurationMs, observedCoverageMs, actualElapsedMs,
    runStoppedAt, valuationAt, requestedCycles, attemptedCycles,
    completedCycles, stopReason
  },
  assumptions: {feeBpsPerSide, slippageBpsPerSide, ratesVerified},
  arms: {
    baseline|challenger|cash: {
      role, modelId, tradingStoppedAt, stopReason, inventoryStatus,
      cashCents, netEquityCents, netPnlCents, bookedFeesCents,
      modeledSlippageCents, hypotheticalExitFeeCents,
      hypotheticalExitSlippageCents, turnoverCents, fillCount,
      exposureCents, sampledDrawdownCents, relativeDrawdownBps,
      unresolvedObservations, metricReasons
    }
  },
  deltas: {
    status, reason,
    challengerMinusBaseline: {status, reason, netEquityCents, netPnlCents},
    baselineMinusCash:       {status, reason, netEquityCents, netPnlCents},
    challengerMinusCash:     {status, reason, netEquityCents, netPnlCents}
  },
  decision: "NO_WINNER_OR_PROMOTION"
}
```

Metric amounts are integer EUR cents; relative drawdown, when available, is
basis points. Missing or non-comparable values are `null` with a
`metricReasons` entry. `cashCents` is not present for the trading arms in the
paired report v1 and therefore remains null; the cash control's cash is shown
only when its no-trade ledger reconciles. The paired report's net equity
already reflects booked fees and modeled execution effects. Net PnL is
`netEquityCents - startingCapitalCents`; neither booked fees nor slippage are
deducted again. The v1 report contains no hypothetical exit-cost fields, so
these stay null with `NOT_REPORTED_BY_REPORT_SCHEMA`.

The status values are `VERIFIED_COMPLETE`, `INTERRUPTED`, `RUNNING_SNAPSHOT`,
and `CORRUPT_UNKNOWN`. “Verified” means bounded structural, identity,
accounting, and journal/report reconciliation only. Every DTO states
`independentAuthentication: "NOT_ESTABLISHED"`:
report/journal checksums and self-declared source/config hashes do not
independently authenticate the producer or prove the expected identity was
reviewed. A running snapshot is never final evidence. Since the current
`readRunJournal` output combines active and interrupted writers as
`UNKNOWN_WRITER_OR_INTERRUPTED`, a running label requires an explicit
`snapshotStatus: "RUNNING_SNAPSHOT"` in the supplied export; absent that
distinction the evaluator fails closed as unknown.
For a running snapshot, completed cycles count journaled shared observations;
attempted cycles stay null because the journal checkpoint has no live attempt
counter.

## Expected identity and local evaluation

Prepare an `SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1` JSON file from the lead
reviewed run/config packet. It must contain exactly the identity values to bind:
`runId`, `pair`, `sourceSha256`, `configSha256`, `researchSourceSha256`,
`feedSourceId`, `comparisonEngineId`, and three ordered `models` entries with
`role`, `modelId`, and `accountId`. Do not populate it from an unreviewed
report. Account IDs are used only for matching and are excluded from the DTO.

Supply the report JSON and read-only journal export. The #1301 `report` command
emits a `SPOT_PAPER_PAIRED_HOST_STATUS_V1` wrapper; pass it directly as the
report input. To produce the journal export without editing or asserting status
fields, use the evaluator's bounded read-only export command on the same
evidence directory:

```sh
node scripts/spot-paper-paired/host.mjs report \
  --data-root /absolute/path/evidence-root --run-id "$RUN_ID" \
  > /absolute/path/report-wrapper.json
node scripts/spot-paper-paired-report/cli.mjs export-journal \
  /absolute/path/evidence-root "$RUN_ID" \
  > /absolute/path/journal-export.json
node scripts/spot-paper-paired-report/cli.mjs \
  /absolute/path/expected-identity.json \
  /absolute/path/report-wrapper.json \
  /absolute/path/journal-export.json
```

`export-journal` calls the existing `readRunJournal` helper with bounded,
symlink-rejecting reads; it writes only its JSON result to stdout. It does not
modify the evidence tree or claim that a writer is stopped. A host wrapper's
`verifiedTerminal` boolean is not independently trusted: terminal acceptance
requires the exported journal's read-only reconciliation status and exact
terminal report/checkpoint match as well. A host status with a writer lock is
projected as `RUNNING_SNAPSHOT`, never final evidence.

The evaluator checks regular, non-symlink files with these byte limits:
16 KiB expected identity, 8 MiB report wrapper, and 16 MiB journal export. It
performs no writes.

The CLI prints only the sanitized DTO. An invalid or oversized input produces
`CORRUPT_UNKNOWN` and a nonzero exit; it never includes paths, provider bodies,
credentials, account IDs, raw failure details, or host identifiers in the
output. A journal export without the helper's read-only reconciliation status
cannot establish a complete terminal record. The evaluator checks the terminal
report copy, sequence, shared-observation count, checkpoint counters, checksums
when included, and the expected identity against both report and manifest.

The requested horizon is eight hours/480 cycles. `observedCoverageMs` ends at
the common valuation observation; `actualElapsedMs` and `runStoppedAt` describe
run termination, while each arm's `tradingStoppedAt` preserves its own stop.
`attemptedCycles` follows the producer counter; `completedCycles` counts
committed shared observations, so a failed final cycle is not counted as
completed.
`actualElapsedMs` preserves the producer's finite fractional
`performance.now()` duration without rounding; the eight-hour completion check
compares that raw value with the requested duration, so fractional values are
never rounded across the completion boundary.
These timestamps are intentionally distinct. Deltas are emitted only when the
research comparison is available at the same horizon and its account metrics
reconcile with all three forward-report accounts. A missing/stale open-position
mark makes that arm's common-horizon equity and deltas unavailable. No
statistical significance, alpha, ranking, or winner is inferred from one run.
Unfavourable and zero-fill results are retained.

The report declares 50 bp fees and 10 bp slippage per side as assumptions;
`ratesVerified` must remain false. Booked fees and modeled slippage are shown
separately from net equity. The evaluator does not add a hypothetical exit
cost to net PnL.

## Tests and integration limits

Run the focused contract suite:

```sh
node --test test/spot-paper-paired-report.test.js
```

Fixtures are synthetic and labelled `testOnly`; they validate this projection
and fail-closed behavior, not a strategy result or accepted live integration.
In an isolated temporary composition, #1301 candidate
`bb00a41f3eb65ece13ec0cfcb54b02ef710edb01` was run with actual #1299 exports
from merged commit `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`. Its synthetic
completed multi-cycle trade run and interrupted multi-cycle trade run were
passed through the real host report wrapper, this CLI's read-only journal
export command, and this file evaluator CLI; metrics and deltas reconciled.
No research simulator, hand-edited wrapper, or production source pin was used.
The host report wrapper's own 8 MiB journal bound means this validation used a
bounded 120-cycle run for file-CLI composition; the producer's separate
480-cycle actual-export/cooldown test also passed in the same isolated
candidate. Structural reconciliation is not independent authentication, live
acceptance, or readiness.
