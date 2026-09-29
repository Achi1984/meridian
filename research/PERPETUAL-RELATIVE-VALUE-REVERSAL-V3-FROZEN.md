# Perpetual Relative-Value / Beta-Neutral Reversal V3 — Frozen Protocol

Status: **FROZEN BEFORE FIRST V3 STRATEGY PNL**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V1-FROZEN` — canonical foundation PASS, 19/20 candidates qualified
- `PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-DATA-V2-BROAD-MARKET-FROZEN` — canonical benchmark foundation PASS, 5/5 benchmarks qualified
- Reversal V1 and V2 remain immutable hypothesis-generation evidence and are not promotion evidence for V3

## Objective

Test one new hypothesis: the cross-sectional loser-minus-winner reversal spread may be more stable after removing broad crypto-market beta from the formation signal and sizing the selected long/short book to zero estimated market beta.

V3 is a new ruleset. It does not retune or rescue V1/V2.

## External motivation fixed before first V3 PnL

- Sila, Mark, Kristoufek et al. (2025), *Crypto market betas: the limits of predictability and hedging*, Financial Innovation 11:107: crypto betas are unstable, robust/shrunk beta estimators can improve forecast quality, and market-index choice materially affects beta estimates and hedging.
- Liu, Tsyvinski & Wu (2022), *Common Risk Factors in Cryptocurrency*, Journal of Finance 77(2): broad market and other systematic factors explain material cross-sectional cryptocurrency return variation.

MERIDIAN does not claim exact replication. V3 uses a fixed equal-weight five-perpetual market proxy, public Binance USD-M data, realized funding and explicit retail-style turnover costs.

## Canonical qualified candidate universe

Only the 19 Data V1-qualified candidates are eligible:

SAND, MANA, ALGO, ZEC, IOTA, ZIL, COMP, SNX, KSM, 1INCH, CHZ, RUNE, SUSHI, DYDX, APE, ARB, SUI, WLD, SEI.

EOS remains excluded because it failed the frozen data foundation. No substitute is allowed.

## Frozen broad-market benchmark basket

Benchmark-only assets:

BTC, ETH, BNB, SOL, XRP.

All five passed Data V2 for 2024-01 through 2026-08.

They are never ranked as V3 trading candidates and receive no portfolio weight.

## Frozen deterministic asset split

The 19 qualified candidates are sorted by the lowercase hexadecimal SHA-256 of:

`MERIDIAN-RV-V3|<ASSET>`

Ascending hash order is frozen. The first 10 assets form PRIMARY_VALIDATION; the remaining 9 form ASSET_TRANSFER_HOLDOUT.

### PRIMARY_VALIDATION — 10 assets

RUNE, ZIL, SEI, ARB, DYDX, KSM, WLD, MANA, ZEC, SUI.

### ASSET_TRANSFER_HOLDOUT — 9 assets

SAND, ALGO, SNX, COMP, SUSHI, APE, 1INCH, IOTA, CHZ.

The transfer candidates must not be loaded by a V3 strategy runner unless and until PRIMARY_VALIDATION passes unchanged.

No asset may move between sets after any V3 PnL is observed.

## Frozen validation window

Both stages use the same market-time window but disjoint candidate assets:

Weekly anchors:
- Monday 00:00 UTC
- `2025-01-06 <= t < 2026-08-31`

Final exit:
- 2026-08-31 00:00 UTC

Expected weekly anchors:
- **86**

The earliest anchor leaves 360 completed daily returns inside the audited 2024-01 onward benchmark/candidate history.

Asset-disjoint transfer is the independent second gate; V3 does not claim this is a separate temporal regime.

## Public data

Binance Vision USD-M monthly archives only:

Candidate assets:
- 1d perpetual trade klines
- fundingRate

Benchmark assets:
- 1d perpetual trade klines

No private API, credentials, account data, synthetic backfill, interpolation or nearest-neighbor reconstruction.

## Information timing

At weekly anchor `t`:

- all signal/beta information ends at the completed close known at `t-7d`;
- the skipped week `[t-7d,t)` is not used by beta or formation signal;
- entry price = exact daily open at `t`;
- exit price = exact daily open at `t+7d`;
- realized candidate funding uses events in `(t,t+7d]`.

No current-day close or future information may affect selection or sizing.

## Frozen market factor

For each completed daily return ending on close mark `d`:

`r_m,d = mean_j(log(CLOSE_j,d / CLOSE_j,d-1))`

where `j` is exactly BTC, ETH, BNB, SOL, XRP.

Thus:
- benchmark weight = 20% each;
- daily log returns;
- no market-cap data;
- no dynamic weights;
- no benchmark substitution;
- no optimization of market-factor composition.

The equal-weight basket is a transparent MERIDIAN market proxy, not a published-index replication.

## Frozen beta estimator

For every candidate and weekly anchor:

1. Use exactly **360 daily log-return observations** ending at completed close `t-7d`.
2. Regress candidate daily log return on the frozen market-factor daily log return with an intercept:
   `r_i,d = alpha_i + beta_OLS_i * r_m,d + epsilon_i,d`.
3. Require exactly 360 aligned finite observations and positive market-return variance.
4. Estimate OLS beta standard-error variance:
   - `Sxx = sum((r_m - mean(r_m))^2)`
   - `sigma_e^2 = SSE / (360-2)`
   - `se_beta_i^2 = sigma_e^2 / Sxx`.
5. Within the current frozen stage universe only, compute:
   - `beta_bar = mean(beta_OLS_i)`
   - `tau^2 = sample_variance(beta_OLS_i)`.
6. Vasicek-style shrinkage:
   - if `tau^2 = 0`, `beta_i = beta_bar`;
   - otherwise `w_i = tau^2 / (tau^2 + se_beta_i^2)`;
   - `beta_i = w_i * beta_OLS_i + (1-w_i) * beta_bar`.

No beta clipping, winsorization, alternate lookback or estimator switch is allowed inside V3.

PRIMARY_VALIDATION shrinkage statistics use only its 10 assets.  
ASSET_TRANSFER_HOLDOUT shrinkage statistics use only its 9 assets.

## Frozen residualized reversal formation

Preserve the V1/V2 horizon:

- formation = 8 weeks;
- skip = 1 week;
- hold = 1 week.

For each candidate, use the 56 daily log returns from completed close `t-63d` through completed close `t-7d`.

The frozen score is:

`RESIDUAL_FORMATION_i,t = sum_d(r_i,d - beta_i,t * r_m,d)`

The OLS intercept is **not** subtracted from formation returns. V3 removes only estimated market-beta exposure; it does not remove the candidate's own average drift.

Rank ascending by:
1. residual formation score;
2. asset symbol.

## Frozen selection

For each stage and anchor:

- LONG exactly the **2 lowest** residual-formation assets;
- SHORT exactly the **2 highest** residual-formation assets.

Fixed two-per-side is preregistered so both the 10-asset primary set and 9-asset transfer set use the same portfolio breadth.

No volatility filter, funding filter, discretionary filter, market regime filter, stop loss, take profit, pyramiding or averaging down is allowed.

## Frozen beta-neutral sizing

Let:
- `B_L` = arithmetic mean frozen beta of the two selected longs;
- `B_S` = arithmetic mean frozen beta of the two selected shorts.

A week is ACTIVE only when:
- `B_L > 0`;
- `B_S > 0`.

Then:
- `LONG_GROSS = B_S / (B_L + B_S)`
- `SHORT_GROSS = B_L / (B_L + B_S)`

Both gross sides must lie in **[0.20, 0.80]**.

If either side is outside that band, the strategy holds zero candidate exposure for that week. This is a frozen anti-one-leg risk guard, not an optimization rule.

When ACTIVE:
- each of the two longs receives `+LONG_GROSS/2`;
- each of the two shorts receives `-SHORT_GROSS/2`;
- total gross exposure = 1.00;
- estimated signed beta exposure must satisfy `abs(sum(weight_i * beta_i)) <= 1e-10`.

No leverage beyond 1.0 gross.

## Funding and price PnL

Candidate price PnL:
- exact entry open at `t`;
- exact exit open at `t+7d`.

Funding:
- realized Binance USD-M events in `(t,t+7d]`;
- `FUNDING_RETURN_i = -weight_i * sum(funding_rates_i)`.

Positive funding charges longs and rewards shorts.

Benchmark assets are not traded and incur no funding/cost PnL.

## Turnover and costs

Preserve V1/V2:

- base one-way cost = **8 bps per unit portfolio turnover**;
- stress one-way cost = **13 bps per unit portfolio turnover**.

Turnover:
`sum(abs(new_weight_i - prior_weight_i))`.

A transition to an inactive zero-exposure week is charged as a close.  
A transition out of an inactive week is charged as a new open.  
Full terminal close turnover is charged.

No maker rebates, VIP discounts, fee-token discounts or fee optimization.

## Data integrity

Candidate and benchmark daily prices used by a stage must have:
- finite positive OHLC;
- internally consistent OHLC;
- strictly increasing timestamps;
- no duplicates;
- exact 24-hour cadence across every required beta, formation and holding interval.

Candidate funding used by any active holding must have:
- finite rates;
- strictly increasing timestamps;
- no duplicates;
- max boundary/inter-event gap <=12h.

At every anchor:
- all assets in the current frozen stage universe must be eligible for beta, formation and holding calculations;
- all five benchmark assets must be eligible for the market-factor history and holding-period market diagnostic;
- otherwise fail closed.

No reconstruction.

## Frozen stage metrics

Report base and stress:

- 86 weekly anchors;
- active-week count and fraction;
- compounded net return;
- compounded price-only return;
- Profit Factor;
- annualized Sharpe from weekly net returns using sample stdev × sqrt(52);
- max drawdown;
- five chronological-window returns;
- funding contribution;
- transaction-cost contribution;
- turnover;
- long and short gross contributions as diagnostics only;
- candidate attribution;
- positive-PnL candidate count;
- positive-PnL concentration;
- mean selected-loser minus selected-winner next-week unweighted price spread;
- mean/max absolute pre-trade estimated beta exposure;
- mean long/short gross;
- weekly market-factor return diagnostic;
- ex-post realized market beta of ACTIVE-week price-only pre-cost strategy return versus weekly market-factor return.

The ex-post beta regression includes an intercept and uses only ACTIVE weeks.

## Frozen PRIMARY_VALIDATION gate

All must pass:

- exactly **86** anchors;
- no data-integrity failure;
- all 10 primary assets eligible at every anchor;
- all five benchmark assets eligible at every anchor;
- exactly 2 longs and 2 shorts on every ranked anchor;
- at least **65 of 86** weeks ACTIVE;
- max absolute estimated pre-trade beta exposure <= **1e-10**;
- compounded net return >0;
- compounded price-only return >0;
- Profit Factor >= **1.10**;
- annualized Sharpe >= **0.50**;
- max drawdown <= **25%**;
- at least **3 of 5** chronological windows positive;
- stress compounded return >0;
- at least **5 of 10** candidates have positive net attribution;
- no single positive candidate contributes > **35%** of total positive candidate PnL;
- mean selected-loser minus selected-winner next-week price spread >0;
- absolute ex-post realized market beta <= **0.20**.

PASS => `PRIMARY_VALIDATION_PASS_TRANSFER_REQUIRED`

FAIL => `PRIMARY_VALIDATION_FAIL_RESEARCH_REDESIGN`

A primary PASS does not authorize Paper. It only authorizes loading the already-frozen ASSET_TRANSFER_HOLDOUT under the identical rules.

## Frozen ASSET_TRANSFER_HOLDOUT gate

The transfer stage uses the same 86 anchors, benchmark, signal, beta method, sizing, funding, costs and economic thresholds with these breadth substitutions only:

- all 9 transfer assets eligible at every anchor;
- at least **5 of 9** candidates have positive net attribution.

All other gate thresholds are identical to PRIMARY_VALIDATION.

PASS => `TRANSFER_PASS_PAPER_REVIEW_ELIGIBLE`

FAIL => `TRANSFER_FAIL_RESEARCH_REDESIGN`

A transfer PASS authorizes only a separate prospective Paper-shadow review. It does not create, enable or modify a Paper bot automatically and never authorizes live execution.

## Sequential holdout rule

Before PRIMARY_VALIDATION passes:
- a strategy runner must not load transfer candidate price/funding data;
- transfer PnL, ranks, betas, residual scores, weights and attribution remain uncomputed.

After PRIMARY_VALIDATION:
- if FAIL: V3 freezes as failed and transfer remains untouched;
- if PASS: transfer is run exactly once under this unchanged protocol.

No parameter change is allowed between stages.

## Anti-overfitting

After first V3 primary PnL, do not:
- change the benchmark basket or weights;
- change log-return semantics;
- change the 360-day beta window;
- change the Vasicek-style estimator;
- change 8-week formation / 1-week skip / 1-week hold;
- change fixed 2-per-side selection;
- change the 20%-80% side-gross guard;
- add V2's volatility filter;
- add funding or regime filters;
- change costs;
- remove losing candidates;
- move candidates between primary/transfer;
- change the validation window;
- relax any gate;
- load transfer data after a primary FAIL.

Any redesign receives a new ruleset and fresh evidence.

## Safety

Research only. No exchange credentials, account mutation, live orders, liquidation automation, wallet state, automatic Paper promotion or live promotion.
