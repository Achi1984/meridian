# Historical B1 result export V2

V2 is a separate, bounded offline format for caller-supplied historical B1
observations. It does not change `MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1`,
the V1 exporter, or its synthetic-only bindings. The V2 parser accepts only
the historical profile name and historical result shape. It does not load a
profile, manifest, data file, journal, or path payload.

## Byte contract

The envelope is closed and versioned as
`MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V2`. It includes caller-asserted
provenance, the unchanged `inspect_b1` observation, the exact supplied
serialized summary as a UTF-8 string, and an outer payload digest. The pure
exporter API is
`exportHistoricalResultV2({observation,resultBytes,summaryBytes,generatedFixture})`.
The result and summary byte arguments must be ordinary `Uint8Array` values
(or `null` exactly when no result is present). The exporter snapshots each
once, applies fatal UTF-8 decoding, and checks its byte-for-byte correspondence
and SHA-256 against the observation.

`summaryBytes` are the original `summary_json` bytes. The journal stores those
bytes and their digest; `inspect_b1` reconstructs `result` by adding
`controlDefinitions` and manifest-ordered `paths`. V2 verifies the summary
digest over the exact supplied bytes, strictly parses both JSON strings, then
compares the parsed summary with the parsed result after removing exactly
`paths` and `controlDefinitions`. It never reserializes either value to
reconstruct an original digest.

The parser rejects duplicate keys, invalid UTF-8, unknown keys in closed
objects, invalid numbers, inconsistent path/order identities, mismatched
digests, contradictory lifecycle/result states, and oversize input. It checks
the producer's canonical input identity, execution identity, all 44 canonical
path descriptors and path identities, manifest digest, and computation order.
The identity inputs contain only bounded strings and hash records; no
JavaScript serialization is used to reproduce hashes of floating-point result
or progress payloads. These checks establish internal consistency, not a trusted
profile binding. The envelope is limited to 8 MiB; serialized result and summary
are each limited to 1 MiB, controls to 8 KiB, individual progress payloads to
64 KiB, and the complete envelope including optional evidence to 8 MiB. The
shared Markdown report is limited to 1 MiB.

## What is and is not checked

Lifecycle state, engine result status, and screen status are independent.
V2 preserves the three supported result shapes:

* `COMPLETED` with 44 completed paths and a normal historical `PASS` or
  `NO_EDGE` screen containing the nine fixed checks.
* `COMPLETED` with 44 completed paths and the exact screen-only
  `INSUFFICIENT_EVIDENCE` shape.
* Engine `INSUFFICIENT_EVIDENCE` with 19 completed paths and 25 explicit
  `NOT_RUN_INSUFFICIENT_EVIDENCE` result records, job state `failed`, and a
  screen containing only its engine-level status.

The 44 `pathIds` inventory slots and computation order remain separate from
progress and returned path results. Control bindings are checked against
computation progress indices 0 and 15. This checks internal references only:
`inspect_b1` does not provide original progress payload bytes by default, so
their SHA-256 values remain
`NOT_VERIFIED_ORIGINAL_BYTES_NOT_SUPPLIED`. Callers may optionally supply
original payload bytes by computation index; V2 verifies their exact byte
hashes against progress and structurally compares each parsed payload with its
returned path record. Partial provision is reported separately from complete
verification. Supplied controls are retained; they are not recalculated.

Result and summary byte digests, the summary/result structural projection,
trial ID, protocol/input consistency, result execution identity, path identities,
and manifest order are checked. Source SHA, profile, implementation claims,
and input provenance remain caller-supplied assertions; there is no trusted
profile bundle or pinned historical catalog in this format. A well-formed or
matching hash is not source authenticity, independent acceptance, or authority.
The outer payload digest detects unresealed changes, not a malicious caller who
can replace data and recompute the digest.

The journal observation has attempt and per-job fence fields, but does not
supply a durable daily budget, global active fence, launcher receipt,
approval, execution checkout, or source-map digest. The engine result's
`budget` is only its reported configured limits; it is not the journal's
durable budget. V2 can optionally carry separately typed supplemental bytes for
those seven evidence categories. Their bytes are bounded and their supplied
SHA-256 is checked, but their contents are opaque, are not validated against
producer contracts unavailable in `inspect_b1`, and are never treated as
authentic, independently accepted, or authority-bearing. Missing categories
remain `NOT_SUPPLIED`; no field is inferred from another.
The diagnostic window has already been seen. The report makes no holdout,
execution, promotion, profitability, or causal claim and does not change any
screen threshold.

`generatedFixture: true` identifies constructed historical-shaped fixtures;
they are not genuine historical results. Provenance is always
`UNVERIFIED`/`NOT_ESTABLISHED`, including when the marker is false. V1
continues to reject historical evidence.

## CLI

The exporter reads one bounded JSON wrapper from stdin containing
`observation`, base64 `resultBytesBase64`, base64 `summaryBytesBase64`, and
`generatedFixture`. An optional `optionalEvidence` object may carry
`progressPayloads` (`computationIndex`, `payloadBytesBase64`) and `supplemental`
(`kind`, `bytesBase64`). The importable API accepts the same shape using raw
`Uint8Array` byte values. It writes a complete V2 envelope only after validation.
The existing report command accepts V1 or V2 bytes and writes only a complete
report:

```sh
node scripts/research/b1-7/export-historical-result-v2.mjs < input.json
node scripts/research/b1-7/render-review-report.mjs < export.json
```

The CLI commands accept no arguments, read no files beyond stdin, and perform
no network, journal, CSV, provider, engine, or replay access. Invalid input
and output-limit failures write a stable generic error to stderr and no partial
stdout.
