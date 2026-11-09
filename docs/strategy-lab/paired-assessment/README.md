# Offline paired-paper assessment

This package renders a concise German assessment from an existing sanitized
`SPOT_PAPER_PAIRED_DASHBOARD_V1` DTO. It uses the canonical
`projectSpotPaperPairedDashboard` projector and the existing paired-report
bounded JSON reader; it does not introduce another monetary validator, report
transport, or evaluator.

## Operator command

Save the sanitized DTO to a local JSON file, then run either output mode:

```sh
node scripts/spot-paper-paired-assessment/cli.mjs /absolute/path/dashboard.json
node scripts/spot-paper-paired-assessment/cli.mjs --format json /absolute/path/dashboard.json
```

The CLI is offline and read-only. It requires one absolute path, reads at most
the existing 16 MiB host-export bound, writes the Markdown or JSON assessment
to stdout, and does not create output files. Invalid or oversized input produces
a generic error code on stderr and a nonzero exit.

## Interpretation limits

- The source DTO's evidence qualification, status, reason code, synthetic
  marker, identity, timing, cost assumptions, and comparison availability are
  retained. `VERIFIED_COMPLETE` means structural reconciliation, not independent
  authentication, live readiness, or a strategy result.
- Amounts are those already reported for the DTO's `BTC/EUR` pair. Fees and
  modeled slippage are presented as reported; net PnL is not adjusted again.
  The formatter does not combine currencies or add hypothetical exit costs.
- Fill counts are not roundtrip counts. Per-arm roundtrips and no-trade reasons
  remain unknown because the DTO does not report them. If an activity diagnostic
  supplies its own completed-roundtrip count, it is shown separately as a
  diagnostic value and is not copied into per-arm counts.
- Missing metrics remain explicitly unknown with their existing reason. The
  output does not infer a winner, profitability, a reason for abstention, or
  live status. Interrupted, non-comparable, and identity-mismatch evidence is
  not upgraded or repaired.

Tests use synthetic DTOs only; they do not create or claim actual performance
results. Run the focused suite with:

```sh
node --test test/spot-paper-paired-assessment.test.js
```
