# Paper Bot Profit Special Agent V1 — Frozen Protocol

Status: **RESEARCH ONLY**  
Execution impact: **false**  
Issue: #243

## Objective

Maximize **net out-of-sample paper profit** while enforcing hard risk, cost, breadth and anti-overfitting constraints.

Raw profit alone is not an acceptable objective because leverage can raise both expected profit and liquidation/drawdown risk mechanically. Candidate ranking therefore uses net compounded return only **after** a fixed safety gate is passed.

## Market scan — what commercial bots actually do

Current exchange/platform bot families mostly fall into these mechanics:

- **Grid / Futures Grid** — repeatedly buy/sell inside a configured range. Best fit: liquid, oscillating/range markets. Main failure: price leaves the range; futures adds funding/liquidation.
- **DCA / Martingale** — adds exposure after adverse moves and exits after a rebound. Main failure: persistent trend against the position; capital and tail-risk grow with safety orders.
- **Rebalancing / Smart Portfolio** — periodically restores portfolio weights.
- **Signal bots** — execute external/indicator rules; the edge depends on the signal, not the wrapper.
- **Arbitrage / funding carry** — tries to harvest spot/perpetual or cross-venue carry/spread with hedged exposure.
- **Market making / cross-exchange market making** — captures spreads while managing inventory and adverse selection.
- **TWAP / slicing** — execution-cost tools, not alpha strategies.

## Evidence synthesis used to freeze V1

Recent crypto research is mixed on naive momentum but materially stronger for **time-series momentum with explicit risk management** than for generic cross-sectional momentum:

- Han, Kang & Ryu (accepted, RAPS; revised 2026) find strong time-series momentum evidence after more realistic assumptions, while cross-sectional momentum is weak.
- Grobys et al. (2025) show severe momentum crash/tail behavior and find volatility management useful.
- A 2025 Finance Research Letters study reports higher return and Sharpe for risk-managed crypto momentum than plain momentum.
- A 2025 state-transition study finds crypto momentum concentrated in persistent UP→UP regimes, motivating a state-persistence filter as a separate frozen hypothesis.
- Funding-carry evidence in 2026 supports a simple delta-neutral baseline but also shows strong venue/time variation; complicated refinements can overfit.
- Exchange documentation consistently describes Grid as a range/volatility strategy, not a universal trend strategy. Martingale/DCA explicitly increases exposure into drawdowns.
- Hummingbot documents market-making and cross-exchange hedged strategies, but these require order-book, latency and fill-quality data that MERIDIAN's current daily/4h research bridge does not provide.

## Frozen discovery candidates

### A — TSMOM CLASSIC
Existing MERIDIAN documented-edge baseline, unchanged:
- lookbacks 30 / 90 / 365 days
- rebalance every 30 days
- 60-day realized-vol estimate
- 10% annualized target vol per market
- 2x max research leverage
- 8 bps turnover cost

### B — PERSISTENT TSMOM V1
New hypothesis, frozen before results:
- same 30 / 90 / 365-day horizons
- position only if **all three** horizon signs agree
- no position when signs conflict
- same 30-day rebalance, 60-day vol estimate, 10% target vol, 2x cap and 8 bps cost
- both LONG and SHORT are retained; side attribution is diagnostic and cannot be removed post-hoc

### C — DONCHIAN TREND V1
Independent trend-following challenger:
- 55-day breakout entry
- 20-day opposite-channel exit
- weekly (7-day) evaluation
- 60-day realized-vol estimate
- 10% annualized target vol
- 2x max research leverage
- 8 bps turnover cost
- no pyramiding, martingale or averaging down

## Profit gate

A candidate is eligible to become a **discovery leader** only if all are true:

- at least 24 evaluation periods
- net compounded return > 0
- Profit Factor >= 1.15
- max closed-equity drawdown <= 25%
- at least 3 of 5 chronological windows positive
- at least 4 assets with positive net PnL
- no single positive asset contributes > 50% of positive candidate PnL

Among candidates that pass, the discovery leader is the one with the highest net compounded return. This is **not promotion**.

## Holdout / promotion rules

- Discovery and holdout must be separate.
- Holdout parameters are immutable.
- No asset may be removed after seeing results.
- Costs may only be increased for stress tests, never reduced to rescue a candidate.
- A discovery leader may advance only to paper-shadow/forward testing.
- No live execution, leverage, Pionex bot or OKX setting can be changed by this module.

## Deferred candidates

### Funding Carry V3
High priority, but requires a clean historical funding + basis + fee series. Reuse of current incomplete carry snapshots would create false precision.

### Adaptive Grid
Medium priority. Only test after a range-regime classifier is frozen. A generic always-on grid is explicitly rejected as a universal profit-maximizer.

### Market Making / XEMM
Deferred until order-book depth, maker/taker fees, latency, fill probability and adverse-selection telemetry are available.

### Martingale / aggressive DCA
Not included in V1. Increasing position size as price moves against the trade can maximize short-run win rate while worsening tail loss and capital requirements. It is not accepted as the default route to profit maximization.

## Sources

- Pionex Grid vs DCA/Martingale guidance (2026): https://www.pionex.com/blog/martingale-vs-grid-bot/
- Pionex Futures Grid risk/structure (reviewed 2026): https://www.pionex.com/blog/futures-grid/
- OKX bot families (2026): https://www.okx.com/de/help/what-are-okxs-crypto-trading-bots-and-how-do-i-utilize-it
- Binance bot families (2026): https://www.binance.com/en/academy/articles/your-guide-to-binance-trading-bots
- Hummingbot strategy catalog: https://hummingbot.org/strategies/v1-strategies/
- Han, Kang & Ryu, Momentum in the Cryptocurrency Market (revised 2026): https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4675565
- Grobys et al. (2025), Cryptocurrency momentum has (not) its moments: https://link.springer.com/article/10.1007/s11408-025-00474-9
- Cryptocurrency market risk-managed momentum strategies (2025): https://www.sciencedirect.com/science/article/abs/pii/S1544612325011377
- State transitions and momentum effect in cryptocurrency market (2025): https://www.sciencedirect.com/science/article/pii/S1544612325016101
- Lau (2026), Funding Carry and Cross-Venue Spread: https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6993978
