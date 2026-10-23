# Arena historical-result projection

The Arena has a separate, read-only projection for generated UI fixtures. There
is no accepted browser export envelope for `journal.inspect_b1()` and this
proposal is not one. The fixture wrapper is versioned as
`MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1`, declares `SYNTHETIC_ONLY`, and contains
`purpose: UI_FIXTURE_NOT_PRODUCER_EXPORT`. It must not be represented as a
producer export, receipt, authenticated evidence, admission, or permission.
No genuine report import or captured-data read is enabled.

The wrapper's `job` uses the exact returned field names from
`scripts/research-supervisor/journal.py` (`_b1_job`/`inspect_b1`): trial and
profile identities, protocol/source/data/manifest digests, descriptor-order
`pathIds`, computation-order `computationPathIds`, timestamps and progress
`paths`, serialized `controls` and `result`, control bindings, result and
summary digests, reason, unresolved state, and false authority flags. The
44-path descriptor inventory is separate from progress and available results.
Both identity arrays must be unique permutations of the same identities.
Progress and returned path results retain their producer order; missing results
are not synthesized. `CLAIMED` and `RUNNING` are displayed as unresolved
`unknown`, with their fence and explicit-reconciliation requirement kept
separate from the engine result status.
The engine summary status and the screen status remain distinct: a completed
44-path summary may carry `status: COMPLETED` while its returned
`screen.status` is `INSUFFICIENT_EVIDENCE`.

The parser rejects unknown envelope/job/result keys, malformed nested JSON,
conflicting path identities, results outside the inventory, invalid numbers,
and contradictory lifecycle/result completion. It enforces a 1 MiB UTF-8
fixture ceiling before JSON parsing, bounded strings, arrays, node count and
nested depth; serialized controls are capped at 8 KiB. This is a UI limit, not
a promise that every future journal result fits. Inputs are escaped for display
and invalid or unreadable input clears the previous fixture.

The section displays only fields supplied by the fixture. It does not calculate
returns, deltas, rankings, winners, or edge/no-edge conclusions, and it never
calls the replay/import/storage/network paths. Missing producer fields remain
unavailable. Schema and syntactically valid digest strings do not establish
source authenticity, admission, or authority. Historical interpretation,
holdout status, assumed costs, `NO_FINITE_TRADE_STOP`, and
`sourceAuthenticity: NOT_ESTABLISHED` are shown only when present in the
serialized producer result. Replay, the existing synthetic inspection panel,
and disposal behavior remain separate.

## Proposed producer-export checkpoint (pending Lead acceptance)

This is a contract proposal, not an accepted interface. Do not implement the
exporter or connect it to the Arena until Lead accepts this envelope. It is
distinct from `MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1`; neither envelope is an
authenticity receipt, admission, or authority.

The proposed envelope is an exact-key object:

```text
{
  schema: "MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1",
  purpose: "B1_RESULT_EXPORT_NOT_AUTHENTICITY_RECEIPT",
  provenance: {
    source: "CALLER_SUPPLIED_INSPECT_B1",
    assertionStatus: "UNVERIFIED",
    sourceAuthenticity: "NOT_ESTABLISHED",
    syntheticFixture: boolean
  },
  job: <inspect_b1-shaped observation, unchanged>,
  payloadSha256: <SHA-256 hex>
}
```

`job` has the exact fields returned by `inspect_b1()`, including its serialized
`result` string. The pure exporter proposal is
`exportHistoricalResult({observation, resultBytes, syntheticFixture})`; it
performs no file, journal, environment, clock, network, or execution access.
`resultBytes` must be the exact UTF-8 bytes represented by `observation.result`;
when the result is absent, both must be absent. Its SHA-256 must equal
`observation.resultSha256`. The exporter copies the observation without
normalizing or reordering its progress/results. The validator accepts only the
version above and recomputes `payloadSha256` over the object containing exactly
`schema`, `purpose`, `provenance`, and `job` (excluding `payloadSha256`).

Canonical JSON for that digest follows the journal's existing canonical form:
recursively sorted object keys, compact separators, ASCII-escaped strings, and
no non-finite numbers; SHA-256 is over the resulting UTF-8 bytes. Proposed
bounds are 2 MiB UTF-8 for the envelope, 1 MiB for serialized result bytes,
8 KiB for serialized controls, depth 12, 100,000 JSON nodes, and 4 KiB per
string. The 44-entry identity inventories remain separate from progress and
returned results.

Validation must bind `trialId` to `trialKey`, result identity to the job's
data/protocol identities, result bytes to `resultSha256`, and the canonical
payload to its digest. It must reject duplicate/unknown keys, unknown schema or
purpose, malformed nested JSON, bad digests, duplicate or conflicting path
IDs/tuples, tuples outside the expected B1 inventory, non-finite present
metrics, exceeded bounds, and permission flags other than false. A result's
`authority.researchOnly` remains true and its execution, P&L, discovery,
validation, holdout, paper, and live permission flags remain false. Lifecycle,
timestamps, progress, controls, and result completion must agree. Valid absent,
partial, rejected, failed, timed-out, and unresolved observations remain
representable; a 44-result completion is required only for the lifecycle and
result statuses that claim it. Screen status remains independent of engine
status. Provenance fields are caller assertions, even when structurally valid.
Generated examples set `syntheticFixture: true`; no export may infer
authenticity, admission, readiness, or permission.

The expected tuple inventory is fixed: `CANDIDATE` has variants
`primary-n30-f25`, `neighbour-n20-f25`, `neighbour-n45-f25`,
`neighbour-n30-f20`, and `neighbour-n30-f35`, each crossed with scenarios
`base-15bp`, `stress-30bp`, and `stress-30bp-delay-1d` and segments
`development` and `diagnostic`; `FULL_BASKET` is `full-basket-weekly` crossed
with those same scenarios and segments; `FIXED_CONTROL` has variants
`frozen-mean-exposure` and `frozen-risk-exposure`, crossed with those scenarios
and `diagnostic`; `CASH` is `cash-zero` with `scenario-independent` and both
segments. `pathIds` bind to that descriptor order; `computationPathIds` bind
to the independently ordered computation sequence. A present result's
descriptor tuple and `pathId` must match its descriptor-order slot.

The following queued observation is a complete generated sample. Its synthetic
digest-shaped identities are not production evidence. `payloadSha256` uses the
canonicalization above.

```json
{
  "schema": "MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1",
  "purpose": "B1_RESULT_EXPORT_NOT_AUTHENTICITY_RECEIPT",
  "provenance": {
    "source": "CALLER_SUPPLIED_INSPECT_B1",
    "assertionStatus": "UNVERIFIED",
    "sourceAuthenticity": "NOT_ESTABLISHED",
    "syntheticFixture": true
  },
  "job": {
    "trialId": "3d535f03e9a8725db792c80c7dd8364755990ca554e1574e992966d461e109a2",
    "trialKey": "trial-m11-generated-sample",
    "state": "queued",
    "attempts": 0,
    "owner": null,
    "fence": 0,
    "profile": "MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1",
    "protocolSha256": "1111111111111111111111111111111111111111111111111111111111111111",
    "sourceSha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "dataSha256": "3333333333333333333333333333333333333333333333333333333333333333",
    "manifestSha256": "4444444444444444444444444444444444444444444444444444444444444444",
    "pathIds": [
      "0000000000000000000000000000000000000000000000000000000000000001",
      "0000000000000000000000000000000000000000000000000000000000000002",
      "0000000000000000000000000000000000000000000000000000000000000003",
      "0000000000000000000000000000000000000000000000000000000000000004",
      "0000000000000000000000000000000000000000000000000000000000000005",
      "0000000000000000000000000000000000000000000000000000000000000006",
      "0000000000000000000000000000000000000000000000000000000000000007",
      "0000000000000000000000000000000000000000000000000000000000000008",
      "0000000000000000000000000000000000000000000000000000000000000009",
      "000000000000000000000000000000000000000000000000000000000000000a",
      "000000000000000000000000000000000000000000000000000000000000000b",
      "000000000000000000000000000000000000000000000000000000000000000c",
      "000000000000000000000000000000000000000000000000000000000000000d",
      "000000000000000000000000000000000000000000000000000000000000000e",
      "000000000000000000000000000000000000000000000000000000000000000f",
      "0000000000000000000000000000000000000000000000000000000000000010",
      "0000000000000000000000000000000000000000000000000000000000000011",
      "0000000000000000000000000000000000000000000000000000000000000012",
      "0000000000000000000000000000000000000000000000000000000000000013",
      "0000000000000000000000000000000000000000000000000000000000000014",
      "0000000000000000000000000000000000000000000000000000000000000015",
      "0000000000000000000000000000000000000000000000000000000000000016",
      "0000000000000000000000000000000000000000000000000000000000000017",
      "0000000000000000000000000000000000000000000000000000000000000018",
      "0000000000000000000000000000000000000000000000000000000000000019",
      "000000000000000000000000000000000000000000000000000000000000001a",
      "000000000000000000000000000000000000000000000000000000000000001b",
      "000000000000000000000000000000000000000000000000000000000000001c",
      "000000000000000000000000000000000000000000000000000000000000001d",
      "000000000000000000000000000000000000000000000000000000000000001e",
      "000000000000000000000000000000000000000000000000000000000000001f",
      "0000000000000000000000000000000000000000000000000000000000000020",
      "0000000000000000000000000000000000000000000000000000000000000021",
      "0000000000000000000000000000000000000000000000000000000000000022",
      "0000000000000000000000000000000000000000000000000000000000000023",
      "0000000000000000000000000000000000000000000000000000000000000024",
      "0000000000000000000000000000000000000000000000000000000000000025",
      "0000000000000000000000000000000000000000000000000000000000000026",
      "0000000000000000000000000000000000000000000000000000000000000027",
      "0000000000000000000000000000000000000000000000000000000000000028",
      "0000000000000000000000000000000000000000000000000000000000000029",
      "000000000000000000000000000000000000000000000000000000000000002a",
      "000000000000000000000000000000000000000000000000000000000000002b",
      "000000000000000000000000000000000000000000000000000000000000002c"
    ],
    "computationPathIds": [
      "000000000000000000000000000000000000000000000000000000000000002c",
      "000000000000000000000000000000000000000000000000000000000000002b",
      "000000000000000000000000000000000000000000000000000000000000002a",
      "0000000000000000000000000000000000000000000000000000000000000029",
      "0000000000000000000000000000000000000000000000000000000000000028",
      "0000000000000000000000000000000000000000000000000000000000000027",
      "0000000000000000000000000000000000000000000000000000000000000026",
      "0000000000000000000000000000000000000000000000000000000000000025",
      "0000000000000000000000000000000000000000000000000000000000000024",
      "0000000000000000000000000000000000000000000000000000000000000023",
      "0000000000000000000000000000000000000000000000000000000000000022",
      "0000000000000000000000000000000000000000000000000000000000000021",
      "0000000000000000000000000000000000000000000000000000000000000020",
      "000000000000000000000000000000000000000000000000000000000000001f",
      "000000000000000000000000000000000000000000000000000000000000001e",
      "000000000000000000000000000000000000000000000000000000000000001d",
      "000000000000000000000000000000000000000000000000000000000000001c",
      "000000000000000000000000000000000000000000000000000000000000001b",
      "000000000000000000000000000000000000000000000000000000000000001a",
      "0000000000000000000000000000000000000000000000000000000000000019",
      "0000000000000000000000000000000000000000000000000000000000000018",
      "0000000000000000000000000000000000000000000000000000000000000017",
      "0000000000000000000000000000000000000000000000000000000000000016",
      "0000000000000000000000000000000000000000000000000000000000000015",
      "0000000000000000000000000000000000000000000000000000000000000014",
      "0000000000000000000000000000000000000000000000000000000000000013",
      "0000000000000000000000000000000000000000000000000000000000000012",
      "0000000000000000000000000000000000000000000000000000000000000011",
      "0000000000000000000000000000000000000000000000000000000000000010",
      "000000000000000000000000000000000000000000000000000000000000000f",
      "000000000000000000000000000000000000000000000000000000000000000e",
      "000000000000000000000000000000000000000000000000000000000000000d",
      "000000000000000000000000000000000000000000000000000000000000000c",
      "000000000000000000000000000000000000000000000000000000000000000b",
      "000000000000000000000000000000000000000000000000000000000000000a",
      "0000000000000000000000000000000000000000000000000000000000000009",
      "0000000000000000000000000000000000000000000000000000000000000008",
      "0000000000000000000000000000000000000000000000000000000000000007",
      "0000000000000000000000000000000000000000000000000000000000000006",
      "0000000000000000000000000000000000000000000000000000000000000005",
      "0000000000000000000000000000000000000000000000000000000000000004",
      "0000000000000000000000000000000000000000000000000000000000000003",
      "0000000000000000000000000000000000000000000000000000000000000002",
      "0000000000000000000000000000000000000000000000000000000000000001"
    ],
    "timestamps": {
      "createdAt": "2026-01-01T00:00:00Z",
      "startedAt": null,
      "finishedAt": null
    },
    "paths": [],
    "controls": null,
    "controlBindings": null,
    "result": null,
    "resultSha256": null,
    "summarySha256": null,
    "reason": null,
    "unresolved": false,
    "executionAuthorized": false,
    "promotionAuthorized": false,
    "profitabilityInferred": false
  },
  "payloadSha256": "1ccb97b7fbbfc7a8fb965cedbe03516d279e2b0d580c1068caeeb8e60cf4fe39"
}
```

**Exact proposed implementation allowlist after acceptance** (no edits are
authorized by this proposal itself):

- `scripts/research/b1-7/export-historical-result.mjs`
- `v11/arena-historical-export.js`
- `v11/strategy-arena.js`
- `test/b1-7-historical-result-export.test.js`
- focused generated-export and Arena browser tests:
  `test/v11-arena-historical-result.test.js` and
  `test/v11-strategy-workspace-chrome.test.js`
- this document, `docs/strategy-lab/ARENA_HISTORICAL_PROJECTION.md`

No shell/terminal-entry, pinned journal/supervisor/engine/candidate/verifier,
or actual-data files are in scope. No UI integration, exporter, or importer
implementation is included in this checkpoint. Continue only after Lead
acceptance of the schema, canonicalization, bounds, and lifecycle semantics.

Focused generated-fixture coverage:

```sh
node --test test/v11-arena-historical-result.test.js
node --test test/v11-strategy-workspace-chrome.test.js
```
