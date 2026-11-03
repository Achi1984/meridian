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

End-to-end offline proof uses a synthetic transport, the existing
`source-shaped` history fixture, and the real paper pipeline in
`SYNTHETIC_TEST_ONLY`. A canonical unavailable metric must remain unavailable;
execution and real-data entry eligibility remain false.

Run the focused proof with:

```sh
node --test test/memecoin-paper-provider-warmup-handoff.test.js
```
