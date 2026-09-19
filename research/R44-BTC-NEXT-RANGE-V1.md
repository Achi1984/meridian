# R44 — BTC NEXT RANGE / COMPOUND V1

Status: **RESEARCH ONLY**. No execution impact.

## Hypothesis
After a BTC grid TP/profit event, hold proceeds as reload reserve and wait for a confirmed pullback instead of immediate re-entry.

## Signal
Daily trend filter (EMA20/50/200) + 4h RSI(14) + MACD(12,26,9) momentum + recent 4h swing Fibonacci 0.382/0.5/0.618/0.786 + ATR-scaled proposed range. All decisions use closed bars only.

## Required comparison
1. Immediate re-entry after TP.
2. NEXT RANGE V1.
3. BTC buy-and-hold reference.

Report event count, re-entry rate, wait time, return, PF, max drawdown / adverse excursion, and opportunity cost. Evaluate chronologically and with untouched holdout data. Do not promote to Paper unless sample size and out-of-sample stability are adequate.

## Guardrails
No look-ahead; fees/slippage included; no optimization on holdout; 1D controls regime and 4h controls timing. Funding/OI can be added only where point-in-time historical data is available without survivorship/look-ahead contamination.
