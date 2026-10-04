# Paper Edge V1 — Frozen Preregistration

Status: FROZEN BEFORE RESULT INSPECTION
Ruleset: PAPER-EDGE-V1
Execution impact: false
Auto-promotion: false

## Objective
Find a directional Paper candidate with demonstrable net edge without tuning retired Baseline/V2/V3/V4 rulesets. Execution V2 remains a separate audit and cannot establish strategy profitability.

## Frozen hypothesis
Multi-timeframe trend-pullback continuation on BTCUSDT, ETHUSDT and SOLUSDT. Completed public perpetual OHLCV only. Decision timeframe 4h; daily regime filter. No synthetic history.

LONG regime: daily close above EMA200 and EMA50 above EMA200; SHORT exact inverse. On 4h require EMA20 above EMA50 for LONG (below for SHORT), a completed-bar pullback touching EMA20 without closing beyond EMA50, then within 3 completed bars a close beyond the pullback-bar high/low. ADX14 must be at least 20. One position per asset; no pyramiding, averaging down or martingale.

## Frozen risk and exits
Initial stop is the farther of pullback swing extreme or 1.5 ATR14. Risk per trade 0.50% research equity; aggregate open risk max 1.50%. TP1 +1R closes 33% then stop to entry; TP2 +2R closes 33%; remainder trails 2 ATR from favorable close. Opposite daily regime closes remainder. Gap-through uses worse open; same-bar ambiguity is stop-first.

## Frozen costs
Baseline 5 bps fee plus 3 bps slippage per fill side. Stress 8 bps fee plus 8 bps slippage per fill side. Historical perpetual funding must be included when authenticated coverage exists; otherwise verdict is INCONCLUSIVE rather than zero funding.

## Frozen split
Chronological common-time 60% discovery / 20% validation / 20% holdout. Holdout remains untouched until discovery and validation pass. Boundaries cannot move after results.

## Frozen gates for each authorized split
- at least 50 closed trades aggregate and 10 per asset
- net Profit Factor at least 1.20 baseline and 1.05 stress
- net expectancy above 0R
- max drawdown at most 12%
- at least 4 of 5 positive chronological windows
- all 3 assets non-negative net PnL
- positive-PnL concentration at most 50%
- LONG and SHORT each at least 15 trades; neither side PF below 0.90
- no unresolved data-integrity/accounting error

## Decisions
EDGE_V1_DISCOVERY_FAIL; EDGE_V1_DISCOVERY_PASS_VALIDATION_REQUIRED; EDGE_V1_VALIDATION_FAIL; EDGE_V1_VALIDATION_PASS_HOLDOUT_REQUIRED; EDGE_V1_HOLDOUT_FAIL; EDGE_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED.

No result authorizes live trading.

## Anti-overfitting
After first PnL inspection, no threshold, universe, timeframe, exit, cost, split or gate above may change inside V1. Any redesign requires a new ruleset/preregistration. Existing failed lineages must not be selectively imported after seeing V1 results.
