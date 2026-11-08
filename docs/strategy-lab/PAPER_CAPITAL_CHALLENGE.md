# USD1000 Paper Capital Challenge

## Status and scope

This is offline, disabled policy/guard groundwork for a separate virtual USD
campaign. It does not launch a portfolio, acquire market data, place orders,
or claim an optimized or profitable strategy. It is not the BTC/EUR spot pilot
and does not change that pilot, its evidence, or its deployment.

The versioned policy in
`scripts/paper-capital-challenge/policy.mjs` fixes a distinct campaign identity,
USD 1,000.00 initial capital, and a USD 100.00 absolute high-water drawdown
threshold. It is paper-only, disabled, and prohibits leverage, borrowing,
top-ups, and resets. EUR is not USD; no implicit or 1:1 FX conversion is
permitted. Future integration must admit actual USD-denominated valuations.

The guard is deliberately not wired to a strategy or execution path. Its
exposure gate remains closed while the policy is disabled. A threshold pause
is a durable-in-the-replayed-history latch; this module has no clear, reset, or
auto-resume operation. It reports whether the challenge gate is blocked, but
does not authorize an order or verify an execution.

## Observation and valuation contract

Each uniquely identified observation is bound to the exact campaign and USD
currency, includes its strategy version and observation time, and supplies a
fresh valuation with a source identifier and quote/valuation timestamps. New
observations must be strictly ordered by observation time. An exact repeated
observation ID is idempotent; reusing an ID with different content or adding a
new out-of-order observation is rejected. Missing, stale, future-dated, unsafe,
or currency-mismatched valuations fail closed and cannot update the peak.
Valuations must be no older than the policy's 10-second maximum age; that bound
is an admission constraint, not evidence that any future feed meets it.

`netEquityCents` must equal:

```
cashCents
+ inventoryAtAdverseBidCents
- unbookedAccruedFeesCents
- modeledExitCostsCents
```

`cashCents` is cash after already-booked costs. Inventory is valued at the
executable adverse bid, before the separately reported costs. Accrued fees
must include only fees not already reflected in cash or inventory value;
modeled exit costs must include only additional liquidation costs not already
included in the bid mark or accrued fees. Each cost is included once. The
valuation method and component sum are checked by the guard, which does not
reconstruct inventory, verify a quote or source, or authenticate caller
provenance. A future adapter must provide the executable adverse-bid mark,
correctly account for booked and unbooked costs, and retain the evidence
needed to support those claims. A fresh timestamp alone is not quote evidence.

The high-water mark starts at USD 1,000.00, increases only when a replayed net
equity observation exceeds it, and never decreases. A drawdown greater than
or equal to USD 100.00 latches the pause; the triggering observation and full
overshoot remain visible. Pausing blocks increases in exposure and does not
flatten an open position. A future execution adapter may permit risk-reducing
exits only. Missing or stale valuations cannot authorize entry; callers must
fail closed rather than invent a quote, mark, or fill.

The state is derived by replaying the complete ordered observation ledger;
snapshots with caller-supplied high-water or pause fields are not accepted as
resume input. Persisting and recovering that ledger durably is not implemented
here. The replay guard cannot prevent an operator from deliberately starting
a new empty state; durable campaign identity, append-only journal wiring, and
restart admission are required before any operational use. The pause is based
on sampled observations, not a guaranteed maximum-loss bound: gaps, adverse
price moves, fees, and liquidation costs can produce larger losses before the
next accepted valuation. Such overshoots must remain visible and must not be
reset or hidden.

## Offline optimization protocol

No optimization has been run and no historical performance result is claimed.
Any future evaluation must preregister and preserve:

1. A frozen baseline strategy and a cash-only control using the same initial
   capital, timestamps, admitted observations, costs, and execution latency.
2. A fixed, versioned list of no more than 12 candidate configurations and a
   hard budget of one training run per listed candidate. No candidates may be
   added after results are seen; all attempted and rejected candidates remain
   in the ledger with rejection reasons.
3. Chronological data partitions and boundaries fixed before evaluation:
   training (earliest 60%), validation (next 20%), and a final 20% forward
   holdout. Tune strategy and risk choices on training only. Use validation
   only for the preregistered selection decision. Do not inspect or tune on the
   forward holdout until the candidate and protocol are frozen.
4. Immutable hashes/versions for the data, strategy, risk policy, costs,
   quote/valuation admission, and execution model, plus a complete ledger of
   candidate parameters, run outcomes, and exclusions. Compare baseline, cash
   control, and selected candidate on the same untouched forward observations,
   with equal capital, costs, and latency assumptions.
5. Report net return, peak drawdown, turnover, fees, open exposure, data gaps,
   and uncertainty. Keep unknown fill and liquidity evidence unknown; never
   invent profitable fills or tune fees to improve a result. The current
   BTC/EUR pilot's modeled 50 bps fee and 10 bps adverse slippage per side are
   unverified assumptions, not venue evidence and not USD campaign inputs.

Short wins are not evidence of profitability. Any result must preserve the
full candidate/rejected ledger and explain data and execution uncertainty;
without admitted historical data, no historical claim is justified.

## Integration gaps before any campaign use

- **USD feed and admission:** no USD market source, executable bid validation,
  timestamp admission, source provenance, or independent quote verification
  is connected to this policy.
- **Ledger and durable journal:** no separate USD cash/position ledger,
  append-only campaign journal, durable recovery, restart identity admission,
  or operator review workflow is wired.
- **Validation data:** there is no admitted USD observation dataset or
  preregistered baseline/cash-control run.
- **Execution evidence:** fills, liquidity, fees, slippage, gaps, and latency
  have no validated USD venue evidence or future execution adapter.

Until those gaps are addressed and separately reviewed, this remains a tested
offline policy/guard, not a running portfolio or a profitable strategy.
