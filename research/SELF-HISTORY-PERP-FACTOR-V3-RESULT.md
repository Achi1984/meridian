# Self-History Perpetual Factor V3 — Frozen Discovery Result

Workflow run: **36557014408**  
Artifact: **11027324267**  
Artifact ZIP SHA-256: `1c4e57ea86bc6b58b41da5760f53623a3424b00a6fb4d6a225ed4812e9d8d2d3`  
Summary SHA-256: `e9d6b65f13fa444a8599a66e5589c896ac03b67be6393b6263a55ac3fcea0969`  
Full evidence SHA-256: `18d5d01438c51dd9dade391f76b34714daa040c345916a66588567c1ce8fc4de`  
Markdown SHA-256: `03db6a24a5448bf22fa8e40f8bbd8aa492269fd8c3fe8fb6de1c8fedfdad967f`

This records the first untouched economic discovery result of `SELF-HISTORY-PERP-FACTOR-V3-FROZEN`.

## Frozen decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

No temporal holdout is authorized.

## Data integrity

- data-integrity failure: **false**
- completed weekly periods: **91**
- sparse-input handling operated as preregistered
- no interpolation or synthetic reconstruction

## Own-History result

- active combined weeks: **2 / 91**
- compounded net return: **-0.9344%**
- price-only return: **-0.9687%**
- Profit Factor: **0.122**
- annualized Sharpe: **-0.692**
- max drawdown: **1.063%**
- positive chronological windows: **1/5**
- 4x-cost stress return: **-1.2518%**
- positive-PnL assets: **2**
- positive-PnL concentration: **56.79%**
- long contribution: **negative**
- short contribution: **negative**

### Own-History factor books

| Factor | Return | Active weeks |
|---|---:|---:|
| MOMENTUM_12W | -3.1079% | 1 |
| FUNDING_CARRY_7D | +0.3092% | 1 |
| PREMIUM_REVERSION_7D | 0.0000% | 0 |

The factor-valid breadth was normally sufficient:
- Momentum: 9 valid assets every week
- Funding: 9 valid assets every week
- Premium: average 8.95 valid assets; one sparse-input flat week

Therefore the low activity is primarily caused by the frozen Own-History 80/20 signal construction plus the requirement for at least two longs and two shorts, not by broad data unavailability.

## Matched Cross-Sectional benchmark — development evidence only

The benchmark was preregistered inside V3 and used identical factor definitions, timestamps, source data, funding and costs.

It is **not** an independently validated strategy and may not be promoted from this result.

Observed development-window metrics:

- active weeks: **91 / 91**
- compounded net return: **+34.0556%**
- price-only return: **+28.0543%**
- Profit Factor: **1.462**
- annualized Sharpe: **0.835**
- max drawdown: **13.043%**
- positive chronological windows: **5/5**

Factor-book returns:
- MOMENTUM_12W: **+75.4919%**
- FUNDING_CARRY_7D: **+9.4729%**
- PREMIUM_REVERSION_7D: **+12.8787%**

This result is hypothesis-generating only because the 2023-04 through 2024-12 window has now been observed.

## Frozen gate reasons

- ACTIVE_WEEKS_LT_55
- MOMENTUM_12W:ACTIVE_LT_40
- FUNDING_CARRY_7D:ACTIVE_LT_40
- PREMIUM_REVERSION_7D:ACTIVE_LT_40
- RETURN_NOT_POSITIVE
- PRICE_ONLY_NOT_POSITIVE
- PF_LT_1.15
- SHARPE_LT_0.75
- POSITIVE_WINDOWS_LT_4
- LONG_CONTRIBUTION_NOT_POSITIVE
- SHORT_CONTRIBUTION_NOT_POSITIVE
- POSITIVE_ASSETS_LT_6
- POSITIVE_CONCENTRATION_GT_35.0
- STRESS_RETURN_NOT_POSITIVE
- POSITIVE_FACTOR_BOOKS_LT_2
- OWN_NOT_ABOVE_XSEC
- OWN_FACTOR_BEATS_LT_2

## Anti-overfitting decision

- V3 thresholds are not changed.
- The 80/20 percentile rule is not widened.
- The two-long/two-short minimum is not lowered.
- No factor is removed or reweighted.
- No discovery date is moved.
- No temporal holdout is run for V3.
- V3 is not promoted to Paper or live execution.

The Cross-Sectional benchmark may motivate a **new separately frozen strategy**, but its already-observed development window may not be reused as independent discovery evidence. Its first gating evaluation must use fresh/unseen data.
