# Spot-Perp Basis Dislocation V1 — Frozen Discovery Result

Workflow run: **36597601282**  
Artifact: **11048020196**  
Artifact ZIP SHA-256: `f3d2878595423ca6f8f9c76a6de40c0b7c0b700aef6ea7315e8948f4c81a23c5`  
Final summary JSON SHA-256: `6749e1b289be6d4819f011382dc13b7202261ee077d5af2c4bc5e02495b826a8`  
Full evidence SHA-256: `98aa959ee6fb98d8c0df4441b506566cb102df2eafdf798f92b5a8a6dc8c0f75`  
Markdown SHA-256: `36a7ee7a3eef4c618d50f916c077b59e5910870e75127ea512fe5d8ce4a5c34d`

This records the first untouched discovery result of `SPOT-PERP-BASIS-DISLOCATION-V1-FROZEN`.

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

Signal/trade discovery:
- 2024-09 through 2025-08

Holdout:
- **not loaded**
- 2025-09 through 2026-08 remains untouched

## Data integrity

- data-integrity failure: **false**
- eligible signal evaluations: **8,736**
- synchronized Spot/Perp rows: complete
- no synthetic backfill
- no threshold mutation

## Frozen signal

A trade required all of:

1. current synchronized basis >= asset's trailing 90-day / 270-bar 95th percentile;
2. current basis >= **77.5 bps** cost-derived signal floor;
3. next-open basis >= **62 bps** stressed breakeven floor;
4. trailing 7-day realized funding >0;
5. exact 24h exit data.

## Result

- percentile + absolute-floor qualified signals: **0**
- execution-basis cancellations: **0**
- completed trades: **0**
- active months: **0**
- net PnL: **$0**
- basis PnL: **$0**
- funding PnL: **$0**
- base costs: **$0**
- stress PnL: **$0**
- positive windows: **0/5**
- positive assets: **0/8**

## Frozen gate reasons

- `TRADES_LT_32`
- `ASSETS_WITH_3_TRADES_LT_6`
- `ACTIVE_MONTHS_LT_8`
- `RETURN_NOT_POSITIVE`
- `NET_PNL_NOT_POSITIVE`
- `PF_LT_1.2`
- `POSITIVE_WINDOWS_LT_4`
- `BASIS_PNL_NOT_POSITIVE`
- `FUNDING_PNL_NOT_POSITIVE`
- `STRESS_RETURN_NOT_POSITIVE`
- `GROSS_EDGE_COST_RATIO_LT_1.25`
- `POSITIVE_ASSETS_LT_6`

## Decision

**DISCOVERY_FAIL_RESEARCH_REDESIGN**

No temporal holdout is authorized.

## Interpretation

The synchronized data foundation was excellent, but the preregistered trade condition did not occur once in 8,736 eligible 8h evaluations.

This is evidence that, on this eight-asset sample and under the frozen retail-style cost assumptions, positive Spot/Perp dislocations large enough to clear the stressed cost floor are too rare for this V1 strategy.

The failure is a **sample/market-structure fail**, not a data-quality or execution-engine fail.

## Anti-overfitting decision

- no reduction of the 77.5 bps signal floor;
- no reduction of the 62 bps execution floor;
- no percentile relaxation;
- no funding-confirmation removal;
- no longer holding period inside V1;
- no asset substitution;
- no fee/slippage reduction;
- no discovery-window movement;
- no holdout run;
- no Paper/live promotion.

Any successor must use a genuinely new preregistered hypothesis/ruleset. The untouched holdout may only be used as first independent evidence for such a successor if that successor is frozen before the holdout is observed.
