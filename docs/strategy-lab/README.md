# Meridian Paper Strategy Lab — offline draft

User mandate: **13 October 2026, 18:24 Europe/Vienna**. Develop and investigate varied bull, bear, range and hybrid hypotheses autonomously, with robustness first. Each independent candidate has EUR 10,000; the legacy planning ceilings remain 10x for perpetuals and 1x for spot. Leverage is optional: 10x is neither a target nor a requirement or execution authorization. The listed risk values are proposed research defaults, not evidence of profitability or guaranteed loss limits.

`campaign-20261013.json` is an offline **DRAFT source register**. All network, dispatch, canonical research and order permissions are false. These fields are denial assertions, **not an authorization mechanism**. No scheduler, orders, market-data run, deployment or automatic promotion belongs to this packet.

## Scope and sequence

1. Audit existing strategy families and failed lineages.
2. Prove data access, as-known timestamps and an independent evaluation window.
3. Freeze a separate preregistration before seeing results; this draft has no frozen rules hash or data hash.
4. Run bounded development only in a separately authorized environment, recording every variant.
5. Validate independently on genuinely untouched data or future observations.
6. Have a separate reviewer assess execution, costs, uncertainty and selection bias.
7. Make any promotion decision separately; never infer it from a favorable score.

There are twelve economic hypothesis cards. Their original priority numbers emphasized **H5 shock/reclaim daytrader, H7 defensive spot, H8 whale feature, H12 regime allocator**. Those preserved numbers are historical card ordering, not the current work queue: later benchmark and P1 experiment documents prioritize slow trend and the P1/control comparison. H12 remains shadow design until specialist strategies qualify. H8 is an event study before it can become a trading strategy. H7 is a new spot derivative of a known family; it does not inherit its reference's validation.

The existing `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN` reference remains immutable and separate. Its positive holdout is the strongest inspected reference, not permission to change or redeploy it. Breakout V1, taker-flow V1/V2 and regime-grid V2 failed their gates. Do not rescue them by relabeling, dropping losing assets or sides, reducing costs or relaxing requirements.

## Bounded creativity

At most **3 variants per family, 36 candidates total, 3 finalists**. The base candidate and every manual variation count. Failed and discarded variants remain in the ledger. A parameter change is not a new economic family. Empty variant lists mean this inert draft has not registered candidates. They do not assert a complete empirical trial ledger; reconcile separately documented prototypes and inspected results before any trial registration.

Already inspected historical data cannot become a fresh holdout through resplitting or renaming. Null prerequisites mean unknown, not passed. There is no claimed dataset hash, frozen preregistration, performance acceptance or valid 10x simulator in this register.

The separate V2 fallback fix was merged in PR #751; the lead verified main `3901547d` with all post-merge checks green. Realistic 10x margin, liquidation, funding and execution simulation is missing or unverified; multiplying unlevered returns by ten is invalid. Margin leverage and gross portfolio exposure are separate controls; the draft gross-exposure cap is 1.5 times equity even with 10x margin leverage.

`validate-campaign.mjs` validates this exact inert draft schema, denial permissions, immutable reference and empty variant lists without network access, scheduling or promotion. Even a valid result always reports `executionAuthorized:false`. It is not a runtime registry or a permission engine. Candidate registration and performance gates require a separate reviewed specification.

Local verification: `node --test test/strategy-campaign-draft.test.js`. This runs synthetic contract tests and reveals no historical strategy PnL.

## Strategy-specific payoff policy V2

The user's 13 October revision withdrew the universal 3:1 minimum and mandatory 10x. The former 18:50 mandate remains in JSON as **SUPERSEDED** history. See `PAYOFF_POLICY_MIGRATION.md` for the bounded migration.

Fixed-target designs evaluate declared target/stop scenarios **and the full exit distribution** after costs. Trailing/time exits use path-dependent outcomes without invented finite targets. Rebalancing uses portfolio returns, drawdowns, turnover and benchmark comparison. Multi-leg designs require joint leg, financing, margin and asynchronous-fill analysis. Event studies use frozen horizons and matched controls; they create no orders. These are proposed evaluation modes, not implementations or validated edges.

There is no universal ratio acceptance threshold. A ratio below 3 is not an automatic campaign rejection; a ratio above 3 is not evidence of positive expectancy or permission. Include all applicable fills, partial exits/residuals, legs, fees, spread, slippage, funding and borrow. Unknown costs, risk or unsupported models remain research-only with no promotion. Stops must not be moved simply to improve a ratio. Gaps, failed fills and liquidation require separate stress evaluation.

H5 proposes the original shock-bar-open target as a benchmark with its existing stop and six-bar time exit; it has not been validated. Every card remains `UNVALIDATED` and `RESEARCH_ONLY_PAYOFF_UNVERIFIED`. The frozen LowVol reference remains unchanged.

The validator checks the exact V2 configuration and proposed mode mapping. It neither computes expectancy nor approves empirical research or trades. `evaluate-trade-plan.mjs` remains an unchanged legacy 3:1 scenario calculator; its historical qualification flag is not the campaign acceptance policy. No risk caps, variant budgets, permissions or execution authority are expanded.
