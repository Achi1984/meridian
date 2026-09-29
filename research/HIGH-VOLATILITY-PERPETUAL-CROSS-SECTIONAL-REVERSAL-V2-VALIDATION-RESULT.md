# High-Volatility Perpetual Cross-Sectional Reversal V2 — Seen Validation Evidence

Status: **FAIL / HYPOTHESIS GENERATION ONLY**  
Execution impact: **false**  
Paper/live promotion: **not authorized**

## Provenance

First observed workflow run: **36602801293**  
Head commit: `920d5d6667822297641d63517fb913b3e93a4508`  
Artifact: **11050450931**  
Artifact ZIP digest: `sha256:e0d8cc9132b57adaa385b2caa854d01a93d3968b3fba2608f8c87ee3b6a06728`

A later replay, run **36603051332**, reproduced the same key metrics.

The executed engine/tests used the upper-half volatility rule. At the instant of the first run, the branch also contained a contradictory duplicate tercile protocol. The upper-half rule was selected as canonical before the PnL output was inspected, but the repository-level preregistration was still ambiguous at run time. Therefore this evidence cannot serve as a clean independent promotion gate.

## Observed economics

| Metric | Result |
|---|---:|
| Weekly periods | 86 |
| Full eligible assets | 23 every week |
| High-volatility subset | 12 every week |
| Side count | 2 |
| Net return | +11.381% |
| Price-only return | +10.614% |
| Profit Factor | 1.153 |
| Annualized Sharpe | 0.371 |
| Max drawdown | 20.627% |
| Positive chronological windows | 3/5 |
| Stress return | +7.930% |
| Positive-PnL assets | 15/23 |
| Positive-PnL concentration | 16.15% |
| Mean loser-minus-winner next-week spread | +0.514% |

Long-side gross contribution: **-0.6576**  
Short-side gross contribution: **+0.8857**

Frozen gate failures:
- `SHARPE_LT_0.5`
- `LONG_CONTRIBUTION_NOT_POSITIVE`

Economic decision: **VALIDATION_FAIL_RESEARCH_REDESIGN**

## Interpretation boundary

The observed asymmetry — harmful long recent-losers and profitable short recent-winners — is permitted only as hypothesis-generation evidence for a separately named successor. It must not be used to alter V2 or to reinterpret V2 as a pass.

The 2025-01-06..2026-08-31 window is now seen and cannot be reused as an independent validation gate for a successor.

No transfer validation, Paper shadow or live promotion is authorized.
