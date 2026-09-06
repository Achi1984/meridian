# MERIDIAN FIB Level Bot V3 — Prospective Holdout Protocol

Status: LOCKED PROSPECTIVE RESEARCH — NO PROMOTION — NO EXECUTION IMPACT.

This protocol is committed before any candle at or after the holdout start is evaluated.

## Frozen candidate

The candidate is exactly FIB Level Bot V3 at strategy head `7b15a8b37431af317bc5d8b50ef960024b353982`:

- confirmed two-left / two-right UTC Daily pivots;
- Daily swing anchors with 4h order evaluation;
- equal 25% entries at 0.382 / 0.500 / 0.618 / 0.786;
- stop 1.000;
- TP1 0.236 for half, TP2 0.000 for the remainder;
- 0.10% round-trip friction;
- BTC, ETH, SOL, XRP, ADA, AVAX, LINK;
- no indicator, regime, asset or side entry gate.

No code or parameter affecting signals, sizing, fills or exits may change inside this holdout.

## Time lock and cadence

- Holdout starts `2026-09-06T14:15:00Z`.
- Warm-up/history before the cutoff may construct confirmed anchors but may not contribute a result.
- No candle earlier than the cutoff counts as a prospective trade result.
- Evidence snapshots are append-only observations, not tuning rounds.
- Formal decision is prohibited until both conditions hold:
  1. at least 180 calendar days have elapsed; and
  2. at least 100 baskets have closed.
- Earliest calendar eligibility: `2027-03-05T14:15:00Z`.
- If 100 baskets are not closed by then, observation continues.
- Interim snapshots may report operational/data integrity only. They cannot justify strategy changes or promotion.

## Final required evidence

At eligibility, report:

- PF, expectancy, net R, max drawdown, win rate;
- setup count, fill rate, open/unfilled maps and time in market;
- LONG and SHORT;
- all seven assets and core/expansion;
- descriptive regimes;
- chronological thirds;
- positive-net-R concentration;
- comparison with the locked historical V3 evidence without blending samples.

Cohorts below 30 baskets are descriptive. Asset cohorts below 15 baskets are descriptive.

## Predeclared prospective gate

All must pass:

1. at least 100 closed baskets and 180 elapsed days;
2. PF >=1.10 and expectancy >0;
3. all three chronological thirds PF >1 and expectancy >0;
4. LONG and SHORT each PF >1 and expectancy >0 with n >=30;
5. at least five of seven assets PF >1 and expectancy >0 with n >=15;
6. core and expansion expectancy non-negative;
7. no asset contributes more than 40% of positive net R;
8. prospective max drawdown <=20R;
9. data coverage is complete enough for every included 4h candle to be reproducible.

Passing permits review only. It does not permit automatic promotion, Paper/live execution, merging into production, or changes to Pionex.

## Failure and integrity rules

- A failed gate stops promotion; it must not trigger threshold, asset, side, regime, pivot or FIB-level tuning.
- Missing/incomplete candles fail data adequacy; they are never silently interpolated.
- Open baskets at cutoff remain open and are not force-closed for a favorable snapshot.
- Evidence artifacts record cutoff, exact strategy SHA, source and digest.
