# Offline BTC/EUR SMA entry-confirmation challenger

This is an isolated, offline research comparison. It does not change the BTC/EUR
pilot, runner, journal, deployment, workflow, dashboard, or execution path. The
modules have no provider, filesystem, network, or default-run wiring:

- `scripts/spot-paper-research/entry-confirmation.mjs` implements the one frozen
  challenger, `BTC_EUR_SMA_CONFIRM2_COOLDOWN10_RESEARCH_V1`.
- `scripts/spot-paper-research/comparison.mjs` accepts only an injected
  observation stream and compares baseline, challenger, and cash/no-trade arms.

## What the stopped-pilot snapshot can and cannot tell us

The source-based review cited in issue #1298 reports a last **pre-stop snapshot**
at cycle 378: 26 fills, flat inventory, EUR 984.28, and net PnL of -EUR 15.72,
including EUR 13.00 in booked fees. The final archive was not retrieved and
assessed for that review, so those figures are not terminal-verified totals.
Adding the booked fees back gives -EUR 2.72 as arithmetic only; it is not a
no-cost replay because it does not reconstruct counterfactual fills, slippage,
or spread.

The baseline models 50 bps fee and 10 bps adverse slippage on each side, or
approximately 1.2% round-trip friction before the actual spread. That makes cost
mismatch a plausible contributor, but the available source snapshot does not
establish it as the cause. False-cross frequency, holding durations, exit
reasons, and fill-by-fill cost decomposition remain empirical questions.
Reduced turnover or exposure is not itself alpha.

The archived stopped run is development context, not fresh validation. No
archive retrieval, acquisition, market-data run, USD relabeling, or real order
is part of this change.

## Frozen, uncalibrated challenger

The sole candidate is a structural entry-rule change, not a parameter sweep:

1. Reuse the baseline SMA(5)/SMA(20) closed-candle stream, startup cutoff,
   validation, and exact integer crossover comparisons.
2. Require a fresh post-cutoff upward cross and two consecutive newly closed
   one-minute candles with `4 * sum(last 5 closes) > sum(last 20 closes)`.
   The crossing candle is the first confirmation; the next distinct candle is
   the second. Equality or below cancels the pending entry.
3. Emit the entry only when the second candle is received. Its ID and candle
   time refer to that confirmation, not the earlier cross. Duplicate candles
   do not advance it. A missed decision window clears it and requires a new
   future cross.
4. After any actual SELL fill, discard entry opportunities until 600,000 ms
   after that fill's observation/execution time. An opportunity during the
   cooldown is not queued. At expiry, a new upward cross and both confirmation
   candles are still required.
5. Keep the baseline immediate downward-cross exit, sampled 2% bid stop, and
   EUR 20 session-loss handling. Entry confirmation and cooldown do not postpone
   exits. No pyramiding, shorting, leverage, or larger budget is introduced.

The candidate is intentionally uncalibrated and was not selected from a grid.
It may suppress whipsaws, but it can also enter later, miss gains, or make
performance worse. Candidate fills preserve a candidate-specific strategy ID
and reason alongside the original ledger reason.

## Comparison input and limits

`compareSpotPaperStrategies(observations)` takes 1–480 chronologically ordered
records of this form:

```js
{
  at, // integer observation/effect time in epoch milliseconds
  ohlc: { data, raw, sha256, requestStartedAt, receivedAt },
  ticker: { data, raw, sha256, requestStartedAt, receivedAt }
}
```

Each raw body must match its SHA-256 and decoded data. The existing BTC/EUR
parsers validate closed candles, ticker book, staleness, and numeric bounds.
Ticker acquisition must start no earlier than the OHLC receipt (the latest
possible signal-knowledge point for either arm); each OHLC acquisition must also
follow the prior observation. An absent, stale, invalid, or noncausal quote
returns `UNAVAILABLE`, not a candle-close fill or a future quote.

The comparison has a 64 MiB total input/response-byte bound, a 256 KiB
per-response bound, at most 21 closed candles per snapshot, and a 20,640-unit
work bound. It fails closed for evidence gaps rather than fabricating a mark or
signal. A missed decision window recognized by the shared strategy core is
counted and handled without backdating fills. An arm that reaches the baseline
stop/loss terminal condition stops processing just as the runner does; its
open inventory remains unresolved with its last mark, if any.

All arms use EUR 1,000 initial cash, the EUR 100 maximum all-in entry, the same
quotes, quote/candle freshness, 50 bps entry-spread filter, 50 bps per-side
fee, and 10 bps per-side adverse slippage. The two strategy arms call the
existing `createStrategyState`, `advanceStrategy`, `createLedger`, and
`applyPaperObservation` implementations. The cash arm performs no trades.

The available report includes cash and marked net equity, realized/unrealized
PnL, fees, two-sided gross turnover, fills, completed/open roundtrips, holding
durations, exits, rejected entries, discarded cooldown opportunities, data
gaps, unresolved terminal inventory, and sampled equity drawdown including
initial capital. Exposure is the sum of `[observationAt, nextObservationAt)`
intervals where the arm was already holding at the left endpoint; there is no
pre-first-observation or post-terminal extrapolation. Costs are counted once
from the shared ledger. Missing terminal mark data is unknown, not zero.

## Validation and future selection

The tests use synthetic fixtures only. They cover warmup/cutoff, strict
confirmation and equality, duplicate/backfilled and missed-window candles,
cooldown and its exact boundary, a required fresh cross, immediate exits and
sampled stops, stale/pre-signal quotes, response bounds, cash control, open
terminal marking, fee/turnover conservation, baseline parity, and a rising
trend in which delayed confirmation yields lower marked equity than baseline.
These fixtures validate code paths, not observed performance.

No arm is ranked or promoted here. Any future selection requires a frozen,
untouched chronological forward window and control, retention of all runs, and
reporting net performance, drawdown, and exposure. A no-trade or negative result
remains valid; fewer trades alone is not evidence of improvement. Before any
future run, venue/account fee assumptions must be separately verified from
sourced evidence rather than lowered retrospectively. There is no profitability
assertion or automatic promotion.
