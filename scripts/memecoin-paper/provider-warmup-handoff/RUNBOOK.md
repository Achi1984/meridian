# Paper provider warmup handoff

This package is offline-only and disabled by default. It accepts an already-acquired
Birdeye `historical_price_unix` envelope; it does not fetch providers or start a
daemon. Keep the warmup store disabled unless an explicit offline staging run is
intended.

Production preflight uses the runtime module's current policy digest and
`createPaperRuntimeSourceAdapter.acquireCandidates`. The expected result is
`SOURCE_POLICY_UNAPPROVED`; it does not access credentials, acquire candidates,
or mutate storage. Offline staging is a separate operation and does not approve
or bypass that gate.

An accepted price envelope must bind the exact Solana mint, USD denomination,
second-aligned request time, successful Birdeye method/source, unscaled value,
source time, and response receipt digest. The immutable store readback must match
the publication digest. Staged price records are always `UNKNOWN` trust and
completeness; warmup readers must keep them unavailable. Helius history and GPA
responses are diagnostics only and cannot produce historical completeness or
census records.

## Optional response-byte integrity binding

`runOffline` accepts an optional `integrity` input
(`paper-warmup-response-integrity-v1`): exactly `version`, `responseBytes` (a
`Uint8Array` of at most 65,536 bytes), `observationSha256`, and `bindingSha256`.
The handoff hashes the actual bytes, checks them against the wire and
observation receipt digests and byte count, parses them as bounded Birdeye JSON
(`success: true`, exact value, second-aligned time, unscaled), and recomputes the
domain-separated binding over the normalized observation, chain/mint/pool/quote,
request purpose/time/denomination, source/method/version, and this module's
`PAPER_RUNTIME_SOURCE_POLICY_SHA256`. Any supplied-but-invalid input refuses
before publication. Missing input is reported as `integrity.status:
NOT_CHECKED` and the stored record is unchanged.

On success only a bounded receipt (digests and byte count, never the bytes) is
stored on the price record, and it is revalidated against the immutable readback.
Result: `INTEGRITY_MATCH` with `sourceAuthentication: NOT_ESTABLISHED`, trust and
completeness `UNKNOWN`, `authorization: false`. This detects byte or binding
changes only; it is not a signature, provenance attestation, or review, and the
price stays unavailable to canonical evaluation.

## Checkpoint (#1213, parent #1207 still open)

Scope: this package, its fixture/tests, and this runbook only. Authentication,
attestation, and reviewer approval remain unresolved; no provider access, keys,
host, workflow, spend, or activation. Final head and test results are recorded in
the Draft PR.

When a run-scoped budget capability is supplied, each store request is reserved
before dispatch. Publication bytes count the canonical serialized input once;
readback bytes count the serialized read result once. Provider response bytes are
counted while the response body is consumed and are not counted again as stored
bytes.

End-to-end offline proof uses a synthetic transport, the existing
`source-shaped` history fixture, and the real paper pipeline in
`SYNTHETIC_TEST_ONLY`. A canonical unavailable metric must remain unavailable;
execution and real-data entry eligibility remain false.

Run the focused proof with:

```sh
node --test test/memecoin-paper-provider-warmup-handoff.test.js
```
