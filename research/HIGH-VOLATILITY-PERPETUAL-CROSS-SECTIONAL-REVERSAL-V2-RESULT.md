# High-Volatility Perpetual Cross-Sectional Reversal V2 — Frozen Independent Validation Result

Workflow run: **36602801293**  
Artifact: **11050450931**  
Artifact ZIP SHA-256: `e0d8cc9132b57adaa385b2caa854d01a93d3968b3fba2608f8c87ee3b6a06728`  
Final summary JSON SHA-256: `431de3f881a54dc57ecb6ab1d5e92f615ed8c6ccd49375e36d0b6fbbdbe40612`  
Full evidence SHA-256: `76ed3a0f8bd43de2862371e424e817febef128b27108f6dd31b45e7c94bea61f`  
Markdown SHA-256: `77bca4c30c60a2aac49995e6456a4baf3f4f0f4fdba10a54b8b1bbb615c666c5`

This records the first observed validation result of `HIGH-VOLATILITY-PERPETUAL-CROSS-SECTIONAL-REVERSAL-V2-FROZEN`. It is economically informative but is not eligible to count as a clean independent promotion gate because the branch contained contradictory preregistration documents at the instant of the run.

## Protocol-integrity audit

At the first observed run, the executed engine/tests and primary frozen protocol used the upper-half volatility rule, but a second duplicate protocol in the same branch described a lower-tercile exclusion. The PR description also referenced that alternate rule.

The upper-half rule was selected as canonical before the PnL output was inspected, but the repository-level preregistration state was still ambiguous at run time. Therefore:
- the economic result remains frozen evidence;
- the FAIL decision remains unchanged;
- the result may be used only for hypothesis generation;
- it must not be represented as a clean independent validation pass/fail gate for promotion;
- the 2025-01-06..2026-08-31 window is now seen and cannot be reused as an independent successor gate.

## Frozen validation scope

Universe:
- same 23 non-mega-cap assets as V1

Validation window:
- 2025-01-06 through 2026-08-31
- 86 weekly periods

Only V2 strategy change versus V1:
- retain the upper half of the cross-section by ex-ante annualized realized volatility;
- volatility uses 56 daily log returns from the same eight-week formation interval ending before the one-week skip;
- reversal formation, skip, hold, equal weighting, funding accounting and 8/13 bps turnover costs remain unchanged.

## Data integrity

- completed weekly periods: **86**
- minimum full eligible assets: **23**
- high-volatility subset every week: **12**
- side count every week: **2**
- data-integrity failure: **false**

## Economic result

- compounded net return: **+11.3809%**
- price-only compounded return: **+10.6142%**
- Profit Factor: **1.1527**
- annualized Sharpe: **0.3706**
- max drawdown: **20.6269%**
- positive chronological windows: **3/5**
- stress return at 13 bps turnover cost: **+7.9298%**
- funding contribution: **+0.6914%**
- modeled base-cost contribution: **-5.0400%**
- turnover: **63.0**
- positive-PnL assets: **15/23**
- positive-PnL concentration: **16.15%**
- mean next-week loser-minus-winner price spread: **+0.5143%**

## Side economics

- long recent-losers gross contribution: **negative**
- short recent-winners gross contribution: **positive**

V2 therefore confirms a positive relative loser-minus-winner spread in the independent window, but does not validate the frozen two-sided high-volatility strategy because the long leg loses money and risk-adjusted performance remains below the preregistered threshold.

## Frozen gate result

**FAIL**

Gate reasons:
- `SHARPE_LT_0.5`
- `LONG_CONTRIBUTION_NOT_POSITIVE`

All other frozen V2 validation gates passed.

## Decision

**VALIDATION_FAIL_RESEARCH_REDESIGN**

No transfer validation is authorized. The observed window is now seen and is not reusable as an independent successor gate.

No Paper shadow and no live promotion are authorized.

## Cross-version interpretation

V1 and V2 both show a positive relative loser-minus-winner next-week price spread:
- V1: approximately **+0.728%**
- V2: approximately **+0.514%**

But the profitable absolute leg changed:
- V1: long losers positive / short winners negative;
- V2: long losers negative / short winners positive.

This is evidence for a relative-value reversal hypothesis, not evidence to relax V2's two-sided gate.

## Anti-overfitting decision

- no removal of the long-side-positive gate;
- no volatility-subset change;
- no volatility threshold grid;
- no inverse-volatility rescue;
- no 10-week rescue inside V2;
- no alternate skip/hold;
- no asset removal;
- no cost reduction;
- no gate relaxation;
- no transfer validation;
- no Paper/live promotion.

Any successor must receive a new ruleset and independent preregistration before additional strategy PnL.
