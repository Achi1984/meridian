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

Supply the standalone report JSON and the read-only export produced from
`readRunJournal` (the returned journal payload plus `reconciliationStatus`).
The evaluator checks regular, non-symlink files with these byte limits:
16 KiB expected identity, 1 MiB report, and 16 MiB journal export. It performs
no writes. From the repository root, run:

```sh
node scripts/spot-paper-paired-report/cli.mjs \
  /absolute/path/expected-identity.json \
  /absolute/path/report.json \
  /absolute/path/journal-export.json
```

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

Run the focused synthetic contract suite:

```sh
node --test test/spot-paper-paired-report.test.js
```

Fixtures are synthetic and labelled `testOnly`; they validate this projection
and fail-closed behavior, not a strategy result or accepted live integration.
The report contract was checked against draft PR #1301 at candidate
`1cc81a56840668308d07a17478dc7d640fa25a8b`. Actual research-export integration
is not complete: the reviewed #1299 candidate
`adf5c0a6e7b7d93bfd106dd6136c40a8e15a6373` requires
`advanceEntryConfirmation(..., {decisionAt, held})`, while the inspected #1301
candidate still calls it with `nowMs`. Its production source pin remains null.
The incompatible candidate cannot produce valid multi-cycle actual-export
evidence, so no stub comparison is described as integration acceptance. Once
the #1301 adapter binds the reviewed API and its actual-export cooldown,
multi-cycle, stop, and account-reconciliation tests pass, run the evaluator
against that candidate's real generated report and `readRunJournal` export.
