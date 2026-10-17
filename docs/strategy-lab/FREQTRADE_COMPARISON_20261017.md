# Meridian / Freqtrade comparison packet

Issue #832. Op-ID OSS-FREQTRADE-BRIDGE-20261017-01.
Authorized by the owner in the OSS integration chat on 2026-10-17.
Single writer: that integration session, branch
`research/freqtrade-data-bridge-20261017`, based on
`d8a12f8dfeb25843d186111094e1cdc1fbb35b0d`.
The parallel runtime/publisher work remains tracked in #829/#831.

## Delivered boundary

This packet prepares comparable data. It does **not** run Freqtrade, port a
strategy, calculate strategy PnL, demonstrate parity or authorize promotion.
It does not change the arena engine, stored results, frozen funding research,
runtime, UI, credentials, workflows or release identity.

The existing arena inputs have OHLC but no normalized volume. Its retained
Kraken responses contain base volume at field 6 (field 5 is VWAP). Exporting
invented volume would silently change the dataset. The bridge instead checks
the chunk, raw response and reconstructed arena input hashes, exact USD
instrument metadata, OHLC agreement, daily UTC calendar and closed-candle
cutoff before recovering volume. Zero volume is preserved. No gap filling,
sorting, quote conversion or fallback provider is used. Hashes demonstrate
internal consistency, not authenticity or historical availability.

Run offline, with an output directory that does not exist:

```sh
node scripts/export-arena-freqtrade.mjs \
  --source research/results/strategy-arena-20261016 \
  --out /tmp/meridian-freqtrade-data
node --test test/arena-freqtrade-export.test.js
```

The result is eight `SYMBOL_USD-1d.json` files and a manifest. Each file contains
`[timestamp_ms, open, high, low, close, volume]` rows. The manifest binds source
and output hashes, 200 warmup bars and the first execution timestamp. It is
written last as the completion marker; a failed write leaves an incomplete
directory that must not be consumed. Existing directories are never overwritten.
Local files are assumed to be under the operator's control; this is not a
sandbox for a malicious concurrent filesystem writer.

Format source inspected at Freqtrade stable commit
`1f394eaebc2f46a83d26971388628707802f8602`:

- https://github.com/freqtrade/freqtrade/blob/1f394eaebc2f46a83d26971388628707802f8602/freqtrade/data/history/datahandlers/jsondatahandler.py
- https://github.com/freqtrade/freqtrade/blob/1f394eaebc2f46a83d26971388628707802f8602/freqtrade/candle_columns.py

This is a source-inspected format reference, not an installed or tested engine
dependency. No Freqtrade source is copied and no dependency is added. Pin the
actual checkout, Python runtime and dependency lock before the independent run;
review its license before incorporating source or distributing a derivative.

## Next comparison gates

1. Read the generated files through the pinned Freqtrade loader and compare all
   timestamps/OHLCV values to the manifest-bound data. Explicitly select JSON,
   spot, Kraken and USD. Fail if loading repairs, drops or fills candles. Do not
   silently download replacement data or consult a later dataset.
2. Independently implement H1-B signal conditions: close above inclusive
   SMA200 and positive 90-bar momentum for entry; close at or below SMA200 for
   exit. Compare features and eligible signals before position/accounting
   differences. Signal at completed day t, earliest fill at day t+1 open;
   no execution during the 200-bar warmup. No parameter search.
3. Compare cash and buy-and-hold controls, then H1-B fills, fees, cash,
   positions and daily equity. Classify every mismatch instead of selecting
   the implementation with the higher return. Define numerical tolerances
   before the run; no loosening to fit an observed result.
4. A replay of the October16 snapshot is retrospective diagnostic evidence.
   Forward evaluation needs a separately frozen window and data collection.
   It cannot be relabeled as an unused holdout.

| Dimension | Meridian arena | Required treatment in comparison |
| --- | --- | --- |
| Capital | One USD10,000 portfolio per model | Same cash pool; not USD10,000 per symbol |
| H1 sizing | New positions target 1/8 of post-cost equity; existing quantities normally retained | Ordinary fixed stake or equal slots are not equivalent; reconcile portfolio sizing |
| Ordering | Sells before buys; shared post-cost allocation | Prove cash availability and execution order |
| Costs | Aggregate 8 bps per fill; stress 16 bps | Map once, not fee plus the same cost again as slippage; these remain assumptions |
| Stops / ROI | No fixed stop, TP or ROI exits | Disable additional exits in an isolated comparison strategy; never a live configuration |
| Final positions | Marked open by default, no assumed exit fee | Separate Freqtrade forced exits from the comparable marked-open ledger |
| Precision | Floating point, no venue lot/minimum constraints | Quantify exchange rounding/minimum-order differences explicitly |
| Drawdown | Daily close, initial USD10,000 peak | Same timestamps and initial peak; intraday metrics are separate |
| Trades | Realized sale slices, not independent bets | Do not compare raw trade count or profit factor without attribution |
| Volume | Not used by arena signals | Preserve it; identify any external zero-volume filter |

## Additional OSS shortlist

- `dubzzz/fast-check`: JavaScript/TypeScript property testing. Closest fit to
  Meridian's Node tests: generated sequences can challenge accounting and
  timestamp invariants. Pilot after identifying an invariant and keep minimal
  failing examples reproducible. No dependency added in this packet.
- `unionai-oss/pandera`: dataframe schemas for a future Python research adapter.
  Useful for OHLCV types, ranges and cross-column checks. Meridian's current
  Node bridge uses native checks; adding Python solely for this is unnecessary.
- `HypothesisWorks/hypothesis`: Python property testing if the Freqtrade adapter
  becomes substantial. Complements Python tests; duplicates fast-check's role
  if there is no Python implementation to exercise.

Sources inspected 2026-10-17: the repositories' own READMEs. These are development
tools, not market data licenses or evidence of profitable trading. Prefer a
small tested adapter over combining more complete trading frameworks.

## Checkpoint

Branch creation verified at the stated base; issue #832 records scope and
owner authorization. Local tests and publication evidence belong in the draft
PR's single progress comment. Independent exact-head review and required CI
remain prerequisites to merge. Next deliverable is loader and signal parity,
then reconciled accounting; no unattended continuation is claimed.
