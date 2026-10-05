# Cross-Venue Funding Edge V2 — Canonical Source Audit Evaluation

Status: **CANONICAL SOURCE EVIDENCE VALID WITH INTEGRITY EPISODES**  
Ruleset: `CROSS-VENUE-FUNDING-EDGE-V2`  
Research stage remains: `SOURCE_AUDIT`  
Strategy PnL calculated: **false**

## Canonical lineage

The canonical source lineage is the first V2 Source Gate run triggered by the merge commit of PR #537.

- merge commit: `63f93aa41b6e054b229309b6fd6fbc2447a92181`
- workflow run: `37290831222`
- run attempt: `1`
- source job: `111700620728`
- artifact id: `11336541442`
- artifact name: `cross-venue-funding-edge-v2-source`
- artifact ZIP SHA-256: `97bf9772ed10e741d5a2a0de64ccde7e4dec703178f1b662796b0ce7f3258a32`
- source package SHA-256: `a2bb7802a6c6b4298466d16e0225ef616fe36ae2d85ac4af9d020127be4ce91b`
- canonical source receipt digest: `822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5`
- artifact expiry: `2027-01-03T09:33:33Z`

Attempt 1 completed successfully and produced a completed `validateCrossVenueV2Source` result. It is therefore the final source-semantic result for V2. No retry was used or is permitted after this completed validator result.

## Validator outcome

The frozen collector would throw `CROSS_VENUE_V2_SOURCE_INVALID` for any `ok:false` validator result. The canonical source job completed successfully and uploaded its artifact.

Canonical validator state:

`VALID_WITH_INTEGRITY_EPISODES`

This is not a clean-source claim and not a strategy-performance claim. It means the frozen V2 data contract accepted the source package while preserving the integrity events that V2 was explicitly preregistered to model.

## Source summary

- Binance funding rows: 5,024
- OKX funding rows: 5,024
- Binance 1h mark rows: 40,272
- OKX 1h mark rows: 40,272
- common canonical funding decision timestamps: 5,019
- integrity events: 3
- strategy PnL calculated: false

Frozen chronological split from the source receipt:

- Discovery: 3,011 timestamps, 2022-03-01 00:00 UTC through 2024-11-28 16:00 UTC
- Validation: 1,004 timestamps, 2024-11-29 00:00 UTC through 2025-10-29 08:00 UTC
- Holdout: 1,004 timestamps, 2025-10-29 16:00 UTC through 2026-09-29 00:00 UTC

These are source-only timestamp partitions. No strategy signal, position or PnL was calculated.

## Integrity episode

The canonical receipt contains exactly three integrity events, all representing the same known OKX 2022-12-18 episode:

1. `FUNDING_GAP`
   - venue: OKX
   - detected: 2022-12-18 16:00:01.001 UTC
   - previous funding: 2022-12-18 08:00:00 UTC
   - next authoritative funding: 2022-12-18 18:54:00 UTC
   - gap: 39,240,000 ms

2. `MISSING_SCHEDULED_FUNDING`
   - venue: OKX
   - scheduled timestamp: 2022-12-18 16:00:00 UTC
   - detected: 2022-12-18 16:00:01.001 UTC

3. `OFF_GRID_FUNDING`
   - venue: OKX
   - authoritative raw timestamp: 2022-12-18 18:54:00 UTC
   - detected: 2022-12-18 18:54:00 UTC

The existence of these events is not a source-contract failure in V2. V2 was preregistered specifically to retain such authoritative anomalies as `DATA_DEGRADED` episodes rather than interpolate, discard or silently normalize them.

Whether the later strategy has a position open when an integrity episode begins is deliberately **not evaluated here**. That belongs to the future deterministic runner. Under the frozen V2 rules, an open position at degradation onset would make the affected run/stage terminal `INCONCLUSIVE`.

## Canonical digests

- receipt: `822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5`
- integrity ledger: `0e0a7e1dc0b8ab616114d99ba7d475185b027caacdd1544d4ce06c8b2d9d4b07`
- provenance: `fe33cd2031b3740ba8b093521669ee8fe416ed6ac9a2259d4e18e4e065f9e5ea`
- Binance funding data: `442c4a68ef728ec42ccd0bedeb8a6c786e9ac9de573565d18aaaf9eb942ffef1`
- OKX funding data: `f35f14e28c8d3093a7ceaceeb488f2b930f27530fed876936b3f5c8cfeeb2c9f`
- Binance mark data: `0a5679947c8bcd5562ef9aecded5eb36706fc33515e7821aeff6deaeb86e57a7`
- OKX mark data: `ef7beb1a849710831c950cc561b90b7b80d3b0feb927bf7c966354cbde2c284b`

## Attempt classification

The pre-result execution classification was fixed before PR #537 merged.

Canonical attempt 1 classification:

`FINAL_SOURCE_SEMANTIC_RESULT / SUCCESSFUL VALIDATOR RESULT`

No transport retry occurred.

Because a completed validator result now exists, retrying the canonical run to seek another result is forbidden.

## Research interpretation

The canonical source evidence is accepted as reproducible V2 source evidence under the frozen source contract.

This evaluation does **not** authorize:

- Discovery;
- strategy PnL;
- Validation;
- Holdout;
- Paper;
- Live;
- any change to source semantics, coverage, recovery, economics, thresholds or gates.

V2 remains at `SOURCE_AUDIT` until a separately reviewed transition is justified.

Before any Discovery execution, the remaining implementation prerequisites from the prior Claude review must be completed and reviewed:

- `entryActive` must be strict boolean; undefined / string / numeric values must fail closed;
- deterministic episode state machine: integrity events → active degradation → pending-entry handling → position-open-at-detection → terminal outcome;
- independent cash/equity ledger construction so accounting reconciliation is not derived from the same summands it verifies;
- generic causality tests across event types.

Only after those prerequisites are frozen and reviewed may a separate Research-Stage-Transition PR be considered.
