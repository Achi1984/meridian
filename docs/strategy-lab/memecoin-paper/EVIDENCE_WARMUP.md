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

Result: 12 focused warmup tests passed; both module syntax checks passed. The
correction tests exercise delayed filesystem reads/writes/syncs/unlinks,
cancellation/deadline fencing, post-unlink directory sync failures, symlink
ancestry rejection, duplicate logical keys, and payload-binding mismatches.

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
overwritten or retried. A successful publication requires syncing the linked
dataset, removing only its owned pending marker, and syncing the directory again;
ambiguous marker finalization returns `UNKNOWN`.

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

### Prospective same-slot classic SPL capture (implementation only)

The separate opt-in API
`acquireAndPublishProspectiveOwnerCensus({enabled: true, store, datasetId,
phase: "T0", identity, transport, clock, signal, bounds, versions})` performs
acquisition rather than checking readiness. `store` must also be explicitly
enabled. `captureProspectiveOwnerCensus` in the owner-census module exposes the
same bounded acquisition without persistence. The existing archival/mint-evidence
API is unchanged. No CLI, default/global fetch, scheduler, fallback provider,
credentials, or live acquisition is added or authorized.

The injected transport receives the existing public Solana RPC request target
with credentials omitted and redirects rejected. It must return a Response-like
object with a readable byte stream and must not silently paginate, slice, truncate,
retry, or switch providers. Each attempt sends unpaginated finalized
`getProgramAccounts`, `withContext: true`, base64 encoding and the mint memcmp,
then finalized `getAccountInfo(mint, {minContextSlot: S, ...})`.
**`minContextSlot` is only a lower bound, not an exact-slot selector.** Only equal
response slots reconcile. A mismatch discards that pair and starts a fresh full
attempt; other failures do not retry. Availability and same-slot success are
not guaranteed.

`PROSPECTIVE_CENSUS_BOUNDS` caps an acquisition at three attempts/six requests,
2 MiB cumulative transport-delivered response bytes (including automatically
decompressed bodies), 20,000 accounts per response, 4,000,000 cumulative
decode-work units and one 30-second monotonic deadline shared by every attempt,
body read, decode and reconciliation. Callers may lower these caps, never raise
them. Cancellation and late-response fencing also apply. The response-byte cap
leaves room for base64 raw bodies and diagnostic owners in the existing 8 MiB
store; store byte/work limits still apply independently. Publication/readback use
the existing bounded filesystem operations and fail-closed pending-marker protocol.

Only the classic Token program is supported. Native SOL, both native mint
addresses (including wrapped SOL), Token-2022, extensions, malformed accounts,
duplicate token-account addresses and nonzero native-option tags are rejected.
Classic mint data must be exactly 82 bytes and token accounts exactly 165 bytes.
Raw balances and supply are decoded as BigInt; the sum must equal the same-slot
mint supply exactly. `positiveOwnerCount` counts distinct owners with positive
aggregate balances, separately from `distinctOwnerCount`, `accountCount` and
`zeroBalanceAccountCount`. Frozen initialized accounts retain their balances.

A successful immutable `local-census-acquisition` record contains the complete
JSON-RPC request body bytes and **transport-delivered response body bytes**,
losslessly base64 encoded with individual SHA-256 hashes and lengths,
request metadata/HTTP status, `content-encoding`/`content-length` headers,
all completed attempt
exchanges and slot pairs, the accepted slot, actual acquisition start/end wall
times, configured bounds and consumed request/byte/decode/monotonic-elapsed
budgets. Failed or incomplete acquisitions are not published. Publication success
requires digest-matching readback; hashes detect local byte changes, not provider
authentication. Reacquisition produces a new record, not an overwrite. Use
**separate private store roots for T0 and T1**; `phase` must be exactly `"T0"` or
`"T1"`, and the one-dataset-per-root invariant prevents combining or replacing them.

Response evidence is explicitly labeled `TRANSPORT_DELIVERED_BYTES` with
`originalWireBytesCaptured: false`: an injected fetch-style transport may already
have decompressed gzip/br bodies while retaining the compressed Content-Length.
The recorded hashes cover the delivered bytes, not original compressed wire bytes
or HTTP framing. Content-Length preflight/equality checks apply only when
Content-Encoding is absent or `identity`, when the header describes the delivered
representation. Other encodings skip those length comparisons but never the hard
cumulative streaming cap on delivered bytes; malformed length headers and invalid
or truncated delivered JSON still fail closed.

The result stays `UNKNOWN` with `RECONCILED_DIAGNOSTIC_ONLY` capture status:
same-slot supply conservation supports positive-balance reconciliation of the
returned accounts, not authenticated source completeness. Omitted zero accounts
cannot be detected from supply conservation, and an unauthenticated provider can
misrepresent both responses. Acquisition wall time is explicitly
`LOCAL_ACQUISITION_TIME_NOT_HISTORICAL_STATE_TIME`, never an exact historical
state timestamp. These records cannot satisfy the existing exact-window census
reader or hard-gate admission. Pool exclusions, developer attribution, bundle/rug
facts and source authentication remain UNKNOWN/unestablished. No source-trust
policy, dashboard, pilot, live execution or HEDGE state changes.

Offline focused validation:

```sh
node --test /home/runner/work/meridian/meridian/test/memecoin-paper-prospective-owner-census.test.js /home/runner/work/meridian/meridian/test/memecoin-paper-owner-census.test.js /home/runner/work/meridian/meridian/test/memecoin-paper-evidence-warmup.test.js
```

RPC semantics: [getProgramAccounts](https://solana.com/docs/rpc/http/getprogramaccounts),
[getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo),
[Solana Cookbook](https://solanacookbook.com/guides/get-program-accounts.html).

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
