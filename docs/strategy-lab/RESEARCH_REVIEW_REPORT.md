# Offline B1 research review report

This source-only utility renders a bounded Markdown report from caller-supplied
bytes accepted by either the unchanged synthetic-only V1 parser
(`v11/arena-historical-export.js`) or the separately versioned historical V2
parser (`v11/arena-historical-export-v2.js`). V2 accepts a bounded
historical-shaped observation as an unverified caller assertion; it does not
authenticate or independently accept a genuine D2 result.

The report keeps the 44 manifest-order path IDs and the separate 44-entry
computation order even when no path result exists. Progress observations,
available result records, engine status, screen status, source authenticity, and
authority are separate. Missing results are shown as `NO_RESULT_RECORD`; the
report never manufactures completion, a result, or a numeric default. Early
insufficient evidence is represented by the parser-provided 19 completed paths
and 25 explicit `NOT_RUN_INSUFFICIENT_EVIDENCE` records. A screen-only
`INSUFFICIENT_EVIDENCE` remains separate from an engine-level outcome.

Supplied development controls and control-binding hashes are shown separately,
including when progress has no final result. They remain unverified caller
assertions and are not recomputed or treated as authentication.

Per-path scalar fields and quarterly returns are printed as returned, including
zero, false, and null. Daily return/held-target arrays and fill/cancel detail
arrays are deliberately omitted from the compact report; no aggregates or
replacement metrics are calculated. Output uses stable ordering and escapes
caller strings for Markdown tables, so text cannot introduce active HTML,
links, images, or table cells.

## CLI

```sh
node scripts/research/b1-7/render-review-report.mjs < export.json
```

The command accepts no arguments. Input is read from stdin only, limited to 8
MiB inclusive before parsing; output is fully rendered and checked against a
1 MiB UTF-8 limit before the single stdout write. Invalid input, oversize input,
unexpected arguments, and output overflow produce a stable generic error on
stderr and no stdout. The importable `renderReviewReport(Uint8Array)` function
uses the same unchanged parser. `renderParsedReviewReport` is only a formatter
for an already parser-accepted projection and is not an import or validation
entry point.

The focused suite exercises the output-size guard directly at the formatter
boundary. Current V1 parser bounds do not provide a valid generated export whose
projected report exceeds 1 MiB, so the suite does not claim end-to-end overflow
coverage through the import API or CLI.

## Evidence boundary

V1 remains limited to its pinned synthetic profiles and does not accept genuine
D2 results. V2 is a separate offline historical review contract. It verifies
supplied result and summary bytes, their structural relationship, and internal
canonical identity relationships; these checks do not establish provenance,
source authenticity, caller identity, or consent. Optional original progress
payload bytes are verified only when supplied. Optional supplemental evidence
is bounded, typed by category, and remains unverified where `inspect_b1` has no
corresponding contract.

Neither format reads files, journals, or market data; accesses a network; or
imports an engine or captured-input loader. The report does not run, replay,
rank, calculate returns, add metrics, or grant research, Holdout, Paper, or Live
authority. Historical diagnostic is not Holdout; costs remain assumptions;
`NO_FINITE_TRADE_STOP` remains unchanged. V2 cannot establish authenticity or
independent acceptance and makes no execution, promotion, profitability, or
causal claim.

Generated-only coverage:

```sh
node --test test/b1-7-review-report.test.js
```

The shared formatter renders the separately versioned historical V2 contract
without changing V1. V2 byte, identity, optional-evidence, and provenance
limits are documented in
[HISTORICAL_RESULT_EXPORT_V2.md](HISTORICAL_RESULT_EXPORT_V2.md).
