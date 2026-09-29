# Paper Bot Profit Special Agent V2 — Frozen Redesign

Status: **RESEARCH ONLY**  
Execution impact: **false**  
Issue: #243  
Predecessor: `PAPERBOT-PROFIT-SPECIAL-AGENT-V1-FROZEN`

## Why V2 exists

The first untouched V1 discovery run produced no passing candidate. Donchian Trend V1 was the only positive-return strategy (+2.75%) but failed the pre-committed Profit Factor and chronological-stability gates. TSMOM Classic and Persistent TSMOM V1 were negative. V1 thresholds are not relaxed and V1 parameters are not retuned.

V2 is therefore a separately named, separately frozen research redesign.

## External evidence used before freezing

The redesign is motivated by evidence available before any V2 result is inspected:

- Risk-managed cryptocurrency momentum has outperformed plain momentum in recent published work, with improved return and Sharpe after volatility scaling.
- Recent state-transition evidence reports that crypto momentum profitability is concentrated in persistent UP→UP regimes.
- Adaptive trend research in crypto combines trend-following, volatility management and an asymmetric long/short capital split that reflects the positive long-run drift of crypto assets.
- Static Grid is range-dependent. Recent dynamic-grid research starts from the observation that a traditional static grid has near-zero expected value under simple assumptions and only reports improvement after regime-adaptive resets.
- Martingale/DCA remains excluded as the default profit-maximization route because exposure mechanically increases into adverse moves.
- Funding Carry remains attractive as a separate diversifier, but only after complete historical funding, basis and fee data are available.

## Frozen V2 candidates

### A — ASYMMETRIC DONCHIAN V2

Purpose: retain the only V1 family with positive discovery return while changing portfolio construction, not the breakout thresholds.

Rules:
- daily bars
- 55-day breakout entry
- 20-day opposite-channel exit
- evaluation every 7 days
- 60-day realized-vol estimate
- 10% annualized target vol
- 2x per-asset research leverage cap
- 8 bps turnover cost
- when both sides are active: 70% gross risk budget to LONG, 30% to SHORT
- when only one side is active: the available side may use 100% of the gross risk budget
- within each side, allocation is proportional to volatility-scaled absolute position
- no pyramiding, no averaging down, no martingale

### B — UP-REGIME DONCHIAN V2

Purpose: test the published state-persistence hypothesis without changing the underlying 55/20 breakout family.

Rules:
- daily bars
- LONG only
- same 55-day entry / 20-day exit
- same 7-day evaluation
- same 60-day vol estimate, 10% target vol, 2x cap, 8 bps turnover cost
- a new/continued LONG is allowed only when both the asset and BTC market filter are in a frozen persistent-UP state
- persistent-UP state requires:
  - close above the trailing 200-day simple moving average;
  - current trailing 30-day return > 0;
  - immediately preceding 30-day return > 0
- if the regime filter fails, exposure is closed at the next evaluation point
- no SHORT substitution is allowed

## Profit gate

The V1 gate remains unchanged:

- at least 24 evaluation periods
- net compounded return > 0
- Profit Factor >= 1.15
- max closed-equity drawdown <= 25%
- at least 3 of 5 chronological windows positive
- at least 4 assets with positive net PnL
- no single positive asset contributes > 50% of positive candidate PnL

Among passing V2 candidates, the discovery leader is the candidate with the highest net compounded return. Discovery leader is not promotion.

## Anti-overfitting rules

- This file and the V2 implementation must be committed before the first real V2 discovery result is inspected.
- No threshold may be altered after seeing the V2 discovery result.
- Costs may be increased for stress tests, never reduced to rescue a candidate.
- Assets may not be removed after seeing results.
- If no V2 candidate passes, the decision is `RESEARCH_REDESIGN`; do not relax the gate.
- Any passing candidate must face a separate immutable holdout before paper-shadow.
- No live bot, leverage, Pionex or OKX setting may be changed by this research.

## Deferred tracks

### Funding Carry V3
Build only when historical funding + executable basis + fees are complete enough for a true net-carry replay.

### Dynamic Grid V1
Build only with intraday path-aware simulation. Daily OHLC cannot reliably determine the sequence of multiple grid fills inside the same candle, so using it would create false precision.

### Adaptive 6h Trend
Potential V3 candidate. Requires an explicitly frozen 6h implementation and enough common-history data across the selected universe.

Research only. No auto-promotion. No execution side effects.
