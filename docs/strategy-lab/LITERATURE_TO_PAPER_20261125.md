# Meridian research queue, 25 November 2026

These are Meridian hypotheses. A source supports a mechanism, not our thresholds or profitability. Run one variant per hypothesis first; retain cash, unchanged reference trades, exclusions and missing exits.

| Hypothesis | Decision available in real time | Comparator and rejection |
|---|---|---|
| Cross-venue confirmation | For BTC and ETH, timestamp OKX perpetual breakouts and independent Kraken spot candles. Require both markets to close beyond their own prior 24-hour boundary in the same direction. Begin with offline matched signals. | On the same OKX signal set, compare confirmed, unconfirmed and missing-feed groups. Simulate at the next available OKX book. Reject if coverage, fees or removal of the best day erase incremental net. |
| Solana exit depth | On each candidate sample quotes for 10, 20 and 40 USDC and the exact corresponding sell quantity. Distinguish expected output, minimum output, missing route and stale response. Obtain a second independent observation after 30 seconds. | Match standard 20-USDC entries, with both arms eligible only after the second observation. In the challenger skip when the larger size returns less per input dollar and the 20-USDC round-trip quote also deteriorates. Alternate size request order to separate timing from size impact. Report who could not be sold. |
| Relative BTC/ETH trend | At fixed six-hour UTC boundaries compare the latest closed ETH/BTC ratio with the preceding 24 hourly closes. On breakout hold equal USDT notionals long the outperformer and short the other. Enter one complete hour after confirmation, exit six hours later. | Cash benchmark; gross-notional returns, modeled costs, separate periods. A forward test would require both books, funding on both legs and no simulated double fill when only one side is executable. |
| Failed breakout after forced flows | On BTC, wait for a completed bar back inside the prior range. Label forced-flow evidence only if a separately timestamped liquidation feed is available, plus change in OI and recovery of spread. Then simulate the opposite direction. | Compare to reversals on all confirmed re-entries at the same decision delay. Missing liquidation coverage is unknown. Reject if no incremental post-cost value. |
| BTC session momentum | Fix New York trading days and the local session boundaries, with daylight-saving adjustment. Use the sign of the first 30 minutes, enter only for the last 30 minutes; separate high opening volume relative to the previous 20 comparable sessions. | Compare against all sessions without the volume filter, cash and the same rule on shifted times. Include bid/ask and fees. |
| Liquidity-aware position sizing | Replay identical top-100 signals and cap correlated exposures by direction and BTC sensitivity estimated only from past data. | Equal gross risk versus existing position sizing; compare drawdown and turnover as well as return. This is portfolio construction, not a new entry edge. |

## Sources consulted

- Larry Harris, Trading and Exchanges, chapter 14 (spreads and immediacy); chapter 21 (transaction costs). https://academic.oup.com/book/52292
- Adam Grimes, The Art and Science of Technical Analysis, chapter 6, failure tests and failed breakouts. https://onlinelibrary.wiley.com/doi/abs/10.1002/9781119202837.ch6
- Robert Carver, Systematic Trading, author's chapter resources, sizing, diversification, costs. https://www.systematicmoney.org/systematic-trading-resources
- Makarov and Schoar, Price Discovery in Cryptocurrency Markets. Bitcoin price discovery and market segmentation across exchanges. https://www.aeaweb.org/articles?id=10.1257/pandp.20191020
- Bitcoin Intraday Time-Series Momentum. First and last half-hour relationship in the paper's setup; our NY clock and thresholds are adaptations. https://centaur.reading.ac.uk/100181/3/21Sep2021Bitcoin%20Intraday%20Time-Series%20Momentum.R2.pdf
- Schmeling, Schrimpf and Todorov, Crypto carry. Spot–futures basis and limits of arbitrage; a positive basis alone does not predict a profitable outright short. https://www.bis.org/publications/working-paper-1087-crypto-carry
- Flirting with Models, S7E25, Heiden and Seibert on trend-following spreads (episode description). https://www.flirtingwithmodels.com/episodes/1iIqmQ7piJd
- Uncommon Core 13, Light on position-dependent exit liquidity, transcript at 49:48. https://uncommoncore.co/transcript-for-13-light-and-su-zhu-on-the-art-of-trading/
- Top Traders Unplugged, When Position Sizing Saves You, Rob Carver (transcript). https://www.toptradersunplugged.com/podcast/when-position-sizing-saves-you-ft-rob-carver/
