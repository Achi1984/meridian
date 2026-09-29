# Spot-Perp Basis-Volatility Regime V1 — Frozen Feature Discovery Result

Workflow run: **36599250924**  
Artifact: **11049046196**  
Artifact ZIP SHA-256: `3fbec92c982a4977831820e2e27769a528f5f37043b52a0cd902375b5756f695`  
Summary prehash SHA-256: `5d667839f9bf354d82ba0fdc71e5aebee9308b077c27ce38d51f659ad7831227`  
Full evidence SHA-256: `1eb92c8ea4f229f733a7ad073074187ab71be7791b0a0d2c560b3b79e78dbf2f`  
Markdown SHA-256: `9b09196db45f22029c73297af7fd5e026ce72a078abb1f4093646942e0e2e23a`

This records the first untouched feature-discovery result of `SPOT-PERP-BASIS-VOLATILITY-REGIME-V1-FROZEN`.

## Frozen scope

Assets:
- APT
- APE
- CRV
- SUSHI
- DYDX
- LDO
- GALA
- IMX

Raw data:
- 2024-06 through 2025-08

Daily feature anchors:
- 2024-09-01 through 2025-08-30

Temporal feature holdout:
- **not loaded**
- 2025-09 through 2026-08 remains untouched

No strategy PnL was calculated.

## Data integrity

- 364 daily anchors
- 364 valid observations per asset
- 2,912 pooled observations
- data-integrity failure: **false**
- no synthetic reconstruction

## Frozen feature

At each 00:00 UTC anchor:
- feature = absolute synchronized Spot/Perp log basis known before the anchor;
- outcome = next 24h USD-M Perp realized-volatility proxy;
- control = previous 24h realized-volatility proxy.

## Pooled result

- Spearman(abs basis, forward RV): **-0.0320**
- Partial Spearman controlling lagged RV: **-0.0370**
- Top-basis-quartile forward-RV uplift: **0.9862×**
- Positive chronological windows: **1/5**

The pooled relationship is not positive and does not survive the lagged-volatility control.

## Per-asset result

| Asset | Spearman | Partial Spearman | Top-quartile uplift |
|---|---:|---:|---:|
| APT | +0.0213 | -0.0054 | 1.2071× |
| APE | +0.0357 | +0.0497 | 1.0893× |
| CRV | -0.1292 | -0.1028 | 0.8663× |
| SUSHI | -0.1284 | -0.1142 | 0.8116× |
| DYDX | -0.1413 | -0.1581 | 0.8203× |
| LDO | +0.0494 | +0.0499 | 1.0356× |
| GALA | +0.0702 | +0.0480 | 1.1884× |
| IMX | -0.0330 | -0.0471 | 1.0874× |

Positive Spearman assets: **4/8**  
Positive partial-Spearman assets: **3/8**  
Top-quartile uplift >1 assets: **5/8**

## Stability

| Window | Pooled Spearman |
|---|---:|
| 1 | -0.0643 |
| 2 | +0.1143 |
| 3 | -0.0159 |
| 4 | -0.1069 |
| 5 | -0.1294 |

Only **1/5** windows is positive.

## Frozen gate reasons

- `POOLED_SPEARMAN_LT_0.1`
- `POOLED_PARTIAL_LT_0.05`
- `POOLED_UPLIFT_LT_1.1`
- `POSITIVE_SPEARMAN_ASSETS_LT_6`
- `POSITIVE_PARTIAL_ASSETS_LT_5`
- `POSITIVE_UPLIFT_ASSETS_LT_6`
- `POSITIVE_WINDOWS_LT_4`

## Decision

**FEATURE_DISCOVERY_FAIL_RESEARCH_REDESIGN**

The temporal feature holdout remains unauthorized.

No directional volatility-regime strategy may be designed from this V1 lineage.

## Interpretation

On this frozen eight-asset sample, absolute Spot/Perp basis does not provide robust positive information about next-24h Perpetual realized volatility beyond lagged realized volatility.

The result therefore does not reproduce the motivating feature relationship strongly enough for MERIDIAN's preregistered gate.

## Anti-overfitting decision

- no alternative horizon inside V1;
- no signed-basis rescue;
- no lower correlation gate;
- no asset removal;
- no feature-holdout run;
- no trading-strategy PnL;
- no Paper/live promotion.

Any successor must be a genuinely different preregistered hypothesis or dataset.
