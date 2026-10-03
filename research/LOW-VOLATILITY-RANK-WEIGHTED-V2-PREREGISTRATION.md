# Low-Volatility Rank-Weighted V2 — Preregistration

Status: **PREREGISTERED / NEW STRATEGY FAMILY / DEVELOPMENT PNL NOT YET INSPECTED / HOLDOUT SEALED**  
Ruleset: `LOW-VOLATILITY-RANK-WEIGHTED-V2-FROZEN`  
Execution impact: **false**  
Paper/live authorization: **false**

## Rationale and lineage

Cross-Sectional Low-Volatility V1 is closed and may not be rescued or retuned.

Its frozen Discovery evidence may be used only as descriptive design evidence for a separately named hypothesis. That evidence showed:

- positive cross-sectional Low-Volatility Rank IC;
- the V1 extreme Low-2 minus High-2 spread failed its frozen significance gate;
- no V1 Holdout was evaluated.

V2 therefore tests a different, predeclared portfolio construction: a **continuous cross-sectional rank-weighted dollar-neutral portfolio** using the unchanged V1 Low-Volatility feature. The purpose is to use the full ranked cross-section rather than selecting only two extreme assets per side.

The V1 Holdout remains untouched and is reserved as V2's independent confirmatory stage only if V2 Development passes.

Parent frozen feature engine Git blob:

`d161b6b4553d5a18fc7064570f4a4e956178d0c9`

Parent feature ruleset:

`CROSS-SECTIONAL-LOW-VOLATILITY-V1-FROZEN`

No V2 strategy return, Profit Factor, Sharpe, drawdown, funding contribution, or cost-adjusted PnL has been inspected before this preregistration.

## Frozen universe

Exactly 12 Binance USD-M perpetual markets:

`BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK, DOT, LTC, BCH, AVAX`

Every evaluation anchor requires all 12 assets. Missing source data, feature data, entry/exit prices, or required funding coverage fail closed. No asset may be removed or substituted.

## Frozen Low-Volatility feature

The feature is inherited unchanged from the frozen V1 engine.

At each Saturday 00:00:00 UTC anchor `t`:

1. Use exactly the preceding **28 days / 672 hourly close-to-close log returns**.
2. No bar beginning at or after `t` enters the feature.
3. `RV28 = sqrt(sum(r_h^2))`.
4. `LOWVOL = -RV28`.
5. Larger `LOWVOL` means lower trailing realized volatility.
6. No winsorization, standardization, regime filter, beta adjustment, alternate lookback, or asset-specific parameter is allowed.

The next-week price return is measured from the public hourly kline open at `t` to the open at `t + 7 days`.

## Frozen rank-weighted portfolio

For each valid anchor:

1. Compute the 12 `LOWVOL` values.
2. Assign ascending average ranks across the 12 values:
   - rank 1 = lowest `LOWVOL` / highest trailing volatility;
   - rank 12 = highest `LOWVOL` / lowest trailing volatility;
   - exact ties receive average ranks.
3. Center each rank at the 12-asset midpoint:
   `z_i = rank_i - 6.5`.
4. Let `D = sum(abs(z_i))`.
5. Fail closed if `D <= 0`.
6. Target weight:
   `w_i = z_i / D`.

Therefore, whenever valid:

- sum of target weights = 0;
- total gross exposure = 1.0;
- long gross exposure = +0.5;
- short gross exposure = -0.5;
- the portfolio uses all non-zero ranked exposures;
- no leverage multiplier is applied.

There is no top/bottom basket selection, volatility scaling, stop-loss, take-profit, pyramiding, martingale, DCA, or discretionary override in V2.

## Trading and accounting timing

At anchor `t`:

- the new target weights are determined only from information available strictly before `t`;
- rebalancing occurs at the public kline open at `t`;
- the target weights are held unchanged until the next weekly anchor;
- the price leg uses open-to-open return over the seven-day interval;
- funding for each asset is the sum of all official funding rates with timestamps in `(t, t + 7d]`;
- funding contribution for an asset is `-w_i * funding_sum_i`;
- price contribution is `w_i * price_return_i`.

Weekly pre-cost portfolio return is the sum of all price and funding contributions.

### Turnover and costs

Turnover at an anchor is:

`sum(abs(w_new_i - w_previous_i))`

with the pre-first-anchor portfolio equal to zero.

A terminal close is mandatory after the final evaluation week and adds:

`sum(abs(w_last_i))`

to total turnover and transaction cost.

Frozen cost assumptions:

- baseline: **10 bps per one-way unit of notional turnover**;
- mandatory stress: **20 bps per one-way unit of notional turnover**.

Transaction cost is:

`turnover * cost_bps / 10,000`

No zero-cost result and no post-result reduction in the cost assumption is allowed.

## Frozen public sources

Only official public Binance sources are authorized.

### Price source

Binance Vision USD-M monthly **1h kline** archives for the 12 frozen symbols.

### Funding source

Binance Vision USD-M monthly **fundingRate** archives for the same 12 frozen symbols.

No private/account API data, alternate exchange source, synthetic history, interpolation, or source substitution is allowed.

Each retained source file and each downloaded official archive must be cryptographically receipted. Missing funding archives or incomplete funding coverage are data-integrity failures.

## Stage A — Development

Development is explicitly a **design/development evaluation**, not independent confirmation, because the V2 hypothesis was motivated by the frozen V1 Discovery evidence.

Frozen weekly anchors:

- first: **2025-02-01T00:00:00Z**
- last: **2025-12-27T00:00:00Z**
- terminal next-week open: **2026-01-03T00:00:00Z**
- expected periods: **48**

The V2 Development portfolio return has not been inspected before this preregistration.

### Development diagnostics

Calculate:

- net weekly returns at 10 bps;
- stress weekly returns at 20 bps;
- compounded net return;
- Profit Factor from weekly net returns;
- annualized weekly Sharpe using `sqrt(52)`;
- maximum drawdown from compounded weekly net returns;
- four chronological 12-week compounded-return blocks;
- total turnover;
- total transaction cost;
- total funding contribution;
- price contribution;
- per-asset attribution;
- weekly cross-sectional Rank IC of `LOWVOL` versus next-week asset return;
- Rank IC Newey-West t-statistic with fixed lag 4.

### Development gate — fail closed

Development passes only if **all** are true:

- exactly **48** valid periods;
- exactly **12** eligible assets every period;
- target gross exposure equals **1.0** every period within numerical tolerance;
- absolute target net exposure is <= **1e-12** every period;
- baseline compounded net return **> 0**;
- baseline Profit Factor **>= 1.15**;
- baseline annualized Sharpe **>= 0.75**;
- baseline maximum drawdown **<= 20%**;
- at least **3 of 4** chronological blocks have positive compounded net return;
- 20-bps stress compounded net return **> 0**;
- mean weekly Rank IC **> 0**;
- Rank IC Newey-West(4) t-statistic **>= 1.645**;
- no source, funding-coverage, invariant, or lineage failure.

Possible Development decisions are exactly:

- `DEVELOPMENT_PASS_HOLDOUT_REQUIRED`
- `DEVELOPMENT_FAIL_RESEARCH_STOP`

A Development FAIL closes V2. No Holdout may be evaluated.

## Stage B — untouched Holdout

Only a frozen Development PASS followed by a separate documentation-only authorization may unlock the Holdout.

Frozen weekly anchors:

- first: **2026-01-03T00:00:00Z**
- last feature anchor: **2026-08-22T00:00:00Z**
- terminal next-week open: **2026-08-29T00:00:00Z**
- expected periods: **34**

The Holdout must use the identical feature, rank weighting, funding accounting, turnover accounting, 10-bps baseline cost, 20-bps stress cost, and gate thresholds.

### Holdout gate — independent confirmation

Holdout passes only if **all** are true:

- exactly **34** valid periods;
- exactly **12** eligible assets every period;
- target gross exposure equals **1.0** every period within numerical tolerance;
- absolute target net exposure is <= **1e-12** every period;
- baseline compounded net return **> 0**;
- baseline Profit Factor **>= 1.15**;
- baseline annualized Sharpe **>= 0.75**;
- baseline maximum drawdown **<= 20%**;
- at least **3 of 4** chronological blocks have positive compounded net return;
- 20-bps stress compounded net return **> 0**;
- mean weekly Rank IC **> 0**;
- Rank IC Newey-West(4) t-statistic **>= 1.645**;
- no source, funding-coverage, invariant, or lineage failure.

Possible Holdout decisions are exactly:

- `HOLDOUT_PASS_PROSPECTIVE_PAPER_REVIEW_ONLY`
- `HOLDOUT_FAIL_RESEARCH_STOP`

Even a Holdout PASS authorizes only a separate prospective Paper-review decision. It does not authorize automatic Paper deployment or live trading.

## Anti-overfitting rules

After the first V2 Development result is inspected, all V2 rules are immutable.

Forbidden rescue actions include:

- changing rank weighting;
- choosing a subset of ranks or assets;
- changing gross exposure;
- changing rebalance frequency;
- changing the 28-day feature;
- adding a regime filter;
- lowering baseline or stress costs;
- ignoring funding;
- changing Development/Holdout dates;
- changing gate thresholds;
- selecting favorable subperiods;
- using the untouched Holdout to tune any rule.

Any redesign requires a new ruleset and a new preregistration.

## Current authorization

Authorized now:

- this docs-only V2 preregistration;
- later deterministic implementation against this frozen contract;
- synthetic/invariant tests that reveal no historical V2 strategy PnL.

Not authorized now:

- historical V2 Development evaluation;
- Holdout evaluation;
- Paper execution;
- live execution.
