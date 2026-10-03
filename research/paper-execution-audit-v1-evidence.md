# MERIDIAN Paper Execution Audit V1

Status: RESEARCH ONLY · PARTIAL PUBLIC SAMPLE · NO EXECUTION IMPACT

Source snapshot: 2026-09-08T06:00:37.869Z

| Bot | Last close UTC | Observed/ledger | SL sample | >1.25R | Max loss R | Close clusters | Direction bundles | Re-entries |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 2026-08-29T16:52:54.275Z | 25/30 | 0 | 0 | — | 3 | 2 | 12 |
| SHADOW_V1 | 2026-09-04T12:30:33.308Z | 12/23 | 10 | 9 | 2.476 | 2 | 1 | 6 |
| CHALLENGER_V2 | 2026-09-03T05:23:37.394Z | 12/23 | 8 | 7 | 1.39 | 2 | 1 | 5 |
| REGIME_V1 | 2026-09-04T12:30:33.906Z | 12/29 | 9 | 9 | 2.188 | 1 | 1 | 5 |

## Findings

- 25/27 evaluable stop exits exceed 1.25R including fees and sampled-price slippage.
- The largest observed stop loss is 2.476R.
- The partial windows contain 28 same-symbol/same-side re-entries within six hours, 5 directional multi-asset opening bundles and 8 close clusters.
- Baseline recentClosed projection omits position quantity and stop, so its stop-loss R cannot be reconstructed from the public contract.
- These are audit leads, not causal proof. A protected aggregate full-ledger export and candle-level replay are required before changing execution.

## Interpretation boundary

- Public assistant status exposes only recentClosed windows, not every persisted trade.
- Diagnostics describe execution behavior; they are not entry filters or promotion evidence.
- Stop-loss R includes realized fees and sampled-price slippage; it is not an exchange fill reconstruction.

The audit does not alter Baseline 6.2, research bots, risk gates, sizing, exits, Paper/live execution, Pionex or server.js. Full-ledger conclusions remain blocked until a protected aggregate export exists.
