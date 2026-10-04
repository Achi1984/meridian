# PAPER EDGE V1 — DISCOVERY ACCOUNTING LOCK

Status: FROZEN BEFORE FIRST DATASET PNL INSPECTION  
Ruleset: `PAPER-EDGE-V1`  
Stage: `DISCOVERY` only  
Execution impact: false

This document resolves accounting and split-boundary ambiguities without changing the frozen strategy, universe, thresholds, costs, split, or gates.

## Normalized research equity

- Initial research equity is exactly 100,000 USDT.
- Per-trade risk remains exactly 0.50% of current baseline research equity at entry.
- Derivative positions do not consume notional cash. Fees, slippage, realized PnL, and funding change cash/equity.
- Open positions are marked to the current completed 4h close for the baseline equity curve and drawdown.
- Stress statistics reuse the identical frozen trade path and quantities; only the preregistered stress fee/slippage assumptions change.

## Bar event ordering

For each completed 4h bar, the deterministic order is:

1. At bar open, close any existing position whose completed daily regime is now opposite.
2. At bar open, execute gap-through stops at the worse bar open.
3. Execute any entry that was triggered by the prior completed bar. Entry is exactly this bar open.
4. Apply target gaps already reachable at the bar open at the frozen target price; STOP always has priority over targets.
5. Apply authoritative funding events with timestamps strictly after entry and within the bar to the quantity still open after open-time events.
6. Evaluate the remaining intrabar high/low path with the frozen STOP-first convention, then TP1 and TP2. If TP1 activates the break-even stop and that same bar also spans the new entry-price stop, the remaining quantity is conservatively closed at entry before TP2; the bar path is not guessed in favor of the target.
7. At bar close, update the 2 ATR trail only after TP2.
8. Only after the bar is completed may it become a new pullback/trigger observation.

A pullback candidate owns its next three completed 4h trigger bars. Overlapping replacement pullbacks are not opened inside that active three-bar trigger window. If the window expires without a trigger, search resumes on the following completed bar.

## Fill and cost accounting

- Entry, target, opposite-regime, forced-boundary and stop exits each count as one executed fill.
- Baseline cost per fill side is 5 bps fee + 3 bps adverse slippage.
- Stress cost per fill side is 8 bps fee + 8 bps adverse slippage.
- Target fills use the frozen target price. Gap-through stop fills use the worse bar open.
- Opposite-regime exit uses the next 4h open.
- Funding uses the frozen entry-price notional convention and the quantity remaining at the funding event. A funding event on the bar-open boundary, including the locked source's audited <=1-second exchange timestamp jitter, applies only to a position that survived the open-time exit checks and was already open before that boundary. A new entry at that bar open is excluded from the boundary funding event.

## Discovery isolation

- The 60/20/20 split is computed once from common BTC/ETH/SOL 4h timestamps.
- Source validation may verify the full frozen source package, and the split function may read timestamps needed to establish the fixed boundaries.
- After the Discovery boundary is known, the PnL engine receives only bars and funding at or before the Discovery boundary. Validation and Holdout values are not passed to the simulation.
- Any Discovery position still open at the final Discovery bar is force-closed at that completed bar close, with the normal baseline/stress fill costs. No trade may consume Validation or Holdout prices to finish a Discovery result.

## Frozen statistics

- A closed trade is one entry through final exit, including all partial fills and funding.
- Net trade PnL includes realized price PnL + funding - all fill costs.
- Profit Factor is total positive closed-trade net PnL divided by absolute total negative closed-trade net PnL.
- Expectancy R is mean closed-trade net PnL divided by that trade's initial cash risk.
- Max drawdown is measured on the baseline marked-to-market equity curve.
- The five chronological windows are five contiguous, near-equal-count slices of Discovery common timestamps. A trade belongs to the window containing its final exit timestamp. A window is positive only when its summed closed-trade net PnL is greater than zero.
- Positive-PnL concentration is the largest positive per-asset net PnL divided by the sum of all positive per-asset net PnL.
- Side and asset Profit Factors use the same closed-trade net PnL convention.
- Integrity is fail-closed unless baseline and stress ending cash reconcile to initial equity plus the sum of their respective closed-trade net PnL, trade IDs are unique, and every entry/final exit remains inside the authorized Discovery interval.

No statistic in this document changes any preregistered pass/fail threshold. Any later change to these conventions requires a new ruleset rather than rescuing V1 after result inspection.
