# MERIDIAN Chat Handoff

Status: **Data V1.3 PASS + Strategy V1 preregistration canonical**  
Updated: **2026-10-02**

## Current durable checkpoint

- Build: **10.0-r108**
- Verified main checkpoint: **cdf3b7db841816cd684a7a18a528299433ec703d**
- UI/runtime r108 acceptance: **PASS**
- Research gate: **V1.3 PASS**
- Full-run decision: **INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED**
- V1.3 full run: **36690368732**
- V1.3 aggregate artifact: **11090766829**
- Aggregate digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`
- Shards: **120/120 PASS**
- Strategy V1 preregistration: **canonical via PR #435**
- Execution impact: **false**
- Paper/live authorization: **false**

Repository state remains the source of truth. Reconcile latest merged `main`, CI, `MERIDIAN_RESUME.json`, `MERIDIAN_AGENT_STATE.json`, and related PRs before any mutation.

## Quarter-Hour data lineage

1. **Data V1 / aggTrades — immutable FAIL.**
2. **Data V1.1 / individual trades — immutable FAIL** on frozen predeclared gates (run **36621993141**). Later ports must not revive that result.
3. **Data V1.2 — immutable FAIL**. Full run **36664484586** failed strict trade-ID ordering in **ETHUSDT/2025-08, XRPUSDT/2025-08, ADAUSDT/2025-08**.
4. Diagnostics #356/#357 established that repeated IDs represent distinct official source records and that ETH also contains source-row timestamp decreases.
5. **Data V1.3 — PASS.** Full run **36690368732**, exactly **120/120 PASS**, zero missing/duplicate/unexpected shards and zero hard-gate reasons.

## Frozen Strategy V1

The original docs-only preregistration was frozen in #354 before MERIDIAN inspected its own Quarter-Hour signal, forward returns or strategy PnL. PR #435 restored that exact strategy design onto validated Data V1.3.

Independent normalization review confirmed that after removing only the Data V1.2 -> V1.3 dependency/provenance changes, the restored preregistration is byte-identical to #354.

Frozen strategy properties include:
- continuation signal from first 10 seconds after each 00/15/30/45 boundary;
- normalized signed individual-trade flow;
- primary **12h / 48-cohort** horizon;
- per-asset max absolute target **1/6 equity**;
- total gross cap **1.0x**;
- first valid trade in `[t+10s,t+60s)` as the execution reference;
- primary cost **6 bp one-way**, with 3/10 bp diagnostics;
- realized funding with no post-funding lookahead;
- fixed B1-B4 chronological blocks;
- unchanged six primary research gates;
- no post-result strategy-rule rescue.

No historical Strategy V1 PnL has been authorized or inspected yet.

## Runtime / audit safeguards

- Asset Watch strict-live validation fails closed on future timestamps, stale envelopes and freshness-policy inflation.
- Engine cycle and signal scan use single-flight serialization.
- Common Paper `markPosition()` still has legacy opening-fee semantics; Challenger V3 compensates locally. Handle only in a dedicated accounting migration/regression work package.
- Release Safety must execute `scripts/continuity-audit.mjs` as an explicit named hard gate, not merely expose it through an npm script.

## Exact next durable step

Create a separate **Strategy V1 deterministic implementation** work package.

Before the first historical evidence run, it must prove with tests and independent review:
1. signal direction and first-10-second boundary construction;
2. 12h cohort expiry and net target accounting;
3. 1/6 per-asset and 1.0x gross-cap invariants;
4. turnover cost accounting at 6 bp primary;
5. no-lookahead execution price in `[t+10s,t+60s)`;
6. funding sign and last-pre-funding valuation;
7. fixed B1-B4 evaluation blocks;
8. all six primary research gates;
9. no Paper/live execution path.

Only after exact-head Release Safety + implementation review may the historical V1.3 Strategy V1 signal/return/PnL run execute.
