# Paired EUR finalization runbook

This runbook uses the existing paired host exporter, evaluator, immutable
ingester, and authenticated read path. It does not retrieve host data itself,
change the host or its volume, provision configuration, or create a publication
endpoint.

## Evidence and identity boundary

The target run is `btc-eur-trend-host-8h-002`. Retrieve the independently
reviewed `SPOT_PAPER_PAIRED_EXPECTED_IDENTITY_V1` from PR #1321 comment
6749530509. Do not derive or amend that identity from the host export, report,
journal, or `host.mjs identity` output.

The operational receipts in the issue record that the migration and gateway
configuration were applied and that the paired report table was empty. These
receipts do not prove this run has finished or that it is publishable. The
recorded run was still active with an expected end around 2026-11-10 03:14 UTC;
confirm its state through the authorized operator before retrieval. Do not
access provider credentials, change the host/run/volume/configuration, or write
a running snapshot to the immutable final-run row.

Use a private working directory outside the host data root. Preserve the host
export unchanged, and do not publish anything if any identity or evidence
status is unknown or mismatched.

## Retrieve and evaluate

After an operator confirms the run is no longer active, prepare a restricted
working directory and place the independently pinned identity file there:

```sh
umask 077
export RUN_ID=btc-eur-trend-host-8h-002
export WORK_DIR=/absolute/path/to/private-finalization-work
export PRIVATE_DATA_ROOT=/absolute/path/to/authorized-host-data
mkdir -p "$WORK_DIR"
```

Retrieve the combined, bounded host export with the existing read-only command:

```sh
node scripts/spot-paper-paired/host.mjs export \
  --data-root "$PRIVATE_DATA_ROOT" --run-id "$RUN_ID" \
  > "$WORK_DIR/host-export.json"
```

Review the export status and require `TERMINAL_JOURNAL_VERIFIED`,
`verifiedTerminal: true`, and `reconciliationStatus: READ_ONLY_VERIFIED`. The
journal must contain its terminal report. Stop if the export says
`WRITER_LOCK_PRESENT`, `INCOMPLETE_UNKNOWN`, or `NOT_FOUND`, if it is malformed,
or if reconciliation is not `READ_ONLY_VERIFIED`. The export maps an unresolved
pending publication to incomplete/unknown status; preserve such evidence
unchanged for investigation and do not treat it as a final report.

Evaluate the exact export against the independently pinned identity:

```sh
node scripts/spot-paper-paired-report/cli.mjs \
  "$WORK_DIR/expected-identity.json" "$WORK_DIR/host-export.json" \
  > "$WORK_DIR/paired-dashboard.json"
```

The only publishable status is `VERIFIED_COMPLETE`. It means the existing
evaluator found bounded structural, identity, accounting, and journal
reconciliation; it is not independent authentication, a profitability result,
or a promotion decision. Confirm identity, completed/attempted counts, fees,
net PnL, drawdown, unresolved observations, activity diagnostics, and unknown
fields against the DTO. Costs are already reflected in net equity/PnL; do not
subtract booked fees or modeled costs a second time. No-winner qualification
must remain `NO_WINNER_OR_PROMOTION`.

If the evaluator returns `INTERRUPTED`, preserve that status and archive the
unchanged export and DTO separately. Do not relabel it complete or attempt
final-row ingestion. `RUNNING_SNAPSHOT`, `CORRUPT_UNKNOWN`, active-lock,
pending, incomplete, and unknown evidence must never be published. No retries
or evidence repair are part of this procedure.

## Dry-run, explicit ingestion, and readback

For `VERIFIED_COMPLETE` evidence, first validate the exact files without
database access:

```sh
node scripts/spot-paper-paired-report/ingest.mjs \
  "$WORK_DIR/expected-identity.json" "$WORK_DIR/paired-dashboard.json"
```

Require `DRY_RUN` and retain its run ID and digest. The ingester rechecks the
DTO and the independently supplied identity; all other evidence statuses are
rejected before database access.

Only after a separate operator approval of this exact run ID and digest may the
operator explicitly request one immutable insert:

```sh
node scripts/spot-paper-paired-report/ingest.mjs \
  "$WORK_DIR/expected-identity.json" "$WORK_DIR/paired-dashboard.json" --write
```

This uses the existing database and TLS environment configuration. Never put
credentials on the command line. An `INSERTED` or `IDENTICAL` result is the
ingester receipt; `CONFLICT` must stop for review. If the result is
`OUTCOME_UNKNOWN` (exit code 4), do not retry. Resolve it by an authorized
readback and operator review first.

Read the row through the existing authenticated
`/api/private/spot-paper-paired-report` GET path. Confirm its run ID, identity,
and report contents match the dry-run files. The GET validates the stored
digest; recompute the canonical envelope digest with the existing
`spotPaperPairedReportDigest` from
`scripts/spot-paper-paired-report/envelope.mjs` and compare it with the dry-run
receipt. The GET path is read-only; this runbook adds no upload route or
automatic publisher.

## Offline verification and limits

The synthetic 480-observation integration test exercises the existing journal
writer and host export, then the evaluator and no-write ingestion path. It is
test-only and supplies no production PnL or result. Run the focused checks with:

```sh
node --test test/spot-paper-paired-finalization.test.js \
  test/spot-paper-paired-host.test.js \
  test/spot-paper-paired-report.test.js \
  test/spot-paper-paired-report-ingest.test.js
```

This checkout has no authorized access to the actual host, volume, provider, or
production database. Final evidence retrieval, pinned-identity acquisition,
operator approval, explicit ingestion, and authenticated readback remain
manual. The repository does not contain the terminal export or an actual
production 480-observation result.
