# Williams research and Meridian timeframe taxonomy

Research date: 13 October 2026. Owner requests: continue data preparation; investigate Larry Williams, the five-minute claim, combinations and timeframe subcategories. The photograph was subsequently received and assessed; see PHOTO_STRATEGY_MAPPING_20261013.md for the owner-accepted mapping.

Status: evidence review and proposed research designs only. No signal execution, backtest, performance ranking, paper activation, scheduler or live order. The user withdrew mandatory 3:1 reward/risk and mandatory 10x leverage. Existing campaign code still needs an explicit reviewed migration; this document does not silently change it.

## What the sources establish

- Larry's own innovation history describes volatility breakout as expansion of a prior/current range from an opening/closing reference. It also records OOPS patterns, seasonality and COT work. He acknowledges deterioration in the breakout method in an undated historical passage. This supports investigating a mechanism, not copying an established profitable bot. [S1]
- His original %R explanation uses ten daily observations and distinguishes bullish from bearish context. The original positive 0–100 scale differs from the common negative scale: implementations must declare the convention. The page describes uses across day, swing and long-term trading. [S2]
- In a direct interview dated 26 December 2012, Williams preferred tick/volume bars to fixed time bars and favoured swings lasting roughly three to fifteen days. That is a dated personal statement, not proof that he never used five-minute bars. [S3]
- WH SelfInvest documents its own NanoTrader Williams-labelled breakout implementation on five-minute charts, with equal default stop/target distances. This verifies a vendor implementation, not the exact rules behind Williams' championship result. The page's range description is insufficiently precise to copy blindly. Its broad suitability and performance claims are not accepted as Meridian evidence. [S4]
- His current futures course explicitly teaches swing/position trading rather than intraday trading. BlastOff is presented for daily/weekly context. No proprietary formula has been reconstructed or downloaded. [S5, S6]

Conclusion: there is no single verified universal "Larry five-minute strategy" in these sources. Market context, entry resolution and holding duration are different design choices. Neither %R nor a chart interval constitutes a complete strategy. No championship return is used as an expected return or sizing target.

## Proposed research categories

These categories organize ideas; they are not six additional campaign slots. Existing limits remain 12 families, 3 variants per family and 36 candidates overall. Reconcile lineage and any replacement of a slot before registering or testing new candidates. Changing an interval, exit, filter, universe or threshold creates a counted variant, even if discarded.

| Category | Subcategories and hypothesis | Context / entry resolution | Intended holding period | Priority and existing relationship |
|---|---|---|---|---|
| T: Trend and rotation | T1 cross-market absolute trend; T2 crypto Long/Cash; T3 relative-strength rotation | Monthly/daily context; daily or weekly decisions | Days to months | First: retain existing baseline. H1/H7 relationship; rotation shares directional exposure, not automatic diversification |
| P: Trend pullback | P1 daily %R pullback; P2 four-hour entry under a daily trend | Daily context; daily primary, four-hour comparison | Several days | First new Williams-inspired candidate; H1 entry variant, not independent alpha merely because it uses %R |
| B: Volatility breakout | B1 prior-day range expansion; B2 opening-range breakout; B3 volatility-contraction filter | Daily/session context; 15-minute primary, five-minute comparison | Intraday, occasionally several days only under separate exit design | Second new candidate; related to prior failed trend/breakout lineage. Cannot erase those failures |
| R: Reversal | R1 existing shock/reclaim; R2 session gap/re-entry inspired by OOPS; R3 range mean reversion | Session/daily context; five- or 15-minute entries | Minutes to one session | Existing H5 first. Gap and shock reversals have related mechanisms but different prerequisites |
| C: Positioning and calendar context | C1 reported COT positioning; C2 commodity seasonality; C3 their combination with price confirmation | Weekly published positioning; daily trigger | Days to weeks | Later, data gated. COT and seasonality are distinct explanatory inputs; combination is another trial |
| F: Verified flow events | F1 crypto exchange flow; F2 separately verified liquidation event | Timestamped event; 15-minute/hourly confirmation | Hours to days | H8 backlog. OHLCV spikes alone do not identify whales, buying or liquidations |

T is the research anchor. Original momentum research across 58 futures/forwards motivates slow trend, but does not validate our ETF or crypto adaptations. [S7] Faster reversals require especially careful costs: institutional-equity evidence finds their implementation substantially harder than momentum. That does not supply a crypto fee estimate or prove every intraday strategy fails. [S8]

## Three concrete proposed experiments

The following numbers are transparent design assumptions, not fitted results or Larry's authenticated original settings. They are ready for specification review, not execution. Starting virtual equity is EUR 10,000 per standalone comparison. Crypto and cross-market lanes remain separate. Spot starts unlevered; derivative shorts require their own funding, margin, liquidation and instrument-availability data.

### P1 — daily trend pullback, crypto spot first

Use only historically eligible members of the frozen Top20 procedure. Daily close above SMA200 defines long eligibility. Define %R10 as -100 × (highest high over ten completed daily bars minus close) / (highest high minus lowest low); zero range means no signal. A crossing from <= -80 to > -80 on a completed daily bar creates a candidate only while current %R10 remains < -20. Exit conditions take precedence: a bar already in the exit region never opens a new position. Existing positions are evaluated for exit first; no same-bar re-entry. Execute only at the next available quote after signal receipt. Initial stop is the signal day's low minus 0.5 × ATR14; ATR uses the arithmetic mean of the last 14 completed true ranges. Exit after a completed close below SMA200, %R10 >= -20, or ten subsequent daily bars, whichever occurs first; protective stop remains active. No widening, pyramiding or same-bar assumed fills.

Initial sizing assumption: planned loss including estimated adverse costs <=0.25% of current virtual equity, notional <=25% per asset, total gross <=100%, combined open planned loss <=0.75%. Reject when valid sizing/FX/lot precision is unavailable. Stop gaps can exceed the plan. Compare against the unchanged daily trend control with matched sizing/costs; the purpose is incremental entry value, not rewarding lower exposure with an unmatched benchmark. P2 is not yet specified; four-hour changes would consume a separate variant.

### B1 — session range breakout

For an exchange-session instrument, use the previous completed regular-session range R and the current regular-session opening observation O. Levels are O ± 0.5R. First completed 15-minute close outside a level creates the corresponding directional candidate; next executable quote only. One entry per instrument per session. Stop distance 0.5R from actual entry, no fixed profit target, flatten before the defined regular close; missing opening/range data means skip. Five-minute confirmation is one explicit comparison with the same levels, session and exits. All constants are Meridian assumptions.

Choose and freeze instrument, exchange timezone, holiday calendar, close cutoff, execution costs and gap handling before a run. A crypto version must declare its artificial UTC session separately; a UTC midnight price is not a stock-market opening auction. B2 opening-range breakout uses a different reference and must be a distinct counted candidate. B3 contraction is a future filter experiment, not a free extra condition added after seeing results.

### C1 — published positioning plus price confirmation

For one preselected commodity futures market, evaluate commercial net-position extremes relative to the preceding 156 published weekly reports. Freeze the report category and market code; do not interchange legacy, disaggregated and financial-futures categories. An upper-decile observation is a long-context hypothesis, followed by a daily close above the preceding 20-session high as candidate confirmation. A lower-decile/short version is a separate hypothesis. This is our design, not a claim that commercials always predict direction.

Only reports actually released and received before the decision may enter the calculation. COT is usually released Friday at 15:30 New York time using Tuesday positions, with calendar exceptions and possible publication disruptions. [S9] Exit/sizing/roll rules and full point-in-time report history remain prerequisites. This candidate is less implementation-ready than P1/B1. Seasonality must be estimated using prior years only and tested as a separate addition, not searched across arbitrary date windows until profitable.

## Sessions and clocks

- Store market events and receipts in UTC; derive exchange-local sessions using IANA timezones and historical calendars. Europe/Vienna is a display timezone, not the signal clock.
- US cash-index context: NYSE regular session is 09:30–16:00 America/New_York. [S10] Proposed opening study window is 09:30–11:00 local (normally 15:30–17:00 Vienna, one hour earlier during mismatched DST weeks). This is a research window, not evidence it is the most profitable interval. Futures trade on their own contract calendars.
- Crypto daily bars: UTC close, plus actual data receipt delay. Four-hour comparison bars use fixed UTC boundaries. Intraday analyses can compare the US opening window with a separately registered all-day control. Weekend inclusion/exclusion counts as a variant; do not remove bad weekends retrospectively.
- COT: use the actual release calendar, not Tuesday's observation date as availability. Commodity sessions and inventory releases are instrument specific; no single universal Vienna time is hardcoded.
- Tick/volume bars remain a backlog because they require trade-level data and independent bar-building checks. A five-minute candle cannot establish the within-bar order of stop/target touches or the executable spread.

## Combination design and acceptance

1. Trend plus pullback is a context/entry combination. Compare it with trend alone. Do not present correlated long crypto entries as independent sources of protection.
2. Trend plus reversal is a potential portfolio combination only after both pass standalone checks. Compare a fixed risk allocation with each component and cash/appropriate passive controls; measure net daily return correlation, simultaneous losses, crisis performance and aggregate exposure. Apparent opposite styles are not proof of low correlation.
3. COT or seasonality plus price confirmation is a sequential information filter. Compare base, filter-only addition and combination within the variant budget. No retrospective optimal weighting.
4. A regime allocator can later compare predeclared bull/bear/range rules with fixed weights. H12 already represents that idea. Regime changes use only closed, received information. Spot bear response may be cash; a short strategy must demonstrate its own net edge.

Selection criterion: positive out-of-sample expectancy after fees, spreads, adverse slippage, funding/borrow where relevant, and EUR conversion; drawdown and concentration limits; parameter-neighbourhood stability; multiple regimes and adequate independent events. Record all tried variants and failed lineages. No universal minimum 3:1 payoff and no blanket leverage target. No automatic promotion based on the best backtest. Champion/challenger comparison, exposure limits, rollback and independent review are requirements for future autonomous development, not installed capabilities of this document.

## Data handoff

The concurrent warmup audit completed 200 monthly attempts: 178 checksum successes and 22 failures. Twenty-one candidates have complete 201-day windows; TON has 67 rows, TAO 186, LEO/KAS zero under the attempted mappings. Independent review checked prepared closes against local rows. These are coverage results only; identities, historical membership, liquidity and costs still need verification. The inspected March–October 2024 scope is not an untouched holdout. Prepared closes alone are insufficient for ATR/%R or intraday execution; archived OHLCV must be retained and normalized for P1, and separate intraday data are required for B1/H5.

The photo's 22 concepts have now been classified; owner accepted the prioritization at 21:29 Europe/Vienna. Claude can review the evidence and proposed experiment definitions when available; no future review or continuous execution has been scheduled by this packet.

## Sources checked

- S1: Larry Williams, own method history: https://www.ireallytrade.com/innovation/
- S2: Larry Williams, original %R explanation: https://www.ireallytrade.com/williamspercentr/
- S3: Direct Larry Williams interview, 26 December 2012: https://www.moneyshow.com/articles/videotranstr-30132/
- S4: WH SelfInvest, its own NanoTrader implementation: https://www.whselfinvest.com/en-lu/trading-platform/free-trading-strategies/tradingsystem/56-volatility-break-out-larry-williams-free
- S5: Larry Williams, current futures course description: https://www.ireallytrade.com/futurescommodities/
- S6: Larry Williams, BlastOff description: https://www.ireallytrade.com/blastoff/
- S7: Moskowitz, Ooi, Pedersen, original research: https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum
- S8: Frazzini, Israel, Moskowitz, original cost research: https://www.aqr.com/insights/research/working-paper/trading-costs-of-asset-pricing-anomalies
- S9: CFTC release schedule: https://www.cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule/index.htm
- S10: NYSE session calendar: https://www.nyse.com/trade/hours-calendars
