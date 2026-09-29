# Perpetual Relative-Value Reversal V3 — Frozen PRIMARY_VALIDATION Result

Workflow run: **36607477951**  
Artifact: **11051153798**  
Artifact ZIP SHA-256: `87dbb161b12bd55509fe78cd56f273ca9c686e60d51095885f01fb69a37ab95a`  
Summary prehash SHA-256: `79ca3b2c30d63fc20573d41821f1dd22be22103c344ebc8149a6cb57b4d73f06`  
Full evidence SHA-256: `601552b874f1f33fee3cd8a813c6b5b69b1a4f619fd437ec509c6d2c67027742`  
Markdown SHA-256: `35a1fde3051d49ebdb638d86149b780915f24e42c9deb7a2856fe21ac5bff1bc`

This records the first untouched PRIMARY_VALIDATION result of `PERPETUAL-RELATIVE-VALUE-REVERSAL-V3-FROZEN`.

## Frozen scope

Primary candidates:
- RUNE
- ZIL
- SEI
- ARB
- DYDX
- KSM
- WLD
- MANA
- ZEC
- SUI

Benchmark-only assets:
- BTC
- ETH
- BNB
- SOL
- XRP

Raw data:
- 2024-01 through 2026-08

Validation:
- 2025-01-06 through 2026-08-31
- 86 weekly anchors

ASSET_TRANSFER_HOLDOUT loaded: **false**  
ASSET_TRANSFER_HOLDOUT calculated: **false**

## Data integrity

- data-integrity failure: **false**
- completed anchors: **86**
- active weeks: **86/86**
- frozen invariant tests: **PASS**
- estimated beta neutrality max absolute exposure: **1.6653e-16**

The beta-neutral construction worked mechanically as specified.

## Economic result

- compounded net return: **-42.6143%**
- price-only compounded return: **-39.9291%**
- Profit Factor: **0.8454**
- annualized Sharpe: **-0.3737**
- max drawdown: **70.6637%**
- positive chronological windows: **3/5**
- stress return at 13 bps turnover cost: **-44.0540%**
- funding contribution: **-4.4471%** in simple cumulative-return units
- base transaction-cost contribution: **-4.0471%** in simple cumulative-return units
- turnover: **50.5890**
- positive-PnL assets: **6/10**
- positive-PnL concentration: **58.07%**
- mean selected loser-minus-winner next-week price spread: **-0.5142%**
- ex-post realized market beta: **-0.07075**

Diagnostics:
- long gross contribution: **negative**
- short gross contribution: **negative**
- mean long gross: **0.4830**
- mean short gross: **0.5170**

## Frozen gate result

**FAIL**

Reasons:
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

The market-beta removal objective was achieved mechanically, including near-zero estimated pre-trade beta and low ex-post realized market beta. The residualized reversal hypothesis itself failed economically on the frozen primary universe: returns, risk-adjusted performance, stress performance and the loser-minus-winner spread all failed.

The result must not be rescued by:
- loading the transfer holdout;
- changing the benchmark basket;
- changing the beta estimator or lookback;
- changing formation, skip or holding periods;
- changing the two-per-side selection;
- changing the 20–80 side-gross guard;
- changing costs;
- removing losing assets;
- relaxing gates.

The ASSET_TRANSFER_HOLDOUT remains **unauthorized and untouched**.

V1, V2 and V3 together are sufficient to close the current cross-sectional reversal research family for promotion purposes. Any future reversal work requires materially new external evidence and a separately frozen ruleset.

Research only. No Paper or live promotion.
