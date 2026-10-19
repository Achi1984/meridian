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
unavailable. Schema and digest consistency do not establish source authenticity,
admission, or authority. Historical interpretation, holdout status, assumed
costs, `NO_FINITE_TRADE_STOP`, and `sourceAuthenticity: NOT_ESTABLISHED` are
shown only when present in the serialized producer result. Replay, the existing
synthetic inspection panel, and disposal behavior remain separate.

Focused generated-fixture coverage:

```sh
node --test test/v11-arena-historical-result.test.js
node --test test/v11-strategy-workspace-chrome.test.js
```
