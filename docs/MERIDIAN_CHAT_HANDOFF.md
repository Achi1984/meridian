# MERIDIAN Chat Handoff

Status: **V1.3 full-data PASS reconciled**  
Updated: **2026-10-02**

## Current durable checkpoint

- Build: **10.0-r108**
- Verified main checkpoint: **d0a1c9051a1d58ae956af0b5403a2b7bc61b5bea**
- UI/runtime r108 acceptance: **PASS**
- Research gate: **V1.3 PASS**
- Full-run decision: **INDIVIDUAL_TRADES_DATA_V1_3_PASS_STRATEGY_PREREGISTRATION_REQUIRED**
- V1.3 full run: **36690368732**
- V1.3 aggregate artifact: **11090766829**
- Aggregate digest: `sha256:49211d4059f8cecc38133f8bea9ac5b4ce9bf23a041c242440cb25b335dbb344`
- Shards: **120/120 PASS**
- Execution impact: **false**

Repository state remains the source of truth. Reconcile latest merged `main`, CI, `MERIDIAN_RESUME.json`, `MERIDIAN_AGENT_STATE.json`, and related PRs before any mutation.

## Quarter-Hour data lineage

The canonical research lineage is:

1. **Data V1 / aggTrades — immutable FAIL.**
2. **Data V1.1 / individual trades — immutable FAIL** on the predeclared quoteQty gate (run **36621993141**). The later PR #431 port must not revive or overwrite this frozen decision.
3. **Data V1.2 — immutable FAIL**. Full run **36664484586** failed the strict trade-ID-order invariant in **ETHUSDT/2025-08, XRPUSDT/2025-08, ADAUSDT/2025-08**.
4. Diagnostics #356/#357 established that repeated trade IDs are distinct official source records and that ETH also reproduces source-row timestamp decreases.
5. **Data V1.3 — PASS.** Frozen source-record identity is archive SHA-256 + ZIP member + 1-based source-row ordinal; repeated/decreasing trade IDs and physical source-row timestamp decreases are diagnostic, not record-deletion rules.

## V1.3 full-run evidence

- frozen protocol head: `6c61574f0029d535c99d20420742ca02503f5e99`
- 6/6 canary gate: **PASS**, run **36687150944**
- canary Release Safety: **PASS**, run **36687150858**
- documentation-only authorization head: `65d783103b8d8311b17277c01ee6b4071526642e`
- full run: **36690368732**
- expected / observed shards: **120 / 120**
- missing / duplicate / unexpected shards: **0 / 0 / 0**
- hard gate reasons: **none**
- retained trade rows: **10,534,731,145**
- empty quarter-hour bins: **0**

Diagnostics only: 5 non-increasing/duplicate adjacent trade-ID events, 2 source-row timestamp decreases, 35 empty first-10-second windows, 1,299 raw quoteQty mismatch rows and 1,433 kline diagnostic mismatch minutes. These are not post-hoc gates.

The aggregate confirms no directional order imbalance, forward returns, signal/return relationship, positions or strategy PnL were calculated. Paper and live remain unauthorized.

## Runtime/audit findings carried forward

- Asset Watch strict-live validation fails closed on future timestamps, stale envelopes and freshness-policy inflation.
- Engine cycle and signal scan use single-flight serialization.
- Common Paper `markPosition()` still has legacy opening-fee semantics; Challenger V3 compensates locally. Handle only in a dedicated accounting migration/regression work package.

## Exact next durable step

Restore the already-frozen docs-only **Quarter-Hour Strategy V1 preregistration** from PR #354 onto the validated **Data V1.3** dependency.

Rules:
- change the data dependency only;
- do not change strategy rules, thresholds, costs, gates or accounting definitions;
- exact-head independent review + Release Safety before first strategy computation;
- only after preregistration is canonical may MERIDIAN calculate the first V1.3 directional signal / forward-return relationship / research PnL;
- Paper and live execution remain forbidden.
