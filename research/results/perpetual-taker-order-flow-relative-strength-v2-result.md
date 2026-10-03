# Taker Order Flow Relative Strength V2 — Independent Feature Validation

Generated: 2026-10-03T10:05:30.632268+00:00

Decision: **FEATURE_VALIDATION_FAIL_RESEARCH_STOP**

Source digest SHA-256: `ddcefc2fd1f1f0c8c6c66fcb6ec185701f0ccb4b8ae8f11ed31289a2a5a9d1a2`

No portfolio was formed. Strategy PnL calculated: **false**.

| Feature metric | Validation |
|---|---:|
| Weeks | 85 |
| Mean weekly Rank IC | 0.033896 |
| Median weekly Rank IC | 0.069930 |
| Positive IC weeks | 50/85 |
| Rank IC Newey-West(4) t | 1.0051 |
| Mean Top2-Bottom2 next-week spread | 0.9981% |
| Median Top2-Bottom2 spread | 0.9962% |
| Positive spread weeks | 52/85 |
| Spread Newey-West(4) t | 1.8676 |
| Positive IC blocks | 3/5 |
| Positive spread blocks | 4/5 |

## Chronological blocks

| Block | Weeks | Mean Rank IC | Mean Top2-Bottom2 spread |
|---|---:|---:|---:|
| 1 | 17 | -0.00987 | 1.7723% |
| 2 | 17 | 0.06211 | -0.1465% |
| 3 | 17 | 0.09831 | 2.6357% |
| 4 | 17 | -0.00082 | 0.3331% |
| 5 | 17 | 0.01974 | 0.3958% |

Gate: **FAIL**

Gate reasons: RANK_IC_NW_T_LT_1_645

A PASS authorizes only a separately preregistered strategy-design stage. A FAIL stops this V2 line. No Paper or live authorization.
