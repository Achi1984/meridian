# Perpetual Cross-Sectional Reversal V1 — Frozen Discovery Result

Workflow run: **36601162954**  
Artifact: **11048529332**  
Artifact ZIP SHA-256: `dd2a7b037212b25360d3e462775f8b5958dcdbc1ce705fa3ee295708d6d2a4b4`  
Final summary JSON SHA-256: `6011821a0938e0eb9bf8e4ecfdc95b93b00673188937672e96e99741b78a8e54`  
Full evidence SHA-256: `baa6e7e010e8406225769daf3a79ed56cf809e4c719797fbf918e303ee8006dc`  
Markdown SHA-256: `8a0894981f2b8d366c7472f2a2700f904c28120ffc9eefcb9cdb0aa7355d7519`

This records the first untouched discovery result of `PERPETUAL-CROSS-SECTIONAL-REVERSAL-V1-FROZEN`.

## Frozen discovery scope

Universe: 23 prequalified non-mega-cap Binance USD-M perpetuals.

Signal:
- 8-week formation;
- 1-week skip;
- 1-week hold;
- weekly Monday rebalance;
- bottom quintile LONG recent losers;
- top quintile SHORT recent winners;
- equal-weight 50/50 dollar-neutral book;
- no volatility conditioning;
- no parameter grid.

Raw data window:
- 2023-11 through 2024-12

Trade window:
- 2024-01-08 through 2024-12-30

Holdout loaded: **false**

## Data integrity

- completed weekly periods: **51**
- min eligible assets: **23**
- max eligible assets: **23**
- side count: **4**
- data-integrity failure: **false**

## Economic result

- compounded net return: **+12.5970%**
- price-only compounded return: **+13.5384%**
- Profit Factor: **1.2414**
- annualized Sharpe: **0.5970**
- max drawdown: **17.0629%**
- positive chronological windows: **3/5**
- stress return at 13 bps turnover cost: **+10.6776%**
- funding contribution: **-0.8399%**
- modeled base-cost contribution: **-2.7600%**
- turnover: **34.5**
- mean next-week loser-minus-winner price spread: **+0.7284%**
- positive-PnL assets: **11/23**
- positive-PnL concentration: **23.30%**

## Side economics

- long-side gross contribution: **positive**
- short-side gross contribution: **negative**

The reversal signal was visible in the next-week loser-minus-winner price spread, but the short recent-winners book did not contribute positively enough to satisfy the preregistered two-sided strategy gate.

## Frozen gate result

**FAIL**

Gate reasons:
- `SHARPE_LT_0.75`
- `POSITIVE_WINDOWS_LT_4`
- `SHORT_CONTRIBUTION_NOT_POSITIVE`
- `POSITIVE_ASSETS_LT_14`
- `POSITIVE_CONCENTRATION_GT_20.0`

## Decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

The temporal holdout remains **unauthorized and unloaded**.

## Interpretation

V1 produced positive net and stress returns and a positive loser-minus-winner next-week spread, which is directionally consistent with the external reversal literature. It did not satisfy MERIDIAN's frozen robustness requirements.

This result must not be rescued by:
- removing the short side;
- adding a volatility filter inside V1;
- changing the 8-week formation horizon;
- changing the skip or holding period;
- switching to inverse-volatility weights;
- removing losing assets;
- relaxing costs or gates;
- opening the temporal holdout.

The externally motivated high-volatility reversal variant may only be tested as a **new, separately frozen successor ruleset**.
