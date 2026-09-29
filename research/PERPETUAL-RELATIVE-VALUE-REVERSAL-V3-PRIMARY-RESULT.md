# Perpetual Relative-Value Reversal V3 — Frozen PRIMARY_VALIDATION Result

Workflow run: **36607617284**  
Commit: `323ada40477e72e3690c3039a246bdd8a2c1080e`  
Artifact: **11051962272**  
Artifact ZIP SHA-256: `a3d22bfc7a8d6756d1f30c68ba8c1ace5fb4e70b08f9460a0a29ece97846a7de`  
Summary pre-hash SHA-256: `f346c2e5c2696307d6e441c69792fefa329997452988c1727b49fc6f8234b83d`  
Full evidence SHA-256: `a2b0776e337390e01557d64e03d6334f2efc05cfe1474adf37228b4c8a260b35`  
Markdown SHA-256: `e99111c2c0126415322e003ab7fae5749ebd2a895d3ba532a4590fb47e1e3f46`

This freezes the first untouched PRIMARY_VALIDATION result of `PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN`.

## Integrity and holdout isolation

- primary candidates: RUNE, ZIL, SEI, ARB, DYDX, KSM, WLD, MANA, ZEC, SUI
- benchmark basket: BTC, ETH, BNB, SOL, XRP
- raw window: 2024-01..2026-08
- validation window: 2025-01-06..2026-08-31
- weekly anchors: **86/86**
- active weeks: **86/86**
- data-integrity failure: **false**
- transfer assets loaded: **false**
- canonical invariant tests: **PASS**
- primary-only transfer-exclusion tests: **PASS**

The ASSET_TRANSFER_HOLDOUT remains untouched and unauthorized.

## Frozen economic result

- compounded net return: **-42.6143%**
- price-only compounded return: **-39.9291%**
- Profit Factor: **0.8454**
- annualized Sharpe: **-0.3737**
- max drawdown: **70.6637%**
- positive chronological windows: **3/5**
- stress return at 13 bps turnover cost: **-44.0540%**
- cumulative funding contribution: **-4.4471%**
- modeled base-cost contribution: **-4.0471%**
- turnover: **50.5890**
- positive-PnL candidates: **6/10**
- positive-PnL concentration: **58.0664%**
- mean selected-loser minus selected-winner next-week price spread: **-0.5142%**
- max absolute estimated pre-trade beta exposure: **1.6653e-16**
- mean absolute estimated pre-trade beta exposure: **6.0030e-17**
- ex-post realized market beta: **-0.07075**
- mean long gross: **0.4830**
- mean short gross: **0.5170**

## Candidate attribution

- RUNE: -49.6009%
- ZIL: +4.0299%
- SEI: -7.7737%
- ARB: +8.8705%
- DYDX: -17.9912%
- KSM: +18.1164%
- WLD: +92.2074%
- MANA: +6.4250%
- ZEC: -114.6011%
- SUI: +29.1472%

Attribution is additive contribution accounting, not standalone compounded asset return.

## Frozen gate result

**FAIL**

Gate reasons:
- `RETURN_NOT_POSITIVE`
- `PRICE_ONLY_NOT_POSITIVE`
- `PF_LT_1.10`
- `SHARPE_LT_0.50`
- `DD_GT_25`
- `STRESS_RETURN_NOT_POSITIVE`
- `POSITIVE_CONCENTRATION_GT_35`
- `LOSER_MINUS_WINNER_SPREAD_NOT_POSITIVE`

Decision:

**PRIMARY_VALIDATION_FAIL_RESEARCH_REDESIGN**

## Interpretation

The market-beta removal and beta-neutral sizing worked mechanically: estimated beta exposure was effectively zero and ex-post market beta remained within the frozen limit.

The strategy hypothesis itself failed. The selected residual losers underperformed selected residual winners on average in the next week, so the intended residual reversal sign was absent in this untouched primary validation. The loss cannot be rescued inside V3 by changing the beta estimator, split, formation horizon, selection, sizing, costs or gates.

Per the frozen sequential rule:
- do **not** load or evaluate the nine transfer candidates;
- do **not** run transfer PnL;
- do **not** promote to Paper;
- do **not** promote to live execution;
- any successor must be a new separately frozen ruleset with fresh evidence.

Research only. Execution impact remains false.
