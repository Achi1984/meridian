# Cross-Sectional Reversal V1 — Preregistration

Status: **PREREGISTERED — NO HISTORICAL CANDIDATE RESULT INSPECTED**

## Hypothesis
Test whether medium-horizon cross-sectional loser-minus-winner ranking contains reproducible forward-return information in MERIDIAN's liquid crypto universe.

This is a new orthogonal research lineage. It is not a rescue, retune, or parameter variant of Low-Volatility V2, Taker Flow V1/V2, QH Strategy V1/V2, TSMOM, Regime Trend Breakout, or FIB.

## External evidence lock
Evidence reviewed before this preregistration:
- Zaremba et al., International Review of Financial Analysis (2021): reversal/momentum effects are liquidity-dependent; the most tradeable coins can behave differently from the broad illiquid universe.
- Nakagawa & Sakemoto, Finance Research Letters (2025): conventional reversal is not uniformly profitable across formation horizons; behavioral anchor variants show stronger results.
- Kiefer & Nowotny SSRN (2026): reports cross-sectional reversal over 8–10 week formation windows on Binance USDT spot pairs; volatility conditioning is reported but is NOT adopted here as a tuned gate.
- Arefev SSRN (2026): recent tradable-perpetual momentum replication does not find net-of-costs significance, supporting testing reversal separately rather than assuming momentum.

## Frozen V1 feature question
Before any strategy portfolio/PnL design, test only whether an 8-week completed-return ranking predicts the next 1-week cross-section.

- formation: exactly 8 completed UTC weeks
- outcome: next completed UTC week
- ranking direction: lower formation return should predict higher next-week return
- weekly anchor: Saturday 00:00 UTC
- feature: simple open-to-open formation return using only timestamps available before anchor
- outcome: exact anchor-to-next-anchor open-to-open return
- no volatility, sentiment, funding, taker-flow, trend, regime, FIB, liquidity-alpha, ML or interaction filter
- no asset/side removal after results
- no portfolio weights, leverage, costs, turnover, PF, Sharpe, drawdown, Paper or live PnL at this stage

## Universe/source contract
A later implementation PR must freeze a liquid, reproducible source universe and exact public source before historical validation. It must not choose constituents based on candidate reversal returns.

Assets require complete formation and outcome observations at every evaluated anchor. Missing/incomplete anchors fail closed rather than being imputed.

## Feature validation metrics
A later implementation PR must freeze exact sample dates and source identity before evaluation and compute:
1. weekly cross-sectional Spearman Rank IC between negative formation return and next-week return;
2. weekly bottom-minus-top rank spread using fixed equal-count groups defined before evaluation;
3. Newey-West significance with lag fixed before evaluation;
4. chronological block sign consistency;
5. exact week/asset completeness.

Exact numeric PASS thresholds, block count, universe, sample endpoints and group count must be frozen in that implementation PR before any historical candidate result is evaluated.

## Decisions
PASS => `REVERSAL_V1_FEATURE_PASS_STRATEGY_DESIGN_ALLOWED` only.
FAIL => `REVERSAL_V1_FEATURE_FAIL_RESEARCH_STOP`.

A PASS does not authorize portfolio PnL, Paper, live or automatic promotion.

## Anti-tuning
- no switching from 8 weeks after seeing results
- no volatility-conditioned rescue
- no liquidity-conditioned rescue
- no winner/loser asymmetry rescue
- no long-only rescue
- no excluding failed assets or periods
- any materially different hypothesis requires a new lineage and new preregistration before evidence

## Safety
researchOnly=true
executionImpact=false
autoPromotion=false
paperAuthorized=false
liveAuthorized=false

No credentials, orders, wallet/exchange mutation, production bot mutation, sizing mutation or UI ranking mutation.
