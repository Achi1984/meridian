# Bounded Paper evidence warmup

This package is an explicit, offline persistence and exact-read adapter for
captured price observations and census snapshots. Importing it performs no
filesystem, network, provider, scheduler, host, or trading operation. The CLI
does nothing unless `capture --enabled` is selected; it accepts a bounded local
capture bundle and has no price-provider client.

The issue's accepted base was `acceptedmainfc3ca777`. The sandbox checkout
baseline was `31bae81bd20a50d0f01c04327a0d81b2f14964b5`. Focused validation:

```sh
node --test test/memecoin-paper-evidence-warmup.test.js
node --check scripts/memecoin-paper/evidence-warmup/index.mjs
node --check scripts/memecoin-paper/evidence-warmup/cli.mjs
```

Result: 7 focused warmup tests passed; both module syntax checks passed. Test coverage
includes disabled-by-default behavior, immutable duplicate/conflict handling,
restart digest verification and tampering, exact price/census endpoints,
identity/policy/source changes, unknown trust and completeness through the
actual Analyst builder, synthetic handoff, quotas, cancellation, and local
census timestamps remaining nonhistorical.

## Capture, store, read

Prepare a local JSON bundle with this top-level shape:

```json
{
  "datasetId": "paper-run-01",
  "identity": {"chainId": "solana", "mint": "…", "pool": "…", "quote": "…"},
  "capturedAt": 1793448000000,
  "versions": {"capture": "owner-reviewed-capture-v1"},
  "records": []
}
```

`records` is capped at 2,500 entries and 8 MiB per immutable dataset. A price
record carries `kind: "price"`, `identity`, `mint` (the exact candidate mint or
quote mint), `sourceAtMs`, `denomination: "USD"`, `source`,
`methodologyVersion`, `receivedAt`, `trust`, `completeness`, and the original
source observation in `payload`. A census record carries `kind: "census"`,
`identity`, `observedAt`, `policyVersion`, `source`, `receivedAt`, `trust`,
`completeness`, and the original snapshot in `payload`. Payloads and receipts
are preserved; the store does not authenticate their source claims. In
particular, local `trust` labels are not a review mechanism. Explicit
`UNKNOWN`/`INCOMPLETE` payloads cannot be re-labeled complete, and synthetic
records must remain visibly `SYNTHETIC_FIXTURE_ONLY`.

Each store root holds exactly one immutable dataset; create a separate private
root for another run. The root and its parent ancestry must be owned/private
local directories, with the normal sticky `/tmp` ancestor permitted for tests.
The store uses a bounded
direct file read (no directory scan), verifies the digest of the complete file
payload on every read/restart, and uses an exclusive immutable publication.
Same bytes under the same dataset ID return `DUPLICATE`; different bytes return
`CONFLICT`. Ambiguous publication/read states return `UNKNOWN`; they are not
overwritten or retried.

```sh
node scripts/memecoin-paper/evidence-warmup/cli.mjs capture \
  --enabled --store "$HOME/.local/share/meridian/evidence-warmup" \
  --id paper-run-01 --input /absolute/path/to/capture.json

node scripts/memecoin-paper/evidence-warmup/cli.mjs read \
  --store "$HOME/.local/share/meridian/evidence-warmup" --id paper-run-01

node scripts/memecoin-paper/evidence-warmup/cli.mjs status \
  --store "$HOME/.local/share/meridian/evidence-warmup" --id paper-run-01 \
  --query '{"identity":{"chainId":"solana","mint":"…","pool":"…","quote":"…"},"priceEndpoints":[{"mint":"…","atMs":1793448000000,"denomination":"USD"}],"censusEndpoints":[{"atMs":1793444400000,"policyVersion":"owner-reviewed-census-v1"}]}'
```

Without `--enabled`, `capture` returns `DISABLED` and does not read the bundle
or create storage. Default limits also cap a publication to one file, 1,000,000
work units, and 15 seconds. Cancellation, byte/work exhaustion, and unknown
publication outcome fail closed.

For a one-step bounded census acquisition, callers may explicitly invoke
`acquireAndPublishOwnerCensus({enabled: true, store, identity, manifest,
transport, clock, mintEvidence, signal})`. It delegates to the existing
`acquireOwnerCensus`; the caller supplies the transport and no provider is
selected by this package. The resulting RPC census remains `UNKNOWN` with
`UNAUTHENTICATED_RPC_RESPONSE`. Its `observedAt` is stored only as
`LOCAL_ACQUISITION_TIME`, never as a historical census endpoint.

## Exact Analyst handoff

After a successful `read`, inject the readers into the existing Analyst
builder; no runtime/pipeline wiring is changed:

```js
const stored = await new EvidenceWarmupStore(directory).read(datasetId);
if (stored.status !== "AVAILABLE") throw new Error("warmup unavailable");
const packet = await buildAnalystWindowEvidence({
  ...analystRequest,
  priceSource: createWarmupPriceSource(stored.document),
  censusSource: createWarmupCensusSource(stored.document)
});
```

Prices resolve only the exact requested mint, USD denomination, and source
timestamp; there is no nearest lookup, interpolation, forward-fill, or parity
assumption. Census reads require both exact requested endpoints and the same
identity, source, aggregation, exclusions, denominator, and policy version.
Missing exact endpoints report `WARMUP`/`UNAVAILABLE`; coverage lists exact
available and missing endpoints. The Analyst builder still validates source
receipts, timestamps, policy, trust, and completeness. Unreviewed trust and
incomplete snapshots remain unavailable, regardless of storage age. A positive
synthetic fixture handoff is explicitly synthetic and non-authorizing.

## Remaining source requirements

This closes bounded local persistence and exact-window reader plumbing only. It
does not select or authenticate a price provider, add a provider-specific client,
establish historical endpoint availability, review source methodology or
denomination, approve census aggregation/exclusions/denominator policy, or
authorize paper/live trading. Real historical price evidence and owner-reviewed
complete census endpoints are still required before those metrics can be
available. No host/provider access, credentials, paid access, or activation is
included.
