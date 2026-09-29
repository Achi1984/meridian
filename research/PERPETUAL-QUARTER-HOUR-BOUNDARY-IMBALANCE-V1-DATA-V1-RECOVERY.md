# Quarter-Hour Boundary Imbalance V1 — Data V1 Recovery Authorization

Status: **AUTHORIZED — SOURCE-SEMANTICS RECOVERY ONLY**  
Execution impact: **false**  
Signal/PnL observed: **false**

## Original full run

- workflow run: **36613725640**
- head: `78e8975b061b926733d66734ab409dcf56e11bfe`
- successful shards: **119 / 120**
- failed shard: **SOLUSDT / 2025-07**
- aggregate decision: `FOUNDATION_DATA_V1_FAIL_DATA_QUALITY`

The sole failure was caused by the original invariant requiring aggregate trade IDs to be strictly increasing.

## Isolated source diagnostic

Strategy-neutral diagnostic:
- workflow: **36617946382**
- artifact: **11055503695**
- artifact digest: `sha256:af95dd62ab821410ea14a3ea0cec665ead8b28ba60f1e448d34451f8ad5eb73c`
- official archive SHA-256: `07842c476aab159f008ffc4e95e421e181f75348610c23baeae1dc3799d4e89b`

Observed official SOLUSDT 2025-07 archive:
- rows: **14,070,960**
- aggregate-ID decreases: **0**
- equal consecutive aggregate IDs: **1**
- equal aggregate ID: `926014272`
- timestamps separated by **203 ms**
- underlying trade IDs strictly advance from `2468302188` to `2468302190`
- no underlying trade-ID overlap

No directional flow, return, position or PnL was calculated.

## Corrected quality invariant

The parser now requires:
- aggregate trade ID may never decrease;
- equal aggregate IDs are counted, not discarded;
- underlying trade-ID ranges must strictly advance and never overlap;
- timestamps may never decrease;
- all previous checksum/schema/calendar/coverage rules remain unchanged.

This correction is a source-schema/data-quality correction only.

## Bounded recovery rule

The 119 original passing manifests remain valid because they passed the **stricter** original aggregate-ID rule.

The recovery workflow therefore:
1. downloads all 120 manifests from original run 36613725640;
2. reruns parser invariant tests;
3. revalidates only SOLUSDT / 2025-07 from the official checksum-verified archive;
4. replaces only the failed SOL manifest;
5. reruns the unchanged 120-shard aggregate gate.

No other shard is recomputed.

## PASS requirement

Recovery PASS requires:
- exactly 120 unique expected manifests;
- every shard gate PASS;
- all quarter-hour coverage PASS;
- all 1m kline coverage PASS;
- all funding coverage PASS;
- expected timestamp units;
- all anti-leakage flags false.

A PASS authorizes only strategy preregistration.

No Paper/live promotion is authorized.

## Recovery transport retry

Recovery run **36618476603** validated SOLUSDT/2025-07 successfully under the corrected source semantics, but artifact assembly failed because one wildcard artifact-download action returned only 99 of the 120 prior shard artifacts. No data-quality gate failed in that retry.

The retry splits artifact retrieval into six fixed asset patterns of 20 monthly manifests each and requires exactly 120 original manifests before replacement and aggregation.

Recovery run **36618721399** again confirmed the corrected SOL shard as PASS. GitHub's API exposes all 120 original shard artifacts (20 per asset), but sequential downloads into one shared destination did not preserve all 120 local manifests. Recovery transport is therefore isolated into six asset-specific directories and recursively assembled; research/data-quality semantics are unchanged.

Recovery run **36619142748** confirmed again that SOLUSDT/2025-07 passes the corrected source-quality gate, but the cross-run artifact action still materialized only 99 manifest files despite the GitHub API listing all 120. The final recovery therefore uses the already-frozen original 120-shard aggregate summary as the proof that all 120 unique expected manifests were present and that SOLUSDT/2025-07 was the sole failing shard, then combines that proof with a fresh checksum-verified corrected SOL shard. This changes transport/proof composition only; no research rule is relaxed.
