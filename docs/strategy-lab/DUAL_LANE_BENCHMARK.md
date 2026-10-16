# Crypto and cross-market research — separate accounts, common evaluation

Owner steering: 2026-10-13 20:40 Vienna confirms crypto remains a dedicated research strand alongside the new cross-market benchmark. Neither strand is a running paper account yet. These are source-design manifests, not execution authorizations.

| Lane | Initial virtual equity | First design | Target exposure |
| --- | --- | --- | --- |
| Crypto | 10,000 EUR | H7 spot trend plus low-volatility selection | Up to three 25% selections; at least 25% target cash; no borrowing |
| Cross-market | Independent 10,000 EUR | X1 monthly twelve-month trend, fixed sleeves | Four 25% sleeves across equity, bonds, gold and commodities; inactive sleeves stay cash; no borrowing |

The two virtual balances are alternative experiment accounts, not a 20,000 EUR capital commitment, a 50/50 allocation or a combined performance record. Crypto is not an automatic fifth 20% sleeve in X1. Equal initial equity does not equalize risk or exposure: raw rankings cannot establish that one strategy is superior merely because it invested more.

## Crypto first implementation contract

`crypto-manifest.json` links the existing pure H7 selector in PR757 at its exact source head. It does not import, activate or replace that branch. H7 uses closed daily data, SMA200 eligibility and the volatility rank of eligible assets. Proposed weekly rebalancing and daily trend exits remain to be implemented in a portfolio engine; exited capital waits until the next weekly selection. There is no forced finite profit target.

BTC, ETH and SOL are initial data-feasibility probes, not a frozen survivor-selected backtest universe. With only three assets, a selector that chooses up to three cannot demonstrate an incremental low-vol ranking benefit. Before any evaluation, either define a broader point-in-time universe with liquidity/listing/delisting rules, or count a deliberately separate three-asset trend-only control. Do not invent a low-vol edge from a redundant ranking step.

Freeze venue, exact spot pairs, price/volume provenance, UTC close and receipt semantics, quote-to-EUR conversion, order-size precision, minimum notional and historical fees/spreads. For USD stablecoin pairs, stablecoin/EUR conversion and depeg effects are part of accounting; USD and stablecoin are not interchangeable fixed units. Outages, stale data and unavailable exits need explicit rules. Spot shorting, funding and liquidation do not belong in this unlevered baseline.

Existing H7 source documentation and `requiresTradePlan` flags predate the owner's withdrawal of the universal 3:1 requirement. The new design does not require a fabricated take-profit; legacy policy/schema migration is still outstanding. No source flag establishes permission or economic validity. Frozen LowVolV2 evidence remains a separate reference and does not transfer to H7.

## Common comparison contract

- Separate ledgers and EUR valuation. Freeze cash-interest treatment, costs and tax-reporting basis; display gross/net figures separately. Preserve source observations and receipt times.
- Same overlapping evaluation windows for headline comparisons, with native-market observation frequency also reported. Traditional markets close while crypto trades continuously: do not forward-fill missing tradable prices and claim the resulting series is executable or equally fresh.
- Report net return, actual exposure, turnover, worst loss, drawdown with sampling frequency, recovery duration, asset concentration and uncertainty. Label returns as before personal taxes unless those are explicitly modeled.
- Use a synchronized daily reporting schedule for side-by-side charts and maintain finer intraday/native risk observations where available. Stale non-trading-day marks must be flagged. A smoothed common chart must not hide crypto weekend risk or understate native-frequency drawdowns.
- Include cash and passive controls. For H7, isolate the low-vol selection from the SMA200 filter and invested amount using a same-universe trend-only control with the same total target exposure. This control is diagnostic and does not independently validate a deployable alternative. X1 includes same-instrument passive holdings and monthly equal-weight rebalancing without its trend filter.
- Preserve each lane's prior inspected-data history and cumulative trial ledger. A new market, currency conversion, exit rule or universe does not make reused periods unseen. H7, H5 and X1 design attempts must be reconciled before empirical execution; all existing campaign ceilings remain in force.
- Portfolio risk limits, cost calibration, exact fills, calendars and uncertainty methods must be specified before evaluation. Target weights are not protective stops or maximum-loss guarantees. Do not tune limits after observing results to create PASS.

## Later extensions and combination

H5 daytrading/rebound and long/short remain crypto challenger ideas. Derivatives require separate funding, mark-price, margin, liquidation and instrument-size models; unlevered spot results cannot be multiplied into a futures backtest. These extensions must fit a registered campaign rather than run automatically alongside every idea.

Only after individual lanes have adequate evidence should a combined allocation be considered. Register combination weights and rebalancing rules before a new test; measure correlations, simultaneous stress losses, capital competition and duplicated exposures. Selecting the best combination on both lanes' final tests contaminates those tests; combination validation then needs new independent or prospective evidence.

## Completion state

Existing source checks: cross-market signal 11 synthetic tests plus independent review; PR758 head08948ddf68828bc47b386aaa7078dac194e9427e Release Safety38447910501 verified SUCCESS before this documentation addition. H5/H7 source prototype is separately tracked in PR757. Neither these checks nor the account specifications prove profitability.

Next bounded implementation: data/receipt adapters and portfolio accounting shared at the interface level, with market-specific execution/calendar handling; migrate the legacy payoff policy, register the candidate set and freeze a complete run manifest. Runtime/autonomy remains owned by the parallel platform lane. No scheduler, continuous optimizer or live strategy deployment is installed by this packet.
