# Offline B1 research review report

This source-only utility renders a bounded Markdown report from caller-supplied
bytes accepted by the unchanged `v11/arena-historical-export.js` parser. It is
limited to that parser's pinned synthetic profiles. It does not import genuine
D2 results; a D2 V2 contract remains unapproved and unsupported.

The report keeps the 44 manifest-order path IDs and the separate 44-entry
computation order even when no path result exists. Progress observations,
available result records, engine status, screen status, source authenticity, and
authority are separate. Missing results are shown as `NO_RESULT_RECORD`; the
report never manufactures completion, a result, or a numeric default. Early
insufficient evidence is represented by the parser-provided 19 completed paths
and 25 explicit `NOT_RUN_INSUFFICIENT_EVIDENCE` records. A screen-only
`INSUFFICIENT_EVIDENCE` remains separate from an engine-level outcome.

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

## Evidence boundary

Every report is explicitly synthetic-only/unverified under the accepted parser
contract. Hashes bind bytes and identities, not source authenticity, caller
identity, or consent. The report does not read files, journals, or market data;
does not access a network; and imports no engine or captured-input loader. It
does not run, replay, rank, calculate returns, add metrics, or grant research,
Holdout, Paper, or Live authority. Historical diagnostic is not Holdout; costs
remain assumptions; `NO_FINITE_TRADE_STOP` remains unchanged; genuine D2 import
is unsupported.

Generated-only coverage:

```sh
node --test test/b1-7-review-report.test.js
```
