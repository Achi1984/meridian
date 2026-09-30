# Regime-Gated Trend / Breakout V1 — Frozen Preregistration

Status: **FROZEN BEFORE RESULT INSPECTION**
Ruleset: `PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1`
Parent gate: `PAPER_PROFIT_CONTROL_V2_STAGE_B_GATES_FROZEN`
Execution impact: **false**
Auto-promotion: **false**

## Distinct hypothesis

Test whether a slow daily breakout strategy improves stability when entries are allowed only during a strong, directionally aligned trend regime.

This is not:
- a rescue of TSMOM V2;
- AdaptiveTrend Sharpe Proxy V1;
- Trend Pullback V1;
- Regime-Gated Grid V2.

No thresholds below are selected from those strategies' observed results.

## Frozen universe

- BTC
- ETH
- SOL
- XRP
- HBAR
- LINK
- AVAX
- SUI

No post-result asset removal.

## Frozen timeframe and source class

- daily completed public Spot OHLCV bars;
- same Binance public daily-kline source class used by the existing Paper Profit research path;
- no account/private data;
- no synthetic history.

Exact load window and implementation manifest must be committed before first candidate result.

## Frozen regime

Per asset, evaluated on completed daily bars only.

Trend-strength gate:
- Wilder **ADX(14) >= 25**.

Directional regime:
- LONG eligible only when close > **SMA(200)**;
- SHORT eligible only when close < **SMA(200)**.

If ADX or SMA history is unavailable, the asset is flat.

## Frozen breakout / exit

Entry:
- LONG when today's completed close is above the highest high of the prior **55** completed daily bars, while LONG regime is eligible;
- SHORT when today's completed close is below the lowest low of the prior **55** completed daily bars, while SHORT regime is eligible.

Exit:
- LONG when close is below the lowest low of the prior **20** completed daily bars, or LONG regime is no longer eligible;
- SHORT when close is above the highest high of the prior **20** completed daily bars, or SHORT regime is no longer eligible.

No same-bar lookahead: current-bar high/low is excluded from breakout channel construction.

## Frozen sizing

- 60-day realized-volatility estimate;
- 10% annualized target volatility per active market;
- maximum research leverage: **2x**;
- equal portfolio weighting across active normalized positions;
- no pyramiding;
- no averaging down;
- no martingale;
- no leverage escalation after losses.

## Frozen costs

- baseline turnover cost: **8 bps**;
- mandatory stress turnover cost: **16 bps**;
- same strategy parameters in both runs.

## Frozen split

Use the same Stage-B isolation rule as TSMOM V2:

- deterministic common-timestamp chronological split;
- first **70% Discovery**;
- final **30% Holdout**;
- split fixed before return evaluation;
- Holdout return path must not execute unless Discovery passes;
- insufficient split sample => `INSUFFICIENT_SPLIT_SAMPLE`;
- split may not be moved after results.

## Stage-B gate

Discovery and, if authorized, Holdout must independently satisfy all approved gates:

- >=30 evaluation periods;
- net compounded return > 0 at 8 bps;
- Profit Factor >= 1.15;
- max drawdown <= 20%;
- >=4/5 positive chronological windows;
- >=5/8 positive assets;
- positive-PnL concentration <=35%;
- 16-bps stress net compounded return > 0;
- provenance confirmed;
- holdout untouched before authorization.

## Result labels

- `REGIME_TREND_BREAKOUT_V1_DISCOVERY_FAIL`
- `REGIME_TREND_BREAKOUT_V1_DISCOVERY_PASS_HOLDOUT_REQUIRED`
- `REGIME_TREND_BREAKOUT_V1_HOLDOUT_FAIL`
- `REGIME_TREND_BREAKOUT_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED`

No label authorizes live execution.

## Anti-overfitting

After first result inspection, this version may not change:
- ADX period or threshold;
- SMA period;
- 55/20 channels;
- universe;
- volatility target/lookback;
- leverage cap;
- cost assumptions;
- split rule;
- Stage-B gate.

Any redesign requires a new ruleset and preregistration.

## External convention references

- Fidelity ADX overview: ADX above 25 is commonly interpreted as a strong trend.
- Classic Turtle System 2 convention: 55-day breakout entry / 20-day opposite-channel exit.

These conventions are used as preregistered structure, not as evidence that this crypto candidate will pass.
