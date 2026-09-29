# Cross-Sectional Perpetual Factor V1 — Frozen Validation Protocol

Status: **FROZEN BEFORE FIRST INDEPENDENT RESULT**  
Execution impact: **false**  
Auto-promotion: **false**

Parents:
- `PERPETUAL-FACTOR-DATA-V1`
- `PERPETUAL-FACTOR-ROW-CONTINUITY-V1`
- development evidence from the matched Cross-Sectional benchmark inside `SELF-HISTORY-PERP-FACTOR-V3-FROZEN`

## Why this is a new ruleset

The V3 Own-History strategy failed. Its preregistered matched Cross-Sectional benchmark, however, produced strong development-window results on 2023-04-03 through 2024-12-30:

- net return +34.0556%
- price-only return +28.0543%
- Profit Factor 1.4621
- annualized Sharpe 0.835
- max drawdown 13.0427%
- 5/5 positive chronological windows
- factor books: Momentum +75.4919%, Funding Carry +9.4729%, Premium Reversion +12.8787%

Those numbers are **seen development evidence only**. They are not independent discovery evidence and cannot authorize promotion.

Cross-Sectional Perpetual Factor V1 freezes the exact benchmark logic and evaluates it first on unseen temporal data.

## Fixed factor definitions

Identical to V3.

### F1 — MOMENTUM_12W
- raw = exact preceding completed 4h close at t / exact preceding completed 4h close at t-12 weeks - 1
- high factor = LONG
- low factor = SHORT

### F2 — FUNDING_CARRY_7D
- raw = negative sum of realized funding in [t-7d,t)
- high factor = LONG
- low factor = SHORT

### F3 — PREMIUM_REVERSION_7D
- raw = negative arithmetic mean of all 42 expected completed 4h premium closes in [t-7d,t)
- high factor = LONG
- low factor = SHORT

No factor may be added, removed, reweighted or direction-flipped after validation begins.

## Fixed universes

### Temporal validation universe
- BTC
- ETH
- BNB
- SOL
- XRP
- ADA
- DOGE
- LINK
- DOT
- SUI

Objective eligibility remains inherited from the data foundation:
- BTC/ETH/BNB/SOL/XRP/ADA/DOGE/LINK/DOT eligible from 2023-01
- SUI eligible from 2025-05

### Reserved transfer-validation universe
Never used for temporal validation:
- LTC
- BCH
- AVAX
- HBAR

Eligibility:
- LTC/BCH/AVAX from 2023-01
- HBAR from 2023-03

No asset may move between universes.

## Validation windows

### Seen development window
- 2023-04-03 <= t < 2024-12-30
- **not gating**
- may be cited only as hypothesis-generating evidence

### First independent temporal validation
- weekly Monday anchors
- entry anchors: 2025-01-06 00:00 UTC <= t < 2026-08-31 00:00 UTC
- final exit/rebalance mark: 2026-08-31 00:00 UTC
- no parameter changes before or during this stage

### Transfer validation
Allowed only after temporal validation passes:
- LTC/BCH/AVAX/HBAR
- entry anchors: 2023-04-03 <= t < 2026-08-31
- final exit/rebalance mark: 2026-08-31
- exact same factor definitions, portfolio construction, costs and sparse-input rules
- no asset substitution

A transfer pass may authorize only a prospective Paper shadow.

## Sparse-input/data rule

Identical to V3:
- no interpolation
- no nearest-neighbor substitution
- no synthetic rows

Current factor validity:
- Momentum requires both exact required price marks
- Funding requires finite values and no boundary/inter-event gap >12h in the 7d signal window
- Premium requires all 42 expected 4h premium rows in the prior 7d window

For each factor/week:
- use only objectively eligible assets with a valid current raw factor
- temporal factor book requires >=8 valid assets, otherwise that factor book is FLAT
- transfer factor book requires >=3 valid assets, otherwise that factor book is FLAT

Holding integrity:
- exact entry price
- exact next-week exit price
- active holding funding coverage with no gap >12h

Any active selected position missing holding inputs fails the stage closed with `DATA_INTEGRITY_FAILURE`.

## Cross-sectional ranking

For each factor independently and each weekly anchor:

Temporal:
- N = number of valid eligible assets
- side count = max(2, floor(N/5))
- highest raw factors LONG
- lowest raw factors SHORT

Transfer:
- side count = 1
- highest raw factor LONG
- lowest raw factor SHORT

Portfolio per factor book:
- gross exposure = 1.00
- LONG gross = +0.50, equal weight
- SHORT gross = -0.50, equal weight
- net dollar exposure = 0
- no leverage beyond 1.0 gross
- weekly rebalance only
- no stops, TP, pyramiding, averaging down or discretionary override

## Combining factor books

Independent books remain independent.

Combined weekly strategy return:
- 1/3 F1
- + 1/3 F2
- + 1/3 F3

Raw factor scores are never averaged.

## Price, funding and costs

Price contribution:
- w_i × (P_i(t+1w)/P_i(t)-1)

Funding:
- -w_i × sum(realized funding in (t,t+1w]

Base modeled transaction cost:
- 8 bps × factor-book turnover

Turnover:
- sum absolute change in asset weights versus that factor book's prior weekly weights

Stress:
- 32 bps × turnover

Final stage anchor:
- all factor books forced flat
- full terminal turnover charged

No rebates, maker assumptions, VIP discounts or fee-token discounts.

## Metrics

Report:
- completed weekly periods
- active combined weeks
- active weeks by factor book
- compounded net return
- compounded price-only return
- funding contribution
- modeled cost contribution
- Profit Factor
- annualized Sharpe = mean weekly return / sample stdev × sqrt(52)
- max drawdown
- five chronological-window returns
- long-side gross contribution
- short-side gross contribution
- per-asset attribution
- positive-PnL asset count
- positive-PnL concentration
- turnover
- 4x-cost stress return
- each factor-book return

## Frozen temporal-validation gate

All must pass:

- >=75 completed weekly periods
- >=45 active combined weeks
- each factor book active >=30 weeks
- combined net return >0
- combined price-only return >0
- Profit Factor >=1.05
- annualized Sharpe >=0.50
- max drawdown <=20%
- >=3 of 5 chronological windows positive
- long-side contribution >0
- short-side contribution >0
- >=6 temporal-universe assets with positive PnL attribution
- no single positive asset contributes >40% of total positive PnL
- 4x-cost stress return >0
- at least 2 of 3 factor books have positive net return
- no data-integrity failure

PASS => `TEMPORAL_VALIDATION_PASS_TRANSFER_REQUIRED`  
FAIL => `TEMPORAL_VALIDATION_FAIL_RESEARCH_REDESIGN`

## Frozen transfer-validation gate

All must pass:

- >=150 completed weekly periods
- >=70 active combined weeks
- each factor book active >=45 weeks
- combined net return >0
- combined price-only return >0
- Profit Factor >=1.05
- annualized Sharpe >=0.50
- max drawdown <=25%
- >=3 of 5 chronological windows positive
- long-side contribution >0
- short-side contribution >0
- >=3 of 4 transfer assets with positive PnL attribution
- no single positive asset contributes >50% of total positive PnL
- 4x-cost stress return >0
- at least 2 of 3 factor books have positive net return
- no data-integrity failure

PASS => `TRANSFER_VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY`  
FAIL => `TRANSFER_VALIDATION_FAIL_RESEARCH_REDESIGN`

Even a transfer pass does not authorize live execution.

## Anti-overfitting

- This protocol is committed before the first unseen 2025-2026 result.
- The seen 2023-2024 development window is never reused as independent evidence.
- No factor definition, factor direction, side count, cost, universe, sparse-input rule or validation date may change after the first independent run.
- No factor may be removed because it underperforms validation.
- No validation asset may be removed because it loses money.
- No cost reduction is allowed.
- No losing week may be excluded.
- Any redesign receives a new ruleset.

## Safety

Research only. No exchange credentials, live orders, leverage, liquidation model, account mutation or automatic promotion.
