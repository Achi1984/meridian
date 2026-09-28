# Paper Bot Profit Special Agent V3 — Frozen 6h Adaptive Regime Trend

Status: **RESEARCH ONLY — FROZEN BEFORE RESULT**  
Execution impact: **false**  
Issue: #243  
Predecessor decision: `V2 HOLDOUT_FAIL_RESEARCH_REDESIGN`

## Objective

Increase the number of independent observable trend decisions while retaining the strongest V2 feature: trading only in persistent bullish regimes. V3 is a new hypothesis, not a rescue of V2.

## Evidence basis fixed before results

- Recent crypto research finds risk-managed momentum can improve return and Sharpe relative to plain momentum.
- State-transition research finds crypto momentum concentrated in persistent UP→UP regimes.
- Recent AdaptiveTrend research reports strong out-of-sample results from 6-hour trend following combined with volatility-aware risk management and adaptive portfolio construction.
- V2 itself produced positive discovery and transfer-universe returns but insufficient holdout sample density.

## Candidate — ADAPTIVE_UP_TREND_6H_V3

### Data
- 6-hour completed OHLCV bars
- discovery trade universe: `BTC ETH SOL XRP HBAR LINK AVAX SUI`
- public Binance USDT history
- no synthetic backfill
- minimum 1,500 completed 6h bars per asset

### Market regime
Both BTC and the traded asset must satisfy all conditions using only completed bars before the next trade decision:
- close above 200-bar SMA
- current trailing 120-bar return > 0
- immediately preceding 120-bar return > 0

At 6h resolution, 120 bars represent roughly 30 days.

### Entry
LONG only:
- current close breaks above the highest high of the previous 40 completed 6h bars
- regime filter is true for both BTC and the asset
- no same-bar high/low look-ahead: the breakout channel excludes the current bar

### Exit
Exit at the next bar close if any is true:
- close falls below the lowest low of the previous 20 completed bars;
- BTC or asset persistent-UP regime becomes false;
- volatility trailing stop is breached.

### Volatility trailing stop
- ATR(20) using completed 6h bars
- stop anchor is the highest close observed since entry
- stop distance = 3 × ATR(20)
- stop is evaluated on close only in V3 to avoid invented intra-candle fill ordering
- stop never loosens while a position is open

### Risk / portfolio
- 60-bar realized-vol estimate
- 10% annualized target volatility per active asset
- 2x per-asset research leverage cap
- equal-risk allocation across active assets after volatility scaling
- no shorts
- no pyramiding
- no averaging down
- no martingale
- no position if required data are missing

### Costs
- 10 bps modeled one-way turnover cost
- costs applied on entries, exits and weight changes
- stress tests may increase costs but never reduce them

## Frozen discovery gate

A V3 candidate passes discovery only if all are true:
- at least 100 active evaluation periods
- net compounded return > 0
- Profit Factor >= 1.20
- max closed-equity drawdown <= 20%
- at least 4 of 5 chronological windows positive
- at least 5 assets with positive net PnL
- no single positive asset contributes > 40% of positive candidate PnL

A pass is **discovery only**.

## Validation ladder

1. Frozen V3 discovery on the 8-asset discovery universe.
2. If and only if discovery passes, freeze a non-overlapping transfer-universe holdout before observing it.
3. A holdout pass permits paper-shadow/forward observation only.
4. No automatic or live promotion.

## Anti-overfitting

- No V3 parameter changes after the first real discovery result.
- No asset removal after result inspection.
- No cost reduction to rescue performance.
- No gate relaxation.
- If V3 fails, record failure and redesign under a new ruleset.

Research only. No live orders. No changes to Pionex/OKX bots or live risk logic.
