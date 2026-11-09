# BTC/EUR causal 5-minute trend-filter challenger

**Status: isolated offline candidate only. No campaign is running or authorized
by this package.** The completed paired PAPER run remains its own EUR campaign;
this candidate has no shared balance, execution wiring, or currency relabeling.
It changes no existing research, forward, host, shared-ledger, replay, or DTO
module.

## Frozen hypothesis

Candidate ID:
`BTC_EUR_SMA_CONFIRM2_COOLDOWN10_5M_SMA20_TREND_RESEARCH_V1`.

The untuned hypothesis is: permit a new long entry only when the latest fully
closed UTC 5-minute close is above its SMA20 and that SMA20 is above its value
for the preceding 5-minute bar. This structural filter is applied after the
existing `CONFIRM2_COOLDOWN10` entry confirmation. It does not change the
confirmation or 600,000 ms post-SELL cooldown, and it does not change position
size, leverage, account limits, or risk controls.

## Causal bar and decision contract

`scripts/spot-paper-research/five-minute-trend.mjs` composes with the existing
`scripts/spot-paper-research/entry-confirmation.mjs` exports. Given parsed
one-minute candles (`timestamp` is the UTC minute start and `closeNano` is an
integer price string), it:

1. Requires valid, strictly ordered, unique one-minute timestamps with no
   missing minute. A malformed sequence fails closed.
2. Uses only one-minute candles whose `timestamp + 60,000 <= decisionAt`.
   Five-minute UTC buckets start at
   `floor(timestamp / 300,000) * 300,000`; a bucket contributes only when all
   five contiguous minutes are closed. Partial leading/trailing buckets,
   including the current minute, are not bars.
3. Requires 21 complete five-minute bars. This is explicit warmup: 20 bars for
   the current SMA20 and one additional bar to calculate its prior value.
4. Uses integer arithmetic for both strict comparisons:
   `latestClose * 20 > sum(latest 20 closes)` and
   `sum(latest 20 closes) > sum(previous 20 closes)`.

There is no future-bar lookup, interpolated price, backfilled signal, or
fill-at-close behavior. `advanceFiveMinuteTrendEntry` is the engine adapter:
it accepts the existing confirmation state, one-minute candles, `decisionAt`,
and `held`; it returns the same state and signal shape expected by the existing
research engine. It changes only admitted ENTRY identity/reason. EXIT signals
pass through unchanged. A blocked confirmed ENTRY returns
`blockedEntryReason` and `discarded` with either
`FIVE_MINUTE_SMA20_WARMUP_INSUFFICIENT` or
`FIVE_MINUTE_SMA20_TREND_NOT_CONFIRMED`; the existing comparison reporter can
count these reasons without a second simulator.

Exports for a future integration are `createFiveMinuteTrendState`,
`advanceFiveMinuteTrendEntry`, and `recordFiveMinuteTrendSell`. The last export
delegates directly to the existing cooldown recorder. The risk/ledger adapter
must remain the existing engine's implementation.

## Preregistered diagnostic and reporting

Before any new test, freeze one 24-hour UTC evaluation window and report actual
elapsed duration and coverage. The provisional activity diagnostic is at least
five completed round trips in that fixed window. Fewer than five is
`ACTIVITY_INSUFFICIENT`, not a pass and not a reason to extend the deadline,
cherry-pick data, force trades, or override a risk pause. The requirement for
active trading remains: if activity is persistently insufficient, assess a
newly versioned rule rather than treating inactivity as success.

Use three separate EUR-only paper accounts on identical accepted BTC/EUR data,
decision/quote timing, fills, and risk mechanics:

| Arm | Treatment |
| --- | --- |
| Reference | Existing `CONFIRM2_COOLDOWN10` |
| Challenger | This candidate |
| Control | EUR cash/no-trade |

The eventual report must include net return, drawdown, observation/elapsed
coverage, blocked-entry counts by reason, completed and open round trips,
exposure time, turnover, and fees and slippage separately. The compatible
future replay integration in #1309 must model 20 bps taker fee per side and
10 bps slippage per side; neither cost may be combined or silently netted
against the other. The historical 50 bps evidence and current ledger exports
are immutable and must not be rewritten or relabeled. Cash is a control, never
a successful active strategy. No report from synthetic fixtures is a market
result.

## Evidence and launch blockers

- The existing completed eight-hour paired run is development evidence, not an
  independent validation or a reason to assert this candidate is live.
- No historical sweep, threshold tuning, leverage increase, or size increase
  is part of this hypothesis. Keep the candidate and the current strategy in
  independent PAPER campaigns; do not share balances.
- Before replay comparison, integrate this adapter through the separate #1309
  compatible fee/replay path and reporting contract without changing the
  protected forward/host, shared core, replay, or DTO files in this change.
- A new run requires a reviewed source pin, fixed 24-hour window and account
  contracts, independently confirmed operational bounds, and review/CI before
  integration. This module does not authorize acquisition, launch, deployment,
  real orders, campaign reset, or auto-promotion.
- A later chronological out-of-sample and forward evaluation is required. The
  observed eight-hour run is development evidence, not that holdout.

## Focused validation

```sh
node --test test/spot-paper-research-five-minute-trend.test.js
```

The fixtures validate UTC aggregation, gaps/duplicates/order, closed-bar
causality, warmup, trend pass/fail, confirmation composition, blocked reasons,
and unchanged exits/risk application. They are synthetic code-path tests only.
