# PAPER EDGE V1 — IMPLEMENTATION CONTRACT

Status: FROZEN BEFORE FIRST DATASET PNL INSPECTION  
Ruleset: `PAPER-EDGE-V1`  
Execution impact: false

This document resolves implementation ambiguities in the already-frozen preregistration before any Discovery PnL is produced.

## Market data

- Universe is exactly BTCUSDT, ETHUSDT, SOLUSDT USD-M perpetuals.
- Decision bars are completed 4h UTC bars.
- Daily regime bars are deterministically aggregated from those same completed 4h bars.
- A 4h decision may use only the most recent UTC daily bar whose close timestamp is strictly earlier than the decision bar open timestamp.
- Source window is fixed at 2021-01-01T00:00:00Z through 2026-09-30T23:59:59.999Z. Evaluation begins only after indicator warm-up and common-time alignment across all three assets.
- Missing/duplicate/non-finite bars or incomplete authoritative funding coverage make the affected evaluation fail closed.

## Pullback and entry convention

- The pullback bar is the first completed 4h bar satisfying the frozen EMA20/EMA50 pullback rule after eligibility.
- Its low (LONG) or high (SHORT) is the frozen pullback swing extreme.
- Only the next 3 completed 4h bars may trigger.
- Trigger requires a completed-bar close beyond the pullback high (LONG) or low (SHORT).
- Entry is the next completed 4h bar's OPEN, never the trigger close. If no next bar exists, no trade is opened.
- Slippage is charged adversely exactly once on each executed fill.

## Funding convention

- Funding events are authoritative exchange records for the same perpetual symbol.
- A funding event applies only when its timestamp is strictly after entry and at or before exit.
- Funding cash flow sign is negative for a LONG paying a positive rate and positive for a SHORT receiving it; negative rates reverse the sign.
- Without exact mark-price history at each funding timestamp, funding notional is frozen to the then-open quantity times the entry fill price. This conservative/simple convention may not be changed after first PnL inspection.

## Exit ordering

- Gap-through stop fills at the worse bar open.
- If stop and target are reachable in the same bar, STOP is evaluated first.
- TP1 closes 33%, TP2 closes 33%, remainder is 34%.
- After TP1, stop moves to entry.
- After TP2, the remainder uses the frozen 2 ATR trailing rule.
- Opposite completed daily regime closes the remainder at the next 4h open.

## Accounting lock

The exact normalized-equity, fill-order, funding-order, split-boundary, five-window, Profit-Factor, expectancy and drawdown conventions are frozen in `PAPER-EDGE-V1-DISCOVERY-ACCOUNTING.md` before the first dataset PnL inspection. Those conventions clarify implementation only; they do not alter any preregistered threshold, cost assumption, universe, timeframe, entry, exit or split.

## Isolation

The 60/20/20 common-time split is fixed. Holdout remains inaccessible until Discovery and Validation both pass their frozen gates. Discovery positions are closed at the Discovery boundary rather than consuming Validation prices. This contract may not be modified to rescue a result.
