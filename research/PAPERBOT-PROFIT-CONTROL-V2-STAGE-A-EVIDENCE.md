# Paper Profit Control V2 — Stage A Runtime Evidence

Status: **FROZEN RUNTIME / FORWARD EVIDENCE**
Control: `research/PAPERBOT-PROFIT-CONTROL-V2.md`
Execution impact: **false**
Promotion authorized: **false**
Ranking authorized: **false**

## Provenance

- Workflow: **MERIDIAN Paper Profit Observer Stage A**
- Workflow run: **36741184819 — SUCCESS**
- Snapshot job: **109975687444 — SUCCESS**
- Artifact: **11110602473**
- Artifact name: `paper-profit-observer-stage-a`
- Artifact digest: `sha256:a01be5b716cd678c7dc8c445f370fe0f827f404dabff89569672cbca0776239e`
- Captured at: `2026-09-30T16:02:00.674Z`
- Observer generated at: `2026-09-30T16:02:00.592Z`
- Observer age at capture: **82 ms**

The workflow used the public read-only observer contract and the Stage A capture script later merged by PR #385 without functional change.

## Safety state

- engine state: **RUNNING**
- engine running: **true**
- market fresh: **true**
- engine errors: **0**
- paperTrading: **true**
- liveTrading: **false**

This evidence may describe current runtime state only. It does not authorize live trading, Paper promotion, parameter rescue or a cross-lineage leaderboard.

## Runtime / Forward telemetry

| Lineage | Lifecycle | Closed | PnL | Max DD | PF | Win rate | Forward interpretation |
|---|---|---:|---:|---:|---:|---:|---|
| BASELINE | REFERENCE | 30 | -853.52 | 11.35% | 0.63 | 40.0% | reference only |
| CHALLENGER V2 | SEALED_REFERENCE | 23 | -29.72 | 8.96% | 0.98 | 47.8% | sealed; blocked by MAX_DRAWDOWN |
| CHALLENGER V3 | RETIRED_NO_EDGE | 33 | -201.12 | 2.44% | 0.73 | 48.5% | retired; phase RETIRE |
| CHALLENGER V4 EXIT SHADOW | PAIRED_SHADOW | 13 | -128.29 | 1.46% | 0.56 | 53.8% | paired shadow; under-sampled |
| BTC FUNDING CARRY V1 | ACTIVE_PAPER | — | -2.11 | — | — | — | active Paper; no profitability claim |
| BTC FUNDING CARRY V2 | WAITING_ENTRY | — | — | — | — | — | no eligible entry at capture |

Additional V3 learning-phase telemetry:
- phase status: **RETIRE**
- phase trades: **30**
- phase expectancy: **-5.39**
- phase PF: **0.76**
- remaining trades: **0**

## Engineering interpretation

The fresh runtime evidence does **not** establish a profitable current Paper lineage.

That statement is not a ranking. The lineages differ in mechanics, lifecycle, sample size and exposure, so absolute PnL/PF comparisons cannot be promoted into one leaderboard.

The correct consequence is to preserve all existing lifecycle decisions and continue only through the separately frozen Profit Control V2 research process.

No observed result in this file may be used to relax a future acceptance gate.

## Stage A completion

The Stage A control plane is now evidenced by:

1. merged research-only control contract;
2. legacy v8 WATCH/WATCH+ scorer marked non-authoritative;
3. merged read-only observer capture and workflow;
4. successful fresh observer run with safety contract satisfied;
5. green Release Safety on the workflow PR;
6. no Paper/live parameter or execution-path change.

Stage A decision:

`PAPER_PROFIT_CONTROL_V2_STAGE_A_PASS_NUMERIC_GATES_REQUIRED`

The next stage is blocked until the numeric research acceptance gates are explicitly approved and frozen before candidate result inspection.
