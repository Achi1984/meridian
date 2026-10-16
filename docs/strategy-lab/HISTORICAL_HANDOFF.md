# Historical data handoff: engineering audit, not a backtest

Run `node docs/strategy-lab/audit-core-handoff.mjs` from the repository root.
From another working directory, pass the script's absolute path instead.
The read-only audit verifies the two manifest SHA256 values, OHLCV geometry,
UTC sequence and coverage, then counts windows without calling a strategy.
It preserves the original files and their actual archive receipt timestamps.

652 daily bars give 452 overlapping 201-bar windows per asset (904 total).
These are neither 904 trades nor 904 independent observations. All source
months have already been inspected and cannot become an untouched holdout.

## The concrete handoff problem

The pure P1 module requires bars received by asOfMs and a latest close less
than one day old. For these archives, the real receipt is in October 2026,
while every candidate window closes in 2023/2024. At each historical close,
the stored archive is unreceived; at its actual receipt, the window is stale.
The current data therefore cannot pass the live-time contract for a historical
simulation. This is correct rejection, not a reason to relax the live guard.

## Proposed replay contract (not implemented or activated)

Preserve separate fields for candle close, actual archive retrieval and any
historical publication/revision evidence. A later replay implementation must
choose and label one of two modes before any outcome is inspected:

1. Evidence-backed replay: historical source availability and revisions are
   supported by time-stamped evidence. Admit only versions available at the
   simulated decision time.
2. Assumption-based engineering replay: explicitly assume a frozen publication
   delay and no material historical revisions. Record the assumption separately
   from observed receipt, never overwrite availableAtMs or present an assumed
   timestamp as measured. This mode cannot prove historically executable edge.

Do not pass backdated bars into the current live-time function merely to make
it accept them. Separate shared indicator mathematics from time admission in
a reviewed future change, keeping the live guard intact. Neither replay mode
is implemented by this packet, nor does this design authorize strategy runs.

## Execution engine prerequisites

Freeze sizing, exposure and loss limits before a run. Persist consumed signal
IDs, entry/exit timestamps and positions so restart cannot replay an entry.
Execution must follow signal availability. Daily OHLC alone cannot determine
intraday event order: resolve stop/entry/exit ambiguity with finer data or
predeclared adverse ordering. Gap stops must not assume the stop price was
tradable. The last signal needs subsequent execution data or stays unfilled.
Keep venue data separate; USD/USDT and EUR require explicit FX treatment.
Report all fixed cost scenarios; do not select costs after inspecting returns.
Historical universe, listings, fees and independent venue checks remain open.

## External-source status, 13 October 2026

Bounded public API probes for BTC and ETH from 1 through 13 October 2024:
OKX and Coinbase returned HTTP403. Kraken's public archive checksum request
failed with `Tunnel connection failed: 403 Forbidden`. The latter is evidence
of a local network path restriction, not proof Kraken refuses these datasets.
No second-venue prices were obtained or substituted. No retry, proxy, account
access, credentials, purchase or workflow change is part of this audit.
Official candidate: https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data

The parallel platform/UI lane and frozen strategy reference are untouched.
