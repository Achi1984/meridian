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
  transportDiagnostic?: {
    schemaVersion, requestKind, phase, termination,
    attemptedCycle, requestCount, byteCount, requestBytes, elapsedMs
  },
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
reviewed. A writer lock is not process-liveness evidence: the host's
`WRITER_LOCK_PRESENT` export is projected as `CORRUPT_UNKNOWN` with
`UNKNOWN_WRITER_OR_INTERRUPTED`, never as running or interrupted. Only a
separately supplied, fresh liveness observation that is explicitly validated
could establish `RUNNING_SNAPSHOT`; the current host export supplies none.
Non-final snapshots expose at most the bounded count of committed shared
observations; attempted cycles and arm metrics remain null.

## Expected identity and local evaluation

Prepare an `SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1` JSON file from the lead
reviewed run/config packet. It must contain exactly the identity values to bind:
`runId`, `pair`, `sourceSha256`, `configSha256`, `researchSourceSha256`,
`feedSourceId`, `comparisonEngineId`, and three ordered `models` entries with
`role`, `modelId`, and `accountId`. Do not populate it from an unreviewed
report. Account IDs are used only for matching and are excluded from the DTO.

Use #1301's canonical combined `export` command. It emits one
`SPOT_PAPER_PAIRED_HOST_EXPORT_V1` object containing the report, read-only
journal payload, reconciliation result, and host status. Do not separately
reconstruct or edit those fields:

```sh
node scripts/spot-paper-paired/host.mjs export \
  --data-root /absolute/path/evidence-root --run-id "$RUN_ID" \
  > /absolute/path/host-export.json
node scripts/spot-paper-paired-report/cli.mjs \
  /absolute/path/expected-identity.json \
  /absolute/path/host-export.json
```

The evaluator independently checks the export's journal reconciliation status,
terminal report/checkpoint match, counters, shared observations, and identity;
the host's `verifiedTerminal` flag is not accepted as authentication. Its file
input is bounded at 16 MiB, matching the producer's combined-export bound. The
evaluator does not write or export evidence.

The host inspection cap remains 8 MiB for `journal.json`; the integrated
480-observation artifact fits within that explicit bound.

The CLI prints only the sanitized DTO. An invalid or oversized input produces
`CORRUPT_UNKNOWN` and a nonzero exit; it never includes paths, provider bodies,
credentials, account IDs, raw failure details, or host identifiers in the
output. An export without the read-only reconciliation status cannot establish
a complete terminal record. The evaluator checks the terminal report copy,
sequence, shared-observation count, checkpoint counters, checksums when
included, and the expected identity against both report and manifest.

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

An interrupted run caused by a request failure may include the optional
`SPOT_PAPER_PAIRED_TRANSPORT_DIAGNOSTIC_V1` extension. Its endpoint, request
phase (`HEADERS`, `BODY`, or `RESPONSE`), termination class
(`REQUEST_TIMEOUT`, `OUTER_TIMEOUT`, `CANCELLATION`, or `TRANSPORT_ERROR`),
attempted cycle, bounded request/byte counts, and elapsed time are checked
against the report and failure event. It contains no URL, response body,
credential, or free-form exception text. Historical reports without this
extension remain readable.

Historical V1 reports declare 50 bp fees and 10 bp slippage per side. The
explicit V2 next-run contract declares a 20 bp EEA spot-only taker assumption
and 10 bp slippage per side, with its version, source, and unknown account tier
included in report assumptions and the config digest. For both contracts,
`ratesVerified` remains false. Booked fees and modeled slippage are shown
separately from net equity. The evaluator does not add a hypothetical exit
cost to net PnL.

## Tests and integration limits

Run the focused contract suite:

```sh
node --test test/spot-paper-paired-report.test.js
```

Fixtures are synthetic and labelled `testOnly`; they validate this projection
and fail-closed behavior, not a strategy result or accepted live integration.
An earlier isolated composition used #1301 candidate
`bb00a41f3eb65ece13ec0cfcb54b02ef710edb01` with actual #1299 exports from
merged commit `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`; completed and
interrupted multi-cycle files passed through the evaluator, but its file-CLI
composition was shortened to 120 cycles. This is not acceptance of the
intended 480-cycle artifact. Current #1301 head `3308394a2bd1e9d3d022da48f90a246cb3a20546`
provides a single combined `export` command but caps journal inspection at
8 MiB. The updated #1301 head `5f25f771cd45dab41ec642660cce18cbdb324ef3`
removes redundant cumulative state from terminal decision summaries while
retaining causal decisions, risk, fills, valuations, and checkpoint evidence.
In an isolated composition of that exact producer with actual #1299 exports
from merged commit `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`, a 480-observation
run passed through the host's combined `export` and this file CLI as
`VERIFIED_COMPLETE:TERMINAL_REPORT_RECONCILED`. Measured bytes were: journal
1,627,285; read-only payload 1,627,241; standalone report 279,371; report
wrapper 279,688; compact combined export 1,906,788; pretty-printed host CLI
export consumed by this evaluator 3,541,918; packaged archive 4,319,232. The
host/export limits were unchanged. A two-cycle interrupted run using the same
actual research exports passed as
`INTERRUPTED:INTERRUPTED_TERMINAL_RECONCILED`.

Producer identity: #1301 `5f25f771cd45dab41ec642660cce18cbdb324ef3`;
research identity: merged #1299 `4f5c4a3c8489129c514cd57c4b71f37ee05bcddf`.
Evaluator source identities:
`evaluate.mjs` `b60f8cc455912df28c95f15b659e6b48374d6cedf7bebb87b7e32ac5cc97c3bc`,
`cli.mjs` `2df32fcb945495b10558d088ee1af86e0988a26c4fb07c978cedda0dd767f541`,
and `contract.mjs`
`70bb9780c9d62d6ae653122fddfbaac8b09c71382e104ef565ca6449cd97579d`.
No research simulator, hand-edited export, production source pin, or live run
was used. Structural reconciliation is not independent authentication, live
acceptance, or readiness.
