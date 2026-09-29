# Paper Bot Market Scan — 2026-09-28

Status: research input for MERIDIAN Profit Special Agent.  
Objective: maximize **net, out-of-sample paper profit** without hiding tail risk, costs or overfitting.

## Commercial bot families currently available

### Grid / Futures Grid
Examples: Pionex, Binance, OKX, Bybit, 3Commas.

Mechanic: place repeated buy/sell orders across a fixed or dynamic price band.

Research view:
- best matched to oscillating/range conditions;
- static grids are not a universal alpha source;
- futures variants add funding and liquidation risk;
- dynamic range/reset logic is more defensible but requires path-aware intraday simulation.

MERIDIAN status: **deferred until intraday path simulator + frozen range classifier**.

### DCA / Martingale
Examples: Pionex Martingale/DCA, OKX DCA, 3Commas DCA.

Mechanic: add exposure after adverse moves and seek recovery/rebound exits.

Research view:
- can create high apparent win rates;
- capital and tail exposure grow into persistent adverse trends;
- unsuitable as MERIDIAN's default profit-maximization engine without a hard bounded-loss design.

MERIDIAN status: **not a default candidate**.

### Trend / Signal bots
Examples: external-signal bots, trend-following systems, TradingView-driven bots.

Mechanic: wrapper executes an external edge; the bot itself is not the alpha.

Research view:
- strongest current evidence among directional families is for risk-managed momentum/trend;
- crypto momentum is regime dependent;
- recent evidence points to stronger momentum in persistent UP→UP states;
- volatility/risk scaling can materially improve risk-adjusted performance.

MERIDIAN status: **highest research priority**.

### Funding / basis arbitrage
Examples: delta-neutral spot/perpetual or cross-venue carry.

Mechanic: hedge directional exposure and harvest funding/basis spreads.

Research view:
- attractive independent return source;
- profitability depends on funding persistence, executable basis, fees, slippage and venue risk;
- complicated “smart” filters can overfit and should beat a simple baseline before adoption.

MERIDIAN status: **high priority independent diversifier; requires complete historical funding+basis replay**.

### Rebalancing / Smart Portfolio
Examples: Pionex Rebalancing, Binance Rebalancing.

Mechanic: restore target portfolio weights periodically or by threshold.

Research view: useful portfolio maintenance; not a standalone high-alpha thesis.

MERIDIAN status: **portfolio tool, not primary alpha engine**.

### Market making / cross-exchange market making
Examples: Hummingbot PMM/XEMM/perpetual market making.

Mechanic: quote maker orders and manage/hedge inventory.

Research view:
- potential spread capture;
- outcome depends critically on order-book depth, queue position, latency, maker/taker fees, fill probability and adverse selection;
- bar data are insufficient to validate it.

MERIDIAN status: **deferred until microstructure telemetry exists**.

### TWAP / slicing
Execution tools, not alpha strategies.

MERIDIAN status: **execution only**.

## Evidence synthesis

1. **Risk-managed crypto momentum:** recent Finance Research Letters evidence reports higher average weekly return and annualized Sharpe after risk management than conventional crypto momentum, including robustness to transaction costs and short-sale constraints.
2. **State persistence:** 2025 research finds crypto momentum concentrated in persistent UP→UP regimes.
3. **Adaptive trend:** a 2026 preprint reports strong out-of-sample results from 6h trend following, volatility-aware stops/selection and asymmetric allocation across 150+ pairs. Treat as promising preprint evidence, not proof.
4. **Momentum tail risk:** other research warns that crypto momentum can retain extreme tail risk even after volatility scaling.
5. **Survivorship:** momentum conclusions can weaken materially when survivor bias and universe construction are handled differently. Fixed major-coin tests must therefore be treated as partial evidence.
6. **Dynamic Grid:** recent research explicitly motivates dynamic resets because a static grid has near-zero expected return under simple assumptions; results depend strongly on regime and path.
7. **Funding Carry:** current research supports simple cross-venue funding spreads as a plausible independent return source, while emphasizing venue/time variation and the need for execution-aware costs.

## Current MERIDIAN evidence

- V1 TSMOM Classic: **-14.74%, FAIL**
- V1 Persistent TSMOM: **-18.97%, FAIL**
- V1 Donchian: **+2.75%, FAIL**
- V2 UP-Regime Donchian discovery: **+11.93%, PF 2.334, PASS**
- V2 transfer holdout: **+5.84%, PF 2.231, FAIL** only because 16 periods and 2/5 positive windows
- V3 Adaptive UP Trend 6h: **+19.40%, PF 1.175, FAIL** because PF<1.20 and 3/5 windows

The strongest internal family is therefore **regime-aware long trend**, but it has not yet cleared the full validation ladder.

## Next research priority

Use a genuinely different signal family and a separately frozen universe: **risk-managed cross-sectional momentum** with short crypto-specific formation/holding horizons, weekly rebalance and ex-ante volatility scaling.

This is a research proxy unless historical market-cap weights and full futures funding are available. Any result must disclose that limitation and cannot auto-promote.

## Sources

- Finance Research Letters (2025), Cryptocurrency market risk-managed momentum strategies:
  https://www.sciencedirect.com/science/article/pii/S1544612325011377
- Finance Research Letters (2025), State transitions and momentum effect in cryptocurrency market:
  https://www.sciencedirect.com/science/article/pii/S1544612325016101
- Grobys et al. (2025), Cryptocurrency momentum has (not) its moments:
  https://link.springer.com/article/10.1007/s11408-025-00474-9
- Bui & Nguyen (2026), Systematic Trend-Following with Adaptive Portfolio Construction:
  https://arxiv.org/abs/2602.11708
- Hummingbot strategy catalog:
  https://hummingbot.org/strategies/v1-strategies/
- Pionex bot documentation:
  https://www.pionex.com/blog/
- Binance trading bot documentation:
  https://www.binance.com/en/support/faq/c-5
- OKX trading bot documentation:
  https://www.okx.com/help/section/trading-bots
