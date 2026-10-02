# MERIDIAN Chat Handoff

Status: **deep-audit reconciled**  
Updated: **2026-10-02**

## Current durable checkpoint

- Build: **10.0-r108**
- Verified main checkpoint: **da1dd62bcdd24d0c0d60d78fd700261e761f9102**
- UI/runtime r108 acceptance: **PASS**
- QH Individual Trades Data V1.1 merge: **PR #431 / 546ce0b3528d513adfe9858ad8248846f2290b6f**
- QH Data V1.1 canary workflow: **36839785637 / PASS**
- Execution impact: **false**

Repository state is the source of truth. Reconcile latest merged `main`, current CI/statuses, `MERIDIAN_RESUME.json`, and `MERIDIAN_AGENT_STATE.json` before using chat history. `sourceOfTruth.verifiedSha` is a verified checkpoint, not permission to skip the latest-main reconciliation.

## r108 live acceptance remains canonical

r108 remains fully accepted: PAPER COCKPIT READY without opening the PAPER view first; DEPOT, BOT CONTROL, FORECAST and LIVE DATA READY; MKT 15/15 and BOT 24/24. Do not reopen r93-r108 work unless new evidence contradicts those stored live passes.

## Quarter-Hour Data V1.1

The failed aggTrades Data V1 remains immutable. The replacement official Binance USD-M individual-trades Data V1.1 protocol is now merged on current-main lineage via PR #431.

Verified PR-head gates:

- parser invariants: **PASS**
- BTCUSDT / 2025-01 canary: **PASS**
- SOLUSDT / 2025-07 canary: **PASS**
- workflow run: **36839785637**
- Release Safety on the PR head: **PASS**
- shard/aggregate jobs in the PR run: intentionally **SKIPPED**

Therefore the source-feasibility stage is complete. Do not repeat it.

## Deep-audit findings carried forward

- Asset Watch strict-live validation must fail closed on future-dated source timestamps, stale envelopes, negative/inflated source age and freshness limits above the fixed 15-minute policy.
- Shared Asset Watch validation logic belongs in code + tests; workflow-local duplicate validation is not authoritative.
- Meridian continuity state must not claim an already-completed milestone as the next action. Release checks now include a continuity audit.
- The common Paper `markPosition()` still has legacy opening-fee semantics; Challenger V3 compensates locally. Do not change active Paper accounting without a dedicated migration/regression work package.
- Single-flight serialization for engine cycle and signal scan is present; do not reintroduce raw overlapping async intervals.

## Exact next durable step

1. Reconcile latest `main`, open PRs/branches and CI.
2. Run exactly one strategy-neutral QH Individual Trades Data V1.1 full workflow across all 120 asset-month shards.
3. Require aggregate **120/120 PASS**. Any failed shard freezes the stage for diagnosis; do not weaken invariants in place.
4. Until 120/120 PASS, do **not** calculate directional imbalance, forward returns, positions or PnL.
5. Keep live trading disabled and Paper/research lanes isolated.
