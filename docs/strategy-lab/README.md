# Meridian Paper Strategy Lab — offline draft

User mandate: **13 October 2026, 18:24 Europe/Vienna**. Develop and investigate varied bull, bear, range and hybrid hypotheses autonomously, with robustness first. Each independent candidate has EUR 10,000; perpetual margin leverage is capped at 10x, spot at 1x. The listed risk values are proposed research defaults, not evidence of profitability or guaranteed loss limits.

`campaign-20261013.json` is an offline **DRAFT source register**. All network, dispatch, canonical research and order permissions are false. These fields are denial assertions, **not an authorization mechanism**. No scheduler, orders, market-data run, deployment or automatic promotion belongs to this packet.

## Scope and sequence

1. Audit existing strategy families and failed lineages.
2. Prove data access, as-known timestamps and an independent evaluation window.
3. Freeze a separate preregistration before seeing results; this draft has no frozen rules hash or data hash.
4. Run bounded development only in a separately authorized environment, recording every variant.
5. Validate independently on genuinely untouched data or future observations.
6. Have a separate reviewer assess execution, costs, uncertainty and selection bias.
7. Make any promotion decision separately; never infer it from a favorable score.

There are twelve economic hypothesis cards. First design priorities are **H5 shock/reclaim daytrader, H7 defensive spot, H8 whale feature, H12 regime allocator**. H12 remains shadow design until specialist strategies qualify. H8 is an event study before it can become a trading strategy. H7 is a new spot derivative of a known family; it does not inherit its reference's validation.

The existing `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN` reference remains immutable and separate. Its positive holdout is the strongest inspected reference, not permission to change or redeploy it. Breakout V1, taker-flow V1/V2 and regime-grid V2 failed their gates. Do not rescue them by relabeling, dropping losing assets or sides, reducing costs or relaxing requirements.

## Bounded creativity

At most **3 variants per family, 36 candidates total, 3 finalists**. The base candidate and every manual variation count. Failed and discarded variants remain in the ledger. A parameter change is not a new economic family. Empty variant lists mean no implemented or evaluated candidates yet.

Already inspected historical data cannot become a fresh holdout through resplitting or renaming. Null prerequisites mean unknown, not passed. There is no claimed dataset hash, frozen preregistration, performance acceptance or valid 10x simulator in this register.

The separate V2 fallback fix was merged in PR #751; the lead verified main `3901547d` with all post-merge checks green. Realistic 10x margin, liquidation, funding and execution simulation is missing or unverified; multiplying unlevered returns by ten is invalid. Margin leverage and gross portfolio exposure are separate controls; the draft gross-exposure cap is 1.5 times equity even with 10x margin leverage.

`validate-campaign.mjs` validates this exact inert draft schema, denial permissions, immutable reference and empty variant lists without network access, scheduling or promotion. Even a valid result always reports `executionAuthorized:false`. It is not a runtime registry or a permission engine. Candidate registration and performance gates require a separate reviewed specification.

Local verification: `node --test test/strategy-campaign-draft.test.js`. This runs synthetic contract tests and reveals no historical strategy PnL.

## Planned net CRV mandate — 13 October 2026, 18:50 Vienna

Every **new candidate trade** requires planned net reward:risk **at least 3:1** before entry. This is a planning constraint, not a promise of realized return, win probability or profitability. The frozen LowVol reference is unchanged and outside this new-candidate contract; this is not permission to adapt it.

Calculate conservative net target outcome divided by a strictly positive, finite conservative net stop loss. Deduct entry and scenario-specific exit fees, spread, slippage and adverse funding/borrow over the declared holding horizon from the target outcome; add applicable costs to the stop loss. Include every leg and avoid double-counting costs already embedded in executable prices. Unknown costs or unknown/unbounded risk reject qualification. A stop scenario is a model, not a guaranteed maximum loss; gaps, liquidation and execution failures require separate stress validation.

Partial exits use quantity-weighted outcomes for **all** portions, including a declared residual exit; an unspecified runner cannot manufacture a 3:1 ratio. The net stop scenario must cover the original at-risk position and its applicable costs. Do not relocate a stop merely to qualify, ignore early exits or invent an implausible distant target. Time exits and risk exits remain part of independent payoff/expectancy validation; the planned target ratio does not make those realized outcomes 3:1.

There are no carry, hedge, spot or allocator exemptions. Strategies without a meaningful finite trade payoff remain research-only until a reviewed compliant design exists. H5's former 1.5R target is superseded and is not a qualified trade plan. All twelve cards explicitly remain `RESEARCH_ONLY_PAYOFF_UNVERIFIED`.

The exact `payoffPolicy` schema is checked locally, including cost treatment, residuals, no exemptions and unchanged reference isolation. This packet provides **no payoff calculator or runtime order enforcement**. A passing draft validation only confirms the inert configuration contract.
