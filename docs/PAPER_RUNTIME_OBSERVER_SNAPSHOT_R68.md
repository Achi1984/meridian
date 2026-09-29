# Paper Runtime Observer Snapshot r68

Status: **READ-ONLY RUNTIME EVIDENCE**  
Execution impact: **false**  
Trading/Paper parameters changed: **false**

## Purpose

The current server already exposes a public, read-only `/api/bot-observer` endpoint. This audit captures that endpoint from the deployed gateway so the Paper-bot deep audit can distinguish repository rules/historical evidence from fresh runtime telemetry.

## Safety contract

The capture fails unless:
- schema is `8.0-BOT-OBSERVER-V2`;
- `publicReadOnly=true`;
- `executionImpact=false`;
- `paperTrading=true`;
- `liveTrading=false`;
- `generatedAt` is valid and no older than the frozen freshness window.

No authenticated/private endpoint is used. No signal is submitted. No state is written to the runtime.

## Interpretation

The artifact may report current closed/open counts, PnL, drawdown, PF/win rate where exposed, learning-phase fields, freshness, and lifecycle state.

It does **not** by itself authorize:
- ranking unlike bot lineages as a single leaderboard;
- promotion;
- parameter changes;
- Paper/live execution changes.

Any performance comparison must normalize for lifecycle, sample size and ruleset before drawing conclusions.


## Captured result — run 36627547224

Artifact: `11059919127`  
Artifact ZIP SHA-256: `d6ed78290da5d9e7fe784a0e23bf625e73441f93b3ad0f1de622981ba92abcda`

Capture:
- capturedAt: `2026-09-29T20:36:55.143Z`
- observerGeneratedAt: `2026-09-29T20:36:54.964Z`
- observer age at capture: **179 ms**
- engine: **RUNNING**
- marketFresh: **true**
- engine errors: **0**
- paperTrading: **true**
- liveTrading: **false**

Directional/reference telemetry:

| Bot | Lifecycle | Closed | PnL | PF | DD | Win rate |
|---|---|---:|---:|---:|---:|---:|
| Baseline | REFERENCE | 30 | -853.52 | 0.63 | 11.35% | 40.0% |
| Challenger V2 | SEALED_REFERENCE | 23 | -29.72 | 0.98 | 8.96% | 47.8% |
| Challenger V3 | RETIRED_NO_EDGE | 33 | -201.12 | 0.73 | 2.44% | 48.5% |
| Challenger V4 Exit Shadow | PAIRED_SHADOW | 13 | -128.29 | 0.56 | 1.46% | 53.8% |

Challenger V3's own learning phase is already frozen at **RETIRE**, 30 phase trades, expectancy **-5.39**, PF **0.76**.

Funding:
- Funding Carry V1 is `ACTIVE_PAPER`: current exposed net PnL **-3.74**, funding income **+30.12**, basis PnL **-0.77**, estimated costs **33.09**, break-even remaining **3.74**.
- Funding Carry V2 is `WAITING_ENTRY`; current eligibility is false because `NET_CARRY_BELOW_HURDLE`, with observed cost coverage **0.43**.

R42 specialists:
- momentum: `SEALED`, 1 closed trade, PnL **-105.39**, reason `HISTORICAL_WALK_FORWARD_REJECTED`;
- pairs: `SEALED`, no trades, reason `NO_ROBUST_PAIR_IN_WALK_FORWARD`;
- squeeze: `WAITING_DATA`, reason `COMPLETE_LIQUIDATION_FEED_REQUIRED`;
- carry: `WAITING_ENTRY`, reason `NO_COST_COVERED_CARRY`.

## Audit interpretation

The fresh runtime snapshot does **not** provide evidence of a currently established profitable Paper bot. It supports the existing fail-closed lifecycle decisions: V3 retirement is consistent with its negative phase metrics; V2 remains a sealed reference; V4 has only 13 paired closes and negative aggregate telemetry; Funding Carry V1 remains active but has not yet covered estimated costs.

This is not a cross-lineage leaderboard: absolute PnL, sample size, lifecycle and strategy mechanics differ. The useful engineering conclusion is that the current runtime does not justify promotion or parameter rescue. New profit research should remain isolated under separately frozen protocols.
