# Paper Bot Profit Special Agent V2 — Frozen Research Redesign

Status: **RESEARCH ONLY**  
Execution impact: **false**  
Parent evidence: `PAPERBOT-PROFIT-DISCOVERY-V1-RESULT.md`  
Issue: #243

## Why V2 exists

V1 produced no candidate that cleared the pre-committed profit/stability gate. Donchian Trend V1 was positive (+2.75%) but did not meet Profit Factor or chronological-stability requirements; both TSMOM variants were negative. V2 therefore does **not** loosen V1 thresholds and does **not** retune V1 parameters.

V2 tests new hypotheses motivated by external evidence published independently of the V1 result.

## Research priorities

### Lane A — UP-UP risk-managed momentum proxy

Motivation:
- 2025 state-transition evidence reports cryptocurrency momentum concentrated in persistent UP→UP market regimes.
- 2025 risk-managed momentum evidence reports improved return and Sharpe after volatility scaling.
- 2026 realistic-assumption evidence remains much more supportive of time-series than cross-sectional momentum, so this lane is explicitly a **proxy/challenger**, not presumed edge.

Frozen rules:
- daily public-price data, evaluated every 7 days;
- same fixed 8-asset large-cap/liquid universe: BTC, ETH, SOL, XRP, HBAR, LINK, AVAX, SUI;
- market state = equal-weight universe cumulative return over the prior 28 daily closes;
- a rebalance is active only when both the current and previous weekly market states are UP;
- formation return = 14 daily bars ending one daily bar before rebalance (1-bar skip);
- rank available assets by formation return;
- long top 25%, short bottom 25%, equal weight within each side; gross raw exposure = 1.0;
- no position outside UP-UP;
- volatility scale uses only prior realized strategy returns: trailing 8 weekly observations;
- warm-up: no position until 8 prior weekly raw strategy returns exist; flat weeks are included as zero returns;
- target annualized strategy volatility = 10%;
- max gross leverage = 2x;
- modeled turnover cost = 8 bps;
- no martingale, averaging down or pyramiding.

Because historical market-cap weights are unavailable in the current bridge, this is **not an exact replication** of the cited value-weighted studies.

### Lane B — simple delta-neutral funding carry

Motivation:
- funding is an observable cash-flow mechanism rather than a directional price forecast;
- 2026 cross-venue evidence finds persistent funding differentials, while also finding that complex timing refinements need not beat a simple baseline.

Frozen design target:
- long spot + short perpetual, equal notional;
- public funding history only;
- report funding, basis change and transaction costs separately;
- compare always-on simple carry with the existing MERIDIAN cost-coverage gate;
- no yield annualization from a single observation;
- no borrowing or venue assumptions may be silently omitted;
- if historical basis/fee coverage is incomplete, fail closed rather than infer profit.

Lane B is not allowed to reuse a headline funding rate as realized PnL.

### Lane C — adaptive grid, deferred

Grid remains a range-regime tool. It may be tested only after a range classifier is frozen independently. OHLC-only grid replay has intrabar-order ambiguity and therefore cannot be promoted as exact execution evidence.

### Lane D — market making / XEMM, deferred

Requires order-book depth, maker/taker fee tier, latency, fill probability and adverse-selection telemetry. Daily/4h bars are insufficient.

## V2 profit gate

The same V1 profit gate remains unchanged:

- periods >= 24
- net compounded return > 0
- Profit Factor >= 1.15
- max closed-equity drawdown <= 25%
- at least 3 of 5 chronological windows positive
- at least 4 positive assets where the strategy has asset-level attribution
- no single positive asset > 50% of positive PnL

For a market-neutral carry strategy, breadth is evaluated by independently positive carry assets rather than directional asset PnL.

## Mandatory benchmarks

Directional V2 must report:
- equal-weight buy-and-hold return over the same eligible timestamps;
- BTC buy-and-hold over the same eligible timestamps;
- active-week share;
- long and short contribution;
- turnover and total modeled costs.

A high absolute return caused only by market beta is not sufficient to call the strategy an edge.

## Promotion policy

A V2 discovery pass only authorizes an independent holdout. Holdout parameters and universe are frozen before results. No live bot settings change automatically.

## Sources frozen with the hypothesis

- Han, Kang & Ryu, *Momentum in the Cryptocurrency Market: A Comprehensive Analysis under Realistic Assumptions*, RAPS accepted, revised 2026: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565
- *Cryptocurrency market risk-managed momentum strategies*, Finance Research Letters 85 (2025): https://www.sciencedirect.com/science/article/pii/S1544612325011377
- *State transitions and momentum effect in cryptocurrency market*, Finance Research Letters 86 (2025): https://www.sciencedirect.com/science/article/pii/S1544612325016101
- Grobys et al., *Cryptocurrency momentum has (not) its moments* (2025): https://link.springer.com/article/10.1007/s11408-025-00474-9
- Lau, *The Funding Carry and a Cross-Venue Spread on Perpetual Futures* (2026): https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6993978
- Binance Trading Bots guide (updated 2026): https://www.binance.com/de/academy/articles/your-guide-to-binance-trading-bots
- Pionex Futures Grid guide (reviewed 2026): https://www.pionex.com/blog/futures-grid/
- Hummingbot Cross-Exchange Market Making documentation: https://hummingbot.org/strategies/v1-strategies/cross-exchange-market-making/
