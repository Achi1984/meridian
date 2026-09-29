# Cross-Sectional Funding Carry V1 — Frozen Transfer Validation Protocol

Status: **FROZEN BEFORE FIRST TRANSFER RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-FACTOR-DATA-V1`
- `PERPETUAL-FACTOR-ROW-CONTINUITY-V1`
- `CROSS-SECTIONAL-PERPETUAL-FACTOR-V1-FROZEN`

## Why this is a new strategy

Cross-Sectional Perpetual Factor V1 failed its independent 2025-2026 validation, but its Funding Carry factor book remained positive:

Seen development evidence, 2023-04 through 2024-12:
- Funding Carry factor-book return: **+9.4729%**

Seen temporal evidence, 2025-01 through 2026-08:
- Funding Carry factor-book return: **+23.9214%**

Those results are hypothesis-generating only. They are already observed on the ten-asset development/temporal universe and cannot be used as an independent gate for this new strategy.

Cross-Sectional Funding Carry V1 isolates the exact already-seen Funding Carry book and evaluates it for the first time on the previously reserved transfer universe.

## Fixed transfer universe

- LTC
- BCH
- AVAX
- HBAR

No asset substitution or expansion after results.

Objective eligibility inherited from Perpetual Factor Data V1:
- LTC: 2023-01
- BCH: 2023-01
- AVAX: 2023-01
- HBAR: 2023-03

## First independent validation window

Weekly Monday anchors:
- entry anchors: 2023-04-03 00:00 UTC <= t < 2026-08-31 00:00 UTC
- final exit/rebalance mark: 2026-08-31 00:00 UTC

No result from these four assets under this strategy has been used to select or tune V1.

## Official data

Binance Vision public USD-M monthly archives only:
- 4h perpetual klines
- fundingRate

No premium data is required because V1 contains only Funding Carry.

No authenticated API, private account data, synthetic rows or interpolation.

## Raw factor

For asset i at weekly rebalance t:

`FUNDING_CARRY_7D = -sum(realized funding rates in [t-7d, t))`

Interpretation:
- more negative realized funding => higher factor => candidate LONG
- more positive realized funding => lower factor => candidate SHORT

This is frozen from the already-observed benchmark. No direction flip is allowed.

## Legacy benchmark-history eligibility

Preserve the exact history filter inherited from the V3 matched benchmark:

For each asset/week:
- current Funding Carry factor must be valid;
- inspect at most the prior 60 weekly anchors;
- require at least 52 valid prior Funding Carry observations;
- use the most recent 52 valid observations only for **availability qualification**;
- current observation is excluded from the 52-history requirement.

The 52 historical values are not used to rank assets. Ranking remains purely current cross-sectional ranking.

This filter is retained because it was part of the already-observed Funding Carry factor book. Removing it would define a different strategy.

## Sparse-input rule

Funding signal window is valid only when:
- all funding values are finite;
- timestamps are strictly increasing;
- no duplicate timestamps;
- no boundary/inter-event gap >12 hours inside [t-7d,t).

If fewer than 3 of the four objectively eligible assets meet current-factor plus history eligibility, the strategy is FLAT for that week.

No missing funding event is interpolated or synthesized.

## Cross-sectional ranking

On each active weekly anchor:

- sort valid assets by current `FUNDING_CARRY_7D`;
- LONG the single highest-ranked asset;
- SHORT the single lowest-ranked asset;
- LONG weight = +0.50;
- SHORT weight = -0.50;
- gross exposure = 1.00;
- net dollar exposure = 0.

No leverage beyond 1.0 gross.
No second pair, no rotation threshold, no discretionary skip, no stop, no TP, no pyramiding and no averaging down.

Weights change only at weekly anchors.

## Holding-period integrity

For every selected weekly position:
- exact entry 4h close at t is required;
- exact exit 4h close at t+1w is required;
- funding coverage in (t,t+1w] must contain finite values with no gap >12h.

Any selected position missing these inputs fails the complete validation stage closed with `DATA_INTEGRITY_FAILURE`.

## Weekly PnL

Price contribution:
- `w_i * (P_i(t+1w) / P_i(t) - 1)`

Funding contribution:
- `-w_i * sum(realized funding in (t,t+1w])`

Positive funding charges longs and rewards shorts.

Net weekly return:
- price contribution
- + funding contribution
- - modeled transaction costs

## Costs

Base:
- **8 bps per unit turnover**

Turnover:
- sum absolute change in asset weights versus previous weekly weights.

Stress:
- **32 bps per unit turnover**

At final validation exit:
- all positions forced flat;
- full terminal turnover charged.

No maker rebate, VIP discount or fee-token assumption.

## Metrics

Report:
- completed weekly periods
- active weeks
- compounded net return
- compounded price-only return
- cumulative funding contribution
- cumulative cost contribution
- Profit Factor
- annualized Sharpe = mean weekly return / sample stdev × sqrt(52)
- max drawdown
- five chronological-window returns
- long-side gross contribution
- short-side gross contribution
- per-asset PnL attribution
- positive-PnL asset count
- max positive-PnL concentration
- turnover
- 32 bps stress return
- valid breadth and flat-by-missing-input weeks

## Frozen transfer-validation gate

All conditions must pass:

- >=150 completed weekly periods
- >=70 active weeks
- compounded net return >0
- compounded price-only return >0
- cumulative funding contribution >0
- Profit Factor >=1.05
- annualized Sharpe >=0.50
- max drawdown <=25%
- >=3 of 5 chronological windows positive
- long-side contribution >0
- short-side contribution >0
- >=3 of 4 assets with positive PnL attribution
- no single positive asset contributes >50% of total positive PnL
- 32 bps stress compounded return >0
- no data-integrity failure

PASS => `TRANSFER_VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`

FAIL => `TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN`

Even a PASS does not authorize live execution.

## Anti-overfitting

- This protocol is committed before the first result on LTC/BCH/AVAX/HBAR.
- No factor definition or direction change.
- No asset substitution.
- No lookback change.
- No history-eligibility change.
- No side-count change.
- No cost reduction.
- No removal of price-only or funding-contribution gates.
- No date movement.
- No losing week exclusion.
- No reuse of the already-seen ten-asset development/temporal windows as independent evidence.
- Any redesign gets a new ruleset.

## Safety

Research only. No credentials, live orders, leverage, liquidation model, account mutation or automatic promotion.
