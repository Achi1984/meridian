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
`resultBytes` is a `Uint8Array` containing the exact UTF-8 bytes represented by
`observation.result`, or `null` exactly when `result` is `null`. Decode with
fatal UTF-8 and require the decoded text to equal the supplied result string.
Hash those bytes directly and compare with `resultSha256`; never parse and
reserialize result metrics to check this digest. Require `resultSha256` to be
`null` exactly when `result` is `null`. Copy the observation without normalizing
or reordering progress/results.

The exporter and importer resolve `job.profile` through a trusted, versioned
profile-binding table compiled from accepted profile/manifest data, not from
the envelope or caller-supplied expected values. Select the pinned row by
profile, then require the observation's protocol/source/data/manifest digest
tuple to equal that row before checking either identity array. Each row pins
all 44 descriptor tuples and path IDs, plus computation order and digest.
Mutually consistent arrays supplied by an envelope are never their own
authority. Result tuples and `pathId` must match the bound descriptor slot, and
progress IDs must match the bound computation sequence. The binding is
structural identity only: it does not authenticate the source, observation,
data, or caller assertion.

## Byte, parser, and digest rules proposed

Use separate budgets for each parsed layer; all size and string limits below
are UTF-8 byte counts, not JavaScript character counts:

| Layer/field | Maximum | Additional limits |
| --- | ---: | --- |
| Entire envelope input | 8 MiB | Strict UTF-8; no BOM; duplicate object keys rejected before projection |
| Ordinary envelope/job strings | 4 KiB each | Applies to decoded string values and member names |
| `job.result` serialized JSON string | 1 MiB | Exempt from the ordinary 4 KiB string cap; parse as its own strict JSON layer |
| `job.controls` serialized JSON string | 8 KiB | Exempt from the ordinary 4 KiB string cap; parse as its own strict JSON layer |
| Outer envelope/job layer | depth 12; 100,000 nodes | Result and controls strings count as one outer string value each |
| Parsed result layer | depth 12; 100,000 nodes | Every decoded member name and string value at most 4 KiB |
| Parsed controls layer | depth 12; 10,000 nodes | Every decoded member name and string value at most 4 KiB |

The 8 MiB outer ceiling accommodates a 1 MiB result string even when its
characters are represented using the worst-case legal JSON escapes, while
remaining a hard pre-parse limit.

Apply fatal UTF-8 decoding, duplicate-key rejection, depth/node limits and
exact-key validation independently to the envelope, nested result JSON, and
nested controls JSON. Reject malformed UTF-8 (including unpaired surrogates in
decoded strings), duplicate keys at any depth, over-limit byte sequences before
parsing, and non-JSON constants such as NaN/Infinity. For non-null `result`,
the SHA-256 is over the exact UTF-8 bytes of that serialized string; likewise
the caller's `resultBytes` must byte-match its UTF-8 encoding. Do not canonicalize
or otherwise rewrite nested result or controls bytes.

For the outer `payloadSha256`, omit only that member and serialize the remaining
envelope with this algorithm, identically in Node and Python:

1. Preserve array order and every decoded Unicode scalar value exactly; do not
   normalize Unicode. Reject unpaired UTF-16 surrogates.
2. Sort object keys lexicographically by Unicode scalar-value sequence (not
   JavaScript UTF-16 code units), recursively.
3. Emit compact JSON with no insignificant whitespace. Emit strings in ASCII:
   escape `"` and `\`; use `\b`, `\t`, `\n`, `\f`, and `\r` for those controls;
   use lowercase `\u00xx` for other U+0000–U+001F controls; escape every
   non-ASCII BMP scalar as lowercase `\uxxxx`; encode a non-BMP scalar as its
   lowercase UTF-16 surrogate-pair escapes. Emit U+007F literally, as ASCII
   `ensure_ascii` JSON does. Do not escape `/`.
4. Before a language JSON parser can coerce number spellings, inspect outer
   number tokens. The only allowed forms are base-10 integer tokens in
   `0..9007199254740991`, with no leading zeros except `0`. Reject fractions,
   exponent notation, negative integers, and the token `-0` (including negative
   zero); the canonical output uses ordinary decimal digits. B1 metrics remain
   inside the opaque result JSON string and are not subject to this outer-number
   rule.
5. SHA-256 the ASCII bytes of that canonical serialization. The input envelope
   itself need not be canonically spaced/escaped, but its parse must be
   unambiguous under these rules.

For example, these are cross-language conformance vectors (canonical bytes
shown as ASCII; SHA-256 is over those bytes):

| Vector | Canonical bytes or raw result bytes | SHA-256 / outcome |
| --- | --- | --- |
| Unicode, key ordering, escaping | `{"a":"\u00e9\ud83d\ude00\u0001\"\\","\ue000":1,"\ud83d\ude00":2}` | `6bf91139486f75ee8b91fca021f4bc7ba7e62e500cd54966677c12e0145d6846` |
| Integer boundaries | `{"max":9007199254740991,"zero":0}` | `d1c6de4fff64001e181a639bafdc8cf052b2b3c99db136a90f8653ac648f1b48` |
| Raw result metric `0` | `{"netReturn":0}` | `125ff529a4e02af41795c97411e4fac06a357ece5fb6756e008c524b299e6814` |
| Raw result metric `0.0` | `{"netReturn":0.0}` | `cb3db5c44251fee50a9a6de53f7003a1c49e15548a8c9037b6e65eb68c121dbc` |
| Raw result metric `-0` | `{"netReturn":-0}` | `d6631e50fcfd344d8341408c4da286273775290259af950cfa89714e9a2e5d7f` |
| Outer number `-0`, `1.0`, `1e3`, or `9007199254740992` | — | Reject |

The three raw-result forms are intentionally distinct hash inputs even if a
language parses their metric values as numerically equivalent. Inner metric
validation requires finite numbers but does not rewrite their lexical form.
The 44-entry descriptor inventory remains separate from progress and returned
results; proposed bounds are not a promise that every future journal result
fits.

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

The following queued observation is a complete generated sample constructed
from the accepted synthetic engine-fixture binding in
`scripts/research-supervisor/b1_bridge_manifest.json`: its `pathIds` are the
manifest values in `pathDescriptors` order, and its `computationPathIds` are
those same values selected by the manifest's `computationOrder` indices. Its
profile/protocol/data/manifest/source fields are bound to that fixture
manifest. `trialId` is SHA-256 of the UTF-8 bytes of `trialKey`; the source
identity is SHA-256 of the canonical `sourceSha256` object from that manifest.
It is a constructed queued observation, not a database/journal read or engine
execution. The sample remains synthetic and is not production evidence. Its
payload digest uses the canonicalization above.

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
    "profile": "MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1",
    "protocolSha256": "a78e1ae8c71c8f85baee5b51f5691643fc29136f636f19465c61f553afe09185",
    "sourceSha256": "64de87409d07004c7a8ab1a17e0ac7ce0c85a259e978c689745f907c9c55ea05",
    "dataSha256": "7b98a6a6ef2834c8a4279406e2d6d174c7ee15d853283f619572b3e0da88fa99",
    "manifestSha256": "98a9c4442a140c1e78d60251d312ad489975f58f8f5c48a87a8916b141c1c361",
    "pathIds": [
      "b5b1dcbb7487eb7ef017c81828ec9fedd8255d9c563ffd10f945c51140e4e6b2",
      "3f5487214f41022ec57dc3bda46fae52c67523ca22495ca9e53f0475b5a23976",
      "b31dde9a4a350ba00cabbd9eda8ee916558a7738bcbfd0d640af8a147d78850f",
      "ebdf0202a5ed25db4b6ee6105cd84162dea1ea159c488c69890e8c7fa8401c00",
      "2b48cfc884a73239140775d3696c85ea9673ea3844563c82b5116b52c2a6490b",
      "c2af536f0e9f7f3d13fd5809d565e8862176ff7928b53bcb80f38d1513e91f63",
      "66f1d5abdd11af757fc79bec0d36bf1f4c9cf09716b9473ab43c63218320d39c",
      "8ae29f022405337d39162d0d494ffd781e896234ce5426f0d6bac887bacbfb08",
      "8d5a7dd4d3f7f328992463fe415b59fd195a03ed70121a5c68b45e46f78cc57b",
      "8cc84b6ff3409bacbefbe6d3eacb98d075011080c7b83bf0d16c06daa2ab0c5e",
      "daec6bbc0c37f1bc6dc26d1bb1e6dca897ea2858285d16c08124e6f04159b40b",
      "698e046dde81dcc2c3ac506d07fe123ef2c59d1c5b4c90d33c359c51ec8d777c",
      "90c342d4632aa590aff28eb36eb3d04fe490fa085416525f6fafe4024438fc7c",
      "1fc5fdefbf564fe22e32549a3d4173c2c92d9c9059fab3b91250306f7e6073a1",
      "f1cbe45415dc154d3d1803a2b9b7adbaa2dc6304ba1e678ccf433ccdcc98bdf7",
      "4f8d548463cbc3f6f24a2524c61d786d152acdce9180440e8b50695ded472abc",
      "fcbf6679b011d122deb8c9e40cad317e4f74c048e29c4556839a0d16487d620b",
      "886c685bad381352e40f17b310a1e503b4d2804add8190b01ea675d982db58ed",
      "da18e4726f4d773b786ec021689dbe72e531b04b74abce802dcfea76de6c054f",
      "eec02342dd82f05a525511c98c68b2384a2c2a51ddb6e70bd6e682940a58f1c7",
      "cf4332f33c3651c4cbbc435a3c415a8d7b008901354d01fed799eff48516f5d6",
      "df51524191feca732bffaec8d01bf64413a547b30f410397f4c2d28e80de6ffc",
      "1b223ef3e7396eb7b6183fa6dab99922aa192f63f79fbcc1f6697c9707a1c9b7",
      "3b92c41f43d5f6c1516bc85b32da3022cebb88f4b42a2cc5921bc0737e20357f",
      "30a2cc6f039ebfd11205838399595450c15890703c565a5d4496c4915cc59930",
      "e7f2ce06c9ac264e439dffe95eb84ad9c3909e5ca28fb1ab0c1698386db85755",
      "cdc5e429d355f07e24edd5cc9904c04d55114a48b1052268dbcbb3bb5a8e1b7c",
      "7594ab4d1cf6058eaf5f6211621ac74d20ac438e4a1175ac2931b743b6c23b21",
      "1fd41d14ff8a340d2058a63489de952abe8eac18dfd379404d2d708aa326e363",
      "f0c4e164ecf448247829e219145587cae6285df8eee7536ff89391ee646d7a0f",
      "29ebbd001ed099221fe4ecc7b79a5f108cfe25a7e8c6ccef2483678351c0b6ac",
      "01d83a78d70872101240589f0427a7bfa08f1f75f3e95cb8ee9d4133b94dcc02",
      "e0de80b93ce4f7276950fdf0fffa48826cbac509e577579490239a6e998212f1",
      "329d42fcc1f146227f841f2ddea8be5d22ad73165bdcce60d590420a638520eb",
      "6382cb9d43b8d537fbc903a72634a754d8bc07ebfe8a764a8c23b8e46b16ef20",
      "9324cf9e4eeb396bbf7dd2eccd45bc80c768b0823e6ae242cc881a14146f32d9",
      "0eaf2434f76f78e553f292be543b2c736d229b025a695d46c24acc244aee8757",
      "296f2faf91aeeb5ba081ecc91ad3dcf3971763486435edfa4951a3f668348863",
      "4ae7d293e46557940f385de7813b833f2fa461e60f2af2a7a3b09264bcfe1551",
      "32c9bc0ee3204843120d3593ce8f506438d27bbb7231bb22cc07ea81f249adfc",
      "30a3b05ea020dcfd7caab591573ef451fcc8a0d522a5783d428e4a8afbf196b6",
      "6f3b3138a95cadea7f41bd07d895de99d2fdd5221bb6183fb24d091fc4707fe5",
      "9f938dadcef396073ec0d31730c0fd50a76ba4f530a6227b9f6e1ff18f929e09",
      "f0cedc0e324e4793fee9a67eb6dfe5cbe41618cb233b8b280a9c3ee9df42d711"
    ],
    "computationPathIds": [
      "b5b1dcbb7487eb7ef017c81828ec9fedd8255d9c563ffd10f945c51140e4e6b2",
      "b31dde9a4a350ba00cabbd9eda8ee916558a7738bcbfd0d640af8a147d78850f",
      "2b48cfc884a73239140775d3696c85ea9673ea3844563c82b5116b52c2a6490b",
      "66f1d5abdd11af757fc79bec0d36bf1f4c9cf09716b9473ab43c63218320d39c",
      "8d5a7dd4d3f7f328992463fe415b59fd195a03ed70121a5c68b45e46f78cc57b",
      "daec6bbc0c37f1bc6dc26d1bb1e6dca897ea2858285d16c08124e6f04159b40b",
      "90c342d4632aa590aff28eb36eb3d04fe490fa085416525f6fafe4024438fc7c",
      "f1cbe45415dc154d3d1803a2b9b7adbaa2dc6304ba1e678ccf433ccdcc98bdf7",
      "fcbf6679b011d122deb8c9e40cad317e4f74c048e29c4556839a0d16487d620b",
      "da18e4726f4d773b786ec021689dbe72e531b04b74abce802dcfea76de6c054f",
      "cf4332f33c3651c4cbbc435a3c415a8d7b008901354d01fed799eff48516f5d6",
      "1b223ef3e7396eb7b6183fa6dab99922aa192f63f79fbcc1f6697c9707a1c9b7",
      "30a2cc6f039ebfd11205838399595450c15890703c565a5d4496c4915cc59930",
      "cdc5e429d355f07e24edd5cc9904c04d55114a48b1052268dbcbb3bb5a8e1b7c",
      "1fd41d14ff8a340d2058a63489de952abe8eac18dfd379404d2d708aa326e363",
      "29ebbd001ed099221fe4ecc7b79a5f108cfe25a7e8c6ccef2483678351c0b6ac",
      "e0de80b93ce4f7276950fdf0fffa48826cbac509e577579490239a6e998212f1",
      "6382cb9d43b8d537fbc903a72634a754d8bc07ebfe8a764a8c23b8e46b16ef20",
      "9f938dadcef396073ec0d31730c0fd50a76ba4f530a6227b9f6e1ff18f929e09",
      "3f5487214f41022ec57dc3bda46fae52c67523ca22495ca9e53f0475b5a23976",
      "ebdf0202a5ed25db4b6ee6105cd84162dea1ea159c488c69890e8c7fa8401c00",
      "c2af536f0e9f7f3d13fd5809d565e8862176ff7928b53bcb80f38d1513e91f63",
      "8ae29f022405337d39162d0d494ffd781e896234ce5426f0d6bac887bacbfb08",
      "8cc84b6ff3409bacbefbe6d3eacb98d075011080c7b83bf0d16c06daa2ab0c5e",
      "698e046dde81dcc2c3ac506d07fe123ef2c59d1c5b4c90d33c359c51ec8d777c",
      "1fc5fdefbf564fe22e32549a3d4173c2c92d9c9059fab3b91250306f7e6073a1",
      "4f8d548463cbc3f6f24a2524c61d786d152acdce9180440e8b50695ded472abc",
      "886c685bad381352e40f17b310a1e503b4d2804add8190b01ea675d982db58ed",
      "eec02342dd82f05a525511c98c68b2384a2c2a51ddb6e70bd6e682940a58f1c7",
      "df51524191feca732bffaec8d01bf64413a547b30f410397f4c2d28e80de6ffc",
      "3b92c41f43d5f6c1516bc85b32da3022cebb88f4b42a2cc5921bc0737e20357f",
      "e7f2ce06c9ac264e439dffe95eb84ad9c3909e5ca28fb1ab0c1698386db85755",
      "7594ab4d1cf6058eaf5f6211621ac74d20ac438e4a1175ac2931b743b6c23b21",
      "f0c4e164ecf448247829e219145587cae6285df8eee7536ff89391ee646d7a0f",
      "01d83a78d70872101240589f0427a7bfa08f1f75f3e95cb8ee9d4133b94dcc02",
      "329d42fcc1f146227f841f2ddea8be5d22ad73165bdcce60d590420a638520eb",
      "9324cf9e4eeb396bbf7dd2eccd45bc80c768b0823e6ae242cc881a14146f32d9",
      "0eaf2434f76f78e553f292be543b2c736d229b025a695d46c24acc244aee8757",
      "296f2faf91aeeb5ba081ecc91ad3dcf3971763486435edfa4951a3f668348863",
      "4ae7d293e46557940f385de7813b833f2fa461e60f2af2a7a3b09264bcfe1551",
      "32c9bc0ee3204843120d3593ce8f506438d27bbb7231bb22cc07ea81f249adfc",
      "30a3b05ea020dcfd7caab591573ef451fcc8a0d522a5783d428e4a8afbf196b6",
      "6f3b3138a95cadea7f41bd07d895de99d2fdd5221bb6183fb24d091fc4707fe5",
      "f0cedc0e324e4793fee9a67eb6dfe5cbe41618cb233b8b280a9c3ee9df42d711"
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
  "payloadSha256": "979ff30ca98890e062a7183a8ec74f46f91b07402fb7eda2a1c4a59ad60f4620"
}
```

Verification evidence: the sample's path and computation arrays were compared
with the checked-in generated-fixture manifest and its `computationOrder`;
`trialId`, source identity, and payload digests were recomputed from the stated
inputs. The Unicode/escaping and integer vectors, plus the three raw metric
byte hashes, produced matching canonical bytes and SHA-256 values in Node and
Python. This verification used static generated-fixture metadata only, not a
journal/database, market data, or an engine execution.

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
