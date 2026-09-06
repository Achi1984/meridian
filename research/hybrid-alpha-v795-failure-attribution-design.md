# MERIDIAN v7.95 — Failure-State Attribution Design

Status: RESEARCH ONLY. No execution, no promotion, no post-hoc asset deletion.

Objective: explain the materially negative middle 24h walk-forward fold of frozen Hybrid Alpha v7.93 using only features known at decision time.

Predeclared dimensions before reading v7.95 attribution output:
- SIDE: LONG / SHORT.
- REGIME: BULL / BEAR / RANGE / TRANSITION.
- MACRO ALIGNMENT: ALIGNED if side-signed macroTrend >= +0.20; OPPOSED if <= -0.20; NEUTRAL otherwise.
- TREND COHERENCE: 3_OF_3, 2_OF_3, or LE_1_OF_3 according to whether 15m/1h/4h trend signs agree with the selected side by at least 0.05.
- VOLATILITY: LOW <0.80, NORMAL 0.80–1.25, HIGH >1.25 using decision-time volatilityRatio.
- LIQUIDITY: LOW <0.50, OK >=0.50 using decision-time liquidityQuality.
- REVERSAL RISK: HIGH >=0.50, NORMAL <0.50.
- ALPHA STRENGTH: WEAK 0.20–0.35, MEDIUM >0.35–0.55, STRONG >0.55 using |alpha|.

Evaluation:
1. Attribute all 90d 24h v7.93 trades and each chronological fold across these states.
2. Report n, PF, expectancy, netR, win rate and DD where applicable.
3. A candidate failure state must be negative in the failing fold, have at least 12 trades there, and also show negative or clearly degraded behavior in at least one other temporal slice or in the full 90d sample. One-fold-only patterns are descriptive only.
4. Do not tune bucket boundaries, v7.93 factor 0.60, thresholds, or asset universe after reading results.
5. v7.95 itself changes no trading decision. A later v7.96 may test at most one predeclared soft attenuation only if v7.95 identifies a repeated structural failure state.

Frozen inputs: v7.93 decision logic, 24h primary horizon, 7-asset universe BTC/ETH/SOL/XRP/ADA/AVAX/LINK, 30/60/90d evidence windows, cost 0.03R per 1.0 risk unit.