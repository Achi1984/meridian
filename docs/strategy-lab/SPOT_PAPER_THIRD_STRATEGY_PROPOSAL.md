# BTC/EUR third paper strategy — range pullback / mean reversion

**Status: source-only proposal.** This document defines a candidate contract and
offline-evaluation requirements. It does not add a runner, provider call, paper
account, shared balance, dispatch, deployment, or live path. Baseline
`BTC_EUR_SMA5_SMA20_V1` and the isolated SMA-trend candidate remain unchanged.

## Candidate identity and rationale

Candidate ID: `BTC_EUR_RANGE_PULLBACK_ATR_RSI_V1`.

The candidate is deliberately orthogonal to the two crossover strategies: it
trades only a confirmed downside excursion that reverts inside a bounded,
non-trending regime. It is long-only BTC/EUR spot, one position maximum, with no
shorting, leverage, pyramiding, or size increase. A no-trade result is valid.
This is a frozen structural hypothesis, not a parameter sweep or a claim of
edge.

## Causal signal contract

The future offline adapter must consume the same accepted Kraken BTC/EUR
one-minute OHLC snapshots and quote observations as the existing comparison
path. It must reject gaps, duplicates, out-of-order candles, conflicting
overlaps, invalid/stale responses, and non-causal quotes. Only fully closed bars
available at `decisionAt` may be used; the signal close is never a fill price.

Warm-up requires 60 consecutive closed one-minute bars. For the latest closed
bar `t`, calculate:

- `SMA20`: mean of closes in `[t-19,t]`;
- `SMA60`: mean of closes in `[t-59,t]`;
- `ATR14`: Wilder-style mean of the previous 14 true ranges, where
  `TR=max(high-low, abs(high-previousClose), abs(low-previousClose))`.
  The first bar with no previous close is not eligible;
- `RSI14`: Wilder-style average gains/losses over 14 closed one-minute
  changes. If average loss is zero, RSI is 100; if both averages are zero, RSI
  is 50. No floating-point comparison is permitted at a decision boundary.

The implementation should use a fixed positive price scale and integer
cross-multiplication for means, ATR, and RSI comparisons. It must retain the
full validated candle history in the replay input; a rolling state may be an
optimization only after validation has seen the complete prefix.

### Entry (all conditions on the same latest closed bar)

Admit one `ENTRY` only when all of the following hold and the account is flat:

1. **Range gate:** `abs(SMA20 - SMA60) * 2 <= ATR14 * 3` and
   `abs(SMA60[t] - SMA60[t-10]) * 2 <= ATR14`. This blocks entries during a
   directional trend and requires ten additional closed bars for the slope
   check.
2. **Pullback:** `close[t] * 100 <= SMA20 * 100 - ATR14 * 150` (at least 1.5
   ATR below SMA20).
3. **Oversold confirmation:** `RSI14 <= 35` and `close[t] > close[t-1]`.
   The rising close is the reversal confirmation; there is no intrabar
   assumption.
4. **Freshness:** the same candle timestamp has not previously emitted a
   signal, and the post-SELL cooldown has expired.

The signal ID includes candidate ID, candle timestamp, and decision timestamp.
An entry opportunity that fails any condition is not queued. It is counted by a
machine-readable rejection reason (`RANGE_GATE`, `PULLBACK_DISTANCE`,
`RSI_GATE`, `NO_REVERSAL`, `COOLDOWN_ACTIVE`, or `ALREADY_HELD`).

### Exit and risk behavior

Generate an `EXIT` at the first later closed bar satisfying any one of:

- `close[t] >= SMA20[t]` (**mean reversion target**);
- `close[t] <= entryPrice - 2 * entryATR` (**candidate initial stop**, using the
  ATR captured at entry); or
- holding time reaches 120 minutes (**time stop**).

Exit priority is target, then candidate stop, then time stop only when several
conditions occur on one bar. The executable exit remains the subsequent
validated bid quote with the existing adverse slippage model. Existing
sampled-bid stop and session-loss protection remain active and can terminate an
arm; they are not weakened or replaced. Exits are never delayed by spread,
RSI, or the range gate. A sell starts the existing 600,000 ms cooldown; an
opportunity during cooldown is discarded, not queued.

## Costs, sizing, and accounting

Use the existing offline comparison accounting unchanged: EUR 1,000 initial
cash, EUR 100 maximum all-in entry, one long position, integer cents/satoshis,
50 bps modeled fee per side, 10 bps adverse slippage per side, and the 50 bps
entry spread ceiling. Fees and slippage are separate report fields and must be
charged exactly once on every virtual fill, including exits. The assumptions
are conservative modeling inputs, not verified Kraken fees or execution
evidence. Do not tune them after seeing outcomes. Cash/no-trade remains the
control; the candidate must have an independent ledger and strategy ID.

The adapter must preserve `decisionAt <= ticker.requestStartedAt` causality and
must not use the signal close as a fill. Open inventory at the common horizon
remains unresolved and is marked only with a fresh accepted quote; no forced
liquidation, zero mark, or inferred price is allowed.

## Evidence gates and disposition

Before any prospective observation, freeze the candidate source hash, fixed UTC
window, input schema, cost worksheet, account contract, and rejection/exit
taxonomy. Use three separate EUR-only arms on the identical accepted stream:
Baseline, SMA-Trend, and this candidate, plus the existing cash control. Keep
all raw responses, hashes, gap records, signals, fills, marks, and terminal
inventory. Synthetic fixtures validate code paths only and are never market
evidence.

For an initial diagnostic, preregister a complete 24-hour window and report
actual elapsed/coverage. Fewer than five completed round trips is
`ACTIVITY_INSUFFICIENT`, not a pass and not a reason to extend the window or
force trades. The report must include net and marked PnL, drawdown in cents and
relative terms, fees, slippage, turnover, exposure, fills, holding durations,
exit reasons, rejection counts by reason, data gaps, and unresolved terminal
inventory for every arm. Undefined metrics remain undefined.

No candidate is eligible for promotion from this diagnostic. Any later claim
would require a separately reviewed chronological out-of-sample window spanning
at least three declared regimes, retained losing/inactive trials, independent
source/manifest verification, and a predeclared selection rule. Positive PnL,
fewer trades, or a passing synthetic test cannot authorize runner integration,
paper activation, or live trading.

## Source-only implementation boundary

The permitted follow-up is documentation, deterministic synthetic fixtures, or
an offline evaluator that consumes caller-supplied observations. It must not
touch `server.js`, the pilot runner, provider adapters, shared ledger code,
workflow dispatch, credentials, or any live/paper activation flag. A future
adapter should be tested for warm-up and integer boundaries, range/slope gate,
ATR/RSI edge cases, reversal confirmation, target/stop/time-stop priority,
cooldown, causal quote rejection, cost conservation, common-horizon marking,
and baseline/SMA-Trend parity. No network request is part of those tests.
