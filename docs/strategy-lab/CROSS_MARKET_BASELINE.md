# Cross-market Long/Cash baseline X1 — source prototype

Status: source-only proposal, not an executed benchmark. See `cross-market-manifest.json` for unresolved data and execution requirements. X1 is an additional design attempt; it must enter a revised campaign trial ledger before empirical evaluation. This does not silently add a thirteenth family or reset earlier failed attempts. The four-candidate first-tranche ceiling remains; the lead must register which prior planned slot X1 replaces before a run.

## Concrete signal contract

`evaluateCrossMarketTrend({asOfMonth, assets})` accepts 1–20 unique symbols. Each asset has exactly `symbol`, `months` and `totalReturnIndex`. Both arrays contain thirteen entries. Months are consecutive `YYYY-MM`, ending in the calendar month immediately before `asOfMonth`. All total-return-index values must be positive finite numbers. No missing series, forward fill, dynamic removal of an invalid asset, current-month input or silent schema coercion is accepted.

Return over twelve months is the final index divided by the first, minus one. A positive return allocates the asset's fixed 1/N sleeve to LONG; nonpositive returns leave that sleeve in cash. With four supplied assets each sleeve is 25%. Inactive sleeves never increase another asset's weight. Invalid input returns no signals and 100% cash as a validation result; it is not an instruction to liquidate existing positions.

This equal-weight model is the deliberately simple control baseline, not risk parity or the later risk-scaled design. Its weights are targets before costs and whole-share rounding. Binary floating-point weights are approximate; exact mathematical long plus cash allocation is one. An execution adapter must enforce cash solvency using actual prices, fees and lot rounding rather than summing approximate weights. No portfolio engine currently consumes these outputs.

Only calendar alignment is enforced here. The caller must independently establish publication/receipt times, historical revisions, instrument membership and corporate actions. All signal series must be consistently measured in EUR total return for the proposed EUR account. `asOfMonth` is not a receipt timestamp; this function cannot prove data was available at a tradable instant. Orders, if later authorized, must be priced after verified availability, never at the close used to calculate the signal.

`executionAuthorized:false` and `researchOnly:true` are unconditional. There is no CRV gate. The existing legacy trade-plan calculator and campaign validator retain their earlier contracts; this independent source prototype neither invokes nor migrates them. It calculates an input-series lookback return, not strategy PnL.

## Four issuer-verified research candidates

| Sleeve | Instrument / ISIN | Modeling requirements |
| --- | --- | --- |
| Equity | iShares Core MSCI World UCITS ETF USD (Acc), IE00B4L5Y983 | Physical sampled developed-market equity exposure, accumulating; use product history, splits and EUR valuation, not unadjusted index quotes |
| Bonds | iShares Core EUR Govt Bond UCITS ETF EUR (Dist), IE00B4WXJJ64 | Physical sampled euro government debt; semiannual distributions enter total-return signal and actual cash ledger consistently |
| Gold | iShares Physical Gold ETC, IE00B4ND3602 | Physically backed limited-recourse debt security, not a UCITS fund; product history instead of spot gold |
| Commodities | iShares Diversified Commodity Swap UCITS ETF USD (Acc), IE00BDFL4P12 | Synthetic swap exposure to a commodity futures total-return index; product costs/roll/counterparty structure differ from spot commodities |

This shortlist is for data feasibility, not purchase or confirmed broker availability in Austria. One issuer simplifies the initial comparison but is not a completed provider-selection exercise. Gold may overlap the commodity basket; equal capital does not mean equal risk or independent exposures. EUR trading does not imply FX hedging. Listings, trading currency, historical spreads, minimum lots, broker permissions and fees remain unresolved.

Official issuer factsheets inspected 2026-10-13 (September 2026 reports):

- Equity: https://www.ishares.com/gls-download/literature/fact-sheet/swda-ishares-core-msci-world-ucits-etf-fund-fact-sheet-en-gb.pdf
- Bonds: https://www.ishares.com/gls-download/literature/fact-sheet/iega-ishares-core-govt-bond-ucits-etf-fund-fact-sheet-en-gb.pdf
- Gold: https://www.ishares.com/gls-download/literature/fact-sheet/sgln-ishares-physical-gold-etc-fund-fact-sheet-de-de.pdf
- Commodities: https://www.ishares.com/gls-download/literature/fact-sheet/icom-ishares-diversified-commodity-swap-ucits-etf-fund-fact-sheet-de-de.pdf

A factsheet proves identity/structure, not a complete backtest feed. The youngest proposed product launched in July 2017. A common thirteen-month-end warmup could first support a signal in August 2018 if all July 2017–July 2018 observations and availability evidence exist. That is only a feasibility lower bound, not an approved start date or an unseen holdout.

## Execution/data contract still to complete

Use separate 10,000 EUR simulated accounts, no borrowing, whole units and cash remainder. Choose a venue and receipt-aware execution schedule, then freeze fees, spreads, market-hours/holidays, currency conversion, corporate actions and source snapshots/hashes. Accumulating funds already reinvest income; do not credit it twice. The distributing bond fund requires actual distribution events; NAV total-return performance is not a fill price. Fees embedded in product values must not be subtracted twice. Personal tax treatment is not modeled; any future performance must state its tax basis.

Before empirical execution, register X1 and complete fixed-universe controls: cash, same-product passive buy-and-hold and monthly equal-weight rebalancing without the trend filter. Compare on identical EUR windows and report allocation, turnover, net costs, drawdown sampling frequency, loss duration and concentration. Define cash interest, outage handling, risk/stop procedures, permissible data periods and evaluation criteria in the manifest. The signal module does not enforce the portfolio's risk limits.

Data status is BLOCKED: complete historical export, adjusted-series provenance, publication times and executable prices are not yet established. No historical observations were fed into this prototype. The test fixtures are synthetic; passing them provides no evidence of profitability.
