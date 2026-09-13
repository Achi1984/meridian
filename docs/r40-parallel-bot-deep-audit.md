# MERIDIAN R40 — Parallel Bot Deep Audit

Date: 2026-09-13. Scope: Paper/research only. No live execution and no automatic promotion.

## Decision summary

| Bot | Decision | Reason | R40 action |
|---|---|---|---|
| Baseline 6.2 | Frozen reference | PF 0.63, expectancy about -$28, max drawdown breached | Hard-freeze submissions; keep ledger readable |
| Shadow V1 | Retired | PF 0.44, dominated | No new cycles |
| Regime V1 | Retired | PF 0.32, negative edge and side conflicts | No new cycles |
| Challenger V2 | Sealed parent | PF 0.98, max drawdown 8.96% | Historical reference only |
| Challenger V3 | Continue unchanged | 19 closed trades is below the 20-trade first checkpoint; PF 0.67 and payoff remains weak | Preserve frozen entries/risk; add complete evidence capture |
| Challenger V4 | New paired shadow | Tests one causal exit change without score fitting | Mirror every future accepted V3 entry; 50% TP1, 50% TP2 runner, cost break-even protection |
| Funding Carry V1 | Continue to checkpoint | Current loss is reserved execution cost, not yet a failed carry cycle | No parameter changes or promotion |
| Funding Carry V2 | New gated shadow | V1's projected return is economically thin and its absolute-basis exit is flawed | Require executable bid/ask basis and conservative projected funding >= 2x round-trip costs |

## Directional findings

V3's technical score is already embedded in its candidate score and both are weighted again in confidence. Historical confidence buckets are negative and non-monotonic, so score and threshold tuning would be parameter fitting rather than a supported improvement.

The observable payoff asymmetry is the cleaner hypothesis: recent net winners are commonly below +1 budget-R while stops cost more than -1 budget-R after fees and slippage. R40 therefore changes no entry, asset, side, regime, risk or cooldown for V4. V4 is a virtual twin of accepted V3 positions and changes only the exit.

V4 evaluation is prospective:

- 20 matched closes: diagnostics only.
- 30 matched closes: retire if paired mean delta is non-positive, or V4 expectancy is non-positive with PF below 0.90.
- 50 matched closes: eligible only for a separate Paper trial when PF >= 1.10, net expectancy >= +0.05R, paired mean delta >= +0.10R and drawdown <= 6%.
- No profitability claim before at least 100 independent prospective trades and positive results in three of four chronological blocks.

The engine still observes periodic quotes rather than the complete intrabar path. R40 records this as an audit limitation; the paired design reduces entry confounding but does not prove same-candle target/stop ordering.

## Funding findings

V1 attribution at audit time was approximately funding +$5.12, basis +$0.22 and estimated costs -$31.81, explaining its roughly -$26.46 state. At the then-current 30-day funding history, gross funding projected near $59 against about $32 of V1 costs. That is not yet a failed cycle, but the implied return on $20,000 of conservatively bound capital is only about 1.7% annualized if the rate persists.

V1 limitations retained for its frozen comparison include one generic fee rate, mark/last rather than executable bid/ask entry, a 30-day forced review, and an exit based on absolute basis rather than basis change. V2 addresses these in a separate state:

- Spot fee 10 bps, perpetual fee 5 bps and slippage 3 bps per leg are frozen conservative assumptions.
- Entry uses spot ask and perpetual bid; marking/exit uses spot bid and perpetual ask.
- The lower of 7-day and 30-day projected funding must cover estimated four-leg costs by at least 2.0x.
- Funding history must be fresh, sufficiently complete and at least 85% positive.
- Basis exits use change from entry basis, not the absolute market basis.
- Duplicate settlement timestamps are idempotent within one payload and across restarts.
- Day 30 is a checkpoint; continuation can run to day 90 only while forward net carry remains economical.

With the audit-time funding history and conservative $42 cost estimate, V2 is expected to remain `WAITING_ENTRY` unless the robust carry improves. A rejected entry is the correct result, not inactivity to be tuned away.

## Engineering controls added

- Baseline submission is hard-frozen and no longer writes repetitive drawdown rejections.
- V3 now captures the same detailed evidence snapshot used for causal trade review and closes that evidence with the trade.
- V4 and Funding V2 use separate persistent state keys and immutable policy snapshots.
- Both new experiments expose minimized read-only data through Bot Observer V2.
- All experiments remain `researchOnly`, `executionImpact:false`, and `autoPromotion:false`.

## Remaining risks

1. V4 needs candle-path evidence for conservative stop-first ordering before any independent Paper promotion.
2. Funding V2 uses conservative fixed fee assumptions until account-tier fees and executable depth are available.
3. Margin/liquidation modelling remains incomplete; Funding V2 must not be promoted without explicit collateral and liquidation-buffer telemetry.
4. Mixed-risk directional decisions should ultimately use normalized budget-R alongside account-dollar truth.
