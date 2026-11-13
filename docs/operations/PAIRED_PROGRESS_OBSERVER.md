# Bounded paired Paper progress observer

This is source/offline readiness only, not operational activity. Nothing imports or
starts the observer automatically. No scheduler, mount, credential, deployment,
or change to the Paper job is provided. One real checkpoint 157 was stored;
continuous publication is not active. The frozen
`btc-eur-paired-diag-20261110-001` run must not be restarted or have its image,
journal, account, strategy, or budget changed.

Separate authorization must establish an already accessible, coherent read-only
run directory (or supported remote channel) and provision a new, distinct upload
credential securely. The old temporary raw uploader credential is lost; do not
recover it from history or logs. An interactive browser shell is not a scheduler.
No database, exchange, or reader credential is needed by this observer. See
`docs/operations/PAIRED_PROGRESS_RUNBOOK.txt` for the underlying contract and
operational boundaries.

## Explicit invocation

Only after those prerequisites and separate approval, run the reviewed checkout
in a controlled operator environment. The path must be an absolute, normalized
path to the exact run directory; supply a separately reviewed absolute identity
JSON file, an absolute UTC end time and a positive finite max tick count:

```
node "$CHECKOUT/scripts/spot-paper-paired-progress/observe.mjs" \
  --run-directory /approved/read-only/exact-run \
  --expected-identity /approved/expected-identity.json \
  --end-at 2026-12-01T12:00:00Z --max-ticks 60
```

`CHECKOUT` denotes the absolute path of the reviewed checkout. This invocation
publishes: it is not a dry run. Supply the publisher's existing
`MERIDIAN_SPOT_PAPER_PAIRED_PROGRESS_PUBLISH_TOKEN` through a secure operator
environment, never as an argument, URL, log, or shell-history literal. No token
or raw exporter/transport errors are printed. Neither this document nor this
change provisions credentials.

The first tick is immediate, subsequent slots are 60 seconds apart on a
monotonic clock. Missed slots are skipped; a tick is never started while the
previous tick is awaiting export or upload. The absolute end prevents starting
another tick or upload, but an already started bounded operation may finish
after it. Each attempted export counts towards max ticks. Existing exporter
(3 seconds) and publisher (8 seconds) timeouts apply.

BUSY and UNKNOWN exports defer to the next regular slot. A fully validated
different identity returns sanitized IDENTITY_CONFLICT and stops. A lower
sequence or the same sequence with a different digest stops. An unchanged
sequence and digest causes no POST, even if export time differs. Upload
authentication failures or any ambiguous/non-successful upload stop without
retry; inspect authorized readback before any further operator action. A
successful terminal checkpoint is published once and stops. State is in memory
only: restart is a new invocation and requires operator reconciliation,
especially after UNKNOWN; it is not an automatic recovery mechanism.

Financial values, including original `valuationAt`, booked fees and modeled
slippage, pass through unchanged. A checkpoint is not proof of liveness,
verified completion, actual fees, or trading authority.

Focused source tests:

```
node --test test/spot-paper-paired-progress-export.test.js test/spot-paper-paired-progress-observe.test.js
```
