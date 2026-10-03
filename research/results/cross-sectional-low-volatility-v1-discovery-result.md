# Cross-Sectional Low-Volatility V1 — Discovery

Generated: 2026-10-03T14:33:12.771730+00:00

Decision: **DISCOVERY_FAIL_RESEARCH_STOP**

Source digest SHA-256: `6a562441822e70f7086e179beee785ff268c2c2986d5815325d1fce8302829d1`

No holdout was evaluated. Strategy PnL calculated: **false**.

| Feature metric | Discovery |
|---|---:|
| Weeks | 48 |
| Mean weekly Rank IC | 0.215035 |
| Median weekly Rank IC | 0.286713 |
| Positive IC weeks | 35/48 |
| Rank IC Newey-West(4) t | 4.3375 |
| Mean Low-2 minus High-2 next-week spread | 1.0254% |
| Median Low-2 minus High-2 spread | 2.7325% |
| Positive spread weeks | 32/48 |
| Spread Newey-West(4) t | 0.9583 |
| Positive IC blocks | 4/4 |
| Positive spread blocks | 3/4 |

## Chronological discovery blocks

| Block | Weeks | Mean Rank IC | Mean Low-2 minus High-2 spread |
|---|---:|---:|---:|
| 1 | 12 | 0.12646 | -0.0072% |
| 2 | 12 | 0.25175 | 0.9426% |
| 3 | 12 | 0.28904 | 2.9446% |
| 4 | 12 | 0.19289 | 0.2218% |

Gate: **FAIL**

Gate reasons: SPREAD_NW_T_LT_1_645

A PASS authorizes only the separately controlled untouched holdout stage. A FAIL closes V1 without retuning. No Paper or live authorization.
